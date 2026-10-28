import type { Config } from '../config.js';
import type { ResetEvent, State } from '../types/reset.js';
import { canonicalSource } from './reset-api.js';
export const eventKey = (e: ResetEvent): string => `${e.provider}:${e.id}`;
export const sourceKey = (e: ResetEvent): string | undefined => e.url ? canonicalSource(e.url) : undefined;
export function remember(state: State, event: ResetEvent): State {
  const source = sourceKey(event);
  return { ...state, seenIds: [...new Set([...state.seenIds, eventKey(event)])], seenSources: [...new Set([...state.seenSources, ...(source ? [source] : [])])] };
}
export function eligible(e: ResetEvent, state: State, cfg: Pick<Config, 'allowProvisional' | 'allowUpstream'>, now: Date): boolean {
  const date = Date.parse(e.date);
  return e.kind === 'reset' && !!sourceKey(e) &&
    (e.verification === 'curated' || (cfg.allowProvisional && e.verification === 'provisional') || (cfg.allowUpstream && e.verification === 'upstream')) &&
    !state.seenIds.includes(eventKey(e)) && !state.seenSources.includes(sourceKey(e)!) &&
    // Immutable installation cutoff plus a 7-day lookback blocks historical backfills.
    date > Date.parse(state.initializedAt!) && date <= now.getTime() && date >= now.getTime() - 7 * 86400_000 &&
    !(e.resetType === 'banked' && e.usableUntil && Date.parse(e.usableUntil) <= now.getTime());
}
