import React, { useState, useMemo, useEffect } from 'react';
import { NotePage, NoteHostOption } from '../types/note';
import { MarkdownRenderer, toggleMarkdownTaskAtIndex } from './MarkdownRenderer';
import { CyberIcon } from './CyberIcon';

interface NotesViewProps {
  notes: NotePage[];
  hosts: NoteHostOption[];
  activeHostId?: string;
  initialNoteId?: string | null;
  onSaveNote: (note: NotePage) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onOpenAsTab?: () => void;
  onClose?: () => void;
}

export const NotesView: React.FC<NotesViewProps> = ({
  notes,
  hosts,
  activeHostId,
  initialNoteId,
  onSaveNote,
  onDeleteNote,
  onOpenAsTab,
  onClose,
}) => {
  const [selectedHostFilter, setSelectedHostFilter] = useState<string>(activeHostId || 'all');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    initialNoteId || (notes.length > 0 ? notes[0].id : null)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'split' | 'edit' | 'preview'>('split');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (initialNoteId) {
      setSelectedNoteId(initialNoteId);
      setSelectedHostFilter('all');
    }
  }, [initialNoteId]);

  // Currently editing note state
  const selectedNote = useMemo(() => {
    return notes.find((n) => n.id === selectedNoteId) || null;
  }, [notes, selectedNoteId]);

  const [editTitle, setEditTitle] = useState(selectedNote?.title || '');
  const [editBody, setEditBody] = useState(selectedNote?.body || '');
  const [editHostId, setEditHostId] = useState(selectedNote?.hostId || '');
  const [editParentId, setEditParentId] = useState(selectedNote?.parentId || '');
  const [editIsFolder, setEditIsFolder] = useState(selectedNote?.isFolder || false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Sync state when note selection or external note content changes
  useEffect(() => {
    if (selectedNote) {
      setEditTitle(selectedNote.title);
      setEditBody(selectedNote.body);
      setEditHostId(selectedNote.hostId || '');
      setEditParentId(selectedNote.parentId || '');
      setEditIsFolder(selectedNote.isFolder);
      setSaveStatus(null);
    }
  }, [selectedNote, selectedNote?.body, selectedNote?.title, selectedNote?.updatedAt]);

  // Filter notes based on host and search query
  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      const matchesHost =
        selectedHostFilter === 'all'
          ? true
          : selectedHostFilter === 'global'
          ? !n.hostId
          : n.hostId === selectedHostFilter;

      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        q === ''
          ? true
          : n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);

      return matchesHost && matchesSearch;
    });
  }, [notes, selectedHostFilter, searchQuery]);

  // Auto-select first available note if none is selected
  useEffect(() => {
    if ((!selectedNoteId || !notes.some((n) => n.id === selectedNoteId)) && filteredNotes.length > 0) {
      setSelectedNoteId(filteredNotes[0].id);
    }
  }, [filteredNotes, notes, selectedNoteId]);

  // Hierarchical tree structure (if parent isn't in filtered set, treat as root so search results are always visible)
  const filteredIds = useMemo(() => new Set(filteredNotes.map((n) => n.id)), [filteredNotes]);

  const rootNotes = useMemo(() => {
    return filteredNotes.filter((n) => !n.parentId || !filteredIds.has(n.parentId));
  }, [filteredNotes, filteredIds]);

  const getChildren = (parentId: string) => {
    return filteredNotes.filter((n) => n.parentId === parentId);
  };

  // Available folders for parent selector
  const availableFolders = useMemo(() => {
    return notes.filter((n) => n.isFolder && n.id !== selectedNote?.id);
  }, [notes, selectedNote]);

  const handleCreateNew = async (isFolder: boolean, explicitParentId?: string) => {
    const newId = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const parentId =
      explicitParentId !== undefined
        ? explicitParentId
        : selectedNote?.isFolder
        ? selectedNote.id
        : selectedNote?.parentId || '';

    const defaultHostId =
      selectedHostFilter !== 'all' && selectedHostFilter !== 'global'
        ? selectedHostFilter
        : selectedNote?.hostId || '';

    const newNote: NotePage = {
      id: newId,
      hostId: defaultHostId,
      parentId,
      isFolder,
      title: isFolder ? 'New Folder' : 'Untitled Note',
      type: 'markdown',
      body: isFolder ? '' : '# Untitled Note\n\nWrite your documentation here.',
      order: notes.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await onSaveNote(newNote);
    setSelectedNoteId(newId);
  };

  const handleSave = async () => {
    if (!selectedNote) return;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const updated: NotePage = {
        ...selectedNote,
        title: editTitle.trim() || (editIsFolder ? 'New Folder' : 'Untitled Note'),
        body: editBody,
        hostId: editHostId || '',
        parentId: editParentId || '',
        isFolder: editIsFolder,
        updatedAt: new Date().toISOString(),
      };
      await onSaveNote(updated);
      setSaveStatus('Saved');
      setTimeout(() => setSaveStatus(null), 2500);
    } catch {
      setSaveStatus('Error saving');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleTask = async (taskIndex: number, newChecked: boolean) => {
    if (!selectedNote) return;
    const newBody = toggleMarkdownTaskAtIndex(editBody, taskIndex, newChecked);
    setEditBody(newBody);
    await onSaveNote({
      ...selectedNote,
      title: editTitle.trim() || selectedNote.title,
      body: newBody,
      hostId: editHostId || '',
      parentId: editParentId || '',
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDelete = async () => {
    if (!selectedNote) return;
    await onDeleteNote(selectedNote.id);
    const remaining = notes.filter((n) => n.id !== selectedNote.id && n.parentId !== selectedNote.id);
    setSelectedNoteId(remaining.length > 0 ? remaining[0].id : null);
  };

  // Helper toolbar actions
  const insertFormatting = (prefix: string, suffix: string = '') => {
    const textarea = document.getElementById('note-body-editor') as HTMLTextAreaElement | null;
    if (!textarea) {
      setEditBody((prev) => `${prev}\n${prefix}text${suffix}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;

    const newText = text.substring(0, start) + replacement + text.substring(end);
    setEditBody(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selected ? selected.length : 4));
    }, 0);
  };

  return (
    <div className="notes-view-container" role="region" aria-label="Host Notes and Documentation">
      {/* Top Header */}
      <div className="notes-header" style={{ background: 'rgba(7, 13, 24, 0.95)', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)' }}>
        <div className="notes-header-left">
          <button
            type="button"
            className="notes-tool-btn cyber-btn cyber-btn-secondary cyber-btn-sm"
            style={{ flex: 'none', padding: '0.25rem 0.55rem', marginRight: '0.35rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            title={isSidebarCollapsed ? 'Show Notes List' : 'Hide Notes List (Full-Width Editor)'}
          >
            <CyberIcon name={isSidebarCollapsed ? 'chevron-right' : 'chevron-left'} size={12} />
            <span>{isSidebarCollapsed ? 'Show List' : 'Hide List'}</span>
          </button>
          <span className="cyber-hazard-stripes" style={{ marginRight: '6px' }}>///</span>
          <h2 className="notes-header-title" style={{ color: 'var(--accent-bright)', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <CyberIcon name="note" size={16} /> Host Notes &amp; Documentation
          </h2>
          <span className="notes-count-badge" style={{ background: 'color-mix(in srgb, var(--accent-bright) 15%, transparent)', color: 'var(--accent-bright)', border: '1px solid color-mix(in srgb, var(--accent-bright) 40%, transparent)' }}>{filteredNotes.length} items</span>
        </div>
        <div className="notes-header-right">
          {onOpenAsTab && (
            <button
              type="button"
              className="notes-tool-btn cyber-btn cyber-btn-sm cyber-btn-secondary"
              onClick={onOpenAsTab}
              title="Open as full workspace tab"
            >
              <CyberIcon name="undock" size={12} /> Tab View
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="cyber-btn-close"
              onClick={onClose}
              title="Close Notes"
              aria-label="Close Notes"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="notes-body">
        {/* Left Navigation Tree */}
        <div className={`notes-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
          {/* Host Filter Dropdown */}
          <div className="notes-filter-box">
            <label className="notes-filter-label" htmlFor="host-filter-select">Scope:</label>
            <select
              id="host-filter-select"
              aria-label="Filter notes by host"
              className="notes-filter-select cyber-hud-select font-mono"
              value={selectedHostFilter}
              onChange={(e) => setSelectedHostFilter(e.target.value)}
            >
              <option value="all">All Notes</option>
              <option value="global">Global Workspace Notes</option>
              <optgroup label="Saved Hosts">
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label || h.address}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Search box */}
          <div className="notes-search-box">
            <input
              type="text"
              aria-label="Search notes"
              className="notes-search-input cyber-hud-input font-mono"
              placeholder="Search notes (titles & text)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="notes-search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Action Toolbar */}
          <div className="notes-tree-toolbar">
            <button
              type="button"
              className="cyber-btn cyber-btn-sm cyber-btn-secondary"
              onClick={() => void handleCreateNew(false)}
              title="Add Note"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', fontSize: '0.72rem' }}
            >
              <CyberIcon name="plus" size={11} /> + Note
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn-sm cyber-btn-secondary"
              onClick={() => void handleCreateNew(true)}
              title="Add Folder"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', fontSize: '0.72rem' }}
            >
              <CyberIcon name="folder" size={11} /> + Folder
            </button>
          </div>

          {/* Document Tree */}
          <div className="notes-tree-list">
            {rootNotes.length === 0 ? (
              <div className="notes-tree-empty">No notes found. Click "+ Note" to begin.</div>
            ) : (
              rootNotes.map((note) => renderTreeNode(note, 0))
            )}
          </div>
        </div>

        {/* Right Editor & Preview Area */}
        <div className="notes-main-content">
          {selectedNote ? (
            <div className="note-editor-wrapper">
              {/* Note Metadata Bar */}
              <div className="note-meta-bar">
                <input
                  type="text"
                  aria-label="Note title"
                  className="note-title-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Note Title..."
                />
                <div className="note-actions-bar">
                  {/* Host Link Selector */}
                  <select
                    aria-label="Link note to host"
                    className="note-host-select"
                    value={editHostId}
                    onChange={(e) => setEditHostId(e.target.value)}
                    title="Link note to host"
                  >
                    <option value="">(Global Note)</option>
                    {hosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label || h.address}
                      </option>
                    ))}
                  </select>

                  {/* Parent Folder Selector */}
                  <select
                    aria-label="Parent folder"
                    className="note-host-select"
                    value={editParentId}
                    onChange={(e) => setEditParentId(e.target.value)}
                    title="Parent folder"
                  >
                    <option value="">(Root Level)</option>
                    {availableFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        [FOLDER] {f.title}
                      </option>
                    ))}
                  </select>

                  {/* View Mode Toggle */}
                  {!editIsFolder && (
                    <div className="note-view-tabs" role="tablist">
                      <button
                        type="button"
                        className={`note-tab-btn ${viewMode === 'edit' ? 'active' : ''}`}
                        onClick={() => setViewMode('edit')}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`note-tab-btn ${viewMode === 'split' ? 'active' : ''}`}
                        onClick={() => setViewMode('split')}
                      >
                        Split
                      </button>
                      <button
                        type="button"
                        className={`note-tab-btn ${viewMode === 'preview' ? 'active' : ''}`}
                        onClick={() => setViewMode('preview')}
                      >
                        Preview
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    className="cyber-btn cyber-btn-sm cyber-btn-primary"
                    onClick={() => void handleSave()}
                    disabled={isSaving}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <CyberIcon name="save" size={12} />
                    <span>{isSaving ? 'Saving...' : 'Save Note'}</span>
                  </button>

                  <button
                    type="button"
                    className="cyber-btn cyber-btn-sm cyber-btn-danger"
                    onClick={() => void handleDelete()}
                    title="Delete Note"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <CyberIcon name="trash" size={12} />
                    <span>Delete</span>
                  </button>

                  {saveStatus && <span className="note-save-status">{saveStatus}</span>}
                </div>
              </div>

              {/* Formatting Toolbar (Only shown in Edit/Split mode for markdown notes) */}
              {!editIsFolder && viewMode !== 'preview' && (
                <div className="note-format-toolbar">
                  <button type="button" onClick={() => insertFormatting('# ')} title="Heading 1">H1</button>
                  <button type="button" onClick={() => insertFormatting('## ')} title="Heading 2">H2</button>
                  <button type="button" onClick={() => insertFormatting('**', '**')} title="Bold">B</button>
                  <button type="button" onClick={() => insertFormatting('*', '*')} title="Italic"><em>I</em></button>
                  <button type="button" onClick={() => insertFormatting('`', '`')} title="Inline Code">Code</button>
                  <button type="button" onClick={() => insertFormatting('```bash\n', '\n```')} title="Code Block">```</button>
                  <button type="button" onClick={() => insertFormatting('- ')} title="Bullet List">• List</button>
                  <button type="button" onClick={() => insertFormatting('1. ')} title="Numbered List">1. List</button>
                  <button type="button" onClick={() => insertFormatting('- [ ] ')} title="Task Checkbox">[ ] Task</button>
                  <button type="button" onClick={() => insertFormatting('| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n')} title="Table">Table</button>
                  <button type="button" onClick={() => insertFormatting('[', '](https://)')} title="Link">Link</button>
                </div>
              )}

              {/* Editor / Preview Content Split */}
              {editIsFolder ? (
                <div className="note-folder-view">
                  <span className="folder-icon" style={{ display: 'inline-flex', color: 'var(--accent-bright)' }}>
                    <CyberIcon name="folder" size={28} />
                  </span>
                  <h3>Folder: {editTitle}</h3>
                  <p>Organize subpages inside this folder using the left tree.</p>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-primary"
                    style={{ marginTop: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => void handleCreateNew(false, selectedNote.id)}
                  >
                    <CyberIcon name="plus" size={12} /> Add Subpage in "{editTitle}"
                  </button>
                </div>
              ) : (
                <div className={`note-editor-panels mode-${viewMode}`}>
                  {viewMode !== 'preview' && (
                    <div className="note-pane editor-pane">
                      <textarea
                        id="note-body-editor"
                        aria-label="Note markdown editor"
                        className="note-textarea"
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        placeholder="Type Markdown content here..."
                        spellCheck={false}
                      />
                    </div>
                  )}

                  {viewMode !== 'edit' && (
                    <div className="note-pane preview-pane">
                      <MarkdownRenderer
                        content={editBody}
                        onToggleTask={(idx, checked) => void handleToggleTask(idx, checked)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="note-empty-selection">
              <span className="empty-icon" style={{ display: 'inline-flex', color: 'var(--accent-bright)' }}>
                <CyberIcon name="note" size={32} />
              </span>
              <h3>Select a note or folder</h3>
              <p>Choose an item from the left navigation tree, or create a new note.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function renderTreeNode(note: NotePage, depth: number) {
    const isSelected = selectedNoteId === note.id;
    const children = getChildren(note.id);
    const host = hosts.find((h) => h.id === note.hostId);

    return (
      <div key={note.id} className="tree-node-group" style={{ paddingLeft: `${depth * 14}px` }}>
        <div
          className={`tree-node-item ${isSelected ? 'selected' : ''}`}
          onClick={() => setSelectedNoteId(note.id)}
          role="button"
          tabIndex={0}
        >
          <span className="node-icon" style={{ display: 'inline-flex', color: note.isFolder ? 'var(--accent-bright)' : 'var(--accent-bright)' }}>
            <CyberIcon name={note.isFolder ? 'folder' : 'note'} size={13} />
          </span>
          <span className="node-title font-mono">{note.title}</span>
          {host && <span className="node-host-badge font-mono">{host.label || host.address}</span>}
        </div>
        {children.length > 0 && (
          <div className="tree-children">
            {children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }
};
