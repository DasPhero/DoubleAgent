export type RouteCheckMode = 'local_only' | 'throttled_tcp';

export interface RouteCheckRequest {
  routeIds?: string[];
  engagementId?: string;
  checkMode: RouteCheckMode;
  socksProxyAddr?: string;
  customTargets?: string[];
  throttleMs: number;
  timeoutMs: number;
  confirmActiveTraffic?: boolean;
}

export interface ProbeTargetResult {
  routeId?: string;
  routeName?: string;
  routeKind?: string;
  target: string;
  viaProxy?: string;
  status: 'healthy' | 'refused' | 'timeout' | 'error' | 'skipped' | string;
  reachable: boolean;
  latencyMs: number;
  detail: string;
  checkedAt: string;
}

export interface RouteHealthEntry {
  id: string;
  sourceType: 'pivot' | 'ssh-tunnel' | 'forward-rule' | 'proxy-profile' | 'shell-listener' | 'transfer-server' | 'custom' | string;
  name: string;
  kind: string;
  bindEndpoint?: string;
  targetEndpoint?: string;
  subnets?: string[];
  hops?: string[];
  status: 'healthy' | 'degraded' | 'down' | 'idle' | 'error' | string;
  runtimeState: 'running' | 'active' | 'listening' | 'stopped' | 'configured' | 'error' | string;
  metaSummary?: string;
  ligoloAgents?: string[];
  bytesTransferred?: number;
  errorMsg?: string;
  probes?: ProbeTargetResult[];
  lastCheck: string;
}

export interface RouteHealthReport {
  reportId: string;
  checkedAt: string;
  checkMode: RouteCheckMode | string;
  socksProxyAddr?: string;
  throttleMs: number;
  timeoutMs: number;
  totalRoutes: number;
  healthyRoutes: number;
  degradedRoutes: number;
  downRoutes: number;
  probesExecuted: number;
  probesSucceeded: number;
  durationMs: number;
  entries: RouteHealthEntry[];
  opsecWarnings?: string[];
}

export interface SocksCandidateOption {
  label: string;
  addr: string;
}
