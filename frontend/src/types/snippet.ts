export interface SnippetVariable {
  name: string;
  defaultValue?: string;
  description?: string;
  secretRef?: string;
}

export interface Snippet {
  id: string;
  name: string;
  description?: string;
  body: string;
  variables?: SnippetVariable[];
  tags?: string[];
  confirmBeforeRun: boolean;
}

export interface SnippetContext {
  hostId?: string;
  hostLabel?: string;
  address?: string;
  hostname?: string;
  ip?: string;
  port?: number;
  username?: string;
  workingDir?: string;
  timestamp?: string;
  date?: string;
  time?: string;
  customVars?: Record<string, string>;
}

// SnippetChainStep represents a single sequential command stage in an automated or interactive attack chain (Spec F-16).
export interface SnippetChainStep {
  id: string;
  title: string;
  description?: string;
  snippetId?: string;
  command: string;
  confirmBeforeRun: boolean;
  delayMs?: number;
  stopOnError: boolean;
}

// SnippetChain represents a multi-stage command execution sequence scoped to a host or global (Spec F-16).
export interface SnippetChain {
  id: string;
  name: string;
  description?: string;
  hostId?: string;
  targetOs?: 'any' | 'linux' | 'windows' | string;
  category?: string;
  steps: SnippetChainStep[];
  stopOnError: boolean;
  autoRunWithoutPrompt: boolean;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SnippetChainsFileConfig {
  filePath: string;
  chainCount: number;
  exists: boolean;
  lastModified?: string;
}

