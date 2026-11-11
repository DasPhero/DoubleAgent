import React, { useState, useEffect } from 'react';
import {
  CredentialCategory,
  CredentialEntry,
  EvidenceItem,
  EvidenceSeverity,
} from '../types/pentest';

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
              <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#00f0ff', letterSpacing: '0.06em' }}>
                🔑 Save Terminal Selection as Credential (F-19)
              </h3>
              <div style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
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
                background: 'rgba(0, 240, 255, 0.05)',
                border: '1px solid rgba(0, 240, 255, 0.25)',
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
                <strong style={{ color: '#00f0ff' }}>Terminal Selection</strong>
              </div>
              {matchedHost && (
                <div>
                  <span style={{ color: '#94a3b8' }}>ASSOCIATED HOST: </span>
                  <strong style={{ color: '#38bdf8' }}>{matchedHost.label || matchedHost.address}</strong>
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
                  <option value="">🌐 Global / No Engagement</option>
                  {engagements.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      🎯 {eng.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="cred-scope-host">
                  Associated Host (F-19)
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
                      🖥️ {h.label} ({h.address})
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
              {isSaving ? 'Saving...' : '💾 Save to Vault'}
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
  const [tagsInput, setTagsInput] = useState<string>('terminal, evidence');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen && selectedText) {
      const firstLine = selectedText.trim().split('\n')[0] || '';
      const summaryTitle =
        firstLine.length > 0 && firstLine.length <= 48
          ? `Terminal Output: ${firstLine}`
          : 'Terminal Output Finding';

      setTitle(summaryTitle);
      setContent(selectedText.trim());
      setCategory('Sensitive Data');
      setSeverity('medium');
      setHostId(initialHostId || '');
      setEngagementId(initialEngagementId || '');
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
        category,
        title: title.trim(),
        type: 'text',
        content: content.trim(),
        hostId: hostId || undefined,
        severity,
        capturedAt: new Date().toISOString(),
        source: 'terminal_selection',
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
              <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#00f0ff', letterSpacing: '0.06em' }}>
                🛡️ Save Terminal Selection as Evidence (F-19)
              </h3>
              <div style={{ fontSize: '0.7rem', color: '#38bdf8', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
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
                background: 'rgba(0, 240, 255, 0.05)',
                border: '1px solid rgba(0, 240, 255, 0.25)',
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
                <strong style={{ color: '#00f0ff' }}>Terminal Output</strong>
              </div>
              {matchedHost && (
                <div>
                  <span style={{ color: '#94a3b8' }}>HOST: </span>
                  <strong style={{ color: '#38bdf8' }}>{matchedHost.label || matchedHost.address}</strong>
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
                  <option value="">🌐 Global / No Engagement</option>
                  {engagements.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      🎯 {eng.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="ev-host">
                  Associated Target Host (F-19)
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
                      🖥️ {h.label} ({h.address})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="cyber-label" htmlFor="ev-title">
                Finding / Evidence Title
              </label>
              <input
                id="ev-title"
                className="cyber-hud-input"
                placeholder="e.g. Unshadowed Hash Extraction from /etc/shadow"
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
                <label className="cyber-label" htmlFor="ev-severity">
                  Severity Rating
                </label>
                <select
                  id="ev-severity"
                  className="cyber-hud-select"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as EvidenceSeverity)}
                >
                  <option value="critical">🔴 Critical Severity</option>
                  <option value="high">🟠 High Severity</option>
                  <option value="medium">🟡 Medium Severity</option>
                  <option value="low">🟢 Low Severity</option>
                  <option value="info">🔵 Informational</option>
                </select>
              </div>
            </div>

            <div>
              <label className="cyber-label" htmlFor="ev-content">
                Captured Terminal Output / Log Proof
              </label>
              <textarea
                id="ev-content"
                className="cyber-hud-input font-mono"
                style={{ minHeight: '130px', resize: 'vertical' }}
                placeholder="Captured terminal evidence text..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="cyber-label" htmlFor="ev-tags">
                Tags (Comma-Separated)
              </label>
              <input
                id="ev-tags"
                className="cyber-hud-input"
                placeholder="terminal, proof, nmap, hash"
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
              {isSaving ? 'Saving...' : '🛡️ Save to Evidence Vault'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
