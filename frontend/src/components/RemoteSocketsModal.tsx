import React, { useEffect, useMemo, useState } from 'react';
import { CyberIcon } from './CyberIcon';
import type { QuickForwardResult, RemoteSocketEntry, RemoteSocketScanResult } from '../types/sockets';

interface WailsSocketBindings {
  DiscoverRemoteSockets?: (sessionId: string) => Promise<RemoteSocketScanResult>;
  QuickStartLocalForward?: (
    sessionId: string,
    targetHost: string,
    targetPort: number,
    localPort: number,
    saveRule: boolean,
    engagementId: string,
    label: string
  ) => Promise<QuickForwardResult>;
}

function getSocketBindings(): WailsSocketBindings | undefined {
  return (window as unknown as { go?: { main?: { App?: WailsSocketBindings } } })?.go?.main?.App;
}

export interface RemoteSocketsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sshSessions: Array<{ id: string; label: string }>;
  defaultSessionId?: string;
  activeEngagementId?: string | null;
  onOpenApiUrl?: (url: string, label: string) => void;
}

export function RemoteSocketsModal({
  isOpen,
  onClose,
  sshSessions,
  defaultSessionId,
  activeEngagementId,
  onOpenApiUrl,
}: RemoteSocketsModalProps): React.JSX.Element | null {
  const [selectedSessionId, setSelectedSessionId] = useState<string>(defaultSessionId || '');
  const [scanResult, setScanResult] = useState<RemoteSocketScanResult | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [loopbackOnly, setLoopbackOnly] = useState<boolean>(false);
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [saveRule, setSaveRule] = useState<boolean>(false);
  const [localPortOverrides, setLocalPortOverrides] = useState<Record<string, string>>({});
  const [statusBanner, setStatusBanner] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string>('');
  const [busyKey, setBusyKey] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    if (defaultSessionId && sshSessions.some((s) => s.id === defaultSessionId)) {
      setSelectedSessionId(defaultSessionId);
    } else if (!selectedSessionId && sshSessions.length > 0) {
      setSelectedSessionId(sshSessions[0].id);
    }
  }, [isOpen, defaultSessionId, sshSessions, selectedSessionId]);

  const filteredEntries = useMemo(() => {
    const rows = scanResult?.entries || [];
    const q = filterQuery.toLowerCase().trim();
    return rows.filter((r) => {
      if (loopbackOnly && !r.isLoopback) return false;
      if (!q) return true;
      return (
        String(r.localPort).includes(q) ||
        r.localAddress.toLowerCase().includes(q) ||
        (r.process || '').toLowerCase().includes(q) ||
        r.proto.toLowerCase().includes(q)
      );
    });
  }, [scanResult, loopbackOnly, filterQuery]);

  if (!isOpen) return null;

  const entryKey = (e: RemoteSocketEntry) => `${e.proto}|${e.localAddress}|${e.localPort}`;

  const handleScan = async () => {
    if (!selectedSessionId) {
      setErrorBanner('Select an active SSH session first.');
      return;
    }
    const api = getSocketBindings();
    if (!api?.DiscoverRemoteSockets) {
      setErrorBanner('Backend DiscoverRemoteSockets binding unavailable.');
      return;
    }
    setIsScanning(true);
    setErrorBanner('');
    setStatusBanner('');
    try {
      const res = await api.DiscoverRemoteSockets(selectedSessionId);
      setScanResult(res);
      if (res.error) {
        setErrorBanner(res.error);
      } else {
        const loopbackCount = (res.entries || []).filter((e) => e.isLoopback).length;
        setStatusBanner(
          `Discovered ${res.entries?.length || 0} listening sockets (${loopbackCount} loopback) via ${res.commandUsed || res.platform}.`
        );
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleLaunchForward = async (entry: RemoteSocketEntry, openInApi: boolean) => {
    const api = getSocketBindings();
    if (!api?.QuickStartLocalForward) {
      setErrorBanner('Backend QuickStartLocalForward binding unavailable.');
      return;
    }
    if (!selectedSessionId) return;

    const k = entryKey(entry);
    const rawOverride = (localPortOverrides[k] || '').trim();
    const parsedOverride = rawOverride ? Number(rawOverride) : 0;
    if (rawOverride && (!Number.isInteger(parsedOverride) || parsedOverride < 1 || parsedOverride > 65535)) {
      setErrorBanner(`Invalid custom local port "${rawOverride}".`);
      return;
    }

    setBusyKey(k);
    setErrorBanner('');
    try {
      const svcLabel = entry.process
        ? `${entry.process} (${entry.localAddress}:${entry.localPort})`
        : `${entry.localAddress}:${entry.localPort}`;
      const fwd = await api.QuickStartLocalForward(
        selectedSessionId,
        entry.localAddress,
        entry.localPort,
        parsedOverride,
        saveRule,
        activeEngagementId || '',
        svcLabel
      );
      setStatusBanner(
        `Active -L tunnel 127.0.0.1:${fwd.localPort} -> ${fwd.targetHost}:${fwd.targetPort}${fwd.savedRule ? ' (saved)' : ''}`
      );
      if (openInApi && onOpenApiUrl) {
        onOpenApiUrl(`http://127.0.0.1:${fwd.localPort}`, entry.process || `Remote :${entry.localPort}`);
        onClose();
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-label="Remote Socket Discovery and Quick Local Forward"
      onClick={onClose}
    >
      <div
        className="cyber-dialog-card"
        style={{
          width: '860px',
          maxWidth: '94vw',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '1rem',
          gap: '0.7rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CyberIcon name="tunnel" size={16} />
            <h3 style={{ margin: 0, color: 'var(--accent-bright)' }}>
              Remote Listening Sockets &amp; 1-Click -L Forward
            </h3>
          </div>
          <button type="button" className="cyber-hud-btn btn-sm btn-danger" onClick={onClose} aria-label="Close Remote Sockets">
            <CyberIcon name="close" size={13} />
          </button>
        </div>

        {/* Target SSH Session + On-Demand Scan Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            aria-label="SSH Session"
            className="cyber-input"
            style={{ flex: 1, minWidth: '220px', fontSize: '0.76rem' }}
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
          >
            {sshSessions.length === 0 ? (
              <option value="">No active SSH sessions</option>
            ) : (
              sshSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))
            )}
          </select>

          <button
            type="button"
            className="cyber-btn cyber-btn-primary"
            disabled={isScanning || sshSessions.length === 0}
            onClick={() => void handleScan()}
          >
            <CyberIcon name="radar" size={14} />
            <span>{isScanning ? 'Scanning...' : 'Scan Listening Sockets'}</span>
          </button>
        </div>

        {/* Filters & Options */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.74rem' }}>
          <input
            aria-label="Filter Sockets"
            type="text"
            className="cyber-input font-mono"
            style={{ flex: 1, minWidth: '180px', fontSize: '0.74rem' }}
            placeholder="Filter by port, address, or process..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={loopbackOnly}
              onChange={(e) => setLoopbackOnly(e.target.checked)}
            />
            <span>Loopback only (127.0.0.1 / ::1)</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={saveRule}
              onChange={(e) => setSaveRule(e.target.checked)}
            />
            <span>Save as Vault Forward Rule</span>
          </label>
        </div>

        {(errorBanner || statusBanner) && (
          <div
            style={{
              padding: '0.4rem 0.65rem',
              fontSize: '0.74rem',
              fontFamily: 'JetBrains Mono, monospace',
              background: errorBanner ? 'rgba(239, 68, 68, 0.14)' : 'color-mix(in srgb, var(--accent-bright) 12%, transparent)',
              border: `1px solid ${errorBanner ? 'rgba(239, 68, 68, 0.4)' : 'color-mix(in srgb, var(--accent-bright) 30%, transparent)'}`,
              color: errorBanner ? '#fca5a5' : 'var(--accent-bright)',
              borderRadius: '4px',
            }}
          >
            {errorBanner || statusBanner}
          </div>
        )}

        {/* Discovered Sockets Table */}
        <div
          style={{
            flex: 1,
            minHeight: '220px',
            overflowY: 'auto',
            border: '1px solid color-mix(in srgb, var(--accent-bright) 18%, transparent)',
            borderRadius: '6px',
            background: 'rgba(6, 10, 18, 0.78)',
          }}
        >
          {!scanResult ? (
            <div style={{ padding: '1rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Click <strong>Scan Listening Sockets</strong> to run an on-demand read-only probe (no background polling) via Non-PTY SSH (Linux <code>ss</code>/<code>netstat</code>/<code>/proc/net/tcp</code> or Windows <code>netstat -ano</code>).
            </div>
          ) : filteredEntries.length === 0 ? (
            <div style={{ padding: '1rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              No matching listening sockets found.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem', fontFamily: 'JetBrains Mono, monospace' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 22%, transparent)', color: 'var(--accent-bright)' }}>
                  <th style={{ padding: '0.45rem 0.55rem' }}>Proto</th>
                  <th style={{ padding: '0.45rem 0.55rem' }}>Remote Bind</th>
                  <th style={{ padding: '0.45rem 0.55rem' }}>Process / PID</th>
                  <th style={{ padding: '0.45rem 0.55rem' }}>Local Port</th>
                  <th style={{ padding: '0.45rem 0.55rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const k = entryKey(entry);
                  const isUdp = entry.proto.startsWith('udp');
                  return (
                    <tr
                      key={k}
                      style={{
                        borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 10%, transparent)',
                        background: entry.isLoopback ? 'color-mix(in srgb, var(--accent-bright) 6%, transparent)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '0.4rem 0.55rem' }}>{entry.proto.toUpperCase()}</td>
                      <td style={{ padding: '0.4rem 0.55rem' }}>
                        <span>{entry.localAddress}:{entry.localPort}</span>
                        {entry.isLoopback && (
                          <span
                            style={{
                              marginLeft: '0.45rem',
                              fontSize: '0.64rem',
                              padding: '0.08rem 0.35rem',
                              borderRadius: '3px',
                              border: '1px solid color-mix(in srgb, var(--accent-bright) 45%, transparent)',
                              color: 'var(--accent-bright)',
                            }}
                          >
                            LOOPBACK
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.4rem 0.55rem', color: 'var(--text-muted)' }}>
                        {entry.process || '-'} {entry.pid ? `(${entry.pid})` : ''}
                      </td>
                      <td style={{ padding: '0.4rem 0.55rem' }}>
                        <input
                          aria-label={`Local Port for ${entry.localAddress}:${entry.localPort}`}
                          type="number"
                          min={1}
                          max={65535}
                          className="cyber-input font-mono"
                          style={{ width: '78px', fontSize: '0.71rem', padding: '0.15rem 0.3rem' }}
                          placeholder="Auto"
                          disabled={isUdp}
                          value={localPortOverrides[k] || ''}
                          onChange={(e) =>
                            setLocalPortOverrides((prev) => ({ ...prev, [k]: e.target.value }))
                          }
                        />
                      </td>
                      <td style={{ padding: '0.4rem 0.55rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '0.3rem' }}>
                          <button
                            type="button"
                            className="cyber-hud-btn btn-sm"
                            disabled={isUdp || busyKey === k}
                            title={isUdp ? 'SSH -L forwards TCP only' : `Start SSH -L tunnel to ${entry.localAddress}:${entry.localPort}`}
                            onClick={() => void handleLaunchForward(entry, false)}
                          >
                            <CyberIcon name="tunnel" size={12} /> Start -L
                          </button>
                          {onOpenApiUrl && (
                            <button
                              type="button"
                              className="cyber-hud-btn btn-sm"
                              disabled={isUdp || busyKey === k}
                              title="Start -L tunnel and probe in API Tester (F-42)"
                              onClick={() => void handleLaunchForward(entry, true)}
                            >
                              <CyberIcon name="globe" size={12} /> + API Tester
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
