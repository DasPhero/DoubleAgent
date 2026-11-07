package core

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	// ansiEscapeRegex strips CSI, OSC, and 2-byte escape sequences so log files remain human-readable.
	ansiEscapeRegex = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]`)

	// passwordPromptRegex matches common password, passphrase, PIN, and 2FA prompts (case-insensitive)
	// so password-echo or credential input is never recorded (Spec Line 131 & 153, F-21).
	passwordPromptRegex = regexp.MustCompile(`(?i)(?:password|passphrase|passcode|pin|verification code|one-time code|totp code|enter secret|\[sudo\] password)[^:\r\n]*:\s*$`)
)

// StripANSI removes terminal escape sequences and control characters (except \n and \t) from s.
func StripANSI(s string) string {
	cleaned := ansiEscapeRegex.ReplaceAllString(s, "")
	cleaned = strings.ReplaceAll(cleaned, "\r\n", "\n")
	cleaned = strings.ReplaceAll(cleaned, "\r", "")
	var b strings.Builder
	b.Grow(len(cleaned))
	for _, r := range cleaned {
		if r == '\n' || r == '\t' || r >= 0x20 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// IsPasswordPromptLine returns true if the terminal output tail looks like an interactive password/passphrase prompt.
func IsPasswordPromptLine(text string) bool {
	cleaned := StripANSI(text)
	lines := strings.Split(cleaned, "\n")
	lastLine := strings.TrimSpace(lines[len(lines)-1])
	if lastLine == "" && len(lines) > 1 {
		lastLine = strings.TrimSpace(lines[len(lines)-2])
	}
	return passwordPromptRegex.MatchString(lastLine)
}

type activeSessionLogger struct {
	record         SessionLogRecord
	file           *os.File
	pendingLine    string
	echoSuppressed bool
	secrets        []string
	nowFunc        func() time.Time
}

// SessionLogManager manages per-session timestamped log files and enforces password-echo redaction (F-21).
type SessionLogManager struct {
	mu          sync.Mutex
	logDir      string
	activeBySID map[string]*activeSessionLogger
	recordsByID map[string]SessionLogRecord
	seq         int64
	nowFunc     func() time.Time
}

// NewSessionLogManager creates a SessionLogManager storing `.log` files in logDir.
func NewSessionLogManager(logDir string) *SessionLogManager {
	if logDir == "" {
		logDir = filepath.Join(os.TempDir(), "doubleagent-logs")
	}
	_ = os.MkdirAll(logDir, 0o700)
	return &SessionLogManager{
		logDir:      logDir,
		activeBySID: make(map[string]*activeSessionLogger),
		recordsByID: make(map[string]SessionLogRecord),
		nowFunc:     time.Now,
	}
}

func sanitizeFilenamePart(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "session"
	}
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	res := strings.Trim(b.String(), "_")
	if res == "" {
		return "session"
	}
	return res
}

// StartSession begins recording timestamped output for sessionID (or returns the existing active status).
func (m *SessionLogManager) StartSession(sessionID, hostID, hostLabel string) (SessionLogStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.activeBySID[sessionID]; ok {
		return SessionLogStatus{
			SessionID: sessionID,
			LogID:     existing.record.ID,
			Active:    true,
			FilePath:  existing.record.FilePath,
			ByteCount: existing.record.ByteCount,
			LineCount: existing.record.LineCount,
		}, nil
	}

	if err := os.MkdirAll(m.logDir, 0o700); err != nil {
		return SessionLogStatus{}, fmt.Errorf("create log dir: %w", err)
	}

	now := m.nowFunc().UTC()
	m.seq++
	logID := fmt.Sprintf("log-%d-%d", now.UnixMilli(), m.seq)
	if hostLabel == "" {
		hostLabel = sessionID
	}
	fileName := fmt.Sprintf("%s_%s_%s.log", now.Format("20060102_150405"), sanitizeFilenamePart(hostLabel), logID)
	filePath := filepath.Join(m.logDir, fileName)

	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return SessionLogStatus{}, fmt.Errorf("open session log file: %w", err)
	}

	rec := SessionLogRecord{
		ID:        logID,
		SessionID: sessionID,
		HostID:    hostID,
		HostLabel: hostLabel,
		StartedAt: now.Format("2006-01-02 15:04:05 UTC"),
		FilePath:  filePath,
		Active:    true,
	}

	header := fmt.Sprintf("[%s] --- Session Log Started: %s (Session: %s) ---\n", now.Format("2006-01-02 15:04:05.000"), hostLabel, sessionID)
	n, _ := f.WriteString(header)
	rec.ByteCount += int64(n)
	rec.LineCount++

	logger := &activeSessionLogger{
		record:  rec,
		file:    f,
		nowFunc: m.nowFunc,
	}
	m.activeBySID[sessionID] = logger
	m.recordsByID[logID] = rec

	return SessionLogStatus{
		SessionID: sessionID,
		LogID:     rec.ID,
		Active:    true,
		FilePath:  rec.FilePath,
		ByteCount: rec.ByteCount,
		LineCount: rec.LineCount,
	}, nil
}

// RegisterSensitiveValue registers a secret string (e.g. password or 2FA token) for redaction on sessionID.
func (m *SessionLogManager) RegisterSensitiveValue(sessionID, secret string) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if logger, ok := m.activeBySID[sessionID]; ok {
		for _, s := range logger.secrets {
			if s == secret {
				return
			}
		}
		logger.secrets = append(logger.secrets, secret)
	}
}

// SuppressNextEcho arms password-echo suppression on sessionID (e.g. when injecting a password or 2FA code).
func (m *SessionLogManager) SuppressNextEcho(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if logger, ok := m.activeBySID[sessionID]; ok {
		logger.echoSuppressed = true
	}
}

// NotifyInput inspects terminal input for newline completion to disarm password-echo suppression after a prompt.
func (m *SessionLogManager) NotifyInput(sessionID, input string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	logger, ok := m.activeBySID[sessionID]
	if !ok {
		return
	}
	if logger.echoSuppressed && (strings.Contains(input, "\r") || strings.Contains(input, "\n")) {
		// Discard any buffered echo characters accumulated during the password prompt
		logger.pendingLine = ""
		logger.echoSuppressed = false
	}
}

func redactSecrets(line string, secrets []string) string {
	out := line
	for _, sec := range secrets {
		if sec != "" && strings.Contains(out, sec) {
			out = strings.ReplaceAll(out, sec, "[REDACTED]")
		}
	}
	return out
}

// WriteOutput processes a chunk of terminal output, redacting any password-echo or secrets and writing timestamped lines.
func (m *SessionLogManager) WriteOutput(sessionID, chunk string) {
	if chunk == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	logger, ok := m.activeBySID[sessionID]
	if !ok || logger.file == nil {
		return
	}

	cleaned := StripANSI(chunk)
	if cleaned == "" {
		return
	}

	// If echo suppression is currently active (e.g., waiting for user to finish typing password):
	if logger.echoSuppressed {
		// Check if chunk contains a newline (meaning the prompt line completed).
		idx := strings.IndexByte(cleaned, '\n')
		if idx == -1 {
			// Still on the password prompt line: never record echoed characters!
			return
		}
		// Newline reached: discard everything before the newline (any echoed password characters)
		// and resume logging after the newline.
		logger.echoSuppressed = false
		cleaned = cleaned[idx+1:]
	}

	// Check if the incoming chunk ends with a password/passphrase prompt.
	promptDetected := IsPasswordPromptLine(logger.pendingLine + cleaned)

	combined := logger.pendingLine + cleaned
	parts := strings.Split(combined, "\n")

	// All elements except the last are complete lines ending with \n
	nowTs := logger.nowFunc().UTC().Format("2006-01-02 15:04:05.000")
	for i := 0; i < len(parts)-1; i++ {
		line := redactSecrets(parts[i], logger.secrets)
		formatted := fmt.Sprintf("[%s] %s\n", nowTs, line)
		n, _ := logger.file.WriteString(formatted)
		logger.record.ByteCount += int64(n)
		logger.record.LineCount++
	}

	logger.pendingLine = redactSecrets(parts[len(parts)-1], logger.secrets)

	// If the trailing partial line is a password prompt, flush the prompt text itself with a timestamp
	// and arm echoSuppressed so any characters echoed while typing the password are never recorded.
	if promptDetected {
		if strings.TrimSpace(logger.pendingLine) != "" {
			formatted := fmt.Sprintf("[%s] %s [PASSWORD ECHO SUPPRESSED]\n", nowTs, strings.TrimSpace(logger.pendingLine))
			n, _ := logger.file.WriteString(formatted)
			logger.record.ByteCount += int64(n)
			logger.record.LineCount++
			logger.pendingLine = ""
		}
		logger.echoSuppressed = true
	}

	m.recordsByID[logger.record.ID] = logger.record
}

// StopSession flushes any remaining partial line and closes the log file for sessionID.
func (m *SessionLogManager) StopSession(sessionID string) (SessionLogStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	logger, ok := m.activeBySID[sessionID]
	if !ok {
		return SessionLogStatus{SessionID: sessionID, Active: false}, nil
	}

	now := logger.nowFunc().UTC()
	nowTs := now.Format("2006-01-02 15:04:05.000")
	if !logger.echoSuppressed && strings.TrimSpace(logger.pendingLine) != "" {
		line := redactSecrets(logger.pendingLine, logger.secrets)
		formatted := fmt.Sprintf("[%s] %s\n", nowTs, line)
		n, _ := logger.file.WriteString(formatted)
		logger.record.ByteCount += int64(n)
		logger.record.LineCount++
		logger.pendingLine = ""
	}

	footer := fmt.Sprintf("[%s] --- Session Log Ended ---\n", nowTs)
	n, _ := logger.file.WriteString(footer)
	logger.record.ByteCount += int64(n)
	logger.record.LineCount++

	_ = logger.file.Close()
	logger.file = nil
	logger.record.Active = false
	logger.record.EndedAt = now.Format("2006-01-02 15:04:05 UTC")

	m.recordsByID[logger.record.ID] = logger.record
	delete(m.activeBySID, sessionID)

	return SessionLogStatus{
		SessionID: sessionID,
		LogID:     logger.record.ID,
		Active:    false,
		FilePath:  logger.record.FilePath,
		ByteCount: logger.record.ByteCount,
		LineCount: logger.record.LineCount,
	}, nil
}

// GetStatus returns the current SessionLogStatus for sessionID.
func (m *SessionLogManager) GetStatus(sessionID string) SessionLogStatus {
	m.mu.Lock()
	defer m.mu.Unlock()

	if logger, ok := m.activeBySID[sessionID]; ok {
		return SessionLogStatus{
			SessionID: sessionID,
			LogID:     logger.record.ID,
			Active:    true,
			FilePath:  logger.record.FilePath,
			ByteCount: logger.record.ByteCount,
			LineCount: logger.record.LineCount,
		}
	}
	return SessionLogStatus{
		SessionID: sessionID,
		Active:    false,
	}
}

// ListRecords returns all SessionLogRecords ordered newest-first.
func (m *SessionLogManager) ListRecords() []SessionLogRecord {
	m.mu.Lock()
	defer m.mu.Unlock()

	out := make([]SessionLogRecord, 0, len(m.recordsByID))
	for _, rec := range m.recordsByID {
		out = append(out, rec)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].ID > out[j].ID
	})
	return out
}

// ReadLog returns the full text contents of a recorded session log by logID.
func (m *SessionLogManager) ReadLog(logID string) (string, error) {
	m.mu.Lock()
	rec, ok := m.recordsByID[logID]
	m.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("session log not found: %s", logID)
	}
	data, err := os.ReadFile(rec.FilePath)
	if err != nil {
		return "", fmt.Errorf("read session log: %w", err)
	}
	return string(data), nil
}

// DeleteLog stops the session log if active, removes the file from disk, and deletes the record.
func (m *SessionLogManager) DeleteLog(logID string) error {
	m.mu.Lock()
	rec, ok := m.recordsByID[logID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("session log not found: %s", logID)
	}
	if logger, active := m.activeBySID[rec.SessionID]; active && logger.record.ID == logID {
		if logger.file != nil {
			_ = logger.file.Close()
			logger.file = nil
		}
		delete(m.activeBySID, rec.SessionID)
	}
	delete(m.recordsByID, logID)
	m.mu.Unlock()

	_ = os.Remove(rec.FilePath)
	return nil
}

// ExportLog copies a recorded session log to targetPath on disk.
func (m *SessionLogManager) ExportLog(logID, targetPath string) error {
	content, err := m.ReadLog(logID)
	if err != nil {
		return err
	}
	targetPath = strings.TrimSpace(targetPath)
	if targetPath == "" {
		return fmt.Errorf("target path is required")
	}
	if dir := filepath.Dir(targetPath); dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0o755)
	}
	return os.WriteFile(targetPath, []byte(content), 0o600)
}

