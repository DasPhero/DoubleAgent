// F-31: Raw TCP Socket Client & Listener Engine types

export interface RawTcpConfig {
  host: string;
  port: number;
  lineMode: boolean;
  lineEnding: 'crlf' | 'lf' | 'cr';
  timeoutSec?: number;
}

export interface RawTcpSessionStats {
  id: string;
  remoteAddr: string;
  localAddr: string;
  isListener: boolean;
  listenerPort?: number;
  bytesSent: number;
  bytesReceived: number;
  connectedAt: string;
  lineMode: boolean;
  lineEnding: string;
}

export interface RawTcpListenerConfig {
  port: number;
  bindAddress: string;
  autoSpawnTab: boolean;
}

export interface RawTcpListenerInfo {
  id: string;
  port: number;
  bindAddress: string;
  status: 'listening' | 'stopped';
  startedAt: string;
  totalCatches: number;
}

export interface RawTcpIncomingEvent {
  sessionId: string;
  listenerId: string;
  listenerPort: number;
  remoteAddr: string;
}

