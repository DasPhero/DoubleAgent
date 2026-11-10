export type ImportSourceType =
  | 'putty_registry'
  | 'putty_reg'
  | 'putty_session'
  | 'termius_json'
  | 'termius_csv';

export interface ImportedForwardRule {
  type: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
}

export interface ImportedHostEntry {
  label: string;
  address: string;
  port: number;
  username: string;
  group?: string;
  tags?: string[];
  keyPath?: string;
  password?: string;
  proxyCommand?: string;
  forwardRules?: ImportedForwardRule[];
  alreadyExist?: boolean;
}

export interface ImportScanResult {
  sourceType: ImportSourceType;
  hosts: ImportedHostEntry[];
  groups: string[];
  totalFound: number;
  warnings?: string[];
}

export interface ImportExecuteOptions {
  selectedHosts: ImportedHostEntry[];
  defaultGroup?: string;
  importKeys: boolean;
}

export interface ImportExecuteResult {
  hostsImported: number;
  groupsCreated: number;
  keysImported: number;
  tunnelsConfigured: number;
  warnings?: string[];
}

