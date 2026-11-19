export interface RemoteSocketEntry {
  proto: string;
  state: string;
  localAddress: string;
  localPort: number;
  remoteAddress?: string;
  process?: string;
  pid?: string;
  isLoopback: boolean;
  platform?: string;
}

export interface RemoteSocketScanResult {
  sessionId: string;
  platform: string;
  commandUsed: string;
  entries: RemoteSocketEntry[];
  rawOutput?: string;
  error?: string;
}

export interface QuickForwardResult {
  tunnelId: string;
  ruleId?: string;
  localAddr: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
  savedRule: boolean;
}
