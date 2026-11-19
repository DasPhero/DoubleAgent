export interface RemoteDirEntry {
  name: string;
  relPath: string;
  fullPath: string;
  size: number;
  isDir: boolean;
  modTime: string;
  sha256?: string;
  md5?: string;
}

export interface RemoteAgentInfo {
  sessionId: string;
  label: string;
  hostname: string;
  os: string;
  arch: string;
  homeDir: string;
  defaultShell: string;
  stagingDir: string;
  primaryIp?: string;
  connectedAt: string;
  active: boolean;
}

export interface RemoteExecutionContext {
  mode: 'local' | 'agent';
  activeSessionId?: string;
  activeAgent?: RemoteAgentInfo | null;
  attachedAgents: RemoteAgentInfo[];
}

export interface RemoteDirListing {
  path: string;
  parent: string;
  entries: RemoteDirEntry[];
}

export interface AttachableSshSession {
  sessionId: string;
  label: string;
}
