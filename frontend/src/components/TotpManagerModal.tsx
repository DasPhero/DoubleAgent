import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { TotpSummary, TotpRecord, TotpCodeResponse } from '../types/totp';

export interface HostSummaryOption {
  id: string;
  label: string;
  address: string;
}

export interface TotpManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  hosts: HostSummaryOption[];
  activeSessionId?: string | null;
  onInjectCode?: (totpId: string) => Promise<void>;
  onRefreshVault?: () => Promise<void>;
}

// Access Wails runtime bindings safely
interface WailsTotpApi {
  ListTotpRecords?: () => Promise<TotpSummary[]>;
  GetAllTotpCodes?: () => Promise<TotpCodeResponse[]>;
  GetTotpCode?: (id: string) => Promise<TotpCodeResponse>;
  SaveTotpRecord?: (record: TotpRecord) => Promise<void>;
  DeleteTotpRecord?: (id: string) => Promise<void>;
  ParseOTPAuthURI?: (uri: string) => Promise<TotpRecord>;
  InjectTotpCode?: (sessionId: string, totpId: string) => Promise<void>;
}

function getWailsTotpApi(): WailsTotpApi | undefined {
  const w = window as unknown as { go?: { main?: { App?: WailsTotpApi } } };
  return w.go?.main?.App;
}

export const TotpManagerModal: React.FC<TotpManagerModalProps> = ({
  isOpen,
  onClose,
  hosts,
  activeSessionId,
  onInjectCode,
  onRefreshVault,
}) => {
  const [totpList, setTotpList] = useState<TotpSummary[]>([]);
  const [codes, setCodes] = useState<Record<string, TotpCodeResponse>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  // Add/Edit Dialog State
  const [showAddEdit, setShowAddEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'manual' | 'uri'>('uri');

  // Form Fields
  const [formUri, setFormUri] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formIssuer, setFormIssuer] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [formHostId, setFormHostId] = useState('');
  const [formAlgorithm, setFormAlgorithm] = useState('SHA1');
  const [formDigits, setFormDigits] = useState<number>(6);
  const [formPeriod, setFormPeriod] = useState<number>(30);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [injectingId, setInjectingId] = useState<string | null>(null);

  // Fetch TOTP list from backend
  const refreshTotpList = useCallback(async () => {
    const api = getWailsTotpApi();
    if (!api?.ListTotpRecords) {
      return;
    }
    try {
      setLoading(true);
      const list = await api.ListTotpRecords();
      setTotpList(list || []);
      setErrorMessage('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to load authenticators: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll codes and countdowns
  const refreshCodes = useCallback(async () => {
    const api = getWailsTotpApi();
    if (!api?.GetAllTotpCodes) {
      return;
    }
    try {
      const res = await api.GetAllTotpCodes();
      if (res && Array.isArray(res)) {
        const map: Record<string, TotpCodeResponse> = {};
        for (const c of res) {
          map[c.id] = c;
        }
        setCodes(map);
      }
    } catch {
      // Background code refresh silently ignored
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void refreshTotpList();
      void refreshCodes();
      const interval = setInterval(() => {
        void refreshCodes();
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen, refreshTotpList, refreshCodes]);

  // Host lookup map
  const hostMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hosts) {
      map.set(h.id, h.label);
    }
    return map;
  }, [hosts]);

  // Filtered list
  const filteredList = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return totpList;
    return totpList.filter((item) => {
      const hostLabel = item.hostId ? hostMap.get(item.hostId) || '' : '';
      return (
        item.label.toLowerCase().includes(q) ||
        (item.issuer && item.issuer.toLowerCase().includes(q)) ||
        hostLabel.toLowerCase().includes(q)
      );
    });
  }, [totpList, searchQuery, hostMap]);

  // Copy code to clipboard
  const handleCopyCode = async (id: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to copy to clipboard: ${msg}`);
    }
  };

  // Inject code into terminal
  const handleInject = async (totpId: string) => {
    setInjectingId(totpId);
    try {
      if (onInjectCode) {
        await onInjectCode(totpId);
      } else {
        const api = getWailsTotpApi();
        if (api?.InjectTotpCode && activeSessionId) {
          await api.InjectTotpCode(activeSessionId, totpId);
        }
      }
      setSuccessNotice('Injected 2FA code into terminal prompt!');
      setTimeout(() => setSuccessNotice(''), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to inject 2FA code: ${msg}`);
    } finally {
      setInjectingId(null);
    }
  };

  // Parse URI handler
  const handleParseUri = async () => {
    const api = getWailsTotpApi();
    if (!api?.ParseOTPAuthURI) {
      setErrorMessage('URI parsing is not available in mock mode');
      return;
    }
    if (!formUri.trim()) {
      setErrorMessage('Please paste a valid otpauth:// URI');
      return;
    }
    try {
      const parsed = await api.ParseOTPAuthURI(formUri.trim());
      setFormLabel(parsed.label || '');
      setFormIssuer(parsed.issuer || '');
      setFormSecret(parsed.secret || '');
      setFormAlgorithm(parsed.algorithm || 'SHA1');
      setFormDigits(parsed.digits || 6);
      setFormPeriod(parsed.period || 30);
      setInputMode('manual');
      setErrorMessage('');
      setSuccessNotice('Successfully parsed OTPAuth URI!');
      setTimeout(() => setSuccessNotice(''), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Invalid OTPAuth URI: ${msg}`);
    }
  };

  // Open add dialog
  const handleOpenAdd = () => {
    setEditingId(null);
    setInputMode('uri');
    setFormUri('');
    setFormLabel('');
    setFormIssuer('');
    setFormSecret('');
    setShowSecret(false);
    setFormHostId('');
    setFormAlgorithm('SHA1');
    setFormDigits(6);
    setFormPeriod(30);
    setErrorMessage('');
    setShowAddEdit(true);
  };

  // Open edit dialog
  const handleOpenEdit = (item: TotpSummary) => {
    setEditingId(item.id);
    setInputMode('manual');
    setFormUri('');
    setFormLabel(item.label);
    setFormIssuer(item.issuer || '');
    setFormSecret(''); // Keep secret blank to retain existing
    setShowSecret(false);
    setFormHostId(item.hostId || '');
    setFormAlgorithm(item.algorithm || 'SHA1');
    setFormDigits(item.digits || 6);
    setFormPeriod(item.period || 30);
    setErrorMessage('');
    setShowAddEdit(true);
  };

  // Save TOTP Record
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getWailsTotpApi();
    if (!api?.SaveTotpRecord) {
      setErrorMessage('Backend binding SaveTotpRecord not found');
      return;
    }

    if (!formLabel.trim() && !formIssuer.trim()) {
      setErrorMessage('Account label or issuer is required');
      return;
    }
    if (!editingId && !formSecret.trim()) {
      setErrorMessage('Secret key is required for new authenticators');
      return;
    }

    const record: TotpRecord = {
      id: editingId || '',
      label: formLabel.trim() || formIssuer.trim(),
      issuer: formIssuer.trim(),
      secret: formSecret.trim(),
      hostId: formHostId || undefined,
      algorithm: formAlgorithm,
      digits: Number(formDigits) || 6,
      period: Number(formPeriod) || 30,
    };

    try {
      setLoading(true);
      await api.SaveTotpRecord(record);
      setShowAddEdit(false);
      setSuccessNotice(editingId ? 'Authenticator updated!' : 'Authenticator added to vault!');
      setTimeout(() => setSuccessNotice(''), 2500);
      await refreshTotpList();
      await refreshCodes();
      if (onRefreshVault) {
        void onRefreshVault();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to save authenticator: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // Delete TOTP Record
  const handleDelete = async (id: string, label: string) => {
    if (!window.confirm(`Are you sure you want to delete the authenticator "${label}"?`)) {
      return;
    }
    const api = getWailsTotpApi();
    if (!api?.DeleteTotpRecord) {
      return;
    }
    try {
      setLoading(true);
      await api.DeleteTotpRecord(id);
      setSuccessNotice(`Removed "${label}"`);
      setTimeout(() => setSuccessNotice(''), 2000);
      await refreshTotpList();
      await refreshCodes();
      if (onRefreshVault) {
        void onRefreshVault();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to delete authenticator: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // Format code display with a space in the middle: e.g. 123 456 or 1234 5678
  const formatCode = (rawCode?: string, digits = 6): string => {
    if (!rawCode) return '------';
    const clean = rawCode.replace(/\s+/g, '');
    const mid = Math.floor(digits / 2);
    if (clean.length === digits) {
      return `${clean.slice(0, mid)} ${clean.slice(mid)}`;
    }
    return clean;
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-container totp-manager-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="TOTP Authenticator Generator"
      >
        <div className="modal-header">
          <div className="modal-title-with-badge">
            <span className="modal-icon">🔐</span>
            <h2>TOTP Authenticator Generator</h2>
            <span className="modal-badge-f">F-20</span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close TOTP Authenticator"
          >
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="modal-error-banner" role="alert">
            <span>⚠️ {errorMessage}</span>
            <button type="button" onClick={() => setErrorMessage('')} className="banner-dismiss">
              ✕
            </button>
          </div>
        )}

        {successNotice && (
          <div className="modal-success-banner" role="status">
            <span>✓ {successNotice}</span>
          </div>
        )}

        <div className="totp-toolbar">
          <div className="totp-search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Filter by account, issuer, or linked host..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleOpenAdd}
          >
            ➕ Add Authenticator
          </button>
        </div>

        {/* Add / Edit Form Modal Sub-panel */}
        {showAddEdit && (
          <div className="totp-add-panel">
            <div className="totp-add-header">
              <h3>{editingId ? 'Edit Authenticator' : 'Add New Authenticator (F-20)'}</h3>
              <div className="totp-mode-toggle">
                {!editingId && (
                  <>
                    <button
                      type="button"
                      className={`btn-mode ${inputMode === 'uri' ? 'active' : ''}`}
                      onClick={() => setInputMode('uri')}
                    >
                      🔗 Paste URI
                    </button>
                    <button
                      type="button"
                      className={`btn-mode ${inputMode === 'manual' ? 'active' : ''}`}
                      onClick={() => setInputMode('manual')}
                    >
                      ✏️ Manual Entry
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setShowAddEdit(false)}
                >
                  Cancel
                </button>
              </div>
            </div>

            {inputMode === 'uri' && !editingId ? (
              <div className="totp-uri-form">
                <p className="totp-form-hint">
                  Paste an <code>otpauth://totp/...</code> URI (from a QR code, password manager, or export string):
                </p>
                <div className="totp-uri-input-group">
                  <input
                    type="text"
                    placeholder="otpauth://totp/Issuer:user@domain.com?secret=JBSWY3DPEHPK3PXP..."
                    value={formUri}
                    onChange={(e) => setFormUri(e.target.value)}
                    className="form-control"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleParseUri()}
                  >
                    Parse URI
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={(e) => void handleSave(e)} className="totp-manual-form">
                <div className="form-row-2">
                  <div className="form-group">
                    <label>
                      Issuer / Service:
                      <input
                        type="text"
                        placeholder="e.g. GitHub, AWS, Corporate Bastion"
                        value={formIssuer}
                        onChange={(e) => setFormIssuer(e.target.value)}
                        className="form-control"
                      />
                    </label>
                  </div>
                  <div className="form-group">
                    <label>
                      Account / Label: <span className="req">*</span>
                      <input
                        type="text"
                        placeholder="e.g. alice@example.com or admin"
                        value={formLabel}
                        onChange={(e) => setFormLabel(e.target.value)}
                        className="form-control"
                        required
                      />
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label>
                    Secret Key (Base32): {editingId ? '(Leave empty to keep current seed)' : <span className="req">*</span>}
                    <div className="secret-input-wrapper">
                      <input
                        type={showSecret ? 'text' : 'password'}
                        placeholder={editingId ? '••••••••••••••••' : 'e.g. JBSWY3DPEHPK3PXP'}
                        value={formSecret}
                        onChange={(e) => setFormSecret(e.target.value)}
                        className="form-control"
                        autoComplete="off"
                        required={!editingId}
                      />
                      <button
                        type="button"
                        className="btn-icon-toggle"
                        onClick={() => setShowSecret((prev) => !prev)}
                        title={showSecret ? 'Hide secret' : 'Show secret'}
                      >
                        {showSecret ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </label>
                  <small className="form-text-muted">
                    Encrypted inside the Go vault. Never transmitted in cleartext or exported to summaries.
                  </small>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>
                      Link to Host (Optional):
                      <select
                        value={formHostId}
                        onChange={(e) => setFormHostId(e.target.value)}
                        className="form-control"
                      >
                        <option value="">-- Standalone Service (None) --</option>
                        {hosts.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label} ({h.address})
                          </option>
                        ))}
                      </select>
                    </label>
                    <small className="form-text-muted">
                      Allows 1-click 2FA injection directly during SSH sessions to this host.
                    </small>
                  </div>

                  <div className="form-row-3-nested">
                    <div className="form-group">
                      <label>
                        Digits:
                        <select
                          value={formDigits}
                          onChange={(e) => setFormDigits(Number(e.target.value))}
                          className="form-control"
                        >
                          <option value={6}>6</option>
                          <option value={8}>8</option>
                        </select>
                      </label>
                    </div>
                    <div className="form-group">
                      <label>
                        Period (s):
                        <input
                          type="number"
                          value={formPeriod}
                          onChange={(e) => setFormPeriod(Number(e.target.value))}
                          min={5}
                          max={300}
                          className="form-control"
                        />
                      </label>
                    </div>
                    <div className="form-group">
                      <label>
                        Algorithm:
                        <select
                          value={formAlgorithm}
                          onChange={(e) => setFormAlgorithm(e.target.value)}
                          className="form-control"
                        >
                          <option value="SHA1">SHA1</option>
                          <option value="SHA256">SHA256</option>
                          <option value="SHA512">SHA512</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="totp-form-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowAddEdit(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={loading}
                  >
                    {editingId ? 'Save Changes' : 'Save to Encrypted Vault'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* TOTP Cards List */}
        <div className="totp-card-list">
          {filteredList.length === 0 ? (
            <div className="totp-empty-state">
              <span className="empty-icon">🛡️</span>
              <h3>No TOTP authenticators found</h3>
              <p>
                {searchQuery
                  ? 'No authenticators match your search filter.'
                  : 'Add your two-factor authentication (2FA) seeds securely into your encrypted vault to generate codes and inject them directly into your SSH sessions.'}
              </p>
              {!searchQuery && !showAddEdit && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleOpenAdd}
                >
                  ➕ Add First Authenticator
                </button>
              )}
            </div>
          ) : (
            filteredList.map((item) => {
              const codeResp = codes[item.id];
              const remaining = codeResp ? codeResp.remainingSeconds : 30;
              const period = item.period || 30;
              const fraction = Math.max(0, Math.min(1, remaining / period));
              const isUrgent = remaining <= 5;

              // SVG Circle properties
              const radius = 14;
              const circumference = 2 * Math.PI * radius;
              const strokeDashoffset = circumference * (1 - fraction);

              const hostLabel = item.hostId ? hostMap.get(item.hostId) : undefined;

              return (
                <div key={item.id} className="totp-card">
                  <div className="totp-card-left">
                    <div className="totp-issuer-badge">
                      {(item.issuer || item.label || '2FA').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="totp-meta">
                      <div className="totp-header-row">
                        {item.issuer && <span className="totp-issuer-name">{item.issuer}</span>}
                        {hostLabel && (
                          <span className="totp-host-badge" title={`Linked to Host: ${hostLabel}`}>
                            🖥️ {hostLabel}
                          </span>
                        )}
                        {item.algorithm !== 'SHA1' && (
                          <span className="totp-alg-badge">{item.algorithm}</span>
                        )}
                      </div>
                      <div className="totp-account-label" title={item.label}>
                        {item.label}
                      </div>
                    </div>
                  </div>

                  <div className="totp-card-center">
                    <div className="totp-code-display" aria-label={`Code: ${codeResp?.code || ''}`}>
                      <span className="totp-code-digits">
                        {formatCode(codeResp?.code, item.digits)}
                      </span>
                    </div>

                    {/* Circular Countdown Ring */}
                    <div
                      className={`totp-countdown-wheel ${isUrgent ? 'urgent' : ''}`}
                      title={`${remaining}s remaining in this 30s period`}
                    >
                      <svg width="34" height="34" viewBox="0 0 34 34">
                        <circle
                          className="wheel-track"
                          cx="17"
                          cy="17"
                          r={radius}
                        />
                        <circle
                          className="wheel-fill"
                          cx="17"
                          cy="17"
                          r={radius}
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeDashoffset}
                        />
                      </svg>
                      <span className="countdown-number">{remaining}</span>
                    </div>
                  </div>

                  <div className="totp-card-actions">
                    <button
                      type="button"
                      className={`btn-action-copy ${copiedId === item.id ? 'copied' : ''}`}
                      onClick={() => void handleCopyCode(item.id, codeResp?.code || '')}
                      title="Copy 2FA code to clipboard"
                    >
                      {copiedId === item.id ? '✓ Copied' : '📋 Copy'}
                    </button>

                    {activeSessionId && (
                      <button
                        type="button"
                        className="btn-action-inject"
                        onClick={() => void handleInject(item.id)}
                        disabled={injectingId === item.id}
                        title="Auto-fill code directly into active SSH terminal prompt"
                      >
                        {injectingId === item.id ? '...' : '⚡ Insert'}
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-action-icon"
                      onClick={() => handleOpenEdit(item)}
                      title="Edit authenticator details"
                    >
                      ✏️
                    </button>

                    <button
                      type="button"
                      className="btn-action-icon btn-action-delete"
                      onClick={() => void handleDelete(item.id, item.label)}
                      title="Delete authenticator from vault"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="modal-footer totp-modal-footer">
          <div className="totp-footer-hint">
            <span>🛡️ Threat Model: TOTP seeds remain encrypted inside the Go process; only ephemeral 30s codes leave the vault.</span>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
