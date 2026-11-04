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

	mu            sync.Mutex
	activeStreams map[string]*core.SshShellStreams
	pendingKeys   map[string]chan bool
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
		ctx:           context.Background(),
		transport:     transport,
		knownHosts:    kh,
		emit:          emit,
		activeStreams: make(map[string]*core.SshShellStreams),
		pendingKeys:   make(map[string]chan bool),
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
	a.mu.Unlock()

	go a.streamReaderLoop(sessionID, streams.Stdout, true)
	go a.streamReaderLoop(sessionID, streams.Stderr, false)

	return sessionID, nil
}

func hostPromptKey(host string, port uint16) string {
	return fmt.Sprintf("[%s]:%d", host, port)
}

// ConnectSSH opens an SSH connection, verifies the host key (prompting the user on first-seen TOFU),
// starts an interactive PTY shell, and streams sanitized output events to the frontend (F-01, F-06, F-07).
func (a *App) ConnectSSH(req core.ConnectRequest) (string, error) {
	a.vaultStore.Touch()

	port := req.Port
	if port == 0 {
		port = 22
	}

	var authCfg core.SshAuthConfig
	if req.PrivateKey != "" {
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
	a.mu.Unlock()

	go a.streamReaderLoop(sessionID, streams.Stdout, true)
	go a.streamReaderLoop(sessionID, streams.Stderr, false)

	return sessionID, nil
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

// WriteTerminal writes user keystrokes from xterm.js into the active SSH shell stdin (F-07).
func (a *App) WriteTerminal(sessionID string, data string) error {
	a.vaultStore.Touch()
	a.mu.Lock()
	streams, ok := a.activeStreams[sessionID]
	a.mu.Unlock()
	if !ok || streams == nil || streams.Stdin == nil {
		return core.ErrSessionNotFound
	}
	_, err := io.WriteString(streams.Stdin, data)
	return err
}

// ResizeTerminal updates the remote PTY window size when xterm.js resizes (F-07).
func (a *App) ResizeTerminal(sessionID string, cols uint16, rows uint16) error {
	return a.transport.ResizeShell(a.ctx, sessionID, core.TerminalSize{
		Cols: cols,
		Rows: rows,
	})
}

// DisconnectSession closes the active SSH session and removes its stream reference.
func (a *App) DisconnectSession(sessionID string) error {
	a.mu.Lock()
	delete(a.activeStreams, sessionID)
	a.mu.Unlock()
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
