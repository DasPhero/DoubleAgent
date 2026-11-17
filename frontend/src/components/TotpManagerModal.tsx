import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { CyberIcon } from './CyberIcon';
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
  isDocked?: boolean;
  onDockToView?: () => void;
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
  ExportTotpTokens?: (format: string) => Promise<string>;
  ImportTotpTokens?: (content: string) => Promise<number>;
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
  isDocked = false,
  onDockToView,
}) => {
  const [totpList, setTotpList] = useState<TotpSummary[]>([]);
  const [codes, setCodes] = useState<Record<string, TotpCodeResponse>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'linked' | 'unlinked'>('all');
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

  // Import / Export State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'uri' | 'json'>('uri');
  const [exportContent, setExportContent] = useState('');
  const [exportCopied, setExportCopied] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importContent, setImportContent] = useState('');
  const [importError, setImportError] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    return totpList.filter((item) => {
      // Host filter
      if (filterMode === 'linked' && !item.hostId) return false;
      if (filterMode === 'unlinked' && item.hostId) return false;

      // Query filter
      if (!q) return true;
      const hostLabel = item.hostId ? hostMap.get(item.hostId) || '' : '';
      return (
        item.label.toLowerCase().includes(q) ||
        (item.issuer && item.issuer.toLowerCase().includes(q)) ||
        hostLabel.toLowerCase().includes(q)
      );
    });
  }, [totpList, searchQuery, filterMode, hostMap]);

  const linkedCount = useMemo(() => totpList.filter((t) => !!t.hostId).length, [totpList]);
  const unlinkedCount = useMemo(() => totpList.filter((t) => !t.hostId).length, [totpList]);

  // Copy code to clipboard
  const handleCopyCode = async (id: string, code: string) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
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

  // Export handlers
  const handleOpenExport = async (format: 'uri' | 'json' = 'uri') => {
    setExportFormat(format);
    setExportCopied(false);
    const api = getWailsTotpApi();
    if (!api?.ExportTotpTokens) {
      setExportContent('// Export binding not available in current environment');
      setShowExportModal(true);
      return;
    }
    try {
      const content = await api.ExportTotpTokens(format);
      setExportContent(content || '');
      setShowExportModal(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to export tokens: ${msg}`);
    }
  };

  const handleChangeExportFormat = async (format: 'uri' | 'json') => {
    setExportFormat(format);
    setExportCopied(false);
    const api = getWailsTotpApi();
    if (api?.ExportTotpTokens) {
      try {
        const content = await api.ExportTotpTokens(format);
        setExportContent(content || '');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(`Export format switch failed: ${msg}`);
      }
    }
  };

  const handleCopyExport = async () => {
    if (!exportContent) return;
    try {
      await navigator.clipboard.writeText(exportContent);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to copy export content: ${msg}`);
    }
  };

  const handleDownloadExport = () => {
    if (!exportContent) return;
    const isJson = exportFormat === 'json';
    const blob = new Blob([exportContent], {
      type: isJson ? 'application/json;charset=utf-8;' : 'text/plain;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isJson ? 'doubleagent-totp-vault.json' : 'doubleagent-totp-vault.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Import handlers
  const handleOpenImport = () => {
    setImportContent('');
    setImportError('');
    setShowImportModal(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setImportContent(text || '');
      setImportError('');
    };
    reader.onerror = () => {
      setImportError('Failed to read file from disk');
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = async () => {
    const api = getWailsTotpApi();
    if (!api?.ImportTotpTokens) {
      setImportError('Backend binding ImportTotpTokens not available');
      return;
    }
    const trimmed = importContent.trim();
    if (!trimmed) {
      setImportError('Please paste otpauth:// URIs or JSON content, or select a file');
      return;
    }

    try {
      setImportLoading(true);
      setImportError('');
      const count = await api.ImportTotpTokens(trimmed);
      setShowImportModal(false);
      setSuccessNotice(`Successfully imported ${count} authenticator token${count === 1 ? '' : 's'}!`);
      setTimeout(() => setSuccessNotice(''), 3000);
      await refreshTotpList();
      await refreshCodes();
      if (onRefreshVault) {
        void onRefreshVault();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(`Import failed: ${msg}`);
    } finally {
      setImportLoading(false);
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

  const content = (
    <div
      className={`cyber-totp-container ${isDocked ? 'is-docked-view' : 'is-modal-view'}`}
      onClick={(e) => e.stopPropagation()}
      role={isDocked ? 'region' : 'dialog'}
      aria-label={isDocked ? 'Docked TOTP Authenticator' : 'TOTP Authenticator Generator'}
    >
      {/* Reticle corner decoration overlays */}
      <div className="cyber-corner-reticle cyber-corner-tl" />
      <div className="cyber-corner-reticle cyber-corner-tr" />
      <div className="cyber-corner-reticle cyber-corner-bl" />
      <div className="cyber-corner-reticle cyber-corner-br" />

      {/* Cyberpunk HUD Header Bar - Shown in both Modal and Docked modes */}
      <div className="cyber-totp-hud-header">
        <div className="cyber-hud-title-block">
          <div className="cyber-hud-tag-line">
            <span className="cyber-hazard-stripes">///</span>
            <span className="cyber-hud-tag">SEC-02FA</span>
            <span className="cyber-hud-delim">//</span>
            <span className="cyber-hud-subtag">QUANTUM VAULT</span>
          </div>
          <h2 className="cyber-hud-title">
            TOTP AUTHENTICATOR
            {isDocked && <span className="cyber-docked-badge">[DOCKED PANE]</span>}
          </h2>
          <div className="cyber-telemetry-strip">
            <span className="cyber-telemetry-chip chip-cyan" title="Total active authenticators in vault">
              <span className="chip-dot" /> KEYS: <strong>{totpList.length}</strong>
            </span>
            <span className="cyber-telemetry-chip chip-green" title="Underlying hardware/Argon2id encryption">
              <span className="chip-dot" /> VAULT: <strong>AES-256-GCM</strong>
            </span>
            <span className="cyber-telemetry-chip chip-amber" title="RFC-6238 Time-based One-Time Passwords">
              <span className="chip-dot" /> RFC-6238 <strong>30s</strong>
            </span>
          </div>
        </div>

        <div className="cyber-hud-actions-block">
          <button
            type="button"
            className="cyber-btn cyber-btn-primary"
            onClick={handleOpenAdd}
            aria-label="Add Authenticator"
            title="Register a new TOTP 2FA secret or paste URI"
          >
            <span className="btn-glitch-icon">+</span> ADD KEY
          </button>
          <button
            type="button"
            className="cyber-btn cyber-btn-secondary"
            onClick={handleOpenImport}
            title="Import authenticators from otpauth:// URIs or JSON vault backup"
          >
            <CyberIcon name="download" size={14} /> IMPORT
          </button>
          <button
            type="button"
            className="cyber-btn cyber-btn-secondary"
            onClick={() => void handleOpenExport('uri')}
            title="Export authenticators as otpauth:// URIs or JSON backup"
          >
            <CyberIcon name="upload" size={14} /> EXPORT
          </button>

          {!isDocked && onDockToView && (
            <button
              type="button"
              className="cyber-btn cyber-btn-accent"
              onClick={onDockToView}
              title="Dock TOTP Authenticator as a split panel inside current workspace view"
            >
              <CyberIcon name="pin" size={14} /> DOCK VIEW
            </button>
          )}

          {!isDocked && (
            <button
              type="button"
              className="cyber-btn-close"
              onClick={onClose}
              aria-label="Close TOTP Authenticator"
              title="Close window"
            >
              <CyberIcon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Alert Notices */}
      {errorMessage && (
        <div className="cyber-banner cyber-banner-error" role="alert">
          <span className="banner-icon"><CyberIcon name="warning" size={14} /></span>
          <span className="banner-text">{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage('')} className="banner-close-btn">
            <CyberIcon name="close" size={14} />
          </button>
        </div>
      )}

      {successNotice && (
        <div className="cyber-banner cyber-banner-success" role="status">
          <span className="banner-icon"><CyberIcon name="check" size={14} /></span>
          <span className="banner-text">{successNotice}</span>
        </div>
      )}

      {/* Cyberpunk Filter and Search Toolbar */}
      <div className="cyber-totp-toolbar">
        <div className="cyber-search-reticle">
          <span className="search-prefix">&gt;</span>
          <input
            type="text"
            placeholder="FILTER_BY_ISSUER_LABEL_OR_HOST..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="cyber-search-input"
            autoFocus={!isDocked}
          />
          {searchQuery && (
            <button
              type="button"
              className="cyber-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              <CyberIcon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="cyber-filter-pills">
          <button
            type="button"
            className={`cyber-pill-btn ${filterMode === 'all' ? 'active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            ALL [{totpList.length}]
          </button>
          <button
            type="button"
            className={`cyber-pill-btn ${filterMode === 'linked' ? 'active' : ''}`}
            onClick={() => setFilterMode('linked')}
          >
            <CyberIcon name="desktop" size={14} /> LINKED [{linkedCount}]
          </button>
          <button
            type="button"
            className={`cyber-pill-btn ${filterMode === 'unlinked' ? 'active' : ''}`}
            onClick={() => setFilterMode('unlinked')}
          >
            STANDALONE [{unlinkedCount}]
          </button>
        </div>
      </div>

      {/* Add / Edit Form Panel */}
      {showAddEdit && (
        <div className="cyber-form-panel">
          <div className="cyber-form-header">
            <div className="form-header-title">
              <span className="form-hazard">///</span>
              <h3>{editingId ? 'EDIT AUTHENTICATOR RECORD' : 'ENCRYPT NEW TOTP TOKEN'}</h3>
            </div>
            <div className="cyber-mode-toggle">
              {!editingId && (
                <>
                  <button
                    type="button"
                    className={`cyber-tab-btn ${inputMode === 'uri' ? 'active' : ''}`}
                    onClick={() => setInputMode('uri')}
                  >
                    <CyberIcon name="chain" size={14} /> PASTE URI
                  </button>
                  <button
                    type="button"
                    className={`cyber-tab-btn ${inputMode === 'manual' ? 'active' : ''}`}
                    onClick={() => setInputMode('manual')}
                  >
                    <CyberIcon name="edit" size={14} /> MANUAL ENTRY
                  </button>
                </>
              )}
              <button
                type="button"
                className="cyber-btn-sm cyber-btn-secondary"
                onClick={() => setShowAddEdit(false)}
              >
                <CyberIcon name="close" size={14} /> CANCEL
              </button>
            </div>
          </div>

          {inputMode === 'uri' && !editingId ? (
            <div className="cyber-uri-entry">
              <p className="cyber-form-hint">
                Paste an <code>otpauth://totp/...</code> URI (from QR code, password manager export, or terminal):
              </p>
              <div className="cyber-uri-input-row">
                <input
                  type="text"
                  placeholder="otpauth://totp/Issuer:user@domain.com?secret=JBSWY3DPEHPK3PXP..."
                  value={formUri}
                  onChange={(e) => setFormUri(e.target.value)}
                  className="cyber-input"
                />
                <button
                  type="button"
                  className="cyber-btn cyber-btn-primary"
                  onClick={() => void handleParseUri()}
                  aria-label="Parse URI"
                >
                  <CyberIcon name="bolt" size={14} /> PARSE URI
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSave(e)} className="cyber-manual-form">
              <div className="cyber-form-grid-2">
                <div className="cyber-field-group">
                  <label className="cyber-label">
                    ISSUER / SERVICE:
                    <input
                      type="text"
                      placeholder="e.g. GitHub, AWS, Bastion Host"
                      value={formIssuer}
                      onChange={(e) => setFormIssuer(e.target.value)}
                      className="cyber-input"
                    />
                  </label>
                </div>
                <div className="cyber-field-group">
                  <label className="cyber-label">
                    ACCOUNT / LABEL: <span className="req">*</span>
                    <input
                      type="text"
                      placeholder="e.g. alice@example.com or root"
                      value={formLabel}
                      onChange={(e) => setFormLabel(e.target.value)}
                      className="cyber-input"
                      required
                    />
                  </label>
                </div>
              </div>

              <div className="cyber-field-group">
                <label className="cyber-label">
                  SECRET KEY (BASE32): {editingId ? '(Leave blank to retain seed)' : <span className="req">*</span>}
                  <div className="cyber-secret-wrapper">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      placeholder={editingId ? '••••••••••••••••' : 'e.g. JBSWY3DPEHPK3PXP'}
                      value={formSecret}
                      onChange={(e) => setFormSecret(e.target.value)}
                      className="cyber-input font-mono"
                      autoComplete="off"
                      required={!editingId}
                    />
                    <button
                      type="button"
                      className="cyber-btn-eye"
                      onClick={() => setShowSecret((prev) => !prev)}
                      title={showSecret ? 'Hide secret' : 'Reveal secret'}
                    >
                      {showSecret ? <CyberIcon name="eye-off" size={14} /> : <CyberIcon name="eye" size={14} />}
                    </button>
                  </div>
                </label>
                <small className="cyber-text-dim">
                  Seed is encrypted with AES-256-GCM / Argon2id in Go memory. Never exposed over network or plain logs.
                </small>
              </div>

              <div className="cyber-form-grid-2">
                <div className="cyber-field-group">
                  <label className="cyber-label">
                    LINK TO SSH HOST (OPTIONAL):
                    <select
                      value={formHostId}
                      onChange={(e) => setFormHostId(e.target.value)}
                      className="cyber-select"
                    >
                      <option value="">-- Standalone Service (None) --</option>
                      {hosts.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.label} ({h.address})
                        </option>
                      ))}
                    </select>
                  </label>
                  <small className="cyber-text-dim">
                    Enables 1-click 2FA auto-injection into active terminal prompts for this host.
                  </small>
                </div>

                <div className="cyber-form-grid-3">
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      DIGITS:
                      <select
                        value={formDigits}
                        onChange={(e) => setFormDigits(Number(e.target.value))}
                        className="cyber-select"
                      >
                        <option value={6}>6</option>
                        <option value={8}>8</option>
                      </select>
                    </label>
                  </div>
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      PERIOD (S):
                      <input
                        type="number"
                        value={formPeriod}
                        onChange={(e) => setFormPeriod(Number(e.target.value))}
                        min={5}
                        max={300}
                        className="cyber-input"
                      />
                    </label>
                  </div>
                  <div className="cyber-field-group">
                    <label className="cyber-label">
                      ALGO:
                      <select
                        value={formAlgorithm}
                        onChange={(e) => setFormAlgorithm(e.target.value)}
                        className="cyber-select"
                      >
                        <option value="SHA1">SHA1</option>
                        <option value="SHA256">SHA256</option>
                        <option value="SHA512">SHA512</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <div className="cyber-form-actions">
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={() => setShowAddEdit(false)}
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="cyber-btn cyber-btn-primary"
                  disabled={loading}
                  aria-label={editingId ? 'Save Changes' : 'Save to Encrypted Vault'}
                >
                  {editingId ? <><CyberIcon name="check" size={14} /> SAVE CHANGES</> : <><CyberIcon name="shield" size={14} /> ENCRYPT TO VAULT</>}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Cyberpunk Token Card Grid */}
      <div className="cyber-totp-card-grid">
        {filteredList.length === 0 ? (
          <div className="cyber-empty-state">
            <div className="cyber-empty-radar" />
            <div className="cyber-empty-icon"><CyberIcon name="shield" size={14} /></div>
            <h3 className="cyber-empty-title">/// ZERO AUTHENTICATOR SEEDS IN SCOPE ///</h3>
            <p className="cyber-empty-desc">
              {searchQuery
                ? 'No authenticators match the search query.'
                : 'Your encrypted vault contains no TOTP seeds. Add your two-factor authentication keys to generate rolling 30s tokens and inject them with 1 click into terminal prompts.'}
            </p>
            {!searchQuery && !showAddEdit && (
              <div className="cyber-empty-actions">
                <button
                  type="button"
                  className="cyber-btn cyber-btn-primary"
                  onClick={handleOpenAdd}
                  aria-label="Add Authenticator"
                >
                  + ADD FIRST KEY
                </button>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={handleOpenImport}
                >
                  <CyberIcon name="download" size={14} /> IMPORT BACKUP
                </button>
              </div>
            )}
          </div>
        ) : (
          filteredList.map((item) => {
            const codeResp = codes[item.id];
            const remaining = codeResp ? codeResp.remainingSeconds : 30;
            const period = item.period || 30;
            const fraction = Math.max(0, Math.min(1, remaining / period));
            const isUrgent = remaining <= 5;
            const isWarning = remaining > 5 && remaining <= 10;

            // SVG Circle HUD Gauge properties
            const radius = 17;
            const circumference = 2 * Math.PI * radius;
            const strokeDashoffset = circumference * (1 - fraction);

            // 10-segment tick bar
            const totalSegments = 10;
            const filledSegments = Math.ceil(fraction * totalSegments);

            const hostLabel = item.hostId ? hostMap.get(item.hostId) : undefined;
            const badgeInitials = (item.issuer || item.label || '2F').slice(0, 2).toUpperCase();

            return (
              <div
                key={item.id}
                className={`cyber-totp-card ${isUrgent ? 'card-urgent' : isWarning ? 'card-warning' : ''}`}
              >
                {/* Tactical Corner Accents */}
                <div className="card-reticle card-reticle-tl" />
                <div className="card-reticle card-reticle-tr" />
                <div className="card-reticle card-reticle-bl" />
                <div className="card-reticle card-reticle-br" />

                {/* Card Top Row */}
                <div className="card-top-row">
                  <div className="card-issuer-monogram" title={item.issuer || item.label}>
                    {badgeInitials}
                  </div>
                  <div className="card-identity-block">
                    <div className="card-service-name">
                      {item.issuer || item.label}
                    </div>
                    <div className="card-account-label" title={item.label}>
                      {item.label}
                    </div>
                  </div>
                  <div className="card-tags-block">
                    {hostLabel && (
                      <span className="card-host-pill" title={`Linked to Host: ${hostLabel}`}>
                        <span className="pill-pulse" /> <CyberIcon name="desktop" size={14} /> {hostLabel}
                      </span>
                    )}
                    <span className="card-meta-pill">
                      {item.algorithm || 'SHA1'} · {period}s
                    </span>
                  </div>
                </div>

                {/* Cyber Display Terminal with Big Digits and HUD Gauge */}
                <div
                  className="card-code-terminal"
                  onClick={() => void handleCopyCode(item.id, codeResp?.code || '')}
                  title="Click to copy 2FA code to clipboard"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      void handleCopyCode(item.id, codeResp?.code || '');
                    }
                  }}
                >
                  <div className="card-code-main">
                    <div className="code-digits-wrapper">
                      <span className={`cyber-code-digits ${isUrgent ? 'urgent-glow' : ''}`}>
                        {formatCode(codeResp?.code, item.digits)}
                      </span>
                    </div>

                    {/* HUD Circular Countdown Gauge */}
                    <div
                      className={`cyber-hud-gauge ${isUrgent ? 'urgent' : isWarning ? 'warning' : ''}`}
                      title={`${remaining}s remaining in this ${period}s window`}
                    >
                      <svg width="46" height="46" viewBox="0 0 46 46">
                        {/* Outer tick circle */}
                        <circle
                          className="gauge-tick-track"
                          cx="23"
                          cy="23"
                          r="21"
                        />
                        {/* Background track */}
                        <circle
                          className="gauge-bg-track"
                          cx="23"
                          cy="23"
                          r={radius}
                        />
                        {/* Animated fill arc */}
                        <circle
                          className="gauge-fill-arc"
                          cx="23"
                          cy="23"
                          r={radius}
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeDashoffset}
                        />
                      </svg>
                      <span className="gauge-countdown-text">
                        {remaining}
                        <span className="gauge-countdown-unit">s</span>
                      </span>
                    </div>
                  </div>

                  {/* 10-Segment Tactical Bar */}
                  <div className="cyber-segment-bar" aria-hidden="true">
                    {Array.from({ length: totalSegments }).map((_, idx) => (
                      <span
                        key={idx}
                        className={`seg-cell ${idx < filledSegments ? 'seg-active' : 'seg-inactive'} ${
                          isUrgent ? 'seg-urgent' : isWarning ? 'seg-warning' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Card Actions Bottom Row */}
                <div className="card-action-row">
                  <button
                    type="button"
                    className={`cyber-btn-copy ${copiedId === item.id ? 'is-copied' : ''}`}
                    onClick={() => void handleCopyCode(item.id, codeResp?.code || '')}
                    title="Copy 2FA token to clipboard"
                  >
                    {copiedId === item.id ? <><CyberIcon name="check" size={14} /> COPIED TO CLIPBOARD</> : <><CyberIcon name="clipboard" size={14} /> COPY CODE</>}
                  </button>

                  {activeSessionId && (
                    <button
                      type="button"
                      className="cyber-btn-inject"
                      onClick={() => void handleInject(item.id)}
                      disabled={injectingId === item.id}
                      title="Directly inject 2FA code into active SSH terminal prompt"
                    >
                      {injectingId === item.id ? '...' : <><CyberIcon name="bolt" size={14} /> INJECT</>}
                    </button>
                  )}

                  <button
                    type="button"
                    className="cyber-btn-icon"
                    onClick={() => handleOpenEdit(item)}
                    title="Edit authenticator parameters"
                    aria-label={`Edit ${item.label}`}
                  >
                    <CyberIcon name="edit" size={14} />
                  </button>

                  <button
                    type="button"
                    className="cyber-btn-icon btn-delete"
                    onClick={() => void handleDelete(item.id, item.label)}
                    title="Delete authenticator from vault"
                    aria-label={`Delete ${item.label}`}
                  >
                    <CyberIcon name="close" size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info Strip */}
      <div className="cyber-totp-footer">
        <span className="footer-hazard">///</span>
        <span className="footer-text">
          ZERO-LEAK PROTOCOL · RAW SEEDS STAY SEALED IN VAULT MEMORY · AUTO-INJECT ROLLS OVER SECURE PTY CHANNELS
        </span>
        {!isDocked && (
          <button type="button" className="cyber-btn-sm cyber-btn-secondary" onClick={onClose}>
            CLOSE
          </button>
        )}
      </div>

      {/* Export Dialog Modal */}
      {showExportModal && (
        <div className="cyber-modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="cyber-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <h3>EXPORT TOTP AUTHENTICATOR BACKUP</h3>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => setShowExportModal(false)}
              >
                <CyberIcon name="close" size={14} />
              </button>
            </div>

            <div className="dialog-body">
              <div className="cyber-format-selector">
                <label className="cyber-label">BACKUP FORMAT:</label>
                <div className="format-pills">
                  <button
                    type="button"
                    className={`cyber-tab-btn ${exportFormat === 'uri' ? 'active' : ''}`}
                    onClick={() => void handleChangeExportFormat('uri')}
                  >
                    <CyberIcon name="chain" size={14} /> OTPAUTH:// URIS (STANDARD)
                  </button>
                  <button
                    type="button"
                    className={`cyber-tab-btn ${exportFormat === 'json' ? 'active' : ''}`}
                    onClick={() => void handleChangeExportFormat('json')}
                  >
                    <CyberIcon name="file" size={14} /> JSON VAULT FORMAT
                  </button>
                </div>
              </div>

              <div className="dialog-warning-banner">
                <span className="warn-icon"><CyberIcon name="warning" size={14} /></span>
                <span>
                  SECURITY WARNING: Exported content contains cleartext cryptographic seeds. Save strictly to an
                  encrypted storage device or password manager.
                </span>
              </div>

              <textarea
                readOnly
                value={exportContent}
                className="cyber-export-textarea"
                rows={10}
                spellCheck={false}
              />
            </div>

            <div className="dialog-footer">
              <button
                type="button"
                className={`cyber-btn ${exportCopied ? 'cyber-btn-success' : 'cyber-btn-primary'}`}
                onClick={() => void handleCopyExport()}
              >
                {exportCopied ? <><CyberIcon name="check" size={14} /> COPIED ALL TO CLIPBOARD</> : <><CyberIcon name="clipboard" size={14} /> COPY TO CLIPBOARD</>}
              </button>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                onClick={handleDownloadExport}
              >
                <CyberIcon name="save" size={14} /> DOWNLOAD FILE
              </button>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                onClick={() => setShowExportModal(false)}
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Dialog Modal */}
      {showImportModal && (
        <div className="cyber-modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="cyber-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <h3>IMPORT TOTP AUTHENTICATOR BACKUP</h3>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => setShowImportModal(false)}
              >
                <CyberIcon name="close" size={14} />
              </button>
            </div>

            <div className="dialog-body">
              <p className="cyber-form-hint">
                Import from newline-separated <code>otpauth://totp/...</code> URIs or a JSON array of token objects.
                Duplicate keys will be updated with the latest parameters.
              </p>

              <div className="import-file-row">
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <CyberIcon name="folder" size={14} /> LOAD FROM FILE (.TXT / .JSON)
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept=".txt,.json,.conf"
                  onChange={handleFileUpload}
                />
              </div>

              {importError && (
                <div className="cyber-banner cyber-banner-error" role="alert">
                  <span className="banner-icon"><CyberIcon name="warning" size={14} /></span>
                  <span className="banner-text">{importError}</span>
                </div>
              )}

              <textarea
                placeholder="otpauth://totp/GitHub:alice@domain.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&#10;otpauth://totp/AWS:admin?secret=NBSWY3DPEHPK3PXP&#10;-- OR paste JSON array --"
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                className="cyber-export-textarea"
                rows={10}
                spellCheck={false}
              />
            </div>

            <div className="dialog-footer">
              <button
                type="button"
                className="cyber-btn cyber-btn-primary"
                onClick={() => void handleExecuteImport()}
                disabled={importLoading}
              >
                {importLoading ? 'IMPORTING...' : <><CyberIcon name="rocket" size={14} /> IMPORT AUTHENTICATORS</>}
              </button>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                onClick={() => setShowImportModal(false)}
                disabled={importLoading}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isDocked) {
    return content;
  }

  return (
    <div className="modal-backdrop cyber-modal-backdrop" onClick={onClose}>
      {content}
    </div>
  );
};
