export interface SessionLogRecord {
  id: string;
  sessionId: string;
  hostId?: string;
  hostLabel: string;
  startedAt: string;
  endedAt?: string;
  filePath: string;
  byteCount: number;
  lineCount: number;
  active: boolean;
}

export interface SessionLogStatus {
  sessionId: string;
  logId?: string;
  active: boolean;
  filePath?: string;
  byteCount: number;
  lineCount: number;
}

