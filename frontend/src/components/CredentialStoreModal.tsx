import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  tags?: string[];
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

// Built-in starter wordlist presets
const WORDLIST_PRESETS = {
  topPasswords: [
    'Password123!',
    'Welcome123!',
    'Winter2026!',
    'Spring2026!',
    'Summer2026!',
    'Autumn2026!',
    'Admin2026!',
    'Company2026#',
    'ChangeMe123!',
    'P@ssw0rd2026',
    'Root1234!',
    'ServicePass2026!',
    'SolarWinds123',
    '12345678',
    'qwerty1234',
  ].join('\n'),
  rockyouSample: [
    '123456',
    'password',
    '12345678',
    'qwerty',
    '123456789',
    '12345',
    '1234',
    '111111',
    '1234567',
    'dragon',
    'welcome',
    'football',
    'monkey',
    'princess',
    'shadow',
    'master',
    'michael',
    'computer',
    'iloveyou',
    'access',
    'superman',
    'password1',
    'secret',
    'admin',
  ].join('\n'),
  adDefaults: [
    'Summer2026!',
    'Summer2025!',
    'Winter2026!',
    'Winter2025!',
    'Spring2026!',
    'Autumn2026!',
    'Welcome1!',
    'Welcome2026!',
    'Password1!',
    'Company123!',
    'ResetMe123!',
    'Monday2026!',
  ].join('\n'),
  commonUsers: [
    'administrator',
    'admin',
    'root',
    'svc_backup',
    'svc_sql',
    'svc_scan',
    'helpdesk',
    'operator',
    'guest',
    'test',
    'user',
    'deploy',
  ].join('\n'),
};

export const CredentialStoreModal: React.FC<CredentialStoreModalProps> = ({
  isOpen,
  onClose,
  hosts,
  activeHostId,
}) => {
  // Tabs: 1 = creds, 2 = spray
  const [activeTab, setActiveTab] = useState<'creds' | 'spray'>('creds');
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [activeEngagement, setActiveEngagementState] = useState<Engagement | null>(null);
  const [selectedEngagementId, setSelectedEngagementId] = useState<string>('');
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [selectedCredIds, setSelectedCredIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Defensive Lockout Policy State (editable in spray tab)
  const [policyMaxAttempts, setPolicyMaxAttempts] = useState(3);
  const [policyLockoutWindow, setPolicyLockoutWindow] = useState(30);
  const [policyDelay, setPolicyDelay] = useState(600);
  const [policyWarningThreshold, setPolicyWarningThreshold] = useState(66);

  // Add/Edit Credential form state
  const [showAddCred, setShowAddCred] = useState(false);
  const [editingCredId, setEditingCredId] = useState<string | null>(null);
  const [credLabel, setCredLabel] = useState('');
  const [credUsername, setCredUsername] = useState('');
  const [credSecret, setCredSecret] = useState('');
  const [credRealm, setCredRealm] = useState('');
  const [credCategory, setCredCategory] = useState<CredentialCategory>('plaintext');
  const [credHostId, setCredHostId] = useState<string>(activeHostId || '');
  const [credSource, setCredSource] = useState('manual');
  const [credNotes, setCredNotes] = useState('');

  // Spray Generator state
  const [sprayFormat, setSprayFormat] = useState<SprayFormat>('userpass_colon');
  const [customUsers, setCustomUsers] = useState('');
  const [customPasswords, setCustomPasswords] = useState('');
  const [sprayDelimiter, setSprayDelimiter] = useState(':');
  const [sprayResult, setSprayResult] = useState<SprayExportResult | null>(null);
  const [isGeneratingSpray, setIsGeneratingSpray] = useState(false);

  // Auto-clear feedback messages after 3.5s
  useEffect(() => {
    if (!feedbackMsg) return;
    const timer = setTimeout(() => {
      setFeedbackMsg(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [feedbackMsg]);

  // Clear feedback on tab switch
  useEffect(() => {
    setFeedbackMsg(null);
  }, [activeTab]);

  const refreshAll = useCallback(async () => {
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
        setSelectedEngagementId(act?.id || '');
      }
      if (api.ListCredentials) {
        const creds = await api.ListCredentials('', '');
        setCredentials(creds || []);
      }
    } catch (err: unknown) {
      console.error('Failed to load pentest credentials:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void refreshAll();
      setFeedbackMsg(null);
    }
  }, [isOpen, refreshAll]);

  // Sync lockout policy fields when selectedEngagementId changes
  useEffect(() => {
    const currentEng = engagements.find((e) => e.id === selectedEngagementId);
    if (currentEng?.lockoutPolicy) {
      setPolicyMaxAttempts(currentEng.lockoutPolicy.maxAttemptsPerUser ?? 3);
      setPolicyLockoutWindow(currentEng.lockoutPolicy.lockoutWindowMinutes ?? 30);
      setPolicyDelay(currentEng.lockoutPolicy.enforceDelaySeconds ?? 600);
      setPolicyWarningThreshold(currentEng.lockoutPolicy.warningThresholdPercent ?? 66);
    }
  }, [selectedEngagementId, engagements]);

  const handleEngagementChange = async (newId: string) => {
    setSelectedEngagementId(newId);
    setSelectedCredIds(new Set());
    const api = getPentestApi();
    if (api?.SetActiveEngagement) {
      try {
        await api.SetActiveEngagement(newId || 'none');
        if (api.GetActiveEngagement) {
          const act = await api.GetActiveEngagement();
          setActiveEngagementState(act || null);
        }
      } catch (err: unknown) {
        console.error('Failed to update active engagement:', err);
      }
    }
  };

  const handleSaveLockoutPolicy = async () => {
    if (!selectedEngagementId) {
      setFeedbackMsg({ type: 'error', text: 'Select an engagement to persist lockout policy.' });
      return;
    }
    const currentEng = engagements.find((e) => e.id === selectedEngagementId);
    if (!currentEng) return;
    const api = getPentestApi();
    if (!api?.SaveEngagement) return;
    try {
      const updated: Engagement = {
        ...currentEng,
        lockoutPolicy: {
          maxAttemptsPerUser: policyMaxAttempts,
          lockoutWindowMinutes: policyLockoutWindow,
          enforceDelaySeconds: policyDelay,
          warningThresholdPercent: policyWarningThreshold,
        },
        updatedAt: new Date().toISOString(),
      };
      await api.SaveEngagement(updated);
      setFeedbackMsg({ type: 'success', text: `Saved defensive lockout policy for ${updated.name}!` });
      await refreshAll();
    } catch (err: unknown) {
      setFeedbackMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

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
        engagementId: selectedEngagementId,
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
  }, [activeTab, sprayFormat, customUsers, customPasswords, sprayDelimiter, selectedCredIds, selectedEngagementId]);

  // Filtered credentials list — strict encapsulation
  const filteredCreds = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return credentials.filter((c) => {
      if (!selectedEngagementId) {
        // Casual / No Engagement: show only unattached global credentials
        if (c.engagementId) return false;
      } else {
        // Customer Engagement: strictly show ONLY credentials tagged for this engagement
        if (c.engagementId !== selectedEngagementId) return false;
      }
      if (selectedCategory !== 'all' && c.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q) ||
        (c.realm && c.realm.toLowerCase().includes(q)) ||
        (c.source && c.source.toLowerCase().includes(q))
      );
    });
  }, [credentials, searchQuery, selectedCategory, selectedEngagementId]);

  if (!isOpen) return null;

  const handleOpenAddCred = () => {
    setEditingCredId(null);
    setCredLabel('');
    setCredUsername('');
    setCredSecret('');
    setCredRealm('');
    setCredCategory('plaintext');
    setCredHostId(activeHostId || '');
    setCredSource('manual');
    setCredNotes('');
    setShowAddCred(true);
  };

  const handleEditCred = (c: CredentialEntry) => {
    setEditingCredId(c.id);
    setCredLabel(c.label || '');
    setCredUsername(c.username || '');
    setCredSecret(c.secret || '');
    setCredRealm(c.realm || '');
    setCredCategory(c.category || 'plaintext');
    setCredHostId(c.hostId || '');
    setCredSource(c.source || 'manual');
    setCredNotes(c.notes || '');
    setShowAddCred(true);
  };

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
        id: editingCredId || `cred-${Date.now()}`,
        engagementId: selectedEngagementId || '',
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
      setEditingCredId(null);
      setCredLabel('');
      setCredUsername('');
      setCredSecret('');
      setCredRealm('');
      setCredNotes('');
      setFeedbackMsg({
        type: 'success',
        text: editingCredId ? `Updated credential ${entry.label}!` : `Saved credential ${entry.label} to pool!`,
      });
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
      setFeedbackMsg({ type: 'success', text: `Deleted credential ${label}.` });
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

  // SSH Key file reader
  const handleKeyFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) {
        setCredSecret(content.trim());
        if (!credLabel.trim()) {
          setCredLabel(file.name);
        }
      }
    };
    reader.readAsText(file);
  };

  // Generic Wordlist file reader for Spray Generator
  const handleWordlistFilePicked = (e: React.ChangeEvent<HTMLInputElement>, target: 'passwords' | 'users') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) {
        if (target === 'passwords') {
          setCustomPasswords(content.trim());
        } else {
          setCustomUsers(content.trim());
        }
        setFeedbackMsg({ type: 'success', text: `Loaded wordlist from ${file.name}!` });
      }
    };
    reader.readAsText(file);
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
        style={{ maxWidth: '880px', width: '95%' }}
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
                ⚔️ CREDENTIAL STORE &amp; SPRAY LISTS
              </h3>
              <div style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                PENTEST MODULE // ENGAGEMENT POOL &amp; LOCKOUT GUARD
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

        {/* Target Engagement Selector Bar */}
        <div
          style={{
            background: 'rgba(5, 12, 24, 0.95)',
            borderBottom: '1px solid rgba(0, 240, 255, 0.2)',
            padding: '0.65rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '0.76rem', color: '#00f0ff', fontWeight: 700, letterSpacing: '0.04em' }}>
              🎯 TARGET ENGAGEMENT:
            </span>
            <select
              className="cyber-hud-select"
              value={selectedEngagementId}
              onChange={(e) => void handleEngagementChange(e.target.value)}
              style={{ fontSize: '0.78rem', height: '32px', minWidth: '320px', borderColor: 'rgba(0, 240, 255, 0.45)', padding: '2px 8px' }}
            >
              <option value="">🌐 No Engagement (Casual / Global Pool)</option>
              {engagements.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  🎯 {eng.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: '0.72rem', color: selectedEngagementId ? '#10b981' : '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
            {selectedEngagementId
              ? `[ENCAPSULATED: ${engagements.find((e) => e.id === selectedEngagementId)?.name.toUpperCase()}]`
              : '[CASUAL MODE: GLOBAL UNATTACHED POOL]'}
          </div>
        </div>

        {/* Tab Selection — 2 Tabs: 1. Pool, 2. Spray */}
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
            <span>🔑 1. Credential Pool ({filteredCreds.length})</span>
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'spray' ? 'active' : ''}`}
            onClick={() => setActiveTab('spray')}
          >
            <span>⚡ 2. Spray Generator &amp; Wordlists</span>
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
                justifyContent: 'space-between',
              }}
              role="alert"
            >
              <span>{feedbackMsg.type === 'error' ? '⚠️ ' : '✓ '}{feedbackMsg.text}</span>
              <button
                type="button"
                onClick={() => setFeedbackMsg(null)}
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* TAB 1: CREDENTIAL POOL */}
          {activeTab === 'creds' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* Context Summary Bar */}
              <div
                style={{
                  background: 'rgba(5, 12, 24, 0.75)',
                  border: '1px solid rgba(0, 240, 255, 0.2)',
                  padding: '0.65rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderRadius: '2px',
                  fontSize: '0.78rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: '#00f0ff', fontWeight: 700 }}>POOL SCOPE:</span>
                  <span style={{ color: '#f1f5f9', fontWeight: 600 }}>
                    {selectedEngagementId
                      ? `Enclosed to ${engagements.find((e) => e.id === selectedEngagementId)?.name || selectedEngagementId}`
                      : 'Casual / Global Pool (No Engagement)'}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  Showing {filteredCreds.length} credentials
                </div>
              </div>

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
                    onClick={handleOpenAddCred}
                  >
                    <span>+ Add Credential</span>
                  </button>
                </div>
              </div>

              {/* Add/Edit Credential Form Inline */}
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
                    {editingCredId ? '/// EDIT CREDENTIAL' : '/// REGISTER NEW CREDENTIAL'}
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
                      <label className="cyber-label">
                        {credCategory === 'ssh_key' ? 'SSH Key / Private Key Data' : 'Password / Secret / Hash'}
                      </label>
                      {credCategory === 'ssh_key' ? (
                        <textarea
                          className="cyber-export-textarea"
                          rows={3}
                          placeholder="Paste PEM / OpenSSH private key or pick file below..."
                          value={credSecret}
                          onChange={(e) => setCredSecret(e.target.value)}
                          required
                        />
                      ) : (
                        <input
                          type="text"
                          className="cyber-hud-input"
                          placeholder="Winter2026! or aad3b435..."
                          value={credSecret}
                          onChange={(e) => setCredSecret(e.target.value)}
                          required
                        />
                      )}
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

                  {/* SSH Key File Selector Helper */}
                  {credCategory === 'ssh_key' && (
                    <div style={{ background: 'rgba(0, 240, 255, 0.05)', padding: '0.5rem', borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>📂 Load Key File:</span>
                      <input
                        type="file"
                        accept=".pem,.pub,.key,.id_rsa,.id_ed25519,.ppk,text/plain"
                        onChange={handleKeyFilePicked}
                        style={{ fontSize: '0.75rem', color: '#cbd5e1' }}
                      />
                    </div>
                  )}

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
                      ✓ {editingCredId ? 'Update Credential' : 'Save Credential'}
                    </button>
                  </div>
                </form>
              )}

              {/* Credential Table with Edit and Delete */}
              <div style={{ border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: '2px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(5, 10, 18, 0.85)', borderBottom: '1px solid rgba(0, 240, 255, 0.2)' }}>
                      <th style={{ padding: '8px', width: '36px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedCredIds.size === filteredCreds.length && filteredCreds.length > 0}
                          onChange={(e) => selectAllCreds(e.target.checked)}
                          style={{ accentColor: '#00f0ff', cursor: 'pointer' }}
                        />
                      </th>
                      <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8' }}>USER &amp; REALM</th>
                      <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8' }}>SECRET / HASH</th>
                      <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8', width: '90px' }}>TYPE</th>
                      <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8', width: '90px' }}>SOURCE</th>
                      <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8', width: '130px' }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCreds.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                          No credentials found for this scope. Add one above or capture from active sessions.
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
                                  {isRevealed
                                    ? c.secret.length > 36
                                      ? `${c.secret.slice(0, 36)}...`
                                      : c.secret
                                    : '••••••••••••'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = new Set(revealedSecrets);
                                    if (next.has(c.id)) next.delete(c.id);
                                    else next.add(c.id);
                                    setRevealedSecrets(next);
                                  }}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#64748b' }}
                                  title={isRevealed ? 'Hide secret' : 'Show secret'}
                                >
                                  {isRevealed ? '🙈' : '👁️'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyToClipboard(c.secret, `sec-${c.id}`)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px', color: copiedId === `sec-${c.id}` ? '#10b981' : '#64748b' }}
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
                                className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                                style={{ fontSize: '0.68rem', padding: '2px 6px', marginRight: '4px' }}
                                onClick={() => handleEditCred(c)}
                                title="Edit credential"
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                className="btn-danger btn-sm"
                                style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                                onClick={() => handleDeleteCred(c.id, c.label || c.username)}
                                title="Delete credential"
                              >
                                ✕
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

          {/* TAB 2: SPRAY GENERATOR & WORDLISTS */}
          {activeTab === 'spray' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              {/* Defensive Lockout Policy Configuration */}
              <div
                style={{
                  background: 'rgba(5, 12, 24, 0.85)',
                  border: '1px solid rgba(0, 240, 255, 0.25)',
                  padding: '0.75rem 1rem',
                  borderRadius: '2px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.04em' }}>
                      🛡️ DEFENSIVE LOCKOUT POLICY &amp; SPRAY GUARD
                    </span>
                    {selectedEngagementId ? (
                      <span style={{ fontSize: '0.68rem', color: '#10b981', fontFamily: 'JetBrains Mono, monospace' }}>
                        [{engagements.find((e) => e.id === selectedEngagementId)?.name}]
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
                        [Casual / Temporary Policy]
                      </span>
                    )}
                  </div>
                  {selectedEngagementId && (
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                      onClick={() => void handleSaveLockoutPolicy()}
                    >
                      💾 Save Policy to Engagement
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.65rem' }}>
                  <div>
                    <label className="cyber-label">Max Attempts / User</label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      value={policyMaxAttempts}
                      onChange={(e) => setPolicyMaxAttempts(parseInt(e.target.value, 10) || 3)}
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Lockout Window (min)</label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      value={policyLockoutWindow}
                      onChange={(e) => setPolicyLockoutWindow(parseInt(e.target.value, 10) || 30)}
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Delay Between Sprays (sec)</label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      value={policyDelay}
                      onChange={(e) => setPolicyDelay(parseInt(e.target.value, 10) || 600)}
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="cyber-label">Warning Threshold (%)</label>
                    <input
                      type="number"
                      className="cyber-hud-input"
                      value={policyWarningThreshold}
                      onChange={(e) => setPolicyWarningThreshold(parseInt(e.target.value, 10) || 66)}
                      min={10}
                      max={100}
                    />
                  </div>
                </div>
              </div>

              {/* Lockout Warning Bar */}
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
                      LOCKOUT GUARD WARNING
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

              {/* Format Selectors with Clear Distinction */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <span className="cyber-label">Spray Generator Mode &amp; Output Format</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'userpass_colon' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('userpass_colon')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                    title="Pairs users directly 1:1 with corresponding passwords without cross-multiplying."
                  >
                    <strong>1:1 User:Pass Pairs</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Direct Match (Credential Stuffing)</div>
                  </button>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'spray_password_first' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('spray_password_first')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                    title="Tests 1 password across all accounts, then pauses. Evades Active Directory lockout."
                  >
                    <strong>1 Password Across Users</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Password-First (Evades Lockout)</div>
                  </button>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'cartesian_product' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('cartesian_product')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                    title="Tests every password on user 1, then user 2. Rapidly triggers lockout."
                  >
                    <strong>Cartesian Product</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>All Users × All Passwords</div>
                  </button>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'usernames' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('usernames')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                  >
                    <strong>Usernames Only</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Unique target accounts</div>
                  </button>
                  <button
                    type="button"
                    className={`hud-preset-pill ${sprayFormat === 'passwords' ? 'active' : ''}`}
                    onClick={() => setSprayFormat('passwords')}
                    style={{ padding: '6px 10px', textAlign: 'left' }}
                  >
                    <strong>Passwords Only</strong>
                    <div style={{ fontSize: '10px', opacity: 0.8 }}>Extracted / candidate words</div>
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
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      (colon ':' for Hydra/BasicAuth, tab '\t', or comma ',')
                    </span>
                  </div>
                )}
              </div>

              {/* Wordlist Presets & Load File Bar */}
              <div
                style={{
                  background: 'rgba(5, 12, 22, 0.75)',
                  border: '1px solid rgba(0, 240, 255, 0.15)',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', color: '#00f0ff', fontWeight: 700 }}>WORDLIST PRESETS:</span>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    onClick={() => setCustomPasswords(WORDLIST_PRESETS.topPasswords)}
                  >
                    Top Passwords
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    onClick={() => setCustomPasswords(WORDLIST_PRESETS.adDefaults)}
                  >
                    AD Seasonal Defaults
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    onClick={() => setCustomPasswords(WORDLIST_PRESETS.rockyouSample)}
                  >
                    RockYou Sample
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    onClick={() => setCustomUsers(WORDLIST_PRESETS.commonUsers)}
                  >
                    Common Users
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    style={{ cursor: 'pointer', margin: 0 }}
                  >
                    📂 Load Wordlist (.txt)
                    <input
                      type="file"
                      accept=".txt,.lst,.wordlist"
                      onChange={(e) => handleWordlistFilePicked(e, 'passwords')}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>

              {/* Paste extra user/passwords */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <label className="cyber-label" style={{ margin: 0 }}>Candidate Usernames (1 per line)</label>
                    <button
                      type="button"
                      onClick={() => setCustomUsers('')}
                      style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: '10px', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  </div>
                  <textarea
                    className="cyber-export-textarea"
                    rows={4}
                    placeholder="guest&#10;svc_scan&#10;operator"
                    value={customUsers}
                    onChange={(e) => setCustomUsers(e.target.value)}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <label className="cyber-label" style={{ margin: 0 }}>Candidate Passwords / Hashes (1 per line)</label>
                    <button
                      type="button"
                      onClick={() => setCustomPasswords('')}
                      style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: '10px', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  </div>
                  <textarea
                    className="cyber-export-textarea"
                    rows={4}
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
        </div>
      </div>
    </div>
  );
};
