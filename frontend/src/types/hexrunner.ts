export interface HexExecChunk {
  payloadExpr: string;
  delayMs?: number;
}

export interface HexRunRequest {
  executionId: string;
  targetType: 'local' | 'ssh';
  sessionId?: string;
  executable: string;
  args?: string[];
  workingDir?: string;
  chunks: HexExecChunk[];
  timeoutSec?: number;
}

export interface HexRunResult {
  executionId: string;
  targetType: string;
  inputByteCount: number;
  inputHexPreview: string;
  exitCode: number;
  durationMs: number;
  stdoutHexDump: string;
  stdoutASCII: string;
  stdoutBase64: string;
  stdoutBytes: number;
  stderrHexDump: string;
  stderrASCII: string;
  stderrBytes: number;
  truncated: boolean;
  error?: string;
}

export interface HexParsePreview {
  byteCount: number;
  hexCompact: string;
  hexDump: string;
  base64: string;
  error?: string;
}
