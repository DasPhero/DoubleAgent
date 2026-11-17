import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  NetworkRoute,
  PivotBinaryStatus,
  PivotCommandSet,
  PivotInstanceInfo,
  PivotTool,
  TwoStepSshPivotRequest,
} from '../types/pivot';
import { NetworkInterfaceIP } from '../types/fileTransfer';
import { CyberIcon } from './CyberIcon';

export interface PivotRelayHostOption {
  id: string;
  label: string;
  address: string;
  username?: string;
  port?: number;
}

export interface PivotManagerModalProps {
  isOpen?: boolean;
  onClose: () => void;
  activeSessionId?: string | null;
  activeEngagementId?: string | null;
  activeEngagementName?: string | null;
  hosts?: PivotRelayHostOption[];
  onSendToTerminal?: (sessionId: string, text: string) => void;
  onSpawnLocalTerminal?: (initialCommand: string, title?: string) => void;
  onOpenRouteHealth?: () => void;
  onLaunchTwoStepSshPivot?: (req: TwoStepSshPivotRequest) => Promise<void>;
  // Wails Bindings
  getDefaultRoutes: () => Promise<NetworkRoute[]>;
  listRoutes: () => Promise<NetworkRoute[]>;
  saveRoute: (route: NetworkRoute) => Promise<void>;
  deleteRoute: (routeId: string) => Promise<void>;
  detectBinaries: () => Promise<PivotBinaryStatus[]>;
  startPivot: (route: NetworkRoute) => Promise<PivotInstanceInfo>;
  stopPivot: (instanceId: string) => Promise<void>;
  sendPivotInput: (instanceId: string, input: string) => Promise<void>;
  listActivePivots: () => Promise<PivotInstanceInfo[]>;
  buildCommands: (route: NetworkRoute, lhost: string) => Promise<PivotCommandSet>;
  getLocalIPs: () => Promise<NetworkInterfaceIP[]>;
  onSelectBinaryFile?: (title: string) => Promise<string>;
}

function parseSubnetsInput(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s, idx, arr) => Boolean(s) && arr.indexOf(s) === idx);
}

export const PivotManagerModal: React.FC<PivotManagerModalProps> = ({
  isOpen = true,
  onClose,
  activeSessionId,
  activeEngagementId,
  activeEngagementName,
  hosts = [],
  onSendToTerminal,
  onSpawnLocalTerminal,
  onOpenRouteHealth,
  onLaunchTwoStepSshPivot,
  getDefaultRoutes,
  listRoutes,
  saveRoute,
  deleteRoute,
  detectBinaries,
  startPivot,
  stopPivot,
  sendPivotInput,
  listActivePivots,
  buildCommands,
  getLocalIPs,
  onSelectBinaryFile,
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'launch' | 'routes'>('launch');

  // Backend data
  const [savedRoutes, setSavedRoutes] = useState<NetworkRoute[]>([]);
  const [presetRoutes, setPresetRoutes] = useState<NetworkRoute[]>([]);
  const [activePivots, setActivePivots] = useState<PivotInstanceInfo[]>([]);
  const [binaries, setBinaries] = useState<PivotBinaryStatus[]>([]);
  const [localIPs, setLocalIPs] = useState<NetworkInterfaceIP[]>([]);

  // Form state
  const [editingRouteId, setEditingRouteId] = useState<string>('');
  const [name, setName] = useState<string>('Internal AD Ligolo Pivot');
  const [tool, setTool] = useState<PivotTool>('ligolo-ng');
  const [bindAddress, setBindAddress] = useState<string>('0.0.0.0');
  const [listenPort, setListenPort] = useState<number>(11601);
  const [socksPort, setSocksPort] = useState<number>(1080);
  const [interfaceName, setInterfaceName] = useState<string>('ligolo');
  const [subnetsInput, setSubnetsInput] = useState<string>('10.10.20.0/24');
  const [remoteSpecsInput, setRemoteSpecsInput] = useState<string>('R:socks');
  const [reverseMode, setReverseMode] = useState<boolean>(true);
  const [selfCert, setSelfCert] = useState<boolean>(true);
  const [ignoreCert, setIgnoreCert] = useState<boolean>(true);
  const [binaryPath, setBinaryPath] = useState<string>('');
  const [extraArgs, setExtraArgs] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [scopeMode, setScopeMode] = useState<'engagement' | 'global'>(
    activeEngagementId ? 'engagement' : 'global'
  );
  const [lhost, setLhost] = useState<string>('10.10.14.1');
  const [sshTarget, setSshTarget] = useState<string>('user@10.10.20.5');
  const [relayHostId, setRelayHostId] = useState<string>(hosts[0]?.id || '');
  const [forwardMode, setForwardMode] = useState<'local' | 'socks'>('local');
  const [forwardTarget, setForwardTarget] = useState<string>('10.10.20.10:3389');

  // Generated commands & console interaction
  const [commandSet, setCommandSet] = useState<PivotCommandSet | null>(null);
  const [consoleInputs, setConsoleInputs] = useState<Record<string, string>>({});
  const [routesFilter, setRoutesFilter] = useState<'all' | 'scoped' | 'global'>('all');

  // Status / Feedback
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [infoMessage, setInfoMessage] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const flashInfo = (msg: string) => {
    setInfoMessage(msg);
    setTimeout(() => {
      setInfoMessage((curr) => (curr === msg ? '' : curr));
    }, 3200);
  };

  const refreshAll = useCallback(async () => {
    try {
      const [defs, saved, actives, bins, ips] = await Promise.all([
        getDefaultRoutes().catch(() => []),
        listRoutes().catch(() => []),
        listActivePivots().catch(() => []),
        detectBinaries().catch(() => []),
        getLocalIPs().catch(() => []),
      ]);
      setPresetRoutes(defs || []);
      setSavedRoutes(saved || []);
      setActivePivots(actives || []);
      setBinaries(bins || []);
      setLocalIPs(ips || []);
      if (ips && ips.length > 0) {
        const vpn = ips.find((i) => i.isVpn) || ips[0];
        setLhost((curr) => (curr === '10.10.14.1' ? vpn.ip : curr));
      }
      if ((actives || []).some((p) => p.status === 'running' || p.status === 'error')) {
        setActiveTab((prev) => (prev === 'launch' ? 'active' : prev));
      }
    } catch {
      // Ignore transient load error
    }
  }, [getDefaultRoutes, listRoutes, listActivePivots, detectBinaries, getLocalIPs]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshAll();
    const timer = setInterval(() => {
      void listActivePivots()
        .then((list) => setActivePivots(list || []))
        .catch(() => { });
    }, 2000);
    return () => clearInterval(timer);
  }, [isOpen, refreshAll, listActivePivots]);

  const currentDraftRoute: NetworkRoute = useMemo(
    () => ({
      id: editingRouteId || '',
      engagementId: scopeMode === 'engagement' && activeEngagementId ? activeEngagementId : '',
      name: name.trim() || `${tool} pivot`,
      kind: tool === 'ligolo-ng' ? 'ligolo' : tool,
      tool,
      bindAddress: bindAddress.trim() || (tool === 'ssh-forward' ? '127.0.0.1' : '0.0.0.0'),
      listenPort: tool === 'sshuttle' ? 0 : Number(listenPort) || (tool === 'chisel' ? 8443 : tool === 'ssh-forward' ? 13389 : 11601),
      socksPort: Number(socksPort) || 1080,
      interfaceName: interfaceName.trim() || 'ligolo',
      subnets: parseSubnetsInput(subnetsInput),
      remoteSpecs: parseSubnetsInput(remoteSpecsInput),
      reverse: reverseMode,
      selfCert,
      ignoreCert,
      binaryPath: binaryPath.trim() || undefined,
      extraArgs: extraArgs.trim() || undefined,
      sshTarget: sshTarget.trim() || undefined,
      relayHostId: relayHostId || undefined,
      forwardMode,
      forwardTarget: forwardTarget.trim() || undefined,
      notes: notes.trim() || undefined,
    }),
    [
      editingRouteId,
      scopeMode,
      activeEngagementId,
      name,
      tool,
      bindAddress,
      listenPort,
      socksPort,
      interfaceName,
      subnetsInput,
      remoteSpecsInput,
      reverseMode,
      selfCert,
      ignoreCert,
      binaryPath,
      extraArgs,
      sshTarget,
      relayHostId,
      forwardMode,
      forwardTarget,
      notes,
    ]
  );

  // Live command preview generation
  useEffect(() => {
    let mounted = true;
    void buildCommands(currentDraftRoute, lhost.trim() || '10.10.14.1')
      .then((res) => {
        if (mounted) setCommandSet(res);
      })
      .catch(() => { });
    return () => {
      mounted = false;
    };
  }, [currentDraftRoute, lhost, buildCommands]);

  const runningCount = useMemo(
    () => activePivots.filter((p) => p.status === 'running').length,
    [activePivots]
  );

  const selectedBinaryStatus = useMemo(
    () => binaries.find((b) => b.tool === tool),
    [binaries, tool]
  );

  const filteredSavedRoutes = useMemo(() => {
    return savedRoutes.filter((r) => {
      if (routesFilter === 'global') return !r.engagementId;
      if (routesFilter === 'scoped') return Boolean(r.engagementId) && (!activeEngagementId || r.engagementId === activeEngagementId);
      return !r.engagementId || !activeEngagementId || r.engagementId === activeEngagementId;
    });
  }, [savedRoutes, routesFilter, activeEngagementId]);

  const handleSelectTool = (nextTool: PivotTool) => {
    setTool(nextTool);
    if (nextTool === 'chisel') {
      if (listenPort === 11601 || listenPort === 13389 || listenPort === 0) setListenPort(8443);
      if (bindAddress === '127.0.0.1') setBindAddress('0.0.0.0');
      if (name === 'Internal AD Ligolo Pivot') setName('Chisel Reverse SOCKS5 Pivot');
    } else if (nextTool === 'ligolo-ng') {
      if (listenPort === 8443 || listenPort === 8000 || listenPort === 13389 || listenPort === 0) setListenPort(11601);
      if (bindAddress === '127.0.0.1') setBindAddress('0.0.0.0');
      if (name === 'Chisel Reverse SOCKS5 Pivot') setName('Internal AD Ligolo Pivot');
    } else if (nextTool === 'sshuttle') {
      setListenPort(0);
      if (!sshTarget && hosts.length > 0) {
        const h = hosts[0];
        setSshTarget(`${h.username || 'user'}@${h.address}`);
      }
    } else if (nextTool === 'ssh-forward') {
      setBindAddress('127.0.0.1');
      if (listenPort === 11601 || listenPort === 8443 || listenPort === 0) setListenPort(13389);
      if (!relayHostId && hosts.length > 0) {
        setRelayHostId(hosts[0].id);
        setSshTarget(`${hosts[0].username || 'user'}@${hosts[0].address}`);
      }
    }
  };

  const loadRouteIntoForm = (r: NetworkRoute, isPreset: boolean) => {
    const normalizedTool: PivotTool =
      r.tool === 'chisel' || r.tool === 'sshuttle' || r.tool === 'ssh-forward'
        ? (r.tool as PivotTool)
        : 'ligolo-ng';
    setEditingRouteId(isPreset ? '' : r.id);
    setName(r.name);
    setTool(normalizedTool);
    setBindAddress(r.bindAddress || (normalizedTool === 'ssh-forward' ? '127.0.0.1' : '0.0.0.0'));
    setListenPort(
      normalizedTool === 'sshuttle'
        ? 0
        : r.listenPort || (normalizedTool === 'chisel' ? 8443 : normalizedTool === 'ssh-forward' ? 13389 : 11601)
    );
    setSocksPort(r.socksPort || 1080);
    setInterfaceName(r.interfaceName || 'ligolo');
    setSubnetsInput((r.subnets || []).join(', '));
    setRemoteSpecsInput((r.remoteSpecs || ['R:socks']).join(' '));
    setReverseMode(Boolean(r.reverse));
    setSelfCert(Boolean(r.selfCert));
    setIgnoreCert(Boolean(r.ignoreCert));
    setBinaryPath(r.binaryPath || '');
    setExtraArgs(r.extraArgs || '');
    if (r.sshTarget) setSshTarget(r.sshTarget);
    if (r.relayHostId) setRelayHostId(r.relayHostId);
    if (r.forwardMode) setForwardMode(r.forwardMode);
    if (r.forwardTarget) setForwardTarget(r.forwardTarget);
    setNotes(r.notes || '');
    setScopeMode(r.engagementId ? 'engagement' : 'global');
    setActiveTab('launch');
    flashInfo(`Loaded "${r.name}" into pivot configurator.`);
  };

  const handleLaunchRoute = async (routeToRun: NetworkRoute) => {
    setIsStarting(true);
    setError('');
    try {
      if (routeToRun.tool === 'ssh-forward') {
        if (!onLaunchTwoStepSshPivot) {
          throw new Error('Two-step native SSH forward launcher is unavailable.');
        }
        const effectiveRelayId = relayHostId || routeToRun.relayHostId || hosts[0]?.id || '';
        const mode = forwardMode;
        const [tHost, tPortRaw] = (routeToRun.forwardTarget || forwardTarget).split(':');
        await onLaunchTwoStepSshPivot({
          relayHostId: effectiveRelayId,
          engagementId: scopeMode === 'engagement' && activeEngagementId ? activeEngagementId : '',
          mode,
          bindAddress: routeToRun.bindAddress || '127.0.0.1',
          localPort: Number(routeToRun.listenPort) || (mode === 'socks' ? 1080 : 13389),
          targetHost: mode === 'socks' ? '' : (tHost || '').trim(),
          targetPort: mode === 'socks' ? 0 : Number(tPortRaw) || 0,
          name: routeToRun.name,
          saveRule: true,
        });
        flashInfo(`Two-step native SSH ${mode === 'socks' ? 'SOCKS5' : '-L'} tunnel started via relay host.`);
        return;
      }

      const info = await startPivot(routeToRun);
      const list = await listActivePivots().catch(() => []);
      setActivePivots(list || [info]);
      setActiveTab('active');
      flashInfo(`Started ${info.tool} pivot "${info.name}"${info.listenPort ? ` on port ${info.listenPort}` : ''} (PID ${info.pid}).`);
    } catch (err: unknown) {
      const list = await listActivePivots().catch(() => []);
      setActivePivots(list || []);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStarting(false);
    }
  };

  const handleSaveRoute = async () => {
    setError('');
    try {
      const id = editingRouteId || `route-${Date.now()}`;
      await saveRoute({
        ...currentDraftRoute,
        id,
        status: 'configured',
      });
      setEditingRouteId(id);
      const saved = await listRoutes();
      setSavedRoutes(saved || []);
      flashInfo(`Saved pivot profile "${currentDraftRoute.name}" to encrypted vault.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSavedRoute = async (routeId: string) => {
    try {
      await deleteRoute(routeId);
      setSavedRoutes((prev) => prev.filter((r) => r.id !== routeId));
      if (editingRouteId === routeId) setEditingRouteId('');
      flashInfo('Removed saved pivot route from vault.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStopPivot = async (instanceId: string) => {
    try {
      await stopPivot(instanceId);
      const list = await listActivePivots().catch(() => []);
      setActivePivots(list || []);
      flashInfo('Pivot instance stopped / dismissed.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSendConsoleInput = async (instanceId: string) => {
    const raw = (consoleInputs[instanceId] || '').trim();
    if (!raw) return;
    try {
      await sendPivotInput(instanceId, raw);
      setConsoleInputs((prev) => ({ ...prev, [instanceId]: '' }));
      const list = await listActivePivots().catch(() => []);
      setActivePivots(list || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBrowseBinary = async () => {
    if (!onSelectBinaryFile) return;
    try {
      const selected = await onSelectBinaryFile(`Select ${tool} Executable`);
      if (selected && selected.trim()) {
        setBinaryPath(selected.trim());
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopy = (key: string, text: string) => {
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1800);
  };

  const handleInjectTargetCmd = (cmd: string, execute: boolean) => {
    if (!cmd) return;
    if (activeSessionId && onSendToTerminal) {
      onSendToTerminal(activeSessionId, execute ? `${cmd}\n` : cmd);
      flashInfo(execute ? 'Executed command in active terminal.' : 'Inserted command into active terminal.');
      return;
    }
    handleCopy('fallback', cmd);
    flashInfo('No active terminal tab — command copied to clipboard.');
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop cyber-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cyber-totp-container is-modal-view"
        style={{ width: '98%', maxWidth: '1240px', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Network Pivoting Manager"
      >
        {/* Corner Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* HUD Header */}
        <div className="cyber-totp-hud-header">
          <div className="cyber-hud-title-block">
            <div className="cyber-hud-tag-line">
              <span className="cyber-hazard-stripes">///</span>
              <span className="cyber-hud-tag">OPS-PIVOT</span>
              <span className="cyber-hud-delim">//</span>
              <span className="cyber-hud-subtag">LIGOLO-NG TUN &amp; CHISEL RELAY ORCHESTRATOR</span>
            </div>
            <h2 className="cyber-hud-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <CyberIcon name="tunnel" size={20} />
              <span>NETWORK PIVOTING &amp; TUNNEL MANAGER</span>
            </h2>
            <div className="cyber-telemetry-strip">
              <span className={`cyber-telemetry-chip ${runningCount > 0 ? 'chip-green' : 'chip-cyan'}`}>
                <span className="chip-dot" /> ACTIVE PIVOTS: <strong>{runningCount}</strong>
              </span>
              {binaries.map((b) => (
                <span
                  key={b.tool}
                  className={`cyber-telemetry-chip ${b.found ? 'chip-green' : 'chip-amber'}`}
                  title={b.path || `${b.binaryName} not found on PATH`}
                >
                  <span className="chip-dot" /> {b.tool.toUpperCase()}:{' '}
                  <strong>{b.found ? 'READY' : 'PATH MISSING'}</strong>
                </span>
              ))}
              <span className="cyber-telemetry-chip chip-cyan">
                <span className="chip-dot" /> SAVED ROUTES: <strong>{savedRoutes.length}</strong>
              </span>
            </div>
          </div>

          <div className="cyber-hud-actions-block">
            {onOpenRouteHealth && (
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                onClick={() => {
                  onClose();
                  onOpenRouteHealth();
                }}
                title="Run OPSEC Route Health Check"
              >
                <CyberIcon name="shield" size={13} />
                <span>Health Check</span>
              </button>
            )}
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => void refreshAll()}
              title="Refresh active pivot status and binary detection"
            >
              <CyberIcon name="radar" size={13} />
              <span>REFRESH</span>
            </button>
            <button
              type="button"
              className="cyber-btn-close"
              onClick={onClose}
              aria-label="Close Pivot Manager"
              title="Close Pivot Manager"
            >
              <CyberIcon name="close" size={14} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            padding: '0.65rem 1.25rem 0 1.25rem',
            borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
          }}
        >
          <button
            type="button"
            className={`cyber-pill-btn ${activeTab === 'launch' ? 'active' : ''}`}
            onClick={() => setActiveTab('launch')}
          >
            <CyberIcon name="bolt" size={12} /> Configure &amp; Launch
          </button>
          <button
            type="button"
            className={`cyber-pill-btn ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => setActiveTab('active')}
          >
            <CyberIcon name="radar" size={12} /> Active Pivots &amp; Console ({activePivots.length})
          </button>
          <button
            type="button"
            className={`cyber-pill-btn ${activeTab === 'routes' ? 'active' : ''}`}
            onClick={() => setActiveTab('routes')}
          >
            <CyberIcon name="network" size={12} /> Saved Routes &amp; Presets ({savedRoutes.length + presetRoutes.length})
          </button>
        </div>

        {/* Status Banners */}
        {error && (
          <div className="cyber-banner cyber-banner-error" role="alert">
            <span className="banner-icon">
              <CyberIcon name="warning" size={14} />
            </span>
            <span className="banner-text">{error}</span>
            <button type="button" onClick={() => setError('')} className="banner-close-btn">
              <CyberIcon name="close" size={12} />
            </button>
          </div>
        )}
        {infoMessage && (
          <div className="cyber-banner cyber-banner-success" role="status">
            <span className="banner-icon">
              <CyberIcon name="check" size={14} />
            </span>
            <span className="banner-text">{infoMessage}</span>
          </div>
        )}

        {/* Modal Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem 1.25rem' }}>
          {/* TAB 1: CONFIGURE & LAUNCH */}
          {activeTab === 'launch' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(360px, 1fr) minmax(420px, 1.25fr)',
                gap: '1rem',
              }}
            >
              {/* Left Column: Config Form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div
                  style={{
                    background: 'rgba(6, 13, 26, 0.85)',
                    border: '1px solid color-mix(in srgb, var(--accent-bright) 28%, transparent)',
                    borderRadius: '4px',
                    padding: '0.9rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.08em' }}>
                      /// 1. PIVOT RELAY CONFIGURATION
                    </span>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${tool === 'ligolo-ng' ? 'active' : ''}`}
                        onClick={() => handleSelectTool('ligolo-ng')}
                      >
                        ligolo-ng
                      </button>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${tool === 'chisel' ? 'active' : ''}`}
                        onClick={() => handleSelectTool('chisel')}
                      >
                        chisel
                      </button>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${tool === 'sshuttle' ? 'active' : ''}`}
                        onClick={() => handleSelectTool('sshuttle')}
                        title="Transparent CIDR routing via SSH (zero executable uploaded to target)"
                      >
                        sshuttle
                      </button>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${tool === 'ssh-forward' ? 'active' : ''}`}
                        onClick={() => handleSelectTool('ssh-forward')}
                        title="Native Go Two-Step SSH Forward (-L / -D) through reachable SSH host"
                      >
                        2-step ssh
                      </button>
                    </div>
                  </div>

                  {/* Scope & Profile Name */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                        Route Profile Name
                      </label>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Corp DMZ Pivot"
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                        Vault Scope
                      </label>
                      <select
                        className="cyber-hud-select"
                        value={scopeMode}
                        onChange={(e) => setScopeMode(e.target.value as 'engagement' | 'global')}
                        aria-label="Pivot Route Scope"
                      >
                        {activeEngagementId && (
                          <option value="engagement">
                            Engagement: {activeEngagementName || activeEngagementId}
                          </option>
                        )}
                        <option value="global">Global (Reusable)</option>
                      </select>
                    </div>
                  </div>

                  {tool === 'sshuttle' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {hosts.length > 0 && (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                            Quick-Pick Reachable SSH Jump Host
                          </label>
                          <select
                            className="cyber-hud-select"
                            value=""
                            onChange={(e) => {
                              const picked = hosts.find((h) => h.id === e.target.value);
                              if (picked) {
                                setSshTarget(`${picked.username || 'user'}@${picked.address}`);
                              }
                            }}
                          >
                            <option value="">-- Select Vault Host --</option>
                            {hosts.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.label} ({h.username || 'user'}@{h.address})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                          SSH Jump Target (-r user@host[:port])
                        </label>
                        <input
                          type="text"
                          className="cyber-hud-input"
                          value={sshTarget}
                          onChange={(e) => setSshTarget(e.target.value)}
                          placeholder="kali@10.10.20.5"
                        />
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#6ee7b7', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '0.45rem 0.6rem', borderRadius: 4 }}>
                        No remote agent binary required on target (requires Python 3 on SSH jump host; on Windows run via WSL or use 2-Step SSH below).
                      </div>
                    </div>
                  )}

                  {tool === 'ssh-forward' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                          Step 1: Reachable SSH Relay Host (auto-connects if offline)
                        </label>
                        <select
                          className="cyber-hud-select"
                          aria-label="Step 1 Reachable SSH Relay Host"
                          value={relayHostId}
                          onChange={(e) => {
                            setRelayHostId(e.target.value);
                            const picked = hosts.find((h) => h.id === e.target.value);
                            if (picked) {
                              setSshTarget(`${picked.username || 'user'}@${picked.address}`);
                            }
                          }}
                        >
                          <option value="">-- Select Reachable SSH Host from Vault --</option>
                          {hosts.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.label} ({h.username || 'user'}@{h.address}:{h.port || 22})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr', gap: '0.5rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                            Step 2: Forward Mode
                          </label>
                          <select
                            className="cyber-hud-select"
                            value={forwardMode}
                            onChange={(e) => setForwardMode(e.target.value as 'local' | 'socks')}
                          >
                            <option value="local">Direct Port (-L)</option>
                            <option value="socks">Dynamic SOCKS5 (-D)</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                            Local Port
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            className="cyber-hud-input"
                            value={listenPort || (forwardMode === 'socks' ? 1080 : 13389)}
                            onChange={(e) => setListenPort(Number(e.target.value) || 0)}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                            {forwardMode === 'local' ? 'Internal Target (host:port)' : 'Bind IP'}
                          </label>
                          {forwardMode === 'local' ? (
                            <input
                              type="text"
                              className="cyber-hud-input"
                              value={forwardTarget}
                              onChange={(e) => setForwardTarget(e.target.value)}
                              placeholder="10.10.20.10:3389"
                            />
                          ) : (
                            <input
                              type="text"
                              className="cyber-hud-input"
                              value={bindAddress}
                              onChange={(e) => setBindAddress(e.target.value)}
                              placeholder="127.0.0.1"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bind Address & Port (Ligolo / Chisel) */}
                  {(tool === 'ligolo-ng' || tool === 'chisel') && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px', gap: '0.5rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                          Bind IP Address
                        </label>
                        <input
                          type="text"
                          className="cyber-hud-input"
                          value={bindAddress}
                          onChange={(e) => setBindAddress(e.target.value)}
                          placeholder="0.0.0.0"
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                          Listen Port
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          className="cyber-hud-input"
                          value={listenPort}
                          onChange={(e) => setListenPort(Number(e.target.value) || 0)}
                        />
                      </div>
                      {tool === 'ligolo-ng' ? (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                            TUN Interface
                          </label>
                          <input
                            type="text"
                            className="cyber-hud-input"
                            value={interfaceName}
                            onChange={(e) => setInterfaceName(e.target.value)}
                            placeholder="ligolo"
                          />
                        </div>
                      ) : (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                            SOCKS5 Port
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            className="cyber-hud-input"
                            value={socksPort}
                            onChange={(e) => setSocksPort(Number(e.target.value) || 1080)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Target Subnets CIDR & Chisel Specs */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                      Target Internal Subnets (CIDR, comma-separated)
                    </label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      value={subnetsInput}
                      onChange={(e) => setSubnetsInput(e.target.value)}
                      placeholder="10.10.20.0/24, 172.16.5.0/24"
                    />
                  </div>

                  {tool === 'chisel' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                        Chisel Client Remote Specs (space-separated)
                      </label>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        value={remoteSpecsInput}
                        onChange={(e) => setRemoteSpecsInput(e.target.value)}
                        placeholder="R:socks or R:1445:10.10.20.10:445"
                      />
                    </div>
                  )}

                  {/* Binary Path Override */}
                  <div>
                    <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                      <span>Local Proxy Binary Path (optional override)</span>
                      <span style={{ color: selectedBinaryStatus?.found ? '#10b981' : '#f59e0b' }}>
                        {selectedBinaryStatus?.found
                          ? `Detected: ${selectedBinaryStatus.binaryName}`
                          : `${tool} not found on PATH`}
                      </span>
                    </label>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        value={binaryPath}
                        onChange={(e) => setBinaryPath(e.target.value)}
                        placeholder={selectedBinaryStatus?.path || `Auto-detect ${tool} on PATH`}
                        style={{ flex: 1 }}
                      />
                      {onSelectBinaryFile && (
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary"
                          onClick={() => void handleBrowseBinary()}
                        >
                          <CyberIcon name="folder" size={12} /> Browse
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Tool Flags & Extra Args */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', fontSize: '0.76rem', color: '#cbd5e1' }}>
                    {tool === 'ligolo-ng' ? (
                      <>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={selfCert}
                            onChange={(e) => setSelfCert(e.target.checked)}
                          />
                          <span>Proxy -selfcert</span>
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={ignoreCert}
                            onChange={(e) => setIgnoreCert(e.target.checked)}
                          />
                          <span>Agent -ignore-cert</span>
                        </label>
                      </>
                    ) : (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={reverseMode}
                          onChange={(e) => setReverseMode(e.target.checked)}
                        />
                        <span>Server --reverse</span>
                      </label>
                    )}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                      Extra CLI Flags (optional)
                    </label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      value={extraArgs}
                      onChange={(e) => setExtraArgs(e.target.value)}
                      placeholder={tool === 'ligolo-ng' ? '-v' : '--auth user:pass'}
                    />
                  </div>

                  {/* OPSEC Warnings */}
                  {commandSet?.opsecWarnings && commandSet.opsecWarnings.length > 0 && (
                    <div
                      style={{
                        background: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.45)',
                        borderRadius: '4px',
                        padding: '0.55rem 0.7rem',
                        fontSize: '0.72rem',
                        color: '#fcd34d',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                      }}
                    >
                      {commandSet.opsecWarnings.map((w, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                          <CyberIcon name="warning" size={13} />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Launch & Save Buttons */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-primary"
                      disabled={isStarting}
                      onClick={() => void handleLaunchRoute(currentDraftRoute)}
                    >
                      <CyberIcon name="play" size={13} />
                      <span>{isStarting ? 'Starting...' : 'Launch Pivot'}</span>
                    </button>
                    {onSpawnLocalTerminal && commandSet?.proxyCommand && (
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-secondary"
                        onClick={() => {
                          onSpawnLocalTerminal(commandSet.proxyCommand, `${tool}:${listenPort}`);
                          flashInfo('Launched pivot CLI in new Local Terminal tab.');
                        }}
                        title="Open interactive local terminal tab with proxy command"
                      >
                        <CyberIcon name="terminal" size={13} />
                        <span>Open in Local Term</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary"
                      onClick={() => void handleSaveRoute()}
                    >
                      <CyberIcon name="save" size={13} />
                      <span>{editingRouteId ? 'Update Route' : 'Save to Vault'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Target Callback IP + Setup / Agent / Route Commands */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div
                  style={{
                    background: 'rgba(6, 13, 26, 0.85)',
                    border: '1px solid color-mix(in srgb, var(--accent-bright) 28%, transparent)',
                    borderRadius: '4px',
                    padding: '0.9rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.08em' }}>
                      /// 2. OPERATOR &amp; TARGET COMMAND DECK
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>CALLBACK LHOST: {lhost}</span>
                  </div>

                  {/* LHOST IP Chips */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                      Operator Callback LHOST (for target agent commands)
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.4rem' }}>
                      {localIPs.map((item) => (
                        <button
                          key={`${item.interface}-${item.ip}`}
                          type="button"
                          className={`cyber-pill-btn ${lhost === item.ip ? 'active' : ''}`}
                          onClick={() => setLhost(item.ip)}
                        >
                          {item.isVpn ? `VPN (${item.interface})` : item.interface}: {item.ip}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      value={lhost}
                      onChange={(e) => setLhost(e.target.value)}
                      placeholder="10.10.14.x"
                    />
                  </div>

                  {/* Target Linux Agent */}
                  {commandSet && (
                    <>
                      <CommandSnippetBox
                        title="Target Agent One-Liner (Linux)"
                        badge="LINUX TARGET"
                        command={commandSet.linuxAgentCmd}
                        copied={copiedKey === 'linux-agent'}
                        onCopy={() => handleCopy('linux-agent', commandSet.linuxAgentCmd)}
                        onInsert={() => handleInjectTargetCmd(commandSet.linuxAgentCmd, false)}
                        onRun={() => handleInjectTargetCmd(commandSet.linuxAgentCmd, true)}
                      />

                      <CommandSnippetBox
                        title="Target Agent One-Liner (Windows)"
                        badge="WINDOWS TARGET"
                        command={commandSet.windowsAgentCmd}
                        copied={copiedKey === 'win-agent'}
                        onCopy={() => handleCopy('win-agent', commandSet.windowsAgentCmd)}
                        onInsert={() => handleInjectTargetCmd(commandSet.windowsAgentCmd, false)}
                        onRun={() => handleInjectTargetCmd(commandSet.windowsAgentCmd, true)}
                      />

                      {/* Setup & Routing Commands */}
                      {commandSet.setupCommands && commandSet.setupCommands.length > 0 && (() => {
                        const setupText = commandSet.setupCommands.join('\n');
                        return (
                          <CommandSnippetBox
                            title="Operator Host Setup (Proxy / TUN Interface)"
                            badge="OPERATOR HOST"
                            command={setupText}
                            copied={copiedKey === 'setup-cmds'}
                            onCopy={() => handleCopy('setup-cmds', setupText)}
                          />
                        );
                      })()}

                      {commandSet.routeCommands && commandSet.routeCommands.length > 0 && (() => {
                        const routeText = commandSet.routeCommands.join('\n');
                        return (
                          <CommandSnippetBox
                            title={tool === 'ligolo-ng' ? 'Operator Subnet Route Commands' : 'Operator Recon via Proxychains'}
                            badge="ROUTES"
                            command={routeText}
                            copied={copiedKey === 'route-cmds'}
                            onCopy={() => handleCopy('route-cmds', routeText)}
                          />
                        );
                      })()}

                      {commandSet.proxychainsLine && (() => {
                        const pcLine = commandSet.proxychainsLine;
                        return (
                          <CommandSnippetBox
                            title="proxychains4.conf Entry"
                            badge="SOCKS5"
                            command={pcLine}
                            copied={copiedKey === 'pc-line'}
                            onCopy={() => handleCopy('pc-line', pcLine)}
                          />
                        );
                      })()}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ACTIVE PIVOTS & LIVE CONSOLE */}
          {activeTab === 'active' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {activePivots.length === 0 ? (
                <div
                  style={{
                    padding: '2.5rem 1rem',
                    textAlign: 'center',
                    border: '1px dashed color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                    borderRadius: '4px',
                    color: '#94a3b8',
                  }}
                >
                  <CyberIcon name="tunnel" size={28} />
                  <p style={{ marginTop: '0.6rem', fontSize: '0.85rem' }}>
                    No active or recent pivot processes. Configure a ligolo-ng or chisel relay to launch.
                  </p>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-primary"
                    style={{ marginTop: '0.6rem' }}
                    onClick={() => setActiveTab('launch')}
                  >
                    <CyberIcon name="plus" size={13} /> Configure New Pivot
                  </button>
                </div>
              ) : (
                activePivots.map((inst) => (
                  <div
                    key={inst.id}
                    style={{
                      background: 'rgba(6, 13, 26, 0.9)',
                      border: `1px solid ${inst.status === 'running'
                        ? 'rgba(16, 185, 129, 0.5)'
                        : inst.status === 'error'
                          ? 'rgba(239, 68, 68, 0.55)'
                          : 'rgba(148, 163, 184, 0.35)'
                        }`,
                      borderRadius: '4px',
                      padding: '0.9rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '3px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            background:
                              inst.status === 'running'
                                ? 'rgba(16, 185, 129, 0.2)'
                                : inst.status === 'error'
                                  ? 'rgba(239, 68, 68, 0.2)'
                                  : 'rgba(148, 163, 184, 0.2)',
                            color:
                              inst.status === 'running'
                                ? '#34d399'
                                : inst.status === 'error'
                                  ? '#f87171'
                                  : '#cbd5e1',
                          }}
                        >
                          {inst.status.toUpperCase()}
                        </span>
                        <strong style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>{inst.name}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--accent-bright)', fontFamily: 'monospace' }}>
                          {inst.tool} // {inst.bindAddress}:{inst.listenPort}
                        </span>
                        {inst.pid ? (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>PID {inst.pid}</span>
                        ) : null}
                      </div>

                      <div style={{ display: 'flex', gap: '0.45rem' }}>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary"
                          onClick={() => handleCopy(`cmd-${inst.id}`, inst.commandPreview)}
                        >
                          <CyberIcon name={copiedKey === `cmd-${inst.id}` ? 'check' : 'copy'} size={12} />
                          <span>Copy CLI</span>
                        </button>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-danger"
                          onClick={() => void handleStopPivot(inst.id)}
                        >
                          <CyberIcon name="stop" size={12} />
                          <span>{inst.status === 'running' ? 'Stop Pivot' : 'Dismiss'}</span>
                        </button>
                      </div>
                    </div>

                    {inst.errorMsg && (
                      <div
                        style={{
                          background: 'rgba(239, 68, 68, 0.14)',
                          border: '1px solid rgba(239, 68, 68, 0.45)',
                          padding: '0.45rem 0.65rem',
                          borderRadius: '3px',
                          fontSize: '0.75rem',
                          color: '#fca5a5',
                        }}
                      >
                        <strong>Error:</strong> {inst.errorMsg}
                      </div>
                    )}

                    {/* Connected Agents / Routes metadata */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', fontSize: '0.72rem' }}>
                      {inst.interfaceName && (
                        <span className="cyber-telemetry-chip chip-cyan">TUN: {inst.interfaceName}</span>
                      )}
                      {inst.socksPort ? (
                        <span className="cyber-telemetry-chip chip-cyan">SOCKS5: 127.0.0.1:{inst.socksPort}</span>
                      ) : null}
                      {(inst.subnets || []).map((sub) => (
                        <span key={sub} className="cyber-telemetry-chip chip-green">
                          ROUTE: {sub}
                        </span>
                      ))}
                      {(inst.connectedAgents || []).length > 0 && (
                        <span className="cyber-telemetry-chip chip-amber">
                          AGENTS: {inst.connectedAgents?.length}
                        </span>
                      )}
                    </div>

                    {/* Recent Stdout/Stderr Log Window */}
                    <pre
                      style={{
                        margin: 0,
                        background: '#030812',
                        border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
                        borderRadius: '3px',
                        padding: '0.6rem',
                        maxHeight: '180px',
                        overflowY: 'auto',
                        fontSize: '0.72rem',
                        color: '#cbd5e1',
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {(inst.recentLogs && inst.recentLogs.length > 0)
                        ? inst.recentLogs.join('\n')
                        : inst.commandPreview}
                    </pre>

                    {/* Interactive Stdin Bar when Running */}
                    {inst.status === 'running' && (
                      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="cyber-hud-input"
                          style={{ flex: 1 }}
                          placeholder="Send interactive console command (e.g. session, ifconfig, start --tun ligolo)..."
                          value={consoleInputs[inst.id] || ''}
                          onChange={(e) =>
                            setConsoleInputs((prev) => ({ ...prev, [inst.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleSendConsoleInput(inst.id);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-primary"
                          onClick={() => void handleSendConsoleInput(inst.id)}
                        >
                          <CyberIcon name="play" size={12} /> Send
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: SAVED ROUTES & TEMPLATES */}
          {activeTab === 'routes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.07em' }}>
                  /// VAULT SAVED NETWORK ROUTES
                </span>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <button
                    type="button"
                    className={`cyber-pill-btn ${routesFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setRoutesFilter('all')}
                  >
                    All Visible
                  </button>
                  <button
                    type="button"
                    className={`cyber-pill-btn ${routesFilter === 'scoped' ? 'active' : ''}`}
                    onClick={() => setRoutesFilter('scoped')}
                  >
                    Active Engagement
                  </button>
                  <button
                    type="button"
                    className={`cyber-pill-btn ${routesFilter === 'global' ? 'active' : ''}`}
                    onClick={() => setRoutesFilter('global')}
                  >
                    Global Only
                  </button>
                </div>
              </div>

              {filteredSavedRoutes.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', padding: '0.75rem', border: '1px dashed rgba(148,163,184,0.25)', borderRadius: '4px' }}>
                  No saved pivot routes match this filter yet. Configure a route and click &quot;Save to Vault&quot;.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0.75rem' }}>
                  {filteredSavedRoutes.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        background: 'rgba(6, 13, 26, 0.85)',
                        border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                        borderRadius: '4px',
                        padding: '0.8rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.45rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ color: '#e2e8f0', fontSize: '0.86rem' }}>{r.name}</strong>
                        <span style={{ fontSize: '0.66rem', color: r.engagementId ? '#fbbf24' : 'var(--accent-bright)', border: '1px solid currentColor', padding: '1px 6px', borderRadius: '3px' }}>
                          {r.engagementId ? 'ENGAGEMENT' : 'GLOBAL'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.73rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                        {r.tool} · {r.bindAddress || '0.0.0.0'}:{r.listenPort}
                        {r.subnets && r.subnets.length > 0 ? ` · ${r.subnets.join(', ')}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem' }}>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-primary"
                          onClick={() => void handleLaunchRoute(r)}
                        >
                          <CyberIcon name="play" size={12} /> Start
                        </button>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary"
                          onClick={() => loadRouteIntoForm(r, false)}
                        >
                          <CyberIcon name="edit" size={12} /> Edit
                        </button>
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-danger"
                          onClick={() => void handleDeleteSavedRoute(r.id)}
                          title="Delete saved route"
                        >
                          <CyberIcon name="trash" size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.07em', marginTop: '0.5rem' }}>
                /// BUILT-IN STARTER PRESETS
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0.75rem' }}>
                {presetRoutes.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      background: 'rgba(6, 13, 26, 0.7)',
                      border: '1px solid rgba(148, 163, 184, 0.25)',
                      borderRadius: '4px',
                      padding: '0.8rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.45rem',
                    }}
                  >
                    <strong style={{ color: '#e2e8f0', fontSize: '0.86rem' }}>{p.name}</strong>
                    <div style={{ fontSize: '0.73rem', color: 'var(--accent-bright)', fontFamily: 'monospace' }}>
                      {p.tool} · port {p.listenPort}
                      {p.socksPort ? ` · SOCKS5 :${p.socksPort}` : ''}
                    </div>
                    {p.notes && <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{p.notes}</div>}
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-secondary"
                        onClick={() => loadRouteIntoForm(p, true)}
                      >
                        <CyberIcon name="edit" size={12} /> Load Template
                      </button>
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-primary"
                        onClick={() => void handleLaunchRoute(p)}
                      >
                        <CyberIcon name="play" size={12} /> Quick Launch
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface CommandSnippetBoxProps {
  title: string;
  badge: string;
  command: string;
  copied: boolean;
  onCopy: () => void;
  onInsert?: () => void;
  onRun?: () => void;
}

const CommandSnippetBox: React.FC<CommandSnippetBoxProps> = ({
  title,
  badge,
  command,
  copied,
  onCopy,
  onInsert,
  onRun,
}) => (
  <div
    style={{
      background: 'rgba(3, 8, 18, 0.9)',
      border: '1px solid color-mix(in srgb, var(--accent-bright) 22%, transparent)',
      borderRadius: '4px',
      padding: '0.55rem 0.7rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.35rem',
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#e2e8f0' }}>{title}</span>
        <span style={{ fontSize: '0.64rem', color: 'var(--accent-bright)', border: '1px solid color-mix(in srgb, var(--accent-bright) 35%, transparent)', padding: '0 5px', borderRadius: '2px' }}>
          {badge}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '0.3rem' }}>
        <button type="button" className="cyber-btn cyber-btn-secondary" style={{ padding: '2px 7px', fontSize: '0.68rem' }} onClick={onCopy}>
          <CyberIcon name={copied ? 'check' : 'copy'} size={11} /> {copied ? 'Copied' : 'Copy'}
        </button>
        {onInsert && (
          <button type="button" className="cyber-btn cyber-btn-secondary" style={{ padding: '2px 7px', fontSize: '0.68rem' }} onClick={onInsert}>
            <CyberIcon name="terminal" size={11} /> Insert
          </button>
        )}
        {onRun && (
          <button type="button" className="cyber-btn cyber-btn-primary" style={{ padding: '2px 7px', fontSize: '0.68rem' }} onClick={onRun}>
            <CyberIcon name="play" size={11} /> Run
          </button>
        )}
      </div>
    </div>
    <pre
      style={{
        margin: 0,
        fontFamily: 'monospace',
        fontSize: '0.74rem',
        color: 'var(--accent-text)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {command}
    </pre>
  </div>
);
