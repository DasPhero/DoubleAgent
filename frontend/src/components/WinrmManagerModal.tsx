import React, { useEffect, useMemo, useState } from 'react';
import { CyberIcon } from './CyberIcon';
import {
  WinrmAuthType,
  WinrmConnectRequest,
  WinrmCredentialCandidate,
  WinrmExecResult,
  WinrmHostCandidate,
  WinrmIdentityCandidate,
  WinrmProfilePayload,
  WinrmProfileSummary,
  WinrmSessionInfo,
  WinrmToolStatus,
  WinrmTransferResult,
} from '../types/winrm';

export interface SocksCandidate {
  id: string;
  label: string;
  addr: string;
}

export interface WinrmManagerModalProps {
  isOpen?: boolean;
  isEmbedded?: boolean;
  onClose: () => void;
  onPinToTab?: () => void;
  onPopOutModal?: () => void;
  activeEngagementId?: string | null;
  activeEngagementName?: string | null;
  hosts?: WinrmHostCandidate[];
  identities?: WinrmIdentityCandidate[];
  credentials?: WinrmCredentialCandidate[];
  socksCandidates?: SocksCandidate[];
  listProfiles: () => Promise<WinrmProfileSummary[]>;
  saveProfile: (profile: WinrmProfilePayload) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  detectTools: () => Promise<WinrmToolStatus[]>;
  buildCliCommand: (profile: WinrmProfilePayload) => Promise<string>;
  connectSession: (req: WinrmConnectRequest) => Promise<WinrmSessionInfo>;
  listActiveSessions: () => Promise<WinrmSessionInfo[]>;
  executeCommand: (sessionId: string, script: string) => Promise<WinrmExecResult>;
  uploadFile: (sessionId: string, localPath: string, remotePath: string) => Promise<WinrmTransferResult>;
  downloadFile: (sessionId: string, remotePath: string, localPath: string) => Promise<WinrmTransferResult>;
  disconnectSession: (sessionId: string) => Promise<void>;
  onSessionConnected: (session: WinrmSessionInfo) => void;
  onFocusSession?: (sessionId: string) => void;
}

const AUTH_OPTIONS: { value: WinrmAuthType; label: string; hint: string }[] = [
  { value: 'ntlm', label: 'NTLM', hint: 'NTLMv2 challenge/response with password' },
  { value: 'pth', label: 'Pass-the-Hash', hint: 'NTLMv2 using 32-hex NT hash (no cleartext password)' },
  { value: 'kerberos', label: 'Kerberos', hint: 'Negotiate / SPN (use DNS FQDN)' },
  { value: 'basic', label: 'Basic', hint: 'Base64 credentials (use HTTPS 5986)' },
];

function formatBytes(n: number): string {
  if (!n || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export const WinrmManagerModal: React.FC<WinrmManagerModalProps> = ({
  isOpen = true,
  isEmbedded = false,
  onClose,
  onPinToTab,
  onPopOutModal,
  activeEngagementId = null,
  activeEngagementName = null,
  hosts = [],
  identities = [],
  credentials = [],
  socksCandidates = [],
  listProfiles,
  saveProfile,
  deleteProfile,
  detectTools,
  buildCliCommand,
  connectSession,
  listActiveSessions,
  executeCommand,
  uploadFile,
  downloadFile,
  disconnectSession,
  onSessionConnected,
  onFocusSession,
}) => {
  const [profiles, setProfiles] = useState<WinrmProfileSummary[]>([]);
  const [sessions, setSessions] = useState<WinrmSessionInfo[]>([]);
  const [tools, setTools] = useState<WinrmToolStatus[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  // Form state
  const [editingId, setEditingId] = useState<string>('');
  const [scopeToEngagement, setScopeToEngagement] = useState<boolean>(Boolean(activeEngagementId));
  const [profileListFilter, setProfileListFilter] = useState<'scoped' | 'all'>(activeEngagementId ? 'scoped' : 'all');
  const [hostId, setHostId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [host, setHost] = useState<string>('');
  const [useTls, setUseTls] = useState<boolean>(false);
  const [insecureSkipVerify, setInsecureSkipVerify] = useState<boolean>(true);
  const [port, setPort] = useState<number>(5985);
  const [authType, setAuthType] = useState<WinrmAuthType>('ntlm');
  const [domain, setDomain] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [ntHash, setNtHash] = useState<string>('');
  const [identityId, setIdentityId] = useState<string>('');
  const [credentialId, setCredentialId] = useState<string>('');
  const [socksProxyAddr, setSocksProxyAddr] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [editingHasStoredSecret, setEditingHasStoredSecret] = useState<boolean>(false);

  // Command & transfer runner state
  const [psCommand, setPsCommand] = useState<string>('whoami /all');
  const [execResult, setExecResult] = useState<WinrmExecResult | null>(null);
  const [uploadLocalPath, setUploadLocalPath] = useState<string>('');
  const [uploadRemotePath, setUploadRemotePath] = useState<string>('C:\\Windows\\Temp\\payload.bin');
  const [downloadRemotePath, setDownloadRemotePath] = useState<string>('C:\\Users\\Public\\loot.txt');
  const [downloadLocalPath, setDownloadLocalPath] = useState<string>('');
  const [transferResult, setTransferResult] = useState<WinrmTransferResult | null>(null);

  const [cliPreview, setCliPreview] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const refreshData = async () => {
    try {
      const [profs, active, toolRes] = await Promise.all([
        listProfiles(),
        listActiveSessions(),
        detectTools().catch(() => [] as WinrmToolStatus[]),
      ]);
      setProfiles(profs || []);
      setSessions(active || []);
      setTools(toolRes || []);
      if (active && active.length > 0 && !active.some((s) => s.sessionId === selectedSessionId)) {
        setSelectedSessionId(active[0].sessionId);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      if (!activeEngagementId || profileListFilter === 'all') return true;
      return !p.engagementId || p.engagementId === activeEngagementId;
    });
  }, [profiles, activeEngagementId, profileListFilter]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.sessionId === selectedSessionId) || sessions[0] || null,
    [sessions, selectedSessionId]
  );

  const liveOpsecWarnings = useMemo(() => {
    const warns: string[] = [];
    if (!useTls && authType === 'basic') {
      warns.push('CRITICAL OPSEC: Basic auth over HTTP (5985) sends Base64 credentials in cleartext. Switch to HTTPS (5986).');
    } else if (!useTls) {
      warns.push('HTTP 5985 transport selected (no TLS layer). Prefer HTTPS 5986 when WinRM-HTTPS listener is available.');
    }
    if (useTls && insecureSkipVerify) {
      warns.push('TLS certificate verification disabled (lab/self-signed mode).');
    }
    if (authType === 'kerberos' && /^\d+\.\d+\.\d+\.\d+$/.test(host.trim())) {
      warns.push('Kerberos WinRM requires a target DNS FQDN SPN, not a raw IPv4 address.');
    }
    return warns;
  }, [useTls, insecureSkipVerify, authType, host]);

  if (!isOpen) return null;

  const resetForm = () => {
    setEditingId('');
    setHostId('');
    setName('');
    setHost('');
    setUseTls(false);
    setInsecureSkipVerify(true);
    setPort(5985);
    setAuthType('ntlm');
    setDomain('');
    setUsername('');
    setPassword('');
    setNtHash('');
    setIdentityId('');
    setCredentialId('');
    setSocksProxyAddr('');
    setNotes('');
    setEditingHasStoredSecret(false);
    setCliPreview('');
    setErrorMessage('');
  };

  const buildPayloadFromForm = (): WinrmProfilePayload => ({
    id: editingId,
    engagementId: scopeToEngagement && activeEngagementId ? activeEngagementId : '',
    hostId,
    name: name.trim() || (host.trim() ? `WinRM ${host.trim()}` : ''),
    host: host.trim(),
    port,
    useTls,
    insecureSkipVerify,
    authType,
    domain: domain.trim(),
    username: username.trim(),
    password: password || undefined,
    ntHash: ntHash.trim() || undefined,
    identityId: identityId || undefined,
    credentialId: credentialId || undefined,
    socksProxyAddr: socksProxyAddr.trim() || undefined,
    notes: notes.trim() || undefined,
  });

  const handleToggleTls = (checked: boolean) => {
    setUseTls(checked);
    if (checked && port === 5985) setPort(5986);
    if (!checked && port === 5986) setPort(5985);
  };

  const handleSelectHost = (selectedId: string) => {
    setHostId(selectedId);
    const match = hosts.find((h) => h.id === selectedId);
    if (match) {
      setHost(match.address);
      if (!name.trim()) setName(`WinRM ${match.label}`);
    }
  };

  const handleSelectCredential = (selectedCredId: string) => {
    setCredentialId(selectedCredId);
    const cred = credentials.find((c) => c.id === selectedCredId);
    if (cred) {
      if (cred.realm) setDomain(cred.realm);
      if (cred.username) setUsername(cred.username);
      if (cred.category === 'hash') {
        setAuthType('pth');
      }
      setPassword('');
      setNtHash('');
    }
  };

  const handleLoadProfile = (p: WinrmProfileSummary) => {
    setEditingId(p.id);
    setHostId(p.hostId || '');
    setName(p.name);
    setHost(p.host);
    setPort(p.port || (p.useTls ? 5986 : 5985));
    setUseTls(Boolean(p.useTls));
    setInsecureSkipVerify(Boolean(p.insecureSkipVerify));
    setAuthType((p.authType as WinrmAuthType) || 'ntlm');
    setDomain(p.domain || '');
    setUsername(p.username || '');
    setPassword('');
    setNtHash('');
    setIdentityId(p.identityId || '');
    setCredentialId(p.credentialId || '');
    setSocksProxyAddr(p.socksProxyAddr || '');
    setNotes(p.notes || '');
    setEditingHasStoredSecret(p.hasPassword || p.hasNtHash);
    setErrorMessage('');
    setStatusMessage(`Loaded profile "${p.name}". Enter new secret only to override stored vault credential.`);
  };

  const handleSaveProfile = async () => {
    setErrorMessage('');
    setStatusMessage('');
    setIsBusy(true);
    try {
      const payload = buildPayloadFromForm();
      await saveProfile(payload);
      setPassword('');
      setNtHash('');
      await refreshData();
      setStatusMessage(`Saved WinRM profile "${payload.name || payload.host}" to encrypted vault.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    setErrorMessage('');
    setIsBusy(true);
    try {
      await deleteProfile(id);
      if (editingId === id) resetForm();
      await refreshData();
      setStatusMessage('Deleted WinRM profile from vault.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleConnect = async (overrideProfile?: WinrmProfileSummary) => {
    setErrorMessage('');
    setStatusMessage('');
    setIsBusy(true);
    try {
      const req: WinrmConnectRequest = overrideProfile
        ? {
          profileId: overrideProfile.id,
          hostId: overrideProfile.hostId,
          engagementId: overrideProfile.engagementId,
          name: overrideProfile.name,
          host: overrideProfile.host,
          port: overrideProfile.port,
          useTls: overrideProfile.useTls,
          insecureSkipVerify: overrideProfile.insecureSkipVerify,
          authType: overrideProfile.authType,
          domain: overrideProfile.domain,
          username: overrideProfile.username,
          identityId: overrideProfile.identityId,
          credentialId: overrideProfile.credentialId,
          socksProxyAddr: overrideProfile.socksProxyAddr,
        }
        : {
          profileId: editingId || undefined,
          hostId: hostId || undefined,
          engagementId: scopeToEngagement && activeEngagementId ? activeEngagementId : undefined,
          name: name.trim() || undefined,
          host: host.trim(),
          port,
          useTls,
          insecureSkipVerify,
          authType,
          domain: domain.trim() || undefined,
          username: username.trim() || undefined,
          password: password || undefined,
          ntHash: ntHash.trim() || undefined,
          identityId: identityId || undefined,
          credentialId: credentialId || undefined,
          socksProxyAddr: socksProxyAddr.trim() || undefined,
        };

      const sess = await connectSession(req);
      setPassword('');
      setNtHash('');
      await refreshData();
      setSelectedSessionId(sess.sessionId);
      setStatusMessage(`WinRM shell connected (${sess.shellId || sess.sessionId}) on ${sess.host}:${sess.port}`);
      onSessionConnected(sess);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handlePreviewCLI = async () => {
    try {
      const cmd = await buildCliCommand(buildPayloadFromForm());
      setCliPreview(cmd);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(cmd).catch(() => { });
      }
      setStatusMessage('Generated masked evil-winrm CLI command.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExecutePS = async (scriptOverride?: string) => {
    if (!activeSession) return;
    const script = (scriptOverride ?? psCommand).trim();
    if (!script) return;
    setErrorMessage('');
    setIsBusy(true);
    try {
      const res = await executeCommand(activeSession.sessionId, script);
      setExecResult(res);
      await refreshData();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!activeSession) return;
    setErrorMessage('');
    setIsBusy(true);
    try {
      const res = await uploadFile(activeSession.sessionId, uploadLocalPath.trim(), uploadRemotePath.trim());
      setTransferResult(res);
      setStatusMessage(`Uploaded ${formatBytes(res.bytes)} to ${res.remotePath} (SHA-256 verified).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!activeSession) return;
    setErrorMessage('');
    setIsBusy(true);
    try {
      const res = await downloadFile(activeSession.sessionId, downloadRemotePath.trim(), downloadLocalPath.trim());
      setTransferResult(res);
      setStatusMessage(`Downloaded ${formatBytes(res.bytes)} from ${res.remotePath} (SHA-256 verified).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisconnect = async (sid: string) => {
    setErrorMessage('');
    setIsBusy(true);
    try {
      await disconnectSession(sid);
      await refreshData();
      setStatusMessage(`Closed WinRM session ${sid}.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const content = (
    <div
      className="cyber-modal-content"
      style={
        isEmbedded
          ? {
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            maxHeight: 'none',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 0,
            border: 'none',
          }
          : {
            width: 'min(1200px, 95vw)',
            height: 'min(840px, 90vh)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }
      }
    >
      {/* Header */}
      <div
        className="cyber-modal-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          padding: '0.75rem 1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: 'rgba(56, 189, 248, 0.14)',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
            }}
          >
            <CyberIcon name="terminal" size={17} />
          </div>
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.06em', color: '#e2e8f0' }}>
              WINRM // POWERSHELL REMOTING CLIENT
            </div>
            <div style={{ fontSize: '0.68rem', color: '#64748b', letterSpacing: '0.05em' }}>
              PURE-GO WS-MANAGEMENT · EVIL-WINRM PARITY SHELL · NTLMv2 / PASS-THE-HASH / BASIC
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {tools.map((t) => (
            <span
              key={t.tool}
              title={t.found ? t.path : `${t.tool} not found on PATH (native WS-Man active)`}
              style={{
                fontSize: '0.67rem',
                padding: '0.18rem 0.5rem',
                borderRadius: 4,
                border: `1px solid ${t.found ? 'rgba(16, 185, 129, 0.45)' : 'rgba(100, 116, 139, 0.35)'}`,
                background: t.found ? 'rgba(16, 185, 129, 0.12)' : 'rgba(15, 23, 42, 0.5)',
                color: t.found ? '#34d399' : '#94a3b8',
              }}
            >
              {t.tool}: {t.found ? 'READY' : 'NATIVE WS-MAN'}
            </span>
          ))}
          {!isEmbedded && onPinToTab && (
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.7rem' }}
              onClick={onPinToTab}
              title="Open WinRM Manager as a full Workspace View tab"
            >
              <CyberIcon name="pin" size={12} />
              <span>Pin View</span>
            </button>
          )}
          {isEmbedded && onPopOutModal && (
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.7rem' }}
              onClick={onPopOutModal}
              title="Pop out as overlay modal"
            >
              <CyberIcon name="undock" size={12} />
              <span>Pop Out</span>
            </button>
          )}
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label={isEmbedded ? 'Close WinRM View' : 'Close WinRM Client'}
            title={isEmbedded ? 'Close WinRM View' : 'Close WinRM Client'}
          >
            <CyberIcon name="close" size={14} />
          </button>
        </div>
      </div>

      {(errorMessage || statusMessage) && (
        <div style={{ padding: '0 1rem', marginTop: '0.45rem' }}>
          {errorMessage && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#fca5a5',
                padding: '0.45rem 0.65rem',
                borderRadius: 4,
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <CyberIcon name="warning" size={13} />
              <span>{errorMessage}</span>
            </div>
          )}
          {statusMessage && !errorMessage && (
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.10)',
                border: '1px solid rgba(56, 189, 248, 0.38)',
                color: '#bae6fd',
                padding: '0.42rem 0.65rem',
                borderRadius: 4,
                fontSize: '0.74rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <CyberIcon name="check" size={13} />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* Split Body */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(370px, 430px) 1fr',
          gap: '0.85rem',
          padding: '0.75rem 1rem 1rem',
          overflow: 'hidden',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left Panel: Connection Builder + Vault Profiles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', paddingRight: '0.2rem' }}>
          <div className="cyber-hud-panel" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.06em' }}>
                {editingId ? 'EDIT WINRM TARGET PROFILE' : 'NEW WINRM / PSREMOTING TARGET'}
              </span>
              {activeEngagementId && (
                <div
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                  title="Choose whether saving this target binds it strictly to the active engagement (.daeng isolated) or saves it globally across engagements."
                >
                  <span style={{ fontSize: '0.66rem', color: '#94a3b8' }}>Save Scope:</span>
                  <button
                    type="button"
                    className={`cyber-pill-btn ${scopeToEngagement ? 'active' : ''}`}
                    style={{ padding: '2px 7px', fontSize: '0.65rem' }}
                    onClick={() => setScopeToEngagement(true)}
                  >
                    {activeEngagementName || 'Engagement'}
                  </button>
                  <button
                    type="button"
                    className={`cyber-pill-btn ${!scopeToEngagement ? 'active' : ''}`}
                    style={{ padding: '2px 7px', fontSize: '0.65rem' }}
                    onClick={() => setScopeToEngagement(false)}
                  >
                    Global
                  </button>
                </div>
              )}
            </div>

            {hosts.length > 0 && (
              <select
                aria-label="Fill from Vault Host"
                className="cyber-select"
                value={hostId}
                onChange={(e) => handleSelectHost(e.target.value)}
              >
                <option value="">-- Fill target from Vault Host (optional) --</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label} ({h.address})
                  </option>
                ))}
              </select>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: '0.45rem' }}>
              <input
                aria-label="Target Host or FQDN"
                className="cyber-input"
                placeholder="Target IP or FQDN (e.g. dc01.corp.local)"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
              <input
                aria-label="WinRM Port"
                className="cyber-input"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || 5985)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.74rem', color: '#e2e8f0', cursor: 'pointer' }}>
                <input type="checkbox" checked={useTls} onChange={(e) => handleToggleTls(e.target.checked)} />
                <span>Use HTTPS (TLS 5986)</span>
              </label>
              {useTls && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#fbbf24', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={insecureSkipVerify}
                    onChange={(e) => setInsecureSkipVerify(e.target.checked)}
                  />
                  <span>Skip Cert Verify</span>
                </label>
              )}
            </div>

            {/* Auth Type Selector */}
            <div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: '0.25rem' }}>AUTHENTICATION MECHANISM</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.3rem' }}>
                {AUTH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.hint}
                    className={`cyber-pill-btn ${authType === opt.value ? 'active' : ''}`}
                    onClick={() => setAuthType(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Vault Credential / Identity Binding */}
            {(credentials.length > 0 || identities.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                <select
                  aria-label="Bind Engagement Credential"
                  className="cyber-select"
                  value={credentialId}
                  onChange={(e) => handleSelectCredential(e.target.value)}
                >
                  <option value="">-- Vault Credential --</option>
                  {credentials.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.realm ? `${c.realm}\\` : ''}{c.username})
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Bind Vault Identity"
                  className="cyber-select"
                  value={identityId}
                  onChange={(e) => setIdentityId(e.target.value)}
                >
                  <option value="">-- Vault Identity --</option>
                  {identities.map((idn) => (
                    <option key={idn.id} value={idn.id}>
                      {idn.label} ({idn.username})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '115px 1fr', gap: '0.4rem' }}>
              <input
                aria-label="Domain"
                className="cyber-input"
                placeholder="Domain (CORP)"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
              <input
                aria-label="Username"
                className="cyber-input"
                placeholder="Username (Administrator)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            {authType === 'pth' ? (
              <input
                aria-label="NT Hash"
                className="cyber-input"
                type="password"
                placeholder={
                  editingHasStoredSecret
                    ? 'Stored NT hash preserved (enter new 32-hex to override)'
                    : 'NT Hash (32 hex chars or LM:NT)'
                }
                value={ntHash}
                onChange={(e) => setNtHash(e.target.value)}
              />
            ) : (
              <input
                aria-label="Password"
                className="cyber-input"
                type="password"
                placeholder={
                  editingHasStoredSecret || credentialId || identityId
                    ? 'Vault secret bound (enter password only to override)'
                    : 'Password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <input
                aria-label="Profile Name"
                className="cyber-input"
                placeholder="Profile Name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                aria-label="SOCKS5 Proxy Address"
                className="cyber-input"
                list="winrm-socks-candidates"
                placeholder="SOCKS5 (e.g. 127.0.0.1:1080)"
                value={socksProxyAddr}
                onChange={(e) => setSocksProxyAddr(e.target.value)}
              />
              <datalist id="winrm-socks-candidates">
                {socksCandidates.map((sc) => (
                  <option key={sc.id} value={sc.addr}>
                    {sc.label}
                  </option>
                ))}
              </datalist>
            </div>

            {liveOpsecWarnings.length > 0 && (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  borderRadius: 4,
                  padding: '0.4rem 0.55rem',
                  fontSize: '0.69rem',
                  color: '#fcd34d',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.2rem',
                }}
              >
                {liveOpsecWarnings.map((w, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                    <CyberIcon name="warning" size={12} style={{ marginTop: 2 }} />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="cyber-btn"
                disabled={isBusy || !host.trim()}
                onClick={() => void handleConnect()}
                style={{ flex: 1 }}
              >
                <CyberIcon name="play" size={13} />
                <span>{isBusy ? 'Connecting...' : 'Connect & Open Shell'}</span>
              </button>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                disabled={isBusy || !host.trim()}
                onClick={() => void handleSaveProfile()}
              >
                <CyberIcon name="save" size={13} />
                <span>Save</span>
              </button>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                disabled={isBusy}
                onClick={() => void handlePreviewCLI()}
                title="Generate masked evil-winrm CLI command"
              >
                <CyberIcon name="copy" size={13} />
                <span>CLI</span>
              </button>
              {editingId && (
                <button type="button" className="cyber-btn cyber-btn-secondary" onClick={resetForm}>
                  New
                </button>
              )}
            </div>

            {cliPreview && (
              <code
                style={{
                  display: 'block',
                  fontSize: '0.7rem',
                  background: 'rgba(2, 6, 23, 0.7)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: 4,
                  padding: '0.35rem 0.5rem',
                  color: '#7dd3fc',
                  wordBreak: 'break-all',
                }}
              >
                {cliPreview}
              </code>
            )}
          </div>

          {/* Saved Vault Profiles */}
          <div className="cyber-hud-panel" style={{ padding: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em' }}>
                SAVED WINRM PROFILES ({filteredProfiles.length})
              </span>
              {activeEngagementId && (
                <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                  <button
                    type="button"
                    className={`cyber-pill-btn ${profileListFilter === 'scoped' ? 'active' : ''}`}
                    style={{ padding: '1px 6px', fontSize: '0.64rem' }}
                    onClick={() => setProfileListFilter('scoped')}
                  >
                    Engagement
                  </button>
                  <button
                    type="button"
                    className={`cyber-pill-btn ${profileListFilter === 'all' ? 'active' : ''}`}
                    style={{ padding: '1px 6px', fontSize: '0.64rem' }}
                    onClick={() => setProfileListFilter('all')}
                  >
                    All
                  </button>
                </div>
              )}
            </div>

            {filteredProfiles.length === 0 ? (
              <div style={{ fontSize: '0.73rem', color: '#64748b', padding: '0.5rem 0' }}>
                No saved WinRM targets in this scope yet. Save a target above for 1-click reconnect.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {filteredProfiles.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      border: '1px solid rgba(56, 189, 248, 0.22)',
                      background: 'rgba(15, 23, 42, 0.55)',
                      borderRadius: 5,
                      padding: '0.48rem 0.6rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: '0.69rem', color: '#94a3b8', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span>{p.useTls ? 'HTTPS' : 'HTTP'}://{p.host}:{p.port}</span>
                        <span>{String(p.authType).toUpperCase()}</span>
                        <span>{p.domain ? `${p.domain}\\${p.username}` : p.username || '(vault secret)'}</span>
                        {(p.hasPassword || p.hasNtHash) && <span style={{ color: '#34d399' }}>[SECRET STORED]</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                      <button
                        type="button"
                        className="cyber-btn"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.68rem' }}
                        onClick={() => void handleConnect(p)}
                        disabled={isBusy}
                        title="Connect WinRM Shell"
                      >
                        <CyberIcon name="play" size={11} />
                      </button>
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-secondary"
                        style={{ padding: '0.25rem 0.45rem', fontSize: '0.68rem' }}
                        onClick={() => handleLoadProfile(p)}
                        title="Load into Editor"
                      >
                        <CyberIcon name="edit" size={11} />
                      </button>
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-secondary"
                        style={{ padding: '0.25rem 0.45rem', fontSize: '0.68rem', color: '#f87171' }}
                        onClick={() => void handleDeleteProfile(p.id)}
                        title="Delete Profile"
                      >
                        <CyberIcon name="trash" size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Active Sessions + PowerShell Runner + Bidirectional Transfer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', minHeight: 0 }}>
          {/* Active Sessions */}
          <div className="cyber-hud-panel" style={{ padding: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2dd4bf', letterSpacing: '0.06em' }}>
                ACTIVE WINRM SESSIONS ({sessions.length})
              </span>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                style={{ padding: '0.22rem 0.55rem', fontSize: '0.68rem' }}
                onClick={() => void refreshData()}
              >
                Refresh
              </button>
            </div>

            {sessions.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '0.45rem 0' }}>
                No live WinRM shells open. Connect a target on the left to launch an interactive Evil-WinRM parity terminal tab and enable structured command execution / file transfers here.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                {sessions.map((s) => {
                  const selected = activeSession?.sessionId === s.sessionId;
                  return (
                    <div
                      key={s.sessionId}
                      onClick={() => setSelectedSessionId(s.sessionId)}
                      style={{
                        cursor: 'pointer',
                        borderRadius: 5,
                        padding: '0.45rem 0.6rem',
                        border: `1px solid ${selected ? 'rgba(56, 189, 248, 0.7)' : 'rgba(100, 116, 139, 0.35)'}`,
                        background: selected ? 'rgba(56, 189, 248, 0.14)' : 'rgba(15, 23, 42, 0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.55rem',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#e2e8f0' }}>
                          {s.name} ({s.host}:{s.port})
                        </div>
                        <div style={{ fontSize: '0.67rem', color: '#94a3b8' }}>
                          ShellId: {s.shellId || 'active'} · {s.currentDir || 'C:\\'} · Cmds: {s.commandCount}
                        </div>
                      </div>
                      {onFocusSession && (
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary"
                          style={{ padding: '0.2rem 0.45rem', fontSize: '0.66rem' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onFocusSession(s.sessionId);
                            onClose();
                          }}
                        >
                          Terminal
                        </button>
                      )}
                      <button
                        type="button"
                        className="cyber-btn cyber-btn-secondary"
                        style={{ padding: '0.2rem 0.45rem', fontSize: '0.66rem', color: '#f87171' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDisconnect(s.sessionId);
                        }}
                      >
                        Close
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Structured PowerShell Runner & Evil-WinRM Parity Helpers */}
          <div className="cyber-hud-panel" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.06em' }}>
                POWERSHELL EXECUTION &amp; EVIL-WINRM PARITY HELPERS
              </span>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {[
                  { label: 'whoami /all', cmd: 'whoami /all' },
                  { label: 'sysinfo', cmd: 'systeminfo' },
                  { label: 'services', cmd: 'Get-CimInstance Win32_Service | Select Name,State,PathName | Format-Table -AutoSize' },
                  { label: 'netuser', cmd: 'net user' },
                  { label: 'ipconfig /all', cmd: 'ipconfig /all' },
                  { label: 'netstat -ano', cmd: 'netstat -ano' },
                  { label: 'env', cmd: 'Get-ChildItem Env: | Format-Table -AutoSize' },
                  { label: 'Bypass-4MSI', cmd: 'Write-Output "[*] Active PowerShell host: $PSVersionTable.PSVersion · LanguageMode: $($ExecutionContext.SessionState.LanguageMode)"' },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={`cyber-pill-btn ${psCommand.trim() === preset.cmd ? 'active' : ''}`}
                    disabled={isBusy}
                    title={
                      activeSession
                        ? `Execute ${preset.label} in active WinRM session`
                        : `Load "${preset.cmd}" into command box (connect a WinRM session above to execute)`
                    }
                    onClick={() => {
                      setPsCommand(preset.cmd);
                      if (activeSession) {
                        void handleExecutePS(preset.cmd);
                      } else {
                        setStatusMessage(`Loaded "${preset.label}" into PowerShell runner — connect or select a WinRM session above to execute.`);
                      }
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.45rem' }}>
              <input
                aria-label="PowerShell Command Input"
                className="cyber-input"
                placeholder="Enter PowerShell command or script block..."
                value={psCommand}
                onChange={(e) => setPsCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && activeSession && !isBusy) {
                    void handleExecutePS();
                  }
                }}
              />
              <button
                type="button"
                className="cyber-btn"
                disabled={!activeSession || isBusy || !psCommand.trim()}
                onClick={() => void handleExecutePS()}
              >
                <CyberIcon name="bolt" size={13} />
                <span>Execute</span>
              </button>
            </div>

            {execResult && (
              <div
                style={{
                  background: 'rgba(2, 6, 23, 0.8)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: 5,
                  padding: '0.55rem',
                  fontFamily: 'monospace',
                  fontSize: '0.73rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: '0.3rem', fontSize: '0.67rem' }}>
                  <span>CMD: {execResult.command}</span>
                  <span>
                    Exit: {execResult.exitCode} · {execResult.durationMs}ms
                  </span>
                </div>
                {execResult.stdout && (
                  <pre style={{ margin: 0, color: '#e2e8f0', whiteSpace: 'pre-wrap', maxHeight: 190, overflowY: 'auto' }}>
                    {execResult.stdout}
                  </pre>
                )}
                {execResult.stderr && (
                  <pre style={{ margin: '0.35rem 0 0', color: '#f87171', whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>
                    {execResult.stderr}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Bidirectional File Transfer */}
          <div className="cyber-hud-panel" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa', letterSpacing: '0.06em' }}>
              BIDIRECTIONAL BASE64 FILE TRANSFER (SHA-256 VERIFIED)
            </span>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              {/* Upload */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ fontSize: '0.69rem', color: '#cbd5e1', fontWeight: 600 }}>UPLOAD TO TARGET</div>
                <input
                  aria-label="Upload Local Path"
                  className="cyber-input"
                  placeholder="Local file path (e.g. C:\tools\winPEAS.exe)"
                  value={uploadLocalPath}
                  onChange={(e) => setUploadLocalPath(e.target.value)}
                />
                <input
                  aria-label="Upload Remote Path"
                  className="cyber-input"
                  placeholder="Remote path (e.g. C:\Windows\Temp\wp.exe)"
                  value={uploadRemotePath}
                  onChange={(e) => setUploadRemotePath(e.target.value)}
                />
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  disabled={!activeSession || isBusy || !uploadLocalPath.trim() || !uploadRemotePath.trim()}
                  onClick={() => void handleUpload()}
                >
                  <CyberIcon name="upload" size={13} />
                  <span>Upload File</span>
                </button>
              </div>

              {/* Download */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ fontSize: '0.69rem', color: '#cbd5e1', fontWeight: 600 }}>DOWNLOAD FROM TARGET</div>
                <input
                  aria-label="Download Remote Path"
                  className="cyber-input"
                  placeholder="Remote path (e.g. C:\Users\Admin\Desktop\flag.txt)"
                  value={downloadRemotePath}
                  onChange={(e) => setDownloadRemotePath(e.target.value)}
                />
                <input
                  aria-label="Download Local Path"
                  className="cyber-input"
                  placeholder="Local save path (e.g. C:\loot\flag.txt)"
                  value={downloadLocalPath}
                  onChange={(e) => setDownloadLocalPath(e.target.value)}
                />
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  disabled={!activeSession || isBusy || !downloadRemotePath.trim() || !downloadLocalPath.trim()}
                  onClick={() => void handleDownload()}
                >
                  <CyberIcon name="download" size={13} />
                  <span>Download File</span>
                </button>
              </div>
            </div>

            {transferResult && (
              <div
                style={{
                  background: 'rgba(167, 139, 250, 0.08)',
                  border: '1px solid rgba(167, 139, 250, 0.35)',
                  borderRadius: 4,
                  padding: '0.45rem 0.6rem',
                  fontSize: '0.71rem',
                  color: '#ddd6fe',
                }}
              >
                <strong>{transferResult.direction.toUpperCase()}</strong> · {formatBytes(transferResult.bytes)} in{' '}
                {transferResult.durationMs}ms · SHA-256: <code>{transferResult.sha256}</code>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (isEmbedded) {
    return content;
  }

  return (
    <div
      className="cyber-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="WinRM PowerShell Remoting Client"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {content}
    </div>
  );
};
