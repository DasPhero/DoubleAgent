export type RemoteEditStatus = 'active' | 'syncing' | 'conflict' | 'closed';

export interface RemoteEditSession {
  id: string;
  sessionId: string;
  remotePath: string;
  localPath: string;
  filename: string;
  initialModTime: number;
  initialSize: number;
  initialHash: string;
  status: RemoteEditStatus;
  lastUploadedAt: number;
  hasConflict: boolean;
  errorMessage?: string;
}

export interface RemoteEditResult {
  success: boolean;
  conflict: boolean;
  remoteModTime: number;
  remoteSize: number;
  message: string;
}

export interface RemoteConflictInfo {
  hasConflict: boolean;
  remotePath: string;
  initialModTime: number;
  remoteModTime: number;
  initialSize: number;
  remoteSize: number;
  message: string;
}

export interface RemoteEditEvent {
  editSessionId: string;
  status: RemoteEditStatus;
  hasConflict: boolean;
  message?: string;
}
