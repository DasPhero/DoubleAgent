import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileServerKind,
  FileTransferServerConfig,
  FileTransferServerInfo,
  HostedFileEntry,
  NetworkInterfaceIP,
  FileTransferCommandOptions,
  FileTransferCommandSet,
  TargetTransferMethod,
} from '../types/fileTransfer';
import { CyberIcon } from './CyberIcon';

export interface FileTransferModalProps {
  isOpen?: boolean;
  onClose: () => void;
  activeSessionId?: string | null;
  activeHostAddress?: string | null;
  onSendToTerminal?: (sessionId: string, text: string) => void;
  onSpawnLocalTerminal?: (initialCommand: string) => void;
  // Wails Bindings
  getDefaultDir: () => Promise<string>;
  getLocalIPs: () => Promise<NetworkInterfaceIP[]>;
  listServers: () => Promise<FileTransferServerInfo[]>;
  startServer: (cfg: FileTransferServerConfig) => Promise<FileTransferServerInfo>;
  stopServer: (serverId: string) => Promise<void>;
  generateServerCommand: (cfg: FileTransferServerConfig) => Promise<string>;
  listFiles: (dir: string) => Promise<HostedFileEntry[]>;
  hashFile: (rootDir: string, relPath: string) => Promise<HostedFileEntry>;
  generateCommands: (opts: FileTransferCommandOptions) => Promise<FileTransferCommandSet>;
  onSelectDirectory?: (title: string) => Promise<string>;
}

const SERVER_ENGINES: { id: FileServerKind; label: string; desc: string }[] = [
  { id: 'builtin', label: 'Built-in Go HTTP', desc: 'Native HTTP staging + POST/PUT /upload catcher' },
  { id: 'python3', label: 'Python 3', desc: 'python3 -m http.server' },
  { id: 'updog', label: 'Updog', desc: 'HTTP/HTTPS file server with upload UI' },
  { id: 'impacket-smb', label: 'Impacket SMB', desc: 'TCP/445 share for Windows/smbclient' },
  { id: 'php', label: 'PHP Built-in', desc: 'php -S <addr>:<port>' },
];

const QUICK_PORTS = [
  { port: 80, label: '80 HTTP' },
  { port: 443, label: '443 HTTPS' },
  { port: 8000, label: '8000 PY' },
  { port: 8080, label: '8080 ALT' },
  { port: 8443, label: '8443 TLS' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const FileTransferModal: React.FC<FileTransferModalProps> = ({
  isOpen = true,
  onClose,
  activeSessionId,
  onSendToTerminal,
  onSpawnLocalTerminal,
  getDefaultDir,
  getLocalIPs,
  listServers,
  startServer,
  stopServer,
  generateServerCommand,
  listFiles,
  hashFile,
  generateCommands,
  onSelectDirectory,
}) => {
  // Server configuration state
  const [serverKind, setServerKind] = useState<FileServerKind>('builtin');
  const [directory, setDirectory] = useState<string>('');
  const [bindAddress, setBindAddress] = useState<string>('0.0.0.0');
  const [port, setPort] = useState<number>(8000);
  const [enableUpload, setEnableUpload] = useState<boolean>(true);
  const [useTLS, setUseTLS] = useState<boolean>(false);
  const [shareName, setShareName] = useState<string>('share');
  const [basicAuthUser, setBasicAuthUser] = useState<string>('');
  const [basicAuthPassword, setBasicAuthPassword] = useState<string>('');
  const [externalServerCmd, setExternalServerCmd] = useState<string>('');

  // Telemetry & directory files
  const [activeServers, setActiveServers] = useState<FileTransferServerInfo[]>([]);
  const [localIPs, setLocalIPs] = useState<NetworkInterfaceIP[]>([]);
  const [hostedFiles, setHostedFiles] = useState<HostedFileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);

  // Selected target command generator state
  const [selectedFilename, setSelectedFilename] = useState<string>('linpeas.sh');
  const [localIP, setLocalIP] = useState<string>('10.10.14.1');
  const [targetOS, setTargetOS] = useState<'all' | 'linux' | 'windows' | 'macos'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'download' | 'verify' | 'upload' | 'memory'>('all');
  const [targetDestDir, setTargetDestDir] = useState<string>('');
  const [uploadFilePath, setUploadFilePath] = useState<string>('/etc/shadow');
  const [selectedHashes, setSelectedHashes] = useState<{ filename: string; sha256: string; md5: string; size?: number } | null>(null);
  const [hashingFile, setHashingFile] = useState<string>('');
  const [commandSet, setCommandSet] = useState<FileTransferCommandSet | null>(null);

  // Feedback
  const [error, setError] = useState<string>('');
  const [infoMessage, setInfoMessage] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const flashInfo = (msg: string) => {
    setInfoMessage(msg);
    setTimeout(() => setCopiedId((c) => c), 0);
    setTimeout(() => {
      setInfoMessage((curr) => (curr === msg ? '' : curr));
    }, 3200);
  };

  const refreshServers = useCallback(async () => {
    try {
      const list = await listServers();
      setActiveServers(list || []);
    } catch {
      // Ignore transient poll errors
    }
  }, [listServers]);

  const refreshDirectoryFiles = useCallback(
    async (dirPath: string) => {
      const clean = dirPath.trim();
      if (!clean) {
        setHostedFiles([]);
        return;
      }
      setLoadingFiles(true);
      try {
        const files = await listFiles(clean);
        setHostedFiles(files || []);
      } catch (err: unknown) {
        setHostedFiles([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingFiles(false);
      }
    },
    [listFiles]
  );

  // Initial load: default directory, detected IPs, active servers
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    void (async () => {
      try {
        const [defDir, ips, srvs] = await Promise.all([
          getDefaultDir().catch(() => ''),
          getLocalIPs().catch(() => []),
          listServers().catch(() => []),
        ]);
        if (!mounted) return;
        const resolvedDir = defDir || '.';
        setDirectory((prev) => prev || resolvedDir);
        setLocalIPs(ips || []);
        if (ips && ips.length > 0) {
          const vpn = ips.find((i) => i.isVpn) || ips[0];
          setLocalIP(vpn.ip);
        }
        setActiveServers(srvs || []);
        if (resolvedDir) {
          await refreshDirectoryFiles(resolvedDir);
        }
      } catch {
        // Ignore initial failures gracefully
      }
    })();

    const poll = setInterval(() => {
      void refreshServers();
    }, 2200);

    return () => {
      mounted = false;
      clearInterval(poll);
    };
  }, [isOpen, getDefaultDir, getLocalIPs, listServers, refreshServers, refreshDirectoryFiles]);

  // Update external server CLI preview when config changes
  useEffect(() => {
    let mounted = true;
    const cfg: FileTransferServerConfig = {
      id: '',
      name: `Staging ${serverKind}`,
      kind: serverKind,
      directory: directory || '.',
      bindAddress: bindAddress || '0.0.0.0',
      port: Number(port) || 8000,
      enableUpload,
      useTLS,
      shareName,
      basicAuthUser,
      basicAuthPassword,
    };
    void generateServerCommand(cfg)
      .then((cmd) => {
        if (mounted) setExternalServerCmd(cmd);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [serverKind, directory, bindAddress, port, enableUpload, useTLS, shareName, basicAuthUser, basicAuthPassword, generateServerCommand]);

  // Generate target commands live whenever options change
  useEffect(() => {
    let mounted = true;
    const activePort = Number(port) || 8000;
    const matchedHash =
      selectedHashes && selectedHashes.filename === selectedFilename ? selectedHashes : null;

    const opts: FileTransferCommandOptions = {
      filename: selectedFilename.trim() || 'linpeas.sh',
      localIp: localIP.trim() || '10.10.14.1',
      port: activePort,
      useTLS,
      targetOs: targetOS,
      targetDestDir: targetDestDir.trim() || undefined,
      shareName: shareName.trim() || 'share',
      sha256: matchedHash?.sha256,
      md5: matchedHash?.md5,
      enableUpload,
      uploadFilePath: uploadFilePath.trim() || undefined,
      basicAuthUser: basicAuthUser.trim() || undefined,
    };

    void generateCommands(opts)
      .then((res) => {
        if (mounted) setCommandSet(res);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [
    selectedFilename,
    localIP,
    port,
    useTLS,
    targetOS,
    targetDestDir,
    shareName,
    selectedHashes,
    enableUpload,
    uploadFilePath,
    basicAuthUser,
    generateCommands,
  ]);

  const handleBrowseFolder = async () => {
    try {
      const selected = onSelectDirectory
        ? await onSelectDirectory('Select Staging Directory to Serve')
        : await (
            window as unknown as {
              go?: { main?: { App?: { SelectDirectoryDialog?: (title: string) => Promise<string> } } };
            }
          ).go?.main?.App?.SelectDirectoryDialog?.('Select Staging Directory to Serve');
      if (selected && selected.trim()) {
        const clean = selected.trim();
        setDirectory(clean);
        setError('');
        await refreshDirectoryFiles(clean);
        flashInfo(`Staging directory set to ${clean}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStartBuiltinServer = async () => {
    if (!directory.trim()) {
      setError('Please select a staging directory first.');
      return;
    }
    const numPort = Number(port) || 8000;
    if (numPort < 1 || numPort > 65535) {
      setError('Port must be between 1 and 65535.');
      return;
    }

    setIsStarting(true);
    setError('');
    try {
      const started = await startServer({
        id: '',
        name: `HTTP Staging :${numPort}`,
        kind: 'builtin',
        directory: directory.trim(),
        bindAddress: bindAddress.trim() || '0.0.0.0',
        port: numPort,
        enableUpload,
        useTLS: false,
        basicAuthUser: basicAuthUser.trim() || undefined,
        basicAuthPassword: basicAuthPassword || undefined,
      });
      await refreshServers();
      flashInfo(`Built-in HTTP staging server listening on ${started.bindAddress}:${started.port}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopServer = async (srv: FileTransferServerInfo) => {
    setError('');
    try {
      await stopServer(srv.id);
      await refreshServers();
      flashInfo(`Stopped staging server "${srv.name}" (:${srv.port}).`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectAndHashFile = async (entry: HostedFileEntry) => {
    if (entry.isDir) {
      const nextDir = entry.fullPath || `${directory.replace(/[\\/]+$/, '')}/${entry.name}`;
      setDirectory(nextDir);
      await refreshDirectoryFiles(nextDir);
      return;
    }
    setSelectedFilename(entry.relPath || entry.name);
    setHashingFile(entry.relPath || entry.name);
    setError('');
    try {
      const hashed = await hashFile(directory, entry.relPath || entry.name);
      setSelectedHashes({
        filename: hashed.relPath || hashed.name,
        sha256: hashed.sha256 || '',
        md5: hashed.md5 || '',
        size: hashed.size,
      });
      flashInfo(`Computed SHA-256 & MD5 for ${hashed.name}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHashingFile('');
    }
  };

  const handleCopyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === id ? null : curr));
      }, 1800);
    } catch {
      setError('Failed to copy to clipboard.');
    }
  };

  const handleInjectOrRun = (cmd: string, execute: boolean) => {
    if (!activeSessionId || !onSendToTerminal) {
      setError('No active terminal session selected. Copy the command or open a terminal first.');
      return;
    }
    onSendToTerminal(activeSessionId, execute ? `${cmd}\n` : cmd);
    flashInfo(execute ? 'Command executed in active terminal.' : 'Command inserted into active terminal.');
  };

  const filteredMethods = useMemo(() => {
    if (!commandSet || !commandSet.methods) return [];
    if (categoryFilter === 'all') return commandSet.methods;
    return commandSet.methods.filter((m: TargetTransferMethod) => m.category === categoryFilter);
  }, [commandSet, categoryFilter]);

  const totalServed = useMemo(
    () => activeServers.reduce((acc, s) => acc + (s.servedCount || 0), 0),
    [activeServers]
  );
  const totalUploads = useMemo(
    () => activeServers.reduce((acc, s) => acc + (s.uploadCount || 0), 0),
    [activeServers]
  );

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
        aria-label="File Transfer Helper"
      >
        {/* Corner Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Cyberpunk HUD Header */}
        <div className="cyber-totp-hud-header">
          <div className="cyber-hud-title-block">
            <div className="cyber-hud-tag-line">
              <span className="cyber-hazard-stripes">///</span>
              <span className="cyber-hud-tag">OPS-TRANSFER</span>
              <span className="cyber-hud-delim">//</span>
              <span className="cyber-hud-subtag">STAGING, EXFIL &amp; INTEGRITY VERIFIER</span>
            </div>
            <h2 className="cyber-hud-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <CyberIcon name="upload" size={20} />
              <span>FILE TRANSFER HELPER // HTTP STAGING &amp; HASH CHECK</span>
            </h2>
            <div className="cyber-telemetry-strip">
              <span className="cyber-telemetry-chip chip-cyan">
                <span className="chip-dot" /> ACTIVE SERVERS: <strong>{activeServers.length}</strong>
              </span>
              <span className="cyber-telemetry-chip chip-green">
                <span className="chip-dot" /> SERVED GETS: <strong>{totalServed}</strong>
              </span>
              <span className="cyber-telemetry-chip chip-amber">
                <span className="chip-dot" /> UPLOADS CAUGHT: <strong>{totalUploads}</strong>
              </span>
              <span className="cyber-telemetry-chip chip-cyan">
                <span className="chip-dot" /> TARGET LHOST: <strong>{localIP}</strong>
              </span>
            </div>
          </div>

          <div className="cyber-hud-actions-block">
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={() => {
                void refreshServers();
                if (directory) void refreshDirectoryFiles(directory);
              }}
              title="Refresh servers and directory listing"
            >
              <CyberIcon name="radar" size={13} />
              <span>REFRESH</span>
            </button>
            <button
              type="button"
              className="cyber-btn-close"
              onClick={onClose}
              aria-label="Close File Transfer Helper"
              title="Close File Transfer Helper"
            >
              <CyberIcon name="close" size={14} />
            </button>
          </div>
        </div>

        {/* Status / Error Banners */}
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

        {/* Two-Column Body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(360px, 1fr) minmax(420px, 1.3fr)',
            gap: '1rem',
            padding: '1rem 1.25rem',
            overflow: 'hidden',
          }}
        >
          {/* LEFT COLUMN: Server Config, Running Catchers & Staged Directory */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', overflowY: 'auto', paddingRight: '4px' }}>
            {/* Server Engine Selector Card */}
            <div
              style={{
                background: 'rgba(6, 13, 26, 0.85)',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 28%, transparent)',
                borderRadius: '4px',
                padding: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.08em' }}>
                  /// 1. STAGING SERVER LAUNCHPAD
                </span>
                <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>HTTP / UPLOAD / SMB</span>
              </div>

              {/* Engine Pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {SERVER_ENGINES.map((eng) => (
                  <button
                    key={eng.id}
                    type="button"
                    className={`cyber-pill-btn ${serverKind === eng.id ? 'active' : ''}`}
                    onClick={() => {
                      setServerKind(eng.id);
                      if (eng.id === 'impacket-smb' && port === 8000) setPort(445);
                      else if (eng.id !== 'impacket-smb' && port === 445) setPort(8000);
                    }}
                    title={eng.desc}
                  >
                    {eng.label}
                  </button>
                ))}
              </div>

              {/* Directory Picker Row */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Staging Root Folder *
                </label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={directory}
                    onChange={(e) => setDirectory(e.target.value)}
                    onBlur={() => {
                      if (directory.trim()) void refreshDirectoryFiles(directory);
                    }}
                    placeholder="/opt/tools or C:\Tools"
                    aria-label="Staging Directory"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    type="button"
                    className="cyber-hud-btn btn-secondary btn-sm"
                    onClick={() => void handleBrowseFolder()}
                    title="Select staging folder"
                  >
                    <CyberIcon name="folder" size={13} />
                    <span>Browse</span>
                  </button>
                </div>
              </div>

              {/* Bind Address, Port & Options */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '0.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                    Bind Interface
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={bindAddress}
                    onChange={(e) => setBindAddress(e.target.value)}
                    aria-label="Bind Address"
                    placeholder="0.0.0.0"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                    Port
                  </label>
                  <input
                    type="number"
                    className="cyber-hud-input"
                    value={port}
                    min={1}
                    max={65535}
                    onChange={(e) => setPort(Number(e.target.value) || 8000)}
                    aria-label="Server Port"
                  />
                </div>
              </div>

              {/* Quick Port Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.66rem', color: '#64748b', marginRight: '0.2rem' }}>PORTS:</span>
                {QUICK_PORTS.map((qp) => (
                  <button
                    key={qp.port}
                    type="button"
                    className={`cyber-pill-btn ${port === qp.port ? 'active' : ''}`}
                    style={{ fontSize: '0.65rem', padding: '0.15rem 0.45rem' }}
                    onClick={() => setPort(qp.port)}
                  >
                    {qp.label}
                  </button>
                ))}
              </div>

              {/* Upload / TLS / SMB Options */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'center', fontSize: '0.75rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', color: '#cbd5e1' }}>
                  <input
                    type="checkbox"
                    checked={enableUpload}
                    onChange={(e) => setEnableUpload(e.target.checked)}
                  />
                  <span>Enable Upload Receiver (/upload)</span>
                </label>

                {serverKind !== 'builtin' && serverKind !== 'impacket-smb' && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', color: '#cbd5e1' }}>
                    <input
                      type="checkbox"
                      checked={useTLS}
                      onChange={(e) => setUseTLS(e.target.checked)}
                    />
                    <span>TLS / HTTPS</span>
                  </label>
                )}

                {serverKind === 'impacket-smb' && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Share:</span>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      value={shareName}
                      onChange={(e) => setShareName(e.target.value)}
                      style={{ width: '90px', padding: '0.2rem 0.45rem' }}
                    />
                  </div>
                )}
              </div>

              {/* Optional HTTP Basic Auth for Built-in Go Server */}
              {serverKind === 'builtin' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={basicAuthUser}
                    onChange={(e) => setBasicAuthUser(e.target.value)}
                    placeholder="Optional Basic Auth User"
                    aria-label="Basic Auth Username"
                  />
                  <input
                    type="password"
                    className="cyber-hud-input"
                    value={basicAuthPassword}
                    onChange={(e) => setBasicAuthPassword(e.target.value)}
                    placeholder="Optional Basic Auth Password"
                    aria-label="Basic Auth Password"
                  />
                </div>
              )}

              {/* Server Start or External CLI Launch Actions */}
              {serverKind === 'builtin' ? (
                <button
                  type="button"
                  className="cyber-hud-btn btn-primary"
                  disabled={isStarting}
                  onClick={() => void handleStartBuiltinServer()}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <CyberIcon name="play" size={14} />
                  <span>{isStarting ? 'Starting Server...' : `Start Native HTTP Server (:${port})`}</span>
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <div
                    style={{
                      background: '#030712',
                      border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                      padding: '0.5rem 0.65rem',
                      fontFamily: 'monospace',
                      fontSize: '0.74rem',
                      color: 'var(--accent-bright)',
                      wordBreak: 'break-all',
                      borderRadius: '3px',
                    }}
                  >
                    {externalServerCmd}
                  </div>
                  <div style={{ display: 'flex', gap: '0.45rem' }}>
                    <button
                      type="button"
                      className="cyber-hud-btn btn-secondary btn-sm"
                      onClick={() => void handleCopyText(externalServerCmd, 'ext-srv-cmd')}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      <CyberIcon name={copiedId === 'ext-srv-cmd' ? 'check' : 'copy'} size={12} />
                      <span>{copiedId === 'ext-srv-cmd' ? 'Copied' : 'Copy Server Command'}</span>
                    </button>
                    {onSpawnLocalTerminal && (
                      <button
                        type="button"
                        className="cyber-hud-btn btn-primary btn-sm"
                        onClick={() => {
                          onSpawnLocalTerminal(externalServerCmd);
                          onClose();
                        }}
                        style={{ flex: 1, justifyContent: 'center' }}
                      >
                        <CyberIcon name="terminal" size={12} />
                        <span>Run in Local Shell</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Active Built-in Servers Telemetry */}
            {activeServers.length > 0 && (
              <div
                style={{
                  background: 'rgba(6, 13, 26, 0.85)',
                  border: '1px solid rgba(16, 185, 129, 0.45)',
                  borderRadius: '4px',
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.55rem',
                }}
              >
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#10b981', letterSpacing: '0.07em' }}>
                  /// RUNNING HTTP STAGING SERVERS ({activeServers.length})
                </div>
                {activeServers.map((srv) => (
                  <div
                    key={srv.id}
                    style={{
                      background: 'rgba(4, 9, 18, 0.9)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      padding: '0.55rem 0.65rem',
                      borderRadius: '3px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#e2e8f0' }}>
                          {srv.name}{' '}
                          <span style={{ color: '#10b981', fontFamily: 'monospace' }}>
                            http://{localIP}:{srv.port}/
                          </span>
                        </div>
                        <div style={{ fontSize: '0.67rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {srv.directory} · GET: {srv.servedCount} · UP: {srv.uploadCount}
                          {srv.enableUpload ? ' · /upload ARMED' : ''}
                          {srv.hasBasicAuth ? ' · AUTH ON' : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="cyber-hud-btn btn-danger btn-sm"
                        onClick={() => void handleStopServer(srv)}
                        title="Stop server"
                      >
                        <CyberIcon name="stop" size={12} />
                        <span>Stop</span>
                      </button>
                    </div>
                    {srv.recentEvents && srv.recentEvents.length > 0 && (
                      <div
                        style={{
                          maxHeight: '78px',
                          overflowY: 'auto',
                          background: '#020617',
                          padding: '0.35rem 0.5rem',
                          fontFamily: 'monospace',
                          fontSize: '0.66rem',
                          color: '#94a3b8',
                          borderRadius: '2px',
                        }}
                      >
                        {srv.recentEvents
                          .slice(-5)
                          .reverse()
                          .map((ev, idx) => (
                            <div key={idx}>
                              <span style={{ color: ev.status >= 400 ? '#f87171' : '#34d399' }}>
                                [{ev.status}]
                              </span>{' '}
                              {ev.method} {ev.path} <CyberIcon name="arrow-left" size={14} /> {ev.remoteAddr} ({formatBytes(ev.bytes)})
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Staged Directory Files Browser */}
            <div
              style={{
                background: 'rgba(6, 13, 26, 0.85)',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                borderRadius: '4px',
                padding: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                flex: 1,
                minHeight: '160px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.07em' }}>
                  /// 2. STAGED FILES (CLICK TO TARGET &amp; HASH)
                </span>
                <button
                  type="button"
                  className="cyber-hud-btn btn-secondary btn-sm"
                  style={{ fontSize: '0.66rem', padding: '0.18rem 0.5rem' }}
                  onClick={() => void refreshDirectoryFiles(directory)}
                >
                  Reload
                </button>
              </div>

              {loadingFiles ? (
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '0.5rem 0' }}>
                  Scanning staging directory...
                </div>
              ) : hostedFiles.length === 0 ? (
                <div style={{ fontSize: '0.74rem', color: '#64748b', padding: '0.5rem 0' }}>
                  No files found in this folder, or type a custom filename on the right.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', overflowY: 'auto', maxHeight: '220px' }}>
                  {hostedFiles.map((f) => {
                    const isSelected = selectedFilename === (f.relPath || f.name);
                    return (
                      <div
                        key={f.relPath || f.name}
                        onClick={() => void handleSelectAndHashFile(f)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.38rem 0.55rem',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          background: isSelected ? 'color-mix(in srgb, var(--accent-bright) 14%, transparent)' : 'rgba(15, 23, 42, 0.65)',
                          border: isSelected ? '1px solid color-mix(in srgb, var(--accent-bright) 60%, transparent)' : '1px solid rgba(148, 163, 184, 0.15)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                          <CyberIcon name={f.isDir ? 'folder' : 'file'} size={13} />
                          <span
                            style={{
                              fontSize: '0.76rem',
                              fontFamily: 'monospace',
                              color: f.isDir ? 'var(--accent-bright)' : '#e2e8f0',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {f.name}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                            {f.isDir ? 'DIR' : formatBytes(f.size)}
                          </span>
                          {!f.isDir && (
                            <span style={{ fontSize: '0.64rem', color: 'var(--accent-bright)', fontWeight: 600 }}>
                              {hashingFile === (f.relPath || f.name) ? 'HASHING...' : 'HASH'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Target One-Liners & Integrity Hashes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflow: 'hidden' }}>
            {/* Target Parameters & LHOST Chips */}
            <div
              style={{
                background: 'rgba(6, 13, 26, 0.85)',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 28%, transparent)',
                borderRadius: '4px',
                padding: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.08em' }}>
                  /// 3. TARGET COMMAND &amp; INTEGRITY GENERATOR
                </span>
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  {(['all', 'linux', 'windows'] as const).map((osOpt) => (
                    <button
                      key={osOpt}
                      type="button"
                      className={`cyber-pill-btn ${targetOS === osOpt ? 'active' : ''}`}
                      style={{ fontSize: '0.66rem', padding: '0.16rem 0.5rem' }}
                      onClick={() => setTargetOS(osOpt)}
                    >
                      {osOpt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* LHOST Interface Quick-Picks */}
              {localIPs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.66rem', color: '#94a3b8' }}>DETECTED IPS:</span>
                  {localIPs.map((iface) => (
                    <button
                      key={`${iface.interface}-${iface.ip}`}
                      type="button"
                      className={`cyber-pill-btn ${localIP === iface.ip ? 'active' : ''}`}
                      style={{
                        fontSize: '0.67rem',
                        padding: '0.16rem 0.5rem',
                        borderColor: iface.isVpn ? 'rgba(16, 185, 129, 0.65)' : undefined,
                      }}
                      onClick={() => setLocalIP(iface.ip)}
                      title={`${iface.interface} (${iface.cidr})`}
                    >
                      {iface.interface}: {iface.ip} {iface.isVpn ? '[VPN]' : ''}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <label style={{ fontSize: '0.67rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                    Attacker LHOST IP
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={localIP}
                    onChange={(e) => setLocalIP(e.target.value)}
                    aria-label="Target LHOST IP"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <label style={{ fontSize: '0.67rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                    Staged Filename
                  </label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={selectedFilename}
                    onChange={(e) => setSelectedFilename(e.target.value)}
                    aria-label="Staged Filename"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <label style={{ fontSize: '0.67rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                    {categoryFilter === 'upload' ? 'Target Source Path (Exfil)' : 'Target Dest Folder'}
                  </label>
                  {categoryFilter === 'upload' ? (
                    <input
                      type="text"
                      className="cyber-hud-input"
                      value={uploadFilePath}
                      onChange={(e) => setUploadFilePath(e.target.value)}
                      placeholder="/etc/shadow or C:\loot.zip"
                      aria-label="Target Upload Source Path"
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        value={targetDestDir}
                        onChange={(e) => setTargetDestDir(e.target.value)}
                        placeholder=". (current dir) or /dev/shm or C:\Users\Public"
                        aria-label="Target Destination Folder"
                        style={{ width: '100%' }}
                      />
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className={`cyber-pill-btn ${targetDestDir === '.' ? 'active' : ''}`}
                          onClick={() => setTargetDestDir('.')}
                          title="Download into current working directory (.)"
                        >
                          Current (.)
                        </button>
                        <button
                          type="button"
                          className={`cyber-pill-btn ${targetDestDir === '/dev/shm' || targetDestDir === '' ? 'active' : ''}`}
                          onClick={() => setTargetDestDir('/dev/shm')}
                          title="Download into /dev/shm"
                        >
                          /dev/shm
                        </button>
                        <button
                          type="button"
                          className={`cyber-pill-btn ${targetDestDir === '/tmp' ? 'active' : ''}`}
                          onClick={() => setTargetDestDir('/tmp')}
                          title="Download into /tmp"
                        >
                          /tmp
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Computed SHA-256 / MD5 Checksum Strip */}
              {selectedHashes && selectedHashes.filename === selectedFilename && (
                <div
                  style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    padding: '0.45rem 0.65rem',
                    borderRadius: '3px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    fontSize: '0.69rem',
                    fontFamily: 'monospace',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: '#34d399', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      SHA256: {selectedHashes.sha256}
                    </span>
                    <button
                      type="button"
                      className="cyber-hud-btn btn-secondary btn-sm"
                      style={{ fontSize: '0.64rem', padding: '0.1rem 0.4rem' }}
                      onClick={() => void handleCopyText(selectedHashes.sha256, 'sha256-copy')}
                    >
                      {copiedId === 'sha256-copy' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: '#94a3b8' }}>MD5: {selectedHashes.md5}</span>
                    <button
                      type="button"
                      className="cyber-hud-btn btn-secondary btn-sm"
                      style={{ fontSize: '0.64rem', padding: '0.1rem 0.4rem' }}
                      onClick={() => void handleCopyText(selectedHashes.md5, 'md5-copy')}
                    >
                      {copiedId === 'md5-copy' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              {/* Category Filter Tabs */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {[
                  { id: 'all', label: 'All Methods' },
                  { id: 'download', label: 'Download (Disk)' },
                  { id: 'verify', label: 'Hash Verify' },
                  { id: 'upload', label: 'Upload / Exfil' },
                  { id: 'memory', label: 'Fileless / Memory' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`cyber-pill-btn ${categoryFilter === cat.id ? 'active' : ''}`}
                    style={{ fontSize: '0.68rem', padding: '0.2rem 0.55rem' }}
                    onClick={() => setCategoryFilter(cat.id as typeof categoryFilter)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* OPSEC Warnings Banner (Compact) */}
            {commandSet && commandSet.opsecWarnings && commandSet.opsecWarnings.length > 0 && (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  borderRadius: '3px',
                  padding: '0.45rem 0.7rem',
                  fontSize: '0.7rem',
                  color: '#fbbf24',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <CyberIcon name="warning" size={14} />
                <span>{commandSet.opsecWarnings[0]}</span>
              </div>
            )}

            {/* Generated Commands List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
                paddingRight: '4px',
              }}
            >
              {filteredMethods.map((method) => (
                <div
                  key={method.id}
                  style={{
                    background: 'rgba(6, 13, 26, 0.88)',
                    border: '1px solid color-mix(in srgb, var(--accent-bright) 22%, transparent)',
                    borderRadius: '4px',
                    padding: '0.65rem 0.8rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span
                        style={{
                          fontSize: '0.64rem',
                          fontWeight: 700,
                          padding: '0.1rem 0.35rem',
                          borderRadius: '2px',
                          textTransform: 'uppercase',
                          background:
                            method.targetOs === 'windows'
                              ? 'rgba(59, 130, 246, 0.18)'
                              : 'rgba(16, 185, 129, 0.18)',
                          color: method.targetOs === 'windows' ? '#60a5fa' : '#34d399',
                        }}
                      >
                        {method.targetOs}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: '0.78rem', color: '#f8fafc' }}>
                        {method.title}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '0.64rem',
                        color: '#94a3b8',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {method.category}
                    </span>
                  </div>

                  <pre
                    style={{
                      margin: 0,
                      background: '#020617',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                      padding: '0.48rem 0.6rem',
                      borderRadius: '3px',
                      fontFamily: 'monospace',
                      fontSize: '0.73rem',
                      color: 'var(--accent-bright)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {method.command}
                  </pre>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{method.notes}</span>
                    <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                      <button
                        type="button"
                        className="cyber-hud-btn btn-secondary btn-sm"
                        style={{ fontSize: '0.68rem', padding: '0.2rem 0.55rem' }}
                        onClick={() => void handleCopyText(method.command, method.id)}
                      >
                        <CyberIcon name={copiedId === method.id ? 'check' : 'copy'} size={11} />
                        <span>{copiedId === method.id ? 'Copied' : 'Copy'}</span>
                      </button>
                      {activeSessionId && onSendToTerminal && (
                        <>
                          <button
                            type="button"
                            className="cyber-hud-btn btn-secondary btn-sm"
                            style={{ fontSize: '0.68rem', padding: '0.2rem 0.55rem' }}
                            onClick={() => handleInjectOrRun(method.command, false)}
                            title="Insert command without pressing Enter"
                          >
                            <CyberIcon name="terminal" size={11} />
                            <span>Insert</span>
                          </button>
                          <button
                            type="button"
                            className="cyber-hud-btn btn-primary btn-sm"
                            style={{ fontSize: '0.68rem', padding: '0.2rem 0.55rem' }}
                            onClick={() => handleInjectOrRun(method.command, true)}
                            title="Send and execute command in active terminal"
                          >
                            <CyberIcon name="play" size={11} />
                            <span>Run</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
