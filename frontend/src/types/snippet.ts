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

