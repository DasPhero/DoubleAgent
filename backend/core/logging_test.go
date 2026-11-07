package core

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestSessionLogManager_TimestampsAndPasswordRedaction_F21(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSessionLogManager(tmpDir)

	status, err := mgr.StartSession("sess-1", "host-1", "Prod Bastion")
	if err != nil {
		t.Fatalf("StartSession failed: %v", err)
	}
	if !status.Active || status.LogID == "" {
		t.Fatalf("expected active status, got %+v", status)
	}

	// Register a known secret value as well
	mgr.RegisterSensitiveValue("sess-1", "SuperSecretVaultPass!")

	// 1. Write normal ANSI-colored terminal output
	mgr.WriteOutput("sess-1", "\x1b[32mops@bastion\x1b[0m:~$ uname -a\r\nLinux bastion 6.8.0 x86_64\r\n")

	// 2. Trigger a sudo password prompt; verify echoed characters on the prompt line are NEVER recorded
	mgr.WriteOutput("sess-1", "[sudo] password for ops: ")
	mgr.WriteOutput("sess-1", "MyTypedSudoPassword123") // even if echoed by a broken PTY, must be suppressed!
	mgr.NotifyInput("sess-1", "MyTypedSudoPassword123\r")
	mgr.WriteOutput("sess-1", "\r\nroot@bastion:/home/ops# id\r\nuid=0(root)\r\n")

	// 3. Verify registered sensitive value is redacted if it ever appears in output
	mgr.WriteOutput("sess-1", "echo SuperSecretVaultPass!\r\n")

	stopped, err := mgr.StopSession("sess-1")
	if err != nil {
		t.Fatalf("StopSession failed: %v", err)
	}
	if stopped.Active {
		t.Fatalf("expected inactive after StopSession")
	}

	content, err := mgr.ReadLog(status.LogID)
	if err != nil {
		t.Fatalf("ReadLog failed: %v", err)
	}

	if !strings.Contains(content, "Linux bastion 6.8.0 x86_64") {
		t.Fatalf("expected normal output in log, got:\n%s", content)
	}
	if !strings.Contains(content, "[PASSWORD ECHO SUPPRESSED]") {
		t.Fatalf("expected password prompt suppression marker in log, got:\n%s", content)
	}
	if strings.Contains(content, "MyTypedSudoPassword123") {
		t.Fatalf("SECURITY VIOLATION: password echo was recorded in session log:\n%s", content)
	}
	if strings.Contains(content, "SuperSecretVaultPass!") {
		t.Fatalf("SECURITY VIOLATION: registered secret was recorded in session log:\n%s", content)
	}
	if !strings.Contains(content, "[REDACTED]") {
		t.Fatalf("expected [REDACTED] placeholder in log, got:\n%s", content)
	}

	// Verify ExportLog and DeleteLog
	exportFile := filepath.Join(tmpDir, "exported.log")
	if err := mgr.ExportLog(status.LogID, exportFile); err != nil {
		t.Fatalf("ExportLog failed: %v", err)
	}
	if err := mgr.DeleteLog(status.LogID); err != nil {
		t.Fatalf("DeleteLog failed: %v", err)
	}
	if len(mgr.ListRecords()) != 0 {
		t.Fatalf("expected 0 records after DeleteLog, got %d", len(mgr.ListRecords()))
	}
}

func TestSessionLogManager_CarriageReturnAndLineEditing(t *testing.T) {
	tmpDir := t.TempDir()
	mgr := NewSessionLogManager(tmpDir)

	status, err := mgr.StartSession("sess-apt", "host-apt", "Ares")
	if err != nil {
		t.Fatalf("StartSession failed: %v", err)
	}

	// 1. Simulate typing a command with backspaces/erases: "sudo systemctl start nginx" -> erased to "sudo apt update"
	mgr.WriteOutput("sess-apt", "ares@ares:~$ sudo systemctl start nginx\x1b[2K\rares@ares:~$ sudo apt update\r\n")

	// 2. Simulate apt update progress overwriting the line with \r
	mgr.WriteOutput("sess-apt", "0% [Working]\r")
	mgr.WriteOutput("sess-apt", "0% [1 InRelease 8,192 B/46.6 kB 18%]\r")
	mgr.WriteOutput("sess-apt", "0% [Waiting for headers]\r")
	mgr.WriteOutput("sess-apt", "Get:1 https://download.docker.com/linux/debian bookworm InRelease [46.6 kB]\r\n")

	mgr.WriteOutput("sess-apt", "0% [Working]\r")
	mgr.WriteOutput("sess-apt", "Get:2 https://packages.microsoft.com/repos/code stable InRelease [3,590 B]\r\n")

	_, _ = mgr.StopSession("sess-apt")

	content, err := mgr.ReadLog(status.LogID)
	if err != nil {
		t.Fatalf("ReadLog failed: %v", err)
	}

	// Verify that the command was recorded cleanly without leftover erased fragments
	if strings.Contains(content, "start nginx") {
		t.Fatalf("expected erased command to be overwritten, got:\n%s", content)
	}
	if !strings.Contains(content, "sudo apt update") {
		t.Fatalf("expected final command in log, got:\n%s", content)
	}

	// Verify progress bar lines were overwritten and Get:1 and Get:2 are clean single lines
	if !strings.Contains(content, "Get:1 https://download.docker.com/linux/debian bookworm InRelease [46.6 kB]") {
		t.Fatalf("expected clean Get:1 line, got:\n%s", content)
	}
	if !strings.Contains(content, "Get:2 https://packages.microsoft.com/repos/code stable InRelease [3,590 B]") {
		t.Fatalf("expected clean Get:2 line, got:\n%s", content)
	}

	// Verify there is no concatenated mess like "0% [Working]0% [Waiting for headers]"
	if strings.Contains(content, "0% [Working]0%") {
		t.Fatalf("expected progress bar overwrites to avoid concatenation, got:\n%s", content)
	}
}

