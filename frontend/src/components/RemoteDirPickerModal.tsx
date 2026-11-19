import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CyberIcon } from './CyberIcon';
import type { RemoteDirListing } from '../types/remoteAgent';

export interface RemoteDirPickerModalProps {
  isOpen: boolean;
  agentLabel: string;
  initialPath: string;
  onListDir: (dirPath: string) => Promise<RemoteDirListing>;
  onMkdir: (dirPath: string) => Promise<void>;
  onSelectDir: (dirPath: string) => void;
  onOpenShellInDir: (dirPath: string) => void;
  onClose: () => void;
}

export const RemoteDirPickerModal: React.FC<RemoteDirPickerModalProps> = ({
  isOpen,
  agentLabel,
  initialPath,
  onListDir,
  onMkdir,
  onSelectDir,
  onOpenShellInDir,
  onClose,
}) => {
  const [currentPath, setCurrentPath] = useState(initialPath || '~');
  const [pathInput, setPathInput] = useState(initialPath || '~');
  const [listing, setListing] = useState<RemoteDirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newFolderName, setNewFolderName] = useState('');

  // Keep stable refs so parent background polling / re-renders never reset the browsed path.
  const onListDirRef = useRef(onListDir);
  onListDirRef.current = onListDir;
  const onMkdirRef = useRef(onMkdir);
  onMkdirRef.current = onMkdir;
  const wasOpenRef = useRef(false);

  const loadPath = useCallback(async (target: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await onListDirRef.current(target);
      setListing(res);
      setCurrentPath(res.path);
      setPathInput(res.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      void loadPath(initialPath || '~');
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, initialPath, loadPath]);

  if (!isOpen) return null;

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const sep = currentPath.endsWith('/') ? '' : '/';
    const target = `${currentPath}${sep}${trimmed}`;
    setError('');
    try {
      await onMkdirRef.current(target);
      setNewFolderName('');
      await loadPath(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Remote Directory Browser"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cyber-totp-hud-modal remote-dir-modal">
        <div className="cyber-totp-hud-header">
          <div className="cyber-totp-hud-title-row">
            <CyberIcon name="folder" size={16} />
            <span className="cyber-totp-hud-title">REMOTE DIRECTORIES // {agentLabel.toUpperCase()}</span>
          </div>
          <button type="button" className="cyber-btn-close" aria-label="Close" onClick={onClose}>
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        <div className="remote-dir-body">
          <div className="remote-dir-toolbar">
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              disabled={!listing?.parent || loading}
              onClick={() => listing?.parent && void loadPath(listing.parent)}
              title="Parent directory"
            >
              <CyberIcon name="chevron-up" size={12} />
              <span>Up</span>
            </button>
            <input
              type="text"
              className="cyber-hud-input remote-dir-path-input"
              aria-label="Remote Directory Path"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void loadPath(pathInput);
                }
              }}
            />
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              disabled={loading}
              onClick={() => void loadPath(pathInput)}
            >
              <CyberIcon name="refresh" size={12} />
              <span>Go</span>
            </button>
          </div>

          {error && <div className="modal-error-banner">{error}</div>}

          <div className="remote-dir-list">
            {loading ? (
              <div className="remote-dir-empty">Loading remote directory...</div>
            ) : !listing || listing.entries.length === 0 ? (
              <div className="remote-dir-empty">Directory is empty.</div>
            ) : (
              listing.entries.map((entry) => (
                <button
                  key={entry.fullPath}
                  type="button"
                  className={`remote-dir-entry ${entry.isDir ? 'is-dir' : 'is-file'}`}
                  onClick={() => {
                    if (entry.isDir) {
                      void loadPath(entry.fullPath);
                    }
                  }}
                >
                  <CyberIcon name={entry.isDir ? 'folder' : 'file'} size={13} />
                  <span className="remote-dir-entry-name">{entry.name}</span>
                  {!entry.isDir && (
                    <span className="remote-dir-entry-size">{entry.size.toLocaleString()} B</span>
                  )}
                </button>
              ))
            )}
          </div>

          <div className="remote-dir-mkdir-row">
            <input
              type="text"
              className="cyber-hud-input remote-dir-path-input"
              aria-label="New Folder Name"
              placeholder="New folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleCreateFolder();
                }
              }}
            />
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              disabled={!newFolderName.trim() || loading}
              onClick={() => void handleCreateFolder()}
            >
              <CyberIcon name="plus" size={12} />
              <span>New Folder</span>
            </button>
          </div>

          <div className="cyber-dialog-actions">
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={() => {
                onOpenShellInDir(currentPath);
                onClose();
              }}
            >
              <CyberIcon name="terminal" size={13} />
              <span>Open Shell Here</span>
            </button>
            <button
              type="button"
              className="cyber-hud-btn btn-sm btn-primary"
              onClick={() => {
                onSelectDir(currentPath);
                onClose();
              }}
            >
              <CyberIcon name="check" size={13} />
              <span>Use as Staging Dir</span>
            </button>
            <button type="button" className="cyber-hud-btn btn-sm btn-cancel" onClick={onClose}>
              <span>Close</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
