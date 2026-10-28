import type { ResetEvent } from '../types/reset.js';
import { audience, resetScope, safeText, summary, unknown } from '../utils/format.js';
import { kst, remaining } from '../utils/date.js';
import { request, type HttpOptions } from './http.js';
import type { Incident, IncidentNotification } from '../types/incident.js';
import { incidentMessage } from '../utils/incident-format.js';
export function slackMessage(e: ResetEvent, now: Date = new Date()) {
  const codex = e.provider === 'codex';
  const banked = e.resetType === 'banked';
  const title = `${codex ? 'Codex' : 'Claude Code'} ${banked ? '초기화권 지급' : '사용량 초기화 공지'}!`;
  const fields = [
    `서비스: ${codex ? 'OpenAI Codex' : 'Claude Code'}`,
    `대상 플랜/사용자 (제공처 분류): ${audience(e)}`,
    `초기화 유형: ${banked ? '보관형 초기화권' : '일반 특별 초기화'}`,
    `초기화 범위: ${resetScope(e)}`,
    `발표 시각: ${kst(e.date)}`,
    `검증 상태 (제공처 기준): ${e.verification === 'curated' ? '카탈로그 등재' : e.verification === 'provisional' ? '잠정 이벤트' : '상위 제공처 분류'}`,
  ];
  if (banked) fields.push('적용 방식: 사용자가 직접 적용', `사용 기한: ${e.usableUntil ? kst(e.usableUntil) : unknown}`, ...(e.usableUntil ? [`남은 기간: ${remaining(e.usableUntil, now)} (알림 생성 시점)`] : []), '주의: 공식 조건을 확인하고 기한 전에 적용 필요');
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${codex ? '🟢' : '🟠'} ${title}` } },
    ...Array.from({ length: Math.ceil(fields.length / 10) }, (_, i) => ({ type: 'section', fields: fields.slice(i * 10, (i + 1) * 10).map(text => ({ type: 'plain_text', text: safeText(text, 1800) })) })),
    { type: 'section', text: { type: 'plain_text', text: `핵심 내용: ${summary(e)}` } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '공식 공지 확인' }, url: e.url! }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `데이터 출처: <https://claude-resets.com/|Claude Resets> · <https://creativecommons.org/licenses/by/4.0/|CC BY 4.0>${codex ? ' · Codex 원천: <https://codex-resets.com/|Codex Resets>' : ''} · 한국어 안내는 봇의 규칙 기반 요약` }] },
  ];
  return { text: title, unfurl_links: false, unfurl_media: false, attachments: [{ color: codex ? '#10a37f' : '#d97757', blocks }] };
}
export async function sendSlack(url: string, event: ResetEvent, now: Date, options: HttpOptions = {}): Promise<void> {
  const body = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(slackMessage(event, now)) }, options);
  if (body.trim() !== 'ok') throw new Error('Slack 성공 응답 확인 실패');
}
export async function sendIncidentSlack(url: string, incident: Incident, kind: IncidentNotification, options: HttpOptions = {}): Promise<void> {
  const body = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(incidentMessage(incident, kind)) }, options);
  if (body.trim() !== 'ok') throw new Error('Slack 장애 알림 성공 응답 확인 실패');
}
