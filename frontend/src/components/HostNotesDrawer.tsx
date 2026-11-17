import React, { useState, useMemo, useEffect } from 'react';
import { NotePage, NoteHostOption } from '../types/note';
import { MarkdownRenderer, toggleMarkdownTaskAtIndex } from './MarkdownRenderer';
import { CyberIcon } from './CyberIcon';

interface HostNotesDrawerProps {
  isOpen: boolean;
  hostId: string;
  notes: NotePage[];
  hosts: NoteHostOption[];
  onSaveNote: (note: NotePage) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onClose: () => void;
  onPinSplit?: () => void;
  onOpenFullNotes?: () => void;
  isPinned?: boolean;
  onHeaderDragStart?: (e: React.DragEvent) => void;
  onHeaderDragEnd?: () => void;
}

export const HostNotesDrawer: React.FC<HostNotesDrawerProps> = ({
  isOpen,
  hostId,
  notes,
  hosts,
  onSaveNote,
  onDeleteNote,
  onClose,
  onPinSplit,
  onOpenFullNotes,
  isPinned = false,
  onHeaderDragStart,
  onHeaderDragEnd,
}) => {
  const host = useMemo(() => hosts.find((h) => h.id === hostId), [hosts, hostId]);
  const hostNotes = useMemo(() => {
    if (!hostId) {
      return notes.filter((n) => !n.hostId);
    }
    return notes.filter((n) => n.hostId === hostId);
  }, [notes, hostId]);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    hostNotes.length > 0 ? hostNotes[0].id : null
  );
  const [isEditing, setIsEditing] = useState(false);

  const selectedNote = useMemo(
    () => hostNotes.find((n) => n.id === selectedNoteId) || null,
    [hostNotes, selectedNoteId]
  );

  const [editTitle, setEditTitle] = useState(selectedNote?.title || '');
  const [editBody, setEditBody] = useState(selectedNote?.body || '');

  useEffect(() => {
    if (selectedNote) {
      setEditTitle(selectedNote.title);
      setEditBody(selectedNote.body);
    } else if (hostNotes.length > 0) {
      setSelectedNoteId(hostNotes[0].id);
    }
  }, [selectedNote, hostNotes]);

  if (!isOpen) return null;

  const handleCreate = () => {
    const newId = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newNote: NotePage = {
      id: newId,
      hostId,
      isFolder: false,
      title: 'New Note',
      type: 'markdown',
      body: '# New Note\n\nNotes for ' + (host?.label || host?.address || 'this host'),
      order: hostNotes.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onSaveNote(newNote).then(() => {
      setSelectedNoteId(newId);
      setIsEditing(true);
    });
  };

  const handleSave = async () => {
    if (!selectedNote) return;
    const updated: NotePage = {
      ...selectedNote,
      title: editTitle.trim() || 'Untitled',
      body: editBody,
      updatedAt: new Date().toISOString(),
    };
    await onSaveNote(updated);
    setIsEditing(false);
  };

  const handleToggleTask = async (taskIndex: number, newChecked: boolean) => {
    if (!selectedNote) return;
    const newBody = toggleMarkdownTaskAtIndex(selectedNote.body, taskIndex, newChecked);
    setEditBody(newBody);
    await onSaveNote({
      ...selectedNote,
      body: newBody,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div
      className={`host-notes-drawer ${isPinned ? 'is-pinned' : 'open'}`}
      role="complementary"
      aria-label="Host Documentation Drawer"
    >
      <div className="cyber-corner-reticle cyber-corner-tl" />
      <div className="cyber-corner-reticle cyber-corner-tr" />
      <div className="cyber-corner-reticle cyber-corner-bl" />
      <div className="cyber-corner-reticle cyber-corner-br" />

      {/* Drawer Header */}
      <div
        className="drawer-header"
        draggable={Boolean(onHeaderDragStart)}
        onDragStart={onHeaderDragStart}
        onDragEnd={onHeaderDragEnd}
        title={isPinned ? 'Drag header to rearrange or dock notes pane' : 'Drag header onto any terminal pane to dock notes'}
        style={{ cursor: onHeaderDragStart ? 'grab' : undefined }}
      >
        <div className="drawer-title-box">
          {onHeaderDragStart && (
            <span className="pane-drag-handle" aria-hidden="true">
              <CyberIcon name="grip" size={12} />
            </span>
          )}
          <span className="cyber-hazard-stripes" style={{ marginRight: '2px' }}>///</span>
          <span className="drawer-icon" style={{ color: 'var(--accent-bright)', display: 'inline-flex' }}>
            <CyberIcon name="note" size={14} />
          </span>
          <div className="drawer-titles">
            <span className="drawer-sub">{isPinned ? 'Pinned Notes' : 'Host Notes'}</span>
            <span className="drawer-host-name">
              {host?.label || host?.address || (hostId ? 'Host' : 'Global Notes')}
            </span>
          </div>
        </div>
        <div className="drawer-actions">
          {!isPinned && onPinSplit && (
            <button
              type="button"
              className="cyber-btn cyber-btn-sm cyber-btn-secondary"
              onClick={onPinSplit}
              title="Pin notes as a horizontal split view alongside terminal"
              aria-label="Pin Notes as Split View"
              style={{ fontSize: '0.68rem', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '3px' }}
            >
              <CyberIcon name="pin" size={11} /> Pin Split
            </button>
          )}
          {onOpenFullNotes && (
            <button
              type="button"
              className="cyber-btn cyber-btn-sm cyber-btn-secondary"
              onClick={onOpenFullNotes}
              title="Open full notes editor in workspace tab"
              aria-label="Open Full Notes"
              style={{ fontSize: '0.68rem', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '3px' }}
            >
              <CyberIcon name="undock" size={11} /> Full View
            </button>
          )}
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            title={isPinned ? 'Close Pinned Notes' : 'Close Notes Drawer'}
            aria-label={isPinned ? 'Close Notes Pane' : 'Close Notes Drawer'}
          >
            ×
          </button>
        </div>
      </div>

      {/* Note Selector Dropdown */}
      <div className="drawer-notes-selector-bar">
        <div className="drawer-selector-left" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: 1, minWidth: 0 }}>
          <label className="cyber-label-sm" htmlFor="host-note-dropdown" style={{ margin: 0, fontSize: '0.68rem', color: '#94a3b8' }}>
            NOTE:
          </label>
          <select
            id="host-note-dropdown"
            className="cyber-hud-select drawer-notes-dropdown font-mono"
            aria-label="Select note"
            value={selectedNoteId || ''}
            onChange={(e) => {
              setSelectedNoteId(e.target.value);
              setIsEditing(false);
            }}
          >
            {hostNotes.length === 0 ? (
              <option value="">(No notes available)</option>
            ) : (
              hostNotes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.isFolder ? '[FOLDER] ' : ''}{n.title}
                </option>
              ))
            )}
          </select>
        </div>
        <button
          type="button"
          className="cyber-btn cyber-btn-sm cyber-btn-secondary"
          onClick={handleCreate}
          title="Create New Note"
          aria-label="New Note"
          style={{ fontSize: '0.7rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}
        >
          <CyberIcon name="plus" size={11} /> New
        </button>
      </div>

      {/* Drawer Body */}
      <div className="drawer-content">
        {selectedNote ? (
          <div className="drawer-note-view">
            <div className="drawer-note-toolbar">
              {isEditing ? (
                <>
                  <input
                    type="text"
                    aria-label="Edit note title"
                    className="cyber-hud-input drawer-edit-title font-mono"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-sm cyber-btn-primary"
                    onClick={() => void handleSave()}
                    style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem' }}
                  >
                    <CyberIcon name="save" size={11} /> Save
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-sm cyber-btn-secondary"
                    onClick={() => setIsEditing(false)}
                    style={{ fontSize: '0.7rem' }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <h3 className="drawer-note-heading font-mono">{selectedNote.title}</h3>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-sm cyber-btn-secondary"
                    onClick={() => setIsEditing(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem' }}
                  >
                    <CyberIcon name="edit" size={11} /> Edit
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-sm cyber-btn-danger"
                    onClick={() => {
                      void onDeleteNote(selectedNote.id);
                    }}
                    title="Delete Note"
                    aria-label="Delete Note"
                    style={{ padding: '3px 6px' }}
                  >
                    <CyberIcon name="trash" size={11} />
                  </button>
                </>
              )}
            </div>

            {isEditing ? (
              <textarea
                aria-label="Edit note body"
                className="cyber-hud-input drawer-textarea font-mono"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="Markdown notes..."
                spellCheck={false}
              />
            ) : (
              <div className="drawer-rendered-container">
                <MarkdownRenderer
                  content={selectedNote.body}
                  onToggleTask={(idx, checked) => void handleToggleTask(idx, checked)}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="drawer-empty-state">
            <p>No notes for this host yet.</p>
            <button
              type="button"
              className="cyber-btn cyber-btn-primary"
              onClick={handleCreate}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <CyberIcon name="plus" size={12} /> Create First Note
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
