export type ForwardRuleType = 'L' | 'R' | 'D';

export interface ForwardRule {
  id: string;
  hostId?: string;
  type: ForwardRuleType;
  bindAddress: string;
  bindPort: number;
  targetHost?: string;
  targetPort?: number;
  autoStart: boolean;
  label?: string;
}

export interface ForwardTunnelStatus {
  id: string;
  ruleId: string;
  sessionId: string;
  hostId?: string;
  type: ForwardRuleType;
  bindAddress: string;
  bindPort: number;
  targetHost?: string;
  targetPort?: number;
  status: 'active' | 'error' | 'closed';
  bytesIn: number;
  bytesOut: number;
  activeConns: number;
  errorMessage?: string;
}
