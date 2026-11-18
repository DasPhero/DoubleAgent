package hexrunner

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"doubleagent/backend/core"
)

const (
	defaultExecTimeoutSec = 15
	maxCaptureBytes       = 2 * 1024 * 1024 // 2 MiB cap per stream
	maxCyclicLength       = 20280
)

// Runner executes direct local binaries (without PTY/shell) or remote non-PTY SSH commands with raw bytes (F-43).
type Runner struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

// NewRunner initializes a HexRunner with active execution cancellation tracking.
func NewRunner() *Runner {
	return &Runner{
		cancels: make(map[string]context.CancelFunc),
	}
}

// Cancel aborts a running local or SSH hex execution matching executionID.
func (r *Runner) Cancel(executionID string) bool {
	r.mu.Lock()
	cancel, ok := r.cancels[executionID]
	r.mu.Unlock()
	if ok && cancel != nil {
		cancel()
		return true
	}
	return false
}

func (r *Runner) registerCancel(executionID string, cancel context.CancelFunc) func() {
	if strings.TrimSpace(executionID) == "" {
		return cancel
	}
	r.mu.Lock()
	r.cancels[executionID] = cancel
	r.mu.Unlock()
	return func() {
		cancel()
		r.mu.Lock()
		delete(r.cancels, executionID)
		r.mu.Unlock()
	}
}

// CompilePayload parses flexible hex/escape/packer/cyclic syntax into exact arbitrary bytes (0x00..0xFF) (F-43).
// Supported forms (whitespace separated or contiguous hex):
//   - Raw hex pairs or streams: `41 42 00 ff`, `414200ff`, `0x41`, `\x41\x00\x90`
//   - Quoted strings with escapes (\n, \r, \t, \0, \\, \xHH): `"hello\x00\n"`
//   - Repeaters: `A*32`, `0x90*16`, `\x41*10`
//   - Endian packers: `u32le(0xdeadbeef)`, `u32be(0xdeadbeef)`, `u64le(0x...)`, `u64be(0x...)`
//   - Cyclic De Bruijn pattern: `cyclic(128)`
//   - Comments starting with `#` or `//` to end of line
func CompilePayload(expr string) ([]byte, error) {
	lines := strings.Split(strings.ReplaceAll(expr, "\r\n", "\n"), "\n")
	var out bytes.Buffer

	for lineNum, rawLine := range lines {
		line := stripLineComment(rawLine)
		if strings.TrimSpace(line) == "" {
			continue
		}
		tokens, err := tokenizeLine(line)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", lineNum+1, err)
		}
		for _, tok := range tokens {
			b, err := evalToken(tok)
			if err != nil {
				return nil, fmt.Errorf("line %d token %q: %w", lineNum+1, tok, err)
			}
			out.Write(b)
		}
	}

	return out.Bytes(), nil
}

func stripLineComment(line string) string {
	inQuotes := false
	escaped := false
	for i := 0; i < len(line); i++ {
		ch := line[i]
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' && inQuotes {
			escaped = true
			continue
		}
		if ch == '"' {
			inQuotes = !inQuotes
			continue
		}
		if !inQuotes {
			if ch == '#' {
				return line[:i]
			}
			if ch == '/' && i+1 < len(line) && line[i+1] == '/' {
				return line[:i]
			}
		}
	}
	return line
}

func tokenizeLine(line string) ([]string, error) {
	var tokens []string
	var cur strings.Builder
	inQuotes := false
	escaped := false

	for i := 0; i < len(line); i++ {
		ch := line[i]
		if inQuotes {
			cur.WriteByte(ch)
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inQuotes = false
			}
			continue
		}
		if ch == '"' {
			inQuotes = true
			cur.WriteByte(ch)
			continue
		}
		if unicode.IsSpace(rune(ch)) || ch == ',' {
			if cur.Len() > 0 {
				tokens = append(tokens, cur.String())
				cur.Reset()
			}
			continue
		}
		cur.WriteByte(ch)
	}
	if inQuotes {
		return nil, errors.New("unterminated string literal")
	}
	if cur.Len() > 0 {
		tokens = append(tokens, cur.String())
	}
	return tokens, nil
}

func evalToken(tok string) ([]byte, error) {
	// 1. Repeater: <atom>*<count> (only outside quoted string literal)
	if !strings.HasPrefix(tok, "\"") {
		if base, cntStr, ok := strings.Cut(tok, "*"); ok && base != "" && cntStr != "" {
			count, err := strconv.Atoi(cntStr)
			if err != nil || count < 0 || count > maxCaptureBytes {
				return nil, fmt.Errorf("invalid repeat count %q", cntStr)
			}
			atom, err := evalAtom(base)
			if err != nil {
				return nil, err
			}
			if int64(len(atom))*int64(count) > maxCaptureBytes {
				return nil, errors.New("repeated payload exceeds 2 MiB safety cap")
			}
			return bytes.Repeat(atom, count), nil
		}
	}
	return evalAtom(tok)
}

func evalAtom(tok string) ([]byte, error) {
	// Quoted string with C/hex escapes
	if strings.HasPrefix(tok, "\"") && strings.HasSuffix(tok, "\"") && len(tok) >= 2 {
		return parseQuotedBytes(tok[1 : len(tok)-1])
	}

	lower := strings.ToLower(tok)

	// cyclic(N)
	if strings.HasPrefix(lower, "cyclic(") && strings.HasSuffix(lower, ")") {
		nStr := strings.TrimSpace(tok[len("cyclic(") : len(tok)-1])
		n, err := strconv.Atoi(nStr)
		if err != nil || n <= 0 || n > maxCyclicLength {
			return nil, fmt.Errorf("cyclic length must be 1..%d", maxCyclicLength)
		}
		return CyclicPattern(n), nil
	}

	// Endian integer packers: u32le / u32be / u64le / u64be
	for _, spec := range []struct {
		prefix string
		size   int
		le     bool
	}{
		{"u32le(", 4, true},
		{"u32be(", 4, false},
		{"u64le(", 8, true},
		{"u64be(", 8, false},
	} {
		if strings.HasPrefix(lower, spec.prefix) && strings.HasSuffix(lower, ")") {
			valStr := strings.TrimSpace(tok[len(spec.prefix) : len(tok)-1])
			v, err := strconv.ParseUint(valStr, 0, spec.size*8)
			if err != nil {
				return nil, fmt.Errorf("invalid integer %q: %w", valStr, err)
			}
			buf := make([]byte, spec.size)
			if spec.size == 4 {
				if spec.le {
					binary.LittleEndian.PutUint32(buf, uint32(v))
				} else {
					binary.BigEndian.PutUint32(buf, uint32(v))
				}
			} else {
				if spec.le {
					binary.LittleEndian.PutUint64(buf, v)
				} else {
					binary.BigEndian.PutUint64(buf, v)
				}
			}
			return buf, nil
		}
	}

	// 0xHH single/multi-byte hex literal
	if strings.HasPrefix(lower, "0x") && len(tok) > 2 {
		hexPart := tok[2:]
		if len(hexPart)%2 == 1 {
			hexPart = "0" + hexPart
		}
		return hex.DecodeString(hexPart)
	}

	// \xHH escape sequence(s)
	if strings.Contains(tok, `\x`) || strings.Contains(tok, `\X`) {
		return parseEscapedHexToken(tok)
	}

	// Single ASCII char for repeaters like A*16
	if len(tok) == 1 && !isHexChar(tok[0]) {
		return []byte{tok[0]}, nil
	}

	// Pure even-length hex pairs or contiguous hex stream (e.g., "41", "414200ff")
	if len(tok)%2 == 0 {
		decoded, err := hex.DecodeString(tok)
		if err == nil {
			return decoded, nil
		}
	}

	// Single non-hex character fallback
	if len(tok) == 1 {
		return []byte{tok[0]}, nil
	}
	return nil, errors.New("unrecognized token; use hex bytes (41 00 ff), \\x41, \"str\", A*16, u32le(0x...), or cyclic(N)")
}

func isHexChar(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func parseEscapedHexToken(tok string) ([]byte, error) {
	return parseQuotedBytes(tok)
}

func parseQuotedBytes(s string) ([]byte, error) {
	var out bytes.Buffer
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' {
			out.WriteByte(s[i])
			continue
		}
		if i+1 >= len(s) {
			return nil, errors.New("trailing backslash")
		}
		i++
		switch s[i] {
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case 't':
			out.WriteByte('\t')
		case '0':
			out.WriteByte(0x00)
		case '\\':
			out.WriteByte('\\')
		case '"':
			out.WriteByte('"')
		case 'x', 'X':
			if i+2 >= len(s) {
				return nil, errors.New("incomplete \\xHH escape")
			}
			b, err := hex.DecodeString(s[i+1 : i+3])
			if err != nil {
				return nil, fmt.Errorf("invalid \\x escape %q: %w", s[i+1:i+3], err)
			}
			out.Write(b)
			i += 2
		default:
			out.WriteByte(s[i])
		}
	}
	return out.Bytes(), nil
}

// CyclicPattern generates a De Bruijn sequence (alphabet A/a/0, sub-pattern length 4) for offset identification (F-43).
func CyclicPattern(length int) []byte {
	if length <= 0 {
		return nil
	}
	if length > maxCyclicLength {
		length = maxCyclicLength
	}
	const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	const lower = "abcdefghijklmnopqrstuvwxyz"
	const digits = "0123456789"

	var out bytes.Buffer
	out.Grow(length)
	for i := 0; i < len(upper) && out.Len() < length; i++ {
		for j := 0; j < len(lower) && out.Len() < length; j++ {
			for k := 0; k < len(digits) && out.Len() < length; k++ {
				out.WriteByte(upper[i])
				if out.Len() < length {
					out.WriteByte(lower[j])
				}
				if out.Len() < length {
					out.WriteByte(digits[k])
				}
			}
		}
	}
	return out.Bytes()
}

// CyclicOffset locates a 3..8 byte pattern (as ASCII "daaa" or hex "0x61616164") in the CyclicPattern (F-43).
func CyclicOffset(query string) (int, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return -1, errors.New("pattern query must not be empty")
	}
	pat := CyclicPattern(maxCyclicLength)

	var needle []byte
	if strings.HasPrefix(strings.ToLower(q), "0x") {
		v, err := strconv.ParseUint(q, 0, 64)
		if err != nil {
			return -1, fmt.Errorf("invalid hex query: %w", err)
		}
		if len(q)-2 <= 8 {
			var b [4]byte
			binary.LittleEndian.PutUint32(b[:], uint32(v))
			if idx := bytes.Index(pat, b[:]); idx >= 0 {
				return idx, nil
			}
			binary.BigEndian.PutUint32(b[:], uint32(v))
			if idx := bytes.Index(pat, b[:]); idx >= 0 {
				return idx, nil
			}
		} else {
			var b [8]byte
			binary.LittleEndian.PutUint64(b[:], v)
			if idx := bytes.Index(pat, b[:]); idx >= 0 {
				return idx, nil
			}
			binary.BigEndian.PutUint64(b[:], v)
			if idx := bytes.Index(pat, b[:]); idx >= 0 {
				return idx, nil
			}
		}
		return -1, fmt.Errorf("pattern %q not found in cyclic sequence", query)
	}

	needle = []byte(q)
	if idx := bytes.Index(pat, needle); idx >= 0 {
		return idx, nil
	}
	return -1, fmt.Errorf("pattern %q not found in cyclic sequence", query)
}

// PreviewHexPayload compiles expr and returns compact hex, canonical xxd dump, and base64 preview (F-43).
func PreviewHexPayload(expr string) core.HexParsePreview {
	b, err := CompilePayload(expr)
	if err != nil {
		return core.HexParsePreview{Error: err.Error()}
	}
	return core.HexParsePreview{
		ByteCount:  len(b),
		HexCompact: formatHexSpaced(b),
		HexDump:    FormatHexDump(b),
		Base64:     base64.StdEncoding.EncodeToString(b),
	}
}

func formatHexSpaced(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = fmt.Sprintf("%02x", v)
	}
	return strings.Join(parts, " ")
}

// FormatHexDump formats raw bytes into an xxd-style offset / 16-byte hex / printable ASCII dump (F-43).
func FormatHexDump(data []byte) string {
	if len(data) == 0 {
		return "(0 bytes)"
	}
	var sb strings.Builder
	for offset := 0; offset < len(data); offset += 16 {
		end := offset + 16
		if end > len(data) {
			end = len(data)
		}
		chunk := data[offset:end]
		sb.WriteString(fmt.Sprintf("%08x: ", offset))
		for i := 0; i < 16; i++ {
			if i < len(chunk) {
				sb.WriteString(fmt.Sprintf("%02x", chunk[i]))
			} else {
				sb.WriteString("  ")
			}
			if i%2 == 1 {
				sb.WriteByte(' ')
			}
		}
		sb.WriteString(" |")
		for _, c := range chunk {
			if c >= 0x20 && c <= 0x7e {
				sb.WriteByte(c)
			} else {
				sb.WriteByte('.')
			}
		}
		sb.WriteByte('|')
		if end < len(data) {
			sb.WriteByte('\n')
		}
	}
	return sb.String()
}

// FormatEscapedASCII renders arbitrary bytes as printable ASCII with \xHH escapes for non-printables (F-43).
func FormatEscapedASCII(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.Grow(len(data))
	for _, b := range data {
		switch b {
		case '\n':
			sb.WriteString("\n")
		case '\r':
			sb.WriteString(`\r`)
		case '\t':
			sb.WriteString("\t")
		default:
			if b >= 0x20 && b <= 0x7e {
				sb.WriteByte(b)
			} else {
				sb.WriteString(fmt.Sprintf(`\x%02x`, b))
			}
		}
	}
	return sb.String()
}

// RunLocal executes a local executable directly without PTY or shell wrapping and streams raw hex chunks to stdin (F-43).
func (r *Runner) RunLocal(ctx context.Context, req core.HexRunRequest) (*core.HexRunResult, error) {
	exe := strings.TrimSpace(req.Executable)
	if exe == "" {
		return nil, errors.New("executable path must not be empty")
	}

	compiledChunks := make([][]byte, 0, len(req.Chunks))
	var combinedInput bytes.Buffer
	for i, ch := range req.Chunks {
		b, err := CompilePayload(ch.PayloadExpr)
		if err != nil {
			return &core.HexRunResult{
				ExecutionID: req.ExecutionID,
				TargetType:  "local",
				ExitCode:    -1,
				Error:       fmt.Sprintf("chunk %d compile error: %v", i+1, err),
			}, nil
		}
		compiledChunks = append(compiledChunks, b)
		combinedInput.Write(b)
	}

	timeoutSec := req.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = defaultExecTimeoutSec
	}
	runCtx, rawCancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	cleanup := r.registerCancel(req.ExecutionID, rawCancel)
	defer cleanup()

	// Direct binary execution: zero shell wrapper, zero PTY translation
	cmd := exec.CommandContext(runCtx, exe, req.Args...)
	if strings.TrimSpace(req.WorkingDir) != "" {
		cmd.Dir = strings.TrimSpace(req.WorkingDir)
	}
	if len(req.EnvVars) > 0 {
		env := cmd.Environ()
		for _, kv := range req.EnvVars {
			if kv.Enabled && strings.TrimSpace(kv.Key) != "" {
				env = append(env, fmt.Sprintf("%s=%s", strings.TrimSpace(kv.Key), kv.Value))
			}
		}
		cmd.Env = env
	}

	pr, pw := io.Pipe()
	cmd.Stdin = pr

	stdoutBuf := &cappedBuffer{max: maxCaptureBytes}
	stderrBuf := &cappedBuffer{max: maxCaptureBytes}
	cmd.Stdout = stdoutBuf
	cmd.Stderr = stderrBuf

	start := time.Now()
	if err := cmd.Start(); err != nil {
		_ = pr.Close()
		_ = pw.Close()
		return &core.HexRunResult{
			ExecutionID:     req.ExecutionID,
			TargetType:      "local",
			InputByteCount:  combinedInput.Len(),
			InputHexPreview: formatHexSpaced(combinedInput.Bytes()),
			ExitCode:        -1,
			DurationMs:      time.Since(start).Milliseconds(),
			Error:           err.Error(),
		}, nil
	}

	writeErrCh := make(chan error, 1)
	go func() {
		defer func() { _ = pw.Close() }()
		for i, chunkBytes := range compiledChunks {
			if delay := req.Chunks[i].DelayMs; delay > 0 {
				timer := time.NewTimer(time.Duration(delay) * time.Millisecond)
				select {
				case <-runCtx.Done():
					timer.Stop()
					writeErrCh <- runCtx.Err()
					return
				case <-timer.C:
				}
			}
			if len(chunkBytes) > 0 {
				if _, wErr := pw.Write(chunkBytes); wErr != nil {
					writeErrCh <- wErr
					return
				}
			}
		}
		writeErrCh <- nil
	}()

	waitErr := cmd.Wait()
	_ = <-writeErrCh
	durationMs := time.Since(start).Milliseconds()

	exitCode := 0
	errMsg := ""
	if waitErr != nil {
		errMsg = waitErr.Error()
		var ee *exec.ExitError
		if errors.As(waitErr, &ee) {
			exitCode = ee.ExitCode()
		} else if runCtx.Err() != nil {
			exitCode = -1
			errMsg = runCtx.Err().Error()
		} else {
			exitCode = -1
		}
	}

	outBytes := stdoutBuf.Bytes()
	errBytes := stderrBuf.Bytes()
	return &core.HexRunResult{
		ExecutionID:     req.ExecutionID,
		TargetType:      "local",
		InputByteCount:  combinedInput.Len(),
		InputHexPreview: formatHexSpaced(combinedInput.Bytes()),
		ExitCode:        exitCode,
		DurationMs:      durationMs,
		StdoutHexDump:   FormatHexDump(outBytes),
		StdoutASCII:     FormatEscapedASCII(outBytes),
		StdoutBase64:    base64.StdEncoding.EncodeToString(outBytes),
		StdoutBytes:     len(outBytes),
		StderrHexDump:   FormatHexDump(errBytes),
		StderrASCII:     FormatEscapedASCII(errBytes),
		StderrBytes:     len(errBytes),
		Truncated:       stdoutBuf.truncated || stderrBuf.truncated,
		Error:           errMsg,
	}, nil
}

// RunSSH executes a command over an active non-PTY SSH channel with raw binary stdin/stdout (F-43).
func (r *Runner) RunSSH(ctx context.Context, runner core.SshBinaryRunner, req core.HexRunRequest) (*core.HexRunResult, error) {
	if runner == nil {
		return nil, errors.New("SSH binary execution transport is unavailable")
	}
	if strings.TrimSpace(req.SessionID) == "" {
		return nil, errors.New("active SSH session ID is required")
	}
	cmdStr := strings.TrimSpace(req.Executable)
	if len(req.Args) > 0 {
		cmdStr = cmdStr + " " + strings.Join(req.Args, " ")
	}
	if cmdStr == "" {
		return nil, errors.New("remote command / binary path must not be empty")
	}

	var combined bytes.Buffer
	for i, ch := range req.Chunks {
		b, err := CompilePayload(ch.PayloadExpr)
		if err != nil {
			return &core.HexRunResult{
				ExecutionID: req.ExecutionID,
				TargetType:  "ssh",
				ExitCode:    -1,
				Error:       fmt.Sprintf("chunk %d compile error: %v", i+1, err),
			}, nil
		}
		combined.Write(b)
	}

	timeoutSec := req.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = defaultExecTimeoutSec
	}
	runCtx, rawCancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	cleanup := r.registerCancel(req.ExecutionID, rawCancel)
	defer cleanup()

	start := time.Now()
	outBytes, errBytes, exitCode, execErr := runner.ExecRaw(runCtx, req.SessionID, cmdStr, combined.Bytes(), maxCaptureBytes)
	errMsg := ""
	if execErr != nil {
		errMsg = execErr.Error()
	}

	return &core.HexRunResult{
		ExecutionID:     req.ExecutionID,
		TargetType:      "ssh",
		InputByteCount:  combined.Len(),
		InputHexPreview: formatHexSpaced(combined.Bytes()),
		ExitCode:        exitCode,
		DurationMs:      time.Since(start).Milliseconds(),
		StdoutHexDump:   FormatHexDump(outBytes),
		StdoutASCII:     FormatEscapedASCII(outBytes),
		StdoutBase64:    base64.StdEncoding.EncodeToString(outBytes),
		StdoutBytes:     len(outBytes),
		StderrHexDump:   FormatHexDump(errBytes),
		StderrASCII:     FormatEscapedASCII(errBytes),
		StderrBytes:     len(errBytes),
		Error:           errMsg,
	}, nil
}

type cappedBuffer struct {
	mu        sync.Mutex
	buf       bytes.Buffer
	max       int
	truncated bool
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rem := c.max - c.buf.Len()
	if rem <= 0 {
		c.truncated = true
		return len(p), nil
	}
	if len(p) > rem {
		c.buf.Write(p[:rem])
		c.truncated = true
		return len(p), nil
	}
	return c.buf.Write(p)
}

func (c *cappedBuffer) Bytes() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]byte, c.buf.Len())
	copy(out, c.buf.Bytes())
	return out
}
