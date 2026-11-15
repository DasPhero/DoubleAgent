export type FileServerKind =
  | 'builtin'
  | 'python3'
  | 'python2'
  | 'updog'
  | 'impacket-smb'
  | 'php'
  | 'ruby';

export interface FileTransferServerConfig {
  id: string;
  name: string;
  kind: FileServerKind | string;
  directory: string;
  bindAddress: string;
  port: number;
  enableUpload: boolean;
  useTLS: boolean;
  shareName?: string;
  basicAuthUser?: string;
  basicAuthPassword?: string;
}

export interface FileTransferEvent {
  timestamp: string;
  method: string;
  path: string;
  remoteAddr: string;
  status: number;
  bytes: number;
  note?: string;
}

export interface FileTransferServerInfo {
  id: string;
  name: string;
  kind: FileServerKind | string;
  directory: string;
  bindAddress: string;
  port: number;
  enableUpload: boolean;
  useTLS: boolean;
  shareName?: string;
  hasBasicAuth: boolean;
  status: 'running' | 'stopped' | string;
  startedAt?: string;
  servedCount: number;
  uploadCount: number;
  commandPreview: string;
  opsecWarnings?: string[];
  recentEvents?: FileTransferEvent[];
  errorMsg?: string;
}

export interface HostedFileEntry {
  name: string;
  relPath: string;
  fullPath: string;
  size: number;
  isDir: boolean;
  modTime: string;
  sha256?: string;
  md5?: string;
}

export interface NetworkInterfaceIP {
  interface: string;
  ip: string;
  cidr: string;
  isVpn: boolean;
}

export interface FileTransferCommandOptions {
  filename: string;
  localIp: string;
  port: number;
  useTLS: boolean;
  targetOs: 'all' | 'linux' | 'windows' | 'macos' | string;
  targetDestDir?: string;
  shareName?: string;
  sha256?: string;
  md5?: string;
  enableUpload: boolean;
  uploadFilePath?: string;
  basicAuthUser?: string;
}

export interface TargetTransferMethod {
  id: string;
  tool: string;
  title: string;
  targetOs: 'linux' | 'windows' | 'macos' | 'any' | string;
  category: 'download' | 'memory' | 'upload' | 'verify' | string;
  command: string;
  notes?: string;
}

export interface FileTransferCommandSet {
  filename: string;
  url: string;
  localIp: string;
  port: number;
  sha256?: string;
  md5?: string;
  methods: TargetTransferMethod[];
  opsecWarnings?: string[];
}
