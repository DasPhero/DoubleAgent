import React, { useState, useMemo } from 'react';
import {
  ProbeTargetResult,
  RouteCheckMode,
  RouteCheckRequest,
  RouteHealthEntry,
  RouteHealthReport,
  SocksCandidateOption,
} from '../types/routeHealth';
import { CyberIcon } from './CyberIcon';

export interface DashboardListenerSnapshot {
  id: string;
  sourceType: 'shell-listener' | 'transfer-server' | 'pivot' | 'ssh-tunnel';
  name: string;
  kind: string;
  endpoint: string;
  status: string;
  metaSummary?: string;
}

export interface RouteHealthModalProps {
  isOpen?: boolean;
  isView?: boolean;
  onClose: () => void;
  activeEngagementId?: string | null;
  activeEngagementName?: string | null;
  socksCandidates?: SocksCandidateOption[];
  suggestedTargetHosts?: string[];
  activeDashboardItems?: DashboardListenerSnapshot[];
  onRefreshEndpoints?: () => void;
  onStopEndpoint?: (sourceType: string, id: string) => Promise<void>;
  runHealthCheck: (req: RouteCheckRequest) => Promise<RouteHealthReport>;
  onOpenPivotManager?: () => void;
  onOpenPortForwarding?: () => void;
}

function splitTargetLines(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s, idx, arr) => Boolean(s) && arr.indexOf(s) === idx);
}

function statusBadgeStyle(status: string): {
  bg: string;
  border: string;
  color: string;
  label: string;
} {
  switch (status) {
    case 'healthy':
      return {
        bg: 'rgba(16, 185, 129, 0.16)',
        border: 'rgba(16, 185, 129, 0.55)',
        color: '#34d399',
        label: 'HEALTHY',
      };
    case 'degraded':
      return {
        bg: 'rgba(245, 158, 11, 0.16)',
        border: 'rgba(245, 158, 11, 0.55)',
        color: '#fbbf24',
        label: 'DEGRADED',
      };
    case 'down':
    case 'error':
      return {
        bg: 'rgba(239, 68, 68, 0.16)',
        border: 'rgba(239, 68, 68, 0.55)',
        color: '#f87171',
        label: status.toUpperCase(),
      };
    default:
      return {
        bg: 'rgba(148, 163, 184, 0.14)',
        border: 'rgba(148, 163, 184, 0.35)',
        color: '#94a3b8',
        label: 'IDLE',
      };
  }
}

function formatBytesShort(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const RouteHealthModal: React.FC<RouteHealthModalProps> = ({
  isOpen = true,
  isView = false,
  onClose,
  activeEngagementId,
  activeEngagementName,
  socksCandidates = [],
  suggestedTargetHosts = [],
  activeDashboardItems = [],
  onRefreshEndpoints,
  onStopEndpoint,
  runHealthCheck,
  onOpenPivotManager,
  onOpenPortForwarding,
}) => {
  const [checkMode, setCheckMode] = useState<RouteCheckMode>('local_only');
  const [socksProxyAddr, setSocksProxyAddr] = useState<string>(
    socksCandidates[0]?.addr || ''
  );
  const [targetsRaw, setTargetsRaw] = useState<string>('');
  const [throttleMs, setThrottleMs] = useState<number>(400);
  const [timeoutMs, setTimeoutMs] = useState<number>(1500);
  const [confirmActiveTraffic, setConfirmActiveTraffic] = useState<boolean>(false);
  const [scopeOnly, setScopeOnly] = useState<boolean>(Boolean(activeEngagementId));

  const [entryFilter, setEntryFilter] = useState<'all' | 'issues' | 'listeners' | 'transfer' | 'pivot' | 'ssh' | 'custom'>('all');
  const [report, setReport] = useState<RouteHealthReport | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [stoppingKey, setStoppingKey] = useState<string>('');
  const [error, setError] = useState<string>('');

  const parsedTargets = useMemo(() => splitTargetLines(targetsRaw), [targetsRaw]);

  const filteredEntries = useMemo(() => {
    const entries = report?.entries || [];
    return entries.filter((entry) => {
      if (entryFilter === 'issues') {
        return entry.status === 'degraded' || entry.status === 'down' || entry.status === 'error';
      }
      if (entryFilter === 'listeners') return entry.sourceType === 'shell-listener';
      if (entryFilter === 'transfer') return entry.sourceType === 'transfer-server';
      if (entryFilter === 'pivot') return entry.sourceType === 'pivot';
      if (entryFilter === 'ssh') {
        return entry.sourceType === 'forward-rule' || entry.sourceType === 'ssh-tunnel' || entry.sourceType === 'proxy-profile';
      }
      if (entryFilter === 'custom') return entry.sourceType === 'custom';
      return true;
    });
  }, [report, entryFilter]);

  const handleStopItem = async (sourceType: string, id: string) => {
    if (!onStopEndpoint) return;
    const key = `${sourceType}:${id}`;
    setStoppingKey(key);
    setError('');
    try {
      await onStopEndpoint(sourceType, id);
      if (report) {
        await handleRunCheck();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoppingKey('');
    }
  };

  const handleRunCheck = async () => {
    setError('');
    if (checkMode === 'throttled_tcp' && parsedTargets.length > 0 && !confirmActiveTraffic) {
      setError('Confirm on-demand active target probes before sending throttled TCP connections.');
      return;
    }
    if (parsedTargets.length > 25) {
      setError('OPSEC limit: maximum 25 targets per throttled health check.');
      return;
    }

    setIsRunning(true);
    try {
      const req: RouteCheckRequest = {
        checkMode,
        engagementId: scopeOnly && activeEngagementId ? activeEngagementId : '',
        socksProxyAddr: checkMode === 'throttled_tcp' ? socksProxyAddr.trim() : '',
        customTargets: checkMode === 'throttled_tcp' ? parsedTargets : [],
        throttleMs: Math.max(200, throttleMs),
        timeoutMs: Math.max(250, timeoutMs),
        confirmActiveTraffic: checkMode === 'throttled_tcp' && confirmActiveTraffic,
      };
      const result = await runHealthCheck(req);
      setReport(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleAppendQuickPort = (port: number) => {
    const baseHosts = suggestedTargetHosts.length > 0 ? suggestedTargetHosts.slice(0, 3) : ['10.10.20.10'];
    const existing = splitTargetLines(targetsRaw);
    const additions = baseHosts
      .map((h) => `${h}:${port}`)
      .filter((t) => !existing.includes(t));
    if (additions.length === 0) return;
    setTargetsRaw([...existing, ...additions].join('\n'));
  };

  if (!isOpen) return null;

  const content = (
    <div
      className={`cyber-totp-container ${isView ? 'is-docked-view' : 'is-modal-view'}`}
      style={isView ? undefined : { width: '98%', maxWidth: '1220px', maxHeight: '92vh' }}
      onClick={(e) => {
        if (!isView) e.stopPropagation();
      }}
      role={isView ? 'region' : 'dialog'}
      aria-label="Route Health Check"
    >
      <div className="cyber-corner-reticle cyber-corner-tl" />
      <div className="cyber-corner-reticle cyber-corner-tr" />
      <div className="cyber-corner-reticle cyber-corner-bl" />
      <div className="cyber-corner-reticle cyber-corner-br" />

      {/* HUD Header */}
      <div className="cyber-totp-hud-header">
        <div className="cyber-hud-title-block">
          <div className="cyber-hud-tag-line">
            <span className="cyber-hazard-stripes">///</span>
            <span className="cyber-hud-tag">OPS-HEALTH</span>
            <span className="cyber-hud-delim">//</span>
            <span className="cyber-hud-subtag">ACTIVE LISTENERS, PIVOTS &amp; OPSEC ROUTE HEALTH DASHBOARD</span>
          </div>
          <h2 className="cyber-hud-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <CyberIcon name="shield" size={20} />
            <span>OPS LISTENERS &amp; ROUTE HEALTH DASHBOARD</span>
          </h2>
          <div className="cyber-telemetry-strip">
            <span className="cyber-telemetry-chip chip-cyan">
              <span className="chip-dot" /> ACTIVE ENDPOINTS: <strong>{activeDashboardItems.length}</strong>
            </span>
            <span className="cyber-telemetry-chip chip-cyan">
              <span className="chip-dot" /> POLICY: <strong>MANUAL PROBES / ZERO AUTO-SCAN</strong>
            </span>
            {report && (
              <>
                <span className="cyber-telemetry-chip chip-green">
                  <span className="chip-dot" /> HEALTHY: <strong>{report.healthyRoutes}</strong>
                </span>
                <span className={`cyber-telemetry-chip ${report.degradedRoutes > 0 ? 'chip-amber' : 'chip-cyan'}`}>
                  <span className="chip-dot" /> DEGRADED: <strong>{report.degradedRoutes}</strong>
                </span>
                <span className={`cyber-telemetry-chip ${report.downRoutes > 0 ? 'chip-red' : 'chip-cyan'}`}>
                  <span className="chip-dot" /> DOWN / ERROR: <strong>{report.downRoutes}</strong>
                </span>
                <span className="cyber-telemetry-chip chip-cyan">
                  <span className="chip-dot" /> PROBES OK: <strong>{report.probesSucceeded}/{report.probesExecuted}</strong>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="cyber-hud-actions-block">
          {onRefreshEndpoints && (
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={onRefreshEndpoints}
              title="Refresh active listeners, servers, pivots, and tunnels"
            >
              <CyberIcon name="radar" size={13} />
              <span>Refresh</span>
            </button>
          )}
          {onOpenPivotManager && (
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => {
                if (!isView) onClose();
                onOpenPivotManager();
              }}
            >
              <CyberIcon name="tunnel" size={13} />
              <span>Pivots</span>
            </button>
          )}
          {onOpenPortForwarding && (
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => {
                if (!isView) onClose();
                onOpenPortForwarding();
              }}
            >
              <CyberIcon name="network" size={13} />
              <span>Port Forwards</span>
            </button>
          )}
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close Route Health Check"
            title={isView ? 'Close Route Health View Tab' : 'Close Route Health Check'}
          >
            <CyberIcon name="close" size={14} />
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(330px, 380px) 1fr',
          gap: '0.85rem',
          padding: '0.75rem 1rem 1rem',
          overflow: 'hidden',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left Panel: OPSEC Probe Config & Trigger */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            overflowY: 'auto',
            paddingRight: '0.25rem',
          }}
        >
          <div className="cyber-hud-panel" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                CHECK MODE &amp; OPSEC GUARD
              </span>
              {activeEngagementId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={scopeOnly}
                    onChange={(e) => setScopeOnly(e.target.checked)}
                  />
                  <span>{activeEngagementName || 'Active Engagement'}</span>
                </label>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <button
                type="button"
                className={`cyber-pill-btn ${checkMode === 'local_only' ? 'active' : ''}`}
                onClick={() => setCheckMode('local_only')}
              >
                Passive Local Inspection
              </button>
              <button
                type="button"
                className={`cyber-pill-btn ${checkMode === 'throttled_tcp' ? 'active' : ''}`}
                onClick={() => setCheckMode('throttled_tcp')}
              >
                Throttled TCP Connect
              </button>
            </div>

            <div
              style={{
                background: checkMode === 'local_only' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.09)',
                border: `1px solid ${checkMode === 'local_only' ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.4)'}`,
                borderRadius: '4px',
                padding: '0.45rem 0.6rem',
                fontSize: '0.71rem',
                color: checkMode === 'local_only' ? '#6ee7b7' : '#fcd34d',
              }}
            >
              {checkMode === 'local_only'
                ? 'Zero remote packets: inspects SSH tunnel states, local -L/-D sockets, SOCKS5 handshakes, and ligolo-ng agent sessions only.'
                : 'Sequential 1-by-1 TCP connect probes (never parallel bursts) with mandatory throttle delay and max 25 target limit.'}
            </div>

            {checkMode === 'throttled_tcp' && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                    SOCKS5 Pivot / Proxy Tunnel (optional)
                  </label>
                  {socksCandidates.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.35rem' }}>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${socksProxyAddr === '' ? 'active' : ''}`}
                        onClick={() => setSocksProxyAddr('')}
                      >
                        Direct / Ligolo TUN
                      </button>
                      {socksCandidates.map((cand) => (
                        <button
                          key={cand.addr}
                          type="button"
                          className={`cyber-pill-btn ${socksProxyAddr === cand.addr ? 'active' : ''}`}
                          onClick={() => setSocksProxyAddr(cand.addr)}
                        >
                          {cand.label} ({cand.addr})
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    className="cyber-hud-input"
                    aria-label="SOCKS5 Proxy Address"
                    value={socksProxyAddr}
                    onChange={(e) => setSocksProxyAddr(e.target.value)}
                    placeholder="127.0.0.1:1080 (leave blank for Direct / Ligolo TUN)"
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <label style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                      Target Endpoints (`host:port`, max 25)
                    </label>
                    <span style={{ fontSize: '0.68rem', color: parsedTargets.length > 25 ? '#f87171' : '#64748b' }}>
                      {parsedTargets.length}/25
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.3rem' }}>
                    {[445, 3389, 22, 80, 443].map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="cyber-pill-btn"
                        onClick={() => handleAppendQuickPort(p)}
                        title={`Add port ${p} for target host`}
                      >
                        + :{p}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="cyber-hud-input"
                    aria-label="Target Probe Endpoints"
                    rows={4}
                    value={targetsRaw}
                    onChange={(e) => setTargetsRaw(e.target.value)}
                    placeholder={'10.10.20.10:445\n10.10.20.10:3389'}
                    style={{ fontFamily: 'monospace', resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                      Throttle Delay (ms, ≥200)
                    </label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      min={200}
                      max={10000}
                      step={50}
                      value={throttleMs}
                      onChange={(e) => setThrottleMs(Number(e.target.value) || 400)}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                      TCP Timeout (ms)
                    </label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      min={250}
                      max={10000}
                      step={100}
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(Number(e.target.value) || 1500)}
                    />
                  </div>
                </div>

                {parsedTargets.length > 0 && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.45rem',
                      fontSize: '0.73rem',
                      color: '#fde68a',
                      background: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      borderRadius: '4px',
                      padding: '0.45rem 0.55rem',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={confirmActiveTraffic}
                      onChange={(e) => setConfirmActiveTraffic(e.target.checked)}
                      style={{ marginTop: '0.15rem' }}
                    />
                    <span>
                      Authorize on-demand throttled probe traffic ({parsedTargets.length} target{parsedTargets.length === 1 ? '' : 's'}, {Math.max(200, throttleMs)}ms spacing)
                    </span>
                  </label>
                )}
              </>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.55)',
                  color: '#fca5a5',
                  borderRadius: '4px',
                  padding: '0.45rem 0.6rem',
                  fontSize: '0.74rem',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="button"
              className="cyber-btn cyber-btn-primary"
              disabled={isRunning}
              onClick={() => void handleRunCheck()}
              style={{ width: '100%', justifyContent: 'center', padding: '0.55rem 0.85rem' }}
            >
              <CyberIcon name="radar" size={14} />
              <span>{isRunning ? 'Inspecting Routes...' : 'Run Health Check'}</span>
            </button>
          </div>
        </div>

        {/* Right Panel: Route Health Matrix & Probe Diagnostics */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            overflowY: 'auto',
            paddingRight: '0.25rem',
            minHeight: 0,
          }}
        >
          {report?.opsecWarnings && report.opsecWarnings.length > 0 && (
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.78)',
                border: '1px solid rgba(45, 212, 191, 0.35)',
                borderRadius: '4px',
                padding: '0.5rem 0.7rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                fontSize: '0.72rem',
                color: '#a7f3d0',
              }}
            >
              {report.opsecWarnings.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                  <CyberIcon name="shield" size={13} />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {(['all', 'listeners', 'transfer', 'pivot', 'ssh', 'issues', 'custom'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`cyber-pill-btn ${entryFilter === tab ? 'active' : ''}`}
                  onClick={() => setEntryFilter(tab)}
                >
                  {tab === 'all' && 'All'}
                  {tab === 'listeners' && 'Shell Listeners'}
                  {tab === 'transfer' && 'File Servers'}
                  {tab === 'pivot' && 'Pivots'}
                  {tab === 'ssh' && 'SSH Tunnels'}
                  {tab === 'issues' && 'Issues Only'}
                  {tab === 'custom' && 'Target Probes'}
                </button>
              ))}
            </div>
            {report && (
              <span style={{ fontSize: '0.71rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                Checked {new Date(report.checkedAt).toLocaleTimeString()} · {report.durationMs}ms
              </span>
            )}
          </div>

          {!report ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {activeDashboardItems.length > 0 && (
                <div className="cyber-hud-panel" style={{ padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                      LIVE LISTENERS, PIVOTS &amp; SERVERS ({activeDashboardItems.length})
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>In-memory status (0 probes sent)</span>
                  </div>
                  {activeDashboardItems
                    .filter((item) => {
                      if (entryFilter === 'listeners') return item.sourceType === 'shell-listener';
                      if (entryFilter === 'transfer') return item.sourceType === 'transfer-server';
                      if (entryFilter === 'pivot') return item.sourceType === 'pivot';
                      if (entryFilter === 'ssh') return item.sourceType === 'ssh-tunnel';
                      return true;
                    })
                    .map((item) => (
                      <div
                        key={`${item.sourceType}-${item.id}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.45rem 0.65rem',
                          background: 'rgba(15, 23, 42, 0.55)',
                          border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                          borderRadius: 4,
                          fontFamily: 'monospace',
                          fontSize: '0.73rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ color: '#34d399', fontWeight: 700 }}>[{item.status.toUpperCase()}]</span>
                          <strong style={{ color: '#e2e8f0' }}>{item.name}</strong>
                          <span style={{ color: 'var(--accent-bright)' }}>({item.kind})</span>
                          <span style={{ color: '#94a3b8' }}>{item.endpoint}</span>
                          {item.metaSummary && <span style={{ color: '#fcd34d' }}>· {item.metaSummary}</span>}
                        </div>
                        {onStopEndpoint && (
                          <button
                            type="button"
                            className="cyber-btn cyber-btn-secondary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', color: '#f87171' }}
                            disabled={stoppingKey === `${item.sourceType}:${item.id}`}
                            onClick={() => void handleStopItem(item.sourceType, item.id)}
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}

              <div
                className="cyber-hud-panel"
                style={{
                  padding: '1.6rem',
                  textAlign: 'center',
                  color: '#94a3b8',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.6rem',
                }}
              >
                <CyberIcon name="radar" size={28} />
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#e2e8f0' }}>
                  {activeDashboardItems.length > 0
                    ? 'Verify Live Sockets & Reachability'
                    : 'No Health Check Executed Yet'}
                </div>
                <div style={{ fontSize: '0.75rem', maxWidth: '480px' }}>
                  DoubleAgent never scans in the background. Click <strong>Run Health Check</strong> on the left to test active Shell Listeners, File Servers, SSH tunnels, SOCKS5 listeners, and Ligolo/Chisel sessions, or switch to Throttled TCP Connect to probe internal targets.
                </div>
              </div>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="cyber-hud-panel" style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
              No matching listeners, routes, or probes in this filter view.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {filteredEntries.map((entry: RouteHealthEntry) => {
                const badge = statusBadgeStyle(entry.status);
                const canStop =
                  Boolean(onStopEndpoint) &&
                  (entry.sourceType === 'shell-listener' ||
                    entry.sourceType === 'transfer-server' ||
                    entry.sourceType === 'pivot' ||
                    entry.sourceType === 'ssh-tunnel') &&
                  (entry.runtimeState === 'running' || entry.runtimeState === 'active' || entry.runtimeState === 'listening');
                return (
                  <div
                    key={`${entry.sourceType}-${entry.id}`}
                    className="cyber-hud-panel"
                    style={{
                      padding: '0.65rem 0.8rem',
                      borderColor: badge.border,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.45rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            padding: '0.12rem 0.42rem',
                            borderRadius: '3px',
                            background: badge.bg,
                            border: `1px solid ${badge.border}`,
                            color: badge.color,
                            fontFamily: 'monospace',
                          }}
                        >
                          {badge.label}
                        </span>
                        <strong style={{ fontSize: '0.83rem', color: '#f1f5f9' }}>{entry.name}</strong>
                        <span style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'monospace' }}>
                          [{entry.kind}]
                        </span>
                        {entry.metaSummary && (
                          <span style={{ fontSize: '0.7rem', color: '#fcd34d', fontFamily: 'monospace' }}>
                            · {entry.metaSummary}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.71rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                        {entry.bindEndpoint && <span>BIND {entry.bindEndpoint}</span>}
                        {entry.targetEndpoint && <span>-&gt; {entry.targetEndpoint}</span>}
                        {typeof entry.bytesTransferred === 'number' && entry.bytesTransferred > 0 && (
                          <span>TX/RX {formatBytesShort(entry.bytesTransferred)}</span>
                        )}
                        {canStop && (
                          <button
                            type="button"
                            className="cyber-btn cyber-btn-secondary"
                            style={{ padding: '0.18rem 0.45rem', fontSize: '0.67rem', color: '#f87171' }}
                            disabled={stoppingKey === `${entry.sourceType}:${entry.id}`}
                            onClick={() => void handleStopItem(entry.sourceType, entry.id)}
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    </div>

                    {entry.subnets && entry.subnets.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.69rem', color: '#64748b' }}>Subnets:</span>
                        {entry.subnets.map((sub) => (
                          <span
                            key={sub}
                            style={{
                              fontSize: '0.69rem',
                              fontFamily: 'monospace',
                              color: 'var(--accent-text)',
                              background: 'rgba(6, 182, 212, 0.1)',
                              border: '1px solid rgba(6, 182, 212, 0.25)',
                              padding: '0.05rem 0.35rem',
                              borderRadius: '3px',
                            }}
                          >
                            {sub}
                          </span>
                        ))}
                      </div>
                    )}

                    {entry.ligoloAgents && entry.ligoloAgents.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0.35rem 0.5rem', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '3px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#34d399' }}>
                          ACTIVE PIVOT SESSIONS ({entry.ligoloAgents.length})
                        </span>
                        {entry.ligoloAgents.map((ag, idx) => (
                          <span key={idx} style={{ fontSize: '0.71rem', fontFamily: 'monospace', color: '#d1fae5' }}>
                            {ag}
                          </span>
                        ))}
                      </div>
                    )}

                    {entry.errorMsg && (
                      <div style={{ fontSize: '0.72rem', color: '#fca5a5', fontFamily: 'monospace' }}>
                        Error: {entry.errorMsg}
                      </div>
                    )}

                    {entry.probes && entry.probes.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {entry.probes.map((probe: ProbeTargetResult, idx: number) => (
                          <div
                            key={`${probe.target}-${idx}`}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '0.5rem',
                              fontSize: '0.72rem',
                              fontFamily: 'monospace',
                              padding: '0.28rem 0.45rem',
                              borderRadius: '3px',
                              background: 'rgba(15, 23, 42, 0.6)',
                              border: `1px solid ${probe.reachable ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              <span style={{ color: probe.reachable ? '#34d399' : '#f87171', fontWeight: 700 }}>
                                {probe.reachable ? 'OPEN' : probe.status.toUpperCase()}
                              </span>
                              <span style={{ color: '#e2e8f0' }}>{probe.target}</span>
                              {probe.viaProxy && (
                                <span style={{ color: 'var(--accent-bright)' }}>via {probe.viaProxy}</span>
                              )}
                            </div>
                            <div style={{ color: '#94a3b8' }}>
                              {probe.detail}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (isView) {
    return content;
  }

  return (
    <div
      className="modal-backdrop cyber-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {content}
    </div>
  );
};
