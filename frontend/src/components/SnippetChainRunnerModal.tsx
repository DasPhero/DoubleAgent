import React, { useState, useMemo } from 'react';
import { SnippetChain, SnippetVariable, SnippetContext } from '../types/snippet';
import { CyberIcon } from './CyberIcon';

export interface SnippetChainRunnerModalProps {
  chain: SnippetChain;
  sessionId: string;
  hostLabel?: string;
  context: SnippetContext;
  onExecuteStep: (stepIndex: number, userValues: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

type StepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export const SnippetChainRunnerModal: React.FC<SnippetChainRunnerModalProps> = ({
  chain,
  sessionId,
  hostLabel,
  context,
  onExecuteStep,
  onClose,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(() =>
    chain.steps.map(() => 'pending')
  );
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [completedAll, setCompletedAll] = useState(false);

  // Extract variables across all steps
  const chainVariables = useMemo(() => {
    const seen = new Set<string>();
    const vars: SnippetVariable[] = [];
    const regex = /\{\{([^{}]+)\}\}/g;

    for (const step of chain.steps) {
      const matches = step.command.matchAll(regex);
      for (const m of matches) {
        const raw = m[1].trim();
        // Skip secret references or passwords
        if (raw.toUpperCase().startsWith('SECRET:') || raw.toUpperCase() === 'PASSWORD') {
          continue;
        }
        let name = raw;
        let defVal = '';
        if (raw.includes('=')) {
          const parts = raw.split('=');
          name = parts[0].trim();
          defVal = parts[1].trim();
          if (defVal.includes(':')) {
            defVal = defVal.split(':')[0].trim();
          }
        } else if (raw.includes(':')) {
          name = raw.split(':')[0].trim();
        }
        const key = name.toUpperCase();
        if (!seen.has(key)) {
          seen.add(key);
          vars.push({ name, defaultValue: defVal });
        }
      }
    }
    return vars;
  }, [chain]);

  // Initial user values prefilled from context
  const [userValues, setUserValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const v of chainVariables) {
      const upper = v.name.toUpperCase();
      if (upper === 'HOST' || upper === 'IP') {
        initial[v.name] = context.ip || context.address || '';
      } else if (upper === 'HOSTNAME') {
        initial[v.name] = context.hostname || context.hostLabel || context.address || '';
      } else if (upper === 'USER' || upper === 'USERNAME') {
        initial[v.name] = context.username || '';
      } else if (upper === 'PORT') {
        initial[v.name] = context.port ? String(context.port) : (v.defaultValue || '22');
      } else if (upper === 'CWD' || upper === 'DIR') {
        initial[v.name] = context.workingDir || '~';
      } else if (upper === 'LOCAL_IP') {
        initial[v.name] = '127.0.0.1';
      } else if (v.defaultValue) {
        initial[v.name] = v.defaultValue;
      } else {
        initial[v.name] = '';
      }
    }
    return initial;
  });

  const currentStep = chain.steps[currentStepIndex];

  // Resolve current step command with preview interpolation
  const resolvedCommandPreview = useMemo(() => {
    if (!currentStep) return '';
    let cmd = currentStep.command;
    const regex = /\{\{([^{}]+)\}\}/g;

    cmd = cmd.replace(regex, (_, raw) => {
      const trimmed = raw.trim();
      let name = trimmed;
      let defVal = '';
      if (trimmed.includes('=')) {
        const parts = trimmed.split('=');
        name = parts[0].trim();
        defVal = parts[1].trim();
        if (defVal.includes(':')) {
          defVal = defVal.split(':')[0].trim();
        }
      } else if (trimmed.includes(':')) {
        name = trimmed.split(':')[0].trim();
      }

      // Check user values
      for (const [k, val] of Object.entries(userValues)) {
        if (k.toLowerCase() === name.toLowerCase() && val) {
          return val;
        }
      }

      // Check context
      const upper = name.toUpperCase();
      if (upper === 'HOST' || upper === 'IP') return context.ip || context.address || '{{HOST}}';
      if (upper === 'HOSTNAME') return context.hostname || context.hostLabel || '{{HOSTNAME}}';
      if (upper === 'USER' || upper === 'USERNAME') return context.username || '{{USER}}';
      if (upper === 'PORT') return context.port ? String(context.port) : defVal || '22';
      if (upper === 'CWD' || upper === 'DIR') return context.workingDir || '~';
      if (upper === 'LOCAL_IP') return '127.0.0.1';

      if (defVal) return defVal;
      return `{{${name}}}`;
    });

    return cmd;
  }, [currentStep, userValues, context]);

  // Execute current step (and auto-continue subsequent steps if chain.autoRunWithoutPrompt is set or step.confirmBeforeRun is false)
  const handleExecuteCurrentStep = async () => {
    if (!currentStep) return;
    setExecuting(true);
    setError('');

    const updatedStatuses = [...stepStatuses];
    let idx = currentStepIndex;

    try {
      while (idx < chain.steps.length) {
        const step = chain.steps[idx];
        setCurrentStepIndex(idx);
        updatedStatuses[idx] = 'running';
        setStepStatuses([...updatedStatuses]);

        await onExecuteStep(idx, userValues);

        if (step.delayMs && step.delayMs > 0) {
          await new Promise((r) => setTimeout(r, step.delayMs));
        }

        updatedStatuses[idx] = 'completed';
        setStepStatuses([...updatedStatuses]);

        if (idx + 1 < chain.steps.length) {
          const nextStep = chain.steps[idx + 1];
          const nextNeedsConfirm = !chain.autoRunWithoutPrompt && nextStep.confirmBeforeRun;
          idx += 1;
          setCurrentStepIndex(idx);
          if (nextNeedsConfirm) {
            break;
          }
        } else {
          setCompletedAll(true);
          break;
        }
      }
    } catch (err: unknown) {
      updatedStatuses[idx] = 'failed';
      setStepStatuses([...updatedStatuses]);
      setError(err instanceof Error ? err.message : 'Step execution failed');

      if (chain.steps[idx]?.stopOnError || chain.stopOnError) {
        setError((prev) => `${prev} (Chain halted due to StopOnError policy)`);
      }
    } finally {
      setExecuting(false);
    }
  };

  const handleSkipCurrentStep = () => {
    const updatedStatuses = [...stepStatuses];
    updatedStatuses[currentStepIndex] = 'skipped';
    setStepStatuses(updatedStatuses);

    if (currentStepIndex + 1 < chain.steps.length) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      setCompletedAll(true);
    }
  };

  return (
    <div className="cyber-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Snippet Chain Execution Runner">
      <div
        className="cyber-modal-card cyber-hud-card"
        style={{ width: '740px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        {/* Modal Header */}
        <div className="cyber-modal-header" style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(0, 240, 255, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ color: 'var(--color-primary-cyan, #00f0ff)' }}>
              <CyberIcon name="chain" size={18} />
            </span>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-primary-cyan, #00f0ff)' }}>
                CHAIN RUNNER: {chain.name.toUpperCase()}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                Target: {hostLabel || context.address || 'Active Session'} [{sessionId}] · Stage {currentStepIndex + 1} of {chain.steps.length}
              </div>
            </div>
          </div>
          <button type="button" className="cyber-hud-btn btn-sm" onClick={onClose} aria-label="Close Runner">
            <CyberIcon name="close" size={14} />
          </button>
        </div>

        {/* Runner Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && (
            <div style={{ padding: '0.65rem 0.85rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', borderRadius: '4px', fontSize: '0.82rem' }}>
              {error}
            </div>
          )}

          {/* Stepper Progress Bar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#94a3b8' }}>
              <span>EXECUTION PROGRESS</span>
              <span>
                {completedAll
                  ? 'COMPLETED ALL STEPS'
                  : `STEP ${currentStepIndex + 1} / ${chain.steps.length}`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', height: '6px' }}>
              {chain.steps.map((st, idx) => {
                const status = stepStatuses[idx];
                let bg = 'rgba(100, 116, 139, 0.3)';
                if (status === 'completed') bg = '#10b981';
                else if (status === 'running') bg = 'var(--color-primary-cyan, #00f0ff)';
                else if (status === 'skipped') bg = '#f59e0b';
                else if (status === 'failed') bg = '#ef4444';
                else if (idx === currentStepIndex && !completedAll) bg = 'rgba(0, 240, 255, 0.6)';

                return (
                  <div
                    key={st.id || idx}
                    style={{
                      flex: 1,
                      backgroundColor: bg,
                      borderRadius: '2px',
                      transition: 'background-color 0.2s ease',
                    }}
                    title={`${idx + 1}. ${st.title} (${status})`}
                  />
                );
              })}
            </div>
          </div>

          {/* Step Chips Navigation */}
          <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
            {chain.steps.map((st, idx) => {
              const isCurrent = idx === currentStepIndex && !completedAll;
              const status = stepStatuses[idx];
              let borderColor = 'rgba(100, 116, 139, 0.25)';
              let color = '#94a3b8';
              if (isCurrent) {
                borderColor = 'var(--color-primary-cyan, #00f0ff)';
                color = 'var(--color-primary-cyan, #00f0ff)';
              } else if (status === 'completed') {
                borderColor = '#10b981';
                color = '#10b981';
              } else if (status === 'failed') {
                borderColor = '#ef4444';
                color = '#ef4444';
              }

              return (
                <div
                  key={st.id || idx}
                  style={{
                    padding: '0.25rem 0.6rem',
                    fontSize: '0.72rem',
                    border: `1px solid ${borderColor}`,
                    borderRadius: '3px',
                    backgroundColor: isCurrent ? 'rgba(0, 240, 255, 0.1)' : 'rgba(0, 0, 0, 0.4)',
                    color,
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span style={{ fontWeight: 700 }}>#{idx + 1}</span>
                  <span>{st.title}</span>
                </div>
              );
            })}
          </div>

          {/* Variable Parameters Form (if custom variables exist) */}
          {chainVariables.length > 0 && !completedAll && currentStepIndex === 0 && (
            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: '4px' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-primary-cyan, #00f0ff)', marginBottom: '0.5rem' }}>
                CHAIN PARAMETERS & VARIABLE RESOLUTION:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                {chainVariables.map((v) => (
                  <div key={v.name}>
                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                      {v.name}
                    </label>
                    <input
                      type="text"
                      className="cyber-hud-input"
                      value={userValues[v.name] || ''}
                      onChange={(e) =>
                        setUserValues({ ...userValues, [v.name]: e.target.value })
                      }
                      style={{ width: '100%', fontSize: '0.76rem', height: '30px' }}
                      placeholder={v.defaultValue || v.name}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Current Step Card or Completion Card */}
          {completedAll ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', border: '1px solid rgba(16, 185, 129, 0.4)', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: '4px' }}>
              <div style={{ color: '#10b981', fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                CHAIN EXECUTION COMPLETE
              </div>
              <div style={{ fontSize: '0.84rem', color: '#cbd5e1' }}>
                All {chain.steps.length} stages in &ldquo;{chain.name}&rdquo; have been processed for session {sessionId}.
              </div>
              <button
                type="button"
                className="cyber-hud-btn btn-primary"
                onClick={onClose}
                style={{ marginTop: '1.25rem', minWidth: '120px' }}
              >
                Close Runner
              </button>
            </div>
          ) : (
            currentStep && (
              <div
                style={{
                  backgroundColor: 'rgba(6, 14, 26, 0.95)',
                  border: '1px solid rgba(0, 240, 255, 0.35)',
                  borderRadius: '4px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-primary-cyan, #00f0ff)' }}>
                      STEP {currentStepIndex + 1} OF {chain.steps.length}:
                    </span>
                    <span style={{ fontSize: '0.92rem', fontWeight: 600, color: '#f8fafc' }}>
                      {currentStep.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
                    {!chain.autoRunWithoutPrompt && currentStep.confirmBeforeRun ? (
                      <span style={{ padding: '0.1rem 0.4rem', borderRadius: '2px', backgroundColor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                        CONFIRM REQUIRED
                      </span>
                    ) : (
                      <span style={{ padding: '0.1rem 0.4rem', borderRadius: '2px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.35)' }}>
                        AUTO-RUN (NO PROMPT)
                      </span>
                    )}
                    {currentStep.delayMs ? (
                      <span style={{ color: '#94a3b8' }}>Delay: {currentStep.delayMs}ms</span>
                    ) : null}
                  </div>
                </div>

                {currentStep.description && (
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    {currentStep.description}
                  </div>
                )}

                {/* Resolved Command Monospace Box */}
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.25rem', letterSpacing: '0.05em' }}>
                    COMMAND TO INJECT INTO SESSION:
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '0.65rem 0.85rem',
                      backgroundColor: 'rgba(0, 0, 0, 0.85)',
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                      borderRadius: '3px',
                      color: '#6ee7b7',
                      fontSize: '0.82rem',
                      fontFamily: 'var(--font-mono, monospace)',
                      overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                      lineHeight: '1.45',
                    }}
                  >
                    {resolvedCommandPreview}
                  </pre>
                </div>
              </div>
            )
          )}
        </div>

        {/* Runner Actions Footer */}
        {!completedAll && (
          <div
            style={{
              padding: '0.85rem 1.25rem',
              borderTop: '1px solid rgba(0, 240, 255, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(4, 9, 18, 0.85)',
            }}
          >
            <button
              type="button"
              className="cyber-hud-btn btn-danger"
              onClick={onClose}
              disabled={executing}
              style={{ fontSize: '0.78rem' }}
            >
              Abort Chain
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <button
                type="button"
                className="cyber-hud-btn"
                onClick={handleSkipCurrentStep}
                disabled={executing}
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}
              >
                <CyberIcon name="skip" size={13} />
                <span>Skip Step</span>
              </button>

              <button
                type="button"
                className="cyber-hud-btn btn-primary"
                onClick={handleExecuteCurrentStep}
                disabled={executing}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: '150px', justifyContent: 'center' }}
              >
                <CyberIcon name="play" size={13} />
                <span>
                  {executing
                    ? 'Executing...'
                    : `Execute Step ${currentStepIndex + 1}`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
