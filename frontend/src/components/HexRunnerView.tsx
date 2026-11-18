import React, { useEffect, useState } from 'react';
import { CyberIcon } from './CyberIcon';
import type { HexExecChunk, HexParsePreview, HexRunRequest, HexRunResult } from '../types/hexrunner';

interface AppHexBindings {
  PreviewHexPayload?: (expr: string) => Promise<HexParsePreview>;
  GenerateCyclicPattern?: (length: number) => Promise<string>;
  FindCyclicOffset?: (query: string) => Promise<number>;
  ExecuteHexLocal?: (req: HexRunRequest) => Promise<HexRunResult>;
  ExecuteHexSsh?: (req: HexRunRequest) => Promise<HexRunResult>;
  CancelHexExecution?: (executionId: string) => Promise<boolean>;
  SendRawTcpHex?: (sessionId: string, expr: string) => Promise<number>;
  SelectFileDialog?: (title: string, pattern: string, filterName: string) => Promise<string>;
}

function getHexBindings(): AppHexBindings | undefined {
  return (window as unknown as { go?: { main?: { App?: AppHexBindings } } })?.go?.main?.App;
}

function splitArgLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | '' = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export interface HexRunnerViewProps {
  activeEngagementId: string | null;
  activeEngagementName: string | null;
  sshSessions: Array<{ id: string; label: string }>;
  rawTcpSessions: Array<{ id: string; label: string }>;
  onSendToApiTester: (draft: { name: string; body: string }) => void;
  onSaveToEvidence?: (title: string, category: string, content: string) => Promise<void>;
  onClose?: () => void;
}

type OutputTab = 'stdout-hex' | 'stdout-ascii' | 'stdout-b64' | 'stderr';

export function HexRunnerView({
  activeEngagementName,
  sshSessions,
  rawTcpSessions,
  onSendToApiTester,
  onSaveToEvidence,
  onClose,
}: HexRunnerViewProps): React.JSX.Element {
  const [targetType, setTargetType] = useState<'local' | 'ssh'>('local');
  const [selectedSshId, setSelectedSshId] = useState<string>('');
  const [executable, setExecutable] = useState<string>('');
  const [argsLine, setArgsLine] = useState<string>('');
  const [workingDir, setWorkingDir] = useState<string>('');
  const [timeoutSec, setTimeoutSec] = useState<number>(15);

  const [chunks, setChunks] = useState<HexExecChunk[]>([
    { payloadExpr: '41*16 \\x00\\x01\\xfe\\xff u32le(0xdeadbeef)', delayMs: 0 },
  ]);
  const [preview, setPreview] = useState<HexParsePreview | null>(null);

  const [cyclicLen, setCyclicLen] = useState<number>(128);
  const [cyclicQuery, setCyclicQuery] = useState<string>('0x61616164');
  const [cyclicOffsetMsg, setCyclicOffsetMsg] = useState<string>('');

  const [selectedRawTcpId, setSelectedRawTcpId] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activeExecId, setActiveExecId] = useState<string>('');
  const [result, setResult] = useState<HexRunResult | null>(null);
  const [outputTab, setOutputTab] = useState<OutputTab>('stdout-hex');
  const [statusBanner, setStatusBanner] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string>('');

  useEffect(() => {
    if (!selectedSshId && sshSessions.length > 0) {
      setSelectedSshId(sshSessions[0].id);
    }
  }, [sshSessions, selectedSshId]);

  useEffect(() => {
    if (!selectedRawTcpId && rawTcpSessions.length > 0) {
      setSelectedRawTcpId(rawTcpSessions[0].id);
    }
  }, [rawTcpSessions, selectedRawTcpId]);

  const combinedPayloadExpr = chunks
    .map((c) => c.payloadExpr.trim())
    .filter(Boolean)
    .join('\n');

  // Debounced live hex preview using Go PreviewHexPayload
  useEffect(() => {
    const api = getHexBindings();
    const previewFn = api?.PreviewHexPayload;
    if (!previewFn) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const prev = await previewFn(combinedPayloadExpr);
        if (!cancelled) setPreview(prev);
      } catch (err) {
        if (!cancelled) {
          setPreview({
            byteCount: 0,
            hexCompact: '',
            hexDump: '',
            base64: '',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [combinedPayloadExpr]);

  const handleBrowseBinary = async () => {
    const api = getHexBindings();
    if (!api?.SelectFileDialog) return;
    try {
      const picked = await api.SelectFileDialog(
        'Select Target Binary (F-43)',
        '*.*',
        'Executables / Binaries'
      );
      if (picked) setExecutable(picked);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRun = async () => {
    const api = getHexBindings();
    if (!executable.trim()) {
      setErrorBanner('Specify a local executable path or remote SSH binary command.');
      return;
    }
    if (targetType === 'ssh' && !selectedSshId) {
      setErrorBanner('Select an active SSH session for No-PTY remote execution.');
      return;
    }
    const execId = `hex-${Date.now()}`;
    setIsRunning(true);
    setActiveExecId(execId);
    setErrorBanner('');
    setStatusBanner('');

    const req: HexRunRequest = {
      executionId: execId,
      targetType,
      sessionId: targetType === 'ssh' ? selectedSshId : undefined,
      executable: executable.trim(),
      args: splitArgLine(argsLine),
      workingDir: workingDir.trim() || undefined,
      chunks,
      timeoutSec: Number(timeoutSec) || 15,
    };

    try {
      const fn = targetType === 'ssh' ? api?.ExecuteHexSsh : api?.ExecuteHexLocal;
      if (!fn) {
        setErrorBanner(`Backend ${targetType} hex runner method unavailable.`);
        return;
      }
      const res = await fn(req);
      setResult(res);
      if (res.error) {
        setErrorBanner(res.error);
      } else {
        setStatusBanner(
          `Sent ${res.inputByteCount} raw bytes to ${res.targetType.toUpperCase()} target (exit ${res.exitCode}, ${res.durationMs} ms).`
        );
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      setActiveExecId('');
    }
  };

  const handleCancel = async () => {
    const api = getHexBindings();
    if (activeExecId && api?.CancelHexExecution) {
      await api.CancelHexExecution(activeExecId);
      setStatusBanner('Cancellation requested.');
    }
  };

  const handleGenerateCyclic = async () => {
    const api = getHexBindings();
    if (!api?.GenerateCyclicPattern) return;
    setErrorBanner('');
    try {
      const pat = await api.GenerateCyclicPattern(cyclicLen);
      setChunks((prev) => {
        const next = [...prev];
        if (next.length === 0) {
          next.push({ payloadExpr: `"${pat}"`, delayMs: 0 });
        } else {
          const cur = next[0].payloadExpr.trim();
          next[0] = {
            ...next[0],
            payloadExpr: cur ? `${cur} "${pat}"` : `"${pat}"`,
          };
        }
        return next;
      });
      setStatusBanner(`Inserted ${pat.length}-byte De Bruijn cyclic pattern into Chunk 1.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFindOffset = async () => {
    const api = getHexBindings();
    if (!api?.FindCyclicOffset) return;
    setErrorBanner('');
    try {
      const offset = await api.FindCyclicOffset(cyclicQuery.trim());
      setCyclicOffsetMsg(`Exact cyclic offset: ${offset} (0x${offset.toString(16)})`);
    } catch (err) {
      setCyclicOffsetMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSendToRawTcp = async () => {
    const api = getHexBindings();
    if (!api?.SendRawTcpHex) return;
    if (!selectedRawTcpId) {
      setErrorBanner('No active Raw TCP session selected.');
      return;
    }
    setErrorBanner('');
    try {
      const n = await api.SendRawTcpHex(selectedRawTcpId, combinedPayloadExpr);
      setStatusBanner(`Sent ${n} exact raw bytes to Raw TCP session.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBridgeToApi = () => {
    if (!combinedPayloadExpr) {
      setErrorBanner('Payload expression is empty.');
      return;
    }
    onSendToApiTester({
      name: executable.trim() ? `Hex: ${executable.trim().split(/[\\/]/).pop()}` : 'Hex Binary Payload',
      body: combinedPayloadExpr,
    });
    setStatusBanner('Opened payload in HTTP API Tester (bodyType: hex).');
  };

  const handleSaveEvidence = async () => {
    if (!onSaveToEvidence || !result) return;
    const summary = [
      `Target Type: ${result.targetType}`,
      `Executable: ${executable}`,
      `Args: ${argsLine}`,
      `Input Bytes: ${result.inputByteCount}`,
      `Exit Code: ${result.exitCode} (${result.durationMs} ms)`,
      '',
      '=== STDIN HEX DUMP ===',
      result.inputHexPreview,
      '',
      `=== STDOUT HEX DUMP (${result.stdoutBytes} bytes) ===`,
      result.stdoutHexDump || '(empty)',
      '',
      `=== STDERR HEX DUMP (${result.stderrBytes} bytes) ===`,
      result.stderrHexDump || '(empty)',
    ].join('\n');
    await onSaveToEvidence(
      `Hex Runner Capture: ${executable.trim() || 'payload'} (exit ${result.exitCode})`,
      'Exploit / Binary Run',
      summary
    );
    setStatusBanner('Saved binary run & canonical hex dump to Evidence Vault.');
  };

  const appendToken = (idx: number, token: string) => {
    setChunks((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const trimmed = c.payloadExpr.trimEnd();
        return { ...c, payloadExpr: trimmed ? `${trimmed} ${token}` : token };
      })
    );
  };

  return (
    <div
      className="api-tester-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-terminal)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 18%, transparent)',
          gap: '0.6rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
          <CyberIcon name="bolt" size={16} />
          <strong style={{ fontSize: '0.88rem', letterSpacing: '0.03em' }}>
            Binary / Hex Payload Runner (No-PTY)
          </strong>
          {activeEngagementName && (
            <span
              className="badge"
              style={{
                fontSize: '0.68rem',
                padding: '0.15rem 0.45rem',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)',
                borderRadius: '4px',
              }}
            >
              Engagement: {activeEngagementName}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="cyber-hud-btn btn-sm"
            onClick={handleBridgeToApi}
            title="Open compiled hex/DSL payload inside API Tester HTTP Repeater (bodyType: hex)"
          >
            <CyberIcon name="globe" size={13} /> Send to API (hex)
          </button>

          {rawTcpSessions.length > 0 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <select
                aria-label="Raw TCP Target"
                className="cyber-input"
                style={{ fontSize: '0.72rem', width: '140px' }}
                value={selectedRawTcpId}
                onChange={(e) => setSelectedRawTcpId(e.target.value)}
              >
                {rawTcpSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="cyber-hud-btn btn-sm"
                onClick={handleSendToRawTcp}
              >
                <CyberIcon name="network" size={13} /> Send to Raw TCP
              </button>
            </div>
          )}

          {result && onSaveToEvidence && (
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              onClick={handleSaveEvidence}
            >
              <CyberIcon name="shield" size={13} /> Save Evidence
            </button>
          )}

          {onClose && (
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              aria-label="Close Hex Runner"
              onClick={onClose}
            >
              <CyberIcon name="close" size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Banners */}
      {(errorBanner || statusBanner) && (
        <div
          style={{
            padding: '0.35rem 0.75rem',
            fontSize: '0.75rem',
            background: errorBanner
              ? 'rgba(248, 113, 113, 0.14)'
              : 'color-mix(in srgb, var(--accent-bright) 10%, transparent)',
            color: errorBanner ? '#fca5a5' : 'var(--accent-bright)',
            borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 15%, transparent)',
          }}
        >
          {errorBanner || statusBanner}
        </div>
      )}

      {/* Main Split Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 1.05fr) minmax(360px, 1fr)',
          overflow: 'hidden',
        }}
      >
        {/* Left: Target Config + Chunked Hex Composer + De Bruijn Tools */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflowY: 'auto',
            padding: '0.65rem 0.75rem',
            gap: '0.65rem',
            borderRight: '1px solid color-mix(in srgb, var(--accent-bright) 16%, transparent)',
          }}
        >
          {/* Target Configuration */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
              padding: '0.55rem',
              borderRadius: '6px',
              border: '1px solid color-mix(in srgb, var(--accent-bright) 18%, transparent)',
              background: 'color-mix(in srgb, var(--bg-panel) 55%, transparent)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.72rem', opacity: 0.85 }}>Execution Target:</label>
              <select
                aria-label="Target Type"
                className="cyber-input"
                style={{ width: '165px', fontSize: '0.74rem' }}
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as 'local' | 'ssh')}
              >
                <option value="local">Local Binary (os/exec)</option>
                <option value="ssh">Remote SSH (No-PTY Exec)</option>
              </select>

              {targetType === 'ssh' && (
                <select
                  aria-label="SSH Session"
                  className="cyber-input"
                  style={{ flex: 1, minWidth: '170px', fontSize: '0.74rem' }}
                  value={selectedSshId}
                  onChange={(e) => setSelectedSshId(e.target.value)}
                >
                  {sshSessions.length === 0 ? (
                    <option value="">No active SSH session</option>
                  ) : (
                    sshSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))
                  )}
                </select>
              )}

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginLeft: 'auto' }}>
                <label style={{ fontSize: '0.71rem', opacity: 0.8 }}>Timeout (s):</label>
                <input
                  aria-label="Timeout Seconds"
                  type="number"
                  min={1}
                  max={300}
                  className="cyber-input"
                  style={{ width: '64px', fontSize: '0.74rem' }}
                  value={timeoutSec}
                  onChange={(e) => setTimeoutSec(Number(e.target.value) || 15)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                aria-label="Target Executable"
                type="text"
                className="cyber-input font-mono"
                style={{ flex: 1, fontSize: '0.75rem' }}
                placeholder={
                  targetType === 'local'
                    ? 'Path to local executable (e.g. C:\\lab\\vuln.exe or ./chal)'
                    : 'Remote command path (e.g. /opt/chal/vuln)'
                }
                value={executable}
                onChange={(e) => setExecutable(e.target.value)}
              />
              {targetType === 'local' && (
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm"
                  onClick={handleBrowseBinary}
                >
                  <CyberIcon name="folder" size={13} /> Browse
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <input
                aria-label="Binary Arguments"
                type="text"
                className="cyber-input font-mono"
                style={{ fontSize: '0.73rem' }}
                placeholder="CLI args (space-separated, quoted supported)"
                value={argsLine}
                onChange={(e) => setArgsLine(e.target.value)}
              />
              <input
                aria-label="Working Directory"
                type="text"
                className="cyber-input font-mono"
                style={{ fontSize: '0.73rem' }}
                placeholder={targetType === 'local' ? 'Working dir (optional)' : 'Working dir unused on SSH'}
                disabled={targetType === 'ssh'}
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.1rem' }}>
              <span style={{ fontSize: '0.69rem', opacity: 0.72 }}>
                Direct process execution without PTY line discipline, ANSI mangling, or shell wrapping.
              </span>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                {isRunning && (
                  <button
                    type="button"
                    className="cyber-hud-btn btn-sm"
                    onClick={handleCancel}
                  >
                    <CyberIcon name="stop" size={13} /> Cancel
                  </button>
                )}
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm primary"
                  disabled={isRunning}
                  onClick={handleRun}
                >
                  <CyberIcon name="play" size={13} /> {isRunning ? 'Running...' : 'Execute Raw Binary'}
                </button>
              </div>
            </div>
          </div>

          {/* Payload Chunks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: '0.78rem' }}>
                Raw Stdin Chunks (Compiled Bytes:{' '}
                <span style={{ color: 'var(--accent-bright)' }}>
                  {preview ? `${preview.byteCount}` : '0'}
                </span>
                )
              </strong>
              <button
                type="button"
                className="cyber-hud-btn btn-sm"
                onClick={() => setChunks((prev) => [...prev, { payloadExpr: '', delayMs: 100 }])}
              >
                <CyberIcon name="plus" size={12} /> Add Sequential Chunk
              </button>
            </div>

            {chunks.map((chunk, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  border: '1px solid color-mix(in srgb, var(--accent-bright) 16%, transparent)',
                  background: 'rgba(8, 12, 20, 0.55)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Chunk #{idx + 1}</span>
                  <label style={{ fontSize: '0.69rem', opacity: 0.8 }}>Delay before write (ms):</label>
                  <input
                    aria-label={`Chunk ${idx + 1} Delay Ms`}
                    type="number"
                    min={0}
                    max={30000}
                    className="cyber-input"
                    style={{ width: '68px', fontSize: '0.71rem' }}
                    value={chunk.delayMs ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      setChunks((prev) => prev.map((c, i) => (i === idx ? { ...c, delayMs: v } : c)));
                    }}
                  />
                  <div style={{ display: 'inline-flex', gap: '0.2rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
                    {['\\x00', '\\x90*16', 'u32le(0xdeadbeef)', 'u64le(0x41424344)', '0a'].map((tok) => (
                      <button
                        key={tok}
                        type="button"
                        className="cyber-hud-btn btn-sm"
                        style={{ fontSize: '0.66rem', padding: '0.1rem 0.35rem' }}
                        onClick={() => appendToken(idx, tok)}
                      >
                        +{tok}
                      </button>
                    ))}
                    {chunks.length > 1 && (
                      <button
                        type="button"
                        className="cyber-hud-btn btn-sm"
                        aria-label={`Remove Chunk ${idx + 1}`}
                        onClick={() => setChunks((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <CyberIcon name="trash" size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  aria-label={`Chunk ${idx + 1} Payload`}
                  className="cyber-textarea font-mono"
                  rows={3}
                  style={{ fontSize: '0.75rem' }}
                  placeholder='41 42 00 ff | \x90*16 | "hello\n" | u32le(0xdeadbeef) | cyclic(64)'
                  value={chunk.payloadExpr}
                  onChange={(e) => {
                    const val = e.target.value;
                    setChunks((prev) => prev.map((c, i) => (i === idx ? { ...c, payloadExpr: val } : c)));
                  }}
                />
              </div>
            ))}

            {preview?.error && (
              <div style={{ fontSize: '0.72rem', color: '#fca5a5' }}>
                Syntax error: {preview.error}
              </div>
            )}
          </div>

          {/* Cyclic De Bruijn Pattern Helpers */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              padding: '0.5rem',
              borderRadius: '6px',
              border: '1px solid color-mix(in srgb, var(--accent-bright) 14%, transparent)',
              background: 'color-mix(in srgb, var(--bg-panel) 45%, transparent)',
            }}
          >
            <strong style={{ fontSize: '0.74rem' }}>De Bruijn Cyclic Pattern & Offset Finder</strong>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.71rem' }}>Length:</label>
              <input
                aria-label="Cyclic Length"
                type="number"
                min={4}
                max={65536}
                className="cyber-input"
                style={{ width: '78px', fontSize: '0.72rem' }}
                value={cyclicLen}
                onChange={(e) => setCyclicLen(Number(e.target.value) || 64)}
              />
              <button
                type="button"
                className="cyber-hud-btn btn-sm"
                onClick={handleGenerateCyclic}
              >
                Insert Cyclic Pattern
              </button>

              <input
                aria-label="Cyclic Offset Query"
                type="text"
                className="cyber-input font-mono"
                style={{ flex: 1, minWidth: '130px', fontSize: '0.72rem' }}
                placeholder="e.g. daaa or 0x61616164"
                value={cyclicQuery}
                onChange={(e) => setCyclicQuery(e.target.value)}
              />
              <button
                type="button"
                className="cyber-hud-btn btn-sm"
                onClick={handleFindOffset}
              >
                Find Offset
              </button>
            </div>
            {cyclicOffsetMsg && (
              <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--accent-bright)' }}>
                {cyclicOffsetMsg}
              </div>
            )}
          </div>
        </div>

        {/* Right: Compiled Hex Preview + Execution Inspection */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
            padding: '0.65rem 0.75rem',
            gap: '0.6rem',
          }}
        >
          {/* Live Compiled Stdin Hex Dump Preview */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3rem',
              maxHeight: '38%',
              minHeight: '110px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.76rem' }}>
                Compiled Stdin Wire Preview ({preview?.byteCount ?? 0} bytes)
              </strong>
              {preview?.hexCompact && (
                <button
                  type="button"
                  className="cyber-hud-btn btn-sm"
                  onClick={() => navigator.clipboard?.writeText(preview.hexCompact)}
                >
                  <CyberIcon name="copy" size={12} /> Copy Hex
                </button>
              )}
            </div>
            <pre
              className="font-mono"
              style={{
                flex: 1,
                margin: 0,
                padding: '0.5rem',
                overflow: 'auto',
                borderRadius: '6px',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 16%, transparent)',
                background: 'rgba(6, 10, 18, 0.75)',
                fontSize: '0.72rem',
                lineHeight: 1.4,
                whiteSpace: 'pre',
              }}
            >
              {preview?.hexDump || '(empty payload)'}
            </pre>
          </div>

          {/* Target Output Inspector */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {(
                  [
                    ['stdout-hex', 'Stdout Hex Dump'],
                    ['stdout-ascii', 'Stdout ASCII'],
                    ['stdout-b64', 'Stdout Base64'],
                    ['stderr', 'Stderr'],
                  ] as const
                ).map(([tabKey, label]) => (
                  <button
                    key={tabKey}
                    type="button"
                    className={`settings-tab-btn ${outputTab === tabKey ? 'active' : ''}`}
                    style={{ fontSize: '0.71rem', padding: '0.22rem 0.55rem' }}
                    onClick={() => setOutputTab(tabKey)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {result && (
                <span className="font-mono" style={{ fontSize: '0.71rem', opacity: 0.85 }}>
                  Exit {result.exitCode} · {result.durationMs} ms · Out {result.stdoutBytes}B · Err {result.stderrBytes}B
                  {result.truncated ? ' (truncated)' : ''}
                </span>
              )}
            </div>

            <pre
              aria-label="Execution Output"
              className="font-mono"
              style={{
                flex: 1,
                minHeight: 0,
                margin: 0,
                padding: '0.55rem',
                overflow: 'auto',
                borderRadius: '6px',
                border: '1px solid color-mix(in srgb, var(--accent-bright) 16%, transparent)',
                background: 'rgba(6, 10, 18, 0.85)',
                fontSize: '0.73rem',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {!result
                ? 'Execute a binary or send raw hex to inspect exact non-printable stdout/stderr bytes without terminal rendering.'
                : outputTab === 'stdout-hex'
                  ? result.stdoutHexDump || '(0 bytes on stdout)'
                  : outputTab === 'stdout-ascii'
                    ? result.stdoutASCII || '(0 bytes on stdout)'
                    : outputTab === 'stdout-b64'
                      ? result.stdoutBase64 || '(0 bytes on stdout)'
                      : result.stderrHexDump || result.stderrASCII || '(0 bytes on stderr)'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
