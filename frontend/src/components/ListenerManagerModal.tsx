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
      className="cyber-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(2, 6, 12, 0.88)',
        backdropFilter: 'blur(5px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cyber-modal-container"
        style={{
          width: '98%',
          maxWidth: '1100px',
          maxHeight: '90vh',
          backgroundColor: '#050c18',
          border: '1px solid var(--color-primary-cyan, #00f0ff)',
          boxShadow: '0 0 25px rgba(0, 240, 255, 0.25)',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#e2e8f0',
          fontFamily: 'var(--font-mono, "JetBrains Mono", Consolas, monospace)',
        }}
      >
        {/* Modal Header */}
        <div
          className="cyber-modal-header"
          style={{
            padding: '0.85rem 1.25rem',
            borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(5, 12, 24, 0.95)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ color: 'var(--color-primary-cyan, #00f0ff)' }}>
              <CyberIcon name="radar" size={20} />
            </span>
            <div>
              <div
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: 'var(--color-primary-cyan, #00f0ff)',
                }}
              >
                LISTENER MANAGER // REVERSE & BIND CATCHERS (F-32)
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                Multi-tool reverse shell catchers, SSL/TLS handlers, PTY receivers, and session telemetry
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-hud-btn btn-sm"
            onClick={onClose}
            aria-label="Close Listener Manager"
          >
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        {/* Navigation Tabs Header */}
        <div
          style={{
            padding: '0 1.25rem',
            backgroundColor: 'rgba(8, 20, 38, 0.85)',
            borderBottom: '1px solid rgba(0, 240, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className={`cyber-hud-tab ${activeTab === 'active' ? 'active' : ''}`}
              onClick={() => setActiveTab('active')}
              style={{
                padding: '0.65rem 1rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: activeTab === 'active' ? '2px solid var(--color-primary-cyan, #00f0ff)' : '2px solid transparent',
                color: activeTab === 'active' ? 'var(--color-primary-cyan, #00f0ff)' : '#94a3b8',
                background: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <span>ACTIVE LISTENERS</span>
              <span
                style={{
                  fontSize: '0.65rem',
                  padding: '0.1rem 0.35rem',
                  borderRadius: '3px',
                  backgroundColor:
                    activeListeners.length > 0 ? 'rgba(0, 240, 255, 0.2)' : 'rgba(100, 116, 139, 0.2)',
                  color: activeListeners.length > 0 ? 'var(--color-primary-cyan, #00f0ff)' : '#94a3b8',
                }}
              >
                {activeListeners.length}
              </span>
            </button>

            <button
              type="button"
              className={`cyber-hud-tab ${activeTab === 'profiles' ? 'active' : ''}`}
              onClick={() => setActiveTab('profiles')}
              style={{
                padding: '0.65rem 1rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: activeTab === 'profiles' ? '2px solid var(--color-primary-cyan, #00f0ff)' : '2px solid transparent',
                color: activeTab === 'profiles' ? 'var(--color-primary-cyan, #00f0ff)' : '#94a3b8',
                background: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <span>SAVED PROFILES</span>
              <span
                style={{
                  fontSize: '0.65rem',
                  padding: '0.1rem 0.35rem',
                  borderRadius: '3px',
                  backgroundColor: 'rgba(100, 116, 139, 0.2)',
                  color: '#94a3b8',
                }}
              >
                {profiles.length}
              </span>
            </button>

            <button
              type="button"
              className={`cyber-hud-tab ${activeTab === 'launch' ? 'active' : ''}`}
              onClick={() => setActiveTab('launch')}
              style={{
                padding: '0.65rem 1rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: activeTab === 'launch' ? '2px solid var(--color-primary-cyan, #00f0ff)' : '2px solid transparent',
                color: activeTab === 'launch' ? 'var(--color-primary-cyan, #00f0ff)' : '#94a3b8',
                background: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <CyberIcon name="plus" size={12} />
              <span>LAUNCH / NEW LISTENER</span>
            </button>
          </div>

          <button
            type="button"
            className="cyber-hud-btn btn-sm"
            onClick={() => void refreshData()}
            title="Refresh status"
            style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
          >
            <CyberIcon name="radar" size={11} />
            <span style={{ marginLeft: '0.3rem' }}>Refresh</span>
          </button>
        </div>

        {/* Notifications & Error messages */}
        {error && (
          <div
            style={{
              margin: '0.65rem 1.25rem 0 1.25rem',
              padding: '0.55rem 0.85rem',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              color: '#fca5a5',
              borderRadius: '4px',
              fontSize: '0.78rem',
            }}
          >
            {error}
          </div>
        )}
        {infoMessage && (
          <div
            style={{
              margin: '0.65rem 1.25rem 0 1.25rem',
              padding: '0.55rem 0.85rem',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              color: '#6ee7b7',
              borderRadius: '4px',
              fontSize: '0.78rem',
            }}
          >
            {infoMessage}
          </div>
        )}

        {/* Body Container */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
          {/* TAB 1: ACTIVE LISTENERS */}
          {activeTab === 'active' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {loading && activeListeners.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.82rem' }}>
                  Querying active listeners telemetry...
                </div>
              ) : activeListeners.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '3rem 1.5rem',
                    backgroundColor: 'rgba(8, 20, 38, 0.5)',
                    border: '1px dashed rgba(0, 240, 255, 0.25)',
                    borderRadius: '4px',
                  }}
                >
                  <div style={{ color: '#64748b', marginBottom: '0.65rem' }}>
                    <CyberIcon name="radar" size={32} />
                  </div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#e2e8f0' }}>
                    No Active Listeners Running
                  </div>
                  <div
                    style={{
                      fontSize: '0.76rem',
                      color: '#94a3b8',
                      maxWidth: '460px',
                      margin: '0.5rem auto 1rem auto',
                      lineHeight: '1.4',
                    }}
                  >
                    Start a stealth reverse shell catcher or bind connector to begin listening for incoming target connections.
                  </div>
                  <button
                    type="button"
                    className="cyber-hud-btn btn-sm btn-primary"
                    onClick={() => setActiveTab('launch')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <CyberIcon name="plus" size={12} />
                    <span>Launch a Listener</span>
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {activeListeners.map((l) => {
                    const hasCaught = l.catchCount > 0 || (l.activeSessions && l.activeSessions.length > 0);
                    const isStealthPort = l.bindPort === 443 || l.bindPort === 80 || l.bindPort === 53;

                    return (
                      <div
                        key={l.id}
                        style={{
                          backgroundColor: 'rgba(5, 14, 28, 0.9)',
                          border: hasCaught
                            ? '1px solid #10b981'
                            : '1px solid rgba(0, 240, 255, 0.3)',
                          boxShadow: hasCaught
                            ? '0 0 15px rgba(16, 185, 129, 0.2)'
                            : '0 0 10px rgba(0, 240, 255, 0.1)',
                          borderRadius: '4px',
                          padding: '1rem',
                        }}
                      >
                        {/* Top info row */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '0.75rem',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc' }}>
                                {l.name}
                              </span>
                              <span
                                style={{
                                  fontSize: '0.65rem',
                                  padding: '0.1rem 0.4rem',
                                  borderRadius: '3px',
                                  backgroundColor: hasCaught
                                    ? 'rgba(16, 185, 129, 0.2)'
                                    : 'rgba(0, 240, 255, 0.15)',
                                  color: hasCaught ? '#34d399' : 'var(--color-primary-cyan, #00f0ff)',
                                  border: hasCaught ? '1px solid #10b981' : '1px solid rgba(0, 240, 255, 0.3)',
                                  fontWeight: 600,
                                }}
                              >
                                {hasCaught ? 'ACTIVE // SESSION CAUGHT' : 'LISTENING'}
                              </span>
                              <span
                                style={{
                                  fontSize: '0.65rem',
                                  padding: '0.1rem 0.4rem',
                                  borderRadius: '3px',
                                  backgroundColor: 'rgba(148, 163, 184, 0.15)',
                                  color: '#cbd5e1',
                                  textTransform: 'uppercase',
                                  fontWeight: 600,
                                }}
                              >
                                {l.tool}
                              </span>
                              <span
                                style={{
                                  fontSize: '0.65rem',
                                  padding: '0.1rem 0.4rem',
                                  borderRadius: '3px',
                                  backgroundColor: isStealthPort
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(245, 158, 11, 0.15)',
                                  color: isStealthPort ? '#34d399' : '#fbbf24',
                                  fontWeight: 600,
                                }}
                              >
                                PORT: {l.bindPort} {isStealthPort ? '(STEALTH)' : ''}
                              </span>
                              <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                                BIND: {l.bindAddress}:{l.bindPort}
                              </span>
                            </div>

                            {/* OPSEC Warnings */}
                            {l.opsecWarnings && l.opsecWarnings.length > 0 && (
                              <div
                                style={{
                                  marginTop: '0.5rem',
                                  padding: '0.35rem 0.65rem',
                                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                                  border: '1px solid rgba(245, 158, 11, 0.4)',
                                  borderRadius: '3px',
                                  color: '#fef08a',
                                  fontSize: '0.72rem',
                                }}
                              >
                                {l.opsecWarnings.join(' ')}
                              </div>
                            )}

                            {/* Command preview */}
                            {l.commandPreview && l.tool !== 'builtin' && (
                              <div style={{ marginTop: '0.5rem' }}>
                                <code
                                  style={{
                                    fontSize: '0.74rem',
                                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '3px',
                                    color: '#38bdf8',
                                    border: '1px solid rgba(0, 240, 255, 0.2)',
                                  }}
                                >
                                  {l.commandPreview}
                                </code>
                              </div>
                            )}
                          </div>

                          {/* Top Action buttons */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            {onOpenPayloadGenerator && (
                              <button
                                type="button"
                                className="cyber-hud-btn btn-sm"
                                onClick={() => onOpenPayloadGenerator(l.bindPort, l.bindAddress)}
                                title="Open Payload Generator pre-configured for this listener"
                                style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                              >
                                <CyberIcon name="target" size={12} />
                                <span>Payload (F-33)</span>
                              </button>
                            )}

                            {l.commandPreview && (
                              <button
                                type="button"
                                className="cyber-hud-btn btn-sm"
                                onClick={() => void handleCopyCommand({ ...l, autoSpawnTab: true }, l.id)}
                                title="Copy CLI listener command"
                                style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                              >
                                <CyberIcon name="copy" size={12} />
                                <span>{copyFeedback === l.id ? 'Copied!' : 'Copy Command'}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              className="cyber-hud-btn btn-sm btn-danger"
                              onClick={() => void handleStopListener(l.id, l.name)}
                              title="Stop this listener and release port"
                              style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                            >
                              <CyberIcon name="stop" size={12} />
                              <span>Stop Listener</span>
                            </button>
                          </div>
                        </div>

                        {/* Incoming caught sessions table/list */}
                        {l.activeSessions && l.activeSessions.length > 0 && (
                          <div
                            style={{
                              marginTop: '0.85rem',
                              paddingTop: '0.75rem',
                              borderTop: '1px dashed rgba(16, 185, 129, 0.3)',
                            }}
                          >
                            <div
                              style={{
                                fontSize: '0.72rem',
                                color: '#34d399',
                                fontWeight: 600,
                                letterSpacing: '0.05em',
                                marginBottom: '0.45rem',
                              }}
                            >
                              CAUGHT INCOMING SHELL SESSIONS ({l.activeSessions.length}):
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                              {l.activeSessions.map((sess) => (
                                <div
                                  key={sess.id}
                                  style={{
                                    backgroundColor: 'rgba(4, 9, 18, 0.95)',
                                    border: '1px solid rgba(16, 185, 129, 0.25)',
                                    borderRadius: '3px',
                                    padding: '0.5rem 0.75rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap',
                                    gap: '0.5rem',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                    <span style={{ color: '#34d399' }}>
                                      <CyberIcon name="terminal" size={14} />
                                    </span>
                                    <div>
                                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f1f5f9' }}>
                                        Remote Target: {sess.remoteAddr}
                                      </div>
                                      <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                                        Session: {sess.id} | Sent: {sess.bytesSent} B | Received: {sess.bytesReceived} B
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                    {onOpenSessionTab && (
                                      <button
                                        type="button"
                                        className="cyber-hud-btn btn-sm btn-primary"
                                        onClick={() => {
                                          onOpenSessionTab(sess.id);
                                          onClose();
                                        }}
                                        title="Open interactive terminal tab"
                                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem' }}
                                      >
                                        Open Tab
                                      </button>
                                    )}

                                    {onStabilizeSession && (
                                      <button
                                        type="button"
                                        className="cyber-hud-btn btn-sm"
                                        onClick={() => {
                                          onStabilizeSession(sess.id);
                                          onClose();
                                        }}
                                        title="Upgrade shell to full interactive PTY (F-34)"
                                        style={{
                                          fontSize: '0.7rem',
                                          padding: '0.2rem 0.55rem',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '0.3rem',
                                          color: 'var(--color-primary-cyan, #00f0ff)',
                                          borderColor: 'rgba(0, 240, 255, 0.4)',
                                        }}
                                      >
                                        <CyberIcon name="stabilize" size={12} />
                                        <span>Stabilize (F-34)</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SAVED PROFILES */}
          {activeTab === 'profiles' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  Reusable reverse and bind listener profiles stored in encrypted vault.
                </span>
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-primary"
                  onClick={() => setActiveTab('launch')}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <CyberIcon name="plus" size={12} />
                  <span>New Profile</span>
                </button>
              </div>

              {profiles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b', fontSize: '0.8rem' }}>
                  No saved listener profiles found.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.85rem' }}>
                  {profiles.map((p) => {
                    const isRunning = activeListeners.some((al) => al.bindPort === p.bindPort);
                    const isStealthPort = p.bindPort === 443 || p.bindPort === 80 || p.bindPort === 53;

                    return (
                      <div
                        key={p.id}
                        style={{
                          backgroundColor: 'rgba(8, 20, 38, 0.75)',
                          border: isRunning
                            ? '1px solid var(--color-primary-cyan, #00f0ff)'
                            : '1px solid rgba(0, 240, 255, 0.2)',
                          borderRadius: '4px',
                          padding: '0.85rem',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '0.65rem',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ fontSize: '0.86rem', fontWeight: 600, color: '#f8fafc' }}>
                              {p.name}
                            </div>
                            <span
                              style={{
                                fontSize: '0.62rem',
                                padding: '0.1rem 0.35rem',
                                borderRadius: '2px',
                                backgroundColor: isStealthPort
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : 'rgba(245, 158, 11, 0.15)',
                                color: isStealthPort ? '#34d399' : '#fbbf24',
                                fontWeight: 600,
                              }}
                            >
                              PORT {p.bindPort}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                            <span
                              style={{
                                fontSize: '0.65rem',
                                padding: '0.05rem 0.3rem',
                                borderRadius: '2px',
                                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                              }}
                            >
                              {p.tool}
                            </span>
                            <span
                              style={{
                                fontSize: '0.65rem',
                                padding: '0.05rem 0.3rem',
                                borderRadius: '2px',
                                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                              }}
                            >
                              {p.kind}
                            </span>
                            {isRunning && (
                              <span
                                style={{
                                  fontSize: '0.62rem',
                                  padding: '0.05rem 0.3rem',
                                  borderRadius: '2px',
                                  backgroundColor: 'rgba(0, 240, 255, 0.2)',
                                  color: 'var(--color-primary-cyan, #00f0ff)',
                                  fontWeight: 600,
                                }}
                              >
                                RUNNING
                              </span>
                            )}
                          </div>

                          {p.notes && (
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.4rem' }}>
                              {p.notes}
                            </div>
                          )}
                        </div>

                        {/* Profile Action Buttons */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingTop: '0.5rem',
                            borderTop: '1px solid rgba(0, 240, 255, 0.1)',
                          }}
                        >
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className={`cyber-hud-btn btn-sm ${isRunning ? 'btn-danger' : 'btn-primary'}`}
                              onClick={() => {
                                if (isRunning) {
                                  const activeInst = activeListeners.find((al) => al.bindPort === p.bindPort);
                                  if (activeInst) void handleStopListener(activeInst.id, p.name);
                                } else {
                                  void handleQuickStartProfile(p);
                                }
                              }}
                              style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem' }}
                            >
                              <CyberIcon name={isRunning ? 'stop' : 'play'} size={11} />
                              <span style={{ marginLeft: '0.25rem' }}>{isRunning ? 'Stop' : 'Start'}</span>
                            </button>

                            {p.tool !== 'builtin' && onSpawnTerminal && (
                              <button
                                type="button"
                                className="cyber-hud-btn btn-sm"
                                onClick={() => void handleSpawnInTerminal(p)}
                                title="Spawn listener inside local terminal tab"
                                style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem' }}
                              >
                                <CyberIcon name="terminal" size={11} />
                              </button>
                            )}

                            <button
                              type="button"
                              className="cyber-hud-btn btn-sm"
                              onClick={() => void handleCopyCommand(p, p.id)}
                              title="Copy CLI listener command"
                              style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem' }}
                            >
                              <CyberIcon name="copy" size={11} />
                            </button>
                          </div>

                          <button
                            type="button"
                            className="cyber-hud-btn btn-sm btn-danger"
                            onClick={() => void handleDeleteProfile(p)}
                            title="Delete profile from Vault"
                            style={{ padding: '0.2rem 0.45rem' }}
                          >
                            <CyberIcon name="trash" size={11} />
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
            <div
              style={{
                maxWidth: '680px',
                margin: '0 auto',
                backgroundColor: 'rgba(5, 14, 28, 0.95)',
                border: '1px solid rgba(0, 240, 255, 0.25)',
                borderRadius: '4px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-primary-cyan, #00f0ff)' }}>
                LAUNCH LISTENER // OPERATIONAL CONFIGURATION
              </div>

              {/* OPSEC Notice */}
              {formOpsecWarnings.length > 0 && (
                <div
                  style={{
                    padding: '0.65rem 0.85rem',
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    borderRadius: '4px',
                    color: '#fef08a',
                    fontSize: '0.74rem',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <CyberIcon name="shield" size={13} />
                    <span>OPSEC ADVISORY</span>
                  </div>
                  {formOpsecWarnings.map((w, idx) => (
                    <div key={idx} style={{ marginTop: '0.15rem' }}>
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Name & Tool */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Profile / Listener Name *
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Tool / Handler *
                  </label>
                  <select
                    className="cyber-hud-select"
                    value={formTool}
                    onChange={(e) => setFormTool(e.target.value as ListenerTool)}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  >
                    <option value="builtin">Built-in (Native Go)</option>
                    <option value="nc">Netcat (nc)</option>
                    <option value="rlwrap">rlwrap + nc</option>
                    <option value="ncat-ssl">Ncat (SSL/TLS)</option>
                    <option value="socat">Socat (PTY)</option>
                  </select>
                </div>
              </div>

              {/* Port & Stealth Presets */}
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                  Listening Port (1-65535) *
                </label>
                <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    className="cyber-hud-input"
                    value={formPort}
                    onChange={(e) => setFormPort(parseInt(e.target.value, 10) || 443)}
                    style={{ width: '100px', fontSize: '0.82rem' }}
                  />
                  {/* Quick stealth presets */}
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`cyber-hud-btn btn-sm ${formPort === 443 ? 'btn-primary' : ''}`}
                      onClick={() => setFormPort(443)}
                      title="HTTPS Egress (Recommended Stealth Port)"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                    >
                      443 (HTTPS)
                    </button>
                    <button
                      type="button"
                      className={`cyber-hud-btn btn-sm ${formPort === 80 ? 'btn-primary' : ''}`}
                      onClick={() => setFormPort(80)}
                      title="HTTP Egress"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                    >
                      80 (HTTP)
                    </button>
                    <button
                      type="button"
                      className={`cyber-hud-btn btn-sm ${formPort === 53 ? 'btn-primary' : ''}`}
                      onClick={() => setFormPort(53)}
                      title="DNS Egress"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                    >
                      53 (DNS)
                    </button>
                    <button
                      type="button"
                      className={`cyber-hud-btn btn-sm ${formPort === 8443 ? 'btn-primary' : ''}`}
                      onClick={() => setFormPort(8443)}
                      title="Alt-HTTPS Egress"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                    >
                      8443
                    </button>
                    <button
                      type="button"
                      className={`cyber-hud-btn btn-sm ${formPort === 4444 ? 'btn-danger' : ''}`}
                      onClick={() => setFormPort(4444)}
                      title="Metasploit default (Signature risk)"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                    >
                      4444
                    </button>
                  </div>
                </div>
              </div>

              {/* Bind Address & Kind */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Bind Interface Address
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={formBindAddr}
                    onChange={(e) => setFormBindAddr(e.target.value)}
                    placeholder="0.0.0.0 (all interfaces)"
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                    Kind
                  </label>
                  <select
                    className="cyber-hud-select"
                    value={formKind}
                    onChange={(e) => setFormKind(e.target.value as ListenerKind)}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  >
                    <option value="reverse">Reverse Shell Receiver</option>
                    <option value="bind">Bind Shell Connector</option>
                  </select>
                </div>
              </div>

              {/* Checkbox: Auto-spawn tab */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
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
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
                  Operational Notes & Context
                </label>
                <input
                  type="text"
                  className="cyber-hud-input"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="e.g. Catcher for internal perimeter reverse payloads"
                  style={{ width: '100%', fontSize: '0.82rem' }}
                />
              </div>

              {/* Form buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.65rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid rgba(0, 240, 255, 0.2)',
                }}
              >
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm"
                  onClick={() => setActiveTab('active')}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm"
                  onClick={() => void handleStartFromForm(true)}
                  disabled={isStarting}
                  title="Save profile to Vault and launch listener"
                >
                  Save &amp; Start
                </button>
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm btn-primary"
                  onClick={() => void handleStartFromForm(false)}
                  disabled={isStarting}
                >
                  {isStarting ? 'Starting...' : 'Start Listener Now'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
