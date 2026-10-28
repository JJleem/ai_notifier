import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IncidentState } from '../types/incident.js';
import { incidentStatuses } from '../types/incident.js';
import { incidentDate } from './status-api.js';
export const emptyIncidentState = (): IncidentState => ({ version: 1, initializedAt: { openai: null, anthropic: null }, incidents: {} });
export function validateIncidentState(value: unknown): IncidentState {
  const s = value as IncidentState;
  if (!s || s.version !== 1 || !s.initializedAt || !s.incidents || typeof s.incidents !== 'object' || Array.isArray(s.incidents) ||
    ![s.initializedAt.openai, s.initializedAt.anthropic].every(d => d === null || incidentDate(d))) throw new Error('장애 상태 스키마 손상');
  for (const [key, r] of Object.entries(s.incidents)) {
    if (!r || !['openai', 'anthropic'].includes(r.provider) || typeof r.incidentId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(r.incidentId) || key !== `${r.provider}:${r.incidentId}` ||
      !incidentStatuses.includes(r.originalStatus) || !incidentStatuses.includes(r.lastKnownStatus) ||
      ![r.firstDetectedAt, r.lastCheckedAt, r.sourceUpdatedAt].every(incidentDate) ||
      ![r.outageNotificationSent, r.recoveryNotificationSent, r.suppressOutage, r.suppressRecovery].every(v => typeof v === 'boolean') || s.initializedAt[r.provider] === null) throw new Error('장애 상태 레코드 손상');
  }
  return s;
}
export async function readIncidentState(path: string): Promise<IncidentState> {
  try { return validateIncidentState(JSON.parse(await readFile(path, 'utf8')) as unknown); }
  catch { throw new Error('장애 상태 파일 손상/누락: Git 이력 또는 체크포인트로 복구하세요.'); }
}
export async function saveIncidentState(path: string, state: IncidentState): Promise<void> {
  validateIncidentState(state);
  const content = JSON.stringify(state, null, 2) + '\n';
  if (await readFile(path, 'utf8').catch(() => '') === content) return;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
}
