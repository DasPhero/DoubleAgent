package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"doubleagent/backend/core"
	"doubleagent/backend/pty"
	"doubleagent/backend/serial"
	"doubleagent/backend/ssh"
	"doubleagent/backend/vault"
)

// EventEmitter abstracts Wails runtime event emission so App can be unit-tested without a live WebView.
type EventEmitter func(ctx context.Context, eventName string, optionalData ...interface{})

// App struct represents the minimal Go surface bound to the frontend WebView.
// Only methods on App that are exported are callable by the frontend.
type App struct {
	ctx        context.Context
	transport  core.SshTransport
	knownHosts *ssh.KnownHostsStore
	vaultStore core.SecretStore
	emit       EventEmitter

	mu               sync.Mutex
	activeStreams    map[string]*core.SshShellStreams
	localSessions    map[string]pty.Session
	serialSessions   map[string]serial.Port
	sessionHostID    map[string]string
	sessionPasswords map[string]string
	sessionRequests  map[string]core.ConnectRequest
	pendingKeys      map[string]chan bool
}

func defaultVaultPath() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil || cfgDir == "" {
		return "doubleagent.vault"
	}
	return filepath.Join(cfgDir, "DoubleAgent", "doubleagent.vault")
}

// NewApp creates a new App application struct with the default SSH transport and encrypted Vault store.
func NewApp() *App {
	kh := ssh.NewKnownHostsStore()
	return NewAppWithDependencies(ssh.NewTransport(kh), kh, nil, runtime.EventsEmit)
}

// NewAppWithTransport creates an App with an injected SshTransport and EventEmitter for testing.
func NewAppWithTransport(transport core.SshTransport, kh *ssh.KnownHostsStore, emit EventEmitter) *App {
	return NewAppWithDependencies(transport, kh, nil, emit)
}

// NewAppWithDependencies creates an App with injected SshTransport, KnownHostsStore, SecretStore, and EventEmitter.
func NewAppWithDependencies(
	transport core.SshTransport,
	kh *ssh.KnownHostsStore,
	vaultStore core.SecretStore,
	emit EventEmitter,
) *App {
	if kh == nil {
		kh = ssh.NewKnownHostsStore()
	}
	if transport == nil {
		transport = ssh.NewTransport(kh)
	}
	if emit == nil {
		emit = func(_ context.Context, _ string, _ ...interface{}) {}
	}

	app := &App{
		ctx:              context.Background(),
		transport:        transport,
		knownHosts:       kh,
		emit:             emit,
		activeStreams:    make(map[string]*core.SshShellStreams),
		localSessions:    make(map[string]pty.Session),
		serialSessions:   make(map[string]serial.Port),
		sessionHostID:    make(map[string]string),
		sessionPasswords: make(map[string]string),
		sessionRequests:  make(map[string]core.ConnectRequest),
		pendingKeys:      make(map[string]chan bool),
	}

	if vaultStore == nil {
		vaultStore = vault.NewStore(vault.StoreOptions{
			FilePath:        defaultVaultPath(),
			MaxBackups:      3,
			AutoLockTimeout: 15 * time.Minute,
			OnAutoLock: func() {
				app.emit(app.ctx, "vault:locked", true)
			},
		})
	}
	app.vaultStore = vaultStore
	return app
}

// startup is called when the Wails application starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Start the app unlocked for now (auto-initialize or auto-unlock in passwordless mode)
	if !a.vaultStore.IsInitialized() {
		_ = a.vaultStore.Initialize(ctx, "")
	} else if a.vaultStore.IsLocked() && a.vaultStore.IsPasswordless() {
		_ = a.vaultStore.Unlock(ctx, "")
	}
}

// HealthCheck returns the current status of DoubleAgent, including Vault initialization and Quick Unlock state.
func (a *App) HealthCheck() core.AppStatus {
	return core.AppStatus{
		Name:             "DoubleAgent",
		Version:          "0.1.0",
		Milestone:        "M1-1",
		VaultLock:        a.vaultStore.IsLocked(),
		VaultInitialized: a.vaultStore.IsInitialized(),
		Passwordless:     a.vaultStore.IsPasswordless(),
		QuickUnlockReady: a.vaultStore.HasQuickUnlock(),
	}
}

// InitializeVault creates a new encrypted vault with the given masterPassword (or empty string for passwordless mode) (F-03).
func (a *App) InitializeVault(masterPassword string) error {
	if err := a.vaultStore.Initialize(a.ctx, masterPassword); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:locked", false)
	return nil
}

// InitializeVaultWithHello creates a new encrypted vault using Windows Hello / FIDO2 security key verification
// and stores the random 256-bit key protected by Windows DPAPI (F-03).
func (a *App) InitializeVaultWithHello() error {
	if err := a.vaultStore.InitializeWithHello(a.ctx); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:locked", false)
	return nil
}

// UnlockVault unlocks (or initializes on first run) the encrypted vault with the master password (F-03).
func (a *App) UnlockVault(masterPassword string) error {
	if err := a.vaultStore.Unlock(a.ctx, masterPassword); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:locked", false)
	return nil
}

// ChangeVaultPassword changes (or sets for the first time on a passwordless vault) the master password (F-03).
func (a *App) ChangeVaultPassword(currentPassword, newPassword string) error {
	return a.vaultStore.ChangePassword(a.ctx, currentPassword, newPassword)
}

// EnableQuickUnlock arms Windows Hello / FIDO2 security key convenience unlock for the current session (F-03).
func (a *App) EnableQuickUnlock() error {
	return a.vaultStore.EnableQuickUnlock()
}

// UnlockVaultWithHello triggers Windows Hello / FIDO2 verification and unwraps the session master key (F-03).
func (a *App) UnlockVaultWithHello() error {
	if err := a.vaultStore.UnlockWithQuickUnlock(a.ctx); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:locked", false)
	return nil
}

// ResetVault archives the existing vault file and resets to an uninitialized state if the password was forgotten (F-03).
func (a *App) ResetVault() error {
	if err := a.vaultStore.ResetVault(); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:locked", true)
	return nil
}

// LockVault immediately wipes the master key from memory and locks the vault (F-03).
func (a *App) LockVault() error {
	if err := a.vaultStore.Lock(); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:locked", true)
	return nil
}

// GetVaultSummary returns non-secret groups, hosts (with inherited values resolved), and identities (F-01, Golden Rule 2).
func (a *App) GetVaultSummary() (core.VaultSummary, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.VaultSummary{}, err
	}
	return core.BuildVaultSummary(payload), nil
}

// SearchCommandPalette performs fuzzy search across saved hosts (Name, Address, Tags, Group)
// and parses ad-hoc quick-connect targets like "user@host:port" (F-02).
func (a *App) SearchCommandPalette(query string) (core.CommandPaletteResponse, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.CommandPaletteResponse{}, err
	}
	summary := core.BuildVaultSummary(payload)
	results := core.SearchHostsFuzzy(summary.Hosts, query)

	resp := core.CommandPaletteResponse{
		Query:       query,
		HostResults: results,
	}
	if qc, ok := core.ParseQuickConnectTarget(query); ok {
		resp.QuickConnect = &qc
	}
	return resp, nil
}

// SaveGroup creates or updates a host group in the encrypted vault (F-01).
func (a *App) SaveGroup(group core.GroupRecord) error {
	if group.ID == "" || group.Name == "" {
		return errors.New("group id and name are required")
	}
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	updated := false
	for i := range payload.Groups {
		if payload.Groups[i].ID == group.ID {
			payload.Groups[i] = group
			updated = true
			break
		}
	}
	if !updated {
		payload.Groups = append(payload.Groups, group)
	}
	return a.vaultStore.SavePayload(a.ctx, payload)
}

// DeleteGroup removes a group from the vault and unassigns any hosts that referenced it (F-01).
func (a *App) DeleteGroup(groupID string) error {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	filtered := make([]core.GroupRecord, 0, len(payload.Groups))
	for _, g := range payload.Groups {
		if g.ID != groupID {
			filtered = append(filtered, g)
		}
	}
	payload.Groups = filtered
	for i := range payload.Hosts {
		if payload.Hosts[i].GroupID == groupID {
			payload.Hosts[i].GroupID = ""
		}
	}
	return a.vaultStore.SavePayload(a.ctx, payload)
}

// SaveIdentity creates or updates a reusable identity credential in the encrypted vault (F-01).
func (a *App) SaveIdentity(identity core.IdentityRecord) error {
	if identity.ID == "" || identity.Label == "" || identity.Username == "" {
		return errors.New("identity id, label, and username are required")
	}
	if identity.AuthMethod == "" {
		identity.AuthMethod = core.AuthPassword
	}
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	updated := false
	for i := range payload.Identities {
		if payload.Identities[i].ID == identity.ID {
			// Preserve existing password if user edits label/username without re-entering password
			if identity.Password == "" {
				identity.Password = payload.Identities[i].Password
			}
			payload.Identities[i] = identity
			updated = true
			break
		}
	}
	if !updated {
		payload.Identities = append(payload.Identities, identity)
	}
	return a.vaultStore.SavePayload(a.ctx, payload)
}

// SaveHost creates or updates a host in the encrypted vault (F-01).
func (a *App) SaveHost(host core.HostRecord) error {
	if host.ID == "" || host.Label == "" || host.Address == "" {
		return errors.New("host id, label, and address are required")
	}
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	updated := false
	for i := range payload.Hosts {
		if payload.Hosts[i].ID == host.ID {
			payload.Hosts[i] = host
			updated = true
			break
		}
	}
	if !updated {
		payload.Hosts = append(payload.Hosts, host)
	}
	return a.vaultStore.SavePayload(a.ctx, payload)
}

// DeleteHost removes a host from the encrypted vault (F-01).
func (a *App) DeleteHost(hostID string) error {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	filtered := make([]core.HostRecord, 0, len(payload.Hosts))
	for _, h := range payload.Hosts {
		if h.ID != hostID {
			filtered = append(filtered, h)
		}
	}
	payload.Hosts = filtered
	return a.vaultStore.SavePayload(a.ctx, payload)
}

// GenerateSSHKey generates an Ed25519 or RSA-3072 SSH keypair inside the Go process, saves the encrypted private key
// inside the Vault, and returns the non-secret SshKeySummary (F-04, Golden Rule 2).
func (a *App) GenerateSSHKey(label, keyType, passphrase string) (core.SshKeySummary, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.SshKeySummary{}, err
	}
	rec, err := ssh.GenerateKeyPair(label, keyType, passphrase)
	if err != nil {
		return core.SshKeySummary{}, err
	}
	payload.Keys = append(payload.Keys, rec)
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return core.SshKeySummary{}, err
	}
	return core.SshKeySummary{
		ID:          rec.ID,
		Label:       rec.Label,
		Type:        rec.Type,
		PublicKey:   rec.PublicKey,
		Fingerprint: rec.Fingerprint,
	}, nil
}

// ImportSSHKey imports an OpenSSH PEM or PuTTY .ppk (v2/v3) private key into the encrypted Vault
// and returns the non-secret SshKeySummary (F-04, Golden Rule 2).
func (a *App) ImportSSHKey(label, rawPrivateKey, passphrase string) (core.SshKeySummary, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.SshKeySummary{}, err
	}
	rec, err := ssh.ImportPrivateKey(label, rawPrivateKey, passphrase)
	if err != nil {
		return core.SshKeySummary{}, err
	}
	payload.Keys = append(payload.Keys, rec)
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return core.SshKeySummary{}, err
	}
	return core.SshKeySummary{
		ID:          rec.ID,
		Label:       rec.Label,
		Type:        rec.Type,
		PublicKey:   rec.PublicKey,
		Fingerprint: rec.Fingerprint,
	}, nil
}

// DeleteSSHKey removes a key from the encrypted Vault (F-04).
func (a *App) DeleteSSHKey(keyID string) error {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	filtered := make([]core.SshKeyRecord, 0, len(payload.Keys))
	for _, k := range payload.Keys {
		if k.ID != keyID {
			filtered = append(filtered, k)
		}
	}
	payload.Keys = filtered
	return a.vaultStore.SavePayload(a.ctx, payload)
}

// ImportSSHConfig parses an OpenSSH config file (Host, HostName, User, Port, IdentityFile, ProxyJump),
// saves the imported hosts and identities into the encrypted Vault, and returns warnings for any unknown directives (F-22).
func (a *App) ImportSSHConfig(configContent string) (core.SSHConfigParseResult, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.SSHConfigParseResult{}, err
	}
	parsed := core.ParseSSHConfig(configContent)
	nowNano := time.Now().UTC().UnixNano()

	for idx, entry := range parsed.Entries {
		idSuffix := fmt.Sprintf("%d-%d", nowNano, idx)
		user := entry.User
		if user == "" {
			user = "root"
		}
		identityID := fmt.Sprintf("id-sshcfg-%s", idSuffix)
		authMethod := core.AuthAgent
		var keyID string

		// If IdentityFile is specified and readable on disk, import it into the Vault automatically
		if entry.IdentityFile != "" {
			expandedPath := entry.IdentityFile
			if len(expandedPath) >= 2 && expandedPath[:2] == "~/" {
				if home, err := os.UserHomeDir(); err == nil {
					expandedPath = filepath.Join(home, expandedPath[2:])
				}
			}
			if rawKeyBytes, err := os.ReadFile(expandedPath); err == nil {
				if keyRec, err := ssh.ImportPrivateKey(entry.HostAlias+" Key", string(rawKeyBytes), ""); err == nil {
					payload.Keys = append(payload.Keys, keyRec)
					keyID = keyRec.ID
					authMethod = core.AuthPrivateKey
				}
			}
		}

		payload.Identities = append(payload.Identities, core.IdentityRecord{
			ID:         identityID,
			Label:      entry.HostAlias + " Identity",
			Username:   user,
			AuthMethod: authMethod,
			KeyID:      keyID,
		})

		payload.Hosts = append(payload.Hosts, core.HostRecord{
			ID:         fmt.Sprintf("host-sshcfg-%s", idSuffix),
			Label:      entry.HostAlias,
			Address:    entry.HostName,
			Port:       entry.Port,
			IdentityID: identityID,
			Tags:       []string{"ssh_config"},
			JumpChain:  entry.ProxyJump,
		})
	}

	if len(parsed.Entries) > 0 {
		if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
			return core.SSHConfigParseResult{}, err
		}
	}
	return parsed, nil
}

// ConnectSavedHost resolves a saved host's effective address, port, username, and secret identity inside Go
// (applying group inheritance per F-01) and starts an interactive SSH PTY session.
func (a *App) ConnectSavedHost(hostID string, size core.TerminalSize) (string, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return "", err
	}
	resolved, err := core.ResolveEffectiveHost(hostID, payload)
	if err != nil {
		return "", err
	}

	sessionID, err := a.transport.Connect(a.ctx, core.SshSessionConfig{
		HostID:   resolved.HostID,
		Address:  resolved.Address,
		Port:     resolved.Port,
		Username: resolved.Username,
		Auth:     resolved.Auth,
		OnFirstSeenKey: func(info core.HostKeyInfo) (bool, error) {
			return a.promptHostKeyTOFU(info)
		},
	})
	if err != nil {
		return "", err
	}

	if size.Cols == 0 {
		size.Cols = 80
	}
	if size.Rows == 0 {
		size.Rows = 24
	}

	streams, err := a.transport.OpenShell(a.ctx, sessionID, size)
	if err != nil {
		_ = a.transport.Disconnect(a.ctx, sessionID)
		return "", err
	}

	a.mu.Lock()
	a.activeStreams[sessionID] = streams
	a.sessionHostID[sessionID] = hostID
	if resolved.Auth.Password != "" {
		a.sessionPasswords[sessionID] = resolved.Auth.Password
	}
	a.mu.Unlock()

	go a.streamReaderLoop(sessionID, streams.Stdout, true)
	go a.streamReaderLoop(sessionID, streams.Stderr, false)

	return sessionID, nil
}

func hostPromptKey(host string, port uint16) string {
	return fmt.Sprintf("[%s]:%d", host, port)
}

// ConnectSSH opens an SSH connection, verifies the host key (prompting the user on first-seen TOFU),
// starts an interactive PTY shell, and streams sanitized output events to the frontend (F-01, F-05, F-06, F-07).
func (a *App) ConnectSSH(req core.ConnectRequest) (string, error) {
	a.vaultStore.Touch()

	port := req.Port
	if port == 0 {
		port = 22
	}

	var authCfg core.SshAuthConfig
	if req.UseAgent {
		authCfg = core.SshAuthConfig{
			Method: core.AuthAgent,
		}
	} else if req.PrivateKey != "" {
		authCfg = core.SshAuthConfig{
			Method:     core.AuthPrivateKey,
			PrivateKey: []byte(req.PrivateKey),
			Passphrase: req.Passphrase,
		}
	} else {
		authCfg = core.SshAuthConfig{
			Method:   core.AuthPassword,
			Password: req.Password,
		}
	}

	sessionID, err := a.transport.Connect(a.ctx, core.SshSessionConfig{
		Address:  req.Address,
		Port:     port,
		Username: req.Username,
		Auth:     authCfg,
		OnFirstSeenKey: func(info core.HostKeyInfo) (bool, error) {
			return a.promptHostKeyTOFU(info)
		},
	})
	if err != nil {
		return "", err
	}

	size := req.Size
	if size.Cols == 0 {
		size.Cols = 80
	}
	if size.Rows == 0 {
		size.Rows = 24
	}

	streams, err := a.transport.OpenShell(a.ctx, sessionID, size)
	if err != nil {
		_ = a.transport.Disconnect(a.ctx, sessionID)
		return "", err
	}

	a.mu.Lock()
	a.activeStreams[sessionID] = streams
	a.sessionRequests[sessionID] = req
	if req.Password != "" {
		a.sessionPasswords[sessionID] = req.Password
	}
	a.mu.Unlock()

	go a.streamReaderLoop(sessionID, streams.Stdout, true)
	go a.streamReaderLoop(sessionID, streams.Stderr, false)

	return sessionID, nil
}

// DuplicateSession opens a parallel SSH, local shell, or fails for serial (used when splitting a pane horizontally or vertically per F-08).
func (a *App) DuplicateSession(sessionID string, size core.TerminalSize) (string, error) {
	a.mu.Lock()
	locSess, isLocal := a.localSessions[sessionID]
	_, isSerial := a.serialSessions[sessionID]
	hostID := a.sessionHostID[sessionID]
	req, hasReq := a.sessionRequests[sessionID]
	a.mu.Unlock()

	if isLocal && locSess != nil {
		return a.OpenLocalTerminal(locSess.ShellType(), size)
	}
	if isSerial {
		return "", errors.New("cannot duplicate serial connection; port is already open")
	}
	if hostID != "" {
		return a.ConnectSavedHost(hostID, size)
	}
	if hasReq {
		req.Size = size
		return a.ConnectSSH(req)
	}
	return "", core.ErrSessionNotFound
}

func (a *App) promptHostKeyTOFU(info core.HostKeyInfo) (bool, error) {
	keyID := hostPromptKey(info.HostPattern, info.Port)
	decisionCh := make(chan bool, 1)

	a.mu.Lock()
	a.pendingKeys[keyID] = decisionCh
	a.mu.Unlock()

	defer func() {
		a.mu.Lock()
		delete(a.pendingKeys, keyID)
		a.mu.Unlock()
	}()

	a.emit(a.ctx, "ssh:hostkey-prompt", info)

	select {
	case trust := <-decisionCh:
		return trust, nil
	case <-time.After(60 * time.Second):
		return false, errors.New("host key verification timed out")
	case <-a.ctx.Done():
		return false, a.ctx.Err()
	}
}

// ResolveHostKeyPrompt records the user's decision (trust or reject) for a first-seen host key (F-06).
func (a *App) ResolveHostKeyPrompt(host string, port uint16, trust bool) error {
	keyID := hostPromptKey(host, port)
	a.mu.Lock()
	ch, ok := a.pendingKeys[keyID]
	a.mu.Unlock()
	if !ok {
		return errors.New("no pending host key verification for host")
	}
	select {
	case ch <- trust:
	default:
	}
	return nil
}

// OpenLocalTerminal starts a local pseudo-terminal shell (PowerShell, CMD, WSL) per F-23.
func (a *App) OpenLocalTerminal(shellType string, size core.TerminalSize) (string, error) {
	sess, err := pty.StartShell(a.ctx, shellType, size)
	if err != nil {
		return "", err
	}

	sessionID := sess.ID()
	a.mu.Lock()
	a.localSessions[sessionID] = sess
	a.mu.Unlock()

	go a.streamReaderLoop(sessionID, sess.Stdout(), true)
	return sessionID, nil
}

// ListSerialPorts returns detected hardware and virtual serial/COM ports.
func (a *App) ListSerialPorts() ([]core.SerialPortInfo, error) {
	return serial.ListPorts()
}

// AutoDetectSerial probes candidate baud rates and detected ports to automatically determine connection settings.
func (a *App) AutoDetectSerial(port string) (core.SerialAutoDetectResult, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return serial.AutoDetect(ctx, port)
}

// ConnectSerial opens an interactive serial/UART/RS-232/USB-CDC port console.
func (a *App) ConnectSerial(cfg core.SerialConfig) (string, error) {
	port, err := serial.Open(a.ctx, cfg)
	if err != nil {
		return "", err
	}

	sessionID := port.ID()
	a.mu.Lock()
	a.serialSessions[sessionID] = port
	a.mu.Unlock()

	go a.streamReaderLoop(sessionID, port, true)
	return sessionID, nil
}

// SetSerialDTR controls the Data Terminal Ready pin state.
func (a *App) SetSerialDTR(sessionID string, state bool) error {
	a.mu.Lock()
	port, ok := a.serialSessions[sessionID]
	a.mu.Unlock()
	if !ok || port == nil {
		return core.ErrSessionNotFound
	}
	return port.SetDTR(state)
}

// SetSerialRTS controls the Request To Send pin state.
func (a *App) SetSerialRTS(sessionID string, state bool) error {
	a.mu.Lock()
	port, ok := a.serialSessions[sessionID]
	a.mu.Unlock()
	if !ok || port == nil {
		return core.ErrSessionNotFound
	}
	return port.SetRTS(state)
}

// SendSerialBreak sends a hardware line break on the serial port.
func (a *App) SendSerialBreak(sessionID string) error {
	a.mu.Lock()
	port, ok := a.serialSessions[sessionID]
	a.mu.Unlock()
	if !ok || port == nil {
		return core.ErrSessionNotFound
	}
	return port.SendBreak()
}

// WriteTerminal writes user keystrokes from xterm.js into the active SSH, local shell, or serial port stdin (F-07, F-23).
func (a *App) WriteTerminal(sessionID string, data string) error {
	a.vaultStore.Touch()
	a.mu.Lock()
	locSess, isLocal := a.localSessions[sessionID]
	serPort, isSerial := a.serialSessions[sessionID]
	streams, isSSH := a.activeStreams[sessionID]
	a.mu.Unlock()

	if isLocal && locSess != nil {
		_, err := io.WriteString(locSess.Stdin(), data)
		return err
	}
	if isSerial && serPort != nil {
		_, err := serPort.Write([]byte(data))
		return err
	}
	if isSSH && streams != nil && streams.Stdin != nil {
		_, err := io.WriteString(streams.Stdin, data)
		return err
	}
	return core.ErrSessionNotFound
}

// ResizeTerminal updates the terminal window size when xterm.js resizes (F-07, F-23).
func (a *App) ResizeTerminal(sessionID string, cols uint16, rows uint16) error {
	a.mu.Lock()
	locSess, isLocal := a.localSessions[sessionID]
	_, isSerial := a.serialSessions[sessionID]
	a.mu.Unlock()

	if isLocal && locSess != nil {
		return locSess.Resize(core.TerminalSize{Cols: cols, Rows: rows})
	}
	if isSerial {
		return nil
	}
	return a.transport.ResizeShell(a.ctx, sessionID, core.TerminalSize{
		Cols: cols,
		Rows: rows,
	})
}

// InjectSessionPassword injects the active session's password (resolved inside the Go process from the
// encrypted Vault or active session state) directly into the remote PTY stdin without exposing it to the frontend (Golden Rule 2).
func (a *App) InjectSessionPassword(sessionID string) error {
	a.vaultStore.Touch()

	a.mu.Lock()
	streams, ok := a.activeStreams[sessionID]
	hostID := a.sessionHostID[sessionID]
	cachedPW := a.sessionPasswords[sessionID]
	a.mu.Unlock()

	if !ok || streams == nil || streams.Stdin == nil {
		return core.ErrSessionNotFound
	}

	secret := cachedPW
	if secret == "" && hostID != "" {
		if payload, err := a.vaultStore.GetPayload(); err == nil {
			if resolved, err := core.ResolveEffectiveHost(hostID, payload); err == nil {
				secret = resolved.Auth.Password
			}
		}
	}

	if secret == "" {
		return errors.New("no password stored for this session")
	}

	_, err := io.WriteString(streams.Stdin, secret)
	return err
}

// DisconnectSession closes the active SSH session, local shell, or serial port and removes its stream reference.
func (a *App) DisconnectSession(sessionID string) error {
	a.mu.Lock()
	locSess, isLocal := a.localSessions[sessionID]
	delete(a.localSessions, sessionID)
	serPort, isSerial := a.serialSessions[sessionID]
	delete(a.serialSessions, sessionID)
	delete(a.activeStreams, sessionID)
	delete(a.sessionHostID, sessionID)
	delete(a.sessionPasswords, sessionID)
	delete(a.sessionRequests, sessionID)
	a.mu.Unlock()

	if isLocal && locSess != nil {
		return locSess.Close()
	}
	if isSerial && serPort != nil {
		return serPort.Close()
	}
	return a.transport.Disconnect(a.ctx, sessionID)
}

func (a *App) streamReaderLoop(sessionID string, r io.Reader, emitExitOnEOF bool) {
	if r == nil {
		return
	}
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			sanitized := StripOSC52Sequences(buf[:n])
			if len(sanitized) > 0 {
				a.emit(a.ctx, "terminal:data", core.TerminalDataEvent{
					SessionID: sessionID,
					Data:      string(sanitized),
				})
			}
		}
		if err != nil {
			if emitExitOnEOF {
				a.mu.Lock()
				delete(a.activeStreams, sessionID)
				delete(a.localSessions, sessionID)
				delete(a.serialSessions, sessionID)
				delete(a.sessionHostID, sessionID)
				delete(a.sessionPasswords, sessionID)
				delete(a.sessionRequests, sessionID)
				a.mu.Unlock()
				a.emit(a.ctx, "terminal:exit", core.TerminalExitEvent{
					SessionID: sessionID,
					Reason:    err.Error(),
				})
			}
			return
		}
	}
}

// StripOSC52Sequences removes OSC 52 clipboard manipulation sequences (\x1b]52;...(\x07|\x1b\\))
// per Spec Section 6 (Threat Model: Terminal-Escape-Injection).
func StripOSC52Sequences(input []byte) []byte {
	prefix := []byte("\x1b]52;")
	if !bytes.Contains(input, prefix) {
		return input
	}

	var out bytes.Buffer
	out.Grow(len(input))

	i := 0
	for i < len(input) {
		idx := bytes.Index(input[i:], prefix)
		if idx == -1 {
			out.Write(input[i:])
			break
		}
		out.Write(input[i : i+idx])
		seqStart := i + idx + len(prefix)

		// Find BEL (\x07) or ST (\x1b\\) terminator
		endIdx := -1
		advance := 0
		for j := seqStart; j < len(input); j++ {
			if input[j] == 0x07 {
				endIdx = j
				advance = 1
				break
			}
			if input[j] == 0x1b && j+1 < len(input) && input[j+1] == '\\' {
				endIdx = j
				advance = 2
				break
			}
		}
		if endIdx == -1 {
			// Unterminated OSC 52 at end of chunk: drop remainder of sequence
			break
		}
		i = endIdx + advance
	}

	return out.Bytes()
}
