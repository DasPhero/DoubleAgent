import React, { useState, useEffect } from 'react';
import { ProxychainsExportOptions, ProxychainsProxyEntry, ProxychainsChainType } from '../types/proxy';

export interface ProxychainsExportModalProps {
  initialOptions?: ProxychainsExportOptions;
  onGenerateConfig: (opts: ProxychainsExportOptions) => Promise<string>;
  onSaveToFile?: (content: string, targetPath: string) => Promise<void>;
  onClose: () => void;
}

export function ProxychainsExportModal({
  initialOptions,
  onGenerateConfig,
  onSaveToFile,
  onClose,
}: ProxychainsExportModalProps): React.JSX.Element {
  const [chainType, setChainType] = useState<ProxychainsChainType>(initialOptions?.chainType || 'strict_chain');
  const [proxyDNS, setProxyDNS] = useState<boolean>(initialOptions?.proxyDNS !== false);
  const [quietMode, setQuietMode] = useState<boolean>(initialOptions?.quietMode || false);
  const [tcpReadTimeout, setTcpReadTimeout] = useState<number>(initialOptions?.tcpReadTimeout || 15000);
  const [tcpConnectTimeout, setTcpConnectTimeout] = useState<number>(initialOptions?.tcpConnectTimeout || 8000);
  const [proxies, setProxies] = useState<ProxychainsProxyEntry[]>(
    initialOptions?.proxies && initialOptions.proxies.length > 0
      ? initialOptions.proxies
      : [{ type: 'socks5', host: '127.0.0.1', port: 1080, comment: 'DoubleAgent SOCKS5' }]
  );

  const [generatedConfig, setGeneratedConfig] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // New proxy form states
  const [newType, setNewType] = useState<string>('socks5');
  const [newHost, setNewHost] = useState<string>('127.0.0.1');
  const [newPort, setNewPort] = useState<string>('1080');
  const [newUser, setNewUser] = useState<string>('');
  const [newPass, setNewPass] = useState<string>('');
  const [newComment, setNewComment] = useState<string>('');

  // Re-generate config whenever options change
  useEffect(() => {
    let active = true;
    const opts: ProxychainsExportOptions = {
      chainType,
      proxyDNS,
      quietMode,
      tcpReadTimeout,
      tcpConnectTimeout,
      proxies,
    };
    onGenerateConfig(opts)
      .then((cfg) => {
        if (active) setGeneratedConfig(cfg);
      })
      .catch((err) => {
        if (active) setGeneratedConfig(`# Error generating config: ${err}`);
      });
    return () => {
      active = false;
    };
  }, [chainType, proxyDNS, quietMode, tcpReadTimeout, tcpConnectTimeout, proxies, onGenerateConfig]);

  const handleAddProxy = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(newPort, 10);
    if (!newHost.trim() || isNaN(portNum) || portNum < 1 || portNum > 65535) return;
    setProxies([
      ...proxies,
      {
        type: newType,
        host: newHost.trim(),
        port: portNum,
        username: newUser.trim() || undefined,
        password: newPass.trim() || undefined,
        comment: newComment.trim() || undefined,
      },
    ]);
    setNewHost('127.0.0.1');
    setNewPort('1080');
    setNewUser('');
    setNewPass('');
    setNewComment('');
  };

  const handleRemoveProxy = (index: number) => {
    setProxies(proxies.filter((_, i) => i !== index));
  };

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedConfig);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  const handleDownloadFile = () => {
    const blob = new Blob([generatedConfig], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proxychains.conf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveToDisk = async () => {
    if (!onSaveToFile) return;
    setIsSaving(true);
    setSaveStatus('');
    try {
      await onSaveToFile(generatedConfig, '');
      setSaveStatus('Saved to proxychains.conf successfully!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err: unknown) {
      setSaveStatus(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 100020 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card proxychains-modal"
        style={{
          width: '940px',
          maxWidth: '96vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7)',
          border: '1px solid var(--accent)',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>⛓️</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-bright)' }}>
                Export proxychains.conf
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                RFC-compliant configuration for proxychains and proxychains-ng (F-14)
              </p>
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: '4px 10px', fontSize: '0.9rem' }}
          >
            ✕
          </button>
        </div>

        {/* Body (2 columns: left settings, right preview) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.1fr 1.3fr',
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {/* Left Column: Options & Proxy List */}
          <div
            style={{
              padding: '20px',
              overflowY: 'auto',
              borderRight: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: 'var(--text-bright)',
                }}
              >
                Chaining Mode
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {(
                  [
                    { id: 'strict_chain', label: 'Strict Chain', desc: 'All proxies in exact order' },
                    { id: 'dynamic_chain', label: 'Dynamic Chain', desc: 'Skip dead proxies' },
                    { id: 'random_chain', label: 'Random Chain', desc: 'Random proxy order' },
                    { id: 'round_robin_chain', label: 'Round Robin', desc: 'Rotate through list' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={`btn ${chainType === mode.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setChainType(mode.id)}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{mode.label}</span>
                    <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{mode.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div style={{ display: 'flex', gap: '20px', background: 'var(--bg-tertiary)', padding: '10px 14px', borderRadius: '6px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={proxyDNS}
                  onChange={(e) => setProxyDNS(e.target.checked)}
                />
                <span><strong>proxy_dns</strong> (prevent DNS leaks)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={quietMode}
                  onChange={(e) => setQuietMode(e.target.checked)}
                />
                <span><strong>quiet_mode</strong></span>
              </label>
            </div>

            {/* Timeouts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  TCP Read Timeout (ms)
                </label>
                <input
                  type="number"
                  className="input"
                  value={tcpReadTimeout}
                  onChange={(e) => setTcpReadTimeout(Math.max(100, parseInt(e.target.value, 10) || 15000))}
                  style={{ width: '100%', padding: '6px 10px', fontSize: '0.85rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  TCP Connect Timeout (ms)
                </label>
                <input
                  type="number"
                  className="input"
                  value={tcpConnectTimeout}
                  onChange={(e) => setTcpConnectTimeout(Math.max(100, parseInt(e.target.value, 10) || 8000))}
                  style={{ width: '100%', padding: '6px 10px', fontSize: '0.85rem' }}
                />
              </div>
            </div>

            {/* Proxy Table */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-bright)' }}>
                  Proxy Chain List ({proxies.length})
                </label>
              </div>
              <div
                style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--bg-primary)',
                }}
              >
                {proxies.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    No proxies in chain. Add one below.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                        <th style={{ padding: '6px 10px' }}>Type</th>
                        <th style={{ padding: '6px 10px' }}>Address</th>
                        <th style={{ padding: '6px 10px' }}>Auth</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proxies.map((p, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: 'var(--accent)' }}>{p.type}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>
                            {p.host}:{p.port}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>
                            {p.username ? p.username : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => handleRemoveProxy(idx)}
                              style={{ padding: '2px 6px', fontSize: '0.75rem', color: '#f87171' }}
                              title="Remove Hop"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Quick Add Proxy Hop */}
            <form
              onSubmit={handleAddProxy}
              style={{
                background: 'var(--bg-secondary)',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '8px', color: 'var(--text-bright)' }}>
                + Add Proxy Hop to Chain
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 80px', gap: '8px', marginBottom: '8px' }}>
                <select
                  className="input"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  style={{ padding: '4px 6px', fontSize: '0.8rem' }}
                >
                  <option value="socks5">socks5</option>
                  <option value="socks4">socks4</option>
                  <option value="http">http</option>
                </select>
                <input
                  type="text"
                  placeholder="Host / IP"
                  className="input"
                  value={newHost}
                  onChange={(e) => setNewHost(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                />
                <input
                  type="number"
                  placeholder="Port"
                  className="input"
                  value={newPort}
                  onChange={(e) => setNewPort(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 70px', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Username (optional)"
                  className="input"
                  value={newUser}
                  onChange={(e) => setNewUser(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                />
                <input
                  type="password"
                  placeholder="Password (optional)"
                  className="input"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                >
                  Add
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Live Config Preview & Actions */}
          <div
            style={{
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-primary)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-bright)' }}>
                Generated proxychains.conf Preview
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {proxies.length} hop{proxies.length === 1 ? '' : 's'} configured
              </span>
            </div>

            <pre
              style={{
                flex: 1,
                margin: 0,
                padding: '14px',
                borderRadius: '6px',
                background: '#0d1117',
                border: '1px solid var(--border-color)',
                fontFamily: 'Consolas, "Fira Code", monospace',
                fontSize: '0.82rem',
                color: '#e6edf3',
                overflowY: 'auto',
                lineHeight: 1.45,
                whiteSpace: 'pre',
              }}
            >
              {generatedConfig}
            </pre>

            {saveStatus && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  background: saveStatus.includes('successfully') ? 'rgba(45, 212, 191, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: saveStatus.includes('successfully') ? 'var(--accent-bright)' : '#f87171',
                }}
              >
                {saveStatus}
              </div>
            )}

            {/* Action Bar */}
            <div
              style={{
                marginTop: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCopyToClipboard}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>{copied ? '✓ Copied!' : '📋 Copy to Clipboard'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleDownloadFile}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>⬇️ Download .conf</span>
                </button>
              </div>

              {onSaveToFile && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleSaveToDisk}
                  disabled={isSaving}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>{isSaving ? 'Saving...' : '💾 Save to Disk'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
