import { RawTcpSessionStats } from './rawTcp';

export type ListenerTool = 'builtin' | 'raw-tcp' | 'nc' | 'netcat' | 'rlwrap' | 'ncat-ssl' | 'ncat' | 'socat';
export type ListenerKind = 'reverse' | 'bind';

export interface ListenerProfile {
  id: string;
  name: string;
  kind: ListenerKind | string;
  tool: ListenerTool | string;
  bindAddress: string;
  bindPort: number;
  autoSpawnTab: boolean;
  options?: Record<string, string>;
  notes?: string;
  createdAt?: string;
}

export interface ManagedListenerInfo {
  id: string;
  profileId?: string;
  name: string;
  kind: ListenerKind | string;
  tool: ListenerTool | string;
  bindAddress: string;
  bindPort: number;
  status: 'listening' | 'active' | 'stopped' | 'error' | string;
  errorMsg?: string;
  startedAt?: string;
  catchCount: number;
  activeSessions?: RawTcpSessionStats[];
  commandPreview?: string;
  opsecWarnings?: string[];
}

