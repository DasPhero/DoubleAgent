import React, { useState, useMemo } from 'react';
import { Snippet } from '../types/snippet';

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
    setFormBody((prev) => prev + varText);
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
          maxWidth: isDocked ? undefined : '780px',
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
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#00f0ff', letterSpacing: '0.06em' }}>
                    <span>⚡ </span>
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
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    onClick={onDockToView}
                    aria-label="Dock Snippets to View"
                    title="Dock Command Snippets as a split panel inside the current workspace view"
                  >
                    📌 Dock
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
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search snippets by name, tag, or command..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              {allTags.length > 0 && (
                <select
                  value={selectedTag}
                  onChange={(e) => setSelectedTag(e.target.value)}
                  style={{ width: '130px' }}
                >
                  <option value="all">All Tags</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>
                      #{t}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="cyber-btn cyber-btn-primary" onClick={startNew}>
                + New Snippet
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h4 style={{ margin: '0 0 0.2rem 0', color: 'var(--text-bright)' }}>{s.name}</h4>
                        {s.description && (
                          <p style={{ margin: '0 0 0.35rem 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {s.description}
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-primary btn-sm"
                          onClick={() => {
                            if (!isDocked) {
                              onClose();
                            }
                            onRunSnippet(s);
                          }}
                          title="Run in active terminal session"
                        >
                          ⚡ Run
                        </button>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary btn-sm"
                          onClick={() => startEdit(s)}
                          title="Edit snippet"
                        >
                          ✏
                        </button>
                        <button
                          type="button"
                          className="tab-close-btn"
                          onClick={() => handleDelete(s.id)}
                          title="Delete snippet"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    <pre className="snippet-card-code">
                      <code>{s.body}</code>
                    </pre>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem' }}>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
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
          <form onSubmit={handleSave} className="snippet-edit-form">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
                {editingSnippet.id ? `Edit Snippet: ${editingSnippet.name}` : 'New Command Snippet'}
              </h3>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary btn-sm"
                onClick={() => setEditingSnippet(null)}
              >
                Back to List
              </button>
            </div>

            <div className="settings-field-row">
              <label htmlFor="snip-name">Snippet Name *</label>
              <input
                id="snip-name"
                type="text"
                placeholder="e.g. Inspect Nginx Logs"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="settings-field-row">
              <label htmlFor="snip-desc">Description</label>
              <input
                id="snip-desc"
                type="text"
                placeholder="Optional explanation of what this command executes"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            <div className="settings-field-row">
              <label htmlFor="snip-tags">Tags (comma-separated)</label>
              <input
                id="snip-tags"
                type="text"
                placeholder="e.g. web, logs, nginx"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
              />
            </div>

            <div className="settings-field-row">
              <label htmlFor="snip-body">Command Body *</label>
              <textarea
                id="snip-body"
                rows={5}
                placeholder="e.g. tail -n {{LINES=50}} {{FILE=/var/log/nginx/access.log}}"
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '0.82rem', width: '100%', resize: 'vertical' }}
                required
              />
            </div>

            {/* Quick-Insert Variables Helper */}
            <div className="snippet-var-insert-bar">
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
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
              <div style={{ margin: '0.5rem 0', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Detected Template Variables: </span>
                {detectedVariables.map((v) => (
                  <code key={v} style={{ margin: '0 0.2rem', padding: '0.1rem 0.35rem', background: 'var(--bg-card)', borderRadius: '4px' }}>
                    {v}
                  </code>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.5rem 0' }}>
              <input
                id="snip-confirm"
                type="checkbox"
                checked={formConfirm}
                onChange={(e) => setFormConfirm(e.target.checked)}
              />
              <label htmlFor="snip-confirm" style={{ fontSize: '0.82rem', cursor: 'pointer' }}>
                Always prompt and confirm parameters before execution
              </label>
            </div>

            <div className="modal-actions" style={{ marginTop: '0.8rem' }}>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                onClick={() => setEditingSnippet(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="cyber-btn cyber-btn-primary" disabled={saving}>
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

