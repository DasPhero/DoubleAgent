import React, { useState, useMemo, useEffect } from 'react';
import { NotePage, NoteHostOption } from '../types/note';
import { MarkdownRenderer, toggleMarkdownTaskAtIndex } from './MarkdownRenderer';

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
}) => {
  const host = useMemo(() => hosts.find((h) => h.id === hostId), [hosts, hostId]);
  const hostNotes = useMemo(() => notes.filter((n) => n.hostId === hostId), [notes, hostId]);

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
    <div className="host-notes-drawer open" role="complementary" aria-label="Host Documentation Drawer">
      {/* Drawer Header */}
      <div className="drawer-header">
        <div className="drawer-title-box">
          <span className="drawer-icon">📝</span>
          <div className="drawer-titles">
            <span className="drawer-sub">Host Notes</span>
            <span className="drawer-host-name">{host?.label || host?.address || 'Host'}</span>
          </div>
        </div>
        <div className="drawer-actions">
          {onPinSplit && (
            <button
              type="button"
              className="drawer-action-btn"
              onClick={onPinSplit}
              title="Pin notes as a horizontal split view alongside terminal"
              aria-label="Pin Notes as Split View"
            >
              📌 Pin Split
            </button>
          )}
          {onOpenFullNotes && (
            <button
              type="button"
              className="drawer-action-btn"
              onClick={onOpenFullNotes}
              title="Open Full Notes Manager"
            >
              ⤢ Full View
            </button>
          )}
          <button
            type="button"
            className="drawer-close-btn"
            onClick={onClose}
            title="Close Notes Drawer"
            aria-label="Close Notes Drawer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Note Selector Tabs */}
      <div className="drawer-notes-tabs">
        {hostNotes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`drawer-tab-pill ${selectedNoteId === n.id ? 'active' : ''}`}
            onClick={() => {
              setSelectedNoteId(n.id);
              setIsEditing(false);
            }}
          >
            {n.isFolder ? '📁' : '📄'} {n.title}
          </button>
        ))}
        <button type="button" className="drawer-tab-pill add-tab-btn" onClick={handleCreate} title="New Note">
          + Add
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
                    className="drawer-edit-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <button type="button" className="drawer-save-btn" onClick={() => void handleSave()}>
                    💾 Save
                  </button>
                  <button type="button" className="drawer-cancel-btn" onClick={() => setIsEditing(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <h3 className="drawer-note-heading">{selectedNote.title}</h3>
                  <button type="button" className="drawer-edit-btn" onClick={() => setIsEditing(true)}>
                    ✏️ Edit
                  </button>
                  <button
                    type="button"
                    className="drawer-delete-btn"
                    onClick={() => {
                      void onDeleteNote(selectedNote.id);
                    }}
                    title="Delete Note"
                  >
                    🗑️
                  </button>
                </>
              )}
            </div>

            {isEditing ? (
              <textarea
                aria-label="Edit note body"
                className="drawer-textarea"
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
            <button type="button" className="drawer-create-btn" onClick={handleCreate}>
              + Create First Note
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
