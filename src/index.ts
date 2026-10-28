import { resolve } from 'node:path';
import { config } from './config.js';
import { fetchEvents } from './services/reset-api.js';
import { lockState, readState, saveState } from './services/state-store.js';
import { sendSlack, sendIncidentSlack } from './services/slack.js';
import { run } from './runner.js';
import { fetchIncidents } from './services/status-api.js';
import { readIncidentState, saveIncidentState } from './services/incident-state.js';
import { runIncidents } from './services/incident-detector.js';
import { runChecks, safeError } from './checks.js';
async function main(): Promise<void> {
  const cfg = config();
  const path = resolve('state/seen-events.json');
  const incidentPath = resolve('state/incident-events.json');
  const unlock = await lockState(path);
  try {
    await runChecks([
      { name: '특별 초기화', execute: () => run(cfg, { fetchEvents: () => fetchEvents(cfg.apiUrl), load: () => readState(path), save: state => saveState(path, state), send: (event, now) => sendSlack(cfg.webhookUrl!, event, now), log: console.log, now: () => new Date() }) },
      ...(['openai', 'anthropic'] as const).map(provider => ({ name: `${provider} 장애`, execute: () => runIncidents(provider, cfg.dryRun, {
        load: () => readIncidentState(incidentPath), fetch: () => fetchIncidents(provider), save: state => saveIncidentState(incidentPath, state),
        send: (incident, kind) => sendIncidentSlack(cfg.webhookUrl!, incident, kind), now: () => new Date(), log: console.log,
      }) })),
    ], console.error);
  } finally { await unlock(); }
}
main().catch(error => {
  // All application errors are sanitized; never print native fetch errors (may contain secrets).
  console.error(`실행 실패: ${safeError(error)}`);
  process.exitCode = 1;
});
