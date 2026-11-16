import React, { useState } from 'react';
import { CyberIcon } from './CyberIcon';
import {
  NmapImportOptions,
  NmapImportRequest,
  NmapImportSummary,
  NmapScanResult,
  ParsedNmapHost,
} from '../types/nmap';

export interface NmapImportModalProps {
  isOpen: boolean;
  engagements: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  activeEngagementId?: string;
  onScanXML: (xmlContent: string) => Promise<NmapScanResult>;
  onImportXML: (req: NmapImportRequest) => Promise<NmapImportSummary>;
  onClose: () => void;
  onImportSuccess?: (summary: NmapImportSummary) => void;
}

export const NmapImportModal: React.FC<NmapImportModalProps> = ({
  isOpen,
  engagements,
  groups,
  activeEngagementId,
  onScanXML,
  onImportXML,
  onClose,
  onImportSuccess,
}) => {
  const [xmlContent, setXmlContent] = useState<string>('');
  const [scanResult, setScanResult] = useState<NmapScanResult | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [importSummary, setImportSummary] = useState<NmapImportSummary | null>(null);
  const [expandedHostIndex, setExpandedHostIndex] = useState<number | null>(0);

  // Form options
  const [selectedEngagementId, setSelectedEngagementId] = useState<string>(activeEngagementId || '');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [createHostRecords, setCreateHostRecords] = useState<boolean>(true);
  const [createPortNotes, setCreatePortNotes] = useState<boolean>(true);
  const [createSummaryNotes, setCreateSummaryNotes] = useState<boolean>(true);
  const [createPortFindings, setCreatePortFindings] = useState<boolean>(true);
  const [onlyUpHosts, setOnlyUpHosts] = useState<boolean>(true);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg('');
    setImportSummary(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      setXmlContent(text);
      await triggerScan(text);
    };
    reader.onerror = () => {
      setErrorMsg('Failed to read XML file from disk.');
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    setErrorMsg('');
    setImportSummary(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      setXmlContent(text);
      await triggerScan(text);
    };
    reader.readAsText(file);
  };

  const triggerScan = async (rawXml: string) => {
    if (!rawXml.trim()) {
      setErrorMsg('Please paste or upload valid Nmap XML output (-oX).');
      return;
    }
    setIsScanning(true);
    setErrorMsg('');
    try {
      const parsed = await onScanXML(rawXml);
      setScanResult(parsed);
      if (parsed.hosts.length > 0) {
        setExpandedHostIndex(0);
      }
    } catch (err: unknown) {
      setErrorMsg(`XML Parse Failed: ${err instanceof Error ? err.message : String(err)}`);
      setScanResult(null);
    } finally {
      setIsScanning(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!xmlContent.trim() || !scanResult) {
      setErrorMsg('No parsed scan available for import.');
      return;
    }

    setIsImporting(true);
    setErrorMsg('');
    try {
      const options: NmapImportOptions = {
        engagementId: selectedEngagementId || undefined,
        groupId: selectedGroupId || undefined,
        createHostRecords,
        createPortNotes,
        createSummaryNotes,
        createPortFindings,
        onlyUpHosts,
      };

      const summary = await onImportXML({
        xmlContent,
        options,
      });

      setImportSummary(summary);
      onImportSuccess?.(summary);
    } catch (err: unknown) {
      setErrorMsg(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsImporting(false);
    }
  };

  const getScanKindBadge = (kind: string) => {
    switch (kind) {
      case 'alive_check':
        return {
          label: 'ALIVE CHECK // HOST DISCOVERY',
          color: '#00f0ff',
          bg: 'rgba(0, 240, 255, 0.12)',
          border: 'rgba(0, 240, 255, 0.4)',
        };
      case 'port_scan':
        return {
          label: 'FULL PORT & SERVICE SCAN',
          color: '#a855f7',
          bg: 'rgba(168, 85, 247, 0.12)',
          border: 'rgba(168, 85, 247, 0.4)',
        };
      default:
        return {
          label: 'HYBRID HOST & PORT SCAN',
          color: '#f59e0b',
          bg: 'rgba(245, 158, 11, 0.12)',
          border: 'rgba(245, 158, 11, 0.4)',
        };
    }
  };

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Nmap XML Import Modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isImporting) onClose();
      }}
    >
      <div
        className="cyber-dialog-card"
        style={{
          maxWidth: '900px',
          width: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          padding: 0,
        }}
      >
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Pinned Header */}
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#00f0ff', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <CyberIcon name="radar" size={16} /> NMAP XML RECON INGEST
              </h3>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: '#38bdf8',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  marginTop: '2px',
                  letterSpacing: '0.04em',
                }}
              >
                INGEST NMAP -OX // ALIVE HOST DISCOVERY &amp; PORT FINDINGS
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={isImporting}
          >
            ×
          </button>
        </div>

        {/* Scrollable Body */}
        <div
          className="dialog-body"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {errorMsg && <div className="error-banner">{errorMsg}</div>}

          {importSummary ? (
            /* Success Summary View */
            <div
              style={{
                background: 'rgba(0, 240, 255, 0.05)',
                border: '1px solid #00f0ff',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#00f0ff', fontWeight: 700, fontSize: '1rem' }}>
                <CyberIcon name="shield" size={18} /> Ingest Completed Successfully
              </div>
              <div style={{ color: '#e2e8f0', fontSize: '0.85rem', lineHeight: '1.5' }}>
                {importSummary.message}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                <div style={{ background: 'rgba(2, 6, 12, 0.8)', border: '1px solid rgba(0, 240, 255, 0.3)', padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', color: '#00f0ff', fontWeight: 700 }}>{importSummary.createdHosts}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>Created Hosts</div>
                </div>
                <div style={{ background: 'rgba(2, 6, 12, 0.8)', border: '1px solid rgba(0, 240, 255, 0.3)', padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', color: '#38bdf8', fontWeight: 700 }}>{importSummary.updatedHosts}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>Updated Hosts</div>
                </div>
                <div style={{ background: 'rgba(2, 6, 12, 0.8)', border: '1px solid rgba(0, 240, 255, 0.3)', padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', color: '#4ade80', fontWeight: 700 }}>{importSummary.createdNotes}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>Total Notes</div>
                </div>
                <div style={{ background: 'rgba(2, 6, 12, 0.8)', border: '1px solid rgba(0, 240, 255, 0.3)', padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', color: '#a855f7', fontWeight: 700 }}>{importSummary.createdPortNotes}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>Port Subpages</div>
                </div>
                <div style={{ background: 'rgba(2, 6, 12, 0.8)', border: '1px solid rgba(0, 240, 255, 0.3)', padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', color: '#f59e0b', fontWeight: 700 }}>{importSummary.createdPortFindings}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>Port Findings</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* File Dropzone & Manual Paste */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                style={{
                  border: '2px dashed rgba(0, 240, 255, 0.35)',
                  background: 'rgba(4, 9, 18, 0.8)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.65rem',
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                <CyberIcon name="upload" size={24} style={{ color: '#00f0ff' }} />
                <div style={{ textAlign: 'center' }}>
                  <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.85rem' }}>
                    Drag &amp; Drop Nmap XML File (.xml)
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginTop: '2px' }}>
                    Generated with <code>nmap -oX scan.xml &lt;target&gt;</code> (Supports -sn ping sweeps, -sV, -sC)
                  </span>
                </div>
                <label
                  className="cyber-btn cyber-btn-secondary"
                  style={{ cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <CyberIcon name="search" size={12} />
                  <span>Browse XML File...</span>
                  <input
                    type="file"
                    accept=".xml"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              {/* Collapsible raw XML input */}
              <details style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                <summary style={{ cursor: 'pointer', color: '#38bdf8', userSelect: 'none' }}>
                  Paste Raw XML Directly / Edit Content
                </summary>
                <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <textarea
                    className="cyber-hud-input font-mono"
                    rows={5}
                    value={xmlContent}
                    onChange={(e) => setXmlContent(e.target.value)}
                    placeholder="<?xml version='1.0' encoding='UTF-8'?><nmaprun..."
                    style={{ fontSize: '0.72rem', lineHeight: '1.3' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary"
                      onClick={() => void triggerScan(xmlContent)}
                      disabled={isScanning || !xmlContent.trim()}
                      style={{ fontSize: '0.72rem' }}
                    >
                      {isScanning ? 'Analyzing XML...' : 'Parse & Preview XML'}
                    </button>
                  </div>
                </div>
              </details>

              {/* Scan Preview Telemetry & Discovered Hosts */}
              {scanResult && (
                <div
                  style={{
                    background: 'rgba(4, 9, 18, 0.95)',
                    border: '1px solid rgba(0, 240, 255, 0.35)',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem',
                  }}
                >
                  {/* Top Scan Telemetry Bar */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                      borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
                      paddingBottom: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          color: getScanKindBadge(scanResult.scanKind).color,
                          background: getScanKindBadge(scanResult.scanKind).bg,
                          border: `1px solid ${getScanKindBadge(scanResult.scanKind).border}`,
                          letterSpacing: '0.06em',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        {getScanKindBadge(scanResult.scanKind).label}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
                        SCAN ARGS: <code style={{ color: '#38bdf8' }}>{scanResult.args || 'nmap'}</code>
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.74rem', fontFamily: 'JetBrains Mono, monospace' }}>
                      <div>
                        <span style={{ color: '#94a3b8' }}>HOSTS UP: </span>
                        <strong style={{ color: '#00f0ff' }}>{scanResult.upHostsCount}</strong>
                        <span style={{ color: '#64748b' }}> / {scanResult.totalHosts}</span>
                      </div>
                      <div>
                        <span style={{ color: '#94a3b8' }}>OPEN PORTS: </span>
                        <strong style={{ color: '#a855f7' }}>{scanResult.totalOpenPorts}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Discovered Hosts List */}
                  <div>
                    <label className="cyber-label" style={{ marginBottom: '0.45rem' }}>
                      Discovered Hosts ({scanResult.hosts.length})
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '220px', overflowY: 'auto' }}>
                      {scanResult.hosts.map((host: ParsedNmapHost, hIdx: number) => {
                        const isExpanded = expandedHostIndex === hIdx;
                        const isUp = host.state === 'up';

                        return (
                          <div
                            key={hIdx}
                            style={{
                              border: `1px solid ${isUp ? 'rgba(0, 240, 255, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                              background: isExpanded ? 'rgba(0, 240, 255, 0.05)' : 'rgba(2, 6, 12, 0.7)',
                              padding: '0.55rem 0.75rem',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.35rem',
                            }}
                            onClick={() => setExpandedHostIndex(isExpanded ? null : hIdx)}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <span
                                  style={{
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    padding: '1px 5px',
                                    background: isUp ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                    color: isUp ? '#4ade80' : '#ef4444',
                                    border: `1px solid ${isUp ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                                    fontFamily: 'JetBrains Mono, monospace',
                                  }}
                                >
                                  {host.state.toUpperCase()}
                                </span>
                                <strong style={{ color: '#00f0ff', fontSize: '0.82rem', fontFamily: 'JetBrains Mono, monospace' }}>
                                  {host.primaryName}
                                </strong>
                                {host.ipv4 && host.primaryName !== host.ipv4 && (
                                  <span style={{ color: '#94a3b8', fontSize: '0.74rem', fontFamily: 'JetBrains Mono, monospace' }}>
                                    ({host.ipv4})
                                  </span>
                                )}
                                {host.macVendor && (
                                  <span style={{ color: '#64748b', fontSize: '0.7rem' }}>
                                    [{host.macVendor}]
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem' }}>
                                {host.osName && (
                                  <span style={{ color: '#38bdf8' }}>{host.osName}</span>
                                )}
                                <span style={{ color: host.openPorts.length > 0 ? '#a855f7' : '#94a3b8', fontWeight: 600 }}>
                                  {host.openPorts.length} open {host.openPorts.length === 1 ? 'port' : 'ports'}
                                </span>
                                <span style={{ color: '#64748b' }}>{isExpanded ? '▲' : '▼'}</span>
                              </div>
                            </div>

                            {/* Expanded Port & Service Details */}
                            {isExpanded && (
                              <div
                                style={{
                                  marginTop: '0.4rem',
                                  paddingTop: '0.45rem',
                                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                                  fontSize: '0.74rem',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '0.35rem',
                                }}
                              >
                                {host.openPorts.length === 0 ? (
                                  <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                                    No open ports discovered (Alive check / Ping response: {host.reason}).
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                    {host.openPorts.map((p, pIdx) => (
                                      <div
                                        key={pIdx}
                                        style={{
                                          background: 'rgba(2, 6, 12, 0.9)',
                                          border: '1px solid rgba(168, 85, 247, 0.4)',
                                          padding: '2px 8px',
                                          fontFamily: 'JetBrains Mono, monospace',
                                          fontSize: '0.72rem',
                                        }}
                                      >
                                        <span style={{ color: '#c084fc', fontWeight: 700 }}>{p.port}/{p.protocol}</span>{' '}
                                        <span style={{ color: '#e2e8f0' }}>{p.service}</span>
                                        {p.product && <span style={{ color: '#94a3b8' }}> ({p.product} {p.version || ''})</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Target Engagement & Group Selection */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', borderTop: '1px solid rgba(0, 240, 255, 0.2)', paddingTop: '0.65rem' }}>
                    <div>
                      <label className="cyber-label">Assign to Engagement</label>
                      <select
                        className="cyber-hud-select font-mono"
                        value={selectedEngagementId}
                        onChange={(e) => setSelectedEngagementId(e.target.value)}
                      >
                        <option value="">None (Global Scope)</option>
                        {engagements.map((eng) => (
                          <option key={eng.id} value={eng.id}>
                            {eng.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="cyber-label">Place In Host Folder / Group</label>
                      <select
                        className="cyber-hud-select font-mono"
                        value={selectedGroupId}
                        onChange={(e) => setSelectedGroupId(e.target.value)}
                      >
                        <option value="">Root / Unassigned</option>
                        {groups.map((grp) => (
                          <option key={grp.id} value={grp.id}>
                            {grp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Import Configuration Toggles */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', borderTop: '1px solid rgba(0, 240, 255, 0.2)', paddingTop: '0.65rem' }}>
                    <label className="cyber-label" style={{ marginBottom: '0.1rem' }}>Import Artifact Settings</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.45rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', color: '#e2e8f0', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={createHostRecords}
                          onChange={(e) => setCreateHostRecords(e.target.checked)}
                          style={{ accentColor: '#00f0ff' }}
                        />
                        <span>Create / Update Host Records</span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', color: '#e2e8f0', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={createPortNotes}
                          onChange={(e) => setCreatePortNotes(e.target.checked)}
                          style={{ accentColor: '#00f0ff' }}
                        />
                        <span>Generate Note Subpages per Port</span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', color: '#e2e8f0', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={createSummaryNotes}
                          onChange={(e) => setCreateSummaryNotes(e.target.checked)}
                          style={{ accentColor: '#00f0ff' }}
                        />
                        <span>Generate Nmap Scan Summary Note</span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', color: '#e2e8f0', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={createPortFindings}
                          onChange={(e) => setCreatePortFindings(e.target.checked)}
                          style={{ accentColor: '#00f0ff' }}
                        />
                        <span>Create Structured Port Findings</span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', color: '#e2e8f0', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={onlyUpHosts}
                          onChange={(e) => setOnlyUpHosts(e.target.checked)}
                          style={{ accentColor: '#00f0ff' }}
                        />
                        <span>Only Import &apos;UP&apos; Hosts (Skip Dead IPs)</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pinned Footer */}
        <div className="dialog-footer" style={{ flexShrink: 0 }}>
          <button
            type="button"
            className="cyber-btn cyber-btn-secondary"
            onClick={onClose}
            disabled={isImporting}
          >
            {importSummary ? 'Close' : 'Cancel'}
          </button>
          {!importSummary && (
            <button
              type="button"
              className="cyber-btn cyber-btn-primary"
              onClick={handleExecuteImport}
              disabled={isImporting || !scanResult}
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <CyberIcon name="radar" size={13} />
              <span>{isImporting ? 'Ingesting Scan...' : 'Import Into Encrypted Vault'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
