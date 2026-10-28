import type { Incident, IncidentNotification, IncidentStatus } from '../types/incident.js';
import { kst } from './date.js';
import { safeText, unknown } from './format.js';

export const statusLabel: Record<IncidentStatus, string> = {
  investigating: '조사 중', identified: '원인 파악', monitoring: '복구 확인 중', resolved: '해결됨', postmortem: '사후 분석',
};
export function incidentDuration(i: Incident): string {
  if (!i.startedAt || !i.resolvedAt) return unknown;
  const seconds = Math.floor((Date.parse(i.resolvedAt) - Date.parse(i.startedAt)) / 1000);
  if (seconds < 0) return unknown;
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor(seconds % 3600 / 60)}분 ${seconds % 60}초`;
}
export function incidentMessage(i: Incident, kind: IncidentNotification) {
  const service = i.provider === 'openai' ? 'Codex' : 'Claude Code';
  const title = `${kind === 'outage' ? '🚨' : '✅'} ${service} ${kind === 'outage' ? '서비스 장애 발생' : kind === 'summary' ? '장애 완료 요약' : '서비스 정상화'}`;
  const impact: Record<string, string> = { none: '없음', minor: '경미', major: '중대', critical: '심각', maintenance: '유지보수' };
  const fields = [`서비스: ${service}`, `상태: ${statusLabel[i.status]}`, `심각도: ${impact[i.impact] ?? i.impact} (공식 impact)`];
  if (kind === 'outage') fields.push(`${i.startedAt ? '발생 시각' : '사건 등록 시각'}: ${kst(i.startedAt ?? i.createdAt)}`);
  else fields.push(`장애 시작: ${i.startedAt ? kst(i.startedAt) : unknown}`, `사건 등록: ${kst(i.createdAt)}`, `복구 시각: ${i.resolvedAt ? kst(i.resolvedAt) : unknown}`, `장애 지속 시간: ${incidentDuration(i)}`);
  const update = [...i.updates].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const body = update.find(u => u.status === i.status)?.body ?? update[0]?.body;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: title } },
    { type: 'section', fields: fields.map(text => ({ type: 'plain_text', text: safeText(text, 1800) })) },
    { type: 'section', text: { type: 'plain_text', text: safeText(`공식 사건명: ${i.name}`, 1000) } },
    { type: 'section', text: { type: 'plain_text', text: safeText(`영향/진행 상황 (공식 원문): ${body || unknown}`, 2500) } },
    ...(kind === 'summary' ? [{ type: 'context', elements: [{ type: 'plain_text', text: '폴링 사이 발생·해결되었거나 늦게 공개되어 해결 상태로 처음 확인한 사건입니다. 발생 알림은 별도로 보내지 않습니다.' }] }] : []),
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '공식 장애 상세 확인' }, url: i.url }] },
    { type: 'context', elements: [{ type: 'plain_text', text: '출처: 운영사 공식 상태 페이지 · 표시 시간: Asia/Seoul · 등록 시각은 실제 장애 시작 시각과 다를 수 있습니다.' }] },
  ];
  return { text: title, unfurl_links: false, unfurl_media: false, attachments: [{ color: kind === 'outage' ? '#d72c2c' : '#2eb67d', blocks }] };
}
