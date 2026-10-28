import type { ResetEvent, Verification } from '../types/reset.js';
import { request, type HttpOptions } from './http.js';
function object(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
export function validDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && new Date(t).toISOString() === v.replace(/Z$/, v.includes('.') ? 'Z' : '.000Z');
}
export function canonicalSource(value: string): string | undefined {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return;
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(u.hostname)) {
      const match = /^\/[A-Za-z0-9_]+\/status\/(\d+)\/?$/.exec(u.pathname);
      if (match) return `https://x.com/i/status/${match[1]}`;
      return;
    }
    // Only official announcement hosts; other third-party pages are not evidence.
    if (!['openai.com', 'www.anthropic.com', 'anthropic.com', 'claude.com', 'www.claude.com', 'developers.openai.com'].includes(u.hostname)) return;
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch { return; }
}
export function parseCatalog(data: unknown): ResetEvent[] {
  if (!object(data) || !object(data.providers)) throw new Error('API providers 스키마 오류');
  const events: ResetEvent[] = [];
  for (const provider of ['claude', 'codex'] as const) {
    const entry = data.providers[provider];
    if (!object(entry) || !Array.isArray(entry.events)) throw new Error(`API ${provider}.events 배열 누락`);
    for (const row of entry.events) {
      if (!object(row) || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(row.id) || !validDate(row.date) || typeof row.kind !== 'string') throw new Error('API 이벤트 필수 필드 오류');
      for (const field of ['scope', 'note', 'url', 'account', 'verification'] as const) {
        if (row[field] !== undefined && typeof row[field] !== 'string') throw new Error('API 이벤트 문자열 필드 오류');
      }
      if (row.resetType !== undefined && row.resetType !== 'regular' && row.resetType !== 'banked') throw new Error('API resetType 오류');
      if (row.usableUntil !== undefined && !validDate(row.usableUntil)) throw new Error('API usableUntil 오류');
      const verification: Verification = ['curated', 'provisional', 'upstream'].includes(String(row.verification)) ? row.verification as Verification : 'unknown';
      events.push({ provider, id: row.id, date: row.date, kind: row.kind, resetType: row.resetType === 'banked' ? 'banked' : 'regular', verification,
        ...(typeof row.scope === 'string' ? { scope: row.scope } : {}), ...(typeof row.note === 'string' ? { note: row.note } : {}),
        ...(typeof row.url === 'string' ? { url: row.url } : {}), ...(typeof row.usableUntil === 'string' ? { usableUntil: row.usableUntil } : {}) });
    }
  }
  return events;
}
export async function fetchEvents(url: string, options: HttpOptions = {}): Promise<ResetEvent[]> {
  const body = await request(url, { headers: { accept: 'application/json', 'user-agent': 'ai-reset-notifier/1.0' } }, options);
  let json: unknown;
  try { json = JSON.parse(body); } catch { throw new Error('API JSON 파싱 실패'); }
  return parseCatalog(json);
}
