import React, { useState } from 'react';
import type { VaultConflictReport, VaultConflictResolution } from '../types/vaultSync';
import { CyberIcon } from './CyberIcon';

export interface VaultConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: VaultConflictReport;
  conflictFilePath?: string;
  onResolve: (resolutions: Record<string, VaultConflictResolution>, deleteConflictFile: boolean) => Promise<void>;
}

export const VaultConflictModal: React.FC<VaultConflictModalProps> = ({
  isOpen,
  onClose,
  report,
  conflictFilePath,
  onResolve,
}) => {
  const [resolutions, setResolutions] = useState<Record<string, VaultConflictResolution>>(() => {
    const initial: Record<string, VaultConflictResolution> = {};
    for (const c of report.conflicts) {
      initial[c.id] = 'local';
    }
    return initial;
  });
  const [deleteFile, setDeleteFile] = useState<boolean>(Boolean(conflictFilePath));
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  if (!isOpen) return null;

  const handleSetResolution = (id: string, res: VaultConflictResolution) => {
    setResolutions((prev) => ({ ...prev, [id]: res }));
  };

  const handleSetAll = (res: VaultConflictResolution) => {
    const next: Record<string, VaultConflictResolution> = {};
    for (const c of report.conflicts) {
      next[c.id] = res;
    }
    setResolutions(next);
  };

  const handleApply = async () => {
    setIsApplying(true);
    setError('');
    try {
      await onResolve(resolutions, deleteFile);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to apply merge resolutions: ${msg}`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="cyber-modal-overlay" onClick={onClose}>
      <div
        className="cyber-dialog-card vault-conflict-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Vault Merge Conflict Resolution"
        style={{ maxWidth: '850px', width: '92%' }}
      >
        {/* Corner Reticles */}
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Header */}
        <div className="dialog-header">
          <div className="dialog-title">
            <span className="cyber-hazard-stripes">///</span>
            <div>
              <h3>VAULT SYNC CONFLICT RESOLVER</h3>
              <div className="dialog-subtitle">
                CLOUD SYNC &amp; EXTERNAL VAULT MERGE ENGINE
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close Conflict Resolver"
          >
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="dialog-body vault-conflict-body" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
          {error && <div className="alert-danger" style={{ marginBottom: '1rem' }}>{error}</div>}

          <div className="conflict-telemetry-banner">
            <div className="conflict-telemetry-item">
              <span className="telemetry-label">CONFLICTS:</span>
              <span className="telemetry-val text-crimson">{report.conflicts.length} PENDING</span>
            </div>
            <div className="conflict-telemetry-item">
              <span className="telemetry-label">AUTO-MERGED:</span>
              <span className="telemetry-val text-cyan">{report.autoMerged} NON-CONFLICTING ITEMS</span>
            </div>
            {conflictFilePath && (
              <div className="conflict-telemetry-item">
                <span className="telemetry-label">SOURCE FILE:</span>
                <span className="telemetry-val font-mono">{conflictFilePath.split(/[/\\]/).pop()}</span>
              </div>
            )}
          </div>

          <div className="conflict-quick-actions" style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary, #94a3b8)', alignSelf: 'center' }}>
              Bulk Actions:
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleSetAll('local')}
            >
              Keep All Local
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleSetAll('remote')}
            >
              Accept All Synced
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleSetAll('both')}
            >
              Keep Both (Rename)
            </button>
          </div>

          <div className="conflict-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {report.conflicts.map((item) => {
              const currentRes = resolutions[item.id] || 'local';
              return (
                <div key={item.id} className="conflict-item-card">
                  <div className="conflict-item-header">
                    <span className="conflict-badge-type">{item.type.toUpperCase()}</span>
                    <strong className="conflict-item-label">{item.label}</strong>
                    <span className="conflict-item-id font-mono">[{item.id}]</span>
                  </div>

                  <div className="conflict-diff-columns">
                    {/* Local Column */}
                    <div className={`conflict-col conflict-col-local ${currentRes === 'local' ? 'selected' : ''}`}>
                      <div className="conflict-col-title">
                        <CyberIcon name="shield" size={12} />
                        <span>LOCAL VAULT</span>
                      </div>
                      <div className="conflict-col-content font-mono">
                        {item.localSummary}
                      </div>
                    </div>

                    {/* Remote Column */}
                    <div className={`conflict-col conflict-col-remote ${currentRes === 'remote' ? 'selected' : ''}`}>
                      <div className="conflict-col-title">
                        <CyberIcon name="network" size={12} />
                        <span>SYNCED / INCOMING</span>
                      </div>
                      <div className="conflict-col-content font-mono">
                        {item.remoteSummary}
                      </div>
                    </div>
                  </div>

                  {/* Resolution Choice Bar */}
                  <div className="conflict-choice-bar">
                    <button
                      type="button"
                      className={`conflict-choice-btn ${currentRes === 'local' ? 'active' : ''}`}
                      onClick={() => handleSetResolution(item.id, 'local')}
                    >
                      <CyberIcon name="check" size={14} /> Keep Local
                    </button>
                    <button
                      type="button"
                      className={`conflict-choice-btn ${currentRes === 'remote' ? 'active' : ''}`}
                      onClick={() => handleSetResolution(item.id, 'remote')}
                    >
                      <CyberIcon name="check" size={14} /> Accept Synced
                    </button>
                    <button
                      type="button"
                      className={`conflict-choice-btn ${currentRes === 'both' ? 'active' : ''}`}
                      onClick={() => handleSetResolution(item.id, 'both')}
                    >
                      ⧉ Keep Both (Rename Synced)
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="dialog-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {conflictFilePath && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={deleteFile}
                  onChange={(e) => setDeleteFile(e.target.checked)}
                />
                <span>Delete external conflict copy file after successful merge</span>
              </label>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isApplying}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleApply()}
              disabled={isApplying}
            >
              {isApplying ? 'Applying Merge...' : <><CyberIcon name="bolt" size={14} /> Apply Resolutions & Save Vault</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

