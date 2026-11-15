import React, { useState } from 'react';
import { ForwardRule, ForwardTunnelStatus, ForwardRuleType } from '../types/forward';
import { formatBytes } from './SftpBrowserView';
import { CyberIcon } from './CyberIcon';

export interface HostOption {
  id: string;
  label: string;
  address: string;
}

export interface ActiveSessionOption {
  sessionId: string;
  hostId?: string;
  title: string;
}

export interface EngagementOption {
  id: string;
  name: string;
}

export interface PortForwardingViewProps {
  rules: ForwardRule[];
  activeTunnels: ForwardTunnelStatus[];
  hosts: HostOption[];
  activeSessions: ActiveSessionOption[];
  engagements?: EngagementOption[];
  activeEngagementId?: string;
  onSaveRule: (rule: ForwardRule) => Promise<void>;
  onDeleteRule: (ruleId: string) => Promise<void>;
  onStartTunnel: (sessionId: string, ruleId: string) => Promise<void>;
  onStartTunnelWithHost?: (hostId: string, ruleId: string) => Promise<void>;
  onStopTunnel: (tunnelId: string) => Promise<void>;
  onOpenProxychainsExport?: () => void;
  onClose: () => void;
  initialHostId?: string;
}

export function PortForwardingView({
  rules,
  activeTunnels,
  hosts,
  activeSessions,
  engagements = [],
  activeEngagementId = '',
  onSaveRule,
  onDeleteRule,
  onStartTunnel,
  onStartTunnelWithHost,
  onStopTunnel,
  onOpenProxychainsExport,
  onClose,
  initialHostId,
}: PortForwardingViewProps): React.JSX.Element {
  const [showAddForm, setShowAddForm] = useState<boolean>(Boolean(initialHostId));
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleType, setRuleType] = useState<ForwardRuleType>('L');
  const [label, setLabel] = useState<string>('');
  const [hostId, setHostId] = useState<string>(initialHostId || '');
  const [ruleEngagementId, setRuleEngagementId] = useState<string>(activeEngagementId || '');
  const [scopeFilter, setScopeFilter] = useState<'context' | 'engagement' | 'global' | 'all'>('context');
  const [bindAddress, setBindAddress] = useState<string>('127.0.0.1');
  const [bindPort, setBindPort] = useState<string>('8080');
  const [targetHost, setTargetHost] = useState<string>('127.0.0.1');
  const [targetPort, setTargetPort] = useState<string>('80');
  const [autoStart, setAutoStart] = useState<boolean>(false);
  const [selectedSessionForStart, setSelectedSessionForStart] = useState<Map<string, string>>(new Map());
  const [selectedHostForStart, setSelectedHostForStart] = useState<Map<string, string>>(new Map());
  const [startingRuleId, setStartingRuleId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string>('');

  const resetForm = () => {
    setShowAddForm(false);
    setEditingRuleId(null);
    setRuleType('L');
    setLabel('');
    setHostId('');
    setRuleEngagementId(activeEngagementId || '');
    setBindAddress('127.0.0.1');
    setBindPort('8080');
    setTargetHost('127.0.0.1');
    setTargetPort('80');
    setAutoStart(false);
    setFormError('');
  };

  const startEditRule = (rule: ForwardRule) => {
    setEditingRuleId(rule.id);
    setRuleType(rule.type);
    setLabel(rule.label || '');
    setHostId(rule.hostId || '');
    setRuleEngagementId(rule.engagementId || '');
    setBindAddress(rule.bindAddress || '127.0.0.1');
    setBindPort(String(rule.bindPort));
    setTargetHost(rule.targetHost || '127.0.0.1');
    setTargetPort(String(rule.targetPort || 80));
    setAutoStart(rule.autoStart);
    setShowAddForm(true);
    setFormError('');
  };

  const filteredRules = rules.filter((r) => {
    const rEng = r.engagementId || '';
    if (scopeFilter === 'all') return true;
    if (scopeFilter === 'global') return rEng === '';
    if (scopeFilter === 'engagement') {
      return activeEngagementId ? rEng === activeEngagementId : rEng !== '';
    }
    // 'context': show global rules + active engagement rules (hide other engagements' rules)
    if (!activeEngagementId) return rEng === '';
    return rEng === '' || rEng === activeEngagementId;
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const bPort = parseInt(bindPort, 10);
    if (isNaN(bPort) || bPort <= 0 || bPort > 65535) {
      setFormError('Bind Port must be a valid port number between 1 and 65535.');
      return;
    }

    let tPort = 0;
    if (ruleType !== 'D') {
      tPort = parseInt(targetPort, 10);
      if (isNaN(tPort) || tPort <= 0 || tPort > 65535) {
        setFormError('Target Port must be a valid port number between 1 and 65535.');
        return;
      }
    }

    const rule: ForwardRule = {
      id: editingRuleId || `rule-${Date.now()}`,
      label: label.trim() || undefined,
      type: ruleType,
      hostId: hostId || undefined,
      engagementId: ruleEngagementId || undefined,
      bindAddress: bindAddress.trim() || '127.0.0.1',
      bindPort: bPort,
      targetHost: ruleType !== 'D' ? targetHost.trim() || '127.0.0.1' : undefined,
      targetPort: ruleType !== 'D' ? tPort : undefined,
      autoStart,
    };

    try {
      await onSaveRule(rule);
      resetForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const getTunnelForRule = (rule: ForwardRule): ForwardTunnelStatus | undefined => {
    return activeTunnels.find((t) => {
      if (t.status !== 'active') return false;
      if (t.ruleId && t.ruleId === rule.id) return true;
      if (t.id === rule.id) return true;
      if (
        t.type === rule.type &&
        t.bindPort === rule.bindPort &&
        (t.bindAddress === rule.bindAddress || (!t.bindAddress && rule.bindAddress === '127.0.0.1'))
      ) {
        return true;
      }
      return false;
    });
  };

  return (
    <div
      role="dialog"
      aria-label="Port Forwarding & Tunnels"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="cyber-modal-backdrop"
    >
      <div
        className="cyber-modal-card"
        style={{
          width: '880px',
          maxWidth: '95vw',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="cyber-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 className="cyber-modal-title">
              <span className="cyber-hazard-badge">///</span> PORT FORWARDING &amp; TUNNELS
            </h2>
            <span className="cyber-modal-meta">
              {rules.length} rule{rules.length === 1 ? '' : 's'} • {activeTunnels.length} active
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {onOpenProxychainsExport && (
              <button
                type="button"
                className="hud-btn-outline"
                onClick={onOpenProxychainsExport}
                style={{ fontSize: '11px', padding: '0.25rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <CyberIcon name="chain" size={11} />
                <span>Export proxychains.conf</span>
              </button>
            )}
            {!showAddForm && (
              <button
                type="button"
                className="hud-btn-primary"
                onClick={() => {
                  resetForm();
                  setShowAddForm(true);
                }}
                style={{ fontSize: '11px', padding: '0.25rem 0.75rem' }}
              >
                + New Forward Rule
              </button>
            )}
            <button
              type="button"
              className="hud-btn-danger"
              aria-label="Close Port Forwarding"
              onClick={onClose}
              style={{
                fontSize: '12px',
                padding: '0.2rem 0.55rem',
                minWidth: '28px',
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="cyber-modal-body">
          {/* Add / Edit Rule Form */}
          {showAddForm && (
            <form onSubmit={handleSave} className="cyber-hud-card">
              <h4
                style={{
                  margin: '0 0 10px',
                  color: '#00f0ff',
                  fontSize: '13px',
                  fontFamily: 'JetBrains Mono, monospace',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {editingRuleId ? '/// EDIT FORWARD RULE ///' : '/// NEW FORWARD RULE ///'}
              </h4>

              {formError && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: 'rgba(255, 0, 60, 0.15)',
                    border: '1px solid #ff003c',
                    color: '#ff4d6d',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  [ERROR] {formError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="cyber-label">Rule Type</label>
                  <select
                    aria-label="Rule Type"
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as ForwardRuleType)}
                    className="cyber-hud-select"
                  >
                    <option value="L">Local (-L) • Local Port ➔ Remote Target</option>
                    <option value="R">Remote (-R) • Remote Port ➔ Local Target</option>
                    <option value="D">Dynamic (-D) • Local SOCKS5 Proxy</option>
                  </select>
                </div>

                <div>
                  <label className="cyber-label">Rule Label / Description</label>
                  <input
                    aria-label="Rule Label"
                    type="text"
                    placeholder="e.g. Postgres DB, Web Admin, Proxy"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="cyber-hud-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="cyber-label">Associated Host</label>
                  <select
                    aria-label="Associated Host"
                    value={hostId}
                    onChange={(e) => setHostId(e.target.value)}
                    className="cyber-hud-select"
                  >
                    <option value="">Any Active SSH Session</option>
                    {hosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label} ({h.address})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="cyber-label">Configuration Scope (Global vs. Engagement)</label>
                  <select
                    aria-label="Rule Scope"
                    value={ruleEngagementId}
                    onChange={(e) => setRuleEngagementId(e.target.value)}
                    className="cyber-hud-select"
                  >
                    <option value="">Global (Reusable across all engagements)</option>
                    {engagements.map((eng) => (
                      <option key={eng.id} value={eng.id}>
                        Engagement: {eng.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: '#cbd5e1' }}>
                  <input
                    aria-label="Auto-start tunnel"
                    type="checkbox"
                    checked={autoStart}
                    onChange={(e) => setAutoStart(e.target.checked)}
                    style={{ accentColor: '#00f0ff', width: '15px', height: '15px' }}
                  />
                  <span>Auto-start tunnel when connecting to host</span>
                </label>
              </div>

              {/* Bind & Target parameters */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: ruleType === 'D' ? '1fr 1fr' : '1fr 1fr 1fr 1fr',
                  gap: '10px',
                }}
              >
                <div>
                  <label className="cyber-label">Bind Address</label>
                  <input
                    aria-label="Bind Address"
                    type="text"
                    value={bindAddress}
                    onChange={(e) => setBindAddress(e.target.value)}
                    placeholder="127.0.0.1"
                    className="cyber-hud-input"
                  />
                </div>

                <div>
                  <label className="cyber-label">Bind Port</label>
                  <input
                    aria-label="Bind Port"
                    type="number"
                    value={bindPort}
                    onChange={(e) => setBindPort(e.target.value)}
                    placeholder="8080"
                    min="1"
                    max="65535"
                    className="cyber-hud-input"
                  />
                </div>

                {ruleType !== 'D' && (
                  <>
                    <div>
                      <label className="cyber-label">Target Host</label>
                      <input
                        aria-label="Target Host"
                        type="text"
                        value={targetHost}
                        onChange={(e) => setTargetHost(e.target.value)}
                        placeholder="127.0.0.1"
                        className="cyber-hud-input"
                      />
                    </div>

                    <div>
                      <label className="cyber-label">Target Port</label>
                      <input
                        aria-label="Target Port"
                        type="number"
                        value={targetPort}
                        onChange={(e) => setTargetPort(e.target.value)}
                        placeholder="80"
                        min="1"
                        max="65535"
                        className="cyber-hud-input"
                      />
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                <button
                  type="button"
                  className="hud-btn-outline"
                  onClick={resetForm}
                  style={{ fontSize: '11px', padding: '0.35rem 0.8rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="hud-btn-primary"
                  style={{ fontSize: '11px', padding: '0.35rem 1rem' }}
                >
                  Save Rule
                </button>
              </div>
            </form>
          )}

          {/* Active Running Tunnels Section */}
          {activeTunnels.length > 0 && (
            <div
              style={{
                padding: '12px',
                background: 'rgba(0, 240, 255, 0.05)',
                border: '1px solid rgba(0, 240, 255, 0.35)',
                clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#00ff9d', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '0.06em' }}>
                  <span className="pane-led live-green" />
                  /// RUNNING TUNNELS ({activeTunnels.length}) ///
                </span>
                <span style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.04em' }}>
                  ACTIVE BACKGROUND FORWARDERS
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {activeTunnels.map((tun) => (
                  <div
                    key={tun.id}
                    className="cyber-route-display"
                    style={{
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span className="cyber-route-chip">
                        -{tun.type}
                      </span>
                      <span style={{ color: '#f1f5f9' }}>
                        {tun.bindAddress}:{tun.bindPort}
                      </span>
                      <span className="cyber-route-arrow">──────▶</span>
                      <span style={{ color: '#00f0ff' }}>
                        {tun.type === 'D' ? 'SOCKS5 Dynamic Proxy' : `${tun.targetHost}:${tun.targetPort}`}
                      </span>
                      <span className="cyber-telemetry-badge">
                        IN: <strong>{formatBytes(tun.bytesIn)}</strong> | OUT: <strong>{formatBytes(tun.bytesOut)}</strong> | <strong>{tun.activeConns} conns</strong>
                      </span>
                      {tun.errorMessage && (
                        <span style={{ fontSize: '10px', color: '#ff4d6d' }}>
                          [ERR] {tun.errorMessage}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="hud-btn-danger"
                      onClick={() => void onStopTunnel(tun.id)}
                      style={{ fontSize: '10px', padding: '0.2rem 0.55rem' }}
                      title="Stop this running tunnel"
                    >
                      Stop
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scope Filter Bar */}
          {engagements.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 10px', background: 'rgba(6, 13, 24, 0.85)', border: '1px solid rgba(0, 240, 255, 0.2)' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.05em' }}>
                SCOPE VIEW:
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(
                  [
                    { id: 'context', label: activeEngagementId ? 'Active Engagement + Global' : 'Global (Casual Mode)' },
                    { id: 'engagement', label: 'Engagement Only' },
                    { id: 'global', label: 'Global Only' },
                    { id: 'all', label: `All (${rules.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={scopeFilter === tab.id ? 'hud-btn-primary' : 'hud-btn-outline'}
                    style={{ fontSize: '10px', padding: '3px 8px' }}
                    onClick={() => setScopeFilter(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rules List */}
          {filteredRules.length === 0 ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#94a3b8',
                background: 'rgba(8, 14, 24, 0.7)',
                border: '1px dashed rgba(0, 240, 255, 0.25)',
                clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))',
              }}
            >
              <div style={{ marginBottom: '8px', color: '#00f0ff', display: 'flex', justifyContent: 'center' }}>
                <CyberIcon name="network" size={26} />
              </div>
              <p style={{ margin: '0 0 6px', fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.06em' }}>
                /// NO PORT FORWARDING RULES CONFIGURED ///
              </p>
              <p style={{ margin: 0, fontSize: '12px' }}>
                Add Local (-L), Remote (-R), or Dynamic SOCKS5 (-D) rules globally or scoped to the active engagement.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredRules.map((rule) => {
                const activeTun = getTunnelForRule(rule);
                const isActive = !!activeTun;
                const associatedHost = hosts.find((h) => h.id === rule.hostId);
                const ruleEngagement = engagements.find((e) => e.id === rule.engagementId);

                return (
                  <div
                    key={rule.id}
                    className={`cyber-rule-card ${isActive ? 'active' : ''}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span className="cyber-route-chip">
                          {rule.type === 'L'
                            ? 'Local -L'
                            : rule.type === 'R'
                            ? 'Remote -R'
                            : 'Dynamic -D (SOCKS5)'}
                        </span>

                        <strong style={{ fontSize: '13px', color: '#f1f5f9', letterSpacing: '0.04em' }}>
                          {rule.label || `${rule.bindAddress}:${rule.bindPort}`}
                        </strong>

                        <span
                          style={{
                            fontSize: '10px',
                            color: ruleEngagement ? '#00f0ff' : '#94a3b8',
                            background: ruleEngagement ? 'rgba(0, 240, 255, 0.12)' : 'rgba(148, 163, 184, 0.1)',
                            border: `1px solid ${ruleEngagement ? 'rgba(0, 240, 255, 0.4)' : 'rgba(148, 163, 184, 0.25)'}`,
                            padding: '1px 6px',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                          title={ruleEngagement ? `Scoped to engagement ${ruleEngagement.name}` : 'Global rule (available across all engagements)'}
                        >
                          {ruleEngagement ? `ENGAGEMENT: ${ruleEngagement.name}` : 'GLOBAL'}
                        </span>

                        {associatedHost && (
                          <span
                            style={{
                              fontSize: '11px',
                              color: '#94a3b8',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              padding: '1px 6px',
                            }}
                          >
                            Host: {associatedHost.label}
                          </span>
                        )}

                        {rule.autoStart && (
                          <span
                            style={{
                              fontSize: '10px',
                              color: '#00ff9d',
                              border: '1px solid rgba(0, 255, 157, 0.4)',
                              background: 'rgba(0, 255, 157, 0.1)',
                              padding: '1px 5px',
                            }}
                          >
                            AUTO-START
                          </span>
                        )}
                      </div>

                      {/* Status indicator */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className={`pane-led ${isActive ? 'live-green' : 'offline-red'}`} />
                        <span
                          style={{
                            fontSize: '11px',
                            color: isActive ? '#00ff9d' : '#94a3b8',
                            fontWeight: 800,
                            letterSpacing: '0.06em',
                          }}
                        >
                          {isActive ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </div>
                    </div>

                    {/* Mapping details & Metrics */}
                    <div className="cyber-route-display" style={{ justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#cbd5e1' }}>
                          {rule.bindAddress}:{rule.bindPort}
                        </span>
                        <span className="cyber-route-arrow">──────▶</span>
                        <span style={{ color: '#00f0ff' }}>
                          {rule.type === 'D'
                            ? 'SOCKS5 Dynamic Proxy'
                            : `${rule.targetHost}:${rule.targetPort}`}
                        </span>
                      </div>

                      {isActive && activeTun && (
                        <div className="cyber-telemetry-badge">
                          <span>IN: <strong>{formatBytes(activeTun.bytesIn)}</strong></span>
                          <span>|</span>
                          <span>OUT: <strong>{formatBytes(activeTun.bytesOut)}</strong></span>
                          <span>|</span>
                          <span>{activeTun.activeConns} active connection{activeTun.activeConns === 1 ? '' : 's'}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {!isActive ? (
                          <>
                            {activeSessions.length > 0 ? (
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <select
                                  value={
                                    selectedSessionForStart.get(rule.id) ||
                                    (rule.hostId
                                      ? activeSessions.find((s) => s.hostId === rule.hostId)?.sessionId ||
                                        (hosts.some((h) => h.id === rule.hostId)
                                          ? `host:${rule.hostId}`
                                          : activeSessions[0]?.sessionId)
                                      : activeSessions[0]?.sessionId) ||
                                    ''
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setSelectedSessionForStart((prev) => new Map(prev.set(rule.id, val)));
                                  }}
                                  className="cyber-hud-select"
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '11px', width: 'auto' }}
                                >
                                  <optgroup label="Active SSH Sessions">
                                    {activeSessions.map((s) => (
                                      <option key={s.sessionId} value={s.sessionId}>
                                        Session: {s.title}
                                      </option>
                                    ))}
                                  </optgroup>
                                  {hosts.length > 0 && onStartTunnelWithHost && (
                                    <optgroup label="Connect in background">
                                      {hosts.map((h) => (
                                        <option key={`host-${h.id}`} value={`host:${h.id}`}>
                                          ⚡ Connect {h.label} ({h.address})
                                        </option>
                                      ))}
                                    </optgroup>
                                  )}
                                </select>
                                <button
                                  type="button"
                                  className="hud-btn-primary"
                                  disabled={startingRuleId === rule.id}
                                  onClick={async () => {
                                    const targetVal =
                                      selectedSessionForStart.get(rule.id) ||
                                      (rule.hostId
                                        ? activeSessions.find((s) => s.hostId === rule.hostId)?.sessionId ||
                                          (hosts.some((h) => h.id === rule.hostId)
                                            ? `host:${rule.hostId}`
                                            : activeSessions[0]?.sessionId)
                                        : activeSessions[0]?.sessionId);
                                    if (!targetVal) return;
                                    setStartingRuleId(rule.id);
                                    try {
                                      if (targetVal.startsWith('host:')) {
                                        const hId = targetVal.slice(5);
                                        if (onStartTunnelWithHost) {
                                          await onStartTunnelWithHost(hId, rule.id);
                                        }
                                      } else {
                                        await onStartTunnel(targetVal, rule.id);
                                      }
                                    } finally {
                                      setStartingRuleId(null);
                                    }
                                  }}
                                  style={{ fontSize: '11px', padding: '0.25rem 0.65rem' }}
                                >
                                  {startingRuleId === rule.id ? 'Starting...' : '▶ Start Tunnel'}
                                </button>
                              </div>
                            ) : associatedHost && onStartTunnelWithHost ? (
                              <button
                                type="button"
                                className="hud-btn-primary"
                                disabled={startingRuleId === rule.id}
                                onClick={async () => {
                                  if (!rule.hostId) return;
                                  setStartingRuleId(rule.id);
                                  try {
                                    await onStartTunnelWithHost(rule.hostId, rule.id);
                                  } finally {
                                    setStartingRuleId(null);
                                  }
                                }}
                                style={{ fontSize: '11px', padding: '0.25rem 0.65rem' }}
                                title={`Connects to ${associatedHost.label} in background and starts the tunnel`}
                              >
                                {startingRuleId === rule.id
                                  ? '⏳ Connecting...'
                                  : `⚡ Connect ${associatedHost.label} & Start Tunnel`}
                              </button>
                            ) : hosts.length > 0 && onStartTunnelWithHost ? (
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <select
                                  value={selectedHostForStart.get(rule.id) || hosts[0]?.id || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setSelectedHostForStart((prev) => new Map(prev.set(rule.id, val)));
                                  }}
                                  className="cyber-hud-select"
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '11px', width: 'auto' }}
                                >
                                  {hosts.map((h) => (
                                    <option key={h.id} value={h.id}>
                                      {h.label} ({h.address})
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="hud-btn-primary"
                                  disabled={startingRuleId === rule.id}
                                  onClick={async () => {
                                    const targetHostId =
                                      selectedHostForStart.get(rule.id) || hosts[0]?.id;
                                    if (!targetHostId) return;
                                    setStartingRuleId(rule.id);
                                    try {
                                      await onStartTunnelWithHost(targetHostId, rule.id);
                                    } finally {
                                      setStartingRuleId(null);
                                    }
                                  }}
                                  style={{ fontSize: '11px', padding: '0.25rem 0.65rem' }}
                                  title="Connect to selected host in background and start tunnel"
                                >
                                  {startingRuleId === rule.id
                                    ? '⏳ Connecting...'
                                    : '⚡ Connect & Start Tunnel'}
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                                Connect to an SSH session or add a host to start this tunnel.
                              </span>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            className="hud-btn-danger"
                            onClick={() => void onStopTunnel(activeTun.id)}
                            style={{ fontSize: '11px', padding: '0.25rem 0.65rem' }}
                          >
                            Stop Tunnel
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="hud-btn-outline"
                          onClick={() => startEditRule(rule)}
                          style={{ fontSize: '11px', padding: '0.2rem 0.55rem' }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="hud-btn-danger"
                          onClick={() => void onDeleteRule(rule.id)}
                          style={{ fontSize: '11px', padding: '0.2rem 0.55rem' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
