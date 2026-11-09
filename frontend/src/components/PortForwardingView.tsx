import React, { useState } from 'react';
import { ForwardRule, ForwardTunnelStatus, ForwardRuleType } from '../types/forward';
import { formatBytes } from './SftpBrowserView';

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

export interface PortForwardingViewProps {
  rules: ForwardRule[];
  activeTunnels: ForwardTunnelStatus[];
  hosts: HostOption[];
  activeSessions: ActiveSessionOption[];
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
    setBindAddress(rule.bindAddress || '127.0.0.1');
    setBindPort(String(rule.bindPort));
    setTargetHost(rule.targetHost || '127.0.0.1');
    setTargetPort(String(rule.targetPort || 80));
    setAutoStart(rule.autoStart);
    setShowAddForm(true);
    setFormError('');
  };

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
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '820px',
          maxHeight: '90vh',
          backgroundColor: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
          color: '#e6edf3',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '13px',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid #30363d',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#0d1117',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#58a6ff', margin: 0 }}>
              Port Forwarding &amp; Tunnels
            </h2>
            <span style={{ fontSize: '11px', color: '#8b949e' }}>
              {rules.length} rule{rules.length === 1 ? '' : 's'} • {activeTunnels.length} active tunnel{activeTunnels.length === 1 ? '' : 's'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {onOpenProxychainsExport && (
              <button
                type="button"
                onClick={onOpenProxychainsExport}
                style={{
                  padding: '4px 10px',
                  backgroundColor: '#21262d',
                  color: '#58a6ff',
                  border: '1px solid #30363d',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>⛓️</span>
                <span>Export proxychains.conf</span>
              </button>
            )}
            {!showAddForm && (
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowAddForm(true);
                }}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#238636',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '12px',
                }}
              >
                + New Forward Rule
              </button>
            )}
            <button
              type="button"
              aria-label="Close Port Forwarding"
              onClick={onClose}
              style={{
                padding: '4px 8px',
                backgroundColor: 'transparent',
                color: '#8b949e',
                border: 'none',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {/* Add / Edit Rule Form */}
          {showAddForm && (
            <form
              onSubmit={handleSave}
              style={{
                backgroundColor: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '16px',
                marginBottom: '16px',
              }}
            >
              <h4 style={{ margin: '0 0 12px', color: '#58a6ff', fontSize: '13px' }}>
                {editingRuleId ? 'Edit Forward Rule' : 'New Port Forwarding Rule'}
              </h4>

              {formError && (
                <div style={{ padding: '6px 12px', backgroundColor: '#3e1b1e', color: '#ff7b72', marginBottom: '12px', borderRadius: '4px', fontSize: '12px' }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
                    Rule Type
                  </label>
                  <select
                    aria-label="Rule Type"
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as ForwardRuleType)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      backgroundColor: '#161b22',
                      color: '#e6edf3',
                      border: '1px solid #30363d',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  >
                    <option value="L">Local (-L) • Local Port ➔ Remote Target</option>
                    <option value="R">Remote (-R) • Remote Port ➔ Local Target</option>
                    <option value="D">Dynamic (-D) • Local SOCKS5 Proxy</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
                    Rule Label / Description
                  </label>
                  <input
                    aria-label="Rule Label"
                    type="text"
                    placeholder="e.g. Postgres DB, Web Admin, Proxy"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      backgroundColor: '#161b22',
                      color: '#e6edf3',
                      border: '1px solid #30363d',
                      borderRadius: '4px',
                      boxSizing: 'border-box',
                      fontSize: '12px',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
                    Associated Host
                  </label>
                  <select
                    aria-label="Associated Host"
                    value={hostId}
                    onChange={(e) => setHostId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      backgroundColor: '#161b22',
                      color: '#e6edf3',
                      border: '1px solid #30363d',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  >
                    <option value="">Any Active SSH Session</option>
                    {hosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label} ({h.address})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                    <input
                      aria-label="Auto-start tunnel"
                      type="checkbox"
                      checked={autoStart}
                      onChange={(e) => setAutoStart(e.target.checked)}
                      style={{ accentColor: '#238636' }}
                    />
                    <span>Auto-start tunnel when connecting to host</span>
                  </label>
                </div>
              </div>

              {/* Bind & Target parameters */}
              <div style={{ display: 'grid', gridTemplateColumns: ruleType === 'D' ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
                    Bind Address
                  </label>
                  <input
                    aria-label="Bind Address"
                    type="text"
                    value={bindAddress}
                    onChange={(e) => setBindAddress(e.target.value)}
                    placeholder="127.0.0.1"
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      backgroundColor: '#161b22',
                      color: '#e6edf3',
                      border: '1px solid #30363d',
                      borderRadius: '4px',
                      boxSizing: 'border-box',
                      fontSize: '12px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
                    Bind Port
                  </label>
                  <input
                    aria-label="Bind Port"
                    type="number"
                    value={bindPort}
                    onChange={(e) => setBindPort(e.target.value)}
                    placeholder="8080"
                    min="1"
                    max="65535"
                    style={{
                      width: '100%',
                      padding: '5px 8px',
                      backgroundColor: '#161b22',
                      color: '#e6edf3',
                      border: '1px solid #30363d',
                      borderRadius: '4px',
                      boxSizing: 'border-box',
                      fontSize: '12px',
                    }}
                  />
                </div>

                {ruleType !== 'D' && (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
                        Target Host
                      </label>
                      <input
                        aria-label="Target Host"
                        type="text"
                        value={targetHost}
                        onChange={(e) => setTargetHost(e.target.value)}
                        placeholder="127.0.0.1"
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          backgroundColor: '#161b22',
                          color: '#e6edf3',
                          border: '1px solid #30363d',
                          borderRadius: '4px',
                          boxSizing: 'border-box',
                          fontSize: '12px',
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#8b949e', marginBottom: '4px' }}>
                        Target Port
                      </label>
                      <input
                        aria-label="Target Port"
                        type="number"
                        value={targetPort}
                        onChange={(e) => setTargetPort(e.target.value)}
                        placeholder="80"
                        min="1"
                        max="65535"
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          backgroundColor: '#161b22',
                          color: '#e6edf3',
                          border: '1px solid #30363d',
                          borderRadius: '4px',
                          boxSizing: 'border-box',
                          fontSize: '12px',
                        }}
                      />
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={resetForm}
                  style={{
                    padding: '4px 12px',
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
                  type="submit"
                  style={{
                    padding: '4px 14px',
                    backgroundColor: '#238636',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Save Rule
                </button>
              </div>
            </form>
          )}

          {/* Active Running Tunnels Section */}
          {activeTunnels.length > 0 && (
            <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#0d1117', border: '1px solid #238636', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#3fb950', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3fb950', boxShadow: '0 0 6px #3fb950' }} />
                  Running Tunnels ({activeTunnels.length})
                </span>
                <span style={{ fontSize: '11px', color: '#8b949e' }}>
                  Active background port forwarders
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {activeTunnels.map((tun) => (
                  <div
                    key={tun.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 10px',
                      backgroundColor: '#161b22',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: 700,
                          backgroundColor: tun.type === 'L' ? '#3fb95022' : tun.type === 'R' ? '#a371f722' : '#d2992222',
                          color: tun.type === 'L' ? '#3fb950' : tun.type === 'R' ? '#a371f7' : '#d29922',
                        }}
                      >
                        -{tun.type}
                      </span>
                      <span style={{ fontFamily: 'monospace' }}>
                        {tun.bindAddress}:{tun.bindPort} ➔ {tun.type === 'D' ? 'SOCKS5 Proxy' : `${tun.targetHost}:${tun.targetPort}`}
                      </span>
                      <span style={{ fontSize: '10px', color: '#8b949e' }}>
                        In: {formatBytes(tun.bytesIn)} | Out: {formatBytes(tun.bytesOut)} | {tun.activeConns} conns
                      </span>
                      {tun.errorMessage && (
                        <span style={{ fontSize: '10px', color: '#ff7b72' }}>
                          ⚠️ {tun.errorMessage}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void onStopTunnel(tun.id)}
                      style={{
                        padding: '2px 8px',
                        backgroundColor: '#da3633',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                      title="Stop this running tunnel"
                    >
                      ⏹ Stop
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rules List */}
          {rules.length === 0 ? (
            <div style={{ padding: '36px', textAlign: 'center', color: '#8b949e', backgroundColor: '#0d1117', borderRadius: '6px', border: '1px dashed #30363d' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚡</div>
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>No Port Forwarding Rules configured</p>
              <p style={{ margin: 0, fontSize: '12px' }}>
                Add Local (-L), Remote (-R), or Dynamic SOCKS5 (-D) rules to securely route traffic through your SSH connections.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {rules.map((rule) => {
                const activeTun = getTunnelForRule(rule);
                const isActive = !!activeTun;
                const typeColor =
                  rule.type === 'L' ? '#3fb950' : rule.type === 'R' ? '#a371f7' : '#d29922';
                const associatedHost = hosts.find((h) => h.id === rule.hostId);

                return (
                  <div
                    key={rule.id}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#0d1117',
                      border: `1px solid ${isActive ? typeColor : '#30363d'}`,
                      borderRadius: '6px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            backgroundColor: `${typeColor}22`,
                            color: typeColor,
                            borderRadius: '4px',
                            fontWeight: 700,
                            fontSize: '11px',
                          }}
                        >
                          {rule.type === 'L'
                            ? 'Local -L'
                            : rule.type === 'R'
                            ? 'Remote -R'
                            : 'Dynamic -D (SOCKS5)'}
                        </span>

                        <strong style={{ fontSize: '13px', color: '#e6edf3' }}>
                          {rule.label || `${rule.bindAddress}:${rule.bindPort}`}
                        </strong>

                        {associatedHost && (
                          <span style={{ fontSize: '11px', color: '#8b949e', backgroundColor: '#21262d', padding: '1px 6px', borderRadius: '3px' }}>
                            Host: {associatedHost.label}
                          </span>
                        )}

                        {rule.autoStart && (
                          <span style={{ fontSize: '10px', color: '#7ee787', border: '1px solid #238636', padding: '1px 5px', borderRadius: '3px' }}>
                            ⚡ Auto-start
                          </span>
                        )}
                      </div>

                      {/* Status indicator */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: isActive ? '#3fb950' : '#8b949e',
                            boxShadow: isActive ? '0 0 6px #3fb950' : 'none',
                          }}
                        />
                        <span style={{ fontSize: '11px', color: isActive ? '#3fb950' : '#8b949e', fontWeight: 600 }}>
                          {isActive ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </div>
                    </div>

                    {/* Mapping details & Metrics */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '12px',
                        color: '#c9d1d9',
                        backgroundColor: '#161b22',
                        padding: '6px 10px',
                        borderRadius: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'monospace' }}>
                        <span>{rule.bindAddress}:{rule.bindPort}</span>
                        <span style={{ color: '#8b949e' }}>➔</span>
                        <span>
                          {rule.type === 'D'
                            ? 'SOCKS5 Proxy via SSH'
                            : `${rule.targetHost}:${rule.targetPort}`}
                        </span>
                      </div>

                      {isActive && activeTun && (
                        <div style={{ display: 'flex', gap: '14px', fontSize: '11px', color: '#8b949e' }}>
                          <span>In: {formatBytes(activeTun.bytesIn)}</span>
                          <span>Out: {formatBytes(activeTun.bytesOut)}</span>
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
                              <div style={{ display: 'flex', gap: '6px' }}>
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
                                  style={{
                                    padding: '3px 6px',
                                    backgroundColor: '#21262d',
                                    color: '#c9d1d9',
                                    border: '1px solid #30363d',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                  }}
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
                                  style={{
                                    padding: '3px 10px',
                                    backgroundColor: '#238636',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: startingRuleId === rule.id ? 'wait' : 'pointer',
                                    fontWeight: 600,
                                    fontSize: '11px',
                                  }}
                                >
                                  {startingRuleId === rule.id ? 'Starting...' : '▶ Start Tunnel'}
                                </button>
                              </div>
                            ) : associatedHost && onStartTunnelWithHost ? (
                              <button
                                type="button"
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
                                style={{
                                  padding: '3px 10px',
                                  backgroundColor: '#238636',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: startingRuleId === rule.id ? 'wait' : 'pointer',
                                  fontWeight: 600,
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                                title={`Connects to ${associatedHost.label} in background and starts the tunnel`}
                              >
                                {startingRuleId === rule.id
                                  ? '⏳ Connecting...'
                                  : `⚡ Connect ${associatedHost.label} & Start Tunnel`}
                              </button>
                            ) : hosts.length > 0 && onStartTunnelWithHost ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <select
                                  value={selectedHostForStart.get(rule.id) || hosts[0]?.id || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setSelectedHostForStart((prev) => new Map(prev.set(rule.id, val)));
                                  }}
                                  style={{
                                    padding: '3px 6px',
                                    backgroundColor: '#21262d',
                                    color: '#c9d1d9',
                                    border: '1px solid #30363d',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                  }}
                                >
                                  {hosts.map((h) => (
                                    <option key={h.id} value={h.id}>
                                      {h.label} ({h.address})
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
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
                                  style={{
                                    padding: '3px 10px',
                                    backgroundColor: '#238636',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: startingRuleId === rule.id ? 'wait' : 'pointer',
                                    fontWeight: 600,
                                    fontSize: '11px',
                                  }}
                                  title="Connect to selected host in background and start tunnel"
                                >
                                  {startingRuleId === rule.id
                                    ? '⏳ Connecting...'
                                    : '⚡ Connect & Start Tunnel'}
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#8b949e' }}>
                                Connect to an SSH session or add a host to start this tunnel.
                              </span>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onStopTunnel(activeTun.id)}
                            style={{
                              padding: '3px 10px',
                              backgroundColor: '#da3633',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontWeight: 600,
                              fontSize: '11px',
                            }}
                          >
                            ⏹ Stop Tunnel
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => startEditRule(rule)}
                          style={{
                            padding: '2px 8px',
                            backgroundColor: '#21262d',
                            color: '#c9d1d9',
                            border: '1px solid #30363d',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '11px',
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteRule(rule.id)}
                          style={{
                            padding: '2px 8px',
                            backgroundColor: '#21262d',
                            color: '#f85149',
                            border: '1px solid #30363d',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '11px',
                          }}
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
