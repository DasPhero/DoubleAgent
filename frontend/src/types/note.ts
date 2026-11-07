export interface NoteHostOption {
  id: string;
  label: string;
  address: string;
}

// NotePage represents a structured documentation or runbook page linked to a host or global (F-17).
export interface NotePage {
  id: string;
  hostId?: string; // empty string for global workspace notes
  parentId?: string; // empty string for root items
  isFolder: boolean;
  title: string;
  type: 'markdown' | 'table';
  body: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// NotePageSummary contains note metadata and a preview snippet (F-17).
export interface NotePageSummary {
  id: string;
  hostId?: string;
  parentId?: string;
  isFolder: boolean;
  title: string;
  type: 'markdown' | 'table';
  order: number;
  snippet?: string;
  createdAt: string;
  updatedAt: string;
}

// NoteSearchResult represents search matches across titles and body contents (F-17, F-02).
export interface NoteSearchResult {
  note: NotePageSummary;
  matchSnippet: string;
  matchCount: number;
}

// NoteTreeNode structures notes into a collapsible hierarchy for folder trees.
export interface NoteTreeNode {
  note: NotePageSummary;
  children: NoteTreeNode[];
}
