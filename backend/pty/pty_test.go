package pty

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestLocalPTY_Cmd_F23(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sess, err := StartShell(ctx, "cmd", core.TerminalSize{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatalf("failed to start local shell: %v", err)
	}
	defer func() { _ = sess.Close() }()

	if !strings.HasPrefix(sess.ID(), "local-") {
		t.Errorf("expected session ID to have prefix local-, got %s", sess.ID())
	}
	if sess.Title() != "Local (CMD)" {
		t.Errorf("expected title Local (CMD), got %s", sess.Title())
	}

	outCh := make(chan string, 100)
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := sess.Stdout().Read(buf)
			if n > 0 {
				outCh <- string(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	// Wait for prompt before sending input
	promptSeen := false
	promptTimeout := time.After(3 * time.Second)
	for !promptSeen {
		select {
		case chunk := <-outCh:
			t.Logf("INITIAL CHUNK: %q", chunk)
			if strings.Contains(chunk, ">") {
				promptSeen = true
			}
		case <-promptTimeout:
			promptSeen = true
		}
	}

	time.Sleep(100 * time.Millisecond)
	_, err = io.WriteString(sess.Stdin(), "echo DOUBLEAGENT_CMD_OK\r\n")
	if err != nil {
		t.Fatalf("failed to write to stdin: %v", err)
	}

	found := false
	timeout := time.After(3 * time.Second)

loop:
	for {
		select {
		case chunk := <-outCh:
			t.Logf("CMD CHUNK: %q", chunk)
			if strings.Contains(chunk, "DOUBLEAGENT_CMD_OK") {
				found = true
				break loop
			}
		case <-timeout:
			break loop
		}
	}

	if !found {
		t.Errorf("expected output to contain DOUBLEAGENT_CMD_OK")
	}

	if err := sess.Resize(core.TerminalSize{Cols: 120, Rows: 40}); err != nil {
		t.Errorf("failed to resize pty: %v", err)
	}

	if err := sess.Close(); err != nil {
		t.Errorf("failed to close pty: %v", err)
	}
}

func TestLocalPTY_PowerShell_F23(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sess, err := StartShell(ctx, "powershell", core.TerminalSize{Cols: 80, Rows: 24})
	if err != nil {
		t.Fatalf("failed to start local shell: %v", err)
	}
	defer func() { _ = sess.Close() }()

	if !strings.HasPrefix(sess.ID(), "local-") {
		t.Errorf("expected session ID to have prefix local-, got %s", sess.ID())
	}
	if sess.Title() != "Local (PowerShell)" {
		t.Errorf("expected title Local (PowerShell), got %s", sess.Title())
	}

	outCh := make(chan string, 100)
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := sess.Stdout().Read(buf)
			if n > 0 {
				outCh <- string(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	// Wait for prompt before sending input
	promptSeen := false
	promptTimeout := time.After(4 * time.Second)
	for !promptSeen {
		select {
		case chunk := <-outCh:
			t.Logf("PS INITIAL CHUNK: %q", chunk)
			if strings.Contains(chunk, ">") {
				promptSeen = true
			}
		case <-promptTimeout:
			promptSeen = true
		}
	}

	time.Sleep(100 * time.Millisecond)
	_, err = io.WriteString(sess.Stdin(), "Write-Output 'POWERSHELL_F23_OK'\r\n")
	if err != nil {
		t.Fatalf("failed to write to stdin: %v", err)
	}

	found := false
	timeout := time.After(4 * time.Second)

loop:
	for {
		select {
		case chunk := <-outCh:
			t.Logf("RECEIVED CHUNK: %q", chunk)
			if strings.Contains(chunk, "POWERSHELL_F23_OK") {
				found = true
				break loop
			}
		case <-timeout:
			break loop
		}
	}

	if !found {
		t.Errorf("expected output to contain POWERSHELL_F23_OK")
	}
}

func TestLocalPTY_WorkingDirAndRoot_F10(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Test launching shell with working directory set to temporary folder
	tempDir := t.TempDir()
	sess, err := StartShellWithOptions(ctx, ShellOptions{
		ShellType:  "cmd",
		WorkingDir: tempDir,
		AsRoot:     false,
		Size:       core.TerminalSize{Cols: 80, Rows: 24},
	})
	if err != nil {
		t.Fatalf("failed to start shell with working dir: %v", err)
	}

	_ = sess.Close()

	// Test AsRoot title flag
	rootSess, err := StartShellWithOptions(ctx, ShellOptions{
		ShellType: "cmd",
		AsRoot:    true,
		Size:      core.TerminalSize{Cols: 80, Rows: 24},
	})
	if err != nil {
		t.Fatalf("failed to start root shell: %v", err)
	}
	defer func() { _ = rootSess.Close() }()

	if !strings.Contains(rootSess.Title(), "Admin") && !strings.Contains(rootSess.Title(), "Root") {
		t.Errorf("expected admin/root title, got %s", rootSess.Title())
	}
}
