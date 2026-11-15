package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"doubleagent/backend/core"
	"doubleagent/backend/data"
	"doubleagent/backend/health"
	"doubleagent/backend/pivot"
	"doubleagent/backend/pty"
	"doubleagent/backend/rawtcp"
	"doubleagent/backend/report"
	"doubleagent/backend/serial"
	"doubleagent/backend/ssh"
	"doubleagent/backend/transfer"
	"doubleagent/backend/vault"
	"doubleagent/backend/winrm"
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
	rawTcpSessions   map[string]core.RawTcpSession
	rawTcpListeners  map[string]core.RawTcpListener
	sessionHostID    map[string]string
	sessionPasswords map[string]string
	sessionRequests  map[string]core.ConnectRequest
	pendingKeys      map[string]chan bool
	sftpClients      map[string]core.SftpClient
	transferTasks    map[string]*activeTransferTask
	activeTunnels    map[string]core.ForwardTunnel
	logMgr           *core.SessionLogManager
	remoteEditMgr    *core.RemoteEditManager
	workspaceStore   data.WorkspaceStore

	pendingMergeExternalPayload *core.VaultPayload
	pendingMergeFilePath        string
	payloadFilePath             string
	chainsFilePath              string
	managedListeners            map[string]*managedListenerInstance
	fileServers                 map[string]*transfer.ManagedServer
	pivotMgr                    *pivot.Manager
	winrmMgr                    *winrm.Manager
	winrmSessions               map[string]*winrm.ManagedSession
}

type managedListenerInstance struct {
	id             string
	profileID      string
	name           string
	kind           string
	tool           string
	bindAddress    string
	port           uint16
	autoSpawnTab   bool
	rawListener    core.RawTcpListener
	startedAt      time.Time
	catchCount     int
	sessions       map[string]core.RawTcpSession
	commandPreview string
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

func vaultPointerPath() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil || cfgDir == "" {
		return ""
	}
	return filepath.Join(cfgDir, "DoubleAgent", "vault_location.txt")
}

func getEffectiveVaultPath() string {
	ptr := vaultPointerPath()
	if ptr != "" {
		if data, err := os.ReadFile(ptr); err == nil {
			trimmed := strings.TrimSpace(string(data))
			if trimmed != "" {
				return trimmed
			}
		}
	}
	return defaultVaultPath()
}

func defaultLogsDir() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil || cfgDir == "" {
		return filepath.Join(os.TempDir(), "doubleagent-logs")
	}
	return filepath.Join(cfgDir, "DoubleAgent", "logs")
}

func defaultWorkspacePath() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil || cfgDir == "" {
		return filepath.Join(os.TempDir(), "doubleagent-workspace.json")
	}
	return filepath.Join(cfgDir, "DoubleAgent", "workspace.json")
}

func defaultKnownHostsPath() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil || cfgDir == "" {
		return filepath.Join(os.TempDir(), "doubleagent-known_hosts.json")
	}
	return filepath.Join(cfgDir, "DoubleAgent", "known_hosts.json")
}

// NewApp creates a new App application struct with the default SSH transport and encrypted Vault store.
func NewApp() *App {
	kh := ssh.NewKnownHostsStoreWithPath(defaultKnownHostsPath())
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
		rawTcpSessions:   make(map[string]core.RawTcpSession),
		rawTcpListeners:  make(map[string]core.RawTcpListener),
		sessionHostID:    make(map[string]string),
		sessionPasswords: make(map[string]string),
		sessionRequests:  make(map[string]core.ConnectRequest),
		pendingKeys:      make(map[string]chan bool),
		sftpClients:      make(map[string]core.SftpClient),
		transferTasks:    make(map[string]*activeTransferTask),
		activeTunnels:    make(map[string]core.ForwardTunnel),
		logMgr:           core.NewSessionLogManager(defaultLogsDir()),
		remoteEditMgr:    core.NewRemoteEditManager(""),
		managedListeners: make(map[string]*managedListenerInstance),
		fileServers:      make(map[string]*transfer.ManagedServer),
		winrmSessions:    make(map[string]*winrm.ManagedSession),
	}

	if vaultStore == nil {
		vaultStore = vault.NewStore(vault.StoreOptions{
			FilePath:        getEffectiveVaultPath(),
			MaxBackups:      3,
			AutoLockTimeout: 15 * time.Minute,
			OnAutoLock: func() {
				app.emit(app.ctx, "vault:locked", true)
			},
		})
	}
	app.vaultStore = vaultStore
	app.workspaceStore = data.NewWorkspaceStore(defaultWorkspacePath())
	app.pivotMgr = pivot.NewManager(func(info core.PivotInstanceInfo) {
		app.emit(app.ctx, "pivot:updated", info)
	})
	app.winrmMgr = winrm.NewManager(func(info core.WinrmSessionInfo) {
		app.emit(app.ctx, "winrm:updated", info)
	})
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

// shutdown cleans up active HTTP file staging servers and remote edit staging files when closing.
func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	servers := make([]*transfer.ManagedServer, 0, len(a.fileServers))
	for _, srv := range a.fileServers {
		servers = append(servers, srv)
	}
	a.fileServers = make(map[string]*transfer.ManagedServer)
	a.mu.Unlock()

	for _, srv := range servers {
		if srv != nil {
			_ = srv.Stop(ctx)
		}
	}
	if a.pivotMgr != nil {
		a.pivotMgr.StopAll()
	}
	if a.winrmMgr != nil {
		a.winrmMgr.CloseAll()
	}
	if a.remoteEditMgr != nil {
		a.remoteEditMgr.CloseAll()
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

// GetHostPassword returns the decrypted password for a saved host from the active vault (when unlocked).
func (a *App) GetHostPassword(hostID string) (string, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return "", err
	}
	resolved, err := core.ResolveEffectiveHost(hostID, payload)
	if err != nil {
		return "", err
	}
	return resolved.Auth.Password, nil
}

// GetIdentityPassword returns the decrypted password for an identity ID from the active vault.
func (a *App) GetIdentityPassword(identityID string) (string, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return "", err
	}
	for _, id := range payload.Identities {
		if id.ID == identityID {
			return id.Password, nil
		}
	}
	return "", errors.New("identity not found")
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

func (a *App) annotateExistingHosts(res *core.ImportScanResult) {
	if res == nil || len(res.Hosts) == 0 {
		return
	}
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return
	}
	existingAddr := make(map[string]bool)
	existingLabel := make(map[string]bool)
	for _, h := range payload.Hosts {
		existingAddr[strings.ToLower(strings.TrimSpace(h.Address))] = true
		existingLabel[strings.ToLower(strings.TrimSpace(h.Label))] = true
	}
	for i := range res.Hosts {
		addr := strings.ToLower(strings.TrimSpace(res.Hosts[i].Address))
		lbl := strings.ToLower(strings.TrimSpace(res.Hosts[i].Label))
		if existingAddr[addr] || existingLabel[lbl] {
			res.Hosts[i].AlreadyExist = true
		}
	}
}

// ScanLocalPuTTYSessions scans local PuTTY sessions from Windows Registry or ~/.putty (F-30).
func (a *App) ScanLocalPuTTYSessions() (core.ImportScanResult, error) {
	res, err := core.ScanLocalPuTTYSessions()
	if err != nil {
		return res, err
	}
	a.annotateExistingHosts(&res)
	return res, nil
}

// ParsePuTTYRegContent parses .reg file content for PuTTY sessions (F-30).
func (a *App) ParsePuTTYRegContent(content string) (core.ImportScanResult, error) {
	res := core.ParsePuTTYRegContent(content)
	a.annotateExistingHosts(&res)
	return res, nil
}

// ParseTermiusContent parses Termius JSON or CSV export content (F-30).
func (a *App) ParseTermiusContent(content string) (core.ImportScanResult, error) {
	trimmed := strings.TrimSpace(content)
	var res core.ImportScanResult
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		res = core.ParseTermiusJSON(content)
	} else {
		res = core.ParseTermiusCSV(content)
	}
	a.annotateExistingHosts(&res)
	return res, nil
}

// ExecuteImport imports the selected items into DoubleAgent's encrypted vault (F-30).
func (a *App) ExecuteImport(options core.ImportExecuteOptions) (core.ImportExecuteResult, error) {
	var result core.ImportExecuteResult
	if len(options.SelectedHosts) == 0 {
		return result, nil
	}

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return result, err
	}

	nowNano := time.Now().UTC().UnixNano()
	groupMap := make(map[string]string)
	for _, g := range payload.Groups {
		groupMap[strings.ToLower(strings.TrimSpace(g.Name))] = g.ID
	}

	// Helper to find or create group
	ensureGroup := func(groupName string) string {
		trimmed := strings.TrimSpace(groupName)
		if trimmed == "" {
			return ""
		}
		lower := strings.ToLower(trimmed)
		if gid, ok := groupMap[lower]; ok {
			return gid
		}
		newGID := fmt.Sprintf("grp-import-%d-%d", nowNano, result.GroupsCreated+1)
		payload.Groups = append(payload.Groups, core.GroupRecord{
			ID:   newGID,
			Name: trimmed,
		})
		groupMap[lower] = newGID
		result.GroupsCreated++
		return newGID
	}

	// If a default group is specified, ensure it
	var defaultGroupID string
	if options.DefaultGroup != "" {
		defaultGroupID = ensureGroup(options.DefaultGroup)
	}

	for idx, entry := range options.SelectedHosts {
		idSuffix := fmt.Sprintf("%d-%d", nowNano, idx)
		user := entry.Username
		if user == "" {
			user = "root"
		}

		targetGroupID := defaultGroupID
		if entry.Group != "" {
			targetGroupID = ensureGroup(entry.Group)
		}

		identityID := fmt.Sprintf("id-imp-%s", idSuffix)
		authMethod := core.AuthAgent
		var keyID string

		// If KeyPath is given, expand and attempt import
		if entry.KeyPath != "" && options.ImportKeys {
			expandedPath := entry.KeyPath
			if len(expandedPath) >= 2 && expandedPath[:2] == "~/" {
				if home, err := os.UserHomeDir(); err == nil {
					expandedPath = filepath.Join(home, expandedPath[2:])
				}
			}
			if rawKeyBytes, err := os.ReadFile(expandedPath); err == nil {
				keyLabel := entry.Label + " Key"
				if keyRec, err := ssh.ImportPrivateKey(keyLabel, string(rawKeyBytes), ""); err == nil {
					payload.Keys = append(payload.Keys, keyRec)
					keyID = keyRec.ID
					authMethod = core.AuthPrivateKey
					result.KeysImported++
				} else {
					result.Warnings = append(result.Warnings, fmt.Sprintf("Key for %q could not be parsed: %v", entry.Label, err))
				}
			} else {
				result.Warnings = append(result.Warnings, fmt.Sprintf("Key file %q for %q not readable: %v", entry.KeyPath, entry.Label, err))
			}
		}

		payload.Identities = append(payload.Identities, core.IdentityRecord{
			ID:         identityID,
			Label:      entry.Label + " Identity",
			Username:   user,
			AuthMethod: authMethod,
			KeyID:      keyID,
			Password:   entry.Password,
		})

		hostID := fmt.Sprintf("host-imp-%s", idSuffix)
		payload.Hosts = append(payload.Hosts, core.HostRecord{
			ID:           hostID,
			GroupID:      targetGroupID,
			Label:        entry.Label,
			Address:      entry.Address,
			Port:         entry.Port,
			IdentityID:   identityID,
			Tags:         entry.Tags,
			ProxyCommand: entry.ProxyCommand,
		})
		result.HostsImported++

		// Import forward rules
		for fIdx, rule := range entry.ForwardRules {
			fwdID := fmt.Sprintf("fwd-imp-%s-%d", idSuffix, fIdx)
			payload.ForwardRules = append(payload.ForwardRules, core.ForwardRule{
				ID:          fwdID,
				HostID:      hostID,
				Type:        core.ForwardRuleType(rule.Type),
				BindAddress: "127.0.0.1",
				BindPort:    rule.BindPort,
				TargetHost:  rule.TargetHost,
				TargetPort:  rule.TargetPort,
				Label:       fmt.Sprintf("%s-%s%d", entry.Label, rule.Type, rule.BindPort),
			})
			result.TunnelsConfigured++
		}
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return result, fmt.Errorf("save vault payload: %w", err)
	}

	return result, nil
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
	} else if req.KeyID != "" {
		if payload, err := a.vaultStore.GetPayload(); err == nil {
			for _, k := range payload.Keys {
				if k.ID == req.KeyID {
					authCfg = core.SshAuthConfig{
						Method:     core.AuthPrivateKey,
						PrivateKey: []byte(k.PrivateKey),
						Passphrase: k.Passphrase,
					}
					if req.Passphrase != "" {
						authCfg.Passphrase = req.Passphrase
					}
					break
				}
			}
		}
		if authCfg.Method == "" {
			return "", fmt.Errorf("ssh key %s not found in vault", req.KeyID)
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
	rawSess, isRawTcp := a.rawTcpSessions[targetSessionID]
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

	if isRawTcp && rawSess != nil {
		stats := rawSess.Stats()
		if stats.IsListener {
			return "", errors.New("cannot duplicate incoming reverse shell session")
		}
		host, portStr, err := net.SplitHostPort(stats.RemoteAddr)
		if err != nil {
			return "", err
		}
		var port uint16
		_, _ = fmt.Sscanf(portStr, "%d", &port)
		return a.ConnectRawTcp(core.RawTcpConfig{
			Host:       host,
			Port:       port,
			LineMode:   stats.LineMode,
			LineEnding: stats.LineEnding,
		})
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

// ConnectRawTcp opens an outgoing raw TCP client socket session (F-31).
func (a *App) ConnectRawTcp(cfg core.RawTcpConfig) (string, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	sess, err := rawtcp.Dial(ctx, cfg)
	if err != nil {
		return "", err
	}

	sessionID := sess.ID()
	a.mu.Lock()
	a.rawTcpSessions[sessionID] = sess
	a.mu.Unlock()

	go a.streamReaderLoop(sessionID, sess, true)
	return sessionID, nil
}

// StartRawTcpListener starts a local TCP listener to catch incoming connections / reverse shells (F-31).
func (a *App) StartRawTcpListener(cfg core.RawTcpListenerConfig) (core.RawTcpListenerInfo, error) {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	listener, err := rawtcp.Listen(ctx, cfg, func(sess core.RawTcpSession) {
		sessionID := sess.ID()
		a.mu.Lock()
		a.rawTcpSessions[sessionID] = sess
		a.mu.Unlock()

		go a.streamReaderLoop(sessionID, sess, true)

		stats := sess.Stats()
		a.emit(a.ctx, "raw-tcp:incoming", core.RawTcpIncomingEvent{
			SessionID:    sessionID,
			ListenerPort: stats.ListenerPort,
			RemoteAddr:   stats.RemoteAddr,
		})
	})
	if err != nil {
		return core.RawTcpListenerInfo{}, err
	}

	a.mu.Lock()
	a.rawTcpListeners[listener.ID()] = listener
	a.mu.Unlock()

	return listener.Info(), nil
}

// StopRawTcpListener stops an active raw TCP listener by ID (F-31).
func (a *App) StopRawTcpListener(listenerID string) error {
	a.mu.Lock()
	listener, ok := a.rawTcpListeners[listenerID]
	delete(a.rawTcpListeners, listenerID)
	a.mu.Unlock()

	if !ok || listener == nil {
		return errors.New("listener not found")
	}
	return listener.Close()
}

// ListRawTcpListeners returns information on all registered TCP listeners (F-31).
func (a *App) ListRawTcpListeners() []core.RawTcpListenerInfo {
	a.mu.Lock()
	defer a.mu.Unlock()

	list := make([]core.RawTcpListenerInfo, 0, len(a.rawTcpListeners))
	for _, l := range a.rawTcpListeners {
		if l != nil {
			list = append(list, l.Info())
		}
	}
	return list
}

// GetRawTcpSessionStats retrieves the real-time byte telemetry and settings of a raw TCP session (F-31).
func (a *App) GetRawTcpSessionStats(sessionID string) (*core.RawTcpSessionStats, error) {
	a.mu.Lock()
	sess, ok := a.rawTcpSessions[sessionID]
	a.mu.Unlock()

	if !ok || sess == nil {
		return nil, core.ErrSessionNotFound
	}
	stats := sess.Stats()
	return &stats, nil
}

// SetRawTcpSessionLineMode toggles line buffering and line endings for a raw TCP session (F-31).
func (a *App) SetRawTcpSessionLineMode(sessionID string, lineMode bool, lineEnding string) error {
	a.mu.Lock()
	sess, ok := a.rawTcpSessions[sessionID]
	a.mu.Unlock()

	if !ok || sess == nil {
		return core.ErrSessionNotFound
	}
	sess.SetLineMode(lineMode)
	sess.SetLineEnding(lineEnding)
	return nil
}

// GetShellStabilizePresets returns built-in F-34 shell stabilization presets.
func (a *App) GetShellStabilizePresets() []core.ShellStabilizePreset {
	return core.DefaultShellStabilizePresets()
}

// ScanNmapXML parses Nmap XML (-oX) and returns structured preview metrics (F-39).
func (a *App) ScanNmapXML(xmlContent string) (*core.NmapScanResult, error) {
	a.vaultStore.Touch()
	return core.ParseNmapXML([]byte(xmlContent))
}

// ImportNmapXML parses and imports Nmap scan results into DoubleAgent's encrypted vault (F-39).
func (a *App) ImportNmapXML(req core.NmapImportRequest) (*core.NmapImportSummary, error) {
	a.vaultStore.Touch()

	parsed, err := core.ParseNmapXML([]byte(req.XMLContent))
	if err != nil {
		return nil, err
	}

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	summary, err := core.ImportNmapScan(&payload, parsed, req.Options)
	if err != nil {
		return nil, err
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	if err := a.vaultStore.SavePayload(ctx, payload); err != nil {
		return nil, fmt.Errorf("failed to save imported Nmap scan into vault: %w", err)
	}

	a.emit(a.ctx, "vault:updated", map[string]any{
		"action":       "nmap:import",
		"createdHosts": summary.CreatedHosts,
		"updatedHosts": summary.UpdatedHosts,
		"createdNotes": summary.CreatedNotes,
	})

	return summary, nil
}

// StabilizeShell upgrades a raw shell session into a fully interactive PTY terminal (F-34).
func (a *App) StabilizeShell(req core.ShellStabilizeRequest) error {
	a.vaultStore.Touch()

	steps, err := core.BuildShellStabilizeSteps(req)
	if err != nil {
		return err
	}

	a.mu.Lock()
	locSess, isLocal := a.localSessions[req.SessionID]
	serPort, isSerial := a.serialSessions[req.SessionID]
	rawSess, isRawTcp := a.rawTcpSessions[req.SessionID]
	streams, isSSH := a.activeStreams[req.SessionID]
	a.mu.Unlock()

	exists := (isLocal && locSess != nil) ||
		(isSerial && serPort != nil) ||
		(isRawTcp && rawSess != nil) ||
		(isSSH && streams != nil && streams.Stdin != nil)
	if !exists {
		return core.ErrSessionNotFound
	}

	// For Raw TCP reverse shell tabs, disable line-buffering so interactive PTY keys stream immediately.
	if isRawTcp && rawSess != nil {
		rawSess.SetLineMode(false)
		rawSess.SetLineEnding("\n")
	}

	go func() {
		for _, step := range steps {
			if step.DelayMs > 0 {
				time.Sleep(time.Duration(step.DelayMs) * time.Millisecond)
			}
			if writeErr := a.WriteTerminal(req.SessionID, step.Data); writeErr != nil {
				return
			}
		}
		a.emit(a.ctx, "shell:stabilized", map[string]any{
			"sessionId": req.SessionID,
			"method":    req.Method,
			"mode":      req.Mode,
		})
	}()

	return nil
}

// WriteTerminal writes user keystrokes from xterm.js into the active SSH, local shell, serial port, or raw TCP socket (F-07, F-23, F-31).
func (a *App) WriteTerminal(sessionID string, data string) error {
	a.vaultStore.Touch()
	if a.logMgr != nil {
		a.logMgr.NotifyInput(sessionID, data)
	}
	a.mu.Lock()
	locSess, isLocal := a.localSessions[sessionID]
	serPort, isSerial := a.serialSessions[sessionID]
	rawSess, isRawTcp := a.rawTcpSessions[sessionID]
	winrmSess, isWinrm := a.winrmSessions[sessionID]
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
	if isRawTcp && rawSess != nil {
		_, err := rawSess.Write([]byte(data))
		return err
	}
	if isWinrm && winrmSess != nil {
		_, err := winrmSess.Write([]byte(data))
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
	_, isRawTcp := a.rawTcpSessions[sessionID]
	_, isWinrm := a.winrmSessions[sessionID]
	a.mu.Unlock()

	if isLocal && locSess != nil {
		return locSess.Resize(core.TerminalSize{Cols: cols, Rows: rows})
	}
	if isSerial || isRawTcp || isWinrm {
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

// DisconnectSession closes the active SSH session, local shell, serial port, or raw TCP socket and removes its stream reference.
func (a *App) DisconnectSession(sessionID string) error {
	a.mu.Lock()
	locSess, isLocal := a.localSessions[sessionID]
	delete(a.localSessions, sessionID)
	serPort, isSerial := a.serialSessions[sessionID]
	delete(a.serialSessions, sessionID)
	rawSess, isRawTcp := a.rawTcpSessions[sessionID]
	delete(a.rawTcpSessions, sessionID)
	winrmSess, isWinrm := a.winrmSessions[sessionID]
	delete(a.winrmSessions, sessionID)
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
	if isRawTcp && rawSess != nil {
		return rawSess.Close()
	}
	if isWinrm && winrmSess != nil {
		if a.winrmMgr != nil {
			return a.winrmMgr.Close(sessionID)
		}
		return winrmSess.Close()
	}
	return a.transport.Disconnect(a.ctx, sessionID)
}

// CheckSessionAlive reports whether an SSH shell, local shell, serial, raw TCP, or WinRM session is active.
func (a *App) CheckSessionAlive(sessionID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.activeStreams[sessionID]; ok {
		return true
	}
	if _, ok := a.localSessions[sessionID]; ok {
		return true
	}
	if _, ok := a.serialSessions[sessionID]; ok {
		return true
	}
	if _, ok := a.rawTcpSessions[sessionID]; ok {
		return true
	}
	if _, ok := a.winrmSessions[sessionID]; ok {
		return true
	}
	return false
}

// GetLiveSessionIDs returns all currently active session IDs across SSH, local, serial, raw TCP, and WinRM connections.
func (a *App) GetLiveSessionIDs() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	ids := make([]string, 0, len(a.activeStreams)+len(a.localSessions)+len(a.serialSessions)+len(a.rawTcpSessions)+len(a.winrmSessions))
	for id := range a.activeStreams {
		ids = append(ids, id)
	}
	for id := range a.localSessions {
		ids = append(ids, id)
	}
	for id := range a.serialSessions {
		ids = append(ids, id)
	}
	for id := range a.rawTcpSessions {
		ids = append(ids, id)
	}
	for id := range a.winrmSessions {
		ids = append(ids, id)
	}
	return ids
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
				delete(a.rawTcpSessions, sessionID)
				delete(a.winrmSessions, sessionID)
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

// StartRemoteEdit downloads a remote file to a local staging cache and begins tracking its lifecycle (F-28).
func (a *App) StartRemoteEdit(sessionID string, remotePath string) (core.RemoteEditSession, error) {
	client, err := a.getOrOpenSftp(sessionID)
	if err != nil {
		return core.RemoteEditSession{}, fmt.Errorf("open sftp for session: %w", err)
	}

	sess, err := a.remoteEditMgr.StartEdit(a.ctx, client, sessionID, remotePath)
	if err != nil {
		return core.RemoteEditSession{}, err
	}

	// Start local file watcher to auto-sync external editor saves
	_ = a.remoteEditMgr.StartWatcher(sess.ID, func(editID string) {
		res, syncErr := a.remoteEditMgr.AutoSyncLocalFile(a.ctx, client, editID)
		if syncErr != nil {
			a.emit(a.ctx, "remote-edit:changed", core.RemoteEditEvent{
				EditSessionID: editID,
				Status:        core.RemoteEditStatusConflict,
				HasConflict:   true,
				Message:       syncErr.Error(),
			})
			return
		}
		a.emit(a.ctx, "remote-edit:changed", core.RemoteEditEvent{
			EditSessionID: editID,
			Status:        core.RemoteEditStatusActive,
			HasConflict:   false,
			Message:       res.Message,
		})
	})

	return *sess, nil
}

// GetRemoteEditContent reads the staged local copy of an edited remote file (F-28).
func (a *App) GetRemoteEditContent(editID string) (string, error) {
	return a.remoteEditMgr.ReadContent(editID)
}

// SaveRemoteEditContent updates the local staged file and uploads to the remote server, validating conflicts (F-28).
func (a *App) SaveRemoteEditContent(editID string, content string, force bool) (core.RemoteEditResult, error) {
	sess, err := a.remoteEditMgr.GetSession(editID)
	if err != nil {
		return core.RemoteEditResult{}, err
	}
	client, err := a.getOrOpenSftp(sess.SessionID)
	if err != nil {
		return core.RemoteEditResult{}, fmt.Errorf("open sftp for session: %w", err)
	}

	res, err := a.remoteEditMgr.SaveContent(a.ctx, client, editID, content, force)
	if err != nil {
		if res != nil {
			return *res, err
		}
		return core.RemoteEditResult{}, err
	}

	a.emit(a.ctx, "remote-edit:status", core.RemoteEditEvent{
		EditSessionID: editID,
		Status:        core.RemoteEditStatusActive,
		HasConflict:   false,
		Message:       res.Message,
	})

	return *res, nil
}

// CheckRemoteConflict checks if the remote server file was modified in parallel by another process/user (F-28).
func (a *App) CheckRemoteConflict(editID string) (core.RemoteConflictInfo, error) {
	sess, err := a.remoteEditMgr.GetSession(editID)
	if err != nil {
		return core.RemoteConflictInfo{}, err
	}
	client, err := a.getOrOpenSftp(sess.SessionID)
	if err != nil {
		return core.RemoteConflictInfo{}, fmt.Errorf("open sftp for session: %w", err)
	}
	info, err := a.remoteEditMgr.CheckConflict(a.ctx, client, editID)
	if err != nil {
		return core.RemoteConflictInfo{}, err
	}
	return *info, nil
}

// OpenExternalEditor launches the local staged file in the user's OS default editor (F-28).
func (a *App) OpenExternalEditor(editID string) error {
	sess, err := a.remoteEditMgr.GetSession(editID)
	if err != nil {
		return err
	}
	localPath := sess.LocalPath

	var cmd *exec.Cmd
	if goruntime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe", "/c", "start", "", localPath)
	} else {
		cmd = exec.Command("xdg-open", localPath)
	}
	return cmd.Start()
}

// CloseRemoteEdit cleans up the local staging directory and stops background watchers (F-28).
func (a *App) CloseRemoteEdit(editID string) error {
	return a.remoteEditMgr.Close(editID)
}

// ListActiveRemoteEdits returns all currently active remote file editing sessions (F-28).
func (a *App) ListActiveRemoteEdits() []core.RemoteEditSession {
	return a.remoteEditMgr.ListSessions()
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
	ruleHostMap := make(map[string]string)
	if a.vaultStore != nil {
		if payload, err := a.vaultStore.GetPayload(); err == nil {
			for _, r := range payload.ForwardRules {
				if r.HostID != "" {
					ruleHostMap[r.ID] = r.HostID
				}
			}
		}
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	result := make([]core.ForwardTunnelStatus, 0, len(a.activeTunnels))
	for _, tun := range a.activeTunnels {
		if tun != nil {
			st := tun.GetStatus()
			if st.HostID == "" {
				if hid, ok := a.sessionHostID[st.SessionID]; ok && hid != "" {
					st.HostID = hid
				} else if rhid, ok := ruleHostMap[st.RuleID]; ok && rhid != "" {
					st.HostID = rhid
				}
			}
			result = append(result, st)
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

// SaveSnippetChain saves or updates a multi-stage snippet chain in the vault (Spec F-16).
func (a *App) SaveSnippetChain(chain core.SnippetChain) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	if chain.ID == "" {
		chain.ID = fmt.Sprintf("chain-%d", time.Now().UnixNano())
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if chain.CreatedAt == "" {
		chain.CreatedAt = now
	}
	chain.UpdatedAt = now

	for i := range chain.Steps {
		if chain.Steps[i].ID == "" {
			chain.Steps[i].ID = fmt.Sprintf("step-%d-%d", time.Now().UnixNano(), i+1)
		}
	}

	if err := core.ValidateSnippetChain(chain); err != nil {
		return err
	}

	if payload.SnippetChains == nil {
		payload.SnippetChains = []core.SnippetChain{}
	}

	updated := false
	for i := range payload.SnippetChains {
		if payload.SnippetChains[i].ID == chain.ID {
			payload.SnippetChains[i] = chain
			updated = true
			break
		}
	}
	if !updated {
		payload.SnippetChains = append(payload.SnippetChains, chain)
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", core.BuildVaultSummary(payload))
	return nil
}

// DeleteSnippetChain deletes a snippet chain by ID from the vault (F-16).
func (a *App) DeleteSnippetChain(chainID string) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	filtered := make([]core.SnippetChain, 0, len(payload.SnippetChains))
	for _, c := range payload.SnippetChains {
		if c.ID != chainID {
			filtered = append(filtered, c)
		}
	}
	payload.SnippetChains = filtered

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", core.BuildVaultSummary(payload))
	return nil
}

// ListSnippetChains returns all custom and built-in snippet chains filtered by hostID (F-16).
func (a *App) ListSnippetChains(hostID string) ([]core.SnippetChain, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	// Start with built-in presets
	presets := core.GetBuiltinSnippetChains()
	chainMap := make(map[string]core.SnippetChain, len(presets)+len(payload.SnippetChains))
	for _, p := range presets {
		chainMap[p.ID] = p
	}

	// Overlay user vault chains (can override or add)
	for _, c := range payload.SnippetChains {
		chainMap[c.ID] = c
	}

	allChains := make([]core.SnippetChain, 0, len(chainMap))
	for _, c := range chainMap {
		allChains = append(allChains, c)
	}

	// Look up host OS if hostID is given
	targetOS := ""
	if hostID != "" {
		for _, h := range payload.Hosts {
			if h.ID == hostID {
				for _, t := range h.Tags {
					tLower := strings.ToLower(t)
					if tLower == "linux" || tLower == "windows" {
						targetOS = tLower
						break
					}
				}
				break
			}
		}
	}

	return core.FilterSnippetChains(allChains, hostID, targetOS), nil
}

// GetSnippetChainVariables returns the unique extracted variables across all steps of a chain (F-16).
func (a *App) GetSnippetChainVariables(chainID string) ([]core.SnippetVariable, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	var targetChain *core.SnippetChain
	for _, c := range payload.SnippetChains {
		if c.ID == chainID {
			targetChain = &c
			break
		}
	}
	if targetChain == nil {
		for _, p := range core.GetBuiltinSnippetChains() {
			if p.ID == chainID {
				targetChain = &p
				break
			}
		}
	}
	if targetChain == nil {
		return nil, fmt.Errorf("snippet chain %q not found", chainID)
	}

	return core.ExtractChainVariables(*targetChain), nil
}

// ResolveSnippetChainStep resolves the command template for a specific step index in a chain (F-16).
func (a *App) ResolveSnippetChainStep(chainID string, stepIndex int, sessionID string, userValues map[string]string) (string, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return "", err
	}

	var targetChain *core.SnippetChain
	for _, c := range payload.SnippetChains {
		if c.ID == chainID {
			targetChain = &c
			break
		}
	}
	if targetChain == nil {
		for _, p := range core.GetBuiltinSnippetChains() {
			if p.ID == chainID {
				targetChain = &p
				break
			}
		}
	}
	if targetChain == nil {
		return "", fmt.Errorf("snippet chain %q not found", chainID)
	}

	if stepIndex < 0 || stepIndex >= len(targetChain.Steps) {
		return "", fmt.Errorf("step index %d out of bounds (chain has %d steps)", stepIndex, len(targetChain.Steps))
	}

	step := targetChain.Steps[stepIndex]
	snipCtx := a.GetSnippetContext(sessionID)

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

		for _, id := range payload.Identities {
			if id.ID == ref || strings.EqualFold(id.Label, ref) {
				if id.Password != "" {
					return id.Password, nil
				}
			}
		}
		for _, c := range payload.Credentials {
			if c.ID == ref || strings.EqualFold(c.Label, ref) {
				if c.Secret != "" {
					return c.Secret, nil
				}
			}
		}
		return "", fmt.Errorf("secret reference %q not found in vault", ref)
	}

	snippetLookup := func(snippetID string) (*core.Snippet, error) {
		for _, s := range payload.Snippets {
			if s.ID == snippetID {
				return &s, nil
			}
		}
		return nil, nil
	}

	return core.ResolveChainStep(step, snipCtx, userValues, secretResolver, snippetLookup)
}

// ExecuteSnippetChainStep resolves and writes a step's command directly into the active session stdin (F-16).
func (a *App) ExecuteSnippetChainStep(sessionID string, chainID string, stepIndex int, userValues map[string]string) error {
	a.vaultStore.Touch()

	resolvedCmd, err := a.ResolveSnippetChainStep(chainID, stepIndex, sessionID, userValues)
	if err != nil {
		return err
	}

	return a.WriteTerminal(sessionID, resolvedCmd+"\n")
}

func (a *App) getChainsFilePath() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.chainsFilePath != "" {
		return a.chainsFilePath
	}
	return core.ResolveChainsFilePath("")
}

// GetSnippetChainsConfig returns the status of the external snippet chains file (F-16/F-33).
func (a *App) GetSnippetChainsConfig() (*core.SnippetChainsFileConfig, error) {
	p := a.getChainsFilePath()
	cfg := core.GetSnippetChainsFileConfig(p)
	return &cfg, nil
}

// SetSnippetChainsPath configures a custom filesystem path for snippet chains (F-16).
// If a folder/directory is specified, it automatically resolves to snippet_chains.json in that folder.
func (a *App) SetSnippetChainsPath(customPath string) (*core.SnippetChainsFileConfig, error) {
	clean := core.ResolveChainsFilePath(customPath)
	if clean == "" {
		return nil, errors.New("snippet chains path must not be empty")
	}

	a.mu.Lock()
	a.chainsFilePath = clean
	a.mu.Unlock()

	_, err := core.LoadSnippetChainsFromFile(clean)
	if err != nil {
		return nil, err
	}

	cfg := core.GetSnippetChainsFileConfig(clean)
	return &cfg, nil
}

// ListSnippetChainsFromFile loads snippet chains from the external JSON file (F-16).
func (a *App) ListSnippetChainsFromFile() ([]core.SnippetChain, error) {
	p := a.getChainsFilePath()
	return core.LoadSnippetChainsFromFile(p)
}

// SaveSnippetChainToFile creates or updates a chain in the external JSON file (F-16).
func (a *App) SaveSnippetChainToFile(chain core.SnippetChain) error {
	if err := core.ValidateSnippetChain(chain); err != nil {
		return err
	}
	p := a.getChainsFilePath()
	chains, err := core.LoadSnippetChainsFromFile(p)
	if err != nil {
		return err
	}
	updated := false
	for i, c := range chains {
		if c.ID == chain.ID {
			chains[i] = chain
			updated = true
			break
		}
	}
	if !updated {
		if chain.ID == "" {
			chain.ID = fmt.Sprintf("chain-%d", time.Now().UnixNano())
		}
		chains = append(chains, chain)
	}
	return core.SaveSnippetChainsToFile(p, chains)
}

// DeleteSnippetChainFromFile removes a snippet chain from the external JSON file (F-16).
func (a *App) DeleteSnippetChainFromFile(chainID string) error {
	p := a.getChainsFilePath()
	chains, err := core.LoadSnippetChainsFromFile(p)
	if err != nil {
		return err
	}
	var filtered []core.SnippetChain
	for _, c := range chains {
		if c.ID != chainID {
			filtered = append(filtered, c)
		}
	}
	return core.SaveSnippetChainsToFile(p, filtered)
}

// SelectFileDialog opens a native file chooser dialog (Wails runtime) and returns the selected path.
func (a *App) SelectFileDialog(title string, filterName string, filterPattern string) (string, error) {
	if a.ctx == nil {
		return "", errors.New("application context not initialized")
	}
	pattern := filterPattern
	if pattern == "" {
		pattern = "*.json"
	}
	name := filterName
	if name == "" {
		name = "JSON Files"
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
		Filters: []runtime.FileFilter{
			{DisplayName: fmt.Sprintf("%s (%s)", name, pattern), Pattern: pattern},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
}

// SelectDirectoryDialog opens a native folder chooser dialog (Wails runtime) and returns the selected directory path.
func (a *App) SelectDirectoryDialog(title string) (string, error) {
	if a.ctx == nil {
		return "", errors.New("application context not initialized")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
	})
}

func (a *App) getPayloadFilePath() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.payloadFilePath != "" {
		return a.payloadFilePath
	}
	return core.ResolveDefaultPayloadFilePath("")
}

// GetPayloadTemplatesConfig returns the filesystem configuration and status of the external templates file (F-33).
func (a *App) GetPayloadTemplatesConfig() (*core.PayloadFileConfig, error) {
	p := a.getPayloadFilePath()
	cfg := core.GetPayloadFileConfig(p)
	return &cfg, nil
}

// SetPayloadTemplatesPath sets a custom filesystem path for the external payload templates file (F-33).
// If a folder or directory is specified, it automatically resolves to payload_templates.json inside that folder.
func (a *App) SetPayloadTemplatesPath(customPath string) (*core.PayloadFileConfig, error) {
	clean := core.ResolveDefaultPayloadFilePath(customPath)
	if clean == "" {
		return nil, errors.New("payload templates path must not be empty")
	}

	a.mu.Lock()
	a.payloadFilePath = clean
	a.mu.Unlock()

	_, err := core.LoadPayloadTemplates(clean)
	if err != nil {
		return nil, err
	}

	cfg := core.GetPayloadFileConfig(clean)
	return &cfg, nil
}

// ListPayloadTemplates loads all payload templates from the external JSON file (F-33).
// No commands are stored in the Go executable; all templates are loaded dynamically from this file.
func (a *App) ListPayloadTemplates() ([]core.PayloadTemplate, error) {
	p := a.getPayloadFilePath()
	return core.LoadPayloadTemplates(p)
}

// SavePayloadTemplate creates or updates a payload template in the external templates file (F-33).
func (a *App) SavePayloadTemplate(tmpl core.PayloadTemplate) error {
	tmpl.Name = strings.TrimSpace(tmpl.Name)
	if tmpl.Name == "" {
		return errors.New("template name is required")
	}
	if strings.TrimSpace(tmpl.Command) == "" {
		return core.ErrEmptyPayloadCommand
	}
	if tmpl.ID == "" {
		tmpl.ID = fmt.Sprintf("tmpl-%d", time.Now().UnixNano())
	}
	if tmpl.OS == "" {
		tmpl.OS = "any"
	}
	if tmpl.Shell == "" {
		tmpl.Shell = "bash"
	}
	if tmpl.Kind == "" {
		tmpl.Kind = "reverse"
	}

	p := a.getPayloadFilePath()
	templates, err := core.LoadPayloadTemplates(p)
	if err != nil {
		return err
	}

	updated := false
	for i := range templates {
		if templates[i].ID == tmpl.ID {
			templates[i] = tmpl
			updated = true
			break
		}
	}
	if !updated {
		templates = append(templates, tmpl)
	}

	return core.SavePayloadTemplates(p, templates)
}

// DeletePayloadTemplate removes a payload template by ID from the external templates file (F-33).
func (a *App) DeletePayloadTemplate(templateID string) error {
	p := a.getPayloadFilePath()
	templates, err := core.LoadPayloadTemplates(p)
	if err != nil {
		return err
	}

	filtered := make([]core.PayloadTemplate, 0, len(templates))
	for _, t := range templates {
		if t.ID != templateID {
			filtered = append(filtered, t)
		}
	}

	return core.SavePayloadTemplates(p, filtered)
}

// RenderPayload generates the shell command from a template with LHOST, LPORT, and encoding applied (F-33).
func (a *App) RenderPayload(opts core.PayloadRenderOptions) (*core.PayloadRenderResult, error) {
	p := a.getPayloadFilePath()
	templates, err := core.LoadPayloadTemplates(p)
	if err != nil {
		return nil, err
	}

	var target *core.PayloadTemplate
	for i := range templates {
		if templates[i].ID == opts.TemplateID {
			target = &templates[i]
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("%w: %s", core.ErrTemplateNotFound, opts.TemplateID)
	}

	return core.RenderPayload(*target, opts)
}

// SavePayloadAsSnippet renders a payload and saves it into the vault as a reusable snippet (F-33, F-15).
func (a *App) SavePayloadAsSnippet(opts core.PayloadRenderOptions, snippetName string) (*core.Snippet, error) {
	p := a.getPayloadFilePath()
	templates, err := core.LoadPayloadTemplates(p)
	if err != nil {
		return nil, err
	}

	var target *core.PayloadTemplate
	for i := range templates {
		if templates[i].ID == opts.TemplateID {
			target = &templates[i]
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("%w: %s", core.ErrTemplateNotFound, opts.TemplateID)
	}

	rendered, err := core.RenderPayload(*target, opts)
	if err != nil {
		return nil, err
	}

	snip := core.PayloadToSnippet(*target, rendered.Rendered, snippetName)
	if err := a.SaveSnippet(snip); err != nil {
		return nil, err
	}

	return &snip, nil
}

// ListListenerProfiles returns all saved listener profiles from the vault (F-32).
// Seeds with standard built-in stealth listener profiles if none exist yet.
func (a *App) ListListenerProfiles() ([]core.ListenerProfile, error) {
	st, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return core.DefaultBuiltinListenerProfiles(), nil
	}
	profiles, err := st.ListListenerProfiles()
	if err != nil {
		return nil, err
	}
	if len(profiles) == 0 {
		return core.DefaultBuiltinListenerProfiles(), nil
	}
	return profiles, nil
}

// SaveListenerProfile creates or updates a listener profile in the encrypted vault (F-32).
func (a *App) SaveListenerProfile(profile core.ListenerProfile) error {
	profile.Name = strings.TrimSpace(profile.Name)
	if profile.Name == "" {
		return errors.New("listener name cannot be empty")
	}
	if profile.ID == "" {
		profile.ID = fmt.Sprintf("prof-listener-%d", time.Now().UnixNano())
	}
	if profile.BindAddress == "" {
		profile.BindAddress = "0.0.0.0"
	}
	if profile.BindPort == 0 {
		profile.BindPort = 443
	}
	if profile.Kind == "" {
		profile.Kind = "reverse"
	}
	if profile.Tool == "" {
		profile.Tool = "builtin"
	}
	if profile.CreatedAt == "" {
		profile.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	st, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return errors.New("vault store not available")
	}
	if err := st.SaveListenerProfile(profile); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DeleteListenerProfile removes a saved listener profile from the vault (F-32).
func (a *App) DeleteListenerProfile(profileID string) error {
	st, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return errors.New("vault store not available")
	}
	if err := st.DeleteListenerProfile(profileID); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// StartManagedListener launches an operational reverse/bind listener (F-32).
// For 'builtin', starts a native background raw TCP socket listener.
// For external CLI tools ('nc', 'rlwrap', 'ncat-ssl', 'socat'), initializes a managed profile entry with live command preview.
func (a *App) StartManagedListener(profile core.ListenerProfile) (*core.ManagedListenerInfo, error) {
	if err := core.ValidateListenerProfile(profile); err != nil {
		return nil, err
	}

	tool := strings.ToLower(strings.TrimSpace(profile.Tool))
	if tool == "" {
		tool = "builtin"
	}
	bindAddr := strings.TrimSpace(profile.BindAddress)
	if bindAddr == "" {
		bindAddr = "0.0.0.0"
	}
	port := profile.BindPort
	if port == 0 {
		port = 443
	}

	a.mu.Lock()
	// Check if this port is already in use by a managed listener
	for _, inst := range a.managedListeners {
		if inst.port == port && inst.rawListener != nil {
			a.mu.Unlock()
			return nil, fmt.Errorf("a listener is already running on port %d", port)
		}
	}
	a.mu.Unlock()

	instID := core.GenerateManagedListenerID(tool, port)
	cmdPreview := core.BuildListenerCommand(profile)
	opsecWarns := core.AnalyzeListenerOpsec(profile.Kind, bindAddr, port)

	inst := &managedListenerInstance{
		id:             instID,
		profileID:      profile.ID,
		name:           profile.Name,
		kind:           profile.Kind,
		tool:           tool,
		bindAddress:    bindAddr,
		port:           port,
		autoSpawnTab:   profile.AutoSpawnTab,
		startedAt:      time.Now(),
		sessions:       make(map[string]core.RawTcpSession),
		commandPreview: cmdPreview,
	}

	if tool == "builtin" || tool == "raw-tcp" {
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}

		cfg := core.RawTcpListenerConfig{
			Port:         port,
			BindAddress:  bindAddr,
			AutoSpawnTab: profile.AutoSpawnTab,
		}

		var rawListener core.RawTcpListener
		var err error
		rawListener, err = rawtcp.Listen(ctx, cfg, func(sess core.RawTcpSession) {
			sessionID := sess.ID()
			a.mu.Lock()
			a.rawTcpSessions[sessionID] = sess
			inst.catchCount++
			inst.sessions[sessionID] = sess
			a.mu.Unlock()

			go a.streamReaderLoop(sessionID, sess, true)

			stats := sess.Stats()
			a.emit(a.ctx, "listener:incoming", core.RawTcpIncomingEvent{
				SessionID:    sessionID,
				ListenerID:   instID,
				ListenerPort: port,
				RemoteAddr:   stats.RemoteAddr,
			})
			rID := instID
			if rawListener != nil {
				rID = rawListener.ID()
			}
			a.emit(a.ctx, "raw-tcp:incoming", core.RawTcpIncomingEvent{
				SessionID:    sessionID,
				ListenerID:   rID,
				ListenerPort: port,
				RemoteAddr:   stats.RemoteAddr,
			})
		})
		if err != nil {
			return nil, fmt.Errorf("failed to start native listener on %s:%d: %w", bindAddr, port, err)
		}

		inst.rawListener = rawListener
		a.mu.Lock()
		a.rawTcpListeners[rawListener.ID()] = rawListener
		a.mu.Unlock()
	}

	a.mu.Lock()
	a.managedListeners[instID] = inst
	a.mu.Unlock()

	a.emit(a.ctx, "listeners:updated", true)

	info := core.ManagedListenerInfo{
		ID:             inst.id,
		ProfileID:      inst.profileID,
		Name:           inst.name,
		Kind:           inst.kind,
		Tool:           inst.tool,
		BindAddress:    inst.bindAddress,
		BindPort:       inst.port,
		Status:         "listening",
		StartedAt:      inst.startedAt.UTC().Format(time.RFC3339),
		CatchCount:     0,
		ActiveSessions: []core.RawTcpSessionStats{},
		CommandPreview: cmdPreview,
		OpsecWarnings:  opsecWarns,
	}

	return &info, nil
}

// StopManagedListener terminates an active managed listener and releases its port (F-32).
func (a *App) StopManagedListener(listenerID string) error {
	a.mu.Lock()
	inst, ok := a.managedListeners[listenerID]
	if ok {
		delete(a.managedListeners, listenerID)
		if inst.rawListener != nil {
			delete(a.rawTcpListeners, inst.rawListener.ID())
			_ = inst.rawListener.Close()
		}
	}
	a.mu.Unlock()

	if !ok || inst == nil {
		return errors.New("managed listener not found")
	}

	a.emit(a.ctx, "listeners:updated", true)
	return nil
}

// ListActiveManagedListeners returns the live operational status and session counts of all running listeners (F-32).
func (a *App) ListActiveManagedListeners() []core.ManagedListenerInfo {
	a.mu.Lock()
	defer a.mu.Unlock()

	list := make([]core.ManagedListenerInfo, 0, len(a.managedListeners))
	for _, inst := range a.managedListeners {
		if inst == nil {
			continue
		}

		var activeSessions []core.RawTcpSessionStats
		for _, sess := range inst.sessions {
			if sess != nil {
				activeSessions = append(activeSessions, sess.Stats())
			}
		}

		state := "listening"
		if len(activeSessions) > 0 {
			state = "active"
		}

		opsecWarns := core.AnalyzeListenerOpsec(inst.kind, inst.bindAddress, inst.port)

		list = append(list, core.ManagedListenerInfo{
			ID:             inst.id,
			ProfileID:      inst.profileID,
			Name:           inst.name,
			Kind:           inst.kind,
			Tool:           inst.tool,
			BindAddress:    inst.bindAddress,
			BindPort:       inst.port,
			Status:         state,
			StartedAt:      inst.startedAt.UTC().Format(time.RFC3339),
			CatchCount:     inst.catchCount,
			ActiveSessions: activeSessions,
			CommandPreview: inst.commandPreview,
			OpsecWarnings:  opsecWarns,
		})
	}

	return list
}

// GenerateListenerCommand generates the exact executable CLI command for a listener profile (F-32).
func (a *App) GenerateListenerCommand(profile core.ListenerProfile) string {
	return core.BuildListenerCommand(profile)
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

// ExportTotpTokens exports stored TOTP tokens in either "uri" (line-separated otpauth:// URIs)
// or "json" format (F-20).
func (a *App) ExportTotpTokens(format string) (string, error) {
	a.vaultStore.Touch()

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return "", err
	}

	if strings.ToLower(strings.TrimSpace(format)) == "json" {
		data, err := json.MarshalIndent(payload.TotpRecords, "", "  ")
		if err != nil {
			return "", fmt.Errorf("failed to encode TOTP tokens to JSON: %w", err)
		}
		return string(data), nil
	}

	// Default: newline-separated otpauth:// URIs
	var sb strings.Builder
	for _, rec := range payload.TotpRecords {
		sb.WriteString(vault.FormatOTPAuthURI(rec))
		sb.WriteString("\n")
	}
	return sb.String(), nil
}

// ImportTotpTokens imports TOTP tokens from newline-separated otpauth:// URIs or JSON array string (F-20).
// Returns the count of newly added or updated tokens.
func (a *App) ImportTotpTokens(content string) (int, error) {
	a.vaultStore.Touch()

	content = strings.TrimSpace(content)
	if content == "" {
		return 0, errors.New("import content cannot be empty")
	}

	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return 0, err
	}

	var candidates []core.TotpRecord

	if strings.HasPrefix(content, "[") {
		// Try parsing as JSON array
		if err := json.Unmarshal([]byte(content), &candidates); err != nil {
			return 0, fmt.Errorf("invalid TOTP JSON array: %w", err)
		}
	} else {
		// Line-delimited URIs or single URI
		lines := strings.Split(content, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			rec, err := vault.ParseOTPAuthURI(line)
			if err != nil {
				continue // skip invalid lines gracefully
			}
			candidates = append(candidates, *rec)
		}
	}

	if len(candidates) == 0 {
		return 0, errors.New("no valid TOTP records found in import content")
	}

	importedCount := 0
	existingMap := make(map[string]int)
	for i, tr := range payload.TotpRecords {
		existingMap[tr.ID] = i
		// Key by Issuer+Label for deduplication
		key := strings.ToLower(tr.Issuer + "::" + tr.Label)
		existingMap[key] = i
	}

	for _, c := range candidates {
		c.Secret = strings.TrimSpace(c.Secret)
		if c.Secret == "" {
			continue
		}
		normSecret, err := vault.DecodeBase32Key(c.Secret)
		if err != nil || len(normSecret) == 0 {
			continue
		}
		if c.Label == "" {
			if c.Issuer != "" {
				c.Label = c.Issuer
			} else {
				c.Label = "Imported 2FA"
			}
		}
		if c.Algorithm == "" {
			c.Algorithm = "SHA1"
		}
		if c.Digits != 8 {
			c.Digits = 6
		}
		if c.Period <= 0 {
			c.Period = 30
		}
		if c.CreatedAt == "" {
			c.CreatedAt = time.Now().UTC().Format(time.RFC3339)
		}

		key := strings.ToLower(c.Issuer + "::" + c.Label)
		if idx, found := existingMap[key]; found {
			// Update existing secret and parameters
			payload.TotpRecords[idx].Secret = c.Secret
			payload.TotpRecords[idx].Algorithm = c.Algorithm
			payload.TotpRecords[idx].Digits = c.Digits
			payload.TotpRecords[idx].Period = c.Period
			importedCount++
		} else {
			if c.ID == "" {
				c.ID = fmt.Sprintf("totp-%d-%d", time.Now().UnixNano(), importedCount)
			}
			payload.TotpRecords = append(payload.TotpRecords, c)
			existingMap[key] = len(payload.TotpRecords) - 1
			importedCount++
		}
	}

	if importedCount > 0 {
		if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
			return 0, err
		}
	}

	return importedCount, nil
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

	// Write code directly into terminal session stdin without pressing return (F-20)
	return a.WriteTerminal(sessionID, code)
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

// SetWorkspaceStore injects a custom WorkspaceStore for testing (F-27).
func (a *App) SetWorkspaceStore(ws data.WorkspaceStore) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.workspaceStore = ws
}

// SaveWorkspace persists the user's workspace layout, tabs, and split panes across app restarts (F-27).
func (a *App) SaveWorkspace(state core.WorkspaceState) error {
	a.mu.Lock()
	if a.workspaceStore == nil {
		a.workspaceStore = data.NewWorkspaceStore(defaultWorkspacePath())
	}
	ws := a.workspaceStore
	a.mu.Unlock()

	return ws.Save(state)
}

// LoadWorkspace retrieves the persisted workspace layout from workspace.json (F-27).
func (a *App) LoadWorkspace() (core.WorkspaceState, error) {
	a.mu.Lock()
	if a.workspaceStore == nil {
		a.workspaceStore = data.NewWorkspaceStore(defaultWorkspacePath())
	}
	ws := a.workspaceStore
	a.mu.Unlock()

	return ws.Load()
}

// ClearWorkspace removes the persisted workspace state (F-27).
func (a *App) ClearWorkspace() error {
	a.mu.Lock()
	if a.workspaceStore == nil {
		a.workspaceStore = data.NewWorkspaceStore(defaultWorkspacePath())
	}
	ws := a.workspaceStore
	a.mu.Unlock()

	return ws.Clear()
}

// GetVaultSyncInfo returns synchronization and conflict metadata for the active vault file (F-29).
func (a *App) GetVaultSyncInfo() (core.VaultSyncInfo, error) {
	if a.vaultStore == nil {
		return core.VaultSyncInfo{}, errors.New("vault store is uninitialized")
	}
	return a.vaultStore.GetSyncInfo()
}

// CheckVaultSyncStatus checks whether the on-disk vault file has changed externally (F-29).
func (a *App) CheckVaultSyncStatus() (core.VaultSyncInfo, error) {
	if a.vaultStore == nil {
		return core.VaultSyncInfo{}, errors.New("vault store is uninitialized")
	}
	changed, err := a.vaultStore.CheckExternalChange()
	if err != nil {
		return core.VaultSyncInfo{}, err
	}
	info, err := a.vaultStore.GetSyncInfo()
	if err != nil {
		return core.VaultSyncInfo{}, err
	}
	if changed && !a.vaultStore.IsLocked() {
		// External change detected while vault is unlocked: attempt live non-conflicting merge or report conflict
		rawBytes, readErr := os.ReadFile(info.FilePath)
		if readErr == nil {
			if store, ok := a.vaultStore.(*vault.Store); ok {
				externalPayload, decErr := store.DecryptExternalEnvelope(rawBytes, "")
				if decErr == nil {
					currentPayload, getErr := a.vaultStore.GetPayload()
					if getErr == nil {
						merged, report := vault.MergeVaultPayloads(currentPayload, externalPayload)
						if !report.HasConflicts {
							// Clean auto-merge!
							_ = a.vaultStore.SavePayload(a.ctx, merged)
							info.Status = core.VaultSyncStatusSynced
							a.emit(a.ctx, "vault:updated", true)
						} else {
							info.Status = core.VaultSyncStatusConflict
							info.DetectedConflict = true
							info.ConflictCount = len(report.Conflicts)
							a.mu.Lock()
							a.pendingMergeExternalPayload = &externalPayload
							a.pendingMergeFilePath = info.FilePath
							a.mu.Unlock()
						}
					}
				}
			}
		}
	}
	a.emit(a.ctx, "vault:sync_status", info)
	return info, nil
}

// RelocateVaultFile moves or reconfigures the active encrypted vault file to a new target path (F-29).
func (a *App) RelocateVaultFile(newPath string, moveExisting bool) error {
	if newPath == "" {
		return errors.New("new vault path cannot be empty")
	}
	newPath = filepath.Clean(newPath)
	currentPath := a.vaultStore.GetFilePath()
	if currentPath == newPath {
		return nil
	}

	dir := filepath.Dir(newPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create directory for new vault path: %w", err)
	}

	if moveExisting {
		if _, err := os.Stat(currentPath); err == nil {
			// Copy current file to newPath
			data, err := os.ReadFile(currentPath)
			if err != nil {
				return fmt.Errorf("read current vault: %w", err)
			}
			if err := os.WriteFile(newPath, data, 0o600); err != nil {
				return fmt.Errorf("write new vault: %w", err)
			}
			_ = os.Remove(currentPath)
			// Move .hello key if present
			if helloData, err := os.ReadFile(currentPath + ".hello"); err == nil {
				_ = os.WriteFile(newPath+".hello", helloData, 0o600)
				_ = os.Remove(currentPath + ".hello")
			}
		}
	}

	ptr := vaultPointerPath()
	if ptr != "" {
		_ = os.MkdirAll(filepath.Dir(ptr), 0o700)
		_ = os.WriteFile(ptr, []byte(newPath), 0o600)
	}

	if err := a.vaultStore.SetFilePath(newPath); err != nil {
		return err
	}

	info, _ := a.vaultStore.GetSyncInfo()
	a.emit(a.ctx, "vault:sync_status", info)
	return nil
}

// ScanSyncConflictFiles returns all discovered Syncthing / Cloud sync conflict files in the vault folder (F-29).
func (a *App) ScanSyncConflictFiles() ([]string, error) {
	if a.vaultStore == nil {
		return nil, errors.New("vault store is uninitialized")
	}
	info, err := a.vaultStore.GetSyncInfo()
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(info.FilePath)
	return vault.DetectSyncConflictFiles(dir, filepath.Base(info.FilePath)), nil
}

// MergeExternalVaultFile reads an external vault file and prepares a merge against active vault (F-29).
func (a *App) MergeExternalVaultFile(filePath string, password string) (core.VaultConflictReport, error) {
	if a.vaultStore == nil {
		return core.VaultConflictReport{}, errors.New("vault store is uninitialized")
	}
	if a.vaultStore.IsLocked() {
		return core.VaultConflictReport{}, core.ErrVaultLocked
	}
	rawBytes, err := os.ReadFile(filePath)
	if err != nil {
		return core.VaultConflictReport{}, fmt.Errorf("read external vault file: %w", err)
	}

	store, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return core.VaultConflictReport{}, errors.New("invalid vault store implementation")
	}

	externalPayload, err := store.DecryptExternalEnvelope(rawBytes, password)
	if err != nil {
		return core.VaultConflictReport{}, fmt.Errorf("decrypt external vault: %w", err)
	}

	currentPayload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.VaultConflictReport{}, err
	}

	merged, report := vault.MergeVaultPayloads(currentPayload, externalPayload)

	if !report.HasConflicts {
		// Clean auto-merge: save directly!
		if err := a.vaultStore.SavePayload(a.ctx, merged); err != nil {
			return core.VaultConflictReport{}, fmt.Errorf("save merged vault: %w", err)
		}
		a.emit(a.ctx, "vault:updated", true)
		info, _ := a.vaultStore.GetSyncInfo()
		a.emit(a.ctx, "vault:sync_status", info)
	} else {
		a.mu.Lock()
		a.pendingMergeExternalPayload = &externalPayload
		a.pendingMergeFilePath = filePath
		a.mu.Unlock()
	}

	return report, nil
}

// ResolveVaultConflicts applies user-specified resolutions to pending conflicts and saves the vault (F-29).
func (a *App) ResolveVaultConflicts(resolutions map[string]string, deleteExternalFile bool) error {
	a.mu.Lock()
	ext := a.pendingMergeExternalPayload
	extPath := a.pendingMergeFilePath
	a.mu.Unlock()

	if ext == nil {
		return errors.New("no pending external vault merge in progress")
	}
	if a.vaultStore.IsLocked() {
		return core.ErrVaultLocked
	}

	currentPayload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	resMap := make(map[string]core.VaultConflictResolution, len(resolutions))
	for k, v := range resolutions {
		resMap[k] = core.VaultConflictResolution(v)
	}

	resolved := vault.ResolveVaultConflicts(currentPayload, *ext, resMap)
	if err := a.vaultStore.SavePayload(a.ctx, resolved); err != nil {
		return fmt.Errorf("save resolved vault: %w", err)
	}

	if deleteExternalFile && extPath != "" && extPath != a.vaultStore.GetFilePath() {
		_ = os.Remove(extPath)
	}

	a.mu.Lock()
	a.pendingMergeExternalPayload = nil
	a.pendingMergeFilePath = ""
	a.mu.Unlock()

	a.emit(a.ctx, "vault:updated", true)
	info, _ := a.vaultStore.GetSyncInfo()
	a.emit(a.ctx, "vault:sync_status", info)
	return nil
}

// ============================================================================
// Pentest Module: Engagement & Credential Pool & Spray Lists (F-36, F-40)
// ============================================================================

// ListEngagements returns all engagements stored in the vault (F-36).
func (a *App) ListEngagements() ([]core.Engagement, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	return payload.Engagements, nil
}

// GetActiveEngagement returns the currently active engagement (F-36).
func (a *App) GetActiveEngagement() (*core.Engagement, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	for i := range payload.Engagements {
		if payload.Engagements[i].IsActive {
			eng := payload.Engagements[i]
			return &eng, nil
		}
	}
	return nil, nil
}

// SetActiveEngagement sets the specified engagement as active (F-36).
// Passing "" or "none" clears active engagement and enters casual/global mode.
func (a *App) SetActiveEngagement(id string) error {
	if id == "none" {
		id = ""
	}
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	found := false
	for i := range payload.Engagements {
		if id != "" && payload.Engagements[i].ID == id {
			payload.Engagements[i].IsActive = true
			found = true
		} else {
			payload.Engagements[i].IsActive = false
		}
	}
	if !found && id != "" {
		return fmt.Errorf("engagement %q not found", id)
	}
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// AssignHostToEngagement associates or dissociates a host with an engagement (F-36).
func (a *App) AssignHostToEngagement(hostID, engagementID string) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	found := false
	for i := range payload.Hosts {
		if payload.Hosts[i].ID == hostID {
			payload.Hosts[i].EngagementID = strings.TrimSpace(engagementID)
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("host %q not found", hostID)
	}
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// SaveEngagement inserts or updates an engagement in the vault (F-36).
func (a *App) SaveEngagement(e core.Engagement) error {
	if err := core.ValidateEngagement(e); err != nil {
		return err
	}
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	now := time.Now()
	idx := -1
	for i, existing := range payload.Engagements {
		if existing.ID == e.ID {
			idx = i
			break
		}
	}
	if idx >= 0 {
		e.CreatedAt = payload.Engagements[idx].CreatedAt
		e.UpdatedAt = now
		payload.Engagements[idx] = e
	} else {
		if e.CreatedAt.IsZero() {
			e.CreatedAt = now
		}
		e.UpdatedAt = now
		if len(payload.Engagements) == 0 {
			e.IsActive = true
		}
		payload.Engagements = append(payload.Engagements, e)
	}
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DeleteEngagement removes an engagement and its associated credentials from the vault (F-36).
func (a *App) DeleteEngagement(id string) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	filteredEng := make([]core.Engagement, 0, len(payload.Engagements))
	for _, e := range payload.Engagements {
		if e.ID != id {
			filteredEng = append(filteredEng, e)
		}
	}
	payload.Engagements = filteredEng

	filteredCreds := make([]core.CredentialEntry, 0, len(payload.Credentials))
	for _, c := range payload.Credentials {
		if c.EngagementID != id {
			filteredCreds = append(filteredCreds, c)
		}
	}
	payload.Credentials = filteredCreds

	filteredRules := make([]core.ForwardRule, 0, len(payload.ForwardRules))
	for _, r := range payload.ForwardRules {
		if r.EngagementID != id {
			filteredRules = append(filteredRules, r)
		}
	}
	payload.ForwardRules = filteredRules

	filteredProxies := make([]core.ProxyProfile, 0, len(payload.ProxyProfiles))
	for _, p := range payload.ProxyProfiles {
		if p.EngagementID != id {
			filteredProxies = append(filteredProxies, p)
		}
	}
	payload.ProxyProfiles = filteredProxies

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// ListCredentials returns credentials filtered by engagement ID and/or host ID (F-36).
func (a *App) ListCredentials(engagementID string, hostID string) ([]core.CredentialEntry, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	var res []core.CredentialEntry
	for _, c := range payload.Credentials {
		if engagementID != "" && c.EngagementID != engagementID {
			continue
		}
		if hostID != "" && c.HostID != hostID {
			continue
		}
		res = append(res, c)
	}
	return res, nil
}

// SaveCredential inserts or updates a credential in the engagement pool (F-36).
func (a *App) SaveCredential(c core.CredentialEntry) error {
	if err := core.ValidateCredential(c); err != nil {
		return err
	}
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	if c.CapturedAt.IsZero() {
		c.CapturedAt = time.Now()
	}
	idx := -1
	for i, existing := range payload.Credentials {
		if existing.ID == c.ID {
			idx = i
			break
		}
	}
	if idx >= 0 {
		payload.Credentials[idx] = c
	} else {
		payload.Credentials = append(payload.Credentials, c)
	}
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DeleteCredential removes a credential from the vault pool (F-36).
func (a *App) DeleteCredential(id string) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	filtered := make([]core.CredentialEntry, 0, len(payload.Credentials))
	for _, c := range payload.Credentials {
		if c.ID != id {
			filtered = append(filtered, c)
		}
	}
	payload.Credentials = filtered
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// ExportSprayList generates formatted spray lists and checks for lockout warnings against the engagement policy (F-36, F-40).
func (a *App) ExportSprayList(opts core.SprayExportOptions) (core.SprayExportResult, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return core.SprayExportResult{}, err
	}

	policy := core.DefaultLockoutPolicy()
	if opts.EngagementID != "" {
		for _, e := range payload.Engagements {
			if e.ID == opts.EngagementID {
				policy = e.LockoutPolicy
				break
			}
		}
	}

	idSet := make(map[string]struct{}, len(opts.CredentialIDs))
	for _, id := range opts.CredentialIDs {
		idSet[id] = struct{}{}
	}

	var targetCreds []core.CredentialEntry
	for _, c := range payload.Credentials {
		if len(idSet) > 0 {
			if _, ok := idSet[c.ID]; ok {
				targetCreds = append(targetCreds, c)
			}
		} else if opts.EngagementID == "" || c.EngagementID == opts.EngagementID {
			targetCreds = append(targetCreds, c)
		}
	}

	return core.GenerateSprayList(targetCreds, policy, opts)
}

// ListEvidence returns evidence items filtered by engagement ID and/or host ID (F-18).
func (a *App) ListEvidence(engagementID string, hostID string) ([]core.EvidenceItem, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	var res []core.EvidenceItem
	for _, e := range payload.Evidence {
		if engagementID != "" && e.EngagementID != engagementID {
			continue
		}
		if hostID != "" && e.HostID != hostID {
			continue
		}
		res = append(res, e)
	}
	return res, nil
}

// GetEvidence returns a single evidence item by ID (F-18).
func (a *App) GetEvidence(id string) (*core.EvidenceItem, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	for _, e := range payload.Evidence {
		if e.ID == id {
			res := e
			return &res, nil
		}
	}
	return nil, fmt.Errorf("evidence item %q not found", id)
}

// SaveEvidence stores or updates an evidence item in the vault (F-18).
func (a *App) SaveEvidence(item core.EvidenceItem) error {
	if err := core.ValidateEvidenceItem(item); err != nil {
		return err
	}
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	if item.CapturedAt.IsZero() {
		item.CapturedAt = time.Now()
	}

	idx := -1
	for i, existing := range payload.Evidence {
		if existing.ID == item.ID {
			idx = i
			break
		}
	}
	if idx >= 0 {
		payload.Evidence[idx] = item
	} else {
		payload.Evidence = append(payload.Evidence, item)
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DeleteEvidence removes an evidence item from the vault (F-18).
func (a *App) DeleteEvidence(id string) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	filtered := make([]core.EvidenceItem, 0, len(payload.Evidence))
	for _, e := range payload.Evidence {
		if e.ID != id {
			filtered = append(filtered, e)
		}
	}
	payload.Evidence = filtered
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// GetEvidenceCategories returns default and engagement-custom evidence categories (F-18).
func (a *App) GetEvidenceCategories(engagementID string) ([]string, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	var categories []string

	for _, def := range core.DefaultEvidenceCategories() {
		if _, ok := seen[def]; !ok {
			seen[def] = struct{}{}
			categories = append(categories, def)
		}
	}

	if engagementID != "" {
		for _, eng := range payload.Engagements {
			if eng.ID == engagementID {
				for _, cust := range eng.CustomCategories {
					if _, ok := seen[cust]; !ok && cust != "" {
						seen[cust] = struct{}{}
						categories = append(categories, cust)
					}
				}
				break
			}
		}
	}

	for _, e := range payload.Evidence {
		if (engagementID == "" || e.EngagementID == engagementID) && e.Category != "" {
			if _, ok := seen[e.Category]; !ok {
				seen[e.Category] = struct{}{}
				categories = append(categories, e.Category)
			}
		}
	}

	return categories, nil
}

// AddEvidenceCategory registers a new custom category under an engagement (F-18).
func (a *App) AddEvidenceCategory(engagementID, category string) error {
	trimmed := strings.TrimSpace(category)
	if trimmed == "" {
		return errors.New("category name must not be empty")
	}

	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	if engagementID != "" {
		found := false
		for i := range payload.Engagements {
			if payload.Engagements[i].ID == engagementID {
				for _, c := range payload.Engagements[i].CustomCategories {
					if strings.EqualFold(c, trimmed) {
						return nil // already exists
					}
				}
				payload.Engagements[i].CustomCategories = append(payload.Engagements[i].CustomCategories, trimmed)
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("engagement %q not found", engagementID)
		}
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// GetEvidenceTemplates returns pre-filled finding templates (F-18).
func (a *App) GetEvidenceTemplates() []core.EvidenceItem {
	return core.DefaultEvidenceTemplates()
}

// ListFindings returns findings filtered by engagement ID and/or host ID (F-18).
func (a *App) ListFindings(engagementID string, hostID string) ([]core.FindingItem, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	var res []core.FindingItem
	for _, f := range payload.Findings {
		if engagementID != "" && f.EngagementID != engagementID {
			continue
		}
		if hostID != "" && f.HostID != hostID {
			match := false
			for _, ah := range f.AffectedHosts {
				if ah == hostID {
					match = true
					break
				}
			}
			if !match {
				continue
			}
		}
		res = append(res, f)
	}
	return res, nil
}

// GetFinding returns a single finding item by ID (F-18).
func (a *App) GetFinding(id string) (*core.FindingItem, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	for _, f := range payload.Findings {
		if f.ID == id {
			res := f
			return &res, nil
		}
	}
	return nil, fmt.Errorf("finding %q not found", id)
}

// SaveFinding stores or updates a finding item in the vault (F-18).
func (a *App) SaveFinding(item core.FindingItem) error {
	if err := core.ValidateFindingItem(item); err != nil {
		return err
	}
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}

	now := time.Now()
	if item.CreatedAt.IsZero() {
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	if item.Status == "" {
		item.Status = core.FindingStatusDraft
	}

	idx := -1
	for i, existing := range payload.Findings {
		if existing.ID == item.ID {
			idx = i
			break
		}
	}
	if idx >= 0 {
		payload.Findings[idx] = item
	} else {
		payload.Findings = append(payload.Findings, item)
	}

	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DeleteFinding removes a finding item from the vault (F-18).
func (a *App) DeleteFinding(id string) error {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return err
	}
	filtered := make([]core.FindingItem, 0, len(payload.Findings))
	for _, f := range payload.Findings {
		if f.ID != id {
			filtered = append(filtered, f)
		}
	}
	payload.Findings = filtered
	if err := a.vaultStore.SavePayload(a.ctx, payload); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// GetFindingTemplates returns structured starter findings for common vulnerability classes.
func (a *App) GetFindingTemplates() []core.FindingItem {
	return core.DefaultFindingTemplates()
}

// ExportEngagementPackage serializes an engagement and all its enclosed artifacts into an exportable .daeng package (F-36).
func (a *App) ExportEngagementPackage(engagementID string, password string) (string, error) {
	st, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return "", errors.New("vault store not available")
	}
	bytes, err := st.ExportEngagementPackage(engagementID, password)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// ExportEngagementFile writes an exported .daeng package to disk at targetPath (F-36).
func (a *App) ExportEngagementFile(engagementID string, password string, targetPath string) error {
	targetPath = strings.TrimSpace(targetPath)
	if targetPath == "" {
		return errors.New("target path must not be empty")
	}
	content, err := a.ExportEngagementPackage(engagementID, password)
	if err != nil {
		return err
	}
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}
	return os.WriteFile(targetPath, []byte(content), 0600)
}

// ImportEngagementPackage imports a .daeng engagement package from JSON content into the active vault (F-36).
func (a *App) ImportEngagementPackage(packageJSON string, password string) (*core.EngagementPackage, error) {
	st, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return nil, errors.New("vault store not available")
	}
	pkg, err := st.ImportEngagementPackage([]byte(packageJSON), password)
	if err != nil {
		return nil, err
	}
	a.emit(a.ctx, "vault:updated", true)
	return pkg, nil
}

// ImportEngagementFile reads and imports a .daeng engagement package from disk into the active vault (F-36).
func (a *App) ImportEngagementFile(filePath string, password string) (*core.EngagementPackage, error) {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return nil, errors.New("file path must not be empty")
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read engagement file: %w", err)
	}
	return a.ImportEngagementPackage(string(data), password)
}

// --- File Transfer Helper & HTTP Staging Engine (Pentest Module F-31) ---

// GetDefaultStagingDirectory returns a practical default directory for staging files (F-31).
func (a *App) GetDefaultStagingDirectory() string {
	if wd, err := os.Getwd(); err == nil && wd != "" {
		return wd
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	return os.TempDir()
}

// GetLocalNetworkIPs returns non-loopback IPv4 interfaces (prioritizing VPN tun/tap/wg) for LHOST selection (F-31).
func (a *App) GetLocalNetworkIPs() []core.NetworkInterfaceIP {
	return core.ListLocalIPv4Interfaces()
}

// StartFileTransferServer launches a native built-in HTTP staging & optional upload catcher server (F-31).
func (a *App) StartFileTransferServer(cfg core.FileTransferServerConfig) (*core.FileTransferServerInfo, error) {
	if cfg.Port == 0 {
		cfg.Port = 8000
	}
	if strings.TrimSpace(cfg.BindAddress) == "" {
		cfg.BindAddress = "0.0.0.0"
	}

	a.mu.Lock()
	for _, existing := range a.fileServers {
		if existing != nil && existing.Port() == cfg.Port {
			a.mu.Unlock()
			return nil, fmt.Errorf("a file staging server is already running on port %d", cfg.Port)
		}
	}
	a.mu.Unlock()

	srv, err := transfer.StartServer(cfg, func(serverID string, evt core.FileTransferEvent) {
		a.emit(a.ctx, "transfer:event", map[string]interface{}{
			"serverId": serverID,
			"event":    evt,
		})
	})
	if err != nil {
		return nil, err
	}

	a.mu.Lock()
	if a.fileServers == nil {
		a.fileServers = make(map[string]*transfer.ManagedServer)
	}
	a.fileServers[srv.ID()] = srv
	a.mu.Unlock()

	a.emit(a.ctx, "transfer:servers-updated", true)
	info := srv.Info()
	return &info, nil
}

// StopFileTransferServer stops an active HTTP staging server by ID (F-31).
func (a *App) StopFileTransferServer(serverID string) error {
	a.mu.Lock()
	srv, ok := a.fileServers[serverID]
	if ok {
		delete(a.fileServers, serverID)
	}
	a.mu.Unlock()

	if !ok || srv == nil {
		return errors.New("file staging server not found")
	}

	if err := srv.Stop(context.Background()); err != nil {
		return err
	}
	a.emit(a.ctx, "transfer:servers-updated", true)
	return nil
}

// ListFileTransferServers returns telemetry and recent access events for all active staging servers (F-31).
func (a *App) ListFileTransferServers() []core.FileTransferServerInfo {
	a.mu.Lock()
	servers := make([]*transfer.ManagedServer, 0, len(a.fileServers))
	for _, srv := range a.fileServers {
		if srv != nil {
			servers = append(servers, srv)
		}
	}
	a.mu.Unlock()

	list := make([]core.FileTransferServerInfo, 0, len(servers))
	for _, srv := range servers {
		list = append(list, srv.Info())
	}
	return list
}

// GenerateFileServerCommand builds the CLI launch command for external staging servers (python3, updog, impacket-smb, etc.) (F-31).
func (a *App) GenerateFileServerCommand(cfg core.FileTransferServerConfig) string {
	return core.BuildFileServerCommand(cfg)
}

// ListHostedTransferFiles enumerates files inside the configured staging directory (F-31).
func (a *App) ListHostedTransferFiles(dir string) ([]core.HostedFileEntry, error) {
	return core.ListHostedFiles(dir)
}

// HashHostedTransferFile computes streaming SHA-256 and MD5 checksums for a staged file inside rootDir (F-31).
func (a *App) HashHostedTransferFile(rootDir string, relPath string) (*core.HostedFileEntry, error) {
	safePath, err := core.ResolveSafeHostedPath(rootDir, relPath)
	if err != nil {
		return nil, err
	}

	sha, md5Hex, size, err := transfer.ComputeFileHashes(safePath)
	if err != nil {
		return nil, err
	}

	fi, err := os.Stat(safePath)
	if err != nil {
		return nil, err
	}

	return &core.HostedFileEntry{
		Name:     fi.Name(),
		RelPath:  filepath.ToSlash(strings.TrimLeft(relPath, "/\\")),
		FullPath: safePath,
		Size:     size,
		IsDir:    false,
		ModTime:  fi.ModTime().UTC().Format(time.RFC3339),
		SHA256:   sha,
		MD5:      md5Hex,
	}, nil
}

// GenerateFileTransferCommands builds target-OS download, upload/exfil, in-memory, and hash verification commands (F-31).
func (a *App) GenerateFileTransferCommands(opts core.FileTransferCommandOptions) core.FileTransferCommandSet {
	return core.GenerateTargetTransferCommands(opts)
}

// --- Ligolo-ng / Chisel Pivoting Engine (Pentest Module F-24) ---

// GetDefaultNetworkRoutes returns starter pivot templates for ligolo-ng and chisel (F-24).
func (a *App) GetDefaultNetworkRoutes() []core.NetworkRoute {
	return core.DefaultBuiltinNetworkRoutes()
}

// ListNetworkRoutes returns all persisted pivot/network routes from the encrypted vault (F-24).
func (a *App) ListNetworkRoutes() ([]core.NetworkRoute, error) {
	st, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return nil, errors.New("vault store not available")
	}
	return st.ListNetworkRoutes()
}

// SaveNetworkRoute creates or updates a pivot route profile in the encrypted vault (F-24).
func (a *App) SaveNetworkRoute(route core.NetworkRoute) error {
	st, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return errors.New("vault store not available")
	}
	if err := st.SaveNetworkRoute(route); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DeleteNetworkRoute deletes a saved pivot route profile by ID (F-24).
func (a *App) DeleteNetworkRoute(routeID string) error {
	st, ok := a.vaultStore.(*vault.Store)
	if !ok {
		return errors.New("vault store not available")
	}
	if err := st.DeleteNetworkRoute(routeID); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DetectPivotBinaries checks local PATH for ligolo-ng proxy and chisel executables (F-24).
func (a *App) DetectPivotBinaries() []core.PivotBinaryStatus {
	return pivot.DetectBinaries()
}

// StartPivotInstance launches a supervised ligolo-ng proxy or chisel server subprocess (F-24).
func (a *App) StartPivotInstance(route core.NetworkRoute) (*core.PivotInstanceInfo, error) {
	if a.pivotMgr == nil {
		a.pivotMgr = pivot.NewManager(func(info core.PivotInstanceInfo) {
			a.emit(a.ctx, "pivot:updated", info)
		})
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	info, err := a.pivotMgr.Start(ctx, route)
	a.emit(a.ctx, "pivot:updated", info)
	if err != nil {
		return &info, err
	}
	return &info, nil
}

// StopPivotInstance terminates or dismisses a pivot instance by ID (F-24).
func (a *App) StopPivotInstance(instanceID string) error {
	if a.pivotMgr == nil {
		return errors.New("pivot manager not initialized")
	}
	err := a.pivotMgr.Stop(instanceID)
	a.emit(a.ctx, "pivot:updated", true)
	return err
}

// SendPivotInput sends an interactive console line (e.g. session, ifconfig, start) to a running ligolo-proxy (F-24).
func (a *App) SendPivotInput(instanceID string, input string) error {
	if a.pivotMgr == nil {
		return errors.New("pivot manager not initialized")
	}
	err := a.pivotMgr.SendInput(instanceID, input)
	if err == nil {
		a.emit(a.ctx, "pivot:updated", true)
	}
	return err
}

// ListActivePivotInstances returns all active and recently stopped/errored pivot processes (F-24).
func (a *App) ListActivePivotInstances() []core.PivotInstanceInfo {
	if a.pivotMgr == nil {
		return []core.PivotInstanceInfo{}
	}
	return a.pivotMgr.List()
}

// BuildPivotCommands generates setup, routing, interactive console, agent one-liner, and proxychains snippets (F-24).
func (a *App) BuildPivotCommands(route core.NetworkRoute, lhost string) core.PivotCommandSet {
	return core.BuildPivotCommandSet(route, lhost)
}

// --- Route Health Check (Pentest Module F-38) ---

// ParseRouteProbeTargets parses and validates host:port probe targets using OPSEC bounds (max 25, F-38).
func (a *App) ParseRouteProbeTargets(raw string) ([]string, error) {
	return core.ParseProbeTargets([]string{raw})
}

// RunRouteHealthCheck performs a strictly user-triggered, throttled, OPSEC-aware health check across
// pivots (ligolo-ng/chisel), SSH tunnels (-L/-R/-D), proxy profiles, and optional target probes (F-38).
func (a *App) RunRouteHealthCheck(req core.RouteCheckRequest) (*core.RouteHealthReport, error) {
	snap := health.Snapshot{
		ActivePivots:  a.ListActivePivotInstances(),
		ActiveTunnels: a.GetActiveTunnels(),
	}

	if st, ok := a.vaultStore.(*vault.Store); ok && st != nil {
		if routes, err := st.ListNetworkRoutes(); err == nil {
			snap.Routes = routes
		}
	}
	if a.vaultStore != nil {
		if payload, err := a.vaultStore.GetPayload(); err == nil {
			snap.ForwardRules = payload.ForwardRules
			snap.ProxyProfiles = payload.ProxyProfiles
		}
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	report, err := health.RunCheck(ctx, req, snap)
	if err != nil {
		return nil, err
	}

	// Persist LastCheck and derived Status back onto matching NetworkRoute records in the vault (Spec Line 57).
	if st, ok := a.vaultStore.(*vault.Store); ok && st != nil && len(snap.Routes) > 0 {
		byID := make(map[string]core.RouteHealthEntry, len(report.Entries))
		for _, e := range report.Entries {
			if e.SourceType == "pivot" {
				byID[e.ID] = e
			}
		}
		updatedAny := false
		for _, r := range snap.Routes {
			if entry, matched := byID[r.ID]; matched {
				r.LastCheck = entry.LastCheck
				switch entry.Status {
				case "healthy":
					r.Status = "running"
				case "degraded":
					r.Status = "running"
				case "error", "down":
					r.Status = entry.Status
				default:
					r.Status = "configured"
				}
				if saveErr := st.SaveNetworkRoute(r); saveErr == nil {
					updatedAny = true
				}
			}
		}
		if updatedAny {
			a.emit(a.ctx, "vault:updated", true)
		}
	}

	a.emit(a.ctx, "route-health:updated", report)
	return report, nil
}

// --- WinRM / PowerShell Remoting Client (Pentest Module F-41) ---

// ListWinrmProfileSummaries returns all saved WinRM profiles without secret fields (F-41, Golden Rule 2).
func (a *App) ListWinrmProfileSummaries() ([]core.WinrmProfileSummary, error) {
	a.vaultStore.Touch()
	if st, ok := a.vaultStore.(*vault.Store); ok && st != nil {
		return st.ListWinrmProfileSummaries()
	}
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	res := make([]core.WinrmProfileSummary, 0, len(payload.WinrmProfiles))
	for _, wp := range payload.WinrmProfiles {
		res = append(res, wp.ToSummary())
	}
	return res, nil
}

// SaveWinrmProfile persists a WinRM connection profile inside the encrypted vault (F-41).
func (a *App) SaveWinrmProfile(profile core.WinrmProfile) error {
	a.vaultStore.Touch()
	st, ok := a.vaultStore.(*vault.Store)
	if !ok || st == nil {
		return errors.New("vault store does not support WinRM profile storage")
	}
	if err := st.SaveWinrmProfile(profile); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DeleteWinrmProfile removes a saved WinRM profile by ID from the encrypted vault (F-41).
func (a *App) DeleteWinrmProfile(id string) error {
	a.vaultStore.Touch()
	st, ok := a.vaultStore.(*vault.Store)
	if !ok || st == nil {
		return errors.New("vault store does not support WinRM profile deletion")
	}
	if err := st.DeleteWinrmProfile(id); err != nil {
		return err
	}
	a.emit(a.ctx, "vault:updated", true)
	return nil
}

// DetectWinrmTools checks PATH for external WinRM helpers (evil-winrm, pwsh) as optional fallback info (F-41).
func (a *App) DetectWinrmTools() []core.WinrmToolStatus {
	return winrm.DetectTools()
}

// BuildWinrmCLICommand builds a masked Evil-WinRM CLI command preview for operator documentation/copy (F-41).
func (a *App) BuildWinrmCLICommand(profile core.WinrmProfile) string {
	return core.BuildEvilWinrmCLI(profile)
}

func (a *App) resolveWinrmConnectProfile(req core.WinrmConnectRequest) (core.WinrmProfile, error) {
	prof := core.WinrmProfile{
		ID:                 strings.TrimSpace(req.ProfileID),
		EngagementID:       strings.TrimSpace(req.EngagementID),
		HostID:             strings.TrimSpace(req.HostID),
		Name:               strings.TrimSpace(req.Name),
		Host:               strings.TrimSpace(req.Host),
		Port:               req.Port,
		UseTLS:             req.UseTLS,
		InsecureSkipVerify: req.InsecureSkipVerify,
		AuthType:           core.NormalizeWinrmAuthType(req.AuthType),
		Domain:             strings.TrimSpace(req.Domain),
		Username:           strings.TrimSpace(req.Username),
		Password:           req.Password,
		NtHash:             strings.TrimSpace(req.NtHash),
		IdentityID:         strings.TrimSpace(req.IdentityID),
		CredentialID:       strings.TrimSpace(req.CredentialID),
		SocksProxyAddr:     strings.TrimSpace(req.SocksProxyAddr),
		TimeoutSec:         req.TimeoutSec,
	}

	if a.vaultStore != nil {
		if payload, err := a.vaultStore.GetPayload(); err == nil {
			if prof.ID != "" {
				for _, saved := range payload.WinrmProfiles {
					if saved.ID == prof.ID {
						if prof.Host == "" {
							prof.Host = saved.Host
						}
						if prof.Name == "" {
							prof.Name = saved.Name
						}
						if prof.Port == 0 {
							prof.Port = saved.Port
							prof.UseTLS = saved.UseTLS
							prof.InsecureSkipVerify = saved.InsecureSkipVerify
						}
						if prof.HostID == "" {
							prof.HostID = saved.HostID
						}
						if prof.EngagementID == "" {
							prof.EngagementID = saved.EngagementID
						}
						if strings.TrimSpace(req.AuthType) == "" {
							prof.AuthType = saved.AuthType
						}
						if prof.Domain == "" {
							prof.Domain = saved.Domain
						}
						if prof.Username == "" {
							prof.Username = saved.Username
						}
						if prof.Password == "" {
							prof.Password = saved.Password
						}
						if prof.NtHash == "" {
							prof.NtHash = saved.NtHash
						}
						if prof.IdentityID == "" {
							prof.IdentityID = saved.IdentityID
						}
						if prof.CredentialID == "" {
							prof.CredentialID = saved.CredentialID
						}
						if prof.SocksProxyAddr == "" {
							prof.SocksProxyAddr = saved.SocksProxyAddr
						}
						if prof.TimeoutSec == 0 {
							prof.TimeoutSec = saved.TimeoutSec
						}
						break
					}
				}
			}
			if prof.Host == "" && prof.HostID != "" {
				for _, h := range payload.Hosts {
					if h.ID == prof.HostID {
						prof.Host = h.Address
						if prof.Name == "" {
							prof.Name = h.Label
						}
						break
					}
				}
			}
			if prof.IdentityID != "" {
				for _, idRec := range payload.Identities {
					if idRec.ID == prof.IdentityID {
						if prof.Username == "" {
							prof.Username = idRec.Username
						}
						if prof.Password == "" {
							prof.Password = idRec.Password
						}
						break
					}
				}
			}
			if prof.CredentialID != "" {
				for _, cred := range payload.Credentials {
					if cred.ID == prof.CredentialID {
						if prof.Domain == "" && cred.Realm != "" {
							prof.Domain = cred.Realm
						}
						if prof.Username == "" && cred.Username != "" {
							prof.Username = cred.Username
						}
						if cred.Category == core.CredCategoryHash || prof.AuthType == core.WinrmAuthPtH {
							if prof.NtHash == "" {
								prof.NtHash = cred.Secret
							}
						} else if prof.Password == "" {
							prof.Password = cred.Secret
						}
						break
					}
				}
			}
		}
	}

	prof = core.NormalizeWinrmProfile(prof)
	if prof.Name == "" && prof.Host != "" {
		prof.Name = fmt.Sprintf("WinRM %s", prof.Host)
	}
	return prof, core.ValidateWinrmProfile(prof)
}

func (a *App) connectWinrmWithConfig(req core.WinrmConnectRequest, clientCfg winrm.ClientConfig) (*core.WinrmSessionInfo, error) {
	a.vaultStore.Touch()
	if a.winrmMgr == nil {
		return nil, errors.New("winrm manager not initialized")
	}

	prof, err := a.resolveWinrmConnectProfile(req)
	if err != nil {
		return nil, err
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}

	sess, err := a.winrmMgr.Open(ctx, prof, clientCfg)
	if err != nil {
		return nil, err
	}

	info := sess.Info()
	a.mu.Lock()
	a.winrmSessions[sess.ID()] = sess
	if prof.HostID != "" {
		a.sessionHostID[sess.ID()] = prof.HostID
	}
	a.mu.Unlock()

	if a.logMgr != nil {
		_, _ = a.logMgr.StartSession(sess.ID(), prof.HostID, prof.Name)
		if prof.Password != "" {
			a.logMgr.RegisterSensitiveValue(sess.ID(), prof.Password)
		}
		if prof.NtHash != "" {
			a.logMgr.RegisterSensitiveValue(sess.ID(), prof.NtHash)
		}
	}

	go a.streamReaderLoop(sess.ID(), sess.Reader(), true)
	return &info, nil
}

// ConnectWinrmSession establishes an interactive pure-Go WS-Management WinRM session and attaches it to an xterm.js tab (F-41).
func (a *App) ConnectWinrmSession(req core.WinrmConnectRequest) (*core.WinrmSessionInfo, error) {
	return a.connectWinrmWithConfig(req, winrm.ClientConfig{})
}

// ListActiveWinrmSessions returns metadata for all open WinRM / PowerShell Remoting sessions (F-41).
func (a *App) ListActiveWinrmSessions() []core.WinrmSessionInfo {
	if a.winrmMgr == nil {
		return []core.WinrmSessionInfo{}
	}
	return a.winrmMgr.List()
}

// ExecuteWinrmCommand executes a PowerShell script or command directly over an active WinRM session and returns structured output (F-41).
func (a *App) ExecuteWinrmCommand(sessionID string, script string) (*core.WinrmExecResult, error) {
	a.vaultStore.Touch()
	if a.winrmMgr == nil {
		return nil, errors.New("winrm manager not initialized")
	}
	sess, ok := a.winrmMgr.Get(sessionID)
	if !ok {
		return nil, core.ErrSessionNotFound
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return sess.Execute(ctx, script)
}

// UploadWinrmFile uploads a local file over an active WinRM session via chunked Base64 + SHA-256 verification (F-41).
func (a *App) UploadWinrmFile(sessionID string, localPath string, remotePath string) (*core.WinrmTransferResult, error) {
	a.vaultStore.Touch()
	if a.winrmMgr == nil {
		return nil, errors.New("winrm manager not initialized")
	}
	sess, ok := a.winrmMgr.Get(sessionID)
	if !ok {
		return nil, core.ErrSessionNotFound
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return sess.Upload(ctx, localPath, remotePath)
}

// DownloadWinrmFile downloads a remote file over an active WinRM session via Base64 streaming + SHA-256 verification (F-41).
func (a *App) DownloadWinrmFile(sessionID string, remotePath string, localPath string) (*core.WinrmTransferResult, error) {
	a.vaultStore.Touch()
	if a.winrmMgr == nil {
		return nil, errors.New("winrm manager not initialized")
	}
	sess, ok := a.winrmMgr.Get(sessionID)
	if !ok {
		return nil, core.ErrSessionNotFound
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return sess.Download(ctx, remotePath, localPath)
}

// GenerateEvidenceReport compiles an engagement/per-host Assessment & Evidence report (Markdown or HTML) with SHA-256 integrity digests (F-30).
// When req.SplitByHost is true and req.OutputDir is provided, each host report + manifest.sha256 is written directly into OutputDir.
func (a *App) GenerateEvidenceReport(req core.ReportExportRequest) (*core.ReportExportResult, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	return report.CompileAndExport(req, payload)
}

// ExportEvidenceReportToFile compiles the F-30 report and writes it deterministically to filePath with SHA-256 verification.
func (a *App) ExportEvidenceReportToFile(req core.ReportExportRequest, filePath string) (*core.ReportExportResult, error) {
	a.vaultStore.Touch()
	payload, err := a.vaultStore.GetPayload()
	if err != nil {
		return nil, err
	}
	return report.ExportToFile(req, payload, filePath)
}

// SaveReportFileDialog opens a native Wails Save File dialog configured for Markdown or HTML reports (F-30).
func (a *App) SaveReportFileDialog(defaultFilename string, format string) (string, error) {
	if a.ctx == nil {
		return "", errors.New("application context not initialized")
	}
	normalized := core.NormalizeReportFormat(format)
	filters := []runtime.FileFilter{
		{DisplayName: "Markdown Report (*.md)", Pattern: "*.md"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	}
	if normalized == core.ReportFormatHTML {
		filters = []runtime.FileFilter{
			{DisplayName: "HTML Report (*.html;*.htm)", Pattern: "*.html;*.htm"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		}
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Assessment Report",
		DefaultFilename: strings.TrimSpace(defaultFilename),
		Filters:         filters,
	})
}





