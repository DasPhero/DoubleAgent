import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { CyberIcon } from './CyberIcon';
import type { TotpSummary, TotpCodeResponse } from '../types/totp';

export interface TotpQuickSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: TotpSummary[];
  currentHostId?: string;
  currentHostLabel?: string;
  onSelectAndInject: (totpId: string) => Promise<void>;
  onOpenFullVault: () => void;
}

interface WailsTotpApi {
  GetAllTotpCodes?: () => Promise<TotpCodeResponse[]>;
}

function getWailsTotpApi(): WailsTotpApi | undefined {
  const w = window as unknown as { go?: { main?: { App?: WailsTotpApi } } };
  return w.go?.main?.App;
}

export const TotpQuickSelectorModal: React.FC<TotpQuickSelectorModalProps> = ({
  isOpen,
  onClose,
  tokens,
  currentHostId,
  currentHostLabel,
  onSelectAndInject,
  onOpenFullVault,
}) => {
  const [codes, setCodes] = useState<Record<string, TotpCodeResponse>>({});
  const [injectingId, setInjectingId] = useState<string | null>(null);

  // Poll live codes and countdown
  const refreshCodes = useCallback(async () => {
    const api = getWailsTotpApi();
    if (!api?.GetAllTotpCodes) return;
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
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void refreshCodes();
      const interval = setInterval(() => {
        void refreshCodes();
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen, refreshCodes]);

  // Filter candidates: codes assigned to the current host + codes without any assignment
  const candidateTokens = useMemo(() => {
    const matched = tokens.filter((t) => (currentHostId && t.hostId === currentHostId) || !t.hostId);
    if (matched.length > 0) {
      return matched;
    }
    // Fallback: if all tokens are assigned to other hosts, display all tokens so the user is never blocked
    return tokens;
  }, [tokens, currentHostId]);

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

  const handleItemClick = async (totpId: string) => {
    if (injectingId) return;
    setInjectingId(totpId);
    try {
      await onSelectAndInject(totpId);
    } finally {
      setInjectingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="cyber-modal-overlay quick-totp-overlay" onClick={onClose}>
      <div
        className="cyber-dialog-card quick-totp-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Select 2FA Token to Inject"
      >
        {/* Reticle corner decoration overlays */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Dialog Header */}
        <div className="dialog-header quick-totp-header">
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3>2FA QUICK SELECTOR</h3>
              <div className="quick-totp-subtitle">
                TARGET: <strong>{currentHostLabel || 'ACTIVE TERMINAL PROMPT'}</strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close Quick Selector"
          >
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        {/* Candidates List */}
        <div className="quick-totp-body">
          <p className="quick-totp-hint">
            Click any authenticator to immediately insert its current code into the terminal prompt:
          </p>

          <div className="quick-totp-list">
            {candidateTokens.map((item) => {
              const codeResp = codes[item.id];
              const remaining = codeResp ? codeResp.remainingSeconds : 30;
              const isUrgent = remaining <= 5;
              const isAssignedToHost = currentHostId && item.hostId === currentHostId;
              const initials = (item.issuer || item.label || '2F').slice(0, 2).toUpperCase();

              return (
                <div
                  key={item.id}
                  className={`quick-totp-item ${isUrgent ? 'item-urgent' : ''}`}
                  onClick={() => void handleItemClick(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      void handleItemClick(item.id);
                    }
                  }}
                  title={`Click to insert code for ${item.label} directly into prompt`}
                >
                  <div className="quick-item-left">
                    <div className="quick-item-badge">{initials}</div>
                    <div className="quick-item-meta">
                      <div className="quick-item-name-row">
                        <span className="quick-item-name">
                          {item.issuer ? item.issuer.toUpperCase() : item.label.toUpperCase()}
                        </span>
                        {isAssignedToHost ? (
                          <span className="quick-tag-host"><CyberIcon name="desktop" size={14} /> Current Host</span>
                        ) : !item.hostId ? (
                          <span className="quick-tag-standalone">Standalone</span>
                        ) : (
                          <span className="quick-tag-other">Linked Host</span>
                        )}
                      </div>
                      <div className="quick-item-label">{item.label}</div>
                    </div>
                  </div>

                  <div className="quick-item-right">
                    <div className={`quick-item-code ${isUrgent ? 'urgent-glow' : ''}`}>
                      {formatCode(codeResp?.code, item.digits)}
                    </div>
                    <div className={`quick-item-timer ${isUrgent ? 'urgent' : ''}`}>
                      {remaining}s
                    </div>
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-primary quick-inject-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleItemClick(item.id);
                      }}
                      disabled={injectingId === item.id}
                    >
                      {injectingId === item.id ? '...' : <><CyberIcon name="bolt" size={14} /> INSERT</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dialog Footer */}
        <div className="dialog-footer quick-totp-footer">
          <button
            type="button"
            className="quick-btn-link"
            onClick={() => {
              onClose();
              onOpenFullVault();
            }}
          >
            <CyberIcon name="shield" size={14} /> Manage All Authenticators in Full Vault
          </button>
          <button
            type="button"
            className="cyber-btn cyber-btn-secondary cyber-btn-sm"
            onClick={onClose}
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
};

