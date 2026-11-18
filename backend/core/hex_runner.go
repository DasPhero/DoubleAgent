package core

import "context"

// HexExecChunk represents one sequential stdin payload chunk and optional pre-send delay (F-43).
type HexExecChunk struct {
	PayloadExpr string `json:"payloadExpr"`
	DelayMs     int    `json:"delayMs,omitempty"`
}

// HexRunRequest configures a non-PTY local or SSH binary execution with exact raw bytes (F-43).
type HexRunRequest struct {
	ExecutionID string         `json:"executionId,omitempty"`
	TargetType  string         `json:"targetType"` // "local" | "ssh"
	SessionID   string         `json:"sessionId,omitempty"`
	Executable  string         `json:"executable"`
	Args        []string       `json:"args,omitempty"`
	WorkingDir  string         `json:"workingDir,omitempty"`
	Chunks      []HexExecChunk `json:"chunks"`
	TimeoutSec  int            `json:"timeoutSec,omitempty"`
	EnvVars     []ApiKeyValue  `json:"envVars,omitempty"`
}

// HexRunResult captures exact byte-level stdout/stderr dumps and metadata without terminal mangling (F-43).
type HexRunResult struct {
	ExecutionID     string `json:"executionId,omitempty"`
	TargetType      string `json:"targetType"`
	InputByteCount  int    `json:"inputByteCount"`
	InputHexPreview string `json:"inputHexPreview,omitempty"`
	ExitCode        int    `json:"exitCode"`
	DurationMs      int64  `json:"durationMs"`
	StdoutHexDump   string `json:"stdoutHexDump"`
	StdoutASCII     string `json:"stdoutAscii"`
	StdoutBase64    string `json:"stdoutBase64"`
	StdoutBytes     int    `json:"stdoutBytes"`
	StderrHexDump   string `json:"stderrHexDump"`
	StderrASCII     string `json:"stderrAscii"`
	StderrBytes     int    `json:"stderrBytes"`
	Truncated       bool   `json:"truncated,omitempty"`
	Error           string `json:"error,omitempty"`
}

// HexParsePreview summarizes parsed raw bytes from a hex/pack expression (F-43).
type HexParsePreview struct {
	ByteCount  int    `json:"byteCount"`
	HexCompact string `json:"hexCompact"`
	HexDump    string `json:"hexDump"`
	Base64     string `json:"base64"`
	Error      string `json:"error,omitempty"`
}

// SshBinaryRunner is an optional capability on SshTransport for running non-PTY commands with raw []byte stdin (F-43).
type SshBinaryRunner interface {
	ExecRaw(ctx context.Context, sessionID string, command string, stdin []byte, maxBytes int) (stdout []byte, stderr []byte, exitCode int, err error)
}
