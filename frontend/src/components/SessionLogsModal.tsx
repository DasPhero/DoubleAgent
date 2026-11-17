import React, { useEffect, useMemo, useState } from 'react';
import { CyberIcon } from './CyberIcon';
import { SessionLogRecord } from '../types/sessionLog';

interface SessionLogsModalProps {
  logs: SessionLogRecord[];
  onRefreshLogs: () => Promise<void>;
  onReadLog: (logId: string) => Promise<string>;
  onDeleteLog: (logId: string) => Promise<void>;
  onExportLog?: (logId: string, targetPath: string) => Promise<void>;
  onStopActiveLog?: (sessionId: string) => Promise<void>;
  onClose: () => void;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const SessionLogsModal: React.FC<SessionLogsModalProps> = ({
  logs,
  onRefreshLogs,
  onReadLog,
  onDeleteLog,
  onExportLog,
  onStopActiveLog,
  onClose,
}) => {
  const [selectedLogId, setSelectedLogId] = useState<string | null>(
    logs.length > 0 ? logs[0].id : null
  );
  const [logContent, setLogContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lineFilter, setLineFilter] = useState<string>('');
  const [exportPath, setExportPath] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<string>('');

  const selectedLog = useMemo(
    () => logs.find((l) => l.id === selectedLogId) || null,
    [logs, selectedLogId]
  );

  useEffect(() => {
    if (!selectedLogId && logs.length > 0) {
      setSelectedLogId(logs[0].id);
    } else if (selectedLogId && !logs.some((l) => l.id === selectedLogId)) {
      setSelectedLogId(logs[0]?.id || null);
    }
  }, [logs, selectedLogId]);

  useEffect(() => {
    if (!selectedLogId) {
      setLogContent('');
      return;
    }
    let cancelled = false;
    setLoadingContent(true);
    void onReadLog(selectedLogId)
      .then((content) => {
        if (!cancelled) {
          setLogContent(content || '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLogContent('');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingContent(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLogId, onReadLog]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.hostLabel.toLowerCase().includes(q) ||
        l.filePath.toLowerCase().includes(q) ||
        l.startedAt.toLowerCase().includes(q)
    );
  }, [logs, searchQuery]);

  const visibleLines = useMemo(() => {
    const rawLines = logContent ? logContent.split(/\r?\n/) : [];
    const q = lineFilter.trim().toLowerCase();
    if (!q) return rawLines;
    return rawLines.filter((line) => line.toLowerCase().includes(q));
  }, [logContent, lineFilter]);

  const handleCopyContent = async (): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(logContent);
      }
      setStatusBanner('Copied session transcript to clipboard.');
    } catch {
      setStatusBanner('Clipboard copy unavailable.');
    }
  };

  const handleDownloadFile = (): void => {
    if (!selectedLog) return;
    const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeHost = selectedLog.hostLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `session-${safeHost}-${selectedLog.id}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusBanner(`Downloaded session-${safeHost}-${selectedLog.id}.log`);
  };

  const handleSaveToPath = async (): Promise<void> => {
    if (!selectedLog || !onExportLog || !exportPath.trim()) return;
    try {
      await onExportLog(selectedLog.id, exportPath.trim());
      setStatusBanner(`Saved session log to ${exportPath.trim()}`);
      setExportPath('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusBanner(`Export failed: ${msg}`);
    }
  };

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-label="Session Logs & Recordings"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cyber-dialog-card session-logs-modal-card" style={{ maxWidth: '880px', width: '95vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                <CyberIcon name="record" size={14} /> Session Logs &amp; Transcripts
              </h3>
              <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                AUDIT-TELEMETRY // TIMESTAMPED RECORDINGS &amp; PASSWORD-ECHO REDACTED
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary cyber-btn-sm"
              onClick={() => void onRefreshLogs()}
              aria-label="Refresh Session Logs"
            >
              <CyberIcon name="refresh" size={14} /> Refresh
            </button>
            <button
              type="button"
              className="cyber-btn-close"
              onClick={onClose}
              aria-label="Close Session Logs"
            >
              ×
            </button>
          </div>
        </div>

        {statusBanner && (
          <div className="info-banner" style={{ margin: '0.5rem 1rem 0' }}>
            {statusBanner}
          </div>
        )}

        <div className="session-logs-body">
          {/* Left Column: Recorded Sessions List */}
          <div className="session-logs-sidebar">
            <div style={{ padding: '0.6rem' }}>
              <input
                type="text"
                aria-label="Filter Session Logs"
                placeholder="Filter by host or date..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div className="session-logs-list" aria-label="Recorded Sessions List">
              {filteredLogs.length === 0 ? (
                <div className="session-logs-empty">
                  No session logs recorded yet. Enable logging on a Host or click <strong> Log</strong> in any terminal pane header.
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isSelected = log.id === selectedLogId;
                  return (
                    <div
                      key={log.id}
                      role="button"
                      tabIndex={0}
                      className={`session-log-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedLogId(log.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedLogId(log.id);
                        }
                      }}
                    >
                      <div className="session-log-item-top">
                        <strong>{log.hostLabel}</strong>
                        <span className={`session-log-badge ${log.active ? 'active' : 'closed'}`}>
                          {log.active ? <><CyberIcon name="record" size={14} /> REC</> : 'Saved'}
                        </span>
                      </div>
                      <div className="session-log-item-meta">
                        <span>{log.startedAt}</span>
                        <span>
                          {log.lineCount} lines · {formatByteSize(log.byteCount)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Transcript Viewer */}
          <div className="session-logs-viewer">
            {selectedLog ? (
              <>
                <div className="session-logs-toolbar">
                  <div className="session-logs-meta-info">
                    <strong>{selectedLog.hostLabel}</strong>
                    <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {selectedLog.filePath}
                    </span>
                  </div>
                  <div className="session-logs-actions">
                    <input
                      type="text"
                      aria-label="Search in Transcript"
                      placeholder="Filter lines in transcript..."
                      value={lineFilter}
                      onChange={(e) => setLineFilter(e.target.value)}
                      style={{ width: '190px', fontSize: '0.76rem', padding: '0.25rem 0.5rem' }}
                    />
                    {selectedLog.active && onStopActiveLog && (
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => void onStopActiveLog(selectedLog.sessionId)}
                      >
                        <CyberIcon name="stop" size={14} /> Stop Recording
                      </button>
                    )}
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary btn-sm"
                      onClick={() => void handleCopyContent()}
                    >
                      <CyberIcon name="clipboard" size={14} /> Copy
                    </button>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary btn-sm"
                      onClick={handleDownloadFile}
                    >
                      <CyberIcon name="download" size={14} /> Download .log
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      aria-label={`Delete Log ${selectedLog.hostLabel}`}
                      onClick={() => void onDeleteLog(selectedLog.id)}
                    >
                      <CyberIcon name="trash" size={14} /> Delete
                    </button>
                  </div>
                </div>

                {onExportLog && (
                  <div className="session-logs-export-bar">
                    <input
                      type="text"
                      aria-label="Export Log File Path"
                      placeholder="Export path on disk (e.g. C:\Logs\audit.log or /tmp/audit.log)..."
                      value={exportPath}
                      onChange={(e) => setExportPath(e.target.value)}
                      style={{ flex: 1, fontSize: '0.76rem', padding: '0.25rem 0.5rem' }}
                    />
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-primary btn-sm"
                      disabled={!exportPath.trim()}
                      onClick={() => void handleSaveToPath()}
                    >
                      Save to Disk
                    </button>
                  </div>
                )}

                <div
                  className="session-logs-transcript"
                  role="region"
                  aria-label="Session Transcript Content"
                >
                  {loadingContent ? (
                    <div className="session-logs-empty">Loading transcript...</div>
                  ) : visibleLines.length === 0 ? (
                    <div className="session-logs-empty">No transcript lines to display.</div>
                  ) : (
                    visibleLines.map((line, idx) => (
                      <div key={idx} className="session-log-line">
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="session-logs-empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                Select a session recording on the left to inspect its timestamped transcript.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

