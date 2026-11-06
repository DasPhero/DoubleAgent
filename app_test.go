package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"doubleagent/backend/core"
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
