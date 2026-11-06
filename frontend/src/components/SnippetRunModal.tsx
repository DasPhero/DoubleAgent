import React, { useState, useMemo } from 'react';
import { Snippet, SnippetContext } from '../types/snippet';

export interface SnippetRunModalProps {
  snippet: Snippet;
  context: SnippetContext;
  onExecute: (userValues: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

export function SnippetRunModal({
  snippet,
  context,
  onExecute,
  onClose,
}: SnippetRunModalProps): React.JSX.Element {
  // Pre-fill initial variable values from context and defaults
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    const vars = snippet.variables || [];

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
      await onExecute(values);
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

  const vars = snippet.variables || [];

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-label={`Run Snippet: ${snippet.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <form className="modal-card snippet-run-card" onSubmit={handleRun}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '1.1rem' }}>⚡</span>
              <h2 style={{ margin: 0 }}>{snippet.name}</h2>
            </div>
            {snippet.description && (
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {snippet.description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="tab-close-btn"
            onClick={onClose}
            aria-label="Close"
            style={{ fontSize: '1.2rem', padding: '0 0.35rem' }}
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
          <div className="snippet-variables-form">
            <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.82rem', color: 'var(--text-bright)' }}>
              Snippet Parameters &amp; Injected Variables
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '220px', overflowY: 'auto' }}>
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
                  <div key={v.name} className="snippet-var-row">
                    <label htmlFor={`var-${v.name}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem' }}>
                      <code>{`{{${v.name}}}`}</code>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Command Preview
            </span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleCopy}
              style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem' }}
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
          <pre className="snippet-preview-box">
            <code>{resolvedPreview}</code>
          </pre>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="modal-actions" style={{ marginTop: '0.85rem' }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={executing}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={executing}>
            {executing ? 'Sending...' : '⚡ Run in Terminal'}
          </button>
        </div>
      </form>
    </div>
  );
}
