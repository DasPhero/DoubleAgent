import React, { useState, useEffect, useMemo } from 'react';
import {
  Engagement,
  CredentialEntry,
  CredentialCategory,
  SprayFormat,
  SprayExportResult,
} from '../types/pentest';

export interface HostOption {
  id: string;
  label: string;
  address?: string;
}

interface CredentialStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  hosts: HostOption[];
  activeHostId?: string;
}

interface WailsPentestApi {
  ListEngagements?: () => Promise<Engagement[]>;
  GetActiveEngagement?: () => Promise<Engagement | null>;
  SetActiveEngagement?: (id: string) => Promise<void>;
  SaveEngagement?: (e: Engagement) => Promise<void>;
  DeleteEngagement?: (id: string) => Promise<void>;
  ListCredentials?: (engagementId: string, hostId: string) => Promise<CredentialEntry[]>;
  SaveCredential?: (c: CredentialEntry) => Promise<void>;
  DeleteCredential?: (id: string) => Promise<void>;
  ExportSprayList?: (opts: unknown) => Promise<SprayExportResult>;
}

function getPentestApi(): WailsPentestApi | undefined {
  const w = window as unknown as { go?: { main?: { App?: WailsPentestApi } } };
  return w.go?.main?.App;
}

export const CredentialStoreModal: React.FC<CredentialStoreModalProps> = ({
  isOpen,
  onClose,
  hosts,
  activeHostId,
}) => {
  const [activeTab, setActiveTab] = useState<'creds' | 'spray' | 'engagements'>('creds');
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [activeEngagement, setActiveEngagementState] = useState<Engagement | null>(null);
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [selectedCredIds, setSelectedCredIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add/Edit Credential form state
  const [showAddCred, setShowAddCred] = useState(false);
  const [credLabel, setCredLabel] = useState('');
  const [credUsername, setCredUsername] = useState('');
  const [credSecret, setCredSecret] = useState('');
  const [credRealm, setCredRealm] = useState('');
  const [credCategory, setCredCategory] = useState<CredentialCategory>('plaintext');
  const [credHostId, setCredHostId] = useState<string>(activeHostId || '');
  const [credSource, setCredSource] = useState('manual');
  const [credNotes, setCredNotes] = useState('');

  // Spray Generator state
  const [sprayFormat, setSprayFormat] = useState<SprayFormat>('cartesian_product');
  const [customUsers, setCustomUsers] = useState('');
  const [customPasswords, setCustomPasswords] = useState('');
  const [sprayDelimiter, setSprayDelimiter] = useState(':');
  const [sprayResult, setSprayResult] = useState<SprayExportResult | null>(null);
  const [isGeneratingSpray, setIsGeneratingSpray] = useState(false);

  // Engagement form state
  const [newEngName, setNewEngName] = useState('');
  const [newEngScope, setNewEngScope] = useState('');
  const [newEngTimeframe, setNewEngTimeframe] = useState('');
  const [newEngMaxAttempts, setNewEngMaxAttempts] = useState(3);
  const [newEngLockoutWindow, setNewEngLockoutWindow] = useState(30);
  const [newEngDelay, setNewEngDelay] = useState(600);

  const refreshAll = async () => {
    const api = getPentestApi();
    if (!api) return;
    try {
      if (api.ListEngagements) {
        const engs = await api.ListEngagements();
        setEngagements(engs || []);
      }
      if (api.GetActiveEngagement) {
        const act = await api.GetActiveEngagement();
        setActiveEngagementState(act || null);
      }
      if (api.ListCredentials) {
        const creds = await api.ListCredentials('', '');
        setCredentials(creds || []);
      }
    } catch (err: unknown) {
      console.error('Failed to load pentest credentials:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void refreshAll();
      setFeedbackMsg(null);
    }
  }, [isOpen]);

  // Trigger spray list generation whenever spray options change
  useEffect(() => {
    if (activeTab !== 'spray') return;
    const api = getPentestApi();
    if (!api?.ExportSprayList) return;

    let isMounted = true;
    setIsGeneratingSpray(true);

    const credIdsArray = selectedCredIds.size > 0 ? Array.from(selectedCredIds) : [];
    api
      .ExportSprayList({
        engagementId: activeEngagement?.id || '',
        credentialIds: credIdsArray,
        format: sprayFormat,
        customUserList: customUsers,
        customPasswordList: customPasswords,
        delimiter: sprayDelimiter,
      })
      .then((res) => {
        if (isMounted) {
          setSprayResult(res);
          setIsGeneratingSpray(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Spray generation error:', err);
          setIsGeneratingSpray(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, sprayFormat, customUsers, customPasswords, sprayDelimiter, selectedCredIds, activeEngagement]);


  // Filtered credentials list
  const filteredCreds = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return credentials.filter((c) => {
      if (selectedCategory !== 'all' && c.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q) ||
        (c.realm && c.realm.toLowerCase().includes(q)) ||
        (c.source && c.source.toLowerCase().includes(q))
      );
    });
  }, [credentials, searchQuery, selectedCategory]);

  if (!isOpen) return null;

  const handleSaveCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getPentestApi();
    if (!api?.SaveCredential) return;

    if (!credUsername.trim() && !credSecret.trim()) {
      setFeedbackMsg({ type: 'error', text: 'Please provide at least a username or a password/hash.' });
      return;
    }

    try {
      const entry: CredentialEntry = {
        id: `cred-${Date.now()}`,
        engagementId: activeEngagement?.id || '',
        category: credCategory,
        label: credLabel.trim() || credUsername.trim(),
        username: credUsername.trim(),
        secret: credSecret.trim(),
        realm: credRealm.trim() || undefined,
        hostId: credHostId || undefined,
        source: credSource.trim() || 'manual',
        notes: credNotes.trim() || undefined,
        capturedAt: new Date().toISOString(),
      };
      await api.SaveCredential(entry);
      setShowAddCred(false);
      setCredLabel('');
      setCredUsername('');
      setCredSecret('');
      setCredRealm('');
      setCredNotes('');
      setFeedbackMsg({ type: 'success', text: `Saved credential ${entry.label} to pool!` });
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDeleteCred = async (id: string, label: string) => {
    if (!window.confirm(`Delete credential "${label}" from vault?`)) return;
    const api = getPentestApi();
    if (!api?.DeleteCredential) return;
    try {
      await api.DeleteCredential(id);
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSaveEngagement = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getPentestApi();
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
      setNewEngName('');
      setNewEngScope('');
      setNewEngTimeframe('');
      setFeedbackMsg({ type: 'success', text: `Created engagement ${newEng.name}!` });
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSetActiveEngagement = async (id: string) => {
    const api = getPentestApi();
    if (!api?.SetActiveEngagement) return;
    try {
      await api.SetActiveEngagement(id);
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleCopyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch (err: unknown) {
      console.error('Clipboard write error:', err);
    }
  };

  const handleDownloadSprayList = () => {
    if (!sprayResult?.content) return;
    const blob = new Blob([sprayResult.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spray-${sprayFormat}-${activeEngagement?.name || 'engagement'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleSelectCred = (id: string) => {
    const updated = new Set(selectedCredIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedCredIds(updated);
  };

  const selectAllCreds = (select: boolean) => {
    if (select) {
      setSelectedCredIds(new Set(credentials.map((c) => c.id)));
    } else {
      setSelectedCredIds(new Set());
    }
  };


  return (
    <div
      className="cyber-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="credstore-dialog-title"
    >
      <div
        className="cyber-dialog-card credential-store-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '860px', width: '95%' }}
      >
        {/* Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Modal Header */}
        <div className="dialog-header">
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3 id="credstore-dialog-title" style={{ margin: 0, fontSize: '0.98rem', color: '#00f0ff', letterSpacing: '0.06em' }}>
                ⚔️ CREDENTIAL STORE &amp; SPRAY LISTS (F-36 / F-40)
              </h3>
              <div style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                PENTEST MODULE // ENGAGEMENT POOL &amp; LOCKOUT GUARD
                {activeEngagement && (
                  <span style={{ marginLeft: '8px', color: '#10b981', fontWeight: 700 }}>
                    [ENGAGEMENT: {activeEngagement.name.toUpperCase()}]
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Tab Selection */}
        <div
          className="settings-tabs-header"
          style={{
            padding: '0.75rem 1.25rem 0 1.25rem',
            display: 'flex',
            gap: '0.5rem',
            borderBottom: '1px solid rgba(0, 240, 255, 0.15)',
            background: 'rgba(5, 10, 18, 0.5)',
          }}
        >
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'creds' ? 'active' : ''}`}
            onClick={() => setActiveTab('creds')}
          >
            <span>🔑 Credential Pool ({credentials.length})</span>
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'spray' ? 'active' : ''}`}
            onClick={() => setActiveTab('spray')}
          >
            <span>🎯 Spray Generator &amp; Export</span>
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'engagements' ? 'active' : ''}`}
            onClick={() => setActiveTab('engagements')}
          >
            <span>🛡️ Engagements &amp; Lockout Policy</span>
          </button>
        </div>

        {/* Modal Body */}
        <div
          className="dialog-body"
          style={{
            maxHeight: '74vh',
            overflowY: 'auto',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.9rem',
          }}
        >
          {feedbackMsg && (
            <div
              style={{
                background: feedbackMsg.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                border: `1px solid ${feedbackMsg.type === 'error' ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.45)'}`,
                color: feedbackMsg.type === 'error' ? '#fca5a5' : '#6ee7b7',
                padding: '0.55rem 0.85rem',
                fontSize: '0.78rem',
                fontFamily: 'JetBrains Mono, monospace',
                borderRadius: '2px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
              role="alert"
            >
              <span>{feedbackMsg.type === 'error' ? '⚠️' : '✓'}</span>
              <span>{feedbackMsg.text}</span>
            </div>
          )}

          {/* TAB 1: CREDENTIAL POOL */}
          {activeTab === 'creds' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flex: 1, minWidth: '240px' }}>
                  <input
                    type="text"
                    className="cyber-hud-input"
                    placeholder="Search credentials, users, realms, sources..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <select
                    className="cyber-hud-select"
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    style={{ width: '130px', height: '32px' }}
                  >
                    <option value="all">All Types</option>
                    <option value="plaintext">Plaintext</option>
                    <option value="hash">NTLM / Hash</option>
                    <option value="ticket">Kerberos Ticket</option>
                    <option value="token">Token / API</option>
                    <option value="ssh_key">SSH Key</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-primary"
                    onClick={() => setShowAddCred(!showAddCred)}
                  >
                    <span>{showAddCred ? 'Cancel' : '+ Add Credential'}</span>
                  </button>
                </div>
              </div>

              {/* Add Credential Form Inline */}
              {showAddCred && (
                <form
                  onSubmit={handleSaveCredential}
                  style={{
                    background: 'rgba(5, 9, 16, 0.85)',
                    border: '1px solid rgba(0, 240, 255, 0.35)',
                    padding: '1rem',
                    borderRadius: '2px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.04em' }}>
                    REGISTER NEW CREDENTIAL
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '0.75rem' }}>
                    <div>
                      <label className="cyber-label">Username</label>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        placeholder="Administrator"
                        value={credUsername}
                        onChange={(e) => setCredUsername(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="cyber-label">Password / Secret / Hash</label>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        placeholder="Winter2026! or aad3b435..."
                        value={credSecret}
                        onChange={(e) => setCredSecret(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="cyber-label">Category</label>
                      <select
                        className="cyber-hud-select"
                        value={credCategory}
                        onChange={(e) => setCredCategory(e.target.value as CredentialCategory)}
                        style={{ height: '32px' }}
                      >
                        <option value="plaintext">Plaintext</option>
                        <option value="hash">Hash</option>
                        <option value="ticket">Ticket</option>
                        <option value="token">Token</option>
                        <option value="ssh_key">SSH Key</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px', gap: '0.75rem' }}>
                    <div>
                      <label className="cyber-label">Domain / Realm (Optional)</label>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        placeholder="CORP.LOCAL or WORKGROUP"
                        value={credRealm}
                        onChange={(e) => setCredRealm(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="cyber-label">Account Label</label>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        placeholder="Domain Admin Account"
                        value={credLabel}
                        onChange={(e) => setCredLabel(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="cyber-label">Source</label>
                      <select
                        className="cyber-hud-select"
                        value={credSource}
                        onChange={(e) => setCredSource(e.target.value)}
                        style={{ height: '32px' }}
                      >
                        <option value="manual">Manual</option>
                        <option value="lsass">LSASS</option>
                        <option value="sam">SAM</option>
                        <option value="responder">Responder</option>
                        <option value="mimikatz">Mimikatz</option>
                        <option value="kerberoast">Kerberoast</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label className="cyber-label">Associated Host</label>
                      <select
                        className="cyber-hud-select"
                        value={credHostId}
                        onChange={(e) => setCredHostId(e.target.value)}
                        style={{ height: '32px' }}
                      >
                        <option value="">(None - Engagement Pool Only)</option>
                        {hosts.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label} ({h.address})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="cyber-label">Notes</label>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        placeholder="Extracted during initial access..."
                        value={credNotes}
                        onChange={(e) => setCredNotes(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.35rem' }}>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary"
                      onClick={() => setShowAddCred(false)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="cyber-btn cyber-btn-primary">
                      ✓ Save Credential
                    </button>
                  </div>
                </form>
              )}

              {/* Credential Table */}
              <div style={{ border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: '2px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(5, 10, 18, 0.85)', borderBottom: '1px solid rgba(0, 240, 255, 0.2)' }}>
                      <th style={{ padding: '8px', width: '36px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedCredIds.size === credentials.length && credentials.length > 0}
                          onChange={(e) => selectAllCreds(e.target.checked)}
                          style={{ accentColor: '#00f0ff', cursor: 'pointer' }}
                        />
                      </th>
                      <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8' }}>USER &amp; REALM</th>
                      <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8' }}>SECRET / HASH</th>
                      <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8', width: '90px' }}>TYPE</th>
                      <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8', width: '100px' }}>SOURCE</th>
                      <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8', width: '90px' }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCreds.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          No credentials found. Add one above or capture from active sessions.
                        </td>
                      </tr>
                    ) : (
                      filteredCreds.map((c) => {
                        const isRevealed = revealedSecrets.has(c.id);
                        return (
                          <tr
                            key={c.id}
                            style={{
                              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                              background: selectedCredIds.has(c.id) ? 'rgba(0, 240, 255, 0.07)' : 'transparent',
                            }}
                          >
                            <td style={{ padding: '8px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={selectedCredIds.has(c.id)}
                                onChange={() => toggleSelectCred(c.id)}
                                style={{ accentColor: '#00f0ff', cursor: 'pointer' }}
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <div style={{ fontWeight: 600, color: '#f1f5f9' }}>
                                {c.realm ? `${c.realm}\\${c.username}` : c.username}
                              </div>
                              {c.label && c.label !== c.username && (
                                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{c.label}</div>
                              )}
                            </td>
                            <td style={{ padding: '8px', fontFamily: 'JetBrains Mono, monospace' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: isRevealed ? '#00f0ff' : '#94a3b8' }}>
                                  {isRevealed ? c.secret : '••••••••••••'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = new Set(revealedSecrets);
                                    if (next.has(c.id)) next.delete(c.id);
                                    else next.add(c.id);
                                    setRevealedSecrets(next);
                                  }}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    color: '#64748b',
                                  }}
                                  title={isRevealed ? 'Hide secret' : 'Show secret'}
                                >
                                  {isRevealed ? '🙈' : '👁️'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyToClipboard(c.secret, `sec-${c.id}`)}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    color: copiedId === `sec-${c.id}` ? '#10b981' : '#64748b',
                                  }}
                                  title="Copy secret"
                                >
                                  {copiedId === `sec-${c.id}` ? '✓' : '📋'}
                                </button>
                              </div>
                            </td>
                            <td style={{ padding: '8px' }}>
                              <span
                                style={{
                                  background: 'rgba(0, 240, 255, 0.1)',
                                  color: '#00f0ff',
                                  border: '1px solid rgba(0, 240, 255, 0.3)',
                                  padding: '1px 6px',
                                  borderRadius: '2px',
                                  fontSize: '0.68rem',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {c.category}
                              </span>
                            </td>
                            <td style={{ padding: '8px', color: '#94a3b8', fontSize: '0.72rem' }}>
                              {c.source || 'manual'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn-danger btn-sm"
                                style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                                onClick={() => handleDeleteCred(c.id, c.label || c.username)}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: SPRAY GENERATOR & EXPORT */}
          {activeTab === 'spray' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              {/* Lockout Policy Alert / Gauge */}
              {sprayResult?.warning && (
                <div
                  style={{
                    background:
                      sprayResult.warning.severity === 'critical'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'rgba(245, 158, 11, 0.15)',
                    border: `1px solid ${
                      sprayResult.warning.severity === 'critical' ? '#ef4444' : '#f59e0b'
                    }`,
                    color: sprayResult.warning.severity === 'critical' ? '#fca5a5' : '#fde68a',
                    padding: '0.75rem 1rem',
                    borderRadius: '2px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.65rem',
                  }}
                  role="alert"
                >
                  <span style={{ fontSize: '1.25rem', lineHeight: '1' }}>
                    {sprayResult.warning.severity === 'critical' ? '🛑' : '⚠️'}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.84rem' }}>
                      LOCKOUT GUARD WARNING (F-40)
                    </div>
                    <div style={{ fontSize: '0.75rem', marginTop: '2px', lineHeight: '1.4' }}>
                      {sprayResult.warning.message}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', fontFamily: 'JetBrains Mono, monospace' }}>
                      Attempts per Account: {sprayResult.warning.maxAttemptsPerAccount} / Limit: {sprayResult.warning.policyLimit}
                    </div>
                  </div>
                </div>
              )}

              {/* Format Selectors */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <span className="cyber-label">Spray List Output Format (F-36)</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'cartesian_product' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('cartesian_product')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                  >
                    <strong>Cartesian Product</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>All Users × All Passwords</div>
                  </button>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'spray_password_first' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('spray_password_first')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                  >
                    <strong>1 Password Across Users</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Kerbrute / NetExec Spray</div>
                  </button>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'userpass_colon' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('userpass_colon')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                  >
                    <strong>User:Pass Pairs</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Hydra / Basic Auth</div>
                  </button>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'usernames' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('usernames')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                  >
                    <strong>Usernames Only</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Unique account list</div>
                  </button>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'passwords' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('passwords')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                  >
                    <strong>Passwords Only</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Unique wordlist</div>
                  </button>
                </div>
                {(sprayFormat === 'userpass_colon' ||
                  sprayFormat === 'cartesian_product' ||
                  sprayFormat === 'spray_password_first') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                    <span className="cyber-label" style={{ margin: 0 }}>
                      Pair Delimiter:
                    </span>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      value={sprayDelimiter}
                      onChange={(e) => setSprayDelimiter(e.target.value)}
                      style={{ width: '45px', padding: '2px 6px', textAlign: 'center' }}
                    />
                  </div>
                )}
              </div>

              {/* Paste extra user/passwords */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="cyber-label">Extra Candidate Usernames (1 per line)</label>
                  <textarea
                    className="cyber-export-textarea"
                    rows={3}
                    placeholder="guest&#10;svc_scan&#10;operator"
                    value={customUsers}
                    onChange={(e) => setCustomUsers(e.target.value)}
                  />
                </div>
                <div>
                  <label className="cyber-label">Extra Candidate Passwords / Hashes (1 per line)</label>
                  <textarea
                    className="cyber-export-textarea"
                    rows={3}
                    placeholder="Spring2026!&#10;Company2026#&#10;Welcome1"
                    value={customPasswords}
                    onChange={(e) => setCustomPasswords(e.target.value)}
                  />
                </div>
              </div>

              {/* Generated Result Preview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="cyber-label">
                    GENERATED WORDLIST ({sprayResult?.lineCount || 0} LINES / {sprayResult?.uniqueUsers || 0} USERS / {sprayResult?.uniquePasswords || 0} PASSWORDS)
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                      onClick={() => handleCopyToClipboard(sprayResult?.content || '', 'spray-all')}
                    >
                      {copiedId === 'spray-all' ? '✓ Copied' : '📋 Copy All'}
                    </button>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-primary cyber-btn-sm"
                      onClick={handleDownloadSprayList}
                      disabled={!sprayResult?.content}
                    >
                      💾 Download .txt
                    </button>
                  </div>
                </div>
                <textarea
                  className="cyber-export-textarea"
                  rows={8}
                  readOnly
                  value={isGeneratingSpray ? 'Generating spray list...' : sprayResult?.content || ''}
                  style={{ background: '#02050a' }}
                />
              </div>
            </div>
          )}

          {/* TAB 3: ENGAGEMENT & LOCKOUT POLICY */}
          {activeTab === 'engagements' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="cyber-label">CONFIGURED ENGAGEMENTS ({engagements.length})</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {engagements.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      background: e.isActive ? 'rgba(0, 240, 255, 0.08)' : 'rgba(10, 16, 28, 0.85)',
                      border: `1px solid ${e.isActive ? '#00f0ff' : 'rgba(255, 255, 255, 0.1)'}`,
                      padding: '0.75rem 1rem',
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.86rem' }}>{e.name}</span>
                        {e.isActive && (
                          <span
                            style={{
                              background: '#10b981',
                              color: '#040914',
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: '2px',
                            }}
                          >
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px' }}>
                        Scope: {e.scope || 'All'} | Timeframe: {e.timeframe || 'Active'} | Lockout Policy: Max{' '}
                        {e.lockoutPolicy?.maxAttemptsPerUser || 3} attempts per {e.lockoutPolicy?.lockoutWindowMinutes || 30}m
                      </div>
                    </div>
                    <div>
                      {!e.isActive && (
                        <button
                          type="button"
                          className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                          onClick={() => void handleSetActiveEngagement(e.id)}
                        >
                          Set Active
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* New Engagement Form */}
              <form
                onSubmit={handleSaveEngagement}
                style={{
                  background: 'rgba(5, 9, 16, 0.8)',
                  border: '1px solid rgba(0, 240, 255, 0.25)',
                  padding: '1rem',
                  borderRadius: '2px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  marginTop: '0.5rem',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00f0ff' }}>
                  CREATE NEW ENGAGEMENT &amp; LOCKOUT POLICY (F-40)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Engagement Name</label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      placeholder="e.g. Corp Internal Pentest Q4"
                      value={newEngName}
                      onChange={(e) => setNewEngName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Scope / Subnets</label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      placeholder="10.10.10.0/24, dc01.corp.local"
                      value={newEngScope}
                      onChange={(e) => setNewEngScope(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 110px', gap: '0.75rem' }}>
                  <div>
                    <label className="cyber-label">Timeframe</label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      placeholder="Nov 10 - Nov 24, 2026"
                      value={newEngTimeframe}
                      onChange={(e) => setNewEngTimeframe(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Max Attempts</label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      value={newEngMaxAttempts}
                      onChange={(e) => setNewEngMaxAttempts(parseInt(e.target.value, 10) || 1)}
                      min={1}
                      max={20}
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Window (min)</label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      value={newEngLockoutWindow}
                      onChange={(e) => setNewEngLockoutWindow(parseInt(e.target.value, 10) || 1)}
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Delay (sec)</label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      value={newEngDelay}
                      onChange={(e) => setNewEngDelay(parseInt(e.target.value, 10) || 0)}
                      min={0}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                  <button type="submit" className="cyber-btn cyber-btn-primary">
                    + Register Engagement
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
