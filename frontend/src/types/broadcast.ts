export type BroadcastScope = 'tab' | 'all' | 'custom';

export interface BroadcastState {
  enabled: boolean;
  scope: BroadcastScope;
  customSessionIds: string[];
}
