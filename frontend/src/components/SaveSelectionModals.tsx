import React, { useState, useEffect } from 'react';
import { CyberIcon } from './CyberIcon';
import {
  CredentialCategory,
  CredentialEntry,
  EvidenceItem,
  EvidenceSeverity,
  FindingItem,
} from '../types/pentest';
import { NotePage } from '../types/note';

export interface HostSummaryOption {
  id: string;
  label: string;
  address: string;
}

export interface EngagementSummaryOption {
  id: string;
  name: string;
}

// -------------------------------------------------------------
// Helper: Smart Heuristic Parsing for Terminal Selection
// -------------------------------------------------------------
export function parseCredentialSelection(raw: string): {
  username: string;
  secret: string;
  category: CredentialCategory;
  labelSuggestion: string;
} {
  const trimmed = raw.trim();

  // 1. Detect SSH Private/Public Key
  if (
    trimmed.startsWith('-----BEGIN ') ||
    trimmed.startsWith('ssh-ed25519') ||
    trimmed.startsWith('ssh-rsa') ||
    trimmed.startsWith('PuTTY-User-Key-File')
  ) {
    return {
      username: '',
      secret: trimmed,
      category: 'ssh_key',
      labelSuggestion: 'SSH Key (Terminal Capture)',
    };
  }

  // 2. Detect Tokens / API Keys
  if (
    trimmed.startsWith('ey') || // JWT
    trimmed.startsWith('ghp_') || // GitHub Personal Access Token
    trimmed.startsWith('glpat-') || // GitLab
    trimmed.startsWith('AKIA') || // AWS Access Key
    trimmed.startsWith('bearer ') ||
    trimmed.startsWith('Bearer ')
  ) {
    const cleanToken = trimmed.replace(/^bearer\s+/i, '');
    return {
      username: '',
      secret: cleanToken,
      category: 'api_key',
      labelSuggestion: 'API Token (Terminal Capture)',
    };
  }

  // 3. Detect user:pass or DOMAIN\user:pass
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0 && !trimmed.includes('://') && colonIdx < trimmed.length - 1) {
    const userCandidate = trimmed.substring(0, colonIdx).trim();
    const passCandidate = trimmed.substring(colonIdx + 1).trim();

    // Verify it doesn't look like multi-line text or a sentence
    if (!userCandidate.includes('\n') && !userCandidate.includes(' ') && userCandidate.length <= 64) {
      // Check if passCandidate is a hash (32 hex = NTLM/MD5, 64 hex = SHA256)
      const isHex = /^[0-9a-fA-F]{32}$/.test(passCandidate) || /^[0-9a-fA-F]{64}$/.test(passCandidate);
      return {
        username: userCandidate,
        secret: passCandidate,
        category: isHex ? 'hash' : 'plaintext',
        labelSuggestion: `${userCandidate} Account`,
      };
    }
  }

  // 4. Detect standalone 32-char or 64-char Hash
  if (/^[0-9a-fA-F]{32}$/.test(trimmed) || /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return {
      username: '',
      secret: trimmed,
      category: 'hash',
      labelSuggestion: 'Hash (Terminal Capture)',
    };
  }

  // 5. Default single password / secret string
  return {
    username: '',
    secret: trimmed,
    category: 'plaintext',
    labelSuggestion: 'Terminal Password',
  };
}

// -------------------------------------------------------------
// Component: SaveSelectionCredModal
// -------------------------------------------------------------
export interface SaveSelectionCredModalProps {
  isOpen: boolean;
  selectedText: string;
  initialHostId?: string;
  hosts: HostSummaryOption[];
  initialEngagementId?: string;
  engagements: EngagementSummaryOption[];
  onSave: (cred: CredentialEntry) => Promise<void>;
  onClose: () => void;
}

export function SaveSelectionCredModal({
  isOpen,
  selectedText,
  initialHostId,
  hosts,
  initialEngagementId,
  engagements,
  onSave,
  onClose,
}: SaveSelectionCredModalProps): React.JSX.Element | null {
  const [username, setUsername] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [category, setCategory] = useState<CredentialCategory>('plaintext');
  const [label, setLabel] = useState<string>('');
  const [realm, setRealm] = useState<string>('');
  const [hostId, setHostId] = useState<string>(initialHostId || '');
  const [engagementId, setEngagementId] = useState<string>(initialEngagementId || '');
  const [notes, setNotes] = useState<string>('');
  const [tagsInput, setTagsInput] = useState<string>('terminal, captured');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen && selectedText) {
      const parsed = parseCredentialSelection(selectedText);
      setUsername(parsed.username);
      setSecret(parsed.secret);
      setCategory(parsed.category);
      setLabel(parsed.labelSuggestion);
      setHostId(initialHostId || '');
      setEngagementId(initialEngagementId || '');
      setNotes(`Captured from terminal selection on ${new Date().toLocaleString()}`);
      setErrorMsg('');
    }
  }, [isOpen, selectedText, initialHostId, initialEngagementId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() && !secret.trim()) {
      setErrorMsg('Please specify either a username or a password/secret.');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');
    try {
      const entry: CredentialEntry = {
        id: `cred-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        engagementId: engagementId || '',
        category,
        label: label.trim() || `${username || 'Credential'} (Terminal)`,
        username: username.trim(),
        secret: secret.trim(),
        realm: realm.trim() || undefined,
        hostId: hostId || undefined,
        source: 'terminal_selection',
        notes: notes.trim() || undefined,
        capturedAt: new Date().toISOString(),
        tags: tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };

      await onSave(entry);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(`Failed to save credential: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const matchedHost = hosts.find((h) => h.id === hostId);

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-label="Save Terminal Selection as Credential"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cyber-dialog-card"
        style={{
          maxWidth: '620px',
          width: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          padding: 0,
        }}
      >
        {/* Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Pinned Header */}
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                <CyberIcon name="key" size={14} /> Save Terminal Selection as Credential
              </h3>
              <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                CREDENTIAL-INGEST // AUTO-ASSOCIATE HOST &amp; ENGAGEMENT POOL
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        {/* Form Container (Wraps scrollable body and pinned footer) */}
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          {/* Scrollable Form Body */}
          <div
            className="dialog-body"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {errorMsg && <div className="error-banner">{errorMsg}</div>}

            {/* Association Telemetry Banner */}
            <div
              style={{
                background: 'color-mix(in srgb, var(--accent-bright) 5%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                padding: '0.55rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
              }}
            >
              <div>
                <span style={{ color: '#94a3b8' }}>SOURCE: </span>
                <strong style={{ color: 'var(--accent-bright)' }}>Terminal Selection</strong>
              </div>
              {matchedHost && (
                <div>
                  <span style={{ color: '#94a3b8' }}>ASSOCIATED HOST: </span>
                  <strong style={{ color: 'var(--accent-bright)' }}>{matchedHost.label || matchedHost.address}</strong>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="cred-scope-engagement">
                  Pentest Engagement
                </label>
                <select
                  id="cred-scope-engagement"
                  className="cyber-hud-select"
                  value={engagementId}
                  onChange={(e) => setEngagementId(e.target.value)}
                >
                  <option value=""><CyberIcon name="globe" size={14} /> Global / No Engagement</option>
                  {engagements.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      <CyberIcon name="target" size={14} /> {eng.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="cred-scope-host">
                  Associated Host
                </label>
                <select
                  id="cred-scope-host"
                  className="cyber-hud-select"
                  value={hostId}
                  onChange={(e) => setHostId(e.target.value)}
                >
                  <option value="">(No specific host)</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      <CyberIcon name="desktop" size={14} /> {h.label} ({h.address})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="cred-label">
                  Credential Label / Name
                </label>
                <input
                  id="cred-label"
                  className="cyber-hud-input"
                  placeholder="e.g. Root Admin Account"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="cyber-label" htmlFor="cred-category">
                  Category
                </label>
                <select
                  id="cred-category"
                  className="cyber-hud-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CredentialCategory)}
                >
                  <option value="plaintext">Plaintext Password</option>
                  <option value="hash">NTLM / Unix Hash</option>
                  <option value="api_key">API Key / Token</option>
                  <option value="ssh_key">SSH Private Key</option>
                  <option value="ticket">Kerberos Ticket</option>
                  <option value="token">Web Session Token</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="cred-username">
                  Username / Identity
                </label>
                <input
                  id="cred-username"
                  className="cyber-hud-input font-mono"
                  placeholder="e.g. root, admin, svc_backup"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div>
                <label className="cyber-label" htmlFor="cred-realm">
                  Domain / Realm (Optional)
                </label>
                <input
                  id="cred-realm"
                  className="cyber-hud-input font-mono"
                  placeholder="e.g. CORP.LOCAL"
                  value={realm}
                  onChange={(e) => setRealm(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="cyber-label" htmlFor="cred-secret">
                Password / Secret / Hash / Key Content
              </label>
              <textarea
                id="cred-secret"
                className="cyber-hud-input font-mono"
                style={{ minHeight: '85px', resize: 'vertical' }}
                placeholder="Captured secret from terminal..."
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="cred-tags">
                  Tags (Comma-Separated)
                </label>
                <input
                  id="cred-tags"
                  className="cyber-hud-input"
                  placeholder="terminal, captured, privileged"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
              </div>
              <div>
                <label className="cyber-label" htmlFor="cred-notes">
                  Notes / Context
                </label>
                <input
                  id="cred-notes"
                  className="cyber-hud-input"
                  placeholder="Command or output source notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Pinned Footer */}
          <div className="dialog-footer" style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cyber-btn cyber-btn-primary"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : <><CyberIcon name="save" size={14} /> Save to Vault</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Component: SaveSelectionEvidenceModal
// -------------------------------------------------------------
export interface SaveSelectionEvidenceModalProps {
  isOpen: boolean;
  selectedText: string;
  initialHostId?: string;
  hosts: HostSummaryOption[];
  initialEngagementId?: string;
  engagements: EngagementSummaryOption[];
  findings?: FindingItem[];
  categories?: string[];
  onSave: (evidence: EvidenceItem) => Promise<void>;
  onClose: () => void;
}

const DEFAULT_CATEGORIES = [
  'Sensitive Data',
  'Vulnerabilities',
  'Privilege Escalation',
  'Active Directory',
  'Web Applications',
  'Cloud Infrastructure',
  'Artificial Intelligence / LLM',
  'Credentials',
  'Network Discovery',
];

export function SaveSelectionEvidenceModal({
  isOpen,
  selectedText,
  initialHostId,
  hosts,
  initialEngagementId,
  engagements,
  findings = [],
  categories = DEFAULT_CATEGORIES,
  onSave,
  onClose,
}: SaveSelectionEvidenceModalProps): React.JSX.Element | null {
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<string>('Sensitive Data');
  const [severity, setSeverity] = useState<EvidenceSeverity>('medium');
  const [content, setContent] = useState<string>('');
  const [hostId, setHostId] = useState<string>(initialHostId || '');
  const [engagementId, setEngagementId] = useState<string>(initialEngagementId || '');
  const [findingId, setFindingId] = useState<string>('');
  const [inReport, setInReport] = useState<boolean>(true);
  const [tagsInput, setTagsInput] = useState<string>('terminal, evidence');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen && selectedText) {
      const firstLine = selectedText.trim().split('\n')[0] || '';
      const summaryTitle =
        firstLine.length > 0 && firstLine.length <= 48
          ? `Evidence Proof: ${firstLine}`
          : 'Terminal Evidence Proof';

      setTitle(summaryTitle);
      setContent(selectedText.trim());
      setCategory('Sensitive Data');
      setSeverity('medium');
      setHostId(initialHostId || '');
      setEngagementId(initialEngagementId || '');
      setFindingId('');
      setInReport(true);
      setErrorMsg('');
    }
  }, [isOpen, selectedText, initialHostId, initialEngagementId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setErrorMsg('Please specify both a title and evidence content.');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');
    try {
      const item: EvidenceItem = {
        id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        engagementId: engagementId || '',
        findingId: findingId || undefined,
        category,
        title: title.trim(),
        type: 'text',
        content: content.trim(),
        hostId: hostId || undefined,
        severity,
        capturedAt: new Date().toISOString(),
        source: 'terminal_selection',
        inReport,
        tags: tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };

      await onSave(item);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(`Failed to save evidence: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const matchedHost = hosts.find((h) => h.id === hostId);

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-label="Save Terminal Selection as Evidence Finding"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cyber-dialog-card"
        style={{
          maxWidth: '660px',
          width: '95vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          padding: 0,
        }}
      >
        {/* Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Pinned Header */}
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                <CyberIcon name="shield" size={14} /> Save Terminal Selection as Evidence
              </h3>
              <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                EVIDENCE-STORE // LOG PROOF &amp; ASSOCIATE WITH ENGAGEMENT TARGET
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        {/* Form Container (Wraps scrollable body and pinned footer) */}
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          {/* Scrollable Form Body */}
          <div
            className="dialog-body"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {errorMsg && <div className="error-banner">{errorMsg}</div>}

            {/* Association Telemetry Banner */}
            <div
              style={{
                background: 'color-mix(in srgb, var(--accent-bright) 5%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                padding: '0.55rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
              }}
            >
              <div>
                <span style={{ color: '#94a3b8' }}>SOURCE: </span>
                <strong style={{ color: 'var(--accent-bright)' }}>Terminal Output</strong>
              </div>
              {matchedHost && (
                <div>
                  <span style={{ color: '#94a3b8' }}>HOST: </span>
                  <strong style={{ color: 'var(--accent-bright)' }}>{matchedHost.label || matchedHost.address}</strong>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="ev-engagement">
                  Pentest Engagement
                </label>
                <select
                  id="ev-engagement"
                  className="cyber-hud-select"
                  value={engagementId}
                  onChange={(e) => setEngagementId(e.target.value)}
                >
                  <option value=""><CyberIcon name="globe" size={14} /> Global / No Engagement</option>
                  {engagements.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      <CyberIcon name="target" size={14} /> {eng.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="ev-host">
                  Associated Target Host
                </label>
                <select
                  id="ev-host"
                  className="cyber-hud-select"
                  value={hostId}
                  onChange={(e) => setHostId(e.target.value)}
                >
                  <option value="">(No specific host)</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      <CyberIcon name="desktop" size={14} /> {h.label} ({h.address})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="cyber-label" htmlFor="ev-title">
                Evidence Artifact Title
              </label>
              <input
                id="ev-title"
                className="cyber-hud-input"
                placeholder="e.g. Mimikatz LSASS Dump on DC01 or /etc/shadow extract"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="ev-category">
                  Evidence Category
                </label>
                <select
                  id="ev-category"
                  className="cyber-hud-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="ev-finding">
                  Attach to Finding (Optional)
                </label>
                <select
                  id="ev-finding"
                  className="cyber-hud-select"
                  value={findingId}
                  onChange={(e) => setFindingId(e.target.value)}
                >
                  <option value="">(None - Standalone Internal Evidence)</option>
                  {findings.map((f) => (
                    <option key={f.id} value={f.id}>
                      <CyberIcon name="target" size={14} /> [{(f.severity || 'info').toUpperCase()}] {f.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="cyber-label" htmlFor="ev-content">
                Captured Forensic Proof / Terminal Artifact
              </label>
              <textarea
                id="ev-content"
                className="cyber-hud-input font-mono"
                style={{ minHeight: '120px', resize: 'vertical' }}
                placeholder="Captured terminal evidence text..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
            </div>

            {/* In-Report Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.5rem 0.75rem',
                background: inReport ? 'color-mix(in srgb, var(--accent-bright) 5%, transparent)' : 'rgba(100, 116, 139, 0.1)',
                border: inReport ? '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)' : '1px solid rgba(100, 116, 139, 0.3)',
              }}
            >
              <input
                type="checkbox"
                id="ev-in-report"
                checked={inReport}
                onChange={(e) => setInReport(e.target.checked)}
                style={{ accentColor: 'var(--accent-bright)', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label
                htmlFor="ev-in-report"
                style={{
                  fontSize: '0.8rem',
                  color: inReport ? 'var(--accent-bright)' : '#94a3b8',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  userSelect: 'none',
                }}
              >
                {inReport
                  ? <><CyberIcon name="file" size={14} /> Include in Assessment Report (Reportable Finding Proof)</>
                  : <><CyberIcon name="lock" size={14} /> Internal Vault Evidence Only (Excluded from Client Report)</>}
              </label>
            </div>

            <div>
              <label className="cyber-label" htmlFor="ev-tags">
                Tags (Comma-Separated)
              </label>
              <input
                id="ev-tags"
                className="cyber-hud-input"
                placeholder="terminal, proof, mimikatz, hash"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>
          </div>

          {/* Pinned Footer */}
          <div className="dialog-footer" style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cyber-btn cyber-btn-primary"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : <><CyberIcon name="shield" size={14} /> Save to Evidence Vault</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Component: SaveSelectionNoteModal (For Recon, Nmap outputs, & Logs)
// -------------------------------------------------------------
export interface SaveSelectionNoteModalProps {
  isOpen: boolean;
  selectedText: string;
  initialHostId?: string;
  hosts: HostSummaryOption[];
  initialEngagementId?: string;
  engagements: EngagementSummaryOption[];
  onSave: (note: NotePage) => Promise<void>;
  onClose: () => void;
}

export function SaveSelectionNoteModal({
  isOpen,
  selectedText,
  initialHostId,
  hosts,
  initialEngagementId,
  engagements,
  onSave,
  onClose,
}: SaveSelectionNoteModalProps): React.JSX.Element | null {
  const [title, setTitle] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [hostId, setHostId] = useState<string>(initialHostId || '');
  const [engagementId, setEngagementId] = useState<string>(initialEngagementId || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen && selectedText) {
      const firstLine = selectedText.trim().split('\n')[0] || '';
      const summaryTitle =
        firstLine.length > 0 && firstLine.length <= 48
          ? `Recon Output: ${firstLine}`
          : 'Reconnaissance & Scan Notes';

      setTitle(summaryTitle);
      setBody(selectedText.trim());
      setHostId(initialHostId || '');
      setEngagementId(initialEngagementId || '');
      setErrorMsg('');
    }
  }, [isOpen, selectedText, initialHostId, initialEngagementId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setErrorMsg('Please specify both a note title and note body.');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');
    try {
      const now = new Date().toISOString();
      const note: NotePage = {
        id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        hostId: hostId || undefined,
        engagementId: engagementId || undefined,
        title: title.trim(),
        type: 'markdown',
        body: body.trim(),
        isFolder: false,
        order: 0,
        createdAt: now,
        updatedAt: now,
      };

      await onSave(note);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(`Failed to save note: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const matchedHost = hosts.find((h) => h.id === hostId);

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-label="Save Terminal Selection to Host Notes"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div
        className="cyber-dialog-card modal-container"
        style={{
          width: '640px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Four Corner Reticles */}
        <span className="corner-reticle reticle-tl" />
        <span className="corner-reticle reticle-tr" />
        <span className="corner-reticle reticle-bl" />
        <span className="corner-reticle reticle-br" />

        {/* Pinned Header */}
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span className="cyber-hazard-stripes" style={{ fontSize: '1.25rem', color: 'var(--accent-bright)' }}>
              ///
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--accent-bright)', letterSpacing: '0.05em' }}>
                <CyberIcon name="note" size={14} /> Save to Host / Engagement Notes
              </h3>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--accent-bright)',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  marginTop: '2px',
                  letterSpacing: '0.04em',
                }}
              >
                DOCUMENTATION // RECON &amp; SCAN SCRATCHPAD
              </div>
            </div>
          </div>
          <button type="button" className="cyber-btn-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <div
            className="dialog-body"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {errorMsg && <div className="error-banner">{errorMsg}</div>}

            <div
              style={{
                background: 'color-mix(in srgb, var(--accent-bright) 5%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                padding: '0.55rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
              }}
            >
              <div>
                <span style={{ color: '#94a3b8' }}>SOURCE: </span>
                <strong style={{ color: 'var(--accent-bright)' }}>Terminal Output (Nmap / Recon)</strong>
              </div>
              {matchedHost && (
                <div>
                  <span style={{ color: '#94a3b8' }}>TARGET: </span>
                  <strong style={{ color: 'var(--accent-bright)' }}>{matchedHost.label || matchedHost.address}</strong>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="note-engagement">
                  Pentest Engagement
                </label>
                <select
                  id="note-engagement"
                  className="cyber-hud-select"
                  value={engagementId}
                  onChange={(e) => setEngagementId(e.target.value)}
                >
                  <option value=""><CyberIcon name="globe" size={14} /> Global / No Engagement</option>
                  {engagements.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      <CyberIcon name="target" size={14} /> {eng.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="note-host">
                  Associated Host
                </label>
                <select
                  id="note-host"
                  className="cyber-hud-select"
                  value={hostId}
                  onChange={(e) => setHostId(e.target.value)}
                >
                  <option value="">(Global Workspace Note)</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      <CyberIcon name="desktop" size={14} /> {h.label} ({h.address})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="cyber-label" htmlFor="note-title">
                Note Title / Section
              </label>
              <input
                id="note-title"
                className="cyber-hud-input"
                placeholder="e.g. Nmap Port Scan & Service Enumeration"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="cyber-label" htmlFor="note-body">
                Markdown Body / Scan Log
              </label>
              <textarea
                id="note-body"
                className="cyber-hud-input font-mono"
                style={{ minHeight: '180px', resize: 'vertical' }}
                placeholder="Paste or edit scan findings..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Pinned Footer */}
          <div className="dialog-footer" style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button type="submit" className="cyber-btn cyber-btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : <><CyberIcon name="note" size={14} /> Save to Notes</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Component: SaveSelectionFindingModal (Directly Creates Finding with Attached Evidence)
// -------------------------------------------------------------
export interface SaveSelectionFindingModalProps {
  isOpen: boolean;
  selectedText: string;
  initialHostId?: string;
  hosts: HostSummaryOption[];
  initialEngagementId?: string;
  engagements: EngagementSummaryOption[];
  categories?: string[];
  onSave: (finding: FindingItem, evidence: EvidenceItem) => Promise<void>;
  onClose: () => void;
}

export function SaveSelectionFindingModal({
  isOpen,
  selectedText,
  initialHostId,
  hosts,
  initialEngagementId,
  engagements,
  categories = DEFAULT_CATEGORIES,
  onSave,
  onClose,
}: SaveSelectionFindingModalProps): React.JSX.Element | null {
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<string>('Vulnerabilities');
  const [severity, setSeverity] = useState<EvidenceSeverity>('high');
  const [cve, setCve] = useState<string>('');
  const [mitreAttack, setMitreAttack] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [remediation, setRemediation] = useState<string>('');
  const [evidenceContent, setEvidenceContent] = useState<string>('');
  const [inReport, setInReport] = useState<boolean>(true);
  const [hostId, setHostId] = useState<string>(initialHostId || '');
  const [engagementId, setEngagementId] = useState<string>(initialEngagementId || '');
  const [tagsInput, setTagsInput] = useState<string>('finding, vulnerability');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen && selectedText) {
      const firstLine = selectedText.trim().split('\n')[0] || '';
      const summaryTitle =
        firstLine.length > 0 && firstLine.length <= 48
          ? `Vulnerability: ${firstLine}`
          : 'Security Finding';

      setTitle(summaryTitle);
      setDescription(`Observed vulnerable behavior in console output:\n\n\`\`\`text\n${selectedText.trim()}\n\`\`\``);
      setEvidenceContent(selectedText.trim());
      setCategory('Vulnerabilities');
      setSeverity('high');
      setRemediation('');
      setHostId(initialHostId || '');
      setEngagementId(initialEngagementId || '');
      setInReport(true);
      setErrorMsg('');
    }
  }, [isOpen, selectedText, initialHostId, initialEngagementId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setErrorMsg('Please specify both a finding title and vulnerability description.');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');
    try {
      const now = new Date().toISOString();
      const findingId = `find-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const evidenceId = `ev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const evidence: EvidenceItem = {
        id: evidenceId,
        engagementId: engagementId || '',
        findingId,
        category,
        title: `Proof of Concept: ${title.trim()}`,
        type: 'text',
        content: evidenceContent.trim() || selectedText.trim(),
        hostId: hostId || undefined,
        severity,
        capturedAt: now,
        source: 'terminal_selection',
        inReport,
        tags: ['poc', 'terminal_proof'],
      };

      const finding: FindingItem = {
        id: findingId,
        engagementId: engagementId || '',
        title: title.trim(),
        category,
        severity,
        status: 'draft',
        hostId: hostId || undefined,
        affectedHosts: hostId ? [hostId] : undefined,
        description: description.trim(),
        remediation: remediation.trim() || undefined,
        cve: cve.trim() || undefined,
        mitreAttack: mitreAttack.trim() || undefined,
        evidenceIds: [evidenceId],
        createdAt: now,
        updatedAt: now,
        tags: tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };

      await onSave(finding, evidence);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(`Failed to create finding: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const matchedHost = hosts.find((h) => h.id === hostId);

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-label="Create Finding from Terminal Selection"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div
        className="cyber-dialog-card modal-container"
        style={{
          width: '740px',
          maxWidth: '92vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Four Corner Reticles */}
        <span className="corner-reticle reticle-tl" />
        <span className="corner-reticle reticle-tr" />
        <span className="corner-reticle reticle-bl" />
        <span className="corner-reticle reticle-br" />

        {/* Pinned Header */}
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span className="cyber-hazard-stripes" style={{ fontSize: '1.25rem', color: 'var(--accent-bright)' }}>
              ///
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--accent-bright)', letterSpacing: '0.05em' }}>
                <CyberIcon name="target" size={14} /> Create Security Finding from Selection
              </h3>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--accent-bright)',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  marginTop: '2px',
                  letterSpacing: '0.04em',
                }}
              >
                VULNERABILITY-INGEST // ATTACHES SELECTION AS PRIMARY EVIDENCE
              </div>
            </div>
          </div>
          <button type="button" className="cyber-btn-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <div
            className="dialog-body"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {errorMsg && <div className="error-banner">{errorMsg}</div>}

            <div
              style={{
                background: 'color-mix(in srgb, var(--accent-bright) 5%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                padding: '0.55rem 0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
              }}
            >
              <div>
                <span style={{ color: '#94a3b8' }}>SOURCE: </span>
                <strong style={{ color: 'var(--accent-bright)' }}>Terminal Output &rarr; Attached as Evidence #1</strong>
              </div>
              {matchedHost && (
                <div>
                  <span style={{ color: '#94a3b8' }}>TARGET: </span>
                  <strong style={{ color: 'var(--accent-bright)' }}>{matchedHost.label || matchedHost.address}</strong>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="find-engagement">
                  Pentest Engagement
                </label>
                <select
                  id="find-engagement"
                  className="cyber-hud-select"
                  value={engagementId}
                  onChange={(e) => setEngagementId(e.target.value)}
                >
                  <option value=""><CyberIcon name="globe" size={14} /> Global / No Engagement</option>
                  {engagements.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      <CyberIcon name="target" size={14} /> {eng.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="find-host">
                  Affected Target Host
                </label>
                <select
                  id="find-host"
                  className="cyber-hud-select"
                  value={hostId}
                  onChange={(e) => setHostId(e.target.value)}
                >
                  <option value="">(No specific host)</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      <CyberIcon name="desktop" size={14} /> {h.label} ({h.address})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="cyber-label" htmlFor="find-title">
                Finding Title / Vulnerability Name
              </label>
              <input
                id="find-title"
                className="cyber-hud-input"
                placeholder="e.g. Unquoted Service Path Privilege Escalation"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="find-category">
                  Vulnerability Category
                </label>
                <select
                  id="find-category"
                  className="cyber-hud-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="find-severity">
                  Severity Rating
                </label>
                <select
                  id="find-severity"
                  className="cyber-hud-select"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as EvidenceSeverity)}
                >
                  <option value="critical">Critical Severity</option>
                  <option value="high">High Severity</option>
                  <option value="medium">Medium Severity</option>
                  <option value="low">Low Severity</option>
                  <option value="info">Informational</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="find-cve">
                  CVE Identifier (Optional)
                </label>
                <input
                  id="find-cve"
                  className="cyber-hud-input font-mono"
                  placeholder="e.g. CVE-2023-38606"
                  value={cve}
                  onChange={(e) => setCve(e.target.value)}
                />
              </div>

              <div>
                <label className="cyber-label" htmlFor="find-mitre">
                  MITRE ATT&amp;CK Technique (Optional)
                </label>
                <input
                  id="find-mitre"
                  className="cyber-hud-input font-mono"
                  placeholder="e.g. T1003.001 - LSASS Memory"
                  value={mitreAttack}
                  onChange={(e) => setMitreAttack(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="cyber-label" htmlFor="find-desc">
                Vulnerability Description / Assessment Narrative
              </label>
              <textarea
                id="find-desc"
                className="cyber-hud-input"
                style={{ minHeight: '90px', resize: 'vertical' }}
                placeholder="Describe how the vulnerability was identified and why it is exploitable..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="cyber-label" htmlFor="find-remediation">
                Remediation / Mitigation Advice
              </label>
              <textarea
                id="find-remediation"
                className="cyber-hud-input"
                style={{ minHeight: '60px', resize: 'vertical' }}
                placeholder="Recommended patches, configurations, or hardening steps..."
                value={remediation}
                onChange={(e) => setRemediation(e.target.value)}
              />
            </div>

            <div>
              <label className="cyber-label" htmlFor="find-evidence-content">
                Attached Supporting Evidence Proof (Terminal Selection)
              </label>
              <textarea
                id="find-evidence-content"
                className="cyber-hud-input font-mono"
                style={{ minHeight: '90px', resize: 'vertical' }}
                value={evidenceContent}
                onChange={(e) => setEvidenceContent(e.target.value)}
                required
              />
            </div>

            {/* In-Report Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.45rem 0.75rem',
                background: inReport ? 'color-mix(in srgb, var(--accent-bright) 5%, transparent)' : 'rgba(100, 116, 139, 0.1)',
                border: inReport ? '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)' : '1px solid rgba(100, 116, 139, 0.3)',
              }}
            >
              <input
                type="checkbox"
                id="find-in-report"
                checked={inReport}
                onChange={(e) => setInReport(e.target.checked)}
                style={{ accentColor: 'var(--accent-bright)', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label
                htmlFor="find-in-report"
                style={{
                  fontSize: '0.8rem',
                  color: inReport ? 'var(--accent-bright)' : '#94a3b8',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  userSelect: 'none',
                }}
              >
                {inReport
                  ? <><CyberIcon name="file" size={14} /> Include this Proof in Client Assessment Report</>
                  : <><CyberIcon name="lock" size={14} /> Internal Proof Only (Hide excerpt from Client Report)</>}
              </label>
            </div>

            <div>
              <label className="cyber-label" htmlFor="find-tags">
                Tags (Comma-Separated)
              </label>
              <input
                id="find-tags"
                className="cyber-hud-input"
                placeholder="vulnerability, privesc, rce"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>
          </div>

          {/* Pinned Footer */}
          <div className="dialog-footer" style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button type="submit" className="cyber-btn cyber-btn-primary" disabled={isSaving}>
              {isSaving ? 'Creating...' : <><CyberIcon name="target" size={14} /> Create Finding with Attached Evidence</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
