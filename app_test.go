package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"doubleagent/backend/core"
	"doubleagent/backend/vault"
)

type fakeSshTransport struct {
	mu           sync.Mutex
	connCount    int
	stdinBuf     bytes.Buffer
	stdoutR      *io.PipeReader
	stdoutW      *io.PipeWriter
	lastResize   core.TerminalSize
	disconnected bool
}

func newFakeSshTransport() *fakeSshTransport {
	r, w := io.Pipe()
	return &fakeSshTransport{
		stdoutR: r,
		stdoutW: w,
	}
}

func (f *fakeSshTransport) Connect(_ context.Context, cfg core.SshSessionConfig) (string, error) {
	if cfg.OnFirstSeenKey != nil {
		trust, err := cfg.OnFirstSeenKey(core.HostKeyInfo{
			HostPattern: cfg.Address,
			Port:        cfg.Port,
			KeyType:     "ssh-ed25519",
			Fingerprint: "SHA256:testfingerprint123456",
		})
		if err != nil || !trust {
			return "", core.ErrHostKeyUntrusted
		}
	}
	f.mu.Lock()
	f.connCount++
	id := fmt.Sprintf("sess-%d", f.connCount)
	f.mu.Unlock()
	return id, nil
}

type nopCloserWriter struct {
	io.Writer
}

func (nopCloserWriter) Close() error { return nil }

func (f *fakeSshTransport) OpenShell(_ context.Context, _ string, size core.TerminalSize) (*core.SshShellStreams, error) {
	f.mu.Lock()
	f.lastResize = size
	f.mu.Unlock()
	return &core.SshShellStreams{
		Stdin:  nopCloserWriter{Writer: &f.stdinBuf},
		Stdout: f.stdoutR,
		Stderr: nil,
	}, nil
}

func (f *fakeSshTransport) OpenShellWithOptions(ctx context.Context, sessionID string, size core.TerminalSize, _ string, _ bool) (*core.SshShellStreams, error) {
	return f.OpenShell(ctx, sessionID, size)
}

func (f *fakeSshTransport) OpenSftp(_ context.Context, _ string) (core.SftpClient, error) {
	return &fakeSftpClient{}, nil
}

type fakeForwardTunnel struct {
	status core.ForwardTunnelStatus
	closed bool
}

func (f *fakeForwardTunnel) Close() error {
	f.closed = true
	f.status.Status = "closed"
	return nil
}

func (f *fakeForwardTunnel) GetStatus() core.ForwardTunnelStatus {
	return f.status
}

func (f *fakeSshTransport) StartForwardLocal(_ context.Context, sessionID string, ruleID string, bindAddr string, bindPort uint16, targetHost string, targetPort uint16) (core.ForwardTunnel, error) {
	return &fakeForwardTunnel{
		status: core.ForwardTunnelStatus{
			ID:          "tun-mock-local",
			RuleID:      ruleID,
			SessionID:   sessionID,
			Type:        core.ForwardLocal,
			BindAddress: bindAddr,
			BindPort:    bindPort,
			TargetHost:  targetHost,
			TargetPort:  targetPort,
			Status:      "active",
		},
	}, nil
}

func (f *fakeSshTransport) StartForwardRemote(_ context.Context, sessionID string, ruleID string, bindAddr string, bindPort uint16, targetHost string, targetPort uint16) (core.ForwardTunnel, error) {
	return &fakeForwardTunnel{
		status: core.ForwardTunnelStatus{
			ID:          "tun-mock-remote",
			RuleID:      ruleID,
			SessionID:   sessionID,
			Type:        core.ForwardRemote,
			BindAddress: bindAddr,
			BindPort:    bindPort,
			TargetHost:  targetHost,
			TargetPort:  targetPort,
			Status:      "active",
		},
	}, nil
}

func (f *fakeSshTransport) StartForwardDynamic(_ context.Context, sessionID string, ruleID string, bindAddr string, bindPort uint16) (core.ForwardTunnel, error) {
	return &fakeForwardTunnel{
		status: core.ForwardTunnelStatus{
			ID:          "tun-mock-dynamic",
			RuleID:      ruleID,
			SessionID:   sessionID,
			Type:        core.ForwardDynamic,
			BindAddress: bindAddr,
			BindPort:    bindPort,
			Status:      "active",
		},
	}, nil
}

type fakeSftpClient struct{}

func (f *fakeSftpClient) List(_ context.Context, path string) ([]core.FileItem, error) {
	return []core.FileItem{
		{Name: "remote_file.txt", Path: path + "/remote_file.txt", Size: 42, IsDir: false, ModTime: time.Now().Unix(), Permissions: "-rw-r--r--"},
	}, nil
}
func (f *fakeSftpClient) Stat(_ context.Context, path string) (core.FileItem, error) {
	return core.FileItem{Name: "remote_file.txt", Path: path, Size: 42, IsDir: false, ModTime: time.Now().Unix(), Permissions: "-rw-r--r--"}, nil
}
func (f *fakeSftpClient) Mkdir(_ context.Context, _ string) error { return nil }
func (f *fakeSftpClient) Remove(_ context.Context, _ string) error { return nil }
func (f *fakeSftpClient) Rename(_ context.Context, _, _ string) error { return nil }
func (f *fakeSftpClient) Upload(_ context.Context, _, _ string, onProgress func(int64, int64)) error {
	if onProgress != nil {
		onProgress(42, 42)
	}
	return nil
}
func (f *fakeSftpClient) Download(_ context.Context, _, _ string, onProgress func(int64, int64)) error {
	if onProgress != nil {
		onProgress(42, 42)
	}
	return nil
}
func (f *fakeSftpClient) Close() error { return nil }

func (f *fakeSshTransport) ResizeShell(_ context.Context, _ string, size core.TerminalSize) error {
	f.mu.Lock()
	f.lastResize = size
	f.mu.Unlock()
	return nil
}

func (f *fakeSshTransport) Disconnect(_ context.Context, _ string) error {
	f.mu.Lock()
	f.disconnected = true
	f.mu.Unlock()
	_ = f.stdoutW.Close()
	return nil
}

func TestM0_0_AppHealthCheck(t *testing.T) {
	app := NewApp()
	status := app.HealthCheck()

	if status.Name != "DoubleAgent" {
		t.Fatalf("expected Name DoubleAgent, got %q", status.Name)
	}
	if status.Milestone != "M1-1" {
		t.Fatalf("expected Milestone M1-1, got %q", status.Milestone)
	}
	if !status.VaultLock {
		t.Fatal("expected VaultLock to be true on startup (F-03)")
	}
}

func TestS1_StripOSC52Sequences_F07(t *testing.T) {
	raw := []byte("hello \x1b]52;c;SGVsbG8=\x07world \x1b]52;c;dGVzdA==\x1b\\!")
	cleaned := StripOSC52Sequences(raw)
	if string(cleaned) != "hello world !" {
		t.Fatalf("expected OSC 52 sequences stripped, got %q", string(cleaned))
	}
}

func TestS1_AppTerminalFlowAndHostKeyTOFU_F06_F07(t *testing.T) {
	fake := newFakeSshTransport()
	dataCh := make(chan core.TerminalDataEvent, 8)
	promptCh := make(chan core.HostKeyInfo, 1)

	app := NewAppWithTransport(fake, nil, func(_ context.Context, eventName string, optionalData ...interface{}) {
		switch eventName {
		case "ssh:hostkey-prompt":
			if len(optionalData) > 0 {
				if info, ok := optionalData[0].(core.HostKeyInfo); ok {
					promptCh <- info
				}
			}
		case "terminal:data":
			if len(optionalData) > 0 {
				if ev, ok := optionalData[0].(core.TerminalDataEvent); ok {
					dataCh <- ev
				}
			}
		}
	})

	// Approve TOFU host key when prompted
	go func() {
		info := <-promptCh
		_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
	}()

	sessID, err := app.ConnectSSH(core.ConnectRequest{
		Address:  "10.0.0.5",
		Port:     22,
		Username: "root",
		Password: "secret",
		Size:     core.TerminalSize{Cols: 100, Rows: 30},
	})
	if err != nil {
		t.Fatalf("ConnectSSH failed: %v", err)
	}

	if err := app.WriteTerminal(sessID, "ls -la\n"); err != nil {
		t.Fatalf("WriteTerminal failed: %v", err)
	}
	if !strings.Contains(fake.stdinBuf.String(), "ls -la\n") {
		t.Fatalf("expected stdin to contain 'ls -la\\n', got %q", fake.stdinBuf.String())
	}

	// Stream output containing an OSC 52 sequence that must be stripped
	_, _ = fake.stdoutW.Write([]byte("total 0\r\n\x1b]52;c;cHduZWQ=\x07root@box:~# "))

	select {
	case ev := <-dataCh:
		if ev.SessionID != sessID {
			t.Fatalf("unexpected session id %q", ev.SessionID)
		}
		if ev.Data != "total 0\r\nroot@box:~# " {
			t.Fatalf("expected sanitized terminal output, got %q", ev.Data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for terminal:data event")
	}

	if err := app.ResizeTerminal(sessID, 140, 45); err != nil {
		t.Fatalf("ResizeTerminal failed: %v", err)
	}

	if err := app.DisconnectSession(sessID); err != nil {
		t.Fatalf("DisconnectSession failed: %v", err)
	}
}

func TestApp_OpenTerminalWithOptions_F10(t *testing.T) {
	fake := newFakeSshTransport()
	var app *App
	app = NewAppWithTransport(fake, nil, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})

	sessID, err := app.ConnectSSH(core.ConnectRequest{
		Address:  "127.0.0.1",
		Port:     22,
		Username: "user",
		Password: "password",
		Size:     core.TerminalSize{Cols: 80, Rows: 24},
	})
	if err != nil {
		t.Fatalf("ConnectSSH failed: %v", err)
	}

	// Duplicate in default directory
	dupID, err := app.OpenTerminalWithOptions(sessID, core.TerminalSpawnOptions{
		Mode: "default",
		Size: core.TerminalSize{Cols: 100, Rows: 30},
	})
	if err != nil {
		t.Fatalf("OpenTerminalWithOptions default failed: %v", err)
	}
	if dupID == "" || dupID == sessID {
		t.Fatalf("unexpected new session ID: %s", dupID)
	}

	// Duplicate in current directory as root
	rootID, err := app.OpenTerminalWithOptions(sessID, core.TerminalSpawnOptions{
		Mode:       "root",
		WorkingDir: "/var/log",
		Size:       core.TerminalSize{Cols: 120, Rows: 34},
	})
	if err != nil {
		t.Fatalf("OpenTerminalWithOptions root failed: %v", err)
	}
	if rootID == "" || rootID == sessID || rootID == dupID {
		t.Fatalf("unexpected root session ID: %s", rootID)
	}

	_ = app.DisconnectSession(sessID)
	_ = app.DisconnectSession(dupID)
	_ = app.DisconnectSession(rootID)
}

func TestApp_ConnectSSH_KeyID_F04(t *testing.T) {
	fake := newFakeSshTransport()
	tmpVault := filepath.Join(t.TempDir(), "test_keyid.vault")
	store := vault.NewStore(vault.StoreOptions{FilePath: tmpVault})
	if err := store.Initialize(context.Background(), ""); err != nil {
		t.Fatalf("store.Initialize failed: %v", err)
	}

	var app *App
	app = NewAppWithDependencies(fake, nil, store, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})

	keySum, err := app.GenerateSSHKey("DevKey", "ed25519", "")
	if err != nil {
		t.Fatalf("GenerateSSHKey failed: %v", err)
	}

	sessID, err := app.ConnectSSH(core.ConnectRequest{
		Address:  "192.168.1.100",
		Port:     22,
		Username: "ops",
		KeyID:    keySum.ID,
		Size:     core.TerminalSize{Cols: 80, Rows: 24},
	})
	if err != nil {
		t.Fatalf("ConnectSSH with KeyID failed: %v", err)
	}
	if sessID == "" {
		t.Fatal("expected non-empty session ID")
	}

	_ = app.DisconnectSession(sessID)
}

func TestApp_SftpOperations_F12(t *testing.T) {
	fake := newFakeSshTransport()
	var app *App
	app = NewAppWithTransport(fake, nil, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})

	// Test ListLocalDir with temp dir
	tmpDir, err := os.MkdirTemp("", "sftp_local_test_*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	testFilePath := filepath.Join(tmpDir, "hello.txt")
	if err := os.WriteFile(testFilePath, []byte("sftp test data"), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	localItems, err := app.ListLocalDir(tmpDir)
	if err != nil {
		t.Fatalf("ListLocalDir failed: %v", err)
	}
	if len(localItems) != 1 || localItems[0].Name != "hello.txt" {
		t.Fatalf("unexpected local items: %+v", localItems)
	}

	// Connect SSH to test remote operations
	sessID, err := app.ConnectSSH(core.ConnectRequest{
		Address:  "127.0.0.1",
		Port:     22,
		Username: "user",
		Password: "password",
	})
	if err != nil {
		t.Fatalf("ConnectSSH failed: %v", err)
	}
	defer app.DisconnectSession(sessID)

	remoteItems, err := app.ListRemoteDir(sessID, "/remote/path")
	if err != nil {
		t.Fatalf("ListRemoteDir failed: %v", err)
	}
	if len(remoteItems) != 1 || remoteItems[0].Name != "remote_file.txt" {
		t.Fatalf("unexpected remote items: %+v", remoteItems)
	}

	if err := app.CreateRemoteDir(sessID, "/remote/path/newdir"); err != nil {
		t.Fatalf("CreateRemoteDir failed: %v", err)
	}

	if err := app.DeleteRemoteItem(sessID, "/remote/path/remote_file.txt"); err != nil {
		t.Fatalf("DeleteRemoteItem failed: %v", err)
	}

	// Test upload
	upTaskID, err := app.StartSftpUpload(sessID, testFilePath, "/remote/hello.txt")
	if err != nil {
		t.Fatalf("StartSftpUpload failed: %v", err)
	}
	if upTaskID == "" {
		t.Fatalf("expected non-empty upTaskID")
	}

	// Test download
	downDest := filepath.Join(tmpDir, "downloaded.txt")
	downTaskID, err := app.StartSftpDownload(sessID, "/remote/remote_file.txt", downDest)
	if err != nil {
		t.Fatalf("StartSftpDownload failed: %v", err)
	}
	if downTaskID == "" {
		t.Fatalf("expected non-empty downTaskID")
	}

	// Give goroutines a moment to register/run
	time.Sleep(50 * time.Millisecond)

	active := app.GetActiveTransfers()
	if len(active) < 2 {
		t.Fatalf("expected at least 2 active transfers, got %d", len(active))
	}

	// Cancel transfer test
	_ = app.CancelTransfer(upTaskID)
}

func TestApp_PortForwarding_F13(t *testing.T) {
	fake := newFakeSshTransport()
	tmpVault := filepath.Join(t.TempDir(), "test_forward.vault")
	store := vault.NewStore(vault.StoreOptions{FilePath: tmpVault})
	if err := store.Initialize(context.Background(), ""); err != nil {
		t.Fatalf("store.Initialize failed: %v", err)
	}

	var app *App
	app = NewAppWithDependencies(fake, nil, store, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})

	// 1. Save forward rules (-L, -R, -D)
	localRule := core.ForwardRule{
		ID:          "rule-loc-1",
		Label:       "Web Forward",
		Type:        core.ForwardLocal,
		BindAddress: "127.0.0.1",
		BindPort:    8080,
		TargetHost:  "10.0.0.5",
		TargetPort:  80,
		AutoStart:   true,
		HostID:      "host-test-1",
	}
	if err := app.SaveForwardRule(localRule); err != nil {
		t.Fatalf("SaveForwardRule local failed: %v", err)
	}

	remoteRule := core.ForwardRule{
		ID:          "rule-rem-1",
		Label:       "Remote Reverse",
		Type:        core.ForwardRemote,
		BindAddress: "0.0.0.0",
		BindPort:    2222,
		TargetHost:  "127.0.0.1",
		TargetPort:  22,
		AutoStart:   false,
	}
	if err := app.SaveForwardRule(remoteRule); err != nil {
		t.Fatalf("SaveForwardRule remote failed: %v", err)
	}

	socksRule := core.ForwardRule{
		ID:          "rule-socks-1",
		Label:       "SOCKS5 Proxy",
		Type:        core.ForwardDynamic,
		BindAddress: "127.0.0.1",
		BindPort:    1080,
		AutoStart:   false,
	}
	if err := app.SaveForwardRule(socksRule); err != nil {
		t.Fatalf("SaveForwardRule socks failed: %v", err)
	}

	// 2. List rules
	rules, err := app.ListForwardRules()
	if err != nil {
		t.Fatalf("ListForwardRules failed: %v", err)
	}
	if len(rules) != 3 {
		t.Fatalf("expected 3 rules, got %d", len(rules))
	}

	// 3. Connect SSH session
	sessID, err := app.ConnectSSH(core.ConnectRequest{
		Address:  "127.0.0.1",
		Port:     22,
		Username: "user",
		Password: "password",
	})
	if err != nil {
		t.Fatalf("ConnectSSH failed: %v", err)
	}
	defer app.DisconnectSession(sessID)

	// 4. Start tunnel for local rule
	tunID, err := app.StartForwardTunnel(sessID, "rule-loc-1")
	if err != nil {
		t.Fatalf("StartForwardTunnel failed: %v", err)
	}
	if tunID == "" {
		t.Fatal("expected non-empty tunnel ID")
	}

	// 5. Verify active tunnels
	active := app.GetActiveTunnels()
	if len(active) != 1 || active[0].Type != core.ForwardLocal || active[0].Status != "active" {
		t.Fatalf("unexpected active tunnels: %+v", active)
	}

	// 6. Stop tunnel
	if err := app.StopForwardTunnel(tunID); err != nil {
		t.Fatalf("StopForwardTunnel failed: %v", err)
	}
	activeAfterStop := app.GetActiveTunnels()
	if len(activeAfterStop) != 0 {
		t.Fatalf("expected 0 active tunnels, got %d", len(activeAfterStop))
	}

	// 7. Delete rule
	if err := app.DeleteForwardRule("rule-rem-1"); err != nil {
		t.Fatalf("DeleteForwardRule failed: %v", err)
	}
	rulesAfterDel, _ := app.ListForwardRules()
	if len(rulesAfterDel) != 2 {
		t.Fatalf("expected 2 rules after deletion, got %d", len(rulesAfterDel))
	}
}

func TestApp_ProxyProfiles_F14(t *testing.T) {
	fake := newFakeSshTransport()
	tmpVault := filepath.Join(t.TempDir(), "test_proxy.vault")
	store := vault.NewStore(vault.StoreOptions{FilePath: tmpVault})
	if err := store.Initialize(context.Background(), ""); err != nil {
		t.Fatalf("store.Initialize failed: %v", err)
	}

	var app *App
	app = NewAppWithDependencies(fake, nil, store, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})

	// 1. Create a Bastion Host and a Target Host in the vault
	bastionHost := core.HostRecord{
		ID:      "host-bastion",
		Label:   "Bastion Jumphost",
		Address: "bastion.corp.net",
		Port:    2222,
	}
	if err := app.SaveHost(bastionHost); err != nil {
		t.Fatalf("SaveHost bastion failed: %v", err)
	}

	// 2. Create Proxy Profiles (Jump and SOCKS5)
	jumpProf := core.ProxyProfile{
		ID:          "prof-jump-1",
		Name:        "Corp Bastion Jump",
		Type:        core.ProxyTypeJump,
		JumpHostIDs: []string{"host-bastion"},
	}
	if err := app.SaveProxyProfile(jumpProf); err != nil {
		t.Fatalf("SaveProxyProfile jump failed: %v", err)
	}

	socksProf := core.ProxyProfile{
		ID:            "prof-socks-1",
		Name:          "Local SOCKS5 Proxy",
		Type:          core.ProxyTypeSocks5,
		SocksAddress:  "127.0.0.1:1080",
		SocksUsername: "proxyuser",
		SocksPassword: "supersecretproxypass",
	}
	if err := app.SaveProxyProfile(socksProf); err != nil {
		t.Fatalf("SaveProxyProfile socks failed: %v", err)
	}

	// 3. Verify ListProxyProfiles masks secrets and reports HasPassword
	profs, err := app.ListProxyProfiles()
	if err != nil {
		t.Fatalf("ListProxyProfiles failed: %v", err)
	}
	if len(profs) != 2 {
		t.Fatalf("expected 2 proxy profiles, got %d", len(profs))
	}

	var foundSocks *core.ProxyProfileSummary
	for i := range profs {
		if profs[i].ID == "prof-socks-1" {
			foundSocks = &profs[i]
			break
		}
	}
	if foundSocks == nil {
		t.Fatal("prof-socks-1 not found in summary")
	}
	if !foundSocks.HasPassword {
		t.Error("expected HasPassword to be true for socks profile")
	}

	// 4. Update profile without password and verify password is preserved
	updateProf := core.ProxyProfile{
		ID:            "prof-socks-1",
		Name:          "Renamed SOCKS5",
		Type:          core.ProxyTypeSocks5,
		SocksAddress:  "127.0.0.1:1081",
		SocksUsername: "proxyuser",
		SocksPassword: "", // empty, should preserve existing
	}
	if err := app.SaveProxyProfile(updateProf); err != nil {
		t.Fatalf("SaveProxyProfile update failed: %v", err)
	}

	rawPayload, err := app.vaultStore.GetPayload()
	if err != nil {
		t.Fatalf("GetPayload failed: %v", err)
	}
	for _, p := range rawPayload.ProxyProfiles {
		if p.ID == "prof-socks-1" {
			if p.SocksPassword != "supersecretproxypass" {
				t.Fatalf("expected preserved password 'supersecretproxypass', got %q", p.SocksPassword)
			}
			if p.SocksAddress != "127.0.0.1:1081" {
				t.Fatalf("expected updated address '127.0.0.1:1081', got %q", p.SocksAddress)
			}
		}
	}

	// 5. Test ExportProxychainsConfig
	cfgText, err := app.ExportProxychainsConfig()
	if err != nil {
		t.Fatalf("ExportProxychainsConfig failed: %v", err)
	}
	if !strings.Contains(cfgText, "strict_chain") || !strings.Contains(cfgText, "127.0.0.1") || !strings.Contains(cfgText, "1081") || !strings.Contains(cfgText, "proxyuser") {
		t.Errorf("unexpected proxychains config:\n%s", cfgText)
	}

	// 6. Target host associated with Jump Profile
	targetHost := core.HostRecord{
		ID:             "host-internal-app",
		Label:          "Internal Application",
		Address:        "10.0.0.50",
		Port:           22,
		ProxyProfileID: "prof-jump-1",
	}
	if err := app.SaveHost(targetHost); err != nil {
		t.Fatalf("SaveHost target failed: %v", err)
	}

	// Verify ConnectSavedHost builds config with JumpChain
	sessID, err := app.ConnectSavedHost("host-internal-app", core.TerminalSize{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatalf("ConnectSavedHost with jump profile failed: %v", err)
	}
	if sessID == "" {
		t.Fatal("expected non-empty session ID")
	}
	_ = app.DisconnectSession(sessID)

	// 7. Delete proxy profile and verify host reference cleared
	if err := app.DeleteProxyProfile("prof-jump-1"); err != nil {
		t.Fatalf("DeleteProxyProfile failed: %v", err)
	}
	summary, _ := app.GetVaultSummary()
	for _, h := range summary.Hosts {
		if h.ID == "host-internal-app" {
			if h.ProxyProfileID != "" {
				t.Errorf("expected cleared ProxyProfileID on target host, got %q", h.ProxyProfileID)
			}
		}
	}
}

func TestApp_Snippets_F15(t *testing.T) {
	fake := newFakeSshTransport()
	tmpVault := filepath.Join(t.TempDir(), "test_snippets.vault")
	store := vault.NewStore(vault.StoreOptions{FilePath: tmpVault})
	if err := store.Initialize(context.Background(), ""); err != nil {
		t.Fatalf("store.Initialize failed: %v", err)
	}

	var app *App
	app = NewAppWithDependencies(fake, nil, store, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})

	// 1. Create identity, host, and connect
	ident := core.IdentityRecord{
		ID:         "ident-pg",
		Label:      "Postgres Admin",
		Username:   "postgres",
		AuthMethod: core.AuthPassword,
		Password:   "pgpass",
	}
	if err := app.SaveIdentity(ident); err != nil {
		t.Fatalf("SaveIdentity failed: %v", err)
	}

	host := core.HostRecord{
		ID:         "host-prod-db",
		Label:      "Production Database",
		Address:    "192.168.10.50",
		Port:       5432,
		IdentityID: "ident-pg",
		InitialDir: "/var/lib/postgresql",
	}
	if err := app.SaveHost(host); err != nil {
		t.Fatalf("SaveHost failed: %v", err)
	}

	sessID, err := app.ConnectSavedHost("host-prod-db", core.TerminalSize{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatalf("ConnectSavedHost failed: %v", err)
	}
	defer app.DisconnectSession(sessID)

	// 2. Save a snippet with builtins and user variables
	snip := core.Snippet{
		ID:               "snip-pg-backup",
		Name:             "PostgreSQL Dump",
		Description:      "Dumps database to designated file with timestamps",
		Body:             "pg_dump -h {{HOST}} -p {{PORT}} -U {{USER=postgres}} -f {{DEST_FILE=/backups/db.sql}} {{DB_NAME}}",
		Tags:             []string{"database", "backup", "postgres"},
		ConfirmBeforeRun: true,
	}
	if err := app.SaveSnippet(snip); err != nil {
		t.Fatalf("SaveSnippet failed: %v", err)
	}

	// 3. List snippets and verify variables were auto-extracted
	snippets, err := app.ListSnippets()
	if err != nil {
		t.Fatalf("ListSnippets failed: %v", err)
	}
	if len(snippets) != 1 {
		t.Fatalf("expected 1 snippet, got %d", len(snippets))
	}
	if len(snippets[0].Variables) < 4 {
		t.Fatalf("expected at least 4 auto-extracted variables, got %d", len(snippets[0].Variables))
	}

	// 4. Test GetSnippetContext for active session
	ctx := app.GetSnippetContext(sessID)
	if ctx.IP != "192.168.10.50" || ctx.Port != 5432 || ctx.WorkingDir != "/var/lib/postgresql" {
		t.Errorf("unexpected snippet context: %+v", ctx)
	}

	// 5. Test ResolveSnippetTemplate
	userVals := map[string]string{
		"DB_NAME": "analytics_prod",
	}
	resolved, err := app.ResolveSnippetTemplate("snip-pg-backup", sessID, userVals)
	if err != nil {
		t.Fatalf("ResolveSnippetTemplate failed: %v", err)
	}
	expected := "pg_dump -h 192.168.10.50 -p 5432 -U postgres -f /backups/db.sql analytics_prod"
	if resolved != expected {
		t.Errorf("got resolved %q, want %q", resolved, expected)
	}

	// 6. Test ExecuteSnippet writes into session PTY
	if err := app.ExecuteSnippet(sessID, "snip-pg-backup", userVals); err != nil {
		t.Fatalf("ExecuteSnippet failed: %v", err)
	}

	// 7. Test DeleteSnippet
	if err := app.DeleteSnippet("snip-pg-backup"); err != nil {
		t.Fatalf("DeleteSnippet failed: %v", err)
	}
	snippetsAfter, _ := app.ListSnippets()
	if len(snippetsAfter) != 0 {
		t.Errorf("expected 0 snippets after delete, got %d", len(snippetsAfter))
	}
}

func TestApp_Totp_F20(t *testing.T) {
	fake := newFakeSshTransport()
	tmpVault := filepath.Join(t.TempDir(), "test_totp.vault")
	store := vault.NewStore(vault.StoreOptions{FilePath: tmpVault})
	if err := store.Initialize(context.Background(), ""); err != nil {
		t.Fatalf("store.Initialize failed: %v", err)
	}

	var app *App
	app = NewAppWithDependencies(fake, nil, store, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})

	// 1. Create a host
	host := core.HostRecord{
		ID:      "host-bastion",
		Label:   "Corporate Bastion",
		Address: "10.0.0.1",
		Port:    22,
	}
	if err := app.SaveHost(host); err != nil {
		t.Fatalf("SaveHost failed: %v", err)
	}

	// 2. Save TOTP record linked to host (F-20)
	totp1 := core.TotpRecord{
		ID:        "totp-bastion",
		Label:     "secops@corp.internal",
		Issuer:    "CorpBastion",
		Secret:    "JBSWY3DPEHPK3PXP", // base32
		Algorithm: "SHA1",
		Digits:    6,
		Period:    30,
		HostID:    "host-bastion",
	}
	if err := app.SaveTotpRecord(totp1); err != nil {
		t.Fatalf("SaveTotpRecord failed: %v", err)
	}

	// 3. Parse and save another TOTP via otpauth:// URI
	parsed, err := app.ParseOTPAuthURI("otpauth://totp/GitHub:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub")
	if err != nil {
		t.Fatalf("ParseOTPAuthURI failed: %v", err)
	}
	if err := app.SaveTotpRecord(*parsed); err != nil {
		t.Fatalf("SaveTotpRecord from URI failed: %v", err)
	}

	// 4. List TOTP summaries (Golden Rule 2: secret is masked/not exposed)
	list, err := app.ListTotpRecords()
	if err != nil {
		t.Fatalf("ListTotpRecords failed: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 totp records, got %d", len(list))
	}
	for _, item := range list {
		if item.Label == "" {
			t.Errorf("empty label in totp summary: %+v", item)
		}
	}

	// 5. GetTotpCode
	resp, err := app.GetTotpCode("totp-bastion")
	if err != nil {
		t.Fatalf("GetTotpCode failed: %v", err)
	}
	if len(resp.Code) != 6 {
		t.Errorf("expected 6-digit code, got %q", resp.Code)
	}
	if resp.RemainingSeconds <= 0 || resp.RemainingSeconds > 30 {
		t.Errorf("invalid remaining seconds: %d", resp.RemainingSeconds)
	}

	// 6. GetAllTotpCodes
	allCodes, err := app.GetAllTotpCodes()
	if err != nil {
		t.Fatalf("GetAllTotpCodes failed: %v", err)
	}
	if len(allCodes) != 2 {
		t.Fatalf("expected 2 codes, got %d", len(allCodes))
	}

	// 7. Test terminal 2FA prompt auto-injection (F-20)
	sessID, err := app.ConnectSavedHost("host-bastion", core.TerminalSize{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatalf("ConnectSavedHost failed: %v", err)
	}
	defer app.DisconnectSession(sessID)

	// Inject with empty totpID -> auto resolves from host-bastion
	if err := app.InjectTotpCode(sessID, ""); err != nil {
		t.Fatalf("InjectTotpCode auto-resolve failed: %v", err)
	}

	// Inject with explicit totpID
	if err := app.InjectTotpCode(sessID, "totp-bastion"); err != nil {
		t.Fatalf("InjectTotpCode explicit failed: %v", err)
	}

	// 8. Delete record
	if err := app.DeleteTotpRecord("totp-bastion"); err != nil {
		t.Fatalf("DeleteTotpRecord failed: %v", err)
	}
	listAfter, _ := app.ListTotpRecords()
	if len(listAfter) != 1 {
		t.Errorf("expected 1 record after delete, got %d", len(listAfter))
	}
}

func TestApp_Notes_F17(t *testing.T) {
	fake := newFakeSshTransport()
	tmpVault := filepath.Join(t.TempDir(), "test_notes.vault")
	store := vault.NewStore(vault.StoreOptions{FilePath: tmpVault})
	if err := store.Initialize(context.Background(), ""); err != nil {
		t.Fatalf("store.Initialize failed: %v", err)
	}

	app := NewAppWithDependencies(fake, nil, store, func(_ context.Context, _ string, _ ...interface{}) {})

	// 1. Save a host
	if err := app.SaveHost(core.HostRecord{
		ID:      "host-web",
		Label:   "Web Cluster 01",
		Address: "192.168.10.20",
		Port:    22,
	}); err != nil {
		t.Fatalf("SaveHost failed: %v", err)
	}

	// 2. Create a folder for host-web (F-17)
	folder, err := app.SaveNote(core.NotePage{
		ID:       "folder-runbooks",
		HostID:   "host-web",
		IsFolder: true,
		Title:    "Operations Runbooks",
	})
	if err != nil {
		t.Fatalf("SaveNote folder failed: %v", err)
	}
	if !folder.IsFolder || folder.Title != "Operations Runbooks" {
		t.Errorf("unexpected folder: %+v", folder)
	}

	// 3. Create a subpage inside the folder (F-17)
	subpage, err := app.SaveNote(core.NotePage{
		ID:       "note-nginx",
		HostID:   "host-web",
		ParentID: "folder-runbooks",
		IsFolder: false,
		Title:    "Nginx Reload & TLS Renewal",
		Type:     "markdown",
		Body:     "# Nginx Runbook\n\nRun `sudo systemctl reload nginx` after certbot renew.",
	})
	if err != nil {
		t.Fatalf("SaveNote subpage failed: %v", err)
	}
	if subpage.ParentID != "folder-runbooks" {
		t.Errorf("expected parent folder-runbooks, got %q", subpage.ParentID)
	}

	// 4. Create a global note
	_, err = app.SaveNote(core.NotePage{
		ID:       "note-global",
		HostID:   "",
		IsFolder: false,
		Title:    "Incident Response Contacts",
		Body:     "PagerDuty escalation policy and security team contacts.",
	})
	if err != nil {
		t.Fatalf("SaveNote global failed: %v", err)
	}

	// 5. ListNotes by scope
	allNotes, err := app.ListNotes("all")
	if err != nil || len(allNotes) != 3 {
		t.Fatalf("expected 3 total notes, got %d (err: %v)", len(allNotes), err)
	}

	hostNotes, err := app.ListNotes("host-web")
	if err != nil || len(hostNotes) != 2 {
		t.Fatalf("expected 2 host-web notes, got %d (err: %v)", len(hostNotes), err)
	}

	globalNotes, err := app.ListNotes("global")
	if err != nil || len(globalNotes) != 1 {
		t.Fatalf("expected 1 global note, got %d (err: %v)", len(globalNotes), err)
	}

	// 6. GetNote
	fetched, err := app.GetNote("note-nginx")
	if err != nil || fetched.Title != "Nginx Reload & TLS Renewal" {
		t.Fatalf("GetNote failed: %+v, err: %v", fetched, err)
	}

	// 7. SearchNotes (F-17, F-02)
	searchRes, err := app.SearchNotes("systemctl reload nginx")
	if err != nil || len(searchRes) != 1 || searchRes[0].Note.ID != "note-nginx" {
		t.Fatalf("SearchNotes failed: %+v, err: %v", searchRes, err)
	}

	// 8. Delete folder recursively deletes child subpages
	if err := app.DeleteNote("folder-runbooks"); err != nil {
		t.Fatalf("DeleteNote folder failed: %v", err)
	}
	remaining, _ := app.ListNotes("all")
	if len(remaining) != 1 || remaining[0].ID != "note-global" {
		t.Fatalf("expected only note-global remaining after recursive folder delete, got %+v", remaining)
	}
}

func TestApp_SessionLogging_F21(t *testing.T) {
	fake := newFakeSshTransport()
	tmpDir := t.TempDir()
	tmpVault := filepath.Join(tmpDir, "test_logging.vault")
	store := vault.NewStore(vault.StoreOptions{FilePath: tmpVault})
	if err := store.Initialize(context.Background(), ""); err != nil {
		t.Fatalf("store.Initialize failed: %v", err)
	}

	var app *App
	app = NewAppWithDependencies(fake, nil, store, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})
	app.logMgr = core.NewSessionLogManager(filepath.Join(tmpDir, "logs"))

	// 1. Save identity with password and host with SessionLogging = true
	if err := app.SaveIdentity(core.IdentityRecord{
		ID:         "id-log",
		Label:      "Audit User",
		Username:   "auditor",
		AuthMethod: core.AuthPassword,
		Password:   "TopSecretAuditPass99!",
	}); err != nil {
		t.Fatalf("SaveIdentity failed: %v", err)
	}

	enableLog := true
	if err := app.SaveHost(core.HostRecord{
		ID:             "host-logged",
		Label:          "Audit DB Server",
		Address:        "10.20.30.40",
		Port:           22,
		IdentityID:     "id-log",
		SessionLogging: &enableLog,
	}); err != nil {
		t.Fatalf("SaveHost failed: %v", err)
	}

	// 2. ConnectSavedHost should automatically start session logging because SessionLogging is true
	sessID, err := app.ConnectSavedHost("host-logged", core.TerminalSize{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatalf("ConnectSavedHost failed: %v", err)
	}

	st, err := app.GetSessionLogStatus(sessID)
	if err != nil || !st.Active || st.LogID == "" {
		t.Fatalf("expected active session log after ConnectSavedHost, got %+v (err: %v)", st, err)
	}

	// 3. Simulate output & password prompt via logMgr (and InjectSessionPassword)
	app.logMgr.WriteOutput(sessID, "auditor@db:~$ sudo -i\r\n[sudo] password for auditor: ")
	if err := app.InjectSessionPassword(sessID); err != nil {
		t.Fatalf("InjectSessionPassword failed: %v", err)
	}
	// Even if remote echoed the password before newline, it must be suppressed
	app.logMgr.WriteOutput(sessID, "TopSecretAuditPass99!\r\nroot@db:~# whoami\r\nroot\r\n")

	// 4. Stop logging and read transcript
	stoppedSt, err := app.StopSessionLogging(sessID)
	if err != nil || stoppedSt.Active {
		t.Fatalf("StopSessionLogging failed: %+v, err: %v", stoppedSt, err)
	}

	transcript, err := app.ReadSessionLog(st.LogID)
	if err != nil {
		t.Fatalf("ReadSessionLog failed: %v", err)
	}
	if !strings.Contains(transcript, "root@db:~# whoami") {
		t.Fatalf("expected whoami command in transcript, got:\n%s", transcript)
	}
	if strings.Contains(transcript, "TopSecretAuditPass99!") {
		t.Fatalf("SECURITY VIOLATION: password leaked into session transcript:\n%s", transcript)
	}

	logs, err := app.ListSessionLogs()
	if err != nil || len(logs) != 1 {
		t.Fatalf("expected 1 session log record, got %d (err: %v)", len(logs), err)
	}

	if err := app.DeleteSessionLog(st.LogID); err != nil {
		t.Fatalf("DeleteSessionLog failed: %v", err)
	}
}

func TestApp_BroadcastInput_F26(t *testing.T) {
	fake := newFakeSshTransport()
	tmpVault := filepath.Join(t.TempDir(), "test_broadcast.vault")
	store := vault.NewStore(vault.StoreOptions{FilePath: tmpVault})
	if err := store.Initialize(context.Background(), ""); err != nil {
		t.Fatalf("store.Initialize failed: %v", err)
	}

	var app *App
	app = NewAppWithDependencies(fake, nil, store, func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == "ssh:hostkey-prompt" && len(optionalData) > 0 {
			if info, ok := optionalData[0].(core.HostKeyInfo); ok {
				go func() {
					_ = app.ResolveHostKeyPrompt(info.HostPattern, info.Port, true)
				}()
			}
		}
	})

	sessID1, err := app.ConnectSSH(core.ConnectRequest{
		Address:  "10.0.0.1",
		Port:     22,
		Username: "node1",
		Password: "pw1",
		Size:     core.TerminalSize{Cols: 80, Rows: 24},
	})
	if err != nil {
		t.Fatalf("ConnectSSH 1 failed: %v", err)
	}

	sessID2, err := app.ConnectSSH(core.ConnectRequest{
		Address:  "10.0.0.2",
		Port:     22,
		Username: "node2",
		Password: "pw2",
		Size:     core.TerminalSize{Cols: 80, Rows: 24},
	})
	if err != nil {
		t.Fatalf("ConnectSSH 2 failed: %v", err)
	}

	// Broadcast command to both sessions simultaneously
	cmd := "sudo systemctl restart nginx\n"
	if err := app.BroadcastInput([]string{sessID1, sessID2}, cmd); err != nil {
		t.Fatalf("BroadcastInput failed: %v", err)
	}

	// Verify broadcast command was delivered to stdin
	if !strings.Contains(fake.stdinBuf.String(), cmd) {
		t.Fatalf("expected broadcast command %q in stdin, got %q", cmd, fake.stdinBuf.String())
	}
}
