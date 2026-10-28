import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Incident, IncidentNotification, IncidentProvider, IncidentState } from '../src/types/incident.js';
import { parseIncidents, parseSummary, fetchIncidents, incidentDate, statusUrls } from '../src/services/status-api.js';
import { emptyIncidentState, readIncidentState, saveIncidentState, validateIncidentState } from '../src/services/incident-state.js';
import { incidentRelevant, runIncidents } from '../src/services/incident-detector.js';
import { incidentDuration, incidentMessage } from '../src/utils/incident-format.js';
import { sendIncidentSlack } from '../src/services/slack.js';
import { runChecks } from '../src/checks.js';
import type { Fetch } from '../src/services/http.js';

const now = new Date('2026-10-28T09:00:00Z');
function incident(provider: IncidentProvider = 'openai', extra: Partial<Incident> = {}): Incident {
  return { provider, id: 'test-1', name: provider === 'openai' ? 'Codex errors' : 'Claude Code errors', status: 'investigating', impact: 'major', createdAt: '2026-10-28T08:00:00Z', updatedAt: '2026-10-28T08:00:00Z', updates: [], components: [], url: `https://${provider === 'openai' ? 'status.openai.com' : 'status.claude.com'}/incidents/test-1`, ...extra };
}
const ready = (): IncidentState => ({ ...emptyIncidentState(), initializedAt: { openai: '2026-10-27T00:00:00Z', anthropic: '2026-10-27T00:00:00Z' } });
function harness(events: Incident[], initial = ready(), provider: IncidentProvider = 'openai') {
  let state = structuredClone(initial);
  let failSlack = false; let failApi = false; let saves = 0;
  const sent: { id: string; kind: IncidentNotification }[] = [];
  return {
    events, sent, get state() { return state; }, get saves() { return saves; },
    set failSlack(v: boolean) { failSlack = v; }, set failApi(v: boolean) { failApi = v; },
    execute: (dryRun = false) => runIncidents(provider, dryRun, {
      load: async () => structuredClone(state), fetch: async () => { if (failApi) throw new Error('API offline'); return events; },
      save: async s => { state = structuredClone(s); saves++; },
      send: async (i, kind) => { if (failSlack) throw new Error('Slack failure'); sent.push({ id: i.id, kind }); }, now: () => now, log: () => {},
    }),
  };
}

for (const provider of ['openai', 'anthropic'] as const) test(`${provider}: 신규 장애 1회, 중간 상태·동일 장애 재전송 없음, resolved 복구 1회`, async () => {
  const e = incident(provider); const h = harness([e], ready(), provider);
  await h.execute(); await h.execute();
  for (const status of ['identified', 'monitoring', 'identified', 'monitoring'] as const) { e.status = status; e.updatedAt = '2026-10-28T08:10:00Z'; await h.execute(); }
  assert.deepEqual(h.sent.map(n => n.kind), ['outage']);
  e.status = 'resolved'; e.updatedAt = '2026-10-28T08:30:00Z'; e.resolvedAt = e.updatedAt;
  await h.execute(); await h.execute(); assert.deepEqual(h.sent.map(n => n.kind), ['outage', 'recovery']);
});
test('구성요소 우선: 일반 제목이어도 Claude Code 구성요소면 감지', () => {
  assert.ok(incidentRelevant(incident('anthropic', { name: 'Elevated errors', components: [{ id: 'cc', name: 'Claude Code' }] })));
  assert.ok(incidentRelevant(incident('openai', { name: 'Login issues', components: [{ id: 'cx', name: 'Codex Web' }] })));
});
test('ChatGPT 이미지/광고/고객지원 및 영향 불명 API 장애 제외', () => {
  for (const name of ['ChatGPT image generation errors', 'Advertising dashboard down', 'Customer support portal issues', 'API elevated error rates']) {
    assert.equal(incidentRelevant(incident('openai', { name })), false);
    assert.equal(incidentRelevant(incident('anthropic', { name, components: [{ id: 'api', name: 'Claude API (api.anthropic.com)' }] })), false);
  }
});
test('명시된 서비스 비영향 문구를 긍정 증거로 사용하지 않음', () => {
  assert.equal(incidentRelevant(incident('openai', { name: 'ChatGPT outage', updates: [{ status: 'investigating', body: 'Codex is not affected.', createdAt: '2026-10-28T08:00:00Z' }] })), false);
  assert.equal(incidentRelevant(incident('anthropic', { name: 'API errors', updates: [{ status: 'investigating', body: 'This does not affect Claude Code.', createdAt: '2026-10-28T08:00:00Z' }] })), false);
});
test('구성요소 누락 시 업데이트에 명시된 Codex/Claude Code 영향 감지', () => {
  for (const provider of ['openai', 'anthropic'] as const) assert.ok(incidentRelevant(incident(provider, { name: 'Broad outage', updates: [{ status: 'investigating', body: `${provider === 'openai' ? 'Codex' : 'Claude Code'} requests are failing.`, createdAt: '2026-10-28T08:00:00Z' }] })));
});
test('최초 실행 기존 완료/진행 장애 기준 등록, 알림 없음', async () => {
  const active = incident(); const complete = incident('openai', { id: 'old', status: 'resolved', resolvedAt: '2026-10-28T08:30:00Z' });
  const h = harness([active, complete], emptyIncidentState()); await h.execute(); await h.execute();
  assert.equal(h.sent.length, 0); assert.equal(Object.keys(h.state.incidents).length, 2);
  assert.equal(h.saves, 1); // Entire baseline, never a partially initialized file.
  assert.equal(h.state.initializedAt.anthropic, null);
  active.status = 'resolved'; active.updatedAt = '2026-10-28T08:50:00Z'; active.resolvedAt = active.updatedAt;
  await h.execute(); assert.deepEqual(h.sent, [{ id: active.id, kind: 'recovery' }]);
});
test('최초 기준 등록의 저장 실패는 부분 초기화를 남기지 않음', async () => {
  let attempts = 0;
  await assert.rejects(() => runIncidents('openai', false, {
    load: async () => emptyIncidentState(), fetch: async () => [incident(), incident('openai', { id: 'test-2' })],
    save: async s => { attempts++; assert.equal(Object.keys(s.incidents).length, 2); throw new Error('disk failure'); },
    send: async () => assert.fail('기준 등록 시 전송 금지'), log: () => {}, now: () => now,
  }), /disk failure/);
  assert.equal(attempts, 1);
});
test('같은 ID라도 provider 상태는 독립', async () => {
  const a = harness([incident()]); await a.execute(); const b = harness([incident('anthropic')], a.state, 'anthropic'); await b.execute();
  assert.deepEqual(Object.keys(b.state.incidents).sort(), ['anthropic:test-1', 'openai:test-1']);
});
test('API 실패 시 상태 및 전송 불변', async () => {
  const h = harness([incident()]); const before = structuredClone(h.state); h.failApi = true;
  await assert.rejects(() => h.execute()); assert.deepEqual(h.state, before); assert.equal(h.saves, 0); assert.equal(h.sent.length, 0);
});
test('발생 Slack 실패 시 재시도 가능하며 완료 플래그 미저장', async () => {
  const h = harness([incident()]); h.failSlack = true; await assert.rejects(() => h.execute()); assert.equal(h.saves, 0);
  h.failSlack = false; await h.execute(); assert.equal(h.sent.length, 1);
});
test('복구 Slack 실패 시 발생 상태를 유지하고 복구 재시도', async () => {
  const e = incident(); const h = harness([e]); await h.execute();
  e.status = 'resolved'; e.resolvedAt = '2026-10-28T08:30:00Z'; e.updatedAt = e.resolvedAt;
  const before = structuredClone(h.state); h.failSlack = true; await assert.rejects(() => h.execute()); assert.deepEqual(h.state, before);
  h.failSlack = false; await h.execute(); await h.execute(); assert.deepEqual(h.sent.map(x => x.kind), ['outage', 'recovery']);
});
test('목록에서 사라짐/postmortem은 복구 신호 아님', async () => {
  const e = incident(); const h = harness([e]); await h.execute(); h.events.splice(0); await h.execute();
  h.events.push({ ...e, status: 'postmortem', updatedAt: '2026-10-28T08:30:00Z' }); await h.execute(); assert.equal(h.sent.length, 1);
});
test('폴링 사이 발생·해결한 최근 장애: 완료 요약 1회', async () => {
  const h = harness([incident('openai', { status: 'resolved', resolvedAt: '2026-10-28T08:10:00Z', updatedAt: '2026-10-28T08:10:00Z' })]);
  await h.execute(); await h.execute(); assert.deepEqual(h.sent.map(n => n.kind), ['summary']);
  assert.equal(h.state.incidents['openai:test-1']!.outageNotificationSent, false);
});
test('늦은 게시: 시작이 오래되어도 진행 중이면 알림, 오래된 완료 이력은 제외', async () => {
  const h = harness([incident('openai', { createdAt: '2026-10-20T00:00:00Z' }), incident('openai', { id: 'old-closed', createdAt: '2026-10-20T00:00:00Z', status: 'resolved', resolvedAt: '2026-10-20T01:00:00Z' })]);
  await h.execute(); await h.execute(); assert.equal(h.sent.length, 1); assert.equal(h.sent[0]!.kind, 'outage');
});
test('완료 요약의 Slack 실패는 다음 실행에서 재시도', async () => {
  const h = harness([incident('openai', { status: 'resolved', resolvedAt: '2026-10-28T08:10:00Z' })]); h.failSlack = true;
  await assert.rejects(() => h.execute()); h.failSlack = false; await h.execute(); assert.equal(h.sent[0]!.kind, 'summary');
});
test('DRY_RUN은 최초/후속 모두 전송/파일 저장 없음', async () => {
  for (const state of [emptyIncidentState(), ready()]) {
    const h = harness([incident()], state); await h.execute(true); assert.deepEqual(h.state, state); assert.equal(h.saves, 0); assert.equal(h.sent.length, 0);
  }
});
test('같은 API 스냅샷 재검사는 파일 갱신 없음, 오래된 스냅샷은 상태 회귀 안 함', async () => {
  const e = incident(); const h = harness([e]); await h.execute(); const saves = h.saves; await h.execute(); assert.equal(h.saves, saves);
  e.updatedAt = '2026-10-27T12:00:00Z'; await h.execute(); assert.equal(h.saves, saves);
});
test('서로 다른 실제 응답 형태의 합성 fixture 파싱', async () => {
  for (const [file, provider] of [['openai', 'openai'], ['claude', 'anthropic']] as const) {
    const parsed = parseIncidents(JSON.parse(await readFile(`tests/fixtures/${file}-incidents.json`, 'utf8')) as unknown, provider);
    assert.equal(parsed.length, 1); assert.ok(incidentRelevant(parsed[0]!)); assert.ok(parsed[0]!.url.startsWith('https://status.'));
    if (provider === 'openai') assert.deepEqual(parsed[0]!.components, []);
  }
  assert.equal(incidentDate('2026-02-30T00:00:00Z'), false);
});
test('업데이트 affected_components 및 summary의 ID→이름 보완', () => {
  const catalog = parseSummary({ components: [{ id: 'cc', name: 'Claude Code' }] });
  const parsed = parseIncidents({ incidents: [{ id: 'x', name: 'Errors', status: 'monitoring', impact: 'minor', created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:30:00Z', incident_updates: [{ status: 'monitoring', body: 'Checking', created_at: '2026-10-28T08:30:00Z', affected_components: [{ code: 'cc' }] }] }] }, 'anthropic', catalog);
  assert.ok(incidentRelevant(parsed[0]!));
});
test('손상/누락 스키마와 잘못된 JSON 거부', async () => {
  assert.throws(() => parseIncidents({}, 'openai')); assert.throws(() => parseSummary({}));
  await assert.rejects(() => fetchIncidents('openai', { fetcher: (async () => new Response('not-json')) as Fetch }), /JSON/);
  await assert.rejects(() => fetchIncidents('openai', { fetcher: (async () => new Response('{}')) as Fetch }), /배열/);
});
test('Claude summary 장애여도 정상 incidents는 처리 가능', async () => {
  const data = await readFile('tests/fixtures/claude-incidents.json', 'utf8'); const warnings: string[] = [];
  const result = await fetchIncidents('anthropic', { fetcher: (async url => new Response(url === statusUrls.anthropic ? data : '{}')) as Fetch }, s => warnings.push(s));
  assert.equal(result.length, 1); assert.equal(warnings.length, 1); assert.ok(incidentRelevant(result[0]!));
});
test('초기화/OpenAI 오류가 Claude 검사까지 중단하지 않음', async () => {
  const called: string[] = []; const logs: string[] = [];
  await assert.rejects(() => runChecks([
    { name: 'reset', execute: async () => { called.push('reset'); throw new Error('https://secret.test/token'); } },
    { name: 'openai', execute: async () => { called.push('openai'); throw new Error('offline'); } },
    { name: 'anthropic', execute: async () => { called.push('anthropic'); } },
  ], s => logs.push(s)), /reset, openai/);
  assert.deepEqual(called, ['reset', 'openai', 'anthropic']); assert.equal(logs.length, 2); assert.doesNotMatch(logs.join(''), /secret.test/);
});
test('KST/지속 시간 및 안전한 Slack Block Kit, 원문 없는 시작 시각은 추측 안 함', async () => {
  const e = incident('anthropic', { status: 'resolved', startedAt: '2026-10-28T08:00:00Z', resolvedAt: '2026-10-28T08:30:12Z', name: '<!channel> & <@U1>', updates: [{ status: 'resolved', body: '<!everyone>' + '&'.repeat(5000), createdAt: '2026-10-28T08:30:12Z' }] });
  assert.equal(incidentDuration(e), '0시간 30분 12초');
  const message = JSON.stringify(incidentMessage(e, 'recovery')); assert.match(message, /2026.10.28 17:30 KST/); assert.doesNotMatch(message, /<!channel>|<!everyone>|<@U1>/);
  assert.equal(incidentDuration(incident()), '공식 공지 확인 필요');
  await sendIncidentSlack('https://example.com', e, 'recovery', { fetcher: (async () => new Response('ok')) as Fetch });
  await assert.rejects(() => sendIncidentSlack('https://example.com', e, 'recovery', { fetcher: (async () => new Response('bad')) as Fetch }));
});
test('장애 파일 손상/누락 거부, 원자적 저장, 변경 없으면 미갱신', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'incident-test-')); const path = join(dir, 'incidents.json');
  try {
    await assert.rejects(() => readIncidentState(path)); await saveIncidentState(path, ready()); assert.deepEqual(await readIncidentState(path), ready());
    const before = (await stat(path)).mtimeMs; await saveIncidentState(path, ready()); assert.equal((await stat(path)).mtimeMs, before);
    await writeFile(path, '{}'); await assert.rejects(() => readIncidentState(path));
    assert.throws(() => validateIncidentState({ ...ready(), incidents: { broken: {} } }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
