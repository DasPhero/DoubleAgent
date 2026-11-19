import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CyberIcon } from './CyberIcon';
import { FileItem, TransferTask, TransferProgressEvent } from '../types/sftp';
import { RemoteEditSession } from '../types/remoteEdit';

export interface SftpApi {
  listLocalDir?: (path: string) => Promise<FileItem[]>;
  listRemoteDir?: (sessionId: string, path: string) => Promise<FileItem[]>;
  startSftpUpload?: (sessionId: string, localPath: string, remotePath: string) => Promise<string>;
  startSftpDownload?: (sessionId: string, remotePath: string, localPath: string) => Promise<string>;
  createRemoteDir?: (sessionId: string, path: string) => Promise<void>;
  deleteRemoteItem?: (sessionId: string, path: string) => Promise<void>;
  cancelTransfer?: (taskId: string) => Promise<void>;
  getActiveTransfers?: () => Promise<TransferTask[]>;
  startRemoteEdit?: (sessionId: string, remotePath: string) => Promise<RemoteEditSession>;
}

export interface SftpBrowserViewProps {
  sessionId: string;
  hostLabel?: string;
  initialLocalPath?: string;
  initialRemotePath?: string;
  api: SftpApi;
  eventsOn?: (eventName: string, callback: (data: unknown) => void) => () => void;
  onClose?: () => void;
  onOpenRemoteEdit?: (session: RemoteEditSession) => void;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatTimestamp(unixSec: number): string {
  if (!unixSec) return '-';
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizePath(p: string): string {
  if (!p) return '.';
  return p.replace(/\\/g, '/');
}

function getParentPath(p: string): string {
  const norm = normalizePath(p).replace(/\/+$/, '');
  if (norm === '.' || norm === '' || norm === '/') return norm || '/';
  // Windows drive root: "C:" or "C:/"
  if (/^[A-Za-z]:$/.test(norm)) {
    return `${norm}/`;
  }
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= 1) {
    if (/^[A-Za-z]:$/.test(parts[0] || '')) {
      return `${parts[0]}/`;
    }
    return norm.startsWith('/') ? '/' : '.';
  }
  parts.pop();
  if (parts.length === 1 && /^[A-Za-z]:$/.test(parts[0])) {
    return `${parts[0]}/`;
  }
  return (norm.startsWith('/') ? '/' : '') + parts.join('/');
}

function joinPath(base: string, child: string): string {
  const normBase = normalizePath(base);
  if (normBase === '.' || normBase === '') return child;
  if (normBase.endsWith('/')) return normBase + child;
  return `${normBase}/${child}`;
}

export function SftpBrowserView({
  sessionId,
  hostLabel = 'Remote SFTP',
  initialLocalPath = '.',
  initialRemotePath = '.',
  api,
  eventsOn,
  onClose,
  onOpenRemoteEdit,
}: SftpBrowserViewProps): React.JSX.Element {
  // Local Pane State
  const [localPath, setLocalPath] = useState<string>(initialLocalPath);
  const [localInputPath, setLocalInputPath] = useState<string>(initialLocalPath);
  const [localItems, setLocalItems] = useState<FileItem[]>([]);
  const [localLoading, setLocalLoading] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string>('');
  const [selectedLocalItem, setSelectedLocalItem] = useState<FileItem | null>(null);
  const [localSortBy, setLocalSortBy] = useState<'name' | 'size' | 'modTime'>('name');
  const [localSortAsc, setLocalSortAsc] = useState<boolean>(true);
  const [isLocalDropTarget, setIsLocalDropTarget] = useState<boolean>(false);

  // Remote Pane State
  const [remotePath, setRemotePath] = useState<string>(initialRemotePath);
  const [remoteInputPath, setRemoteInputPath] = useState<string>(initialRemotePath);
  const [remoteItems, setRemoteItems] = useState<FileItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState<boolean>(false);
  const [remoteError, setRemoteError] = useState<string>('');
  const [selectedRemoteItem, setSelectedRemoteItem] = useState<FileItem | null>(null);
  const [remoteSortBy, setRemoteSortBy] = useState<'name' | 'size' | 'modTime'>('name');
  const [remoteSortAsc, setRemoteSortAsc] = useState<boolean>(true);
  const [isRemoteDropTarget, setIsRemoteDropTarget] = useState<boolean>(false);

  // Transfer Queue State
  const [transfers, setTransfers] = useState<TransferTask[]>([]);
  const [queueOpen, setQueueOpen] = useState<boolean>(true);

  // Modals & Prompts
  const [showMkdirModal, setShowMkdirModal] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [itemToDelete, setItemToDelete] = useState<FileItem | null>(null);
  const [sudoEditTarget, setSudoEditTarget] = useState<FileItem | null>(null);
  const [sudoPassword, setSudoPassword] = useState<string>('');
  const [sudoBusy, setSudoBusy] = useState<boolean>(false);
  const [sudoError, setSudoError] = useState<string>('');

  // Keep a stable ref to api so parent re-renders (e.g. menu hover) never reset SFTP directories.
  const apiRef = useRef<SftpApi>(api);
  apiRef.current = api;

  // Load Local Files
  const loadLocalDir = useCallback(async (path: string) => {
    const fn = apiRef.current.listLocalDir;
    if (!fn) return;
    setLocalLoading(true);
    setLocalError('');
    try {
      const items = await fn(path);
      const list = items || [];
      setLocalItems(list);
      let resolvedPath = path;
      if ((path === '.' || path === '') && list.length > 0 && list[0].path) {
        resolvedPath = getParentPath(list[0].path);
      }
      setLocalPath(resolvedPath);
      setLocalInputPath(resolvedPath);
      setSelectedLocalItem(null);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalLoading(false);
    }
  }, []);

  // Load Remote Files
  const loadRemoteDir = useCallback(
    async (path: string) => {
      const fn = apiRef.current.listRemoteDir;
      if (!fn) return;
      setRemoteLoading(true);
      setRemoteError('');
      try {
        const items = await fn(sessionId, path);
        const list = items || [];
        setRemoteItems(list);
        let resolvedPath = path;
        if ((path === '.' || path === '') && list.length > 0 && list[0].path) {
          const derived = getParentPath(list[0].path);
          if (derived && derived !== '.') {
            resolvedPath = derived;
          }
        }
        setRemotePath(resolvedPath);
        setRemoteInputPath(resolvedPath);
        setSelectedRemoteItem(null);
      } catch (err: unknown) {
        setRemoteError(err instanceof Error ? err.message : String(err));
      } finally {
        setRemoteLoading(false);
      }
    },
    [sessionId]
  );

  // Initial fetch (only when sessionId or explicit initial paths change, never on parent hover re-render)
  useEffect(() => {
    void loadLocalDir(initialLocalPath);
    void loadRemoteDir(initialRemotePath);
    if (apiRef.current.getActiveTransfers) {
      void apiRef.current.getActiveTransfers().then((tasks) => {
        if (tasks) setTransfers(tasks);
      });
    }
  }, [loadLocalDir, loadRemoteDir, initialLocalPath, initialRemotePath]);

  // Subscribe to Wails transfer progress events
  useEffect(() => {
    if (!eventsOn) return;
    const unsub = eventsOn('sftp:progress', (evtRaw: unknown) => {
      const evt = evtRaw as TransferProgressEvent;
      if (!evt || !evt.taskId) return;

      setTransfers((prev) => {
        const existingIdx = prev.findIndex((t) => t.id === evt.taskId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            transferredBytes: evt.transferredBytes,
            totalBytes: evt.totalBytes || updated[existingIdx].totalBytes,
            speedBytesPerSec: evt.speedBytesPerSec,
            status: evt.status,
            error: evt.error,
          };
          return updated;
        }
        return prev;
      });

      // If finished, refresh directory listing
      if (evt.status === 'completed') {
        loadLocalDir(localPath);
        loadRemoteDir(remotePath);
      }
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [eventsOn, localPath, remotePath, loadLocalDir, loadRemoteDir]);

  // Upload handler
  const handleStartUpload = async (localFile: FileItem) => {
    if (!api.startSftpUpload) return;
    const destRemote = joinPath(remotePath, localFile.name);
    try {
      const taskId = await api.startSftpUpload(sessionId, localFile.path, destRemote);
      const newTask: TransferTask = {
        id: taskId,
        sessionId,
        direction: 'upload',
        localPath: localFile.path,
        remotePath: destRemote,
        totalBytes: localFile.size,
        transferredBytes: 0,
        speedBytesPerSec: 0,
        status: 'running',
      };
      setTransfers((prev) => [newTask, ...prev.filter((t) => t.id !== taskId)]);
      setQueueOpen(true);
    } catch (err: unknown) {
      alert(`Upload failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Download handler
  const handleStartDownload = async (remoteFile: FileItem) => {
    if (!api.startSftpDownload) return;
    const destLocal = joinPath(localPath, remoteFile.name);
    try {
      const taskId = await api.startSftpDownload(sessionId, remoteFile.path, destLocal);
      const newTask: TransferTask = {
        id: taskId,
        sessionId,
        direction: 'download',
        localPath: destLocal,
        remotePath: remoteFile.path,
        totalBytes: remoteFile.size,
        transferredBytes: 0,
        speedBytesPerSec: 0,
        status: 'running',
      };
      setTransfers((prev) => [newTask, ...prev.filter((t) => t.id !== taskId)]);
      setQueueOpen(true);
    } catch (err: unknown) {
      alert(`Download failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Cancel transfer handler
  const handleCancelTransfer = async (taskId: string) => {
    if (!api.cancelTransfer) return;
    try {
      await api.cancelTransfer(taskId);
      setTransfers((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'cancelled' } : t))
      );
    } catch (err: unknown) {
      console.error('Cancel transfer failed:', err);
    }
  };

  // Create folder handler
  const handleCreateRemoteFolder = async () => {
    if (!api.createRemoteDir || !newFolderName.trim()) return;
    const target = joinPath(remotePath, newFolderName.trim());
    try {
      await api.createRemoteDir(sessionId, target);
      setShowMkdirModal(false);
      setNewFolderName('');
      loadRemoteDir(remotePath);
    } catch (err: unknown) {
      alert(`Create folder failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Delete remote item handler
  const handleDeleteRemoteItem = async () => {
    if (!api.deleteRemoteItem || !itemToDelete) return;
    try {
      await api.deleteRemoteItem(sessionId, itemToDelete.path);
      setShowDeleteModal(false);
      setItemToDelete(null);
      loadRemoteDir(remotePath);
    } catch (err: unknown) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Remote File Edit handler (F-28)
  const handleStartRemoteEdit = async (item: FileItem) => {
    const isDir = item.IsDir ?? item.isDir;
    if (isDir) return;
    try {
      let sess: RemoteEditSession | null = null;
      if (apiRef.current.startRemoteEdit) {
        sess = await apiRef.current.startRemoteEdit(sessionId, item.path);
      } else {
        const appApi = (window as unknown as { go?: { main?: { App?: { StartRemoteEdit?: (sid: string, p: string) => Promise<RemoteEditSession> } } } })?.go?.main?.App;
        if (appApi?.StartRemoteEdit) {
          sess = await appApi.StartRemoteEdit(sessionId, item.path);
        }
      }
      if (sess && onOpenRemoteEdit) {
        onOpenRemoteEdit(sess);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('permission') || lower.includes('denied') || lower.includes('status 3')) {
        setSudoEditTarget(item);
        setSudoPassword('');
        setSudoError('');
        return;
      }
      setRemoteError(`Start Remote Edit failed: ${msg}`);
    }
  };

  const handleConfirmSudoEdit = async () => {
    if (!sudoEditTarget) return;
    setSudoBusy(true);
    setSudoError('');
    try {
      const appApi = (window as unknown as {
        go?: {
          main?: {
            App?: {
              StartRemoteEditWithSudo?: (sid: string, p: string, pw: string) => Promise<RemoteEditSession>;
            };
          };
        };
      })?.go?.main?.App;
      if (!appApi?.StartRemoteEditWithSudo) {
        throw new Error('Elevated sudo edit binding is unavailable.');
      }
      const sess = await appApi.StartRemoteEditWithSudo(sessionId, sudoEditTarget.path, sudoPassword);
      setSudoEditTarget(null);
      setSudoPassword('');
      if (sess && onOpenRemoteEdit) {
        onOpenRemoteEdit(sess);
      }
    } catch (err: unknown) {
      setSudoError(err instanceof Error ? err.message : String(err));
    } finally {
      setSudoBusy(false);
    }
  };

  // Drag and Drop
  const handleDragStart = (e: React.DragEvent, origin: 'local' | 'remote', item: FileItem) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ origin, path: item.path, name: item.name, isDir: item.IsDir ?? item.isDir, size: item.size })
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOverLocal = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsLocalDropTarget(true);
  };

  const handleDragLeaveLocal = () => {
    setIsLocalDropTarget(false);
  };

  const handleDropLocal = (e: React.DragEvent) => {
    e.preventDefault();
    setIsLocalDropTarget(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data && data.origin === 'remote') {
        handleStartDownload({
          name: data.name,
          path: data.path,
          size: data.size,
          isDir: data.isDir,
          modTime: 0,
          permissions: '',
        });
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  };

  const handleDragOverRemote = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsRemoteDropTarget(true);
  };

  const handleDragLeaveRemote = () => {
    setIsRemoteDropTarget(false);
  };

  const handleDropRemote = (e: React.DragEvent) => {
    e.preventDefault();
    setIsRemoteDropTarget(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data && data.origin === 'local') {
        handleStartUpload({
          name: data.name,
          path: data.path,
          size: data.size,
          isDir: data.isDir,
          modTime: 0,
          permissions: '',
        });
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  };

  // Sorting
  const sortItems = (items: FileItem[], sortBy: 'name' | 'size' | 'modTime', asc: boolean) => {
    return [...items].sort((a, b) => {
      const aDir = a.IsDir ?? a.isDir;
      const bDir = b.IsDir ?? b.isDir;
      // Directories always come first
      if (aDir && !bDir) return -1;
      if (!aDir && bDir) return 1;

      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      } else if (sortBy === 'size') {
        cmp = a.size - b.size;
      } else if (sortBy === 'modTime') {
        cmp = a.modTime - b.modTime;
      }
      return asc ? cmp : -cmp;
    });
  };

  const sortedLocal = sortItems(localItems, localSortBy, localSortAsc);
  const sortedRemote = sortItems(remoteItems, remoteSortBy, remoteSortAsc);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#0a0e14',
        color: '#e6edf3',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          backgroundColor: '#161b22',
          borderBottom: '1px solid #30363d',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--accent-bright)' }}>
            SFTP Browser
          </span>
          <span style={{ color: '#8b949e' }}>•</span>
          <span style={{ color: '#c9d1d9' }}>Session: {sessionId} ({hostLabel})</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setQueueOpen((o) => !o)}
            style={{
              padding: '4px 10px',
              backgroundColor: queueOpen ? '#21262d' : '#1f6feb',
              color: '#fff',
              border: '1px solid #30363d',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {queueOpen ? 'Hide Queue' : `Transfers (${transfers.length})`}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '4px 10px',
                backgroundColor: '#21262d',
                color: '#f85149',
                border: '1px solid #30363d',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Two-Column Browser Body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Local Panel */}
        <div
          onDragOver={handleDragOverLocal}
          onDragLeave={handleDragLeaveLocal}
          onDrop={handleDropLocal}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #30363d',
            backgroundColor: isLocalDropTarget ? '#13233a' : '#0d1117',
            transition: 'background-color 0.15s ease',
            minWidth: 0,
          }}
        >
          {/* Local Path Navigation */}
          <div
            style={{
              padding: '6px 10px',
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              backgroundColor: '#161b22',
              borderBottom: '1px solid #21262d',
            }}
          >
            <span style={{ fontWeight: 600, color: '#7ee787', fontSize: '12px' }}>LOCAL</span>
            <button
              title="Go Up"
              onClick={() => loadLocalDir(getParentPath(localPath))}
              style={{
                padding: '2px 8px',
                backgroundColor: '#21262d',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: '3px',
                cursor: 'pointer',
              }}
            >
              <CyberIcon name="chevron-up" size={14} /> Up
            </button>
            <input
              type="text"
              value={localInputPath}
              onChange={(e) => setLocalInputPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadLocalDir(localInputPath);
              }}
              style={{
                flex: 1,
                padding: '3px 8px',
                backgroundColor: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: '3px',
                fontSize: '12px',
              }}
            />
            <button
              title="Refresh"
              onClick={() => loadLocalDir(localPath)}
              style={{
                padding: '2px 8px',
                backgroundColor: '#21262d',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: '3px',
                cursor: 'pointer',
              }}
            >
              <CyberIcon name="refresh" size={14} />
            </button>
            {selectedLocalItem && !(selectedLocalItem.IsDir ?? selectedLocalItem.isDir) && (
              <button
                title="Upload to Remote"
                onClick={() => handleStartUpload(selectedLocalItem)}
                style={{
                  padding: '2px 10px',
                  backgroundColor: '#238636',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                Upload <CyberIcon name="arrow-right" size={14} />
              </button>
            )}
          </div>

          {localError && (
            <div style={{ padding: '6px 12px', backgroundColor: '#3e1b1e', color: '#ff7b72', fontSize: '12px' }}>
              {localError}
            </div>
          )}

          {/* Local File Table Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px, 1fr) 85px 125px 75px',
              padding: '4px 10px',
              backgroundColor: '#161b22',
              color: '#8b949e',
              fontSize: '11px',
              fontWeight: 600,
              borderBottom: '1px solid #30363d',
              userSelect: 'none',
            }}
          >
            <div
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (localSortBy === 'name') setLocalSortAsc(!localSortAsc);
                else {
                  setLocalSortBy('name');
                  setLocalSortAsc(true);
                }
              }}
            >
              Name {localSortBy === 'name' ? (localSortAsc ? <CyberIcon name="chevron-up" size={12} /> : <CyberIcon name="chevron-down" size={12} />) : ''}
            </div>
            <div
              style={{ cursor: 'pointer', textAlign: 'right' }}
              onClick={() => {
                if (localSortBy === 'size') setLocalSortAsc(!localSortAsc);
                else {
                  setLocalSortBy('size');
                  setLocalSortAsc(true);
                }
              }}
            >
              Size {localSortBy === 'size' ? (localSortAsc ? <CyberIcon name="chevron-up" size={12} /> : <CyberIcon name="chevron-down" size={12} />) : ''}
            </div>
            <div
              style={{ cursor: 'pointer', textAlign: 'right' }}
              onClick={() => {
                if (localSortBy === 'modTime') setLocalSortAsc(!localSortAsc);
                else {
                  setLocalSortBy('modTime');
                  setLocalSortAsc(true);
                }
              }}
            >
              Modified {localSortBy === 'modTime' ? (localSortAsc ? <CyberIcon name="chevron-up" size={12} /> : <CyberIcon name="chevron-down" size={12} />) : ''}
            </div>
            <div style={{ textAlign: 'right' }}>Mode</div>
          </div>

          {/* Local File List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {localLoading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#8b949e' }}>Loading local directory...</div>
            ) : sortedLocal.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#8b949e' }}>Empty folder</div>
            ) : (
              sortedLocal.map((item) => {
                const isDir = item.IsDir ?? item.isDir;
                const isSelected = selectedLocalItem?.path === item.path;
                return (
                  <div
                    key={item.path}
                    draggable={!isDir}
                    onDragStart={(e) => handleDragStart(e, 'local', item)}
                    onClick={() => setSelectedLocalItem(item)}
                    onDoubleClick={() => {
                      if (isDir) {
                        loadLocalDir(item.path);
                      }
                    }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(140px, 1fr) 85px 125px 75px',
                      padding: '4px 10px',
                      backgroundColor: isSelected ? '#1f6feb26' : 'transparent',
                      borderBottom: '1px solid #161b22',
                      cursor: isDir ? 'pointer' : 'grab',
                      userSelect: 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>{isDir ? <CyberIcon name="folder" size={14} /> : <CyberIcon name="file" size={14} />}</span>
                      <span
                        style={{
                          color: isDir ? '#79c0ff' : '#e6edf3',
                          fontWeight: isDir ? 600 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.name}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right', color: '#8b949e' }}>
                      {isDir ? '-' : formatBytes(item.size)}
                    </div>
                    <div style={{ textAlign: 'right', color: '#8b949e' }}>
                      {formatTimestamp(item.modTime)}
                    </div>
                    <div style={{ textAlign: 'right', color: '#8b949e', fontFamily: 'monospace', fontSize: '11px' }}>
                      {item.permissions || '-'}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Remote Panel */}
        <div
          onDragOver={handleDragOverRemote}
          onDragLeave={handleDragLeaveRemote}
          onDrop={handleDropRemote}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: isRemoteDropTarget ? '#13233a' : '#0d1117',
            transition: 'background-color 0.15s ease',
            minWidth: 0,
          }}
        >
          {/* Remote Path Navigation */}
          <div
            style={{
              padding: '6px 10px',
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              backgroundColor: '#161b22',
              borderBottom: '1px solid #21262d',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--accent-bright)', fontSize: '12px' }}>REMOTE</span>
            <button
              title="Go Up"
              onClick={() => loadRemoteDir(getParentPath(remotePath))}
              style={{
                padding: '2px 8px',
                backgroundColor: '#21262d',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: '3px',
                cursor: 'pointer',
              }}
            >
              <CyberIcon name="chevron-up" size={14} /> Up
            </button>
            <input
              type="text"
              value={remoteInputPath}
              onChange={(e) => setRemoteInputPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadRemoteDir(remoteInputPath);
              }}
              style={{
                flex: 1,
                padding: '3px 8px',
                backgroundColor: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: '3px',
                fontSize: '12px',
              }}
            />
            <button
              title="Refresh"
              onClick={() => loadRemoteDir(remotePath)}
              style={{
                padding: '2px 8px',
                backgroundColor: '#21262d',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: '3px',
                cursor: 'pointer',
              }}
            >
              <CyberIcon name="refresh" size={14} />
            </button>
            <button
              title="New Folder"
              onClick={() => setShowMkdirModal(true)}
              style={{
                padding: '2px 8px',
                backgroundColor: '#21262d',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: '3px',
                cursor: 'pointer',
              }}
            >
              <CyberIcon name="folder" size={14} />+
            </button>
            {selectedRemoteItem && (
              <>
                {!(selectedRemoteItem.IsDir ?? selectedRemoteItem.isDir) && (
                  <>
                    <button
                      title="Edit Remote File"
                      onClick={() => void handleStartRemoteEdit(selectedRemoteItem)}
                      style={{
                        padding: '2px 10px',
                        backgroundColor: 'rgba(45, 212, 191, 0.2)',
                        color: 'var(--accent-glow)',
                        border: '1px solid rgba(45, 212, 191, 0.4)',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <CyberIcon name="edit" size={14} /> Edit
                    </button>
                    <button
                      title="Download to Local"
                      onClick={() => handleStartDownload(selectedRemoteItem)}
                      style={{
                        padding: '2px 10px',
                        backgroundColor: '#1f6feb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <CyberIcon name="download" size={14} /> Download
                    </button>
                  </>
                )}
                <button
                  title="Delete Item"
                  onClick={() => {
                    setItemToDelete(selectedRemoteItem);
                    setShowDeleteModal(true);
                  }}
                  style={{
                    padding: '2px 8px',
                    backgroundColor: '#da3633',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  <CyberIcon name="trash" size={14} />
                </button>
              </>
            )}
          </div>

          {remoteError && (
            <div style={{ padding: '6px 12px', backgroundColor: '#3e1b1e', color: '#ff7b72', fontSize: '12px' }}>
              {remoteError}
            </div>
          )}

          {/* Remote File Table Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px, 1fr) 85px 125px 75px',
              padding: '4px 10px',
              backgroundColor: '#161b22',
              color: '#8b949e',
              fontSize: '11px',
              fontWeight: 600,
              borderBottom: '1px solid #30363d',
              userSelect: 'none',
            }}
          >
            <div
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (remoteSortBy === 'name') setRemoteSortAsc(!remoteSortAsc);
                else {
                  setRemoteSortBy('name');
                  setRemoteSortAsc(true);
                }
              }}
            >
              Name {remoteSortBy === 'name' ? (remoteSortAsc ? <CyberIcon name="chevron-up" size={12} /> : <CyberIcon name="chevron-down" size={12} />) : ''}
            </div>
            <div
              style={{ cursor: 'pointer', textAlign: 'right' }}
              onClick={() => {
                if (remoteSortBy === 'size') setRemoteSortAsc(!remoteSortAsc);
                else {
                  setRemoteSortBy('size');
                  setRemoteSortAsc(true);
                }
              }}
            >
              Size {remoteSortBy === 'size' ? (remoteSortAsc ? <CyberIcon name="chevron-up" size={12} /> : <CyberIcon name="chevron-down" size={12} />) : ''}
            </div>
            <div
              style={{ cursor: 'pointer', textAlign: 'right' }}
              onClick={() => {
                if (remoteSortBy === 'modTime') setRemoteSortAsc(!remoteSortAsc);
                else {
                  setRemoteSortBy('modTime');
                  setRemoteSortAsc(true);
                }
              }}
            >
              Modified {remoteSortBy === 'modTime' ? (remoteSortAsc ? <CyberIcon name="chevron-up" size={12} /> : <CyberIcon name="chevron-down" size={12} />) : ''}
            </div>
            <div style={{ textAlign: 'right' }}>Mode</div>
          </div>

          {/* Remote File List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {remoteLoading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#8b949e' }}>Loading remote directory...</div>
            ) : sortedRemote.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#8b949e' }}>Empty folder</div>
            ) : (
              sortedRemote.map((item) => {
                const isDir = item.IsDir ?? item.isDir;
                const isSelected = selectedRemoteItem?.path === item.path;
                return (
                  <div
                    key={item.path}
                    draggable={!isDir}
                    onDragStart={(e) => handleDragStart(e, 'remote', item)}
                    onClick={() => setSelectedRemoteItem(item)}
                    onDoubleClick={() => {
                      if (isDir) {
                        loadRemoteDir(item.path);
                      } else {
                        void handleStartRemoteEdit(item);
                      }
                    }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(140px, 1fr) 85px 125px 75px',
                      padding: '4px 10px',
                      backgroundColor: isSelected ? '#1f6feb26' : 'transparent',
                      borderBottom: '1px solid #161b22',
                      cursor: isDir ? 'pointer' : 'grab',
                      userSelect: 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>{isDir ? <CyberIcon name="folder" size={14} /> : <CyberIcon name="file" size={14} />}</span>
                      <span
                        style={{
                          color: isDir ? '#79c0ff' : '#e6edf3',
                          fontWeight: isDir ? 600 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.name}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right', color: '#8b949e' }}>
                      {isDir ? '-' : formatBytes(item.size)}
                    </div>
                    <div style={{ textAlign: 'right', color: '#8b949e' }}>
                      {formatTimestamp(item.modTime)}
                    </div>
                    <div style={{ textAlign: 'right', color: '#8b949e', fontFamily: 'monospace', fontSize: '11px' }}>
                      {item.permissions || '-'}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Transfer Queue Drawer */}
      {queueOpen && (
        <div
          style={{
            maxHeight: '180px',
            minHeight: '80px',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#161b22',
            borderTop: '2px solid #30363d',
          }}
        >
          <div
            style={{
              padding: '4px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#21262d',
              fontSize: '11px',
              fontWeight: 600,
              color: '#8b949e',
            }}
          >
            <span>TRANSFER QUEUE ({transfers.length})</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setTransfers((prev) => prev.filter((t) => t.status === 'running' || t.status === 'queued'))}
                style={{
                  padding: '1px 6px',
                  backgroundColor: 'transparent',
                  color: '#8b949e',
                  border: '1px solid #30363d',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
              >
                Clear Finished
              </button>
              <button
                onClick={() => setQueueOpen(false)}
                style={{
                  padding: '1px 6px',
                  backgroundColor: 'transparent',
                  color: '#8b949e',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
              >
                <CyberIcon name="chevron-down" size={14} /> Minimize
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
            {transfers.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', color: '#8b949e', fontSize: '11px' }}>
                No active or queued transfers. Drag files between panels or use Upload/Download buttons.
              </div>
            ) : (
              transfers.map((task) => {
                const percent =
                  task.totalBytes > 0
                    ? Math.min(100, (task.transferredBytes / task.totalBytes) * 100)
                    : 0;
                const isRunning = task.status === 'running' || task.status === 'queued';
                const statusColor =
                  task.status === 'completed'
                    ? '#3fb950'
                    : task.status === 'failed'
                      ? '#f85149'
                      : task.status === 'cancelled'
                        ? '#d29922'
                        : 'var(--accent-bright)';

                return (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '4px 8px',
                      backgroundColor: '#0d1117',
                      borderRadius: '4px',
                      marginBottom: '4px',
                      border: '1px solid #21262d',
                      fontSize: '11px',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: task.direction === 'upload' ? '#7ee787' : 'var(--accent-bright)' }}>
                      {task.direction === 'upload' ? <><CyberIcon name="upload" size={12} /> UP</> : <><CyberIcon name="download" size={12} /> DOWN</>}
                    </span>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#c9d1d9' }}>{task.direction === 'upload' ? task.localPath : task.remotePath}</span>
                    </div>

                    <div style={{ width: '120px' }}>
                      <div
                        style={{
                          height: '6px',
                          backgroundColor: '#21262d',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${task.status === 'completed' ? 100 : percent}%`,
                            backgroundColor: statusColor,
                            transition: 'width 0.2s ease',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#8b949e', marginTop: '2px' }}>
                        <span>{formatBytes(task.transferredBytes)} / {formatBytes(task.totalBytes)}</span>
                        <span>{percent.toFixed(0)}%</span>
                      </div>
                    </div>

                    <div style={{ width: '80px', textAlign: 'right', color: '#8b949e', fontSize: '10px' }}>
                      {isRunning && task.speedBytesPerSec > 0 ? `${formatBytes(task.speedBytesPerSec)}/s` : ''}
                    </div>

                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: '3px',
                        backgroundColor: `${statusColor}22`,
                        color: statusColor,
                        fontWeight: 600,
                        fontSize: '10px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {task.status}
                    </span>

                    {isRunning && (
                      <button
                        title="Cancel Transfer"
                        onClick={() => handleCancelTransfer(task.id)}
                        style={{
                          backgroundColor: 'transparent',
                          color: '#f85149',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          padding: '0 4px',
                        }}
                      >
                        <CyberIcon name="close" size={14} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showMkdirModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '16px',
              width: '320px',
            }}
          >
            <h4 style={{ margin: '0 0 10px', color: 'var(--accent-bright)' }}>Create Remote Folder</h4>
            <input
              type="text"
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateRemoteFolder();
                if (e.key === 'Escape') setShowMkdirModal(false);
              }}
              style={{
                width: '100%',
                padding: '6px 8px',
                backgroundColor: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: '4px',
                boxSizing: 'border-box',
                marginBottom: '12px',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setShowMkdirModal(false)}
                style={{
                  padding: '4px 10px',
                  backgroundColor: '#21262d',
                  color: '#c9d1d9',
                  border: '1px solid #30363d',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRemoteFolder}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#238636',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && itemToDelete && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '6px',
              padding: '16px',
              width: '340px',
            }}
          >
            <h4 style={{ margin: '0 0 10px', color: '#f85149' }}>Confirm Deletion</h4>
            <p style={{ margin: '0 0 12px', color: '#c9d1d9', fontSize: '12px' }}>
              Are you sure you want to delete remote item <strong>{itemToDelete.name}</strong>?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setItemToDelete(null);
                }}
                style={{
                  padding: '4px 10px',
                  backgroundColor: '#21262d',
                  color: '#c9d1d9',
                  border: '1px solid #30363d',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteRemoteItem}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#da3633',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Elevated Sudo Edit Password Prompt Modal */}
      {sudoEditTarget && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Elevated Sudo Edit"
          onClick={(e) => {
            if (e.target === e.currentTarget && !sudoBusy) {
              setSudoEditTarget(null);
              setSudoPassword('');
            }
          }}
        >
          <div className="cyber-totp-hud-modal" style={{ width: 'min(440px, 92vw)' }}>
            <div className="cyber-totp-hud-header">
              <div className="cyber-totp-hud-title-row">
                <CyberIcon name="shield" size={16} />
                <span className="cyber-totp-hud-title">ELEVATED EDIT // SUDO REQUIRED</span>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                aria-label="Close"
                disabled={sudoBusy}
                onClick={() => {
                  setSudoEditTarget(null);
                  setSudoPassword('');
                }}
              >
                <CyberIcon name="close" size={14} />
              </button>
            </div>
            <div style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Permission denied opening <code>{sudoEditTarget.path}</code>. Enter your <code>sudo</code> password to
                read this file with root privileges:
              </p>
              <input
                type="password"
                className="cyber-hud-input"
                aria-label="Sudo Password"
                placeholder="sudo password (sent via stdin only)..."
                autoFocus
                value={sudoPassword}
                onChange={(e) => setSudoPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !sudoBusy) {
                    void handleConfirmSudoEdit();
                  }
                }}
              />
              {sudoError && <div className="modal-error-banner">{sudoError}</div>}
              <div className="cyber-dialog-actions">
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-primary"
                  disabled={sudoBusy}
                  onClick={() => void handleConfirmSudoEdit()}
                >
                  <CyberIcon name="unlock" size={13} />
                  <span>{sudoBusy ? 'Reading with sudo...' : 'Open with sudo'}</span>
                </button>
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-cancel"
                  disabled={sudoBusy}
                  onClick={() => {
                    setSudoEditTarget(null);
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
}
