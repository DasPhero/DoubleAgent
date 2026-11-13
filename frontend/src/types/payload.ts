import { SnippetVariable } from './snippet';

export type PayloadOS = 'linux' | 'windows' | 'macos' | 'any';
export type PayloadKind = 'reverse' | 'bind' | 'msfvenom' | 'one-liner';
export type PayloadEncoding = 'none' | 'base64' | 'url' | 'powershell_b64' | 'hex';

export interface PayloadTemplate {
  id: string;
  name: string;
  description?: string;
  os: PayloadOS | string;
  shell: string;
  kind: PayloadKind | string;
  command: string;
  defaultPort?: number;
  variables?: SnippetVariable[];
  tags?: string[];
  opsecRisk?: 'low' | 'medium' | 'high' | string;
  notes?: string;
}

export interface PayloadRenderOptions {
  templateId: string;
  lhost: string;
  lport: number;
  encoding?: PayloadEncoding | string;
  customVars?: Record<string, string>;
}

export interface PayloadRenderResult {
  templateId: string;
  rawCommand: string;
  rendered: string;
  encoding: string;
  opsecWarnings?: string[];
  resolvedVars: Record<string, string>;
}

export interface PayloadFileConfig {
  filePath: string;
  templateCount: number;
  exists: boolean;
  lastModified?: string;
}
