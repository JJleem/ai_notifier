export type Provider = 'claude' | 'codex';
export type Verification = 'curated' | 'upstream' | 'provisional' | 'unknown';
export interface ResetEvent {
  provider: Provider;
  id: string;
  date: string;
  kind: string;
  resetType: 'regular' | 'banked';
  usableUntil?: string;
  scope?: string;
  note?: string;
  url?: string;
  verification: Verification;
}
export interface State {
  version: 1;
  initializedAt: string | null;
  seenIds: string[];
  seenSources: string[];
}
