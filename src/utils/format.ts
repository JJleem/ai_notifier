import type { ResetEvent } from '../types/reset.js';
export const unknown = '공식 공지 확인 필요';
export function safeText(s: string, max = 800): string {
  return s.slice(0, max).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, max);
}
// Scope is a dataset summary, not an independently verified official quotation.
export function audience(e: ResetEvent): string {
  if (!e.scope) return unknown;
  const known: Record<string, string> = { all: '전체 사용자', 'paid plans': '유료 플랜', 'affected users': '문제의 영향을 받은 사용자' };
  return known[e.scope] ?? e.scope;
}
export function summary(e: ResetEvent): string {
  return e.resetType === 'banked' ? '사용자가 직접 적용할 수 있는 초기화권 지급 공지입니다. 상세 조건은 공식 원문을 확인하세요.' : '운영사의 특별 사용량 초기화 공지입니다. 적용 범위와 조건은 공식 원문을 확인하세요.';
}
export function resetScope(e: ResetEvent): string {
  // Only explicit reset clauses. Do not mistake a promotional limit increase for a reset scope.
  const note = e.note ?? '';
  if (/reset\s+(?:(?:everyone's|all\s+users'?|both)\s+)?5[- ]hour\s+and\s+weekly\s+(?:rate\s+|usage\s+)?limits/i.test(note)) return '5시간 및 주간 한도 (제공처 요약 기준)';
  if (/reset\s+weekly\s+(?:rate\s+|usage\s+)?limits/i.test(note)) return '주간 한도 (제공처 요약 기준)';
  return unknown;
}
