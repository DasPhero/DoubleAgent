package winrm

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"doubleagent/backend/core"
)

func generateSessionID() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return "winrm-" + hex.EncodeToString(b)
}

// ManagedSession represents an active WinRM session paired with an interactive xterm.js Evil-WinRM parity REPL.
type ManagedSession struct {
	mu       sync.Mutex
	info     core.WinrmSessionInfo
	client   *Client
	lineBuf  []rune
	closed   bool
	outR     *io.PipeReader
	outW     *io.PipeWriter
	onUpdate func(core.WinrmSessionInfo)
}

// ID returns the canonical session identifier.
func (s *ManagedSession) ID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info.SessionID
}

// Info returns a snapshot of session telemetry.
func (s *ManagedSession) Info() core.WinrmSessionInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := s.info
	cp.OpsecWarnings = append([]string(nil), s.info.OpsecWarnings...)
	return cp
}

// Reader exposes the ANSI stream for App.streamReaderLoop -> terminal:data events.
func (s *ManagedSession) Reader() io.Reader {
	return s.outR
}

func (s *ManagedSession) emitANSI(text string) {
	if s.outW == nil {
		return
	}
	_, _ = io.WriteString(s.outW, strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n"))
}

func (s *ManagedSession) emitPrompt() {
	s.mu.Lock()
	dir := s.info.CurrentDir
	if dir == "" {
		dir = `C:\`
	}
	s.mu.Unlock()
	s.emitANSI(fmt.Sprintf("\r\n\x1b[36m*Evil-WinRM*\x1b[0m \x1b[33mPS %s>\x1b[0m ", dir))
}

func (s *ManagedSession) emitBanner() {
	info := s.Info()
	proto := "HTTP"
	if info.UseTLS {
		proto = "HTTPS (TLS)"
	}
	s.emitANSI(fmt.Sprintf(
		"\x1b[1;36mDoubleAgent WinRM // Evil-WinRM Parity Shell (F-41)\x1b[0m\n"+
			"Target:   %s:%d (%s) | Auth: %s | User: %s\n"+
			"ShellId:  %s\n"+
			"Type \x1b[33mmenu\x1b[0m or \x1b[33mhelp\x1b[0m for built-in commands (upload, download, services, netuser, sysinfo, Bypass-4MSI).\n",
		info.Host, info.Port, proto, strings.ToUpper(info.AuthType), info.Username, info.ShellID,
	))
	for _, w := range info.OpsecWarnings {
		s.emitANSI(fmt.Sprintf("\x1b[33m[OPSEC]\x1b[0m %s\n", w))
	}
	s.emitPrompt()
}

// Write processes keystrokes typed into xterm.js cleanly (echo + line editing + REPL dispatch).
func (s *ManagedSession) Write(p []byte) (int, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return 0, io.ErrClosedPipe
	}
	s.mu.Unlock()

	var toExecute []string
	var echoBuf strings.Builder

	s.mu.Lock()
	for _, r := range string(p) {
		switch r {
		case '\x03': // Ctrl+C
			s.lineBuf = nil
			echoBuf.WriteString("^C")
			s.mu.Unlock()
			s.emitANSI(echoBuf.String())
			echoBuf.Reset()
			s.emitPrompt()
			s.mu.Lock()
		case '\x0c': // Ctrl+L
			s.lineBuf = nil
			s.mu.Unlock()
			s.emitANSI("\x1b[2J\x1b[H")
			s.emitPrompt()
			s.mu.Lock()
		case '\x7f', '\x08': // Backspace
			if len(s.lineBuf) > 0 {
				s.lineBuf = s.lineBuf[:len(s.lineBuf)-1]
				echoBuf.WriteString("\b \b")
			}
		case '\r', '\n':
			line := strings.TrimSpace(string(s.lineBuf))
			s.lineBuf = nil
			echoBuf.WriteString("\r\n")
			if line != "" {
				toExecute = append(toExecute, line)
			} else {
				s.mu.Unlock()
				s.emitANSI(echoBuf.String())
				echoBuf.Reset()
				s.emitPrompt()
				s.mu.Lock()
			}
		default:
			if r >= 0x20 {
				s.lineBuf = append(s.lineBuf, r)
				echoBuf.WriteRune(r)
			}
		}
	}
	s.mu.Unlock()

	if echoBuf.Len() > 0 {
		_, _ = io.WriteString(s.outW, echoBuf.String())
	}

	for _, cmd := range toExecute {
		go s.dispatchReplCommand(cmd)
	}
	return len(p), nil
}

func (s *ManagedSession) dispatchReplCommand(rawLine string) {
	fields := splitShellWords(rawLine)
	if len(fields) == 0 {
		s.emitPrompt()
		return
	}
	verb := strings.ToLower(fields[0])

	switch verb {
	case "exit", "quit":
		s.emitANSI("\x1b[33mClosing WinRM session...\x1b[0m\n")
		_ = s.Close()
		return
	case "clear", "cls":
		s.emitANSI("\x1b[2J\x1b[H")
		s.emitPrompt()
		return
	case "help", "menu":
		s.emitANSI(
			"\x1b[1;36mEvil-WinRM Parity Commands:\x1b[0m\n" +
				"  \x1b[33mupload <local> [remote]\x1b[0m   Upload file chunked via PowerShell Base64 + SHA-256 verify\n" +
				"  \x1b[33mdownload <remote> [local]\x1b[0m Download remote file locally with SHA-256 checksum\n" +
				"  \x1b[33mservices\x1b[0m                  Enumerate services and binary paths\n" +
				"  \x1b[33mnetuser\x1b[0m                   List local users and Administrators group\n" +
				"  \x1b[33msysinfo\x1b[0m                   OS build, hostname, IPv4 addresses & whoami /priv\n" +
				"  \x1b[33mBypass-4MSI\x1b[0m               Inspect/prepare standard runtime AMSI reflection helper\n" +
				"  \x1b[33mcd <path>\x1b[0m                 Change persistent remote PowerShell working directory\n" +
				"  \x1b[33mclear / exit\x1b[0m              Clear terminal screen or close WS-Man shell\n" +
				"  \x1b[90m(Any other line executes directly inside remote powershell.exe in CurrentDir)\x1b[0m\n",
		)
		s.emitPrompt()
		return
	case "upload":
		if len(fields) < 2 {
			s.emitANSI("\x1b[31mUsage: upload <localPath> [remotePath]\x1b[0m\n")
			s.emitPrompt()
			return
		}
		localPath := fields[1]
		remotePath := ""
		if len(fields) >= 3 {
			remotePath = fields[2]
		} else if cur := s.Info().CurrentDir; cur != "" {
			remotePath = strings.TrimRight(cur, `\`) + `\` + baseName(localPath)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		s.emitANSI(fmt.Sprintf("\x1b[36m[*] Uploading %s -> %s...\x1b[0m\n", localPath, remotePath))
		res, err := s.Upload(ctx, localPath, remotePath)
		if err != nil {
			s.emitANSI(fmt.Sprintf("\x1b[31m[!] Upload failed: %v\x1b[0m\n", err))
		} else {
			s.emitANSI(fmt.Sprintf("\x1b[32m[+] Uploaded %d bytes to %s (SHA-256: %s)\x1b[0m\n", res.Bytes, res.RemotePath, res.SHA256))
		}
		s.emitPrompt()
		return
	case "download":
		if len(fields) < 2 {
			s.emitANSI("\x1b[31mUsage: download <remotePath> [localPath]\x1b[0m\n")
			s.emitPrompt()
			return
		}
		remotePath := fields[1]
		localPath := ""
		if len(fields) >= 3 {
			localPath = fields[2]
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		s.emitANSI(fmt.Sprintf("\x1b[36m[*] Downloading %s...\x1b[0m\n", remotePath))
		res, err := s.Download(ctx, remotePath, localPath)
		if err != nil {
			s.emitANSI(fmt.Sprintf("\x1b[31m[!] Download failed: %v\x1b[0m\n", err))
		} else {
			s.emitANSI(fmt.Sprintf("\x1b[32m[+] Downloaded %d bytes -> %s (SHA-256: %s)\x1b[0m\n", res.Bytes, res.LocalPath, res.SHA256))
		}
		s.emitPrompt()
		return
	}

	psScript := rawLine
	switch verb {
	case "services":
		psScript = `Get-CimInstance Win32_Service | Select-Object Name,State,StartMode,PathName | Format-Table -AutoSize`
	case "netuser":
		psScript = `Get-LocalUser | Select-Object Name,Enabled,LastLogon | Format-Table -AutoSize; net localgroup administrators`
	case "sysinfo":
		psScript = `hostname; (Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture | Out-String); whoami /priv`
	case "bypass-4msi":
		psScript = `[Ref].Assembly.GetType('System.Management.Automation.'+$([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('QW1zaVV0aWxz')))) | Select-Object Name,Assembly`
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	res, err := s.Execute(ctx, psScript)
	if err != nil {
		s.emitANSI(fmt.Sprintf("\x1b[31m[!] Error: %v\x1b[0m\n", err))
		s.emitPrompt()
		return
	}
	if res.Stdout != "" {
		s.emitANSI(res.Stdout + "\n")
	}
	if res.Stderr != "" {
		s.emitANSI(fmt.Sprintf("\x1b[31m%s\x1b[0m\n", res.Stderr))
	}
	s.emitPrompt()
}

// Execute runs a PowerShell command in this session, maintaining CurrentDir across calls.
func (s *ManagedSession) Execute(ctx context.Context, script string) (*core.WinrmExecResult, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, errors.New("WinRM session is closed")
	}
	curDir := s.info.CurrentDir
	shellID := s.info.ShellID
	client := s.client
	s.mu.Unlock()

	const marker = "__DA_PWD__="
	prefix := ""
	if curDir != "" {
		escapedDir := strings.ReplaceAll(curDir, "'", "''")
		prefix = fmt.Sprintf("Set-Location -LiteralPath '%s' -ErrorAction SilentlyContinue; ", escapedDir)
	}
	wrapped := fmt.Sprintf("%s%s; Write-Output ('%s' + (Get-Location).Path)", prefix, script, marker)

	res, err := client.ExecutePowerShell(ctx, shellID, wrapped)
	if err != nil {
		return nil, err
	}

	lines := strings.Split(res.Stdout, "\n")
	filtered := make([]string, 0, len(lines))
	newPwd := curDir
	for _, ln := range lines {
		clean := strings.TrimRight(ln, "\r")
		if strings.HasPrefix(clean, marker) {
			candidate := strings.TrimSpace(strings.TrimPrefix(clean, marker))
			if candidate != "" {
				newPwd = candidate
			}
			continue
		}
		filtered = append(filtered, ln)
	}
	res.Stdout = strings.TrimRight(strings.Join(filtered, "\n"), "\r\n")
	res.Command = script
	res.SessionID = s.ID()

	s.mu.Lock()
	s.info.CommandCount++
	if newPwd != "" {
		s.info.CurrentDir = newPwd
	}
	snap := s.info
	cb := s.onUpdate
	s.mu.Unlock()

	if cb != nil {
		cb(snap)
	}
	return res, nil
}

// Upload sends localPath to remotePath through this WinRM session.
func (s *ManagedSession) Upload(ctx context.Context, localPath, remotePath string) (*core.WinrmTransferResult, error) {
	info := s.Info()
	if info.Status != "connected" {
		return nil, errors.New("WinRM session is not connected")
	}
	res, err := s.client.UploadFile(ctx, info.ShellID, localPath, remotePath)
	if res != nil {
		res.SessionID = info.SessionID
	}
	return res, err
}

// Download fetches remotePath to localPath through this WinRM session.
func (s *ManagedSession) Download(ctx context.Context, remotePath, localPath string) (*core.WinrmTransferResult, error) {
	info := s.Info()
	if info.Status != "connected" {
		return nil, errors.New("WinRM session is not connected")
	}
	res, err := s.client.DownloadFile(ctx, info.ShellID, remotePath, localPath)
	if res != nil {
		res.SessionID = info.SessionID
	}
	return res, err
}

// Close tears down the remote WS-Man shell and terminates the terminal pipe.
func (s *ManagedSession) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.info.Status = "closed"
	shellID := s.info.ShellID
	client := s.client
	cb := s.onUpdate
	snap := s.info
	s.mu.Unlock()

	if client != nil && shellID != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		_ = client.CloseShell(ctx, shellID)
		cancel()
		client.CloseIdle()
	}
	if s.outW != nil {
		_ = s.outW.Close()
	}
	if cb != nil {
		cb(snap)
	}
	return nil
}

// Manager supervises active WinRM sessions in Go memory (F-41).
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*ManagedSession
	onUpdate func(core.WinrmSessionInfo)
}

// NewManager creates a WinRM session supervisor.
func NewManager(onUpdate func(core.WinrmSessionInfo)) *Manager {
	return &Manager{
		sessions: make(map[string]*ManagedSession),
		onUpdate: onUpdate,
	}
}

// Open dials target via WS-Man, opens a remote cmd shell, probes initial directory, and attaches an xterm REPL.
func (m *Manager) Open(ctx context.Context, prof core.WinrmProfile, clientCfg ClientConfig) (*ManagedSession, error) {
	prof = core.NormalizeWinrmProfile(prof)
	if err := core.ValidateWinrmProfile(prof); err != nil {
		return nil, err
	}

	if strings.TrimSpace(clientCfg.Host) == "" {
		clientCfg.Host = prof.Host
	}
	if clientCfg.Port == 0 {
		clientCfg.Port = prof.Port
		clientCfg.UseTLS = prof.UseTLS
		clientCfg.InsecureSkipVerify = prof.InsecureSkipVerify
	}
	if strings.TrimSpace(clientCfg.AuthType) == "" {
		clientCfg.AuthType = prof.AuthType
	}
	if strings.TrimSpace(clientCfg.Domain) == "" {
		clientCfg.Domain = prof.Domain
	}
	if strings.TrimSpace(clientCfg.Username) == "" {
		clientCfg.Username = prof.Username
	}
	if clientCfg.Password == "" {
		clientCfg.Password = prof.Password
	}
	if len(clientCfg.NtHash) == 0 && strings.TrimSpace(prof.NtHash) != "" {
		rawHash, err := core.ParseNtHashHex(prof.NtHash)
		if err != nil {
			return nil, err
		}
		clientCfg.NtHash = rawHash
	}
	if strings.TrimSpace(clientCfg.SocksProxyAddr) == "" {
		clientCfg.SocksProxyAddr = prof.SocksProxyAddr
	}
	if clientCfg.Timeout <= 0 && prof.TimeoutSec > 0 {
		clientCfg.Timeout = time.Duration(prof.TimeoutSec) * time.Second
	}

	client, err := NewClient(clientCfg)
	if err != nil {
		return nil, err
	}

	shellID, err := client.OpenShell(ctx)
	if err != nil {
		client.CloseIdle()
		return nil, err
	}

	outR, outW := io.Pipe()
	sid := generateSessionID()
	sess := &ManagedSession{
		client: client,
		outR:   outR,
		outW:   outW,
		onUpdate: m.onUpdate,
		info: core.WinrmSessionInfo{
			SessionID:     sid,
			ProfileID:     prof.ID,
			HostID:        prof.HostID,
			Name:          prof.Name,
			Host:          prof.Host,
			Port:          prof.Port,
			UseTLS:        prof.UseTLS,
			AuthType:      prof.AuthType,
			Domain:        prof.Domain,
			Username:      prof.Username,
			ShellID:       shellID,
			CurrentDir:    `C:\`,
			Status:        "connected",
			BackendMode:   "native-wsman",
			SocksProxy:    prof.SocksProxyAddr,
			OpsecWarnings: core.AnalyzeWinrmOpsec(prof),
			ConnectedAt:   time.Now().UTC().Format(time.RFC3339),
		},
	}

	// Best-effort initial PWD query; keeps startup resilient on minimal mock servers.
	if res, pwdErr := client.ExecutePowerShell(ctx, shellID, `(Get-Location).Path`); pwdErr == nil && res != nil {
		if trimmed := strings.TrimSpace(res.Stdout); trimmed != "" {
			sess.mu.Lock()
			sess.info.CurrentDir = trimmed
			sess.mu.Unlock()
		}
	}

	m.mu.Lock()
	m.sessions[sid] = sess
	m.mu.Unlock()

	if m.onUpdate != nil {
		m.onUpdate(sess.Info())
	}
	go sess.emitBanner()
	return sess, nil
}

// Get retrieves an active WinRM session by ID.
func (m *Manager) Get(sessionID string) (*ManagedSession, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[sessionID]
	return s, ok
}

// List returns telemetry snapshots for all tracked WinRM sessions.
func (m *Manager) List() []core.WinrmSessionInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]core.WinrmSessionInfo, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s.Info())
	}
	return out
}

// Close closes and removes a WinRM session.
func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	if !ok || sess == nil {
		return nil
	}
	return sess.Close()
}

// CloseAll cleanly tears down every open WinRM shell on shutdown.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	all := make([]*ManagedSession, 0, len(m.sessions))
	for id, s := range m.sessions {
		all = append(all, s)
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	for _, s := range all {
		_ = s.Close()
	}
}

func baseName(p string) string {
	norm := strings.ReplaceAll(p, `\`, "/")
	if idx := strings.LastIndex(norm, "/"); idx >= 0 {
		return norm[idx+1:]
	}
	return norm
}

func splitShellWords(line string) []string {
	var args []string
	var cur strings.Builder
	var quote rune
	for _, r := range line {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
		case r == ' ' || r == '\t':
			if cur.Len() > 0 {
				args = append(args, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		args = append(args, cur.String())
	}
	return args
}
