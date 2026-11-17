import React, { useState, useMemo } from 'react';
import { Snippet, SnippetContext, SnippetVariable } from '../types/snippet';
import { CyberIcon } from './CyberIcon';

export interface SnippetRunModalProps {
  snippet: Snippet;
  context: SnippetContext;
  mode?: 'run' | 'insert';
  onExecute: (userValues: Record<string, string>) => Promise<void>;
  onInsert?: (resolvedCommand: string, userValues: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

function extractVariablesFromSnippet(snippet: Snippet): SnippetVariable[] {
  const map = new Map<string, SnippetVariable>();
  if (snippet.variables && snippet.variables.length > 0) {
    for (const v of snippet.variables) {
      map.set(v.name.toUpperCase(), v);
    }
  }
  const regex = /\{\{([^{}]+)\}\}/g;
  const matches = snippet.body.matchAll(regex);
  for (const m of matches) {
    const spec = m[1].trim();
    const pipeIdx = spec.indexOf('|');
    const cleanSpec = pipeIdx !== -1 ? spec.slice(0, pipeIdx).trim() : spec;
    const description = pipeIdx !== -1 ? spec.slice(pipeIdx + 1).trim() : '';
    let name = cleanSpec;
    let defaultValue = '';
    const eqIdx = cleanSpec.indexOf('=');
    if (eqIdx !== -1) {
      name = cleanSpec.slice(0, eqIdx).trim();
      defaultValue = cleanSpec.slice(eqIdx + 1).trim();
    } else if (!cleanSpec.toUpperCase().startsWith('SECRET:')) {
      const colonIdx = cleanSpec.indexOf(':');
      if (colonIdx !== -1) {
        name = cleanSpec.slice(0, colonIdx).trim();
      }
    }
    const key = name.toUpperCase();
    if (!map.has(key)) {
      map.set(key, {
        name,
        defaultValue: defaultValue || undefined,
        description: description || undefined,
        secretRef: key.startsWith('SECRET:') ? name.slice(7) : undefined,
      });
    }
  }
  return Array.from(map.values());
}

export function SnippetRunModal({
  snippet,
  context,
  mode = 'run',
  onExecute,
  onInsert,
  onClose,
}: SnippetRunModalProps): React.JSX.Element {
  const vars = useMemo(() => extractVariablesFromSnippet(snippet), [snippet]);

  // Pre-fill initial variable values from context and defaults
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};

    for (const v of vars) {
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
      } else if (upper === 'TIMESTAMP') {
        initial[v.name] = context.timestamp || new Date().toISOString();
      } else if (upper === 'DATE') {
        initial[v.name] = context.date || new Date().toISOString().slice(0, 10);
      } else if (upper === 'TIME') {
        initial[v.name] = context.time || new Date().toTimeString().slice(0, 8);
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

  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Compute live preview of the command as parameters change
  const resolvedPreview = useMemo(() => {
    let result = snippet.body;
    const regex = /\{\{([^{}]+)\}\}/g;

    result = result.replace(regex, (_, raw) => {
      const spec = raw.trim();
      let name = spec;
      let defaultValue = '';

      if (spec.startsWith('SECRET:')) {
        return '••••••••';
      }

      const pipeIdx = spec.indexOf('|');
      const cleanSpec = pipeIdx !== -1 ? spec.slice(0, pipeIdx).trim() : spec;
      const eqIdx = cleanSpec.indexOf('=');

      if (eqIdx !== -1) {
        name = cleanSpec.slice(0, eqIdx).trim();
        defaultValue = cleanSpec.slice(eqIdx + 1).trim();
      } else {
        const colonIdx = cleanSpec.indexOf(':');
        if (colonIdx !== -1) {
          name = cleanSpec.slice(0, colonIdx).trim();
        }
      }

      const val = values[name];
      if (val !== undefined && val !== '') {
        return val;
      }
      if (defaultValue) {
        return defaultValue;
      }

      // Check context
      const upper = name.toUpperCase();
      if (upper === 'HOST' || upper === 'IP') return context.ip || context.address || '{{HOST}}';
      if (upper === 'HOSTNAME') return context.hostname || context.hostLabel || '{{HOSTNAME}}';
      if (upper === 'USER' || upper === 'USERNAME') return context.username || '{{USER}}';
      if (upper === 'PORT') return context.port ? String(context.port) : '22';
      if (upper === 'CWD' || upper === 'DIR') return context.workingDir || '~';
      if (upper === 'PASSWORD') return '••••••••';

      return `{{${name}}}`;
    });

    return result;
  }, [snippet.body, values, context]);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setExecuting(true);
    try {
      if (mode === 'insert' && onInsert) {
        await onInsert(resolvedPreview, values);
      } else {
        await onExecute(values);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  };

  const handleInsertClick = async () => {
    if (!onInsert) return;
    setError('');
    setExecuting(true);
    try {
      await onInsert(resolvedPreview, values);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(resolvedPreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-label={`Run Snippet: ${snippet.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="cyber-dialog-card snippet-run-card"
        onSubmit={handleRun}
        style={{
          maxWidth: '640px',
          width: '94vw',
          position: 'relative',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
        }}
      >
        <div className="cyber-corner-reticle cyber-corner-tl" />
        <div className="cyber-corner-reticle cyber-corner-tr" />
        <div className="cyber-corner-reticle cyber-corner-bl" />
        <div className="cyber-corner-reticle cyber-corner-br" />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '0.6rem', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
              <span style={{ color: 'var(--accent-bright)', display: 'inline-flex' }}>
                <CyberIcon name="bolt" size={16} />
              </span>
              <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--accent-bright)', letterSpacing: '0.05em' }}>
                {snippet.name}
              </h2>
            </div>
            {snippet.description && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
                {snippet.description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="cyber-btn-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Target Session Banner */}
        <div className="snippet-target-banner">
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Target Session:</span>
          <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--accent-text)' }}>
            {context.hostLabel || context.address
              ? `${context.hostLabel || context.address} (${context.username || 'user'}@${context.address || 'host'}:${context.port || 22})`
              : 'Active Terminal Session'}
          </span>
          {context.workingDir && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              • CWD: <code>{context.workingDir}</code>
            </span>
          )}
        </div>

        {/* Variable Inputs */}
        {vars.length > 0 && (
          <div className="snippet-variables-form" style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.76rem', color: 'var(--accent-bright)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Snippet Parameters &amp; Injected Variables
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '240px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {vars.map((v) => {
                const upper = v.name.toUpperCase();
                const isAuto =
                  upper === 'HOST' ||
                  upper === 'IP' ||
                  upper === 'HOSTNAME' ||
                  upper === 'USER' ||
                  upper === 'USERNAME' ||
                  upper === 'PORT' ||
                  upper === 'CWD' ||
                  upper === 'DIR' ||
                  upper === 'TIMESTAMP' ||
                  upper === 'DATE' ||
                  upper === 'TIME' ||
                  upper === 'LOCAL_IP';

                const isSecret = v.secretRef || upper === 'PASSWORD' || v.name.startsWith('SECRET:');

                return (
                  <div key={v.name} className="snippet-var-row" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <label htmlFor={`var-${v.name}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem' }}>
                      <code style={{ color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace' }}>{`{{${v.name}}}`}</code>
                      {isAuto && <span className="snippet-auto-badge">auto</span>}
                      {isSecret && <span className="snippet-secret-badge">vault secret</span>}
                      {v.description && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                          — {v.description}
                        </span>
                      )}
                    </label>
                    {!isSecret ? (
                      <input
                        id={`var-${v.name}`}
                        type="text"
                        className="cyber-hud-input"
                        value={values[v.name] || ''}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                        }
                        placeholder={v.defaultValue ? `Default: ${v.defaultValue}` : 'Enter value...'}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      <input
                        id={`var-${v.name}`}
                        type="password"
                        className="cyber-hud-input"
                        value="••••••••••••"
                        disabled
                        title="Auto-injected securely by Go backend from vault"
                        style={{ width: '100%', opacity: 0.7 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Command Preview */}
        <div className="snippet-preview-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Command Preview
            </span>
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={handleCopy}
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <CyberIcon name={copied ? 'check' : 'copy'} size={11} />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="snippet-preview-box">
            <code>{resolvedPreview}</code>
          </pre>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="modal-actions" style={{ marginTop: '0.4rem', paddingTop: '0.75rem', borderTop: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
          <button type="button" className="cyber-hud-btn" onClick={onClose} disabled={executing}>
            Cancel
          </button>
          {onInsert && mode !== 'insert' && (
            <button
              type="button"
              className="cyber-hud-btn"
              onClick={() => void handleInsertClick()}
              disabled={executing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <CyberIcon name="copy" size={12} />
              <span>Insert Only</span>
            </button>
          )}
          <button
            type="submit"
            className="cyber-hud-btn btn-primary"
            disabled={executing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <CyberIcon name={mode === 'insert' ? 'copy' : 'bolt'} size={12} />
            <span>
              {executing
                ? 'Sending...'
                : mode === 'insert'
                ? 'Insert into Terminal'
                : 'Run in Terminal'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
