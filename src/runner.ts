import type { Config } from './config.js';
import type { ResetEvent, State } from './types/reset.js';
import { eligible, remember } from './services/event-detector.js';
export interface Dependencies {
  fetchEvents: () => Promise<ResetEvent[]>;
  load: () => Promise<State>;
  save: (state: State) => Promise<void>;
  send: (event: ResetEvent, now: Date) => Promise<void>;
  log: (message: string) => void;
  now: () => Date;
}
export async function run(cfg: Config, deps: Dependencies): Promise<void> {
  let state = await deps.load();
  const events = await deps.fetchEvents(); // Failure leaves the original state intact.
  const now = deps.now();
  if (state.initializedAt === null) {
    state = { ...state, initializedAt: now.toISOString() };
    for (const event of events) state = remember(state, event);
    if (!cfg.dryRun) await deps.save(state);
    deps.log(`최초 기준 등록: ${events.length}건. Slack 전송 없음${cfg.dryRun ? ' (DRY_RUN: 저장 생략)' : ''}`);
    return;
  }
  const sorted = [...events].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id));
  let sent = 0;
  for (const event of sorted) {
    if (!eligible(event, state, cfg, now)) continue;
    if (!cfg.dryRun) await deps.send(event, now);
    state = remember(state, event);
    if (!cfg.dryRun) await deps.save(state); // Checkpoint every successful send, even if a later event fails.
    deps.log(`${cfg.dryRun ? '전송 예정' : '전송 완료'}: ${event.provider} ${event.id}`);
    sent++;
  }
  deps.log(`처리 완료: ${sent}건${cfg.dryRun ? ' (DRY_RUN: Slack/상태 변경 없음)' : ''}`);
}
