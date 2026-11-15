export type WinrmAuthType = 'ntlm' | 'pth' | 'kerberos' | 'basic';

export interface WinrmProfileSummary {
  id: string;
  engagementId?: string;
  hostId?: string;
  name: string;
  host: string;
  port: number;
  useTls: boolean;
  insecureSkipVerify?: boolean;
  authType: WinrmAuthType | string;
  domain?: string;
  username?: string;
  hasPassword: boolean;
  hasNtHash: boolean;
  identityId?: string;
  credentialId?: string;
  socksProxyAddr?: string;
  timeoutSec?: number;
  notes?: string;
  createdAt?: string;
}

export interface WinrmProfilePayload {
  id: string;
  engagementId?: string;
  hostId?: string;
  name: string;
  host: string;
  port: number;
  useTls: boolean;
  insecureSkipVerify?: boolean;
  authType: WinrmAuthType | string;
  domain?: string;
  username?: string;
  password?: string;
  ntHash?: string;
  identityId?: string;
  credentialId?: string;
  socksProxyAddr?: string;
  timeoutSec?: number;
  notes?: string;
}

export interface WinrmConnectRequest {
  profileId?: string;
  hostId?: string;
  engagementId?: string;
  name?: string;
  host: string;
  port?: number;
  useTls: boolean;
  insecureSkipVerify?: boolean;
  authType: WinrmAuthType | string;
  domain?: string;
  username?: string;
  password?: string;
  ntHash?: string;
  identityId?: string;
  credentialId?: string;
  socksProxyAddr?: string;
  timeoutSec?: number;
}

export interface WinrmSessionInfo {
  sessionId: string;
  profileId?: string;
  hostId?: string;
  name: string;
  host: string;
  port: number;
  useTls: boolean;
  authType: string;
  domain?: string;
  username: string;
  shellId?: string;
  currentDir?: string;
  status: string;
  backendMode: string;
  socksProxy?: string;
  opsecWarnings?: string[];
  connectedAt: string;
  commandCount: number;
  errorMsg?: string;
}

export interface WinrmExecResult {
  sessionId: string;
  shellId?: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface WinrmTransferResult {
  sessionId: string;
  direction: 'upload' | 'download' | string;
  localPath: string;
  remotePath: string;
  bytes: number;
  sha256?: string;
  durationMs: number;
}

export interface WinrmToolStatus {
  tool: string;
  found: boolean;
  path?: string;
}

export interface WinrmHostCandidate {
  id: string;
  label: string;
  address: string;
}

export interface WinrmCredentialCandidate {
  id: string;
  label: string;
  username: string;
  realm?: string;
  category: string;
}

export interface WinrmIdentityCandidate {
  id: string;
  label: string;
  username: string;
}
