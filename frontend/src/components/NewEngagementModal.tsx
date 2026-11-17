import React, { useState, useEffect } from 'react';
import { CyberIcon } from './CyberIcon';
import { Engagement } from '../types/pentest';

interface NewEngagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (engagement: Engagement) => Promise<void>;
  existingEngagement?: Engagement | null;
}

export const NewEngagementModal: React.FC<NewEngagementModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingEngagement,
}) => {
  const [name, setName] = useState('');
  const [scope, setScope] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [lockoutWindow, setLockoutWindow] = useState(30);
  const [enforceDelay, setEnforceDelay] = useState(5);
  const [warningThreshold, setWarningThreshold] = useState(80);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (existingEngagement) {
      setName(existingEngagement.name);
      setScope(existingEngagement.scope || '');
      setTimeframe(existingEngagement.timeframe || '');
      setMaxAttempts(existingEngagement.lockoutPolicy?.maxAttemptsPerUser ?? 3);
      setLockoutWindow(existingEngagement.lockoutPolicy?.lockoutWindowMinutes ?? 30);
      setEnforceDelay(existingEngagement.lockoutPolicy?.enforceDelaySeconds ?? 5);
      setWarningThreshold(existingEngagement.lockoutPolicy?.warningThresholdPercent ?? 80);
    } else {
      setName('');
      setScope('');
      setTimeframe('');
      setMaxAttempts(3);
      setLockoutWindow(30);
      setEnforceDelay(5);
      setWarningThreshold(80);
    }
    setErrorMsg(null);
  }, [existingEngagement, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMsg('Engagement name is required.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const eng: Engagement = {
        id: existingEngagement ? existingEngagement.id : `eng-${Date.now()}`,
        name: trimmedName,
        scope: scope.trim(),
        timeframe: timeframe.trim(),
        lockoutPolicy: {
          maxAttemptsPerUser: Number(maxAttempts) || 3,
          lockoutWindowMinutes: Number(lockoutWindow) || 30,
          enforceDelaySeconds: Number(enforceDelay) || 5,
          warningThresholdPercent: Number(warningThreshold) || 80,
        },
        isActive: true,
        createdAt: existingEngagement ? existingEngagement.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await onSave(eng);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="cyber-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-engagement-title"
    >
      <div
        className="cyber-dialog-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '620px', width: '92%' }}
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
              <h3 id="new-engagement-title" style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                {existingEngagement ? <><CyberIcon name="gear" size={14} /> Edit Pentest Engagement</> : <><CyberIcon name="target" size={14} /> New Pentest Engagement</>}
              </h3>
              <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>
                CUSTOMER SEGREGATION // ENCLOSED OPERATIONAL BOUNDARY &amp; GDPR COMPLIANCE
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="dialog-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          {errorMsg && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                color: '#fca5a5',
                padding: '0.65rem 0.85rem',
                fontSize: '0.78rem',
                fontFamily: 'JetBrains Mono, monospace',
                borderRadius: '2px',
              }}
              role="alert"
            >
              <CyberIcon name="warning" size={14} /> {errorMsg}
            </div>
          )}

          <div
            style={{
              background: 'color-mix(in srgb, var(--accent-bright) 5%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
              padding: '0.65rem 0.85rem',
              fontSize: '0.75rem',
              color: '#94a3b8',
              lineHeight: 1.45,
            }}
          >
            Engagements encapsulate Hosts, Notes, Credentials, Findings, and Custom Attack Snippets into an isolated customer boundary.
          </div>

          <div>
            <label htmlFor="eng-name-input" className="cyber-label">
              Engagement Name *
            </label>
            <input
              id="eng-name-input"
              type="text"
              className="cyber-hud-input"
              placeholder="e.g. Acme Corp External Penetration Test"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="eng-scope-input" className="cyber-label">
              In-Scope Targets &amp; CIDRs (Scope)
            </label>
            <textarea
              id="eng-scope-input"
              className="cyber-hud-input"
              style={{ minHeight: '80px', resize: 'vertical', fontFamily: 'JetBrains Mono, monospace' }}
              placeholder="Target subnets, IPs, hostnames (e.g. 10.10.0.0/16, 192.168.1.50, api.acme.com)"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '3px' }}>
              Comma, semicolon, or newline separated. Hosts matching these ranges or explicitly assigned will be encapsulated.
            </div>
          </div>

          <div>
            <label htmlFor="eng-timeframe-input" className="cyber-label">
              Testing Window &amp; Timeframe
            </label>
            <input
              id="eng-timeframe-input"
              type="text"
              className="cyber-hud-input"
              placeholder="e.g. 2026-11-15 – 2026-11-30 (09:00 - 18:00 CET)"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
            />
          </div>

          {/* Collapsible Lockout Defaults */}
          <div
            style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              paddingTop: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.04em' }}>
              <CyberIcon name="shield" size={14} /> DEFENSIVE LOCKOUT POLICY DEFAULTS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor="eng-max-att" className="cyber-label">
                  Max Attempts / Account
                </label>
                <input
                  id="eng-max-att"
                  type="number"
                  className="cyber-hud-input"
                  min={1}
                  max={20}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(parseInt(e.target.value, 10) || 1)}
                />
              </div>
              <div>
                <label htmlFor="eng-lockout-win" className="cyber-label">
                  Lockout Window (min)
                </label>
                <input
                  id="eng-lockout-win"
                  type="number"
                  className="cyber-hud-input"
                  min={1}
                  max={1440}
                  value={lockoutWindow}
                  onChange={(e) => setLockoutWindow(parseInt(e.target.value, 10) || 1)}
                />
              </div>
              <div>
                <label htmlFor="eng-enforce-delay" className="cyber-label">
                  Enforce Delay (sec)
                </label>
                <input
                  id="eng-enforce-delay"
                  type="number"
                  className="cyber-hud-input"
                  min={0}
                  max={3600}
                  value={enforceDelay}
                  onChange={(e) => setEnforceDelay(parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div>
                <label htmlFor="eng-warn-thresh" className="cyber-label">
                  Warning Threshold (%)
                </label>
                <input
                  id="eng-warn-thresh"
                  type="number"
                  className="cyber-hud-input"
                  min={10}
                  max={100}
                  value={warningThreshold}
                  onChange={(e) => setWarningThreshold(parseInt(e.target.value, 10) || 80)}
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '0.5rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              paddingTop: '0.75rem',
            }}
          >
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
              <span>{isSaving ? 'SAVING...' : existingEngagement ? <><CyberIcon name="check" size={14} /> UPDATE ENGAGEMENT</> : <><CyberIcon name="target" size={14} /> CREATE ENGAGEMENT</>}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

