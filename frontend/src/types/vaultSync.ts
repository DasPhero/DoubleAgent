export type VaultSyncStatus = 'synced' | 'external_change' | 'conflict';

export type VaultConflictResolution = 'local' | 'remote' | 'both';

export interface VaultConflictItem {
  id: string;
  type: string;
  label: string;
  localSummary: string;
  remoteSummary: string;
}

export interface VaultConflictReport {
  hasConflicts: boolean;
  conflicts: VaultConflictItem[];
  autoMerged: number;
}

export interface VaultSyncInfo {
  filePath: string;
  fileSize: number;
  lastModified: number;
  status: VaultSyncStatus;
  syncConflictFiles?: string[];
  detectedConflict: boolean;
  conflictCount: number;
}

