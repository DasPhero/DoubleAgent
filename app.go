package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
	sftpClients      map[string]core.SftpClient
	transferTasks    map[string]*activeTransferTask
	activeTunnels    map[string]core.ForwardTunnel
	logMgr           *core.SessionLogManager
}

type activeTransferTask struct {
	task   core.TransferTask
	cancel context.CancelFunc
}

func defaultVaultPath() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil || cfgDir == "" {
		return "doubleagent.vault"
	}
	return filepath.Join(cfgDir, "DoubleAgent", "doubleagent.vault")
}

func defaultLogsDir() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil || cfgDir == "" {
		return filepath.Join(os.TempDir(), "doubleagent-logs")
	}
	return filepath.Join(cfgDir, "DoubleAgent", "logs")
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
		sftpClients:      make(map[string]core.SftpClient),
		transferTasks:    make(map[string]*activeTransferTask),
		activeTunnels:    make(map[string]core.ForwardTunnel),
		logMgr:           core.NewSessionLogManager(defaultLogsDir()),
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

// buildSshConfigForHost resolves proxy settings (ProxyJump, ProxyCommand, SOCKS5) and credentials for a host (F-14).
func (a *App) buildSshConfigForHost(resolved core.ResolvedHost, payload core.VaultPayload) (core.SshSessionConfig, error) {
	cfg := core.SshSessionConfig{
		HostID:   resolved.HostID,
		Address:  resolved.Address,
		Port:     resolved.Port,
		Username: resolved.Username,
		Auth:     resolved.Auth,
		OnFirstSeenKey: func(info core.HostKeyInfo) (bool, error) {
			return a.promptHostKeyTOFU(info)
		},
	}

	if resolved.ProxyCommand != "" {
		cfg.ProxyCommand = resolved.ProxyCommand
	}

	if resolved.ProxyProfileID != "" {
		for _, prof := range payload.ProxyProfiles {
			if prof.ID == resolved.ProxyProfileID {
				switch prof.Type {
				case core.ProxyTypeCommand:
					cfg.ProxyCommand = prof.Command
				case core.ProxyTypeSocks5:
					cfg.SocksProxy = prof.SocksAddress
					if prof.SocksUsername != "" {
						cfg.SocksAuth = &core.SocksAuth{
							Username: prof.SocksUsername,
							Password: prof.SocksPassword,
						}
					}
				case core.ProxyTypeJump:
					for _, jumpID := range prof.JumpHostIDs {
						jumpCfg, err := a.resolveJumpHopConfig(jumpID, payload)
						if err != nil {
							return cfg, fmt.Errorf("resolve jump hop %s: %w", jumpID, err)
						}
						cfg.JumpChain = append(cfg.JumpChain, jumpCfg)
					}
				}
				break
			}
		}
	}

	// Direct JumpChain on host if not set by profile
	if len(cfg.JumpChain) == 0 && len(resolved.JumpChain) > 0 {
		for _, jumpID := range resolved.JumpChain {
			jumpCfg, err := a.resolveJumpHopConfig(jumpID, payload)
			if err != nil {
				return cfg, fmt.Errorf("resolve jump hop %s: %w", jumpID, err)
			}
			cfg.JumpChain = append(cfg.JumpChain, jumpCfg)
		}
	}

	return cfg, nil
}

func (a *App) resolveJumpHopConfig(jumpSpec string, payload core.VaultPayload) (core.SshSessionConfig, error) {
	// First check if jumpSpec is a saved HostID or Label
	for _, h := range payload.Hosts {
		if h.ID == jumpSpec || h.Label == jumpSpec {
			resHop, err := core.ResolveEffectiveHost(h.ID, payload)
			if err == nil {
				return core.SshSessionConfig{
					HostID:   resHop.HostID,
					Address:  resHop.Address,
					Port:     resHop.Port,
					Username: resHop.Username,
					Auth:     resHop.Auth,
					OnFirstSeenKey: func(info core.HostKeyInfo) (bool, error) {
						return a.promptHostKeyTOFU(info)
					},
				}, nil
			}
		}
	}

	// Ad-hoc host specification: [user@]host[:port]
	addr := jumpSpec
	user := "root"
	port := uint16(22)
	if atIdx := strings.Index(addr, "@"); atIdx != -1 {
		user = addr[:atIdx]
		addr = addr[atIdx+1:]
	}
	if colonIdx := strings.LastIndex(addr, ":"); colonIdx != -1 {
		if p, err := strconv.Atoi(addr[colonIdx+1:]); err == nil && p > 0 && p <= 65535 {
			port = uint16(p)
			addr = addr[:colonIdx]
		}
	}

	return core.SshSessionConfig{
		Address:  addr,
		Port:     port,
		Username: user,
		Auth: core.SshAuthConfig{
			Method: core.AuthAgent,
		},
		OnFirstSeenKey: func(info core.HostKeyInfo) (bool, error) {
			return a.promptHostKeyTOFU(info)
		},
	}, nil
}

// ConnectSavedHost resolves a saved host's effective address, port, username, and secret identity inside Go
// (applying group inheritance per F-01, and proxy settings per F-14) and starts an interactive SSH PTY session.
func (a *App) ConnectSavedHost(hostID string, size core.TerminalSize) (string, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return "", err
	}
	resolved, err := core.ResolveEffectiveHost(hostID, payload)
	if err != nil {
		return "", err
	}

	sshCfg, err := a.buildSshConfigForHost(resolved, payload)
	if err != nil {
		return "", err
	}

	sessionID, err := a.transport.Connect(a.ctx, sshCfg)
	if err != nil {
		return "", err
	}

	if size.Cols == 0 {
		size.Cols = 80
	}
	if size.Rows == 0 {
		size.Rows = 24
	}

	var streams *core.SshShellStreams
	if resolved.InitialDir != "" {
		streams, err = a.transport.OpenShellWithOptions(a.ctx, sessionID, size, resolved.InitialDir, false)
	} else {
		streams, err = a.transport.OpenShell(a.ctx, sessionID, size)
	}
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

	if resolved.SessionLogging && a.logMgr != nil {
		_, _ = a.logMgr.StartSession(sessionID, hostID, resolved.Label)
		if resolved.Auth.Password != "" {
			a.logMgr.RegisterSensitiveValue(sessionID, resolved.Auth.Password)
		}
	}

	go a.streamReaderLoop(sessionID, streams.Stdout, true)
	go a.streamReaderLoop(sessionID, streams.Stderr, false)

	go a.autoStartForwardRules(sessionID, hostID)

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

	sshCfg := core.SshSessionConfig{
		Address:  req.Address,
		Port:     port,
		Username: req.Username,
		Auth:     authCfg,
		OnFirstSeenKey: func(info core.HostKeyInfo) (bool, error) {
			return a.promptHostKeyTOFU(info)
		},
	}

	if req.ProxyCommand != "" {
		sshCfg.ProxyCommand = req.ProxyCommand
	}

	if req.ProxyJump != "" {
		if payload, err := a.vaultStore.GetPayload(); err == nil {
			jumps := strings.Split(req.ProxyJump, ",")
			for _, j := range jumps {
				trimmed := strings.TrimSpace(j)
				if trimmed != "" {
					if hop, err := a.resolveJumpHopConfig(trimmed, payload); err == nil {
						sshCfg.JumpChain = append(sshCfg.JumpChain, hop)
					}
				}
			}
		}
	}

	if req.ProxyProfileID != "" {
		if payload, err := a.vaultStore.GetPayload(); err == nil {
			for _, prof := range payload.ProxyProfiles {
				if prof.ID == req.ProxyProfileID {
					switch prof.Type {
					case core.ProxyTypeCommand:
						sshCfg.ProxyCommand = prof.Command
					case core.ProxyTypeSocks5:
						sshCfg.SocksProxy = prof.SocksAddress
						if prof.SocksUsername != "" {
							sshCfg.SocksAuth = &core.SocksAuth{
								Username: prof.SocksUsername,
								Password: prof.SocksPassword,
							}
						}
					case core.ProxyTypeJump:
						for _, jID := range prof.JumpHostIDs {
							if hop, err := a.resolveJumpHopConfig(jID, payload); err == nil {
								sshCfg.JumpChain = append(sshCfg.JumpChain, hop)
							}
						}
					}
					break
				}
			}
		}
	}

	sessionID, err := a.transport.Connect(a.ctx, sshCfg)
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

	go a.autoStartForwardRules(sessionID, "")

	return sessionID, nil
}

// DuplicateSession opens a parallel SSH, local shell, or fails for serial (used when splitting a pane horizontally or vertically per F-08).
func (a *App) DuplicateSession(sessionID string, size core.TerminalSize) (string, error) {
	return a.OpenTerminalWithOptions(sessionID, core.TerminalSpawnOptions{
		Mode: "current",
		Size: size,
	})
}

// OpenTerminalWithOptions opens a new terminal session (as a new tab or split pane) with custom directory and root options (F-10).
// Mode can be "default", "current", or "root".
func (a *App) OpenTerminalWithOptions(targetSessionID string, opts core.TerminalSpawnOptions) (string, error) {
	a.mu.Lock()
	locSess, isLocal := a.localSessions[targetSessionID]
	_, isSerial := a.serialSessions[targetSessionID]
	hostID := a.sessionHostID[targetSessionID]
	req, hasReq := a.sessionRequests[targetSessionID]
	a.mu.Unlock()

	size := opts.Size
	if size.Cols == 0 {
		size.Cols = 80
	}
	if size.Rows == 0 {
		size.Rows = 24
	}

	asRoot := opts.Mode == "root"
	workingDir := ""
	if opts.Mode == "current" || opts.Mode == "root" {
		workingDir = strings.TrimSpace(opts.WorkingDir)
	}

	if isSerial {
		return "", errors.New("cannot duplicate serial connection; port is already open")
	}

	if targetSessionID == "" {
		ptyOpts := pty.ShellOptions{
			ShellType:  "",
			WorkingDir: workingDir,
			AsRoot:     asRoot,
			Size:       size,
		}
		sess, err := pty.StartShellWithOptions(a.ctx, ptyOpts)
		if err != nil {
			return "", err
		}
		newID := sess.ID()
		a.mu.Lock()
		a.localSessions[newID] = sess
		a.mu.Unlock()
		go a.streamReaderLoop(newID, sess.Stdout(), true)
		return newID, nil
	}

	if isLocal && locSess != nil {
		ptyOpts := pty.ShellOptions{
			ShellType:  locSess.ShellType(),
			WorkingDir: workingDir,
			AsRoot:     asRoot,
			Size:       size,
		}
		sess, err := pty.StartShellWithOptions(a.ctx, ptyOpts)
		if err != nil {
			return "", err
		}
		newID := sess.ID()
		a.mu.Lock()
		a.localSessions[newID] = sess
		a.mu.Unlock()
		go a.streamReaderLoop(newID, sess.Stdout(), true)
		return newID, nil
	}

	if hostID != "" {
		payload, err := a.vaultStore.GetPayload()
		if err != nil {
			return "", err
		}
		resolved, err := core.ResolveEffectiveHost(hostID, payload)
		if err != nil {
			return "", err
		}

		if opts.Mode == "default" && resolved.InitialDir != "" {
			workingDir = resolved.InitialDir
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

		streams, err := a.transport.OpenShellWithOptions(a.ctx, sessionID, size, workingDir, asRoot)
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

	if hasReq {
		req.Size = size
		sessionID, err := a.transport.Connect(a.ctx, core.SshSessionConfig{
			HostID:   req.Address,
			Address:  req.Address,
			Port:     req.Port,
			Username: req.Username,
			Auth: core.SshAuthConfig{
				Method:   core.AuthPassword,
				Password: req.Password,
			},
			OnFirstSeenKey: func(info core.HostKeyInfo) (bool, error) {
				return a.promptHostKeyTOFU(info)
			},
		})
		if err != nil {
			return "", err
		}

		streams, err := a.transport.OpenShellWithOptions(a.ctx, sessionID, size, workingDir, asRoot)
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
	if a.logMgr != nil {
		a.logMgr.NotifyInput(sessionID, data)
	}
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

// BroadcastInput writes user input simultaneously to multiple active terminal sessions (F-26).
func (a *App) BroadcastInput(sessionIDs []string, data string) error {
	a.vaultStore.Touch()
	var firstErr error
	for _, sid := range sessionIDs {
		sid = strings.TrimSpace(sid)
		if sid == "" {
			continue
		}
		if err := a.WriteTerminal(sid, data); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
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

	if a.logMgr != nil {
		a.logMgr.RegisterSensitiveValue(sessionID, secret)
		a.logMgr.SuppressNextEcho(sessionID)
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

	var tunnelsToClose []core.ForwardTunnel
	for tid, tun := range a.activeTunnels {
		if tun != nil && tun.GetStatus().SessionID == sessionID {
			tunnelsToClose = append(tunnelsToClose, tun)
			delete(a.activeTunnels, tid)
		}
	}
	a.mu.Unlock()

	for _, tun := range tunnelsToClose {
		_ = tun.Close()
	}
	if len(tunnelsToClose) > 0 {
		a.emit(a.ctx, "forward:tunnels-updated", a.GetActiveTunnels())
	}

	if a.logMgr != nil {
		_, _ = a.logMgr.StopSession(sessionID)
	}

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
				if a.logMgr != nil {
					a.logMgr.WriteOutput(sessionID, string(sanitized))
				}
				a.emit(a.ctx, "terminal:data", core.TerminalDataEvent{
					SessionID: sessionID,
					Data:      string(sanitized),
				})
			}
		}
		if err != nil {
			if emitExitOnEOF {
				if a.logMgr != nil {
					_, _ = a.logMgr.StopSession(sessionID)
				}
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

func (a *App) getOrOpenSftp(sessionID string) (core.SftpClient, error) {
	a.mu.Lock()
	client, exists := a.sftpClients[sessionID]
	a.mu.Unlock()

	if exists && client != nil {
		return client, nil
	}

	newClient, err := a.transport.OpenSftp(a.ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("open sftp for session %q: %w", sessionID, err)
	}

	a.mu.Lock()
	a.sftpClients[sessionID] = newClient
	a.mu.Unlock()
	return newClient, nil
}

// ListLocalDir lists files and folders in a local directory (F-12).
func (a *App) ListLocalDir(path string) ([]core.FileItem, error) {
	if path == "" {
		home, err := os.UserHomeDir()
		if err == nil && home != "" {
			path = home
		} else {
			path = "."
		}
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("read local dir %q: %w", path, err)
	}

	result := make([]core.FileItem, 0, len(entries))
	for _, entry := range entries {
		itemPath := filepath.ToSlash(filepath.Join(path, entry.Name()))
		info, err := entry.Info()
		size := int64(0)
		modTime := int64(0)
		perms := "-rw-r--r--"
		if err == nil && info != nil {
			size = info.Size()
			modTime = info.ModTime().Unix()
			perms = info.Mode().String()
		}

		result = append(result, core.FileItem{
			Name:        entry.Name(),
			Path:        itemPath,
			Size:        size,
			IsDir:       entry.IsDir(),
			ModTime:     modTime,
			Permissions: perms,
		})
	}
	return result, nil
}

// ListRemoteDir lists files and folders on the remote SFTP server (F-12).
func (a *App) ListRemoteDir(sessionID string, path string) ([]core.FileItem, error) {
	client, err := a.getOrOpenSftp(sessionID)
	if err != nil {
		return nil, err
	}
	return client.List(a.ctx, path)
}

// StartSftpUpload queues and begins a background file upload from local to remote (F-12).
func (a *App) StartSftpUpload(sessionID string, localPath string, remotePath string) (string, error) {
	client, err := a.getOrOpenSftp(sessionID)
	if err != nil {
		return "", err
	}

	stat, err := os.Stat(localPath)
	if err != nil {
		return "", fmt.Errorf("stat local file: %w", err)
	}

	taskID := fmt.Sprintf("upload-%d-%s", time.Now().UnixNano(), filepath.Base(localPath))
	taskCtx, cancel := context.WithCancel(a.ctx)

	task := core.TransferTask{
		ID:               taskID,
		SessionID:        sessionID,
		Direction:        "upload",
		LocalPath:        localPath,
		RemotePath:       remotePath,
		TotalBytes:       stat.Size(),
		TransferredBytes: 0,
		Status:           core.TransferRunning,
	}

	a.mu.Lock()
	a.transferTasks[taskID] = &activeTransferTask{
		task:   task,
		cancel: cancel,
	}
	a.mu.Unlock()

	go func() {
		defer cancel()
		startTime := time.Now()

		err := client.Upload(taskCtx, localPath, remotePath, func(transferred, total int64) {
			elapsed := time.Since(startTime).Seconds()
			speed := int64(0)
			if elapsed > 0 {
				speed = int64(float64(transferred) / elapsed)
			}
			percent := float64(0)
			if total > 0 {
				percent = float64(transferred) / float64(total) * 100.0
			}

			a.mu.Lock()
			if t, ok := a.transferTasks[taskID]; ok {
				t.task.TransferredBytes = transferred
				t.task.SpeedBytesPerSec = speed
			}
			a.mu.Unlock()

			a.emit(a.ctx, "sftp:progress", core.TransferProgressEvent{
				TaskID:           taskID,
				TransferredBytes: transferred,
				TotalBytes:       total,
				SpeedBytesPerSec: speed,
				Percent:          percent,
				Status:           core.TransferRunning,
			})
		})

		a.mu.Lock()
		defer a.mu.Unlock()

		finalStatus := core.TransferCompleted
		errMsg := ""
		if err != nil {
			if errors.Is(err, context.Canceled) {
				finalStatus = core.TransferCancelled
			} else {
				finalStatus = core.TransferFailed
				errMsg = err.Error()
			}
		}

		if t, ok := a.transferTasks[taskID]; ok {
			t.task.Status = finalStatus
			t.task.Error = errMsg
			if finalStatus == core.TransferCompleted {
				t.task.TransferredBytes = t.task.TotalBytes
			}
		}

		a.emit(a.ctx, "sftp:progress", core.TransferProgressEvent{
			TaskID:           taskID,
			TransferredBytes: task.TotalBytes,
			TotalBytes:       task.TotalBytes,
			Percent:          100.0,
			Status:           finalStatus,
			Error:            errMsg,
		})
	}()

	return taskID, nil
}

// StartSftpDownload queues and begins a background file download from remote to local (F-12).
func (a *App) StartSftpDownload(sessionID string, remotePath string, localPath string) (string, error) {
	client, err := a.getOrOpenSftp(sessionID)
	if err != nil {
		return "", err
	}

	stat, err := client.Stat(a.ctx, remotePath)
	if err != nil {
		return "", fmt.Errorf("stat remote file: %w", err)
	}

	taskID := fmt.Sprintf("download-%d-%s", time.Now().UnixNano(), filepath.Base(remotePath))
	taskCtx, cancel := context.WithCancel(a.ctx)

	task := core.TransferTask{
		ID:               taskID,
		SessionID:        sessionID,
		Direction:        "download",
		LocalPath:        localPath,
		RemotePath:       remotePath,
		TotalBytes:       stat.Size,
		TransferredBytes: 0,
		Status:           core.TransferRunning,
	}

	a.mu.Lock()
	a.transferTasks[taskID] = &activeTransferTask{
		task:   task,
		cancel: cancel,
	}
	a.mu.Unlock()

	go func() {
		defer cancel()
		startTime := time.Now()

		err := client.Download(taskCtx, remotePath, localPath, func(transferred, total int64) {
			elapsed := time.Since(startTime).Seconds()
			speed := int64(0)
			if elapsed > 0 {
				speed = int64(float64(transferred) / elapsed)
			}
			percent := float64(0)
			if total > 0 {
				percent = float64(transferred) / float64(total) * 100.0
			}

			a.mu.Lock()
			if t, ok := a.transferTasks[taskID]; ok {
				t.task.TransferredBytes = transferred
				t.task.SpeedBytesPerSec = speed
			}
			a.mu.Unlock()

			a.emit(a.ctx, "sftp:progress", core.TransferProgressEvent{
				TaskID:           taskID,
				TransferredBytes: transferred,
				TotalBytes:       total,
				SpeedBytesPerSec: speed,
				Percent:          percent,
				Status:           core.TransferRunning,
			})
		})

		a.mu.Lock()
		defer a.mu.Unlock()

		finalStatus := core.TransferCompleted
		errMsg := ""
		if err != nil {
			if errors.Is(err, context.Canceled) {
				finalStatus = core.TransferCancelled
			} else {
				finalStatus = core.TransferFailed
				errMsg = err.Error()
			}
		}

		if t, ok := a.transferTasks[taskID]; ok {
			t.task.Status = finalStatus
			t.task.Error = errMsg
			if finalStatus == core.TransferCompleted {
				t.task.TransferredBytes = t.task.TotalBytes
			}
		}

		a.emit(a.ctx, "sftp:progress", core.TransferProgressEvent{
			TaskID:           taskID,
			TransferredBytes: task.TotalBytes,
			TotalBytes:       task.TotalBytes,
			Percent:          100.0,
			Status:           finalStatus,
			Error:            errMsg,
		})
	}()

	return taskID, nil
}

// CancelTransfer cancels an active SFTP upload or download (F-12).
func (a *App) CancelTransfer(taskID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	task, exists := a.transferTasks[taskID]
	if !exists || task == nil {
		return errors.New("transfer task not found")
	}

	task.cancel()
	task.task.Status = core.TransferCancelled
	return nil
}

// CreateRemoteDir creates a new directory on the remote SFTP server (F-12).
func (a *App) CreateRemoteDir(sessionID string, path string) error {
	client, err := a.getOrOpenSftp(sessionID)
	if err != nil {
		return err
	}
	return client.Mkdir(a.ctx, path)
}

// DeleteRemoteItem removes a file or directory on the remote SFTP server (F-12).
func (a *App) DeleteRemoteItem(sessionID string, path string) error {
	client, err := a.getOrOpenSftp(sessionID)
	if err != nil {
		return err
	}
	return client.Remove(a.ctx, path)
}

// GetActiveTransfers returns a snapshot of all active and recent SFTP transfers (F-12).
func (a *App) GetActiveTransfers() []core.TransferTask {
	a.mu.Lock()
	defer a.mu.Unlock()

	result := make([]core.TransferTask, 0, len(a.transferTasks))
	for _, t := range a.transferTasks {
		result = append(result, t.task)
	}
	return result
}

// autoStartForwardRules starts any port forwarding rules configured for auto-start with a given host (F-13).
func (a *App) autoStartForwardRules(sessionID, hostID string) {
	if a.vaultStore.IsLocked() {
		return
	}
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return
	}

	var targetHost *core.HostRecord
	if hostID != "" {
		for _, h := range payload.Hosts {
			if h.ID == hostID {
				targetHost = &h
				break
			}
		}
	}

	for _, rule := range payload.ForwardRules {
		if !rule.AutoStart {
			continue
		}
		isMatch := (hostID != "" && rule.HostID == hostID)
		if !isMatch && targetHost != nil {
			for _, rID := range targetHost.ForwardRuleIDs {
				if rID == rule.ID {
					isMatch = true
					break
				}
			}
		}
		if isMatch {
			_, _ = a.StartForwardTunnel(sessionID, rule.ID)
		}
	}
}

// SaveForwardRule creates or updates a port forwarding rule in the encrypted vault (F-13).
func (a *App) SaveForwardRule(rule core.ForwardRule) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	if rule.ID == "" {
		rule.ID = fmt.Sprintf("rule-%d", time.Now().UnixNano())
	}
	if rule.Type == "" {
		rule.Type = core.ForwardLocal
	}
	if rule.BindAddress == "" {
		rule.BindAddress = "127.0.0.1"
	}

	updated := false
	for i, r := range payload.ForwardRules {
		if r.ID == rule.ID {
			payload.ForwardRules[i] = rule
			updated = true
			break
		}
	}
	if !updated {
		payload.ForwardRules = append(payload.ForwardRules, rule)
	}

	// If rule is associated with a specific host, ensure the host references it
	if rule.HostID != "" {
		for i, h := range payload.Hosts {
			if h.ID == rule.HostID {
				hasID := false
				for _, existingRuleID := range h.ForwardRuleIDs {
					if existingRuleID == rule.ID {
						hasID = true
						break
					}
				}
				if !hasID {
					payload.Hosts[i].ForwardRuleIDs = append(payload.Hosts[i].ForwardRuleIDs, rule.ID)
				}
			}
		}
	}

	return a.vaultStore.SavePayload(a.ctx, payload)
}

// DeleteForwardRule removes a port forwarding rule from the vault and stops any active tunnels using it (F-13).
func (a *App) DeleteForwardRule(ruleID string) error {
	a.vaultStore.Touch()

	// Stop any active tunnels using this rule
	a.mu.Lock()
	var toStop []string
	for tid, tun := range a.activeTunnels {
		if tun != nil && tun.GetStatus().RuleID == ruleID {
			toStop = append(toStop, tid)
		}
	}
	a.mu.Unlock()

	for _, tid := range toStop {
		_ = a.StopForwardTunnel(tid)
	}

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	filteredRules := make([]core.ForwardRule, 0, len(payload.ForwardRules))
	for _, r := range payload.ForwardRules {
		if r.ID != ruleID {
			filteredRules = append(filteredRules, r)
		}
	}
	payload.ForwardRules = filteredRules

	for i := range payload.Hosts {
		filteredHostRuleIDs := make([]string, 0, len(payload.Hosts[i].ForwardRuleIDs))
		for _, rID := range payload.Hosts[i].ForwardRuleIDs {
			if rID != ruleID {
				filteredHostRuleIDs = append(filteredHostRuleIDs, rID)
			}
		}
		payload.Hosts[i].ForwardRuleIDs = filteredHostRuleIDs
	}

	return a.vaultStore.SavePayload(a.ctx, payload)
}

// ListForwardRules returns all port forwarding rules stored in the vault (F-13).
func (a *App) ListForwardRules() ([]core.ForwardRule, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	return payload.ForwardRules, nil
}

// StartForwardTunnel starts a port forwarding tunnel on an active SSH session for a given rule (F-13).
func (a *App) StartForwardTunnel(sessionID string, ruleID string) (string, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return "", err
	}

	var targetRule *core.ForwardRule
	for _, r := range payload.ForwardRules {
		if r.ID == ruleID {
			targetRule = &r
			break
		}
	}
	if targetRule == nil {
		return "", fmt.Errorf("forward rule %s not found in vault", ruleID)
	}

	a.mu.Lock()
	for _, t := range a.activeTunnels {
		st := t.GetStatus()
		if st.Status == "active" && (st.RuleID == ruleID || st.ID == ruleID) {
			a.mu.Unlock()
			return st.ID, nil
		}
	}
	a.mu.Unlock()

	var tunnel core.ForwardTunnel
	switch targetRule.Type {
	case core.ForwardLocal:
		tunnel, err = a.transport.StartForwardLocal(
			a.ctx,
			sessionID,
			ruleID,
			targetRule.BindAddress,
			targetRule.BindPort,
			targetRule.TargetHost,
			targetRule.TargetPort,
		)
	case core.ForwardRemote:
		tunnel, err = a.transport.StartForwardRemote(
			a.ctx,
			sessionID,
			ruleID,
			targetRule.BindAddress,
			targetRule.BindPort,
			targetRule.TargetHost,
			targetRule.TargetPort,
		)
	case core.ForwardDynamic:
		tunnel, err = a.transport.StartForwardDynamic(
			a.ctx,
			sessionID,
			ruleID,
			targetRule.BindAddress,
			targetRule.BindPort,
		)
	default:
		return "", fmt.Errorf("unsupported forward rule type: %s", targetRule.Type)
	}

	if err != nil {
		return "", err
	}

	tunnelID := tunnel.GetStatus().ID
	a.mu.Lock()
	a.activeTunnels[tunnelID] = tunnel
	a.mu.Unlock()

	a.emit(a.ctx, "forward:tunnels-updated", a.GetActiveTunnels())
	return tunnelID, nil
}

// StopForwardTunnel shuts down an active port forwarding tunnel (F-13).
// Accepts either tunnelID or ruleID.
func (a *App) StopForwardTunnel(idOrRuleID string) error {
	a.mu.Lock()
	var targetTunnel core.ForwardTunnel
	var targetID string
	for id, tun := range a.activeTunnels {
		if id == idOrRuleID || (tun != nil && tun.GetStatus().RuleID == idOrRuleID) {
			targetTunnel = tun
			targetID = id
			break
		}
	}
	if targetID != "" {
		delete(a.activeTunnels, targetID)
	}
	a.mu.Unlock()

	if targetTunnel == nil {
		return errors.New("tunnel not found or already closed")
	}

	err := targetTunnel.Close()
	a.emit(a.ctx, "forward:tunnels-updated", a.GetActiveTunnels())
	return err
}

// GetActiveTunnels returns a snapshot of all active port forwarding tunnels and their current metrics (F-13).
func (a *App) GetActiveTunnels() []core.ForwardTunnelStatus {
	a.mu.Lock()
	defer a.mu.Unlock()

	result := make([]core.ForwardTunnelStatus, 0, len(a.activeTunnels))
	for _, tun := range a.activeTunnels {
		if tun != nil {
			result = append(result, tun.GetStatus())
		}
	}
	return result
}

// SaveProxyProfile creates or updates a proxy profile in the encrypted vault (F-14).
func (a *App) SaveProxyProfile(profile core.ProxyProfile) error {
	a.vaultStore.Touch()
	if profile.Name == "" {
		return errors.New("proxy profile name is required")
	}
	if profile.Type == "" {
		profile.Type = core.ProxyTypeJump
	}
	if profile.ID == "" {
		profile.ID = fmt.Sprintf("prof-%d", time.Now().UnixNano())
	}

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	updated := false
	for i := range payload.ProxyProfiles {
		if payload.ProxyProfiles[i].ID == profile.ID {
			// Preserve existing password if user edited profile without re-entering password (Golden Rule 2)
			if profile.Type == core.ProxyTypeSocks5 && profile.SocksPassword == "" {
				profile.SocksPassword = payload.ProxyProfiles[i].SocksPassword
			}
			payload.ProxyProfiles[i] = profile
			updated = true
			break
		}
	}
	if !updated {
		payload.ProxyProfiles = append(payload.ProxyProfiles, profile)
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", core.BuildVaultSummary(payload))
	return nil
}

// DeleteProxyProfile removes a proxy profile and clears references on associated hosts and groups (F-14).
func (a *App) DeleteProxyProfile(profileID string) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	filtered := make([]core.ProxyProfile, 0, len(payload.ProxyProfiles))
	for _, p := range payload.ProxyProfiles {
		if p.ID != profileID {
			filtered = append(filtered, p)
		}
	}
	payload.ProxyProfiles = filtered

	// Clear references from hosts
	for i := range payload.Hosts {
		if payload.Hosts[i].ProxyProfileID == profileID {
			payload.Hosts[i].ProxyProfileID = ""
		}
	}
	// Clear references from groups
	for i := range payload.Groups {
		if payload.Groups[i].DefaultSettings.ProxyProfileID == profileID {
			payload.Groups[i].DefaultSettings.ProxyProfileID = ""
		}
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", core.BuildVaultSummary(payload))
	return nil
}

// ListProxyProfiles returns non-secret summaries of all configured proxy profiles (F-14).
func (a *App) ListProxyProfiles() ([]core.ProxyProfileSummary, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	summary := core.BuildVaultSummary(payload)
	return summary.ProxyProfiles, nil
}

// GetDefaultProxychainsOptions builds default export configuration from current vault tunnels and profiles (F-14).
func (a *App) GetDefaultProxychainsOptions() (core.ProxychainsExportOptions, error) {
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.ProxychainsExportOptions{}, err
	}
	return core.BuildDefaultProxychainsOptions(payload), nil
}

// GenerateProxychainsConfig produces proxychains.conf text from supplied options (F-14).
func (a *App) GenerateProxychainsConfig(opts core.ProxychainsExportOptions) (string, error) {
	return core.GenerateProxychainsConfig(opts), nil
}

// ExportProxychainsConfig exports a standard proxychains.conf based on active/saved SOCKS proxies (F-14).
func (a *App) ExportProxychainsConfig() (string, error) {
	opts, err := a.GetDefaultProxychainsOptions()
	if err != nil {
		return "", err
	}
	return core.GenerateProxychainsConfig(opts), nil
}

// SaveProxychainsFile writes the generated proxychains configuration to disk (F-14).
func (a *App) SaveProxychainsFile(content string, targetPath string) error {
	if strings.TrimSpace(targetPath) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			targetPath = "proxychains.conf"
		} else {
			targetPath = filepath.Join(home, "proxychains.conf")
		}
	}
	return os.WriteFile(targetPath, []byte(content), 0644)
}

// SaveSnippet saves or updates a command snippet in the vault, auto-extracting variable placeholders (F-15).
func (a *App) SaveSnippet(snippet core.Snippet) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	if snippet.ID == "" {
		snippet.ID = fmt.Sprintf("snippet-%d", time.Now().UnixNano())
	}
	if snippet.Name == "" {
		snippet.Name = "Untitled Snippet"
	}
	if snippet.Tags == nil {
		snippet.Tags = []string{}
	}

	// Auto-extract and synchronize variables from the snippet body
	extracted := core.ExtractSnippetVariables(snippet.Body)
	existingMap := make(map[string]core.SnippetVariable)
	for _, v := range snippet.Variables {
		existingMap[strings.ToUpper(v.Name)] = v
	}
	for i, v := range extracted {
		if ex, ok := existingMap[strings.ToUpper(v.Name)]; ok {
			if ex.Description != "" && v.Description == "" {
				extracted[i].Description = ex.Description
			}
			if ex.SecretRef != "" && v.SecretRef == "" {
				extracted[i].SecretRef = ex.SecretRef
			}
			if ex.DefaultValue != "" && v.DefaultValue == "" {
				extracted[i].DefaultValue = ex.DefaultValue
			}
		}
	}
	snippet.Variables = extracted

	updated := false
	for i, s := range payload.Snippets {
		if s.ID == snippet.ID {
			payload.Snippets[i] = snippet
			updated = true
			break
		}
	}
	if !updated {
		payload.Snippets = append(payload.Snippets, snippet)
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", core.BuildVaultSummary(payload))
	return nil
}

// DeleteSnippet removes a snippet from the vault by its ID (F-15).
func (a *App) DeleteSnippet(snippetID string) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	filtered := make([]core.Snippet, 0, len(payload.Snippets))
	for _, s := range payload.Snippets {
		if s.ID != snippetID {
			filtered = append(filtered, s)
		}
	}
	payload.Snippets = filtered

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", core.BuildVaultSummary(payload))
	return nil
}

// ListSnippets returns all snippets stored in the vault (F-15).
func (a *App) ListSnippets() ([]core.Snippet, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	if payload.Snippets == nil {
		return []core.Snippet{}, nil
	}
	return payload.Snippets, nil
}

// GetSnippetContext constructs the auto-injected context for an active terminal session (F-15).
func (a *App) GetSnippetContext(sessionID string) core.SnippetContext {
	ctx := core.SnippetContext{
		Timestamp: time.Now().Format("2006-01-02 15:04:05"),
		Date:      time.Now().Format("2006-01-02"),
		Time:      time.Now().Format("15:04:05"),
	}

	a.mu.Lock()
	hostID := a.sessionHostID[sessionID]
	req, hasReq := a.sessionRequests[sessionID]
	_, isLocal := a.localSessions[sessionID]
	_, isSerial := a.serialSessions[sessionID]
	a.mu.Unlock()

	if hostID != "" {
		payload, err := a.vaultStore.GetPayload()
		if err == nil {
			resolved, err := core.ResolveEffectiveHost(hostID, payload)
			if err == nil {
				ctx.HostID = hostID
				ctx.HostLabel = resolved.Label
				ctx.Address = resolved.Address
				ctx.Hostname = resolved.Address
				ctx.IP = resolved.Address
				ctx.Port = resolved.Port
				ctx.Username = resolved.Username
				ctx.WorkingDir = resolved.InitialDir
			}
		}
	} else if hasReq {
		ctx.Address = req.Address
		ctx.Hostname = req.Address
		ctx.IP = req.Address
		ctx.Port = req.Port
		ctx.Username = req.Username
	} else if isLocal {
		hostname, _ := os.Hostname()
		user := os.Getenv("USERNAME")
		if user == "" {
			user = os.Getenv("USER")
		}
		cwd, _ := os.Getwd()
		ctx.Hostname = hostname
		ctx.Address = "127.0.0.1"
		ctx.IP = "127.0.0.1"
		ctx.Username = user
		ctx.WorkingDir = cwd
	} else if isSerial {
		ctx.HostLabel = "Serial Hardware Port"
		ctx.Address = sessionID
	}

	return ctx
}

// ResolveSnippetTemplate resolves snippet placeholders using active session context and user values (F-15).
func (a *App) ResolveSnippetTemplate(snippetID string, sessionID string, userValues map[string]string) (string, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return "", err
	}

	var targetSnippet *core.Snippet
	for _, s := range payload.Snippets {
		if s.ID == snippetID {
			targetSnippet = &s
			break
		}
	}
	if targetSnippet == nil {
		return "", fmt.Errorf("snippet %s not found in vault", snippetID)
	}

	snipCtx := a.GetSnippetContext(sessionID)

	// Secret resolver for {{SECRET:id}} or {{PASSWORD}}
	secretResolver := func(ref string) (string, error) {
		a.mu.Lock()
		cachedPW := a.sessionPasswords[sessionID]
		a.mu.Unlock()

		if ref == "session_password" {
			if cachedPW != "" {
				return cachedPW, nil
			}
			return "", errors.New("no cached session password available")
		}

		// Look up in identities
		for _, id := range payload.Identities {
			if id.ID == ref || strings.EqualFold(id.Label, ref) {
				if id.Password != "" {
					return id.Password, nil
				}
			}
		}
		return "", fmt.Errorf("secret reference %q not found in vault", ref)
	}

	return core.ResolveSnippet(targetSnippet.Body, snipCtx, userValues, secretResolver)
}

// ExecuteSnippet executes a resolved snippet by writing directly into the active session stdin/PTY (F-15).
func (a *App) ExecuteSnippet(sessionID string, snippetID string, userValues map[string]string) error {
	a.vaultStore.Touch()

	resolvedCmd, err := a.ResolveSnippetTemplate(snippetID, sessionID, userValues)
	if err != nil {
		return err
	}

	return a.WriteTerminal(sessionID, resolvedCmd+"\n")
}

// SaveTotpRecord creates or updates a TOTP secret in the encrypted vault (F-20).
// Secret seeds remain inside the Go process (Golden Rule 2, Threat Model Line 155).
func (a *App) SaveTotpRecord(record core.TotpRecord) error {
	a.vaultStore.Touch()

	record.Label = strings.TrimSpace(record.Label)
	record.Issuer = strings.TrimSpace(record.Issuer)
	record.Secret = strings.TrimSpace(record.Secret)

	if record.Label == "" {
		if record.Issuer != "" {
			record.Label = record.Issuer
		} else {
			return errors.New("totp label or issuer is required")
		}
	}

	if record.ID == "" {
		record.ID = fmt.Sprintf("totp-%d", time.Now().UnixNano())
	}
	if record.Algorithm == "" {
		record.Algorithm = "SHA1"
	}
	if record.Digits != 8 {
		record.Digits = 6
	}
	if record.Period <= 0 {
		record.Period = 30
	}
	if record.CreatedAt == "" {
		record.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	updated := false
	for i := range payload.TotpRecords {
		if payload.TotpRecords[i].ID == record.ID {
			// If editing without changing the secret, retain existing secret
			if record.Secret == "" {
				record.Secret = payload.TotpRecords[i].Secret
			} else {
				if _, err := vault.DecodeBase32Key(record.Secret); err != nil {
					return fmt.Errorf("invalid base32 secret: %w", err)
				}
			}
			payload.TotpRecords[i] = record
			updated = true
			break
		}
	}

	if !updated {
		if record.Secret == "" {
			return errors.New("totp secret is required")
		}
		if _, err := vault.DecodeBase32Key(record.Secret); err != nil {
			return fmt.Errorf("invalid base32 secret: %w", err)
		}
		payload.TotpRecords = append(payload.TotpRecords, record)
	}

	return a.vaultStore.SavePayload(a.ctx, payload)
}

// DeleteTotpRecord deletes a TOTP secret from the encrypted vault by its ID (F-20).
func (a *App) DeleteTotpRecord(totpID string) error {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	filtered := make([]core.TotpRecord, 0, len(payload.TotpRecords))
	for _, tr := range payload.TotpRecords {
		if tr.ID != totpID {
			filtered = append(filtered, tr)
		}
	}
	payload.TotpRecords = filtered

	// Disassociate from identities referencing this TotpID
	for i := range payload.Identities {
		if payload.Identities[i].TotpID == totpID {
			payload.Identities[i].TotpID = ""
		}
	}

	return a.vaultStore.SavePayload(a.ctx, payload)
}

// ListTotpRecords returns all non-secret TOTP summaries stored in the vault (F-20, Golden Rule 2).
func (a *App) ListTotpRecords() ([]core.TotpSummary, error) {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	summaries := make([]core.TotpSummary, 0, len(payload.TotpRecords))
	for _, tr := range payload.TotpRecords {
		alg := tr.Algorithm
		if alg == "" {
			alg = "SHA1"
		}
		digits := tr.Digits
		if digits == 0 {
			digits = 6
		}
		period := tr.Period
		if period == 0 {
			period = 30
		}
		summaries = append(summaries, core.TotpSummary{
			ID:        tr.ID,
			Label:     tr.Label,
			Issuer:    tr.Issuer,
			Algorithm: alg,
			Digits:    digits,
			Period:    period,
			HostID:    tr.HostID,
			CreatedAt: tr.CreatedAt,
		})
	}
	return summaries, nil
}

// GetTotpCode computes an ephemeral TOTP code and countdown for a given TotpID (F-20).
func (a *App) GetTotpCode(totpID string) (*core.TotpCodeResponse, error) {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	var target *core.TotpRecord
	for i := range payload.TotpRecords {
		if payload.TotpRecords[i].ID == totpID {
			target = &payload.TotpRecords[i]
			break
		}
	}
	if target == nil {
		return nil, errors.New("totp record not found")
	}

	code, remaining, err := vault.GenerateTOTPCode(target.Secret, time.Now().UTC(), target.Algorithm, target.Digits, target.Period)
	if err != nil {
		return nil, err
	}

	period := target.Period
	if period <= 0 {
		period = 30
	}

	return &core.TotpCodeResponse{
		ID:               target.ID,
		Code:             code,
		RemainingSeconds: remaining,
		Period:           period,
	}, nil
}

// GetAllTotpCodes generates ephemeral codes and remaining countdowns for all saved TOTP records (F-20).
func (a *App) GetAllTotpCodes() ([]core.TotpCodeResponse, error) {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	results := make([]core.TotpCodeResponse, 0, len(payload.TotpRecords))
	for _, tr := range payload.TotpRecords {
		code, remaining, err := vault.GenerateTOTPCode(tr.Secret, now, tr.Algorithm, tr.Digits, tr.Period)
		if err != nil {
			continue
		}
		period := tr.Period
		if period <= 0 {
			period = 30
		}
		results = append(results, core.TotpCodeResponse{
			ID:               tr.ID,
			Code:             code,
			RemainingSeconds: remaining,
			Period:           period,
		})
	}
	return results, nil
}

// ParseOTPAuthURI parses an otpauth:// URI string into a TotpRecord candidate (F-20).
func (a *App) ParseOTPAuthURI(uri string) (*core.TotpRecord, error) {
	return vault.ParseOTPAuthURI(uri)
}

// InjectTotpCode generates the current TOTP code and writes it directly to the active session stdin (F-20, Golden Rule 2).
// If totpID is empty, it attempts to resolve the TOTP record associated with the active session's host or identity.
func (a *App) InjectTotpCode(sessionID string, totpID string) error {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	a.mu.Lock()
	hostID := a.sessionHostID[sessionID]
	a.mu.Unlock()

	// If totpID not specified, resolve automatically from session host
	if totpID == "" {
		if hostID != "" {
			// 1. Look for a TotpRecord directly linked to this HostID
			for _, tr := range payload.TotpRecords {
				if tr.HostID == hostID {
					totpID = tr.ID
					break
				}
			}
			// 2. Look for host's effective identity TotpID
			if totpID == "" {
				if resolved, err := core.ResolveEffectiveHost(hostID, payload); err == nil && resolved.IdentityID != "" {
					for _, id := range payload.Identities {
						if id.ID == resolved.IdentityID && id.TotpID != "" {
							totpID = id.TotpID
							break
						}
					}
				}
			}
		}
		// 3. Fallback: if there is exactly 1 TotpRecord, auto-select it
		if totpID == "" && len(payload.TotpRecords) == 1 {
			totpID = payload.TotpRecords[0].ID
		}
	}

	if totpID == "" {
		return errors.New("no TOTP authenticator associated with this session; please select one")
	}

	var target *core.TotpRecord
	for i := range payload.TotpRecords {
		if payload.TotpRecords[i].ID == totpID {
			target = &payload.TotpRecords[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("totp record %q not found", totpID)
	}

	code, _, err := vault.GenerateTOTPCode(target.Secret, time.Now().UTC(), target.Algorithm, target.Digits, target.Period)
	if err != nil {
		return fmt.Errorf("failed to generate totp code: %w", err)
	}

	if a.logMgr != nil {
		a.logMgr.RegisterSensitiveValue(sessionID, code)
		a.logMgr.SuppressNextEcho(sessionID)
	}

	// Write code + newline directly into terminal session stdin
	return a.WriteTerminal(sessionID, code+"\n")
}

// SaveNote creates or updates a hierarchical note or folder in the encrypted vault (F-17, Golden Rule 2).
func (a *App) SaveNote(note core.NotePage) (core.NotePage, error) {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.NotePage{}, err
	}

	now := time.Now().UTC()
	if strings.TrimSpace(note.ID) == "" {
		note.ID = fmt.Sprintf("note-%d", now.UnixNano())
	}
	note.Title = strings.TrimSpace(note.Title)
	if note.Title == "" {
		if note.IsFolder {
			note.Title = "New Folder"
		} else {
			note.Title = "Untitled Note"
		}
	}
	if note.Type == "" {
		note.Type = "markdown"
	}
	// Prevent direct self-parenting cycle
	if note.ParentID == note.ID {
		note.ParentID = ""
	}
	note.UpdatedAt = now

	found := false
	for i := range payload.Notes {
		if payload.Notes[i].ID == note.ID {
			if note.CreatedAt.IsZero() {
				note.CreatedAt = payload.Notes[i].CreatedAt
			}
			payload.Notes[i] = note
			found = true
			break
		}
	}
	if !found {
		if note.CreatedAt.IsZero() {
			note.CreatedAt = now
		}
		if note.Order == 0 {
			note.Order = len(payload.Notes) + 1
		}
		payload.Notes = append(payload.Notes, note)
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return core.NotePage{}, err
	}
	a.emit(a.ctx, "vault:updated", core.BuildVaultSummary(payload))
	return note, nil
}

// DeleteNote removes a note or folder (and any nested child pages/folders) from the vault (F-17).
func (a *App) DeleteNote(noteID string) error {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	// Collect noteID and all recursive descendants
	toRemove := map[string]bool{noteID: true}
	changed := true
	for changed {
		changed = false
		for _, n := range payload.Notes {
			if n.ParentID != "" && toRemove[n.ParentID] && !toRemove[n.ID] {
				toRemove[n.ID] = true
				changed = true
			}
		}
	}

	filtered := make([]core.NotePage, 0, len(payload.Notes))
	for _, n := range payload.Notes {
		if !toRemove[n.ID] {
			filtered = append(filtered, n)
		}
	}
	payload.Notes = filtered

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", core.BuildVaultSummary(payload))
	return nil
}

// ListNotes returns notes from the encrypted vault, optionally filtered by hostID ("", "all", "global", or specific host ID) (F-17).
func (a *App) ListNotes(hostID string) ([]core.NotePage, error) {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	if payload.Notes == nil {
		return []core.NotePage{}, nil
	}

	scope := strings.TrimSpace(hostID)
	if scope == "" || scope == "all" {
		return payload.Notes, nil
	}
	if scope == "global" {
		res := core.FilterNotesByHost(payload.Notes, "")
		if res == nil {
			return []core.NotePage{}, nil
		}
		return res, nil
	}
	res := core.FilterNotesByHost(payload.Notes, scope)
	if res == nil {
		return []core.NotePage{}, nil
	}
	return res, nil
}

// GetNote retrieves a single NotePage by ID from the vault (F-17).
func (a *App) GetNote(noteID string) (*core.NotePage, error) {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	for i := range payload.Notes {
		if payload.Notes[i].ID == noteID {
			n := payload.Notes[i]
			return &n, nil
		}
	}
	return nil, fmt.Errorf("note %q not found", noteID)
}

// SearchNotes performs full-text search across all note titles and markdown bodies in the vault (F-17, F-02).
func (a *App) SearchNotes(query string) ([]core.NoteSearchResult, error) {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	results := core.SearchNotes(payload.Notes, query)
	if results == nil {
		return []core.NoteSearchResult{}, nil
	}
	return results, nil
}

// StartSessionLogging starts timestamped session recording for sessionID (F-21).
func (a *App) StartSessionLogging(sessionID string) (core.SessionLogStatus, error) {
	a.vaultStore.Touch()
	if a.logMgr == nil {
		return core.SessionLogStatus{}, errors.New("session log manager not initialized")
	}

	a.mu.Lock()
	hostID := a.sessionHostID[sessionID]
	cachedPW := a.sessionPasswords[sessionID]
	req, hasReq := a.sessionRequests[sessionID]
	a.mu.Unlock()

	hostLabel := sessionID
	if hostID != "" {
		if payload, err := a.vaultStore.GetPayload(); err == nil {
			for _, h := range payload.Hosts {
				if h.ID == hostID {
					hostLabel = h.Label
					break
				}
			}
		}
	} else if hasReq && req.Address != "" {
		hostLabel = fmt.Sprintf("%s@%s:%d", req.Username, req.Address, req.Port)
	}

	st, err := a.logMgr.StartSession(sessionID, hostID, hostLabel)
	if err != nil {
		return core.SessionLogStatus{}, err
	}
	if cachedPW != "" {
		a.logMgr.RegisterSensitiveValue(sessionID, cachedPW)
	}
	return st, nil
}

// StopSessionLogging stops and flushes the active session log for sessionID (F-21).
func (a *App) StopSessionLogging(sessionID string) (core.SessionLogStatus, error) {
	a.vaultStore.Touch()
	if a.logMgr == nil {
		return core.SessionLogStatus{}, errors.New("session log manager not initialized")
	}
	return a.logMgr.StopSession(sessionID)
}

// GetSessionLogStatus returns the current recording status for sessionID (F-21).
func (a *App) GetSessionLogStatus(sessionID string) (core.SessionLogStatus, error) {
	if a.logMgr == nil {
		return core.SessionLogStatus{SessionID: sessionID, Active: false}, nil
	}
	return a.logMgr.GetStatus(sessionID), nil
}

// ListSessionLogs returns all recorded session log entries ordered newest-first (F-21).
func (a *App) ListSessionLogs() ([]core.SessionLogRecord, error) {
	a.vaultStore.Touch()
	if a.logMgr == nil {
		return []core.SessionLogRecord{}, nil
	}
	return a.logMgr.ListRecords(), nil
}

// ReadSessionLog returns the full timestamped transcript of a recorded session log (F-21).
func (a *App) ReadSessionLog(logID string) (string, error) {
	a.vaultStore.Touch()
	if a.logMgr == nil {
		return "", errors.New("session log manager not initialized")
	}
	return a.logMgr.ReadLog(logID)
}

// DeleteSessionLog stops (if active) and removes a session log file from disk (F-21).
func (a *App) DeleteSessionLog(logID string) error {
	a.vaultStore.Touch()
	if a.logMgr == nil {
		return errors.New("session log manager not initialized")
	}
	return a.logMgr.DeleteLog(logID)
}

// ExportSessionLog exports a recorded session log to targetPath on disk (F-21).
func (a *App) ExportSessionLog(logID string, targetPath string) error {
	a.vaultStore.Touch()
	if a.logMgr == nil {
		return errors.New("session log manager not initialized")
	}
	return a.logMgr.ExportLog(logID, targetPath)
}
