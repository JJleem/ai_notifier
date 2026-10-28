import type { Incident, IncidentNotification, IncidentProvider, IncidentRecord, IncidentState } from '../types/incident.js';

function mentioned(text: string, provider: IncidentProvider): boolean {
  const target = provider === 'openai' ? '\\bcodex\\b' : '\\bclaude[ -]+code\\b';
  const negative = new RegExp(`(?:${target}[^.!?\\n]{0,45}(?:not affected|unaffected|not impacted|operational|no impact)|(?:does not affect|not affecting|no impact (?:on|to))[^.!?\\n]{0,35}${target})`, 'i');
  // Conservative: an explicit non-impact statement never becomes positive evidence.
  return text.split(/[.!?\n]+/).some(sentence => new RegExp(target, 'i').test(sentence) && !negative.test(sentence));
}
export function incidentRelevant(incident: Incident): boolean {
  const component = incident.components.some(c => incident.provider === 'openai' ? /\bcodex\b/i.test(c.name) : /^claude[ -]+code(?:\b|$)/i.test(c.name));
  if (component) return true;
  return mentioned(incident.name, incident.provider) || incident.updates.some(u => mentioned(u.body, incident.provider));
}
const terminal = (s: string) => s === 'resolved' || s === 'postmortem';
const keyOf = (i: Incident) => `${i.provider}:${i.id}`;
export interface IncidentDependencies {
  load: () => Promise<IncidentState>;
  fetch: () => Promise<Incident[]>;
  save: (state: IncidentState) => Promise<void>;
  send: (incident: Incident, kind: IncidentNotification) => Promise<void>;
  now: () => Date;
  log: (s: string) => void;
}
export async function runIncidents(provider: IncidentProvider, dryRun: boolean, deps: IncidentDependencies): Promise<void> {
  let state = await deps.load();
  const events = await deps.fetch();
  if (events.some(i => i.provider !== provider)) throw new Error('장애 provider 불일치');
  const now = deps.now();
  const time = now.toISOString();
  const initializing = state.initializedAt[provider] === null;
  if (initializing) state = { ...state, initializedAt: { ...state.initializedAt, [provider]: time } };
  let changed = initializing;
  for (const incident of [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))) {
    const key = keyOf(incident);
    const prior = state.incidents[key];
    if (!prior && !incidentRelevant(incident)) continue;
    if (Date.parse(incident.updatedAt) > now.getTime() || Date.parse(incident.createdAt) > now.getTime()) continue;
    if (prior && Date.parse(incident.updatedAt) < Date.parse(prior.sourceUpdatedAt)) continue;
    const recentCompleted = incident.status === 'resolved' && !!incident.resolvedAt &&
      Date.parse(incident.startedAt ?? incident.createdAt) >= now.getTime() - 86400_000 &&
      Date.parse(incident.resolvedAt) > Date.parse(state.initializedAt[provider]!) && Date.parse(incident.resolvedAt) <= now.getTime();
    const record: IncidentRecord = prior ? { ...prior } : {
      provider, incidentId: incident.id, originalStatus: incident.status, lastKnownStatus: incident.status,
      firstDetectedAt: time, lastCheckedAt: time, sourceUpdatedAt: incident.updatedAt,
      outageNotificationSent: false, recoveryNotificationSent: false,
      suppressOutage: initializing || terminal(incident.status),
      suppressRecovery: initializing ? terminal(incident.status) : terminal(incident.status) && !recentCompleted,
    };
    let kind: IncidentNotification | undefined;
    if (!initializing && incident.status === 'resolved' && !record.recoveryNotificationSent && !record.suppressRecovery) {
      kind = record.suppressOutage && !record.outageNotificationSent && record.originalStatus === 'resolved' ? 'summary' : 'recovery';
    } else if (!initializing && !terminal(incident.status) && !record.suppressOutage && !record.outageNotificationSent && !record.recoveryNotificationSent) kind = 'outage';
    if (kind) {
      // Persist flags only after Slack succeeds; a failure can be retried next run.
      if (!dryRun) await deps.send(incident, kind);
      if (kind === 'outage') record.outageNotificationSent = true;
      else record.recoveryNotificationSent = true;
      deps.log(`${dryRun ? '전송 예정' : '전송 완료'}: ${provider} ${incident.id} ${kind}`);
    }
    // Avoid a Git commit every 15 minutes when the source hasn't changed.
    if (!prior || kind || prior.sourceUpdatedAt !== incident.updatedAt || prior.lastKnownStatus !== incident.status) {
      record.lastKnownStatus = incident.status;
      record.sourceUpdatedAt = incident.updatedAt;
      record.lastCheckedAt = time;
      state = { ...state, incidents: { ...state.incidents, [key]: record } };
      changed = true;
      // Initial baselines must be one atomic snapshot: a partial baseline could
      // make the remaining pre-existing incidents look new on the next run.
      if (!initializing) {
        if (!dryRun) await deps.save(state);
        changed = false;
      }
    }
  }
  if (changed && !dryRun) await deps.save(state);
  deps.log(`${provider} 장애 검사 완료${initializing ? ' (최초 기준 등록, 알림 없음)' : ''}${dryRun ? ' (DRY_RUN: 전송/저장 없음)' : ''}`);
}
