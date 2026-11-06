export interface FileItem {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  IsDir?: boolean;
  modTime: number; // Unix timestamp
  permissions: string;
}

export type TransferStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TransferTask {
  id: string;
  sessionId: string;
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  totalBytes: number;
  transferredBytes: number;
  speedBytesPerSec: number;
  status: TransferStatus;
  error?: string;
}

export interface TransferProgressEvent {
  taskId: string;
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  percent: number;
  status: TransferStatus;
  error?: string;
}
