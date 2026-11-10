import React, { useState } from 'react';
import type {
  ImportScanResult,
  ImportedHostEntry,
  ImportExecuteOptions,
  ImportExecuteResult,
} from '../types/import';
import { CyberIcon } from './CyberIcon';

export interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingGroups: Array<{ id: string; name: string }>;
  onImportComplete: () => Promise<void>;
}

interface WailsImportApi {
  ScanLocalPuTTYSessions?: () => Promise<ImportScanResult>;
  ParsePuTTYRegContent?: (content: string) => Promise<ImportScanResult>;
  ParseTermiusContent?: (content: string) => Promise<ImportScanResult>;
  ExecuteImport?: (options: ImportExecuteOptions) => Promise<ImportExecuteResult>;
}

function getImportApi(): WailsImportApi | undefined {
  const w = window as unknown as { go?: { main?: { App?: WailsImportApi } } };
  return w.go?.main?.App;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  existingGroups,
  onImportComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'putty' | 'termius'>('putty');
  const [inputText, setInputText] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<ImportScanResult | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [targetGroup, setTargetGroup] = useState<string>('');
  const [importKeys, setImportKeys] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successResult, setSuccessResult] = useState<ImportExecuteResult | null>(null);

  if (!isOpen) return null;

  const handleScanLocalPuTTY = async () => {
    const api = getImportApi();
    if (!api?.ScanLocalPuTTYSessions) {
      setErrorMsg('Wails backend API not connected.');
      return;
    }
    setIsScanning(true);
    setErrorMsg('');
    setSuccessResult(null);
    try {
      const res = await api.ScanLocalPuTTYSessions();
      setScanResult(res);
      // Select all by default
      const all = new Set<number>();
      res.hosts.forEach((_, idx) => all.add(idx));
      setSelectedIndices(all);
      setTargetGroup('Imported from PuTTY');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Failed to scan local PuTTY sessions: ${msg}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleParseContent = async () => {
    const api = getImportApi();
    if (!api) {
      setErrorMsg('Wails backend API not connected.');
      return;
    }
    if (!inputText.trim()) {
      setErrorMsg('Please paste configuration content or load a file first.');
      return;
    }
    setIsScanning(true);
    setErrorMsg('');
    setSuccessResult(null);
    try {
      let res: ImportScanResult;
      if (activeTab === 'putty') {
        if (!api.ParsePuTTYRegContent) throw new Error('ParsePuTTYRegContent not available');
        res = await api.ParsePuTTYRegContent(inputText);
        setTargetGroup('Imported from PuTTY');
      } else {
        if (!api.ParseTermiusContent) throw new Error('ParseTermiusContent not available');
        res = await api.ParseTermiusContent(inputText);
        setTargetGroup('Imported from Termius');
      }
      setScanResult(res);
      const all = new Set<number>();
      res.hosts.forEach((_, idx) => all.add(idx));
      setSelectedIndices(all);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Parse failed: ${msg}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setInputText(text);
    };
    reader.readAsText(file);
  };

  const handleToggleSelect = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleSelectAll = (select: boolean) => {
    if (!scanResult) return;
    if (select) {
      const all = new Set<number>();
      scanResult.hosts.forEach((_, idx) => all.add(idx));
      setSelectedIndices(all);
    } else {
      setSelectedIndices(new Set());
    }
  };

  const handleExecuteImport = async () => {
    if (!scanResult || selectedIndices.size === 0) return;
    const api = getImportApi();
    if (!api?.ExecuteImport) {
      setErrorMsg('ExecuteImport API not available.');
      return;
    }

    const selected: ImportedHostEntry[] = [];
    selectedIndices.forEach((idx) => {
      if (scanResult.hosts[idx]) {
        selected.push(scanResult.hosts[idx]);
      }
    });

    setIsExecuting(true);
    setErrorMsg('');
    try {
      const res = await api.ExecuteImport({
        selectedHosts: selected,
        defaultGroup: targetGroup.trim(),
        importKeys,
      });
      setSuccessResult(res);
      await onImportComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Import failed: ${msg}`);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="cyber-modal-overlay" onClick={onClose}>
      <div
        className="cyber-dialog-card import-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Import PuTTY and Termius Sessions"
        style={{ maxWidth: '920px', width: '94%' }}
      >
        {/* Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Header */}
        <div className="dialog-header">
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3>SESSION MIGRATION &amp; IMPORT</h3>
              <div className="dialog-subtitle">
                F-30 // PUTTY REGISTRY &amp; TERMIUS EXPORT PARSER
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close Import Dialog"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="dialog-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
          {errorMsg && (
            <div className="alert-danger" style={{ marginBottom: '1rem' }}>
              {errorMsg}
            </div>
          )}

          {successResult && (
            <div className="alert-success" style={{ marginBottom: '1rem' }}>
              <strong>✓ Migration Complete:</strong> {successResult.hostsImported} hosts imported,{' '}
              {successResult.groupsCreated} groups created, {successResult.tunnelsConfigured} tunnels configured
              {successResult.keysImported > 0 ? `, ${successResult.keysImported} SSH keys saved` : ''}.
            </div>
          )}

          {/* Format Tabs */}
          <div className="settings-tabs-header" style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              className={`settings-tab-btn ${activeTab === 'putty' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('putty');
                setScanResult(null);
                setInputText('');
                setErrorMsg('');
              }}
            >
              <span>PuTTY (Registry / .reg)</span>
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${activeTab === 'termius' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('termius');
                setScanResult(null);
                setInputText('');
                setErrorMsg('');
              }}
            >
              <span>Termius (JSON / CSV)</span>
            </button>
          </div>

          {/* Tab 1: PuTTY */}
          {activeTab === 'putty' && (
            <div className="import-source-box">
              <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginBottom: '0.8rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleScanLocalPuTTY}
                  disabled={isScanning}
                >
                  <CyberIcon name="search" size={13} />
                  <span>{isScanning ? 'Scanning...' : 'Scan Local PuTTY Sessions (Registry)'}</span>
                </button>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  OR load from an exported <code>.reg</code> file:
                </span>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                  <span>📂 Choose .reg File</span>
                  <input
                    type="file"
                    accept=".reg,.txt"
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                  />
                </label>
              </div>

              <textarea
                className="form-textarea font-mono"
                rows={4}
                placeholder="Or paste Windows Registry PuTTY export (.reg) content here..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                style={{ fontSize: '0.76rem', width: '100%' }}
              />

              {inputText.trim() && (
                <div style={{ marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleParseContent}
                    disabled={isScanning}
                  >
                    <span>Parse .reg Content</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Termius */}
          {activeTab === 'termius' && (
            <div className="import-source-box">
              <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginBottom: '0.8rem' }}>
                <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                  <CyberIcon name="folder" size={13} />
                  <span>📂 Choose termius.json or .csv</span>
                  <input
                    type="file"
                    accept=".json,.csv,.txt"
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                  />
                </label>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Or paste Termius exported JSON array or CSV text:
                </span>
              </div>

              <textarea
                className="form-textarea font-mono"
                rows={4}
                placeholder='Paste Termius JSON (e.g. {"hosts": [...]}) or CSV export here...'
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                style={{ fontSize: '0.76rem', width: '100%' }}
              />

              {inputText.trim() && (
                <div style={{ marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleParseContent}
                    disabled={isScanning}
                  >
                    <span>Parse Termius Export</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Preview & Selection Section */}
          {scanResult && (
            <div className="import-preview-section" style={{ marginTop: '1.2rem' }}>
              {/* Telemetry strip */}
              <div className="conflict-telemetry-banner" style={{ marginBottom: '0.8rem' }}>
                <div className="conflict-telemetry-item">
                  <span className="telemetry-label">DISCOVERED:</span>
                  <span className="telemetry-val text-cyan">{scanResult.totalFound} HOSTS</span>
                </div>
                <div className="conflict-telemetry-item">
                  <span className="telemetry-label">SELECTED:</span>
                  <span className="telemetry-val text-cyan">{selectedIndices.size} FOR IMPORT</span>
                </div>
                <div className="conflict-telemetry-item">
                  <span className="telemetry-label">SOURCE:</span>
                  <span className="telemetry-val font-mono">{scanResult.sourceType}</span>
                </div>
              </div>

              {/* Import Options Controls */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1rem',
                  padding: '0.8rem',
                  background: 'rgba(5, 9, 16, 0.7)',
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                  marginBottom: '0.8rem',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    Assign to DoubleAgent Group:
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Imported PuTTY"
                    value={targetGroup}
                    onChange={(e) => setTargetGroup(e.target.value)}
                    list="existing-groups-datalist"
                    style={{ width: '100%' }}
                  />
                  <datalist id="existing-groups-datalist">
                    {existingGroups.map((g) => (
                      <option key={g.id} value={g.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    SSH Keys / Certificates:
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', marginTop: '0.3rem' }}>
                    <input
                      type="checkbox"
                      checked={importKeys}
                      onChange={(e) => setImportKeys(e.target.checked)}
                    />
                    <span>Import readable local private keys (.ppk / .pem) into Vault</span>
                  </label>
                </div>
              </div>

              {/* Table Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleSelectAll(true)}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleSelectAll(false)}
                  >
                    Deselect All
                  </button>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Click items to toggle selection before applying
                </div>
              </div>

              {/* Host Preview Table */}
              <div style={{ maxHeight: '34vh', overflowY: 'auto', border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))' }}>
                <table className="shortcuts-table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '40px', textAlign: 'center' }}>✓</th>
                      <th>Host Label</th>
                      <th>Address : Port</th>
                      <th>User</th>
                      <th>Group / Tags</th>
                      <th>Key / Forwarding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanResult.hosts.map((h, idx) => {
                      const isSelected = selectedIndices.has(idx);
                      return (
                        <tr
                          key={`${h.address}-${idx}`}
                          onClick={() => handleToggleSelect(idx)}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(0, 240, 255, 0.05)' : undefined,
                          }}
                        >
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelect(idx)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td style={{ fontWeight: 600, color: '#e2e8f0' }}>{h.label}</td>
                          <td className="font-mono" style={{ fontSize: '0.76rem', color: '#38bdf8' }}>
                            {h.address}:{h.port}
                          </td>
                          <td style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                            {h.username || '—'}
                          </td>
                          <td style={{ fontSize: '0.74rem' }}>
                            {h.group && <span style={{ color: '#f59e0b', marginRight: '0.4rem' }}>[{h.group}]</span>}
                            {h.tags && h.tags.map((t) => (
                              <span key={t} className="key-badge" style={{ fontSize: '0.65rem', marginRight: '0.2rem' }}>
                                #{t}
                              </span>
                            ))}
                          </td>
                          <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {h.keyPath && (
                              <div title={h.keyPath}>
                                🔑 {h.keyPath.split(/[/\\]/).pop()}
                              </div>
                            )}
                            {h.forwardRules && h.forwardRules.length > 0 && (
                              <div style={{ color: '#2dd4bf' }}>
                                ⇄ {h.forwardRules.length} Tunnels
                              </div>
                            )}
                          </td>
                          <td>
                            {h.alreadyExist ? (
                              <span className="sync-status-pill external_change" style={{ fontSize: '0.65rem' }}>
                                In Vault
                              </span>
                            ) : (
                              <span className="sync-status-pill synced" style={{ fontSize: '0.65rem' }}>
                                New
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="dialog-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {selectedIndices.size > 0 ? `${selectedIndices.size} hosts ready to import` : 'No hosts selected'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isExecuting}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleExecuteImport()}
              disabled={isExecuting || selectedIndices.size === 0}
            >
              <CyberIcon name="bolt" size={13} />
              <span>{isExecuting ? 'Importing...' : `⚡ Import Selected (${selectedIndices.size})`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
