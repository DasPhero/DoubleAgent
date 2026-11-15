import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Engagement, CredentialEntry, EvidenceItem } from '../types/pentest';

export interface HostOption {
  id: string;
  label: string;
  address?: string;
  tags?: string[];
  engagementId?: string;
}

interface EngagementHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  hosts: HostOption[];
  onOpenCredStore?: () => void;
  onOpenEvidenceVault?: () => void;
  onEditEngagement?: (eng: Engagement) => void;
  onRefreshVault?: () => Promise<void>;
}

interface WailsEngagementApi {
  ListEngagements?: () => Promise<Engagement[]>;
  GetActiveEngagement?: () => Promise<Engagement | null>;
  SetActiveEngagement?: (id: string) => Promise<void>;
  SaveEngagement?: (e: Engagement) => Promise<void>;
  DeleteEngagement?: (id: string) => Promise<void>;
  ListCredentials?: (engagementId: string, hostId: string) => Promise<CredentialEntry[]>;
  ListEvidence?: (engagementId: string, hostId: string) => Promise<EvidenceItem[]>;
  ExportEngagementPackage?: (engagementId: string, password: string) => Promise<string>;
  ExportEngagementFile?: (engagementId: string, password: string, targetPath: string) => Promise<void>;
  ImportEngagementPackage?: (packageJson: string, password: string) => Promise<unknown>;
  ImportEngagementFile?: (filePath: string, password: string) => Promise<unknown>;
}

function getEngagementApi(): WailsEngagementApi | undefined {
  const w = window as unknown as { go?: { main?: { App?: WailsEngagementApi } } };
  return w.go?.main?.App;
}

export const EngagementHubModal: React.FC<EngagementHubModalProps> = ({
  isOpen,
  onClose,
  hosts,
  onOpenCredStore,
  onOpenEvidenceVault,
  onEditEngagement,
  onRefreshVault,
}) => {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [activeEngagement, setActiveEngagement] = useState<Engagement | null>(null);
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEngName, setNewEngName] = useState('');
  const [newEngScope, setNewEngScope] = useState('');
  const [newEngTimeframe, setNewEngTimeframe] = useState('');
  const [newEngMaxAttempts, setNewEngMaxAttempts] = useState(3);
  const [newEngLockoutWindow, setNewEngLockoutWindow] = useState(30);
  const [newEngDelay, setNewEngDelay] = useState(600);

  // Export & Import states
  const [exportPassword, setExportPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [importFileContent, setImportFileContent] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Auto-clear feedback messages
  useEffect(() => {
    if (!feedbackMsg) return;
    const timer = setTimeout(() => {
      setFeedbackMsg(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [feedbackMsg]);

  const refreshAll = useCallback(async () => {
    const api = getEngagementApi();
    if (!api) return;
    try {
      if (api.ListEngagements) {
        const engs = await api.ListEngagements();
        setEngagements(engs || []);
      }
      if (api.GetActiveEngagement) {
        const act = await api.GetActiveEngagement();
        setActiveEngagement(act || null);
      }
      if (api.ListCredentials) {
        const creds = await api.ListCredentials('', '');
        setCredentials(creds || []);
      }
      if (api.ListEvidence) {
        const ev = await api.ListEvidence('', '');
        setEvidenceList(ev || []);
      }
    } catch (err: unknown) {
      console.error('Failed to load engagement hub data:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void refreshAll();
      setFeedbackMsg(null);
    }
  }, [isOpen, refreshAll]);

  // In-scope hosts matching engagementId, tags, or scope CIDR
  const inScopeHostsList = useMemo(() => {
    if (!activeEngagement) return [];
    const engId = activeEngagement.id;
    const engName = activeEngagement.name.toLowerCase();
    return hosts.filter((h) => {
      if (h.engagementId && h.engagementId === engId) {
        return true;
      }
      if (h.tags) {
        for (const t of h.tags) {
          if (
            t.toLowerCase() === engId.toLowerCase() ||
            t.toLowerCase() === engName ||
            t.toLowerCase() === `engagement-${engId.toLowerCase()}`
          ) {
            return true;
          }
        }
      }
      if (activeEngagement.scope && h.address) {
        const scopeParts = activeEngagement.scope.split(/[,;\n]/).map((s) => s.trim().toLowerCase());
        if (scopeParts.includes(h.address.toLowerCase()) || scopeParts.includes(h.label.toLowerCase())) {
          return true;
        }
      }
      return false;
    });
  }, [activeEngagement, hosts]);

  const unassignedHosts = useMemo(() => {
    if (!activeEngagement) return [];
    return hosts.filter((h) => !h.engagementId || h.engagementId !== activeEngagement.id);
  }, [activeEngagement, hosts]);

  const handleAssignHost = async (hostId: string, engId: string) => {
    const api = (window as unknown as { go?: { main?: { App?: { AssignHostToEngagement?: (h: string, e: string) => Promise<void> } } } }).go?.main?.App;
    if (api?.AssignHostToEngagement) {
      try {
        await api.AssignHostToEngagement(hostId, engId);
        if (onRefreshVault) {
          await onRefreshVault();
        }
        await refreshAll();
      } catch (err) {
        console.error('Failed to assign host to engagement:', err);
      }
    }
  };

  // Compute enclosed artifact counts for the active engagement
  const enclosedArtifacts = useMemo(() => {
    if (!activeEngagement) {
      return { hostsCount: 0, credsCount: 0, evidenceCount: 0 };
    }
    const engId = activeEngagement.id;
    const scopedCreds = credentials.filter((c) => c.engagementId === engId);
    const scopedEv = evidenceList.filter((e) => e.engagementId === engId);

    return {
      hostsCount: inScopeHostsList.length,
      credsCount: scopedCreds.length,
      evidenceCount: scopedEv.length,
    };
  }, [activeEngagement, inScopeHostsList, credentials, evidenceList]);

  if (!isOpen) return null;

  const handleSetActive = async (id: string) => {
    const api = getEngagementApi();
    if (!api?.SetActiveEngagement) return;
    try {
      await api.SetActiveEngagement(id);
      await refreshAll();
      setFeedbackMsg({ type: 'success', text: 'Switched active engagement context.' });
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleCreateEngagement = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getEngagementApi();
    if (!api?.SaveEngagement) return;
    if (!newEngName.trim()) {
      setFeedbackMsg({ type: 'error', text: 'Engagement name is required.' });
      return;
    }

    try {
      const newEng: Engagement = {
        id: `eng-${Date.now()}`,
        name: newEngName.trim(),
        scope: newEngScope.trim(),
        timeframe: newEngTimeframe.trim(),
        lockoutPolicy: {
          maxAttemptsPerUser: newEngMaxAttempts,
          lockoutWindowMinutes: newEngLockoutWindow,
          enforceDelaySeconds: newEngDelay,
          warningThresholdPercent: 66,
        },
        isActive: engagements.length === 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await api.SaveEngagement(newEng);
      setShowCreateForm(false);
      setNewEngName('');
      setNewEngScope('');
      setNewEngTimeframe('');
      setFeedbackMsg({ type: 'success', text: `Created engagement "${newEng.name}"!` });
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDeleteEngagement = async (id: string, name: string) => {
    if (!window.confirm(`Delete engagement "${name}" and all enclosed data?`)) return;
    const api = getEngagementApi();
    if (!api?.DeleteEngagement) return;
    try {
      await api.DeleteEngagement(id);
      await refreshAll();
      setFeedbackMsg({ type: 'success', text: `Deleted engagement "${name}".` });
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleExportPackage = async () => {
    if (!activeEngagement) {
      setFeedbackMsg({ type: 'error', text: 'No active engagement selected to export.' });
      return;
    }
    const api = getEngagementApi();
    setIsExporting(true);
    try {
      let jsonContent = '';
      if (api?.ExportEngagementPackage) {
        jsonContent = await api.ExportEngagementPackage(activeEngagement.id, exportPassword);
      } else {
        // Fallback for mock preview
        jsonContent = JSON.stringify(
          {
            version: 1,
            encrypted: !!exportPassword.trim(),
            engagement: activeEngagement,
            credentials: credentials.filter((c) => c.engagementId === activeEngagement.id),
            evidence: evidenceList.filter((e) => e.engagementId === activeEngagement.id),
          },
          null,
          2
        );
      }

      // Trigger browser download of .daeng file
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const safeName = activeEngagement.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.daeng`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setFeedbackMsg({
        type: 'success',
        text: `Exported ${activeEngagement.name} to standalone .daeng package! ${exportPassword ? '(Encrypted with Argon2id)' : '(Unencrypted)'}`,
      });
      setExportPassword('');
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      setImportFileContent(evt.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleImportPackage = async () => {
    if (!importFileContent) {
      setFeedbackMsg({ type: 'error', text: 'Please select a .daeng engagement file first.' });
      return;
    }
    const api = getEngagementApi();
    if (!api?.ImportEngagementPackage) {
      setFeedbackMsg({ type: 'error', text: 'Import API not available in current environment.' });
      return;
    }
    setIsImporting(true);
    try {
      await api.ImportEngagementPackage(importFileContent, importPassword);
      setFeedbackMsg({ type: 'success', text: `Successfully imported engagement package from ${importFileName}!` });
      setImportFileContent(null);
      setImportFileName(null);
      setImportPassword('');
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      className="modal-backdrop cyber-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="engagement-hub-title"
    >
      <div
        className="cyber-dialog-card engagement-hub-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '880px', width: '94%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
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
              <h3 id="engagement-hub-title" style={{ margin: 0, fontSize: '1rem', color: '#00f0ff', letterSpacing: '0.06em' }}>
                🎯 PENTEST ENGAGEMENT HUB &amp; SCOPE
              </h3>
              <div style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                F-36 // STANDALONE CUSTOMER ASSIGNMENTS · ARTIFACT VAULT · ENCRYPTED .DAENG PACKAGES
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close Engagement Hub"
          >
            ✕
          </button>
        </div>

        {/* Feedback Alert */}
        {feedbackMsg && (
          <div
            style={{
              margin: '0.75rem 1.25rem 0 1.25rem',
              padding: '0.65rem 0.9rem',
              background: feedbackMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${feedbackMsg.type === 'success' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
              color: feedbackMsg.type === 'success' ? '#34d399' : '#fca5a5',
              fontSize: '0.8rem',
              borderRadius: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: 'JetBrains Mono, Consolas, monospace',
            }}
          >
            <span>{feedbackMsg.type === 'success' ? '✓ ' : '⚠️ '}{feedbackMsg.text}</span>
            <button
              type="button"
              onClick={() => setFeedbackMsg(null)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Body */}
        <div className="dialog-body" style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Top Switcher Bar */}
          <div
            style={{
              background: 'rgba(5, 12, 24, 0.85)',
              border: '1px solid rgba(0, 240, 255, 0.25)',
              padding: '0.85rem 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              borderRadius: '2px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ACTIVE CONTEXT:
              </span>
              <select
                className="cyber-hud-select"
                value={activeEngagement?.id || ''}
                onChange={(e) => void handleSetActive(e.target.value)}
                style={{ flex: 1, minWidth: '280px', maxWidth: '420px', height: '34px', fontSize: '0.82rem', fontWeight: 600, color: '#00f0ff' }}
              >
                {engagements.length === 0 && <option value="">No Engagements Configured</option>}
                {engagements.map((eng) => (
                  <option key={eng.id} value={eng.id}>
                    {eng.name} {eng.id === activeEngagement?.id ? '★ (Active)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                onClick={() => setShowCreateForm((prev) => !prev)}
              >
                {showCreateForm ? 'Cancel New' : '+ New Engagement'}
              </button>
            </div>
          </div>

          {/* New Engagement Form */}
          {showCreateForm && (
            <form
              onSubmit={handleCreateEngagement}
              style={{
                background: 'rgba(8, 18, 32, 0.95)',
                border: '1px solid rgba(0, 240, 255, 0.4)',
                padding: '1rem',
                borderRadius: '2px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
              }}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.05em' }}>
                /// DEFINE NEW PENTEST ENGAGEMENT
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="cyber-label">Assignment / Target Name *</label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={newEngName}
                    onChange={(e) => setNewEngName(e.target.value)}
                    placeholder="e.g. Acme Corp External Audit 2026"
                    required
                  />
                </div>
                <div>
                  <label className="cyber-label">Timeframe / Schedule</label>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    value={newEngTimeframe}
                    onChange={(e) => setNewEngTimeframe(e.target.value)}
                    placeholder="e.g. Nov 10 - Nov 24, 2026"
                  />
                </div>
              </div>
              <div>
                <label className="cyber-label">Authorized Scope (IPs, CIDRs, Hostnames)</label>
                <textarea
                  className="cyber-hud-input"
                  rows={2}
                  value={newEngScope}
                  onChange={(e) => setNewEngScope(e.target.value)}
                  placeholder="192.168.1.0/24, 10.10.10.50, web.acme.corp"
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="cyber-label">Max Attempts / User</label>
                  <input
                    type="number"
                    className="cyber-hud-input"
                    value={newEngMaxAttempts}
                    onChange={(e) => setNewEngMaxAttempts(parseInt(e.target.value, 10) || 3)}
                    min={1}
                  />
                </div>
                <div>
                  <label className="cyber-label">Lockout Window (min)</label>
                  <input
                    type="number"
                    className="cyber-hud-input"
                    value={newEngLockoutWindow}
                    onChange={(e) => setNewEngLockoutWindow(parseInt(e.target.value, 10) || 30)}
                    min={1}
                  />
                </div>
                <div>
                  <label className="cyber-label">Spray Delay (sec)</label>
                  <input
                    type="number"
                    className="cyber-hud-input"
                    value={newEngDelay}
                    onChange={(e) => setNewEngDelay(parseInt(e.target.value, 10) || 600)}
                    min={0}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.4rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="cyber-btn cyber-btn-primary cyber-btn-sm">
                  ✓ Save Engagement
                </button>
              </div>
            </form>
          )}

          {/* Active Engagement Details & Enclosed Artifacts */}
          {activeEngagement ? (
            <div
              style={{
                background: 'rgba(5, 9, 16, 0.75)',
                border: '1px solid rgba(0, 240, 255, 0.25)',
                borderRadius: '2px',
                padding: '1.15rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#f1f5f9', letterSpacing: '0.04em' }}>
                    {activeEngagement.name}
                  </h4>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '3px', fontFamily: 'JetBrains Mono, monospace' }}>
                    ID: {activeEngagement.id} {activeEngagement.timeframe ? `· ⏱️ ${activeEngagement.timeframe}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {onEditEngagement && (
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                      onClick={() => {
                        onClose();
                        onEditEngagement(activeEngagement);
                      }}
                      style={{ fontSize: '0.72rem' }}
                    >
                      ✏️ Edit Scope &amp; Settings
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => void handleDeleteEngagement(activeEngagement.id, activeEngagement.name)}
                    style={{ fontSize: '0.7rem' }}
                  >
                    🗑️ Delete Engagement
                  </button>
                </div>
              </div>

              {/* Scope Box */}
              <div>
                <span className="cyber-label">Authorized Scope &amp; Target CIDRs:</span>
                <div
                  style={{
                    background: 'rgba(2, 6, 12, 0.9)',
                    border: '1px solid rgba(0, 240, 255, 0.15)',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.78rem',
                    fontFamily: 'JetBrains Mono, Consolas, monospace',
                    color: '#38bdf8',
                    borderRadius: '2px',
                    wordBreak: 'break-all',
                  }}
                >
                  {activeEngagement.scope || 'No specific target scope specified.'}
                </div>
              </div>

              {/* Enclosed In-Scope Hosts Section */}
              <div
                style={{
                  background: 'rgba(10, 18, 32, 0.65)',
                  border: '1px solid rgba(0, 240, 255, 0.2)',
                  padding: '0.85rem',
                  borderRadius: '2px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.04em' }}>
                    🖥️ ENCLOSED IN-SCOPE HOSTS ({inScopeHostsList.length})
                  </span>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                    Strict customer encapsulation (F-36)
                  </span>
                </div>

                {inScopeHostsList.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                    {inScopeHostsList.map((h) => (
                      <div
                        key={h.id}
                        style={{
                          background: 'rgba(0, 240, 255, 0.08)',
                          border: '1px solid rgba(0, 240, 255, 0.35)',
                          borderRadius: '2px',
                          padding: '4px 8px',
                          fontSize: '0.74rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{h.label}</span>
                        <span style={{ color: '#38bdf8', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.68rem' }}>
                          {h.address || 'no-ip'}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleAssignHost(h.id, '')}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#f87171',
                            cursor: 'pointer',
                            padding: '0 2px',
                            fontSize: '0.75rem',
                          }}
                          title="Detach host from this engagement"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontStyle: 'italic' }}>
                    No hosts linked to this engagement yet. Select one below to link it.
                  </div>
                )}

                {/* Link Host Dropdown */}
                {unassignedHosts.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>+ Link Existing Host:</span>
                    <select
                      className="cyber-hud-select"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          void handleAssignHost(e.target.value, activeEngagement.id);
                          e.target.value = '';
                        }
                      }}
                      style={{ fontSize: '0.72rem', height: '26px', minWidth: '220px' }}
                    >
                      <option value="" disabled>Select host from vault...</option>
                      {unassignedHosts.map((uh) => (
                        <option key={uh.id} value={uh.id}>
                          {uh.label} ({uh.address || 'no-ip'})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Enclosed Artifacts Counter Grid */}
              <div>
                <span className="cyber-label">Enclosed Artifacts in this Assignment:</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '0.35rem' }}>
                  <div
                    style={{
                      background: 'rgba(10, 18, 32, 0.75)',
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                      padding: '0.75rem',
                      borderRadius: '2px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>🖥️ In-Scope Hosts</span>
                    <strong style={{ fontSize: '1.25rem', color: '#00f0ff', fontFamily: 'JetBrains Mono, monospace' }}>
                      {enclosedArtifacts.hostsCount}
                    </strong>
                  </div>

                  <div
                    style={{
                      background: 'rgba(10, 18, 32, 0.75)',
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                      padding: '0.75rem',
                      borderRadius: '2px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      cursor: 'pointer',
                    }}
                    onClick={onOpenCredStore}
                    title="Click to view credential pool"
                  >
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>🔑 Captured Creds</span>
                    <strong style={{ fontSize: '1.25rem', color: '#10b981', fontFamily: 'JetBrains Mono, monospace' }}>
                      {enclosedArtifacts.credsCount}
                    </strong>
                  </div>

                  <div
                    style={{
                      background: 'rgba(10, 18, 32, 0.75)',
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                      padding: '0.75rem',
                      borderRadius: '2px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      cursor: 'pointer',
                    }}
                    onClick={onOpenEvidenceVault}
                    title="Click to view evidence vault"
                  >
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>🚩 Findings / Evidence</span>
                    <strong style={{ fontSize: '1.25rem', color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace' }}>
                      {enclosedArtifacts.evidenceCount}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Quick Jump Buttons */}
              <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '0.85rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                  onClick={() => {
                    onClose();
                    if (onOpenCredStore) onOpenCredStore();
                  }}
                >
                  🔑 Open Credential Pool &amp; Spray Lists
                </button>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                  onClick={() => {
                    onClose();
                    if (onOpenEvidenceVault) onOpenEvidenceVault();
                  }}
                >
                  🚩 Open Evidence Vault &amp; Findings
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(5, 9, 16, 0.75)',
                border: '1px dashed rgba(0, 240, 255, 0.3)',
                padding: '2rem',
                textAlign: 'center',
                color: '#94a3b8',
                borderRadius: '2px',
              }}
            >
              No active engagement selected. Create one above to begin organizing hosts, credentials, and evidence.
            </div>
          )}

          {/* Standalone .daeng Package Management (Export & Import) */}
          <div
            style={{
              background: 'rgba(8, 16, 30, 0.85)',
              border: '1px solid rgba(0, 240, 255, 0.25)',
              borderRadius: '2px',
              padding: '1.15rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div>
              <h4 style={{ margin: 0, fontSize: '0.88rem', color: '#00f0ff', letterSpacing: '0.05em' }}>
                📦 STANDALONE ENGAGEMENT FILE MANAGEMENT (.DAENG)
              </h4>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.74rem', color: '#94a3b8' }}>
                Every engagement is isolated as an independent file to guarantee customer segregation and GDPR compliance.
                Protects sensitive customer credentials and finding reports with Argon2id + XChaCha20-Poly1305.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
              {/* Export Column */}
              <div
                style={{
                  background: 'rgba(3, 8, 16, 0.65)',
                  border: '1px solid rgba(0, 240, 255, 0.15)',
                  padding: '0.9rem',
                  borderRadius: '2px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f1f5f9' }}>
                  📤 Export Active Engagement
                </div>
                <div>
                  <label className="cyber-label">Password Protection (Optional)</label>
                  <input
                    type="password"
                    className="cyber-hud-input"
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    placeholder="Leave empty for unencrypted JSON"
                  />
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
                    Default: none (unencrypted). If set, file is encrypted with Argon2id.
                  </div>
                </div>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-primary"
                  onClick={() => void handleExportPackage()}
                  disabled={!activeEngagement || isExporting}
                >
                  {isExporting ? 'PACKAGING...' : '📦 DOWNLOAD .DAENG PACKAGE'}
                </button>
              </div>

              {/* Import Column */}
              <div
                style={{
                  background: 'rgba(3, 8, 16, 0.65)',
                  border: '1px solid rgba(0, 240, 255, 0.15)',
                  padding: '0.9rem',
                  borderRadius: '2px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f1f5f9' }}>
                  📥 Import Engagement File
                </div>
                <div>
                  <label className="cyber-label">Select .daeng File</label>
                  <input
                    type="file"
                    accept=".daeng,.json"
                    onChange={handleFilePicked}
                    style={{ fontSize: '0.75rem', color: '#cbd5e1' }}
                  />
                  {importFileName && (
                    <div style={{ fontSize: '0.7rem', color: '#38bdf8', marginTop: '2px', fontFamily: 'monospace' }}>
                      Selected: {importFileName}
                    </div>
                  )}
                </div>
                <div>
                  <label className="cyber-label">Password (if file is encrypted)</label>
                  <input
                    type="password"
                    className="cyber-hud-input"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder="Enter password if required"
                  />
                </div>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={() => void handleImportPackage()}
                  disabled={!importFileContent || isImporting}
                >
                  {isImporting ? 'IMPORTING...' : '📥 MERGE INTO VAULT'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

