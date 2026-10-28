import { request, type HttpOptions } from './http.js';
import type { Component, Incident, IncidentProvider, IncidentStatus, IncidentUpdate } from '../types/incident.js';
import { incidentStatuses } from '../types/incident.js';

export const statusUrls = {
  openai: 'https://status.openai.com/api/v2/incidents.json',
  anthropic: 'https://status.claude.com/api/v2/incidents.json',
} as const;
export const claudeSummaryUrl = 'https://status.claude.com/api/v2/summary.json';
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function text(v: unknown): string {
  if (typeof v !== 'string') throw new Error('장애 API 문자열 필드 오류');
  return v;
}
export function incidentDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  // Check calendar validity as Date.parse normalizes e.g. February 30.
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return d.toISOString().slice(0, 10) === v.slice(0, 10);
}
function date(v: unknown): string {
  if (!incidentDate(v)) throw new Error('장애 API 시각 필드 오류');
  return v;
}
export function parseComponents(value: unknown): Component[] {
  if (!Array.isArray(value)) throw new Error('장애 API components 배열 오류');
  return value.map(c => {
    if (typeof c === 'string') return { id: c, name: '' };
    if (!obj(c)) throw new Error('장애 API 구성요소 오류');
    return { id: text(c.id ?? c.code), name: c.name === undefined ? '' : text(c.name) };
  });
}
export function parseSummary(data: unknown): Component[] {
  if (!obj(data)) throw new Error('장애 summary 스키마 오류');
  return parseComponents(data.components);
}
export function parseIncidents(data: unknown, provider: IncidentProvider, catalog: Component[] = []): Incident[] {
  if (!obj(data) || !Array.isArray(data.incidents)) throw new Error('장애 incidents 배열 누락');
  const seen = new Set<string>();
  return data.incidents.map(value => {
    if (!obj(value)) throw new Error('장애 API 사건 객체 오류');
    const id = text(value.id);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || seen.has(id)) throw new Error('장애 API ID 오류/중복');
    seen.add(id);
    const status = text(value.status);
    if (!(incidentStatuses as readonly string[]).includes(status)) throw new Error('지원하지 않는 장애 상태');
    if (!Array.isArray(value.incident_updates)) throw new Error('장애 API incident_updates 배열 누락');
    const components = value.components == null ? [] : parseComponents(value.components);
    const updates: IncidentUpdate[] = value.incident_updates.map(u => {
      if (!obj(u)) throw new Error('장애 API 업데이트 오류');
      if (u.affected_components != null) components.push(...parseComponents(u.affected_components));
      return { status: text(u.status), body: text(u.body), createdAt: date(u.created_at), ...(u.display_at != null ? { displayAt: date(u.display_at) } : {}) };
    });
    const createdAt = date(value.created_at);
    const updatedAt = date(value.updated_at);
    const resolvedUpdate = updates.filter(u => u.status === 'resolved').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const resolvedAt = value.resolved_at == null ? resolvedUpdate?.displayAt ?? resolvedUpdate?.createdAt : date(value.resolved_at);
    const startedAt = value.started_at == null ? undefined : date(value.started_at);
    return {
      provider, id, name: text(value.name), status: status as IncidentStatus, impact: text(value.impact), createdAt, updatedAt,
      ...(startedAt ? { startedAt } : {}), ...(resolvedAt ? { resolvedAt } : {}), updates,
      components: components.map(c => ({ ...c, name: c.name || catalog.find(x => x.id === c.id)?.name || '' })),
      url: `https://${provider === 'openai' ? 'status.openai.com' : 'status.claude.com'}/incidents/${id}`,
    };
  });
}
async function json(url: string, options: HttpOptions): Promise<unknown> {
  const body = await request(url, { headers: { accept: 'application/json', 'user-agent': 'ai-reset-notifier/1.0' } }, options);
  try { return JSON.parse(body) as unknown; } catch { throw new Error('장애 API JSON 파싱 실패'); }
}
export async function fetchIncidents(provider: IncidentProvider, options: HttpOptions = {}, warn: (s: string) => void = console.warn): Promise<Incident[]> {
  if (provider === 'openai') return parseIncidents(await json(statusUrls.openai, options), provider);
  const [incidents, summary] = await Promise.allSettled([json(statusUrls.anthropic, options), json(claudeSummaryUrl, options).then(parseSummary)]);
  if (incidents.status === 'rejected') throw new Error('Claude 장애 API 수집 실패');
  // Summary only enriches IDs. Do not block incidents with explicit component names/text.
  if (summary.status === 'rejected') warn('Claude summary 확인 실패: 사건 자체의 구성요소/본문으로 판단합니다.');
  return parseIncidents(incidents.value, provider, summary.status === 'fulfilled' ? summary.value : []);
}
