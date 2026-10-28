export type IncidentProvider = 'openai' | 'anthropic';
export const incidentStatuses = ['investigating', 'identified', 'monitoring', 'resolved', 'postmortem'] as const;
export type IncidentStatus = typeof incidentStatuses[number];
export interface Component { id: string; name: string }
export interface IncidentUpdate { status: string; body: string; createdAt: string; displayAt?: string }
export interface Incident {
  provider: IncidentProvider;
  id: string;
  name: string;
  status: IncidentStatus;
  impact: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  resolvedAt?: string;
  updates: IncidentUpdate[];
  components: Component[];
  url: string;
}
export type IncidentNotification = 'outage' | 'recovery' | 'summary';
export interface IncidentRecord {
  provider: IncidentProvider;
  incidentId: string;
  originalStatus: IncidentStatus;
  lastKnownStatus: IncidentStatus;
  firstDetectedAt: string;
  lastCheckedAt: string;
  sourceUpdatedAt: string;
  outageNotificationSent: boolean;
  recoveryNotificationSent: boolean;
  suppressOutage: boolean;
  suppressRecovery: boolean;
}
export interface IncidentState {
  version: 1;
  initializedAt: Record<IncidentProvider, string | null>;
  incidents: Record<string, IncidentRecord>;
}
