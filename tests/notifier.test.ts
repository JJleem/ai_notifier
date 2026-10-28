import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/runner.js';
import { config, type Config } from '../src/config.js';
import type { ResetEvent, State } from '../src/types/reset.js';
import { emptyState, readState, saveState, lockState } from '../src/services/state-store.js';
import { canonicalSource, fetchEvents, parseCatalog, validDate } from '../src/services/reset-api.js';
import { request, type Fetch } from '../src/services/http.js';
import { sendSlack, slackMessage } from '../src/services/slack.js';
import { kst, remaining } from '../src/utils/date.js';
import { resetScope, unknown } from '../src/utils/format.js';

const now = new Date('2026-10-28T09:00:00Z');
const cfg: Config = { apiUrl: 'https://claude-resets.com/api/resets', dryRun: false, allowProvisional: false, allowUpstream: false };
const baseline = (): State => ({ ...emptyState(), initializedAt: '2026-10-20T00:00:00.000Z' });
function event(provider: 'codex' | 'claude' = 'codex', id = '9000000000000000001', extra: Partial<ResetEvent> = {}): ResetEvent {
  return { provider, id, date: '2026-10-28T06:29:38Z', kind: 'reset', resetType: 'regular', verification: 'curated', url: `https://x.com/test_fixture/status/${id}`, ...extra };
}
function harness(events: ResetEvent[], initial = baseline(), options: Config = cfg, failAt = 0) {
  let state = structuredClone(initial);
  const sent: ResetEvent[] = [];
  let saves = 0;
  const execute = () => run(options, { load: async () => structuredClone(state), fetchEvents: async () => events,
    save: async s => { state = structuredClone(s); saves++; },
    send: async e => { if (failAt && sent.length + 1 === failAt) throw new Error('Slack test failure'); sent.push(e); }, log: () => {}, now: () => now });
  return { execute, sent, get state() { return state; }, get saves() { return saves; } };
}
test('최초 실행은 전체 이벤트를 기준 등록하고 알림 생략', async () => {
  const h = harness([event(), event('claude', '9000000000000000002', { kind: 'policy' })], emptyState());
  await h.execute(); assert.equal(h.sent.length, 0); assert.equal(h.state.seenIds.length, 2); assert.equal(h.state.initializedAt, now.toISOString());
});
for (const provider of ['codex', 'claude'] as const) test(`새로운 ${provider} 초기화 감지 및 재실행 중복 방지`, async () => {
  const h = harness([event(provider)]); await h.execute(); await h.execute(); assert.equal(h.sent.length, 1); assert.equal(h.saves, 1);
});
test('보관형 초기화권 및 KST/남은 기간', async () => {
  const e = event('claude', undefined, { resetType: 'banked', usableUntil: '2026-10-29T00:00:00Z' });
  const h = harness([e]); await h.execute(); assert.equal(h.sent.length, 1);
  const text = JSON.stringify(slackMessage(e, now)); assert.match(text, /초기화권 지급/); assert.match(text, /2026.10.29 09:00 KST/);
  assert.equal(kst('2026-10-28T06:29:38Z'), '2026.10.28 15:29 KST'); assert.equal(remaining(e.usableUntil!, now), '0일 15시간 0분');
  for (const block of slackMessage(e, now).attachments[0]!.blocks) if ('fields' in block) assert.ok(block.fields!.length <= 10);
});
test('초기화 범위는 명시적인 reset 절에서만 추출', () => {
  assert.match(resetScope(event('claude', undefined, { note: "Reset everyone's 5-hour and weekly rate limits for all users." })), /5시간 및 주간/);
  assert.match(resetScope(event('claude', undefined, { note: 'Reset weekly limits for everyone on Max.' })), /주간/);
  assert.equal(resetScope(event('claude', undefined, { note: '20% higher 5-hour limits, and gave users a banked reset.' })), unknown);
});
test('policy, 미검증, provisional, upstream은 기본 제외', async () => {
  const h = harness([event('codex', '1', { kind: 'policy' }), event('codex', '2', { verification: 'provisional' }), event('claude', '3', { verification: 'upstream' }), event('claude', '4', { verification: 'unknown' })]);
  await h.execute(); assert.equal(h.sent.length, 0); assert.equal(h.saves, 0);
});
test('잠정 이벤트가 이후 curated가 되면 발송 가능', async () => {
  const e = event('claude', undefined, { verification: 'provisional' }); const h = harness([e]);
  await h.execute(); e.verification = 'curated'; await h.execute(); assert.equal(h.sent.length, 1);
});
test('provisional/upstream 개별 옵션 허용', async () => {
  for (const verification of ['provisional', 'upstream'] as const) {
    const h = harness([event('codex', undefined, { verification })], baseline(), { ...cfg, allowProvisional: verification === 'provisional', allowUpstream: verification === 'upstream' });
    await h.execute(); assert.equal(h.sent.length, 1);
  }
});
test('Slack 실패 시 해당 이벤트 미저장, 이전 성공 건은 유지', async () => {
  const h = harness([event('codex', '1'), event('claude', '2')], baseline(), cfg, 2);
  await assert.rejects(h.execute); assert.deepEqual(h.state.seenIds, ['codex:1']); assert.equal(h.saves, 1);
});
test('오래된 순서로 전송', async () => {
  const h = harness([event('codex', '3'), event('claude', '2', { date: '2026-10-27T01:00:00Z' }), event('codex', '1', { date: '2026-10-26T01:00:00Z' })]);
  await h.execute(); assert.deepEqual(h.sent.map(e => e.id), ['1', '2', '3']);
});
test('같은 원문이 다른 ID/소스/서비스로 들어와도 한 번만 전송', async () => {
  const first = event('codex', '1'); const h = harness([first, event('claude', '2', { url: 'https://twitter.com/another/status/1?tracking=1' })]);
  await h.execute(); assert.equal(h.sent.length, 1); assert.equal(canonicalSource(first.url!), 'https://x.com/i/status/1');
});
test('설치 이전, 7일 초과, 미래, 만료, 출처 부재/외부 도메인 제외', async () => {
  const h = harness([
    event('codex', '1', { date: '2026-10-19T00:00:00Z' }), event('codex', '2', { date: '2026-10-20T01:00:00Z' }),
    event('codex', '3', { date: '2026-10-29T01:00:00Z' }), event('codex', '4', { resetType: 'banked', usableUntil: '2026-10-28T00:00:00Z' }),
    event('codex', '5', { url: 'https://evil.example/news' }), event('codex', '6', { url: '' })]);
  await h.execute(); assert.equal(h.sent.length, 0);
});
test('DRY_RUN은 Slack 및 최초/후속 상태 모두 변경 안 함', async () => {
  for (const initial of [emptyState(), baseline()]) {
    const h = harness([event()], initial, { ...cfg, dryRun: true }); await h.execute(); assert.deepEqual(h.state, initial); assert.equal(h.saves, 0); assert.equal(h.sent.length, 0);
  }
});
test('API fixture와 실제 형태의 선택 필드 처리', async () => {
  const fixture = JSON.parse(await readFile('tests/fixtures/catalog.json', 'utf8')) as { providers: { codex: { events: unknown[] } } };
  fixture.providers.codex.events.push({ id: 'test-only', date: '2026-10-28T00:00:00Z', kind: 'reset' });
  assert.equal(parseCatalog(fixture)[0]!.verification, 'unknown');
});
test('API 잘못된 JSON, 누락 배열, 잘못된 시간/타입 오류', async () => {
  await assert.rejects(() => fetchEvents(cfg.apiUrl, { fetcher: (async () => new Response('{')) as Fetch }), /JSON/);
  for (const data of [{}, { providers: { claude: { events: [] } } }, { providers: { claude: { events: [ { ...event(), date: '2026-02-30T00:00:00Z' } ] }, codex: { events: [] } } }]) assert.throws(() => parseCatalog(data));
  assert.equal(validDate('2026-02-30T00:00:00Z'), false);
});
test('API 실패가 상태를 덮어쓰지 않음', async () => {
  let saved = false;
  await assert.rejects(() => run(cfg, { load: async () => baseline(), fetchEvents: async () => { throw new Error('API offline'); }, save: async () => { saved = true; }, send: async () => {}, log: () => {}, now: () => now }));
  assert.equal(saved, false);
});
test('신규 이벤트 없음: 전송/상태 갱신 없음', async () => {
  const h = harness([]); await h.execute(); assert.equal(h.sent.length, 0); assert.equal(h.saves, 0);
});
test('Slack 첫 전송 실패: 상태 전체 유지', async () => {
  const initial = baseline(); const h = harness([event()], initial, cfg, 1);
  await assert.rejects(h.execute); assert.deepEqual(h.state, initial); assert.equal(h.saves, 0);
});
test('상태 저장 실패: 즉시 중지하여 이후 이벤트를 보내지 않음', async () => {
  let sent = 0;
  await assert.rejects(() => run(cfg, { load: async () => baseline(), fetchEvents: async () => [event('codex', '1'), event('claude', '2')], send: async () => { sent++; }, save: async () => { throw new Error('disk failure'); }, log: () => {}, now: () => now }), /disk failure/);
  assert.equal(sent, 1);
});
test('긴 Retry-After는 서버 제한을 무시하고 재요청하지 않음', async () => {
  let calls = 0;
  await assert.rejects(() => request('https://example.com', {}, { fetcher: (async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); }) as Fetch, wait: async () => { assert.fail('장시간 대기하면 안 됨'); } }));
  assert.equal(calls, 1);
});
test('HTTP 429/5xx 백오프 재시도 및 4xx 즉시 실패', async () => {
  let calls = 0; const waits: number[] = [];
  assert.equal(await request('https://example.com', {}, { fetcher: (async () => ++calls < 3 ? new Response('', { status: calls === 1 ? 429 : 503, headers: { 'retry-after': '1' } }) : new Response('ok')) as Fetch, wait: async ms => { waits.push(ms); } }), 'ok');
  assert.equal(calls, 3); assert.equal(waits.length, 2); assert.ok(waits[1]! >= 2000);
  calls = 0; await assert.rejects(() => request('https://example.com', {}, { fetcher: (async () => { calls++; return new Response('', { status: 403 }); }) as Fetch })); assert.equal(calls, 1);
});
test('네트워크 오류는 제한된 재시도 후 비밀 없는 오류 반환', async () => {
  let calls = 0; await assert.rejects(() => request('https://example.com', {}, { fetcher: (async () => { calls++; throw new Error('secret-webhook'); }) as Fetch, wait: async () => {} }), /HTTP 네트워크/); assert.equal(calls, 3);
});
test('요청 타임아웃 후 제한된 재시도', async () => {
  let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }); });
  }) as Fetch;
  await assert.rejects(() => request('https://example.com', {}, { fetcher, timeoutMs: 5, wait: async () => {} })); assert.equal(calls, 3);
});
test('본문 수신 타임아웃 후 제한된 재시도', async () => {
  let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('abort')), { once: true }); } }));
  }) as Fetch;
  await assert.rejects(() => request('https://example.com', {}, { fetcher, timeoutMs: 5, wait: async () => {} })); assert.equal(calls, 3);
});
test('Slack 응답 검증 및 멘션 미삽입', async () => {
  const e = event('claude', undefined, { scope: '<!channel> <@U123> & *bold*', note: '<!everyone>' });
  const message = JSON.stringify(slackMessage(e, now)); assert.doesNotMatch(message, /<!channel>|<@U123>|<!everyone>/);
  await assert.rejects(() => sendSlack('https://example.com', e, now, { fetcher: (async () => new Response('invalid_payload')) as Fetch }));
  await sendSlack('https://example.com', e, now, { fetcher: (async () => new Response('ok')) as Fetch });
  for (const block of slackMessage({ ...e, scope: '<&>'.repeat(3000) }, now).attachments[0]!.blocks) {
    if ('fields' in block) for (const field of block.fields!) assert.ok(field.text.length <= 2000);
  }
});
test('환경변수 엄격 검증 및 URL 비밀 비노출', () => {
  assert.throws(() => config({ DRY_RUN: 'yes' })); assert.throws(() => config({ DRY_RUN: 'false' }));
  assert.throws(() => config({ DRY_RUN: 'true', SLACK_WEBHOOK_URL: 'https://evil.test/secret' }), /형식 오류/);
  assert.throws(() => config({ DRY_RUN: 'true', RESET_API_URL: 'http://example.com' })); assert.equal(config({ DRY_RUN: 'true' }).dryRun, true);
});
test('상태 원자적 저장, 변경 없으면 미갱신, 손상/누락 거부, 실행 잠금', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reset-test-')); const path = join(dir, 'state.json');
  try {
    await assert.rejects(() => readState(path)); await saveState(path, baseline()); assert.deepEqual(await readState(path), baseline());
    const before = (await stat(path)).mtimeMs; await saveState(path, baseline()); assert.equal((await stat(path)).mtimeMs, before);
    const unlock = await lockState(path); await assert.rejects(() => lockState(path)); await unlock();
    await writeFile(path, '{broken'); await assert.rejects(() => readState(path));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
