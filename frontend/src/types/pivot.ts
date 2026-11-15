export type PivotTool = 'ligolo-ng' | 'chisel';

export interface NetworkRoute {
  id: string;
  engagementId?: string;
  name: string;
  kind: string;
  tool: string;
  bindAddress: string;
  listenPort: number;
  socksPort?: number;
  interfaceName?: string;
  subnets?: string[];
  hops?: string[];
  remoteSpecs?: string[];
  reverse: boolean;
  selfCert: boolean;
  ignoreCert: boolean;
  binaryPath?: string;
  extraArgs?: string;
  status?: string;
  lastCheck?: string;
  notes?: string;
  createdAt?: string;
}

export interface PivotInstanceInfo {
  id: string;
  routeId?: string;
  engagementId?: string;
  name: string;
  tool: string;
  bindAddress: string;
  listenPort: number;
  socksPort?: number;
  interfaceName?: string;
  subnets?: string[];
  status: 'running' | 'stopped' | 'error' | string;
  pid?: number;
  binaryPath?: string;
  startedAt?: string;
  stoppedAt?: string;
  errorMsg?: string;
  commandPreview: string;
  opsecWarnings?: string[];
  recentLogs?: string[];
  connectedAgents?: string[];
}

export interface PivotBinaryStatus {
  tool: string;
  found: boolean;
  binaryName: string;
  path?: string;
}

export interface PivotCommandSet {
  tool: string;
  lhost: string;
  proxyCommand: string;
  setupCommands?: string[];
  routeCommands?: string[];
  consoleCommands?: string[];
  linuxAgentCmd: string;
  windowsAgentCmd: string;
  proxychainsLine?: string;
  opsecWarnings?: string[];
}
