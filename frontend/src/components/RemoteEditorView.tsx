import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CyberIcon } from './CyberIcon';
import { RemoteEditSession, RemoteConflictInfo } from '../types/remoteEdit';

export interface RemoteEditorViewProps {
  editSession: RemoteEditSession;
  hostLabel?: string;
  onClose?: () => void;
  onSaved?: (newContent: string) => void;
  isSplitPane?: boolean;
  api?: RemoteEditApi;
  eventsOn?: (eventName: string, callback: (data: unknown) => void) => () => void;
}

// Window API declarations for Wails Go bindings
export interface RemoteEditApi {
  GetRemoteEditContent?: (editId: string) => Promise<string>;
  SaveRemoteEditContent?: (editId: string, content: string, force: boolean) => Promise<{
    success: boolean;
    conflict: boolean;
    remoteModTime: number;
    remoteSize: number;
    message: string;
  }>;
  SaveRemoteEditContentWithSudo?: (editId: string, content: string, sudoPassword: string) => Promise<{
    success: boolean;
    conflict: boolean;
    remoteModTime: number;
    remoteSize: number;
    message: string;
  }>;
  CheckRemoteConflict?: (editId: string) => Promise<RemoteConflictInfo>;
  OpenExternalEditor?: (editId: string) => Promise<void>;
  CloseRemoteEdit?: (editId: string) => Promise<void>;
}

export interface WailsRuntimeEvents {
  EventsOn?: (eventName: string, callback: (data: unknown) => void) => () => void;
}

export const RemoteEditorView: React.FC<RemoteEditorViewProps> = ({
  editSession,
  hostLabel,
  onClose,
  onSaved,
  isSplitPane = false,
  api: propsApi,
  eventsOn,
}) => {
  const [content, setContent] = useState<string>('');
  const [initialContent, setInitialContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'warning' | 'error'>('info');

  // Conflict modal state
  const [conflictInfo, setConflictInfo] = useState<RemoteConflictInfo | null>(null);
  const [showConflictModal, setShowConflictModal] = useState<boolean>(false);
  const [showSudoSaveModal, setShowSudoSaveModal] = useState<boolean>(false);
  const [sudoPassword, setSudoPassword] = useState<string>('');
  const [sudoError, setSudoError] = useState<string>('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const isDirty = content !== initialContent;

  const getApi = useCallback((): RemoteEditApi => {
    return propsApi ?? (window as unknown as { go?: { main?: { App?: RemoteEditApi } } })?.go?.main?.App ?? {};
  }, [propsApi]);

  const getRuntime = useCallback((): WailsRuntimeEvents => {
    return (eventsOn ? { EventsOn: eventsOn } : undefined) ?? (window as unknown as { runtime?: WailsRuntimeEvents })?.runtime ?? {};
  }, [eventsOn]);

  // Load initial content
  const loadContent = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage('Loading remote file...');
    setStatusType('info');
    try {
      const api = getApi();
      if (api.GetRemoteEditContent) {
        const text = await api.GetRemoteEditContent(editSession.id);
        setContent(text);
        setInitialContent(text);
        setStatusMessage('File loaded successfully.');
        setStatusType('success');
      } else {
        // Fallback demo/mock content if running in isolation
        const mock = `# Remote File: ${editSession.remotePath}\n# Staged at: ${editSession.localPath}\n\nserver {\n  listen 80;\n  server_name localhost;\n}\n`;
        setContent(mock);
        setInitialContent(mock);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Failed to load content: ${msg}`);
      setStatusType('error');
    } finally {
      setIsLoading(false);
    }
  }, [editSession.id, editSession.remotePath, editSession.localPath, getApi]);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  // Listen to background file watcher events (e.g. edited in external editor)
  useEffect(() => {
    const runtime = getRuntime();
    if (!runtime.EventsOn) return;

    const unsub = runtime.EventsOn('remote-edit:changed', (data: unknown) => {
      const evt = data as { editSessionId?: string; hasConflict?: boolean; message?: string };
      if (evt && evt.editSessionId === editSession.id) {
        if (evt.hasConflict) {
          setStatusMessage(`Parallel conflict detected! ${evt.message || ''}`);
          setStatusType('error');
        } else {
          setStatusMessage('Auto-synced external editor change to remote server.');
          setStatusType('success');
          void loadContent();
        }
      }
    });

    return () => {
      if (typeof unsub === 'function') {
        unsub();
      }
    };
  }, [editSession.id, loadContent, getRuntime]);

  // Handle Save
  const handleSave = async (force = false) => {
    setIsSaving(true);
    setStatusMessage('Uploading to remote server...');
    setStatusType('info');
    try {
      const api = getApi();
      if (api.SaveRemoteEditContent) {
        const res = await api.SaveRemoteEditContent(editSession.id, content, force);
        if (res.conflict) {
          setConflictInfo({
            hasConflict: true,
            remotePath: editSession.remotePath,
            initialModTime: editSession.initialModTime,
            remoteModTime: res.remoteModTime,
            initialSize: editSession.initialSize,
            remoteSize: res.remoteSize,
            message: res.message || 'File was modified on remote server by another process.',
          });
          setShowConflictModal(true);
          setStatusMessage('Save aborted: conflict detected on server.');
          setStatusType('error');
          return;
        }
        setInitialContent(content);
        setStatusMessage('Saved and uploaded to remote server.');
        setStatusType('success');
        setShowConflictModal(false);
        if (onSaved) {
          onSaved(content);
        }
      } else {
        setInitialContent(content);
        setStatusMessage('Saved locally (mock mode).');
        setStatusType('success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('conflict')) {
        void handleManualCheckConflict();
      } else if (lower.includes('permission') || lower.includes('denied') || lower.includes('status 3')) {
        setSudoPassword('');
        setSudoError('');
        setShowSudoSaveModal(true);
        setStatusMessage('Root privileges required to save this file.');
        setStatusType('info');
      } else {
        setStatusMessage(`Upload failed: ${msg}`);
        setStatusType('error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveWithSudo = async () => {
    setIsSaving(true);
    setSudoError('');
    setStatusMessage('Saving with sudo privileges...');
    setStatusType('info');
    try {
      const api = getApi();
      const winApp = (window as unknown as {
        go?: {
          main?: {
            App?: {
              SaveRemoteEditContentWithSudo?: RemoteEditApi['SaveRemoteEditContentWithSudo'];
            };
          };
        };
      })?.go?.main?.App;
      const sudoFn = api.SaveRemoteEditContentWithSudo || winApp?.SaveRemoteEditContentWithSudo;
      if (!sudoFn) {
        throw new Error('Elevated sudo save binding is unavailable.');
      }
      await sudoFn(editSession.id, content, sudoPassword);
      setInitialContent(content);
      setShowSudoSaveModal(false);
      setSudoPassword('');
      setStatusMessage('Saved and uploaded with sudo privileges.');
      setStatusType('success');
      if (onSaved) {
        onSaved(content);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSudoError(msg);
      setStatusMessage(`Sudo save failed: ${msg}`);
      setStatusType('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualCheckConflict = async () => {
    try {
      const api = getApi();
      if (api.CheckRemoteConflict) {
        const info = await api.CheckRemoteConflict(editSession.id);
        if (info.hasConflict) {
          setConflictInfo(info);
          setShowConflictModal(true);
          setStatusMessage('Conflict detected on remote server.');
          setStatusType('warning');
        } else {
          setStatusMessage('Clean: no remote modifications detected.');
          setStatusType('success');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Conflict check failed: ${msg}`);
      setStatusType('error');
    }
  };

  const handleOpenExternal = async () => {
    try {
      const api = getApi();
      if (api.OpenExternalEditor) {
        await api.OpenExternalEditor(editSession.id);
        setStatusMessage('Opened in system editor. Changes will auto-upload on save.');
        setStatusType('info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Failed to open external editor: ${msg}`);
      setStatusType('error');
    }
  };

  // Keyboard shortcut Ctrl+S
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void handleSave(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newText = content.substring(0, start) + '  ' + content.substring(end);
      setContent(newText);
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      }, 0);
    }
  };

  // Synchronize textarea scrolling with line numbers gutter
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const lineCount = Math.max(1, content.split('\n').length);
  const linesArray = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div className={`remote-editor-view ${isSplitPane ? 'is-split-pane' : ''}`} data-testid="remote-editor-view">
      {/* Top HUD Toolbar */}
      <div className="remote-editor-toolbar">
        <div className="editor-file-info">
          <CyberIcon name="edit" size={14} className="editor-icon" />
          <span className="editor-filename" title={editSession.remotePath}>
            {editSession.filename}
          </span>
          {hostLabel && <span className="editor-host-badge">{hostLabel}</span>}
          <span className="editor-remote-path" title={editSession.remotePath}>
            {editSession.remotePath}
          </span>
        </div>

        <div className="editor-toolbar-actions">
          {/* Status badge */}
          {isDirty ? (
            <span className="editor-status-pill dirty" title="Unsaved local modifications">
              <CyberIcon name="record" size={14} /> Unsaved
            </span>
          ) : (
            <span className="editor-status-pill clean" title="Synced with remote server">
              <CyberIcon name="check" size={14} /> Synced
            </span>
          )}

          <button
            type="button"
            className="editor-btn primary"
            onClick={() => void handleSave(false)}
            disabled={isSaving || isLoading}
            title="Save and upload to remote server (Ctrl+S)"
          >
            <CyberIcon name="save" size={13} />
            <span>{isSaving ? 'Uploading...' : 'Save Remote (Ctrl+S)'}</span>
          </button>

          <button
            type="button"
            className="editor-btn secondary"
            onClick={() => void handleOpenExternal()}
            title="Open file in default system editor (VS Code, Notepad, etc.) with auto-sync on save"
          >
            <CyberIcon name="undock" size={13} />
            <span>Open in Local Editor</span>
          </button>

          <button
            type="button"
            className="editor-btn secondary"
            onClick={() => void handleManualCheckConflict()}
            title="Check if file was modified on server by another user/process"
          >
            <CyberIcon name="shield" size={13} />
            <span>Check Conflict</span>
          </button>

          <button
            type="button"
            className="editor-btn secondary"
            onClick={() => void loadContent()}
            title="Reload content from server"
          >
            <CyberIcon name="swap" size={13} />
            <span>Reload</span>
          </button>

          {onClose && (
            <button
              type="button"
              className="editor-btn close"
              onClick={onClose}
              title="Close Remote Editor"
              aria-label="Close Remote Editor"
            >
              <CyberIcon name="close" size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Editor Body */}
      <div className="remote-editor-body">
        {isLoading ? (
          <div className="editor-loading-state">
            <CyberIcon name="wave" size={24} />
            <span>Loading remote file content...</span>
          </div>
        ) : (
          <div className="editor-workspace-deck">
            {/* Line numbers gutter */}
            <div className="editor-line-numbers" ref={lineNumbersRef} aria-hidden="true">
              {linesArray.map((line) => (
                <div key={line} className="line-number">
                  {line}
                </div>
              ))}
            </div>

            {/* Code text area */}
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              placeholder="Remote file is empty."
              aria-label={`Remote file content for ${editSession.filename}`}
            />
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="remote-editor-footer">
        <div className={`footer-status-msg ${statusType}`}>
          <span>{statusMessage}</span>
        </div>
        <div className="footer-meta">
          <span>Lines: {lineCount}</span>
          <span>Chars: {content.length}</span>
          <span>UTF-8</span>
          <span title={`Staged at ${editSession.localPath}`}>Local Cache Armed</span>
        </div>
      </div>

      {/* Parallel Modification Conflict HUD Modal */}
      {showConflictModal && conflictInfo && (
        <div className="modal-backdrop" data-testid="remote-conflict-modal">
          <div className="modal-card remote-conflict-card">
            <div className="modal-header">
              <div className="conflict-badge">
                <CyberIcon name="shield" size={16} />
                <h3>Parallel Conflict Detected!</h3>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowConflictModal(false)}
                aria-label="Dismiss Conflict Dialog"
              >
                <CyberIcon name="close" size={14} />
              </button>
            </div>

            <div className="conflict-dialog-body">
              <p className="conflict-lead">
                The file on the remote server was modified after you opened it. Overwriting it now would erase changes made by another process or user on the server.
              </p>

              <div className="conflict-meta-box">
                <div className="meta-row">
                  <span className="meta-label">Remote Target:</span>
                  <span className="meta-val">{conflictInfo.remotePath}</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">When You Opened:</span>
                  <span className="meta-val">
                    {new Date(conflictInfo.initialModTime * 1000).toLocaleTimeString()} ({conflictInfo.initialSize} bytes)
                  </span>
                </div>
                <div className="meta-row highlight">
                  <span className="meta-label">Current on Server:</span>
                  <span className="meta-val">
                    {new Date(conflictInfo.remoteModTime * 1000).toLocaleTimeString()} ({conflictInfo.remoteSize} bytes)
                  </span>
                </div>
              </div>

              <div className="conflict-actions-deck">
                <button
                  type="button"
                  className="btn-danger conflict-action-btn"
                  onClick={() => void handleSave(true)}
                  disabled={isSaving}
                >
                  <CyberIcon name="bolt" size={13} />
                  <span>Overwrite Remote (Force Upload)</span>
                </button>

                <button
                  type="button"
                  className="btn-secondary conflict-action-btn"
                  onClick={() => {
                    setShowConflictModal(false);
                    void loadContent();
                  }}
                >
                  <CyberIcon name="swap" size={13} />
                  <span>Discard Local &amp; Reload Server Version</span>
                </button>

                <button
                  type="button"
                  className="btn-secondary conflict-action-btn"
                  onClick={() => setShowConflictModal(false)}
                >
                  <span>Cancel / Keep Local Unsaved</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Elevated Sudo Save Password Prompt Modal */}
      {showSudoSaveModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Elevated Sudo Save"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSaving) {
              setShowSudoSaveModal(false);
              setSudoPassword('');
            }
          }}
        >
          <div className="cyber-totp-hud-modal" style={{ width: 'min(440px, 92vw)' }}>
            <div className="cyber-totp-hud-header">
              <div className="cyber-totp-hud-title-row">
                <CyberIcon name="shield" size={16} />
                <span className="cyber-totp-hud-title">ELEVATED SAVE // SUDO REQUIRED</span>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                aria-label="Close"
                disabled={isSaving}
                onClick={() => {
                  setShowSudoSaveModal(false);
                  setSudoPassword('');
                }}
              >
                <CyberIcon name="close" size={14} />
              </button>
            </div>
            <div style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Permission denied writing <code>{editSession.remotePath}</code>. Enter your <code>sudo</code> password to
                save with elevated privileges:
              </p>
              <input
                type="password"
                className="cyber-hud-input"
                aria-label="Sudo Save Password"
                placeholder="sudo password (sent via stdin only)..."
                autoFocus
                value={sudoPassword}
                onChange={(e) => setSudoPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isSaving) {
                    void handleSaveWithSudo();
                  }
                }}
              />
              {sudoError && <div className="modal-error-banner">{sudoError}</div>}
              <div className="cyber-dialog-actions">
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-primary"
                  disabled={isSaving}
                  onClick={() => void handleSaveWithSudo()}
                >
                  <CyberIcon name="save" size={13} />
                  <span>{isSaving ? 'Saving with sudo...' : 'Save with sudo'}</span>
                </button>
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-cancel"
                  disabled={isSaving}
                  onClick={() => {
                    setShowSudoSaveModal(false);
                    setSudoPassword('');
                  }}
                >
                  <span>Cancel</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
