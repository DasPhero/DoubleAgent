import React, { useState, useMemo, useRef } from 'react';
import { Snippet } from '../types/snippet';
import { CyberIcon } from './CyberIcon';

export interface SnippetsManagerModalProps {
  snippets: Snippet[];
  onSaveSnippet: (snippet: Snippet) => Promise<void>;
  onDeleteSnippet: (snippetId: string) => Promise<void>;
  onRunSnippet: (snippet: Snippet) => void;
  onClose: () => void;
  initialSelectedId?: string;
  initialPrefillBody?: string;
  isDocked?: boolean;
  onDockToView?: () => void;
}

export function SnippetsManagerModal({
  snippets,
  onSaveSnippet,
  onDeleteSnippet,
  onRunSnippet,
  onClose,
  initialSelectedId,
  initialPrefillBody,
  isDocked = false,
  onDockToView,
}: SnippetsManagerModalProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(() => {
    if (initialSelectedId) {
      const found = snippets.find((s) => s.id === initialSelectedId);
      if (found) return found;
    }
    if (initialPrefillBody) {
      return {
        id: '',
        name: 'New Snippet',
        body: initialPrefillBody,
        tags: [],
        confirmBeforeRun: true,
      };
    }
    return null;
  });

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formConfirm, setFormConfirm] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync edit form state when editingSnippet changes
  const startEdit = (snip: Snippet) => {
    setEditingSnippet(snip);
    setFormName(snip.name);
    setFormDescription(snip.description || '');
    setFormBody(snip.body);
    setFormTags((snip.tags || []).join(', '));
    setFormConfirm(snip.confirmBeforeRun);
    setError('');
  };

  const startNew = () => {
    setEditingSnippet({
      id: '',
      name: '',
      body: initialPrefillBody || '',
      tags: [],
      confirmBeforeRun: true,
    });
    setFormName('');
    setFormDescription('');
    setFormBody(initialPrefillBody || '');
    setFormTags('');
    setFormConfirm(true);
    setError('');
  };

  // Collect unique tags
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of snippets) {
      if (s.tags) {
        for (const t of s.tags) {
          if (t.trim()) set.add(t.trim().toLowerCase());
        }
      }
    }
    return Array.from(set).sort();
  }, [snippets]);

  // Filter snippets by search query and tag
  const filteredSnippets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return snippets.filter((s) => {
      if (selectedTag !== 'all') {
        const hasTag = s.tags?.some((t) => t.toLowerCase() === selectedTag);
        if (!hasTag) return false;
      }
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.body.toLowerCase().includes(q) ||
        s.tags?.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [snippets, searchQuery, selectedTag]);

  // Live variable extraction from formBody
  const detectedVariables = useMemo(() => {
    const matches = formBody.match(/\{\{([^{}]+)\}\}/g);
    if (!matches) return [];
    const set = new Set<string>();
    for (const m of matches) {
      set.add(m);
    }
    return Array.from(set);
  }, [formBody]);

  const handleInsertVariable = (varText: string) => {
    const el = bodyTextareaRef.current;
    if (el) {
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : formBody.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : formBody.length;
      const nextBody = formBody.slice(0, start) + varText + formBody.slice(end);
      const nextCursor = start + varText.length;
      setFormBody(nextBody);
      el.focus();
      setTimeout(() => {
        if (bodyTextareaRef.current) {
          bodyTextareaRef.current.focus();
          bodyTextareaRef.current.setSelectionRange(nextCursor, nextCursor);
        }
      }, 0);
    } else {
      setFormBody((prev) => prev + varText);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setError('Snippet name is required.');
      return;
    }
    if (!formBody.trim()) {
      setError('Snippet command body is required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const tagList = formTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const toSave: Snippet = {
        id: editingSnippet?.id || '',
        name: formName.trim(),
        description: formDescription.trim(),
        body: formBody,
        tags: tagList,
        confirmBeforeRun: formConfirm,
      };

      await onSaveSnippet(toSave);
      setEditingSnippet(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this snippet?')) return;
    try {
      await onDeleteSnippet(id);
      if (editingSnippet?.id === id) {
        setEditingSnippet(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const cardContent = (
      <div
        className={`${isDocked ? 'is-docked-widget modal-card' : 'cyber-dialog-card'} snippets-manager-card`}
        role={isDocked ? 'region' : undefined}
        aria-label={isDocked ? 'Docked Command Snippets' : undefined}
        style={{
          maxWidth: isDocked ? undefined : '820px',
          width: isDocked ? undefined : '94vw',
          maxHeight: isDocked ? undefined : '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          padding: 0,
        }}
      >
        {!isDocked && (
          <>
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#00f0ff', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <CyberIcon name="bolt" size={16} />
                    <span>Command Snippets</span>
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    {"DYNAMIC-SNIPPETS // INJECT {{HOST}} {{USER}} {{PORT}}"}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                {onDockToView && (
                  <button
                    type="button"
                    className="cyber-hud-btn btn-sm"
                    onClick={onDockToView}
                    aria-label="Dock Snippets to View"
                    title="Dock Command Snippets as a split panel inside the current workspace view"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <CyberIcon name="pin" size={12} />
                    <span>Dock</span>
                  </button>
                )}
                <button
                  type="button"
                  className="cyber-btn-close"
                  onClick={onClose}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
          </>
        )}

        <div className="dialog-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isDocked ? '0.75rem' : '1.25rem' }}>
        {error && <div className="error-banner">{error}</div>}

        {/* Main Content Area */}
        {!editingSnippet ? (
          <div>
            {/* Search & Actions Bar */}
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  minWidth: '220px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: '0.75rem',
                    color: '#00f0ff',
                    opacity: 0.75,
                    pointerEvents: 'none',
                    display: 'inline-flex',
                  }}
                >
                  <CyberIcon name="search" size={14} />
                </span>
                <input
                  type="text"
                  className="cyber-hud-input"
                  placeholder="Search snippets by name, tag, or command..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    paddingLeft: '2.2rem',
                    paddingRight: searchQuery ? '2rem' : '0.85rem',
                    height: '36px',
                    fontSize: '0.82rem',
                    backgroundColor: 'rgba(4, 10, 20, 0.92)',
                    border: '1px solid rgba(0, 240, 255, 0.35)',
                    color: '#e2e8f0',
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                    style={{
                      position: 'absolute',
                      right: '0.5rem',
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '2px 5px',
                      fontSize: '0.9rem',
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {allTags.length > 0 && (
                <select
                  className="cyber-hud-select"
                  value={selectedTag}
                  onChange={(e) => setSelectedTag(e.target.value)}
                  style={{ width: '145px', height: '36px' }}
                >
                  <option value="all">All Tags</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>
                      #{t}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="cyber-hud-btn btn-primary"
                onClick={startNew}
                style={{ height: '36px', padding: '0 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <CyberIcon name="plus" size={13} />
                <span>+ New Snippet</span>
              </button>
            </div>

            {/* Snippets List */}
            {filteredSnippets.length === 0 ? (
              <div className="snippets-empty-state">
                <p>No snippets found. Click "+ New Snippet" to create one.</p>
              </div>
            ) : (
              <div className="snippets-list-grid">
                {filteredSnippets.map((s) => (
                  <div key={s.id} className="snippet-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                      <div>
                        <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-bright)', fontSize: '0.92rem' }}>{s.name}</h4>
                        {s.description && (
                          <p style={{ margin: '0 0 0.4rem 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {s.description}
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-primary btn-sm"
                          onClick={() => {
                            if (!isDocked) {
                              onClose();
                            }
                            onRunSnippet(s);
                          }}
                          title="Run in active terminal session"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          <CyberIcon name="bolt" size={12} />
                          <span>Run</span>
                        </button>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-sm"
                          onClick={() => startEdit(s)}
                          title="Edit snippet"
                        >
                          <CyberIcon name="edit" size={12} />
                        </button>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-sm btn-danger"
                          onClick={() => void handleDelete(s.id)}
                          title="Delete snippet"
                        >
                          <CyberIcon name="trash" size={12} />
                        </button>
                      </div>
                    </div>

                    <pre className="snippet-card-code">
                      <code>{s.body}</code>
                    </pre>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.45rem' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {s.tags?.map((t) => (
                          <span key={t} className="snippet-tag-badge">
                            #{t}
                          </span>
                        ))}
                      </div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {s.confirmBeforeRun ? 'Confirm before run' : 'Direct run'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Edit / New Snippet Form */
          <form
            onSubmit={handleSave}
            className="snippet-edit-form"
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '0.65rem',
                borderBottom: '1px solid rgba(0, 240, 255, 0.22)',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#00f0ff', letterSpacing: '0.04em' }}>
                {editingSnippet.id ? `Edit Snippet: ${editingSnippet.name}` : 'New Command Snippet'}
              </h3>
              <button
                type="button"
                className="cyber-hud-btn btn-sm"
                onClick={() => setEditingSnippet(null)}
              >
                Back to List
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.9rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label htmlFor="snip-name" style={{ fontSize: '0.74rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Snippet Name *
                </label>
                <input
                  id="snip-name"
                  type="text"
                  className="cyber-hud-input"
                  placeholder="e.g. Inspect Nginx Logs"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{ width: '100%' }}
                  required
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label htmlFor="snip-tags" style={{ fontSize: '0.74rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Tags (comma-separated)
                </label>
                <input
                  id="snip-tags"
                  type="text"
                  className="cyber-hud-input"
                  placeholder="e.g. web, logs, nginx, linux"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label htmlFor="snip-desc" style={{ fontSize: '0.74rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Description
              </label>
              <input
                id="snip-desc"
                type="text"
                className="cyber-hud-input"
                placeholder="Optional explanation of what this command executes"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label htmlFor="snip-body" style={{ fontSize: '0.74rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Command Body *
              </label>
              <textarea
                ref={bodyTextareaRef}
                id="snip-body"
                className="cyber-hud-input"
                rows={5}
                placeholder="e.g. tail -n {{LINES=50}} {{FILE=/var/log/nginx/access.log}}"
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                style={{
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  fontSize: '0.84rem',
                  lineHeight: 1.5,
                  width: '100%',
                  resize: 'vertical',
                  padding: '0.65rem 0.85rem',
                  backgroundColor: 'rgba(3, 8, 18, 0.95)',
                  border: '1px solid rgba(0, 240, 255, 0.38)',
                  color: '#a7f3d0',
                  borderRadius: '4px',
                }}
                required
              />
            </div>

            {/* Quick-Insert Variables Helper */}
            <div
              className="snippet-var-insert-bar"
              style={{
                padding: '0.65rem 0.85rem',
                backgroundColor: 'rgba(6, 14, 26, 0.88)',
                border: '1px solid rgba(0, 240, 255, 0.2)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.45rem',
              }}
            >
              <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 600, marginRight: '0.25rem' }}>
                Insert Auto Variable:
              </span>
              <button type="button" className="btn-var-pill" onClick={() => handleInsertVariable('{{HOST}}')}>
                {`{{HOST}}`}
              </button>
              <button type="button" className="btn-var-pill" onClick={() => handleInsertVariable('{{USER}}')}>
                {`{{USER}}`}
              </button>
              <button type="button" className="btn-var-pill" onClick={() => handleInsertVariable('{{PORT}}')}>
                {`{{PORT}}`}
              </button>
              <button type="button" className="btn-var-pill" onClick={() => handleInsertVariable('{{CWD}}')}>
                {`{{CWD}}`}
              </button>
              <button type="button" className="btn-var-pill" onClick={() => handleInsertVariable('{{TIMESTAMP}}')}>
                {`{{TIMESTAMP}}`}
              </button>
              <button type="button" className="btn-var-pill" onClick={() => handleInsertVariable('{{DATE}}')}>
                {`{{DATE}}`}
              </button>
              <button type="button" className="btn-var-pill" onClick={() => handleInsertVariable('{{PASSWORD}}')}>
                {`{{PASSWORD}}`}
              </button>
              <button type="button" className="btn-var-pill" onClick={() => handleInsertVariable('{{PARAM=default}}')}>
                {`{{PARAM=default}}`}
              </button>
            </div>

            {/* Detected Variables Indicator */}
            {detectedVariables.length > 0 && (
              <div style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                <span style={{ color: '#94a3b8' }}>Detected Template Variables: </span>
                {detectedVariables.map((v) => (
                  <code
                    key={v}
                    style={{
                      padding: '0.15rem 0.45rem',
                      background: 'rgba(0, 240, 255, 0.1)',
                      border: '1px solid rgba(0, 240, 255, 0.3)',
                      color: '#00f0ff',
                      borderRadius: '3px',
                      fontFamily: 'JetBrains Mono, Consolas, monospace',
                      fontSize: '0.74rem',
                    }}
                  >
                    {v}
                  </code>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                id="snip-confirm"
                type="checkbox"
                checked={formConfirm}
                onChange={(e) => setFormConfirm(e.target.checked)}
              />
              <label htmlFor="snip-confirm" style={{ fontSize: '0.82rem', cursor: 'pointer', color: '#e2e8f0' }}>
                Always prompt and confirm parameters before execution
              </label>
            </div>

            <div className="modal-actions" style={{ marginTop: '0.4rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(0, 240, 255, 0.2)' }}>
              <button
                type="button"
                className="cyber-hud-btn"
                onClick={() => setEditingSnippet(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="cyber-hud-btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Snippet'}
              </button>
            </div>
          </form>
        )}
        </div>
      </div>
  );

  if (isDocked) {
    return cardContent;
  }

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-label="Snippets Manager"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {cardContent}
    </div>
  );
}

