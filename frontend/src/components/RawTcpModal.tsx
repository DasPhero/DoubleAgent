import React, { useState, useEffect } from 'react';
import { CyberIcon } from './CyberIcon';
import { RawTcpConfig, RawTcpListenerConfig, RawTcpListenerInfo } from '../types/rawTcp';

interface RawTcpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (cfg: RawTcpConfig) => Promise<void>;
  onStartListener: (cfg: RawTcpListenerConfig) => Promise<void>;
  onStopListener: (id: string) => Promise<void>;
  listeners: RawTcpListenerInfo[];
  refreshListeners: () => Promise<void>;
}

export const RawTcpModal: React.FC<RawTcpModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  onStartListener,
  onStopListener,
  listeners,
  refreshListeners,
}) => {
  const [activeTab, setActiveTab] = useState<'client' | 'listener'>('client');

  // Client form state
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(8080);
  const [lineMode, setLineMode] = useState(true);
  const [lineEnding, setLineEnding] = useState<'crlf' | 'lf' | 'cr'>('crlf');
  const [isConnecting, setIsConnecting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  // Listener form state
  const [listenPort, setListenPort] = useState(4444);
  const [bindAddress, setBindAddress] = useState('0.0.0.0');
  const [autoSpawnTab, setAutoSpawnTab] = useState(true);
  const [isStartingListener, setIsStartingListener] = useState(false);
  const [listenerError, setListenerError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      void refreshListeners();
      setClientError(null);
      setListenerError(null);
    }
  }, [isOpen, refreshListeners]);

  if (!isOpen) return null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim() || port <= 0 || port > 65535) {
      setClientError('Please specify a valid host and port (1-65535).');
      return;
    }
    setClientError(null);
    setIsConnecting(true);
    try {
      await onConnect({
        host: host.trim(),
        port,
        lineMode,
        lineEnding,
        timeoutSec: 10,
      });
      onClose();
    } catch (err: unknown) {
      setClientError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleStartListener = async (e: React.FormEvent) => {
    e.preventDefault();
    if (listenPort <= 0 || listenPort > 65535) {
      setListenerError('Please specify a valid listening port (1-65535).');
      return;
    }
    setListenerError(null);
    setIsStartingListener(true);
    try {
      await onStartListener({
        port: listenPort,
        bindAddress: bindAddress.trim() || '0.0.0.0',
        autoSpawnTab,
      });
      await refreshListeners();
    } catch (err: unknown) {
      setListenerError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStartingListener(false);
    }
  };

  const applyPreset = (presetHost: string, presetPort: number, presetLineMode: boolean) => {
    setHost(presetHost);
    setPort(presetPort);
    setLineMode(presetLineMode);
    setClientError(null);
  };

  return (
    <div
      className="cyber-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rawtcp-dialog-title"
    >
      <div
        className="cyber-dialog-card raw-tcp-dialog-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '660px', width: '92%' }}
      >
        {/* Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Modal Header */}
        <div className="dialog-header">
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3 id="rawtcp-dialog-title" style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                <CyberIcon name="bolt" size={14} /> Raw TCP Socket &amp; Listener
              </h3>
              <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                SEC-NETCAT // RAW TCP SOCKET ENGINE &amp; REVERSE CATCHER
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        {/* Tab Selection */}
        <div
          className="settings-tabs-header"
          style={{
            padding: '0.75rem 1.25rem 0 1.25rem',
            display: 'flex',
            gap: '0.5rem',
            borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 15%, transparent)',
            background: 'rgba(5, 10, 18, 0.5)'
          }}
        >
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'client' ? 'active' : ''}`}
            onClick={() => setActiveTab('client')}
          >
            <span><CyberIcon name="broadcast" size={14} /> Outgoing Client</span>
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'listener' ? 'active' : ''}`}
            onClick={() => setActiveTab('listener')}
          >
            <span><CyberIcon name="bolt" size={14} /> Inbound Listener / Reverse Catcher</span>
            {listeners.length > 0 && (
              <span
                style={{
                  marginLeft: '8px',
                  padding: '1px 6px',
                  background: 'var(--accent-bright)',
                  color: '#040914',
                  borderRadius: '2px',
                  fontSize: '0.68rem',
                  fontWeight: 700
                }}
              >
                {listeners.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div
          className="dialog-body"
          style={{
            maxHeight: '75vh',
            overflowY: 'auto',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.9rem'
          }}
        >
          {activeTab === 'client' ? (
            <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div
                style={{
                  background: 'color-mix(in srgb, var(--accent-bright) 6%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.78rem',
                  color: '#94a3b8',
                  lineHeight: '1.45',
                  borderRadius: '2px'
                }}
              >
                Direct raw socket terminal. Ideal for probing HTTP, Redis, SMTP, Memcached, raw banners, or interacting with custom TCP daemons.
              </div>

              {clientError && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.45)',
                    color: '#fca5a5',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.78rem',
                    fontFamily: 'JetBrains Mono, Consolas, monospace',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                    borderRadius: '2px',
                    wordBreak: 'break-word'
                  }}
                  role="alert"
                >
                  <span style={{ fontSize: '1rem', lineHeight: '1' }}><CyberIcon name="warning" size={14} /></span>
                  <span style={{ flex: 1 }}>{clientError}</span>
                </div>
              )}

              {/* Presets */}
              <div className="raw-tcp-presets-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="preset-label">QUICK PRESETS:</span>
                <button
                  type="button"
                  className="hud-preset-pill"
                  onClick={() => applyPreset('127.0.0.1', 80, true)}
                >
                  HTTP [80]
                </button>
                <button
                  type="button"
                  className="hud-preset-pill"
                  onClick={() => applyPreset('127.0.0.1', 6379, true)}
                >
                  Redis [6379]
                </button>
                <button
                  type="button"
                  className="hud-preset-pill"
                  onClick={() => applyPreset('127.0.0.1', 25, true)}
                >
                  SMTP [25]
                </button>
                <button
                  type="button"
                  className="hud-preset-pill"
                  onClick={() => applyPreset('127.0.0.1', 4444, false)}
                >
                  Shell [4444]
                </button>
              </div>

              {/* Host & Port Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '1rem' }}>
                <div>
                  <label htmlFor="rawtcp-host" className="cyber-label">
                    Target Host / IP
                  </label>
                  <input
                    id="rawtcp-host"
                    type="text"
                    className="cyber-hud-input"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="127.0.0.1 or target.htb"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="rawtcp-port" className="cyber-label">
                    Target Port
                  </label>
                  <input
                    id="rawtcp-port"
                    type="number"
                    className="cyber-hud-input"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
                    min={1}
                    max={65535}
                    required
                  />
                </div>
              </div>

              {/* Line Mode & Line Ending Box */}
              <div
                style={{
                  background: 'rgba(5, 9, 16, 0.75)',
                  border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
                  padding: '0.85rem 1rem',
                  borderRadius: '2px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem'
                }}
              >
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={lineMode}
                    onChange={(e) => setLineMode(e.target.checked)}
                    style={{ marginTop: '3px', cursor: 'pointer', accentColor: 'var(--accent-bright)' }}
                  />
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f1f5f9' }}>
                      Line Buffering &amp; Local Echo
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px', lineHeight: '1.4' }}>
                      Type line with backspace editing, sends on Enter (essential for HTTP, Redis, SMTP).
                    </div>
                  </div>
                </label>

                {lineMode && (
                  <div
                    style={{
                      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      paddingTop: '0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem'
                    }}
                  >
                    <span className="cyber-label" style={{ marginBottom: '0.1rem' }}>
                      Line Ending Sequence
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', paddingLeft: '0.25rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer', fontSize: '0.78rem', color: '#cbd5e1' }}>
                        <input
                          type="radio"
                          name="lineEnding"
                          value="crlf"
                          checked={lineEnding === 'crlf'}
                          onChange={() => setLineEnding('crlf')}
                          style={{ accentColor: 'var(--accent-bright)', cursor: 'pointer' }}
                        />
                        <span><strong>CRLF (\r\n)</strong> — Standard Network RFC (HTTP / Redis / SMTP)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer', fontSize: '0.78rem', color: '#cbd5e1' }}>
                        <input
                          type="radio"
                          name="lineEnding"
                          value="lf"
                          checked={lineEnding === 'lf'}
                          onChange={() => setLineEnding('lf')}
                          style={{ accentColor: 'var(--accent-bright)', cursor: 'pointer' }}
                        />
                        <span><strong>LF (\n)</strong> — Unix / Linux Terminals</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer', fontSize: '0.78rem', color: '#cbd5e1' }}>
                        <input
                          type="radio"
                          name="lineEnding"
                          value="cr"
                          checked={lineEnding === 'cr'}
                          onChange={() => setLineEnding('cr')}
                          style={{ accentColor: 'var(--accent-bright)', cursor: 'pointer' }}
                        />
                        <span><strong>CR (\r)</strong> — Legacy / Mac</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div
                className="dialog-footer"
                style={{
                  background: 'transparent',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  padding: '0.85rem 0 0 0',
                  marginTop: '0.4rem',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.65rem'
                }}
              >
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={onClose}
                  disabled={isConnecting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cyber-btn cyber-btn-primary"
                  disabled={isConnecting}
                >
                  <span>{isConnecting ? 'CONNECTING...' : <><CyberIcon name="play" size={14} /> CONNECT RAW TCP</>}</span>
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div
                style={{
                  background: 'color-mix(in srgb, var(--accent-bright) 6%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.78rem',
                  color: '#94a3b8',
                  lineHeight: '1.45',
                  borderRadius: '2px'
                }}
              >
                Binds a local server port. Catches incoming reverse shells, Netcat streams, or IoT telemetry, automatically opening an interactive terminal tab on connection.
              </div>

              {listenerError && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.45)',
                    color: '#fca5a5',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.78rem',
                    fontFamily: 'JetBrains Mono, Consolas, monospace',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                    borderRadius: '2px',
                    wordBreak: 'break-word'
                  }}
                  role="alert"
                >
                  <span style={{ fontSize: '1rem', lineHeight: '1' }}><CyberIcon name="warning" size={14} /></span>
                  <span style={{ flex: 1 }}>{listenerError}</span>
                </div>
              )}

              <form onSubmit={handleStartListener} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '1rem' }}>
                  <div>
                    <label htmlFor="listen-port" className="cyber-label">
                      Listening Port
                    </label>
                    <input
                      id="listen-port"
                      type="number"
                      className="cyber-hud-input"
                      value={listenPort}
                      onChange={(e) => setListenPort(parseInt(e.target.value, 10) || 0)}
                      min={1}
                      max={65535}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="listen-bind" className="cyber-label">
                      Bind Interface
                    </label>
                    <select
                      id="listen-bind"
                      className="cyber-hud-select"
                      value={bindAddress}
                      onChange={(e) => setBindAddress(e.target.value)}
                      style={{ height: '34px' }}
                    >
                      <option value="0.0.0.0">0.0.0.0 (All Interfaces / External - Reverse Shell)</option>
                      <option value="127.0.0.1">127.0.0.1 (Localhost Only - Internal)</option>
                    </select>
                  </div>
                </div>

                <div
                  style={{
                    background: 'rgba(5, 9, 16, 0.75)',
                    border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
                    padding: '0.85rem 1rem',
                    borderRadius: '2px'
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={autoSpawnTab}
                      onChange={(e) => setAutoSpawnTab(e.target.checked)}
                      style={{ marginTop: '3px', cursor: 'pointer', accentColor: 'var(--accent-bright)' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f1f5f9' }}>
                        Auto-Spawn Interactive Terminal Tab
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px', lineHeight: '1.4' }}>
                        Automatically opens and focuses a new tab when a target connects.
                      </div>
                    </div>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                  <button
                    type="submit"
                    className="cyber-btn cyber-btn-primary"
                    disabled={isStartingListener}
                  >
                    <span>{isStartingListener ? 'STARTING...' : <><CyberIcon name="bolt" size={14} /> START LISTENER</>}</span>
                  </button>
                </div>
              </form>

              {/* Active Listeners Table / Cards */}
              <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '0.9rem', marginTop: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                    ACTIVE LISTENERS ({listeners.length})
                  </span>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    onClick={() => void refreshListeners()}
                  >
                    <CyberIcon name="refresh" size={14} /> Refresh
                  </button>
                </div>

                {listeners.length === 0 ? (
                  <div className="empty-listeners-box">
                    <div className="radar-ping-icon"><CyberIcon name="broadcast" size={14} /></div>
                    <span>No active listeners. Start one above to catch reverse shells or incoming TCP traffic.</span>
                  </div>
                ) : (
                  <div className="listeners-card-grid">
                    {listeners.map((l) => (
                      <div key={l.id} className="listener-card">
                        <div className="listener-card-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="pulse-indicator"><CyberIcon name="record" size={14} /></span>
                            <span className="listener-bind-tag">
                              {l.bindAddress}:{l.port}
                            </span>
                          </div>
                          <span
                            style={{
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#10b981',
                              border: '1px solid rgba(16, 185, 129, 0.4)',
                              padding: '1px 6px',
                              borderRadius: '2px',
                              fontSize: '0.65rem',
                              fontFamily: 'JetBrains Mono, monospace',
                              fontWeight: 700
                            }}
                          >
                            ARMED
                          </span>
                        </div>
                        <div className="listener-card-body">
                          <div>
                            <span>CATCHES:</span>
                            <span className="stat-value">{l.totalCatches}</span>
                          </div>
                          <div>
                            <span>STARTED:</span>
                            <span className="stat-value">
                              {new Date(l.startedAt).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                        <div className="listener-card-footer">
                          <button
                            type="button"
                            className="btn-danger btn-sm"
                            style={{ fontSize: '0.7rem', padding: '0.25rem 0.6rem' }}
                            onClick={() => void onStopListener(l.id)}
                          >
                            <CyberIcon name="stop" size={14} /> STOP LISTENER
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
