import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ListenerProfile, ManagedListenerInfo, ListenerTool, ListenerKind } from '../types/listener';
import { CyberIcon } from './CyberIcon';

export interface ListenerManagerModalProps {
  isOpen?: boolean;
  onClose: () => void;
  // Wails Bindings
  listProfiles: () => Promise<ListenerProfile[]>;
  saveProfile: (prof: ListenerProfile) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  startListener: (prof: ListenerProfile) => Promise<ManagedListenerInfo>;
  stopListener: (id: string) => Promise<void>;
  listActiveListeners: () => Promise<ManagedListenerInfo[]>;
  generateCommand: (prof: ListenerProfile) => Promise<string>;
  onSpawnTerminal?: (command: string) => void;
  onOpenSessionTab?: (sessionId: string) => void;
  onStabilizeSession?: (sessionId: string) => void;
  onOpenPayloadGenerator?: (port: number, lhost: string) => void;
}

export const ListenerManagerModal: React.FC<ListenerManagerModalProps> = ({
  isOpen = true,
  onClose,
  listProfiles,
  saveProfile,
  deleteProfile,
  startListener,
  stopListener,
  listActiveListeners,
  generateCommand,
  onSpawnTerminal,
  onOpenSessionTab,
  onStabilizeSession,
  onOpenPayloadGenerator,
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'profiles' | 'launch'>('active');
  const [profiles, setProfiles] = useState<ListenerProfile[]>([]);
  const [activeListeners, setActiveListeners] = useState<ManagedListenerInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [infoMessage, setInfoMessage] = useState<string>('');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // New / Launch Listener form state
  const [formName, setFormName] = useState<string>('HTTPS Stealth Reverse Catcher');
  const [formTool, setFormTool] = useState<ListenerTool>('builtin');
  const [formKind, setFormKind] = useState<ListenerKind>('reverse');
  const [formPort, setFormPort] = useState<number>(443);
  const [formBindAddr, setFormBindAddr] = useState<string>('0.0.0.0');
  const [formAutoSpawn, setFormAutoSpawn] = useState<boolean>(true);
  const [formNotes, setFormNotes] = useState<string>('');
  const [isStarting, setIsStarting] = useState<boolean>(false);

  // Refresh active listeners and profiles from Go backend
  const refreshData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [profs, actives] = await Promise.all([listProfiles(), listActiveListeners()]);
      setProfiles(profs || []);
      setActiveListeners(actives || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [listProfiles, listActiveListeners]);

  useEffect(() => {
    if (isOpen) {
      void refreshData();
      // Set interval to poll active listener metrics while modal is open
      const interval = setInterval(() => {
        void listActiveListeners()
          .then((actives) => setActiveListeners(actives || []))
          .catch(() => {});
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [isOpen, refreshData, listActiveListeners]);

  // Live OPSEC analysis for form parameters
  const formOpsecWarnings = useMemo(() => {
    const warns: string[] = [];
    if (formPort === 4444 || formPort === 1337 || formPort === 31337 || formPort === 6667) {
      warns.push(
        `Port ${formPort} is a heavily monitored Metasploit/CTF default; consider stealth egress ports like 443, 80, 53, or 8443.`
      );
    }
    const isLoopback = formBindAddr === '127.0.0.1' || formBindAddr === 'localhost' || formBindAddr === '::1';
    if (formKind === 'reverse' && isLoopback) {
      warns.push(
        'Listener is bound to loopback (127.0.0.1); incoming reverse shells from remote targets will fail to connect. Use 0.0.0.0 or your VPN adapter IP.'
      );
    }
    return warns;
  }, [formPort, formBindAddr, formKind]);

  const totalCaughtSessions = useMemo(() => {
    return activeListeners.reduce((sum, l) => sum + (l.activeSessions ? l.activeSessions.length : l.catchCount || 0), 0);
  }, [activeListeners]);

  // Handle start listener from form
  const handleStartFromForm = async (saveToVault: boolean) => {
    if (!formName.trim()) {
      setError('Listener name cannot be empty.');
      return;
    }
    if (formPort <= 0 || formPort > 65535) {
      setError('Please specify a valid listening port (1-65535).');
      return;
    }

    setIsStarting(true);
    setError('');
    try {
      const prof: ListenerProfile = {
        id: `prof-${Date.now()}`,
        name: formName.trim(),
        kind: formKind,
        tool: formTool,
        bindAddress: formBindAddr.trim() || '0.0.0.0',
        bindPort: formPort,
        autoSpawnTab: formAutoSpawn,
        notes: formNotes.trim(),
      };

      if (saveToVault) {
        await saveProfile(prof);
      }

      await startListener(prof);
      setInfoMessage(`Listener started on port ${formPort} (${formTool.toUpperCase()}).`);
      setTimeout(() => setInfoMessage(''), 3000);
      await refreshData();
      setActiveTab('active');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStarting(false);
    }
  };

  // Quick start an existing profile
  const handleQuickStartProfile = async (prof: ListenerProfile) => {
    setError('');
    try {
      await startListener(prof);
      setInfoMessage(`Started listener "${prof.name}" on port ${prof.bindPort}.`);
      setTimeout(() => setInfoMessage(''), 3000);
      await refreshData();
      setActiveTab('active');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Stop an active listener
  const handleStopListener = async (id: string, name: string) => {
    setError('');
    try {
      await stopListener(id);
      setInfoMessage(`Stopped listener "${name}".`);
      setTimeout(() => setInfoMessage(''), 3000);
      await refreshData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Delete a saved profile
  const handleDeleteProfile = async (prof: ListenerProfile) => {
    if (!window.confirm(`Delete listener profile "${prof.name}" from Vault?`)) {
      return;
    }
    setError('');
    try {
      await deleteProfile(prof.id);
      setInfoMessage(`Deleted listener profile "${prof.name}".`);
      setTimeout(() => setInfoMessage(''), 3000);
      await refreshData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Copy command to clipboard
  const handleCopyCommand = async (prof: ListenerProfile, id: string) => {
    try {
      const cmd = await generateCommand(prof);
      await navigator.clipboard.writeText(cmd);
      setCopyFeedback(id);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setError('Failed to copy command to clipboard.');
    }
  };

  // Spawn command in local terminal tab
  const handleSpawnInTerminal = async (prof: ListenerProfile) => {
    if (!onSpawnTerminal) return;
    try {
      const cmd = await generateCommand(prof);
      onSpawnTerminal(cmd);
      setInfoMessage(`Spawned "${cmd}" in local terminal tab.`);
      setTimeout(() => setInfoMessage(''), 3000);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
        style={{ width: '98%', maxWidth: '1120px', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Listener Manager"
      >
        {/* Tactical Reticle Corner Overlays */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Cyberpunk HUD Header Bar */}
        <div className="cyber-totp-hud-header">
          <div className="cyber-hud-title-block">
            <div className="cyber-hud-tag-line">
              <span className="cyber-hazard-stripes">///</span>
              <span className="cyber-hud-tag">OPS-CATCHER</span>
              <span className="cyber-hud-delim">//</span>
              <span className="cyber-hud-subtag">C2 CATCHER ENGINE</span>
            </div>
            <h2 className="cyber-hud-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <CyberIcon name="radar" size={20} />
              <span>LISTENER MANAGER // REVERSE &amp; BIND CATCHERS</span>
            </h2>
            <div className="cyber-telemetry-strip">
              <span className="cyber-telemetry-chip chip-cyan" title="Currently active listeners">
                <span className="chip-dot" /> ACTIVE: <strong>{activeListeners.length}</strong>
              </span>
              <span className="cyber-telemetry-chip chip-green" title="Caught incoming shell sessions">
                <span className="chip-dot" /> CAUGHT SESSIONS: <strong>{totalCaughtSessions}</strong>
              </span>
              <span className="cyber-telemetry-chip chip-amber" title="Vault-encrypted listener profiles">
                <span className="chip-dot" /> PROFILES: <strong>{profiles.length}</strong>
              </span>
            </div>
          </div>

          <div className="cyber-hud-actions-block">
            <button
              type="button"
              className="cyber-btn cyber-btn-primary"
              onClick={() => setActiveTab('launch')}
              title="Configure and launch a new reverse or bind listener"
            >
              <CyberIcon name="plus" size={13} />
              <span>LAUNCH LISTENER</span>
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => void refreshData()}
              title="Refresh status"
            >
              <CyberIcon name="radar" size={13} />
              <span>REFRESH</span>
            </button>
            <button
              type="button"
              className="cyber-btn-close"
              onClick={onClose}
              aria-label="Close Listener Manager"
              title="Close Listener Manager"
            >
              <CyberIcon name="close" size={14} />
            </button>
          </div>
        </div>

        {/* Alert Notices */}
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

        {/* Cyberpunk Navigation & Mode Toolbar */}
        <div className="cyber-totp-toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="cyber-filter-pills">
            <button
              type="button"
              className={`cyber-pill-btn ${activeTab === 'active' ? 'active' : ''}`}
              onClick={() => setActiveTab('active')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <CyberIcon name="radar" size={12} />
              <span>ACTIVE LISTENERS</span>
              <span
                style={{
                  fontSize: '0.68rem',
                  padding: '0.05rem 0.35rem',
                  borderRadius: '2px',
                  background: activeListeners.length > 0 ? 'color-mix(in srgb, var(--accent-bright) 20%, transparent)' : 'rgba(148, 163, 184, 0.15)',
                  color: activeListeners.length > 0 ? 'var(--accent-bright)' : '#94a3b8',
                }}
              >
                {activeListeners.length}
              </span>
            </button>

            <button
              type="button"
              className={`cyber-pill-btn ${activeTab === 'profiles' ? 'active' : ''}`}
              onClick={() => setActiveTab('profiles')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <CyberIcon name="shield" size={12} />
              <span>SAVED PROFILES</span>
              <span
                style={{
                  fontSize: '0.68rem',
                  padding: '0.05rem 0.35rem',
                  borderRadius: '2px',
                  background: 'rgba(148, 163, 184, 0.15)',
                  color: '#94a3b8',
                }}
              >
                {profiles.length}
              </span>
            </button>

            <button
              type="button"
              className={`cyber-pill-btn ${activeTab === 'launch' ? 'active' : ''}`}
              onClick={() => setActiveTab('launch')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <CyberIcon name="plus" size={12} />
              <span>LAUNCH / NEW LISTENER</span>
            </button>
          </div>

          <div style={{ fontSize: '0.72rem', color: '#94a3b8', letterSpacing: '0.06em' }}>
            STEALTH EGRESS PORTS: <strong style={{ color: '#10b981' }}>443 · 80 · 53 · 8443</strong>
          </div>
        </div>

        {/* Body Content Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
          {/* TAB 1: ACTIVE LISTENERS */}
          {activeTab === 'active' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {loading && activeListeners.length === 0 ? (
                <div className="cyber-empty-state">
                  <div className="cyber-empty-radar" />
                  <h3 className="cyber-empty-title">/// QUERYING ACTIVE C2 TELEMETRY ///</h3>
                </div>
              ) : activeListeners.length === 0 ? (
                <div className="cyber-empty-state">
                  <div className="cyber-empty-radar" />
                  <div className="cyber-empty-icon" style={{ color: 'var(--accent-bright)' }}>
                    <CyberIcon name="radar" size={36} />
                  </div>
                  <h3 className="cyber-empty-title">No Active Listeners Running</h3>
                  <p className="cyber-empty-desc">
                    Start a stealth reverse shell catcher or bind connector to begin listening for incoming target
                    connections across TCP, SSL/TLS, or PTY channels.
                  </p>
                  <div className="cyber-empty-actions">
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-primary"
                      onClick={() => setActiveTab('launch')}
                    >
                      <CyberIcon name="plus" size={13} />
                      <span>Launch a Listener</span>
                    </button>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary"
                      onClick={() => setActiveTab('profiles')}
                    >
                      <CyberIcon name="shield" size={13} />
                      <span>BROWSE SAVED PROFILES</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cyber-totp-card-grid" style={{ padding: 0, gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))' }}>
                  {activeListeners.map((l) => {
                    const hasCaught = l.catchCount > 0 || (l.activeSessions && l.activeSessions.length > 0);
                    const isStealthPort = l.bindPort === 443 || l.bindPort === 80 || l.bindPort === 53 || l.bindPort === 8443;
                    const isHighRiskPort = l.bindPort === 4444 || l.bindPort === 1337 || l.bindPort === 31337;
                    const totalSegments = 10;
                    const activeSegments = hasCaught ? 10 : isStealthPort ? 8 : 5;

                    return (
                      <div
                        key={l.id}
                        className={`cyber-totp-card ${isHighRiskPort ? 'card-urgent' : !isStealthPort ? 'card-warning' : ''}`}
                      >
                        <div className="card-reticle card-reticle-tl" />
                        <div className="card-reticle card-reticle-tr" />
                        <div className="card-reticle card-reticle-bl" />
                        <div className="card-reticle card-reticle-br" />

                        {/* Card Top Row */}
                        <div className="card-top-row">
                          <div
                            className="card-issuer-monogram"
                            style={{
                              borderColor: hasCaught ? '#10b981' : isHighRiskPort ? '#ff2a6d' : 'var(--accent-bright)',
                              color: hasCaught ? '#10b981' : isHighRiskPort ? '#ff2a6d' : 'var(--accent-bright)',
                            }}
                          >
                            {l.tool.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="card-identity-block">
                            <div className="card-service-name">{l.name}</div>
                            <div className="card-account-label">
                              BIND: {l.bindAddress}:{l.bindPort} · {l.kind.toUpperCase()}
                            </div>
                          </div>
                          <div className="card-tags-block">
                            <span
                              className="card-host-pill"
                              style={{
                                borderColor: hasCaught ? 'rgba(16, 185, 129, 0.5)' : 'color-mix(in srgb, var(--accent-bright) 40%, transparent)',
                                color: hasCaught ? '#34d399' : 'var(--accent-bright)',
                                background: hasCaught ? 'rgba(16, 185, 129, 0.14)' : 'color-mix(in srgb, var(--accent-bright) 10%, transparent)',
                              }}
                            >
                              <span className="pill-pulse" />
                              {hasCaught ? 'ACTIVE // SESSION CAUGHT' : 'LISTENING'}
                            </span>
                            <span className="card-meta-pill">
                              {l.tool.toUpperCase()} · PORT: {l.bindPort} {isStealthPort ? '(STEALTH)' : ''}
                            </span>
                          </div>
                        </div>

                        {/* Cyberpunk Display Terminal for Port + Command Telemetry */}
                        <div className="card-code-terminal" style={{ cursor: 'default' }}>
                          <div className="card-code-main">
                            <div className="code-digits-wrapper" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                              <span
                                className={`cyber-code-digits ${isHighRiskPort ? 'urgent-glow' : ''}`}
                                style={{ fontSize: '1.35rem', letterSpacing: '0.12em' }}
                              >
                                :{l.bindPort} // {l.bindAddress}
                              </span>
                              {l.commandPreview && (
                                <code
                                  style={{
                                    fontSize: '0.73rem',
                                    color: 'var(--accent-text)',
                                    fontFamily: 'var(--font-mono)',
                                    wordBreak: 'break-all',
                                  }}
                                >
                                  {l.commandPreview}
                                </code>
                              )}
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-end',
                                justifyContent: 'center',
                                padding: '0.25rem 0.5rem',
                                border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                                background: 'rgba(2, 8, 18, 0.8)',
                              }}
                            >
                              <span style={{ fontSize: '0.62rem', color: '#94a3b8', letterSpacing: '0.08em' }}>
                                SESSIONS
                              </span>
                              <span
                                style={{
                                  fontSize: '1.15rem',
                                  fontWeight: 800,
                                  color: hasCaught ? '#10b981' : 'var(--accent-bright)',
                                }}
                              >
                                {l.activeSessions ? l.activeSessions.length : l.catchCount || 0}
                              </span>
                            </div>
                          </div>

                          {/* 10-Segment Tactical Bar */}
                          <div className="cyber-segment-bar" aria-hidden="true">
                            {Array.from({ length: totalSegments }).map((_, idx) => (
                              <span
                                key={idx}
                                className={`seg-cell ${idx < activeSegments ? 'seg-active' : 'seg-inactive'} ${
                                  isHighRiskPort ? 'seg-urgent' : !isStealthPort ? 'seg-warning' : ''
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        {/* OPSEC Warnings */}
                        {l.opsecWarnings && l.opsecWarnings.length > 0 && (
                          <div
                            style={{
                              padding: '0.45rem 0.7rem',
                              backgroundColor: 'rgba(245, 158, 11, 0.12)',
                              border: '1px solid rgba(245, 158, 11, 0.45)',
                              color: '#fef08a',
                              fontSize: '0.72rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                            }}
                          >
                            <CyberIcon name="warning" size={13} />
                            <span>{l.opsecWarnings.join(' ')}</span>
                          </div>
                        )}

                        {/* Incoming caught sessions list */}
                        {l.activeSessions && l.activeSessions.length > 0 && (
                          <div
                            style={{
                              paddingTop: '0.55rem',
                              borderTop: '1px dashed rgba(16, 185, 129, 0.35)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.45rem',
                            }}
                          >
                            <div
                              style={{
                                fontSize: '0.7rem',
                                color: '#10b981',
                                fontWeight: 700,
                                letterSpacing: '0.08em',
                              }}
                            >
                              /// CAUGHT INCOMING SHELL SESSIONS ({l.activeSessions.length}) ///
                            </div>
                            {l.activeSessions.map((sess) => (
                              <div
                                key={sess.id}
                                style={{
                                  backgroundColor: 'rgba(2, 10, 20, 0.92)',
                                  border: '1px solid rgba(16, 185, 129, 0.35)',
                                  padding: '0.5rem 0.75rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: '0.5rem',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                  <span style={{ color: '#10b981' }}>
                                    <CyberIcon name="terminal" size={14} />
                                  </span>
                                  <div>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f1f5f9' }}>
                                      Remote Target: {sess.remoteAddr}
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                                      Session: {sess.id} | TX: {sess.bytesSent} B | RX: {sess.bytesReceived} B
                                    </div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  {onOpenSessionTab && (
                                    <button
                                      type="button"
                                      className="cyber-btn-inject"
                                      onClick={() => {
                                        onOpenSessionTab(sess.id);
                                        onClose();
                                      }}
                                      title="Open interactive terminal tab"
                                    >
                                      Open Tab
                                    </button>
                                  )}

                                  {onStabilizeSession && (
                                    <button
                                      type="button"
                                      className="cyber-btn-copy"
                                      style={{ flex: 'unset', padding: '0 0.65rem' }}
                                      onClick={() => {
                                        onStabilizeSession(sess.id);
                                        onClose();
                                      }}
                                      title="Upgrade shell to full interactive PTY"
                                    >
                                      <CyberIcon name="stabilize" size={12} />
                                      <span style={{ marginLeft: '0.3rem' }}>Stabilize</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Card Actions Bottom Row */}
                        <div className="card-action-row">
                          {l.commandPreview && (
                            <button
                              type="button"
                              className={`cyber-btn-copy ${copyFeedback === l.id ? 'is-copied' : ''}`}
                              onClick={() => void handleCopyCommand({ ...l, autoSpawnTab: true }, l.id)}
                              title="Copy CLI listener command"
                            >
                              <CyberIcon name="copy" size={12} />
                              <span style={{ marginLeft: '0.35rem' }}>
                                {copyFeedback === l.id ? 'Copied!' : 'Copy Command'}
                              </span>
                            </button>
                          )}

                          {onOpenPayloadGenerator && (
                            <button
                              type="button"
                              className="cyber-btn-inject"
                              onClick={() => onOpenPayloadGenerator(l.bindPort, l.bindAddress)}
                              title="Open Payload Generator pre-configured for this listener"
                            >
                              <CyberIcon name="target" size={12} />
                              <span style={{ marginLeft: '0.3rem' }}>Payload</span>
                            </button>
                          )}

                          <button
                            type="button"
                            className="cyber-btn cyber-btn-secondary"
                            style={{
                              borderColor: 'rgba(255, 42, 109, 0.5)',
                              color: '#ff2a6d',
                              background: 'rgba(255, 42, 109, 0.1)',
                              height: '32px',
                              padding: '0 0.75rem',
                              fontSize: '0.72rem',
                            }}
                            onClick={() => void handleStopListener(l.id, l.name)}
                            title="Stop this listener and release port"
                          >
                            <CyberIcon name="stop" size={12} />
                            <span>Stop Listener</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SAVED PROFILES */}
          {activeTab === 'profiles' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  Reusable reverse and bind listener profiles sealed in the encrypted vault.
                </span>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-primary"
                  onClick={() => setActiveTab('launch')}
                >
                  <CyberIcon name="plus" size={12} />
                  <span>New Profile</span>
                </button>
              </div>

              {profiles.length === 0 ? (
                <div className="cyber-empty-state">
                  <div className="cyber-empty-radar" />
                  <h3 className="cyber-empty-title">No saved listener profiles found.</h3>
                </div>
              ) : (
                <div className="cyber-totp-card-grid" style={{ padding: 0 }}>
                  {profiles.map((p) => {
                    const isRunning = activeListeners.some((al) => al.bindPort === p.bindPort);
                    const isStealthPort = p.bindPort === 443 || p.bindPort === 80 || p.bindPort === 53 || p.bindPort === 8443;
                    const isHighRiskPort = p.bindPort === 4444 || p.bindPort === 1337;

                    return (
                      <div
                        key={p.id}
                        className={`cyber-totp-card ${isHighRiskPort ? 'card-urgent' : !isStealthPort ? 'card-warning' : ''}`}
                      >
                        <div className="card-reticle card-reticle-tl" />
                        <div className="card-reticle card-reticle-tr" />
                        <div className="card-reticle card-reticle-bl" />
                        <div className="card-reticle card-reticle-br" />

                        <div className="card-top-row">
                          <div className="card-issuer-monogram">
                            {p.tool.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="card-identity-block">
                            <div className="card-service-name">{p.name}</div>
                            <div className="card-account-label">
                              {p.bindAddress}:{p.bindPort} · {p.kind.toUpperCase()}
                            </div>
                          </div>
                          <div className="card-tags-block">
                            {isRunning && (
                              <span className="card-host-pill">
                                <span className="pill-pulse" /> RUNNING
                              </span>
                            )}
                            <span className="card-meta-pill">PORT {p.bindPort}</span>
                          </div>
                        </div>

                        <div className="card-code-terminal" style={{ cursor: 'default', padding: '0.55rem 0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.78rem', color: 'var(--accent-bright)', fontWeight: 700 }}>
                              HANDLER: {p.tool.toUpperCase()} ({p.kind.toUpperCase()})
                            </span>
                            <span
                              style={{
                                fontSize: '0.68rem',
                                color: isStealthPort ? '#10b981' : '#f59e0b',
                                fontWeight: 700,
                              }}
                            >
                              {isStealthPort ? 'STEALTH EGRESS' : 'CUSTOM PORT'}
                            </span>
                          </div>
                          {p.notes && (
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                              {p.notes}
                            </div>
                          )}
                        </div>

                        <div className="card-action-row">
                          <button
                            type="button"
                            className={isRunning ? 'cyber-btn-copy' : 'cyber-btn-inject'}
                            style={{ flex: 1 }}
                            onClick={() => {
                              if (isRunning) {
                                const activeInst = activeListeners.find((al) => al.bindPort === p.bindPort);
                                if (activeInst) void handleStopListener(activeInst.id, p.name);
                              } else {
                                void handleQuickStartProfile(p);
                              }
                            }}
                          >
                            <CyberIcon name={isRunning ? 'stop' : 'play'} size={12} />
                            <span style={{ marginLeft: '0.35rem' }}>{isRunning ? 'Stop' : 'Start'}</span>
                          </button>

                          {p.tool !== 'builtin' && onSpawnTerminal && (
                            <button
                              type="button"
                              className="cyber-btn-icon"
                              onClick={() => void handleSpawnInTerminal(p)}
                              title="Spawn listener inside local terminal tab"
                            >
                              <CyberIcon name="terminal" size={13} />
                            </button>
                          )}

                          <button
                            type="button"
                            className="cyber-btn-icon"
                            onClick={() => void handleCopyCommand(p, p.id)}
                            title="Copy CLI listener command"
                          >
                            <CyberIcon name="copy" size={13} />
                          </button>

                          <button
                            type="button"
                            className="cyber-btn-icon btn-delete"
                            onClick={() => void handleDeleteProfile(p)}
                            title="Delete profile from Vault"
                          >
                            <CyberIcon name="trash" size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: LAUNCH / NEW LISTENER FORM */}
          {activeTab === 'launch' && (
            <div className="cyber-form-panel" style={{ margin: '0 auto', maxWidth: '760px' }}>
              <div className="cyber-form-header">
                <div className="form-header-title">
                  <span className="form-hazard">///</span>
                  <h3>LAUNCH LISTENER // OPERATIONAL CONFIGURATION</h3>
                </div>
                <button
                  type="button"
                  className="cyber-btn-sm cyber-btn-secondary"
                  onClick={() => setActiveTab('active')}
                >
                  Cancel
                </button>
              </div>

              {/* OPSEC Notice */}
              {formOpsecWarnings.length > 0 && (
                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '0.75rem 1rem',
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.45)',
                    color: '#fef08a',
                    fontSize: '0.76rem',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      marginBottom: '0.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      color: '#f59e0b',
                    }}
                  >
                    <CyberIcon name="shield" size={14} />
                    <span>OPSEC ADVISORY</span>
                  </div>
                  {formOpsecWarnings.map((w, idx) => (
                    <div key={idx} style={{ marginTop: '0.2rem' }}>
                      {w}
                    </div>
                  ))}
                </div>
              )}

              <div className="cyber-manual-form">
                <div className="cyber-form-grid-2">
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Profile / Listener Name <span className="req">*</span>
                      <input
                        type="text"
                        className="cyber-input"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Tool / Handler <span className="req">*</span>
                      <select
                        className="cyber-select"
                        value={formTool}
                        onChange={(e) => setFormTool(e.target.value as ListenerTool)}
                      >
                        <option value="builtin">Built-in (Native Go)</option>
                        <option value="nc">Netcat (nc)</option>
                        <option value="rlwrap">rlwrap + nc</option>
                        <option value="ncat-ssl">Ncat (SSL/TLS)</option>
                        <option value="socat">Socat (PTY)</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* Port & Stealth Presets */}
                <div className="cyber-field-group">
                  <label className="cyber-label">Listening Port (1-65535) *</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      className="cyber-input"
                      value={formPort}
                      onChange={(e) => setFormPort(parseInt(e.target.value, 10) || 443)}
                      style={{ width: '120px' }}
                    />
                    <div className="cyber-filter-pills">
                      <button
                        type="button"
                        className={`cyber-pill-btn ${formPort === 443 ? 'active' : ''}`}
                        onClick={() => setFormPort(443)}
                        title="HTTPS Egress (Recommended Stealth Port)"
                      >
                        443 (HTTPS)
                      </button>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${formPort === 80 ? 'active' : ''}`}
                        onClick={() => setFormPort(80)}
                        title="HTTP Egress"
                      >
                        80 (HTTP)
                      </button>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${formPort === 53 ? 'active' : ''}`}
                        onClick={() => setFormPort(53)}
                        title="DNS Egress"
                      >
                        53 (DNS)
                      </button>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${formPort === 8443 ? 'active' : ''}`}
                        onClick={() => setFormPort(8443)}
                        title="Alt-HTTPS Egress"
                      >
                        8443
                      </button>
                      <button
                        type="button"
                        className={`cyber-pill-btn ${formPort === 4444 ? 'active' : ''}`}
                        onClick={() => setFormPort(4444)}
                        title="Metasploit default (Signature risk)"
                        style={
                          formPort === 4444
                            ? { borderColor: '#ff2a6d', color: '#ff2a6d', background: 'rgba(255, 42, 109, 0.16)' }
                            : { borderColor: 'rgba(255, 42, 109, 0.35)', color: '#fda4af' }
                        }
                      >
                        4444
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bind Address & Kind */}
                <div className="cyber-form-grid-2">
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Bind Interface Address
                      <input
                        type="text"
                        className="cyber-input"
                        value={formBindAddr}
                        onChange={(e) => setFormBindAddr(e.target.value)}
                        placeholder="0.0.0.0 (all interfaces)"
                      />
                    </label>
                  </div>
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      Kind
                      <select
                        className="cyber-select"
                        value={formKind}
                        onChange={(e) => setFormKind(e.target.value as ListenerKind)}
                      >
                        <option value="reverse">Reverse Shell Receiver</option>
                        <option value="bind">Bind Shell Connector</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* Checkbox: Auto-spawn tab */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    fontSize: '0.78rem',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={formAutoSpawn}
                    onChange={(e) => setFormAutoSpawn(e.target.checked)}
                  />
                  <span>Automatically open an interactive terminal tab when incoming connection connects</span>
                </label>

                {/* Operational notes */}
                <div className="cyber-field-group">
                  <label className="cyber-label">
                    Operational Notes &amp; Context
                    <input
                      type="text"
                      className="cyber-input"
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      placeholder="e.g. Catcher for internal perimeter reverse payloads"
                    />
                  </label>
                </div>

                <div className="cyber-form-actions">
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary"
                    onClick={() => setActiveTab('active')}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary"
                    onClick={() => void handleStartFromForm(true)}
                    disabled={isStarting}
                    title="Save profile to Vault and launch listener"
                  >
                    <CyberIcon name="save" size={13} />
                    <span>Save &amp; Start</span>
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-primary"
                    onClick={() => void handleStartFromForm(false)}
                    disabled={isStarting}
                  >
                    <CyberIcon name="play" size={13} />
                    <span>{isStarting ? 'Starting...' : 'Start Listener Now'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Info Strip */}
        <div className="cyber-totp-footer">
          <span className="footer-hazard">///</span>
          <span className="footer-text">
            MULTI-PROTOCOL C2 ENGINE · NATIVE GO TCP CATCHERS &amp; PTY/SSL HANDLERS · OPSEC PORT GUARD ACTIVE
          </span>
          <button type="button" className="cyber-btn-sm cyber-btn-secondary" onClick={onClose}>
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
