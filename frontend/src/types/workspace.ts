import { SplitDirection } from '../App';

export interface WorkspaceState {
  version: number;
  activeTabId: string;
  tabs: PersistedTabItem[];
  autoRestore: boolean;
  savedAt?: string;
}

export interface PersistedPaneItem {
  id: string;
  sessionId?: string;
  hostId?: string;
  title: string;
  cwd?: string;
  paneType?: string;
  notesHostId?: string;
  sftpSessionId?: string;
  editSessionId?: string;
  editRemotePath?: string;
}

export interface PersistedWorkspaceNode {
  type: 'pane' | 'split';
  id: string;
  sessionId?: string;
  hostId?: string;
  title?: string;
  cwd?: string;
  paneType?: string;
  notesHostId?: string;
  sftpSessionId?: string;
  editSessionId?: string;
  editRemotePath?: string;
  direction?: SplitDirection;
  children?: PersistedWorkspaceNode[];
  ratios?: number[];
}

export interface PersistedTabItem {
  id: string;
  title: string;
  hostId?: string;
  color?: string;
  splitDir?: SplitDirection;
  panes?: PersistedPaneItem[];
  rootNode: PersistedWorkspaceNode;
  activePaneId: string;
  tabType?: 'terminal' | 'sftp' | 'settings' | 'notes' | 'network-map' | 'editor';
  notesHostId?: string;
}

export interface ReconnectState {
  paneId: string;
  tabId: string;
  hostId?: string;
  title: string;
  attempt: number;
  maxAttempts: number;
  countdown: number;
  status: 'reconnecting' | 'failed';
  reason?: string;
}

