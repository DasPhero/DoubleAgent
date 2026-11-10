package vault_test

import (
	"os"
	"path/filepath"
	"testing"

	"doubleagent/backend/core"
	"doubleagent/backend/vault"
)

func TestVault_Merge_F29(t *testing.T) {
	// 1. Local payload has host1 and group1
	local := core.VaultPayload{
		Hosts: []core.HostRecord{
			{ID: "host-1", Label: "Bastion", Address: "10.0.0.1", Port: 22},
		},
		Groups: []core.GroupRecord{
			{ID: "grp-1", Name: "Production"},
		},
		Snippets: []core.Snippet{
			{ID: "snip-1", Name: "Uptime", Body: "uptime -p"},
		},
	}

	// 2. Remote payload has host2 (new addition), group1 (identical), and a new note
	remote := core.VaultPayload{
		Hosts: []core.HostRecord{
			{ID: "host-2", Label: "Database", Address: "10.0.0.2", Port: 22},
		},
		Groups: []core.GroupRecord{
			{ID: "grp-1", Name: "Production"}, // identical
		},
		Notes: []core.NotePage{
			{ID: "note-1", Title: "Runbook", Body: "Standard operating procedures"},
		},
	}

	merged, report := vault.MergeVaultPayloads(local, remote)

	if report.HasConflicts {
		t.Fatalf("expected no conflicts, got %d conflicts: %+v", len(report.Conflicts), report.Conflicts)
	}
	if report.AutoMerged != 2 {
		t.Errorf("expected 2 auto-merged items (host-2, note-1), got %d", report.AutoMerged)
	}

	if len(merged.Hosts) != 2 {
		t.Errorf("expected 2 hosts in merged payload, got %d", len(merged.Hosts))
	}
	if len(merged.Groups) != 1 {
		t.Errorf("expected 1 group in merged payload, got %d", len(merged.Groups))
	}
	if len(merged.Snippets) != 1 {
		t.Errorf("expected 1 snippet in merged payload, got %d", len(merged.Snippets))
	}
	if len(merged.Notes) != 1 {
		t.Errorf("expected 1 note in merged payload, got %d", len(merged.Notes))
	}
}

func TestVault_ConflictDetection_F29(t *testing.T) {
	local := core.VaultPayload{
		Hosts: []core.HostRecord{
			{ID: "host-1", Label: "Bastion Local", Address: "10.0.0.1", Port: 22},
		},
		Notes: []core.NotePage{
			{ID: "note-1", Title: "Local Title", Body: "Local content"},
		},
	}

	remote := core.VaultPayload{
		Hosts: []core.HostRecord{
			{ID: "host-1", Label: "Bastion Remote", Address: "10.0.0.100", Port: 2222},
		},
		Notes: []core.NotePage{
			{ID: "note-1", Title: "Remote Title", Body: "Remote content modified elsewhere"},
		},
	}

	merged, report := vault.MergeVaultPayloads(local, remote)

	if !report.HasConflicts {
		t.Fatal("expected conflicts to be detected, but HasConflicts was false")
	}
	if len(report.Conflicts) != 2 {
		t.Fatalf("expected 2 conflicts (host-1, note-1), got %d", len(report.Conflicts))
	}

	// Verify defaults to local before resolution
	if len(merged.Hosts) != 1 || merged.Hosts[0].Label != "Bastion Local" {
		t.Errorf("expected merged host to default to local before resolution, got %v", merged.Hosts)
	}
}

func TestVault_ConflictResolution_F29(t *testing.T) {
	local := core.VaultPayload{
		Hosts: []core.HostRecord{
			{ID: "host-1", Label: "Host 1 Local", Address: "1.1.1.1", Port: 22},
			{ID: "host-2", Label: "Host 2 Local", Address: "2.2.2.2", Port: 22},
			{ID: "host-3", Label: "Host 3 Local", Address: "3.3.3.3", Port: 22},
		},
	}

	remote := core.VaultPayload{
		Hosts: []core.HostRecord{
			{ID: "host-1", Label: "Host 1 Remote", Address: "1.1.1.100", Port: 2222},
			{ID: "host-2", Label: "Host 2 Remote", Address: "2.2.2.200", Port: 2222},
			{ID: "host-3", Label: "Host 3 Remote", Address: "3.3.3.300", Port: 2222},
		},
	}

	resolutions := map[string]core.VaultConflictResolution{
		"host-1": core.ResolutionKeepRemote,
		"host-2": core.ResolutionKeepLocal,
		"host-3": core.ResolutionKeepBoth,
	}

	resolved := vault.ResolveVaultConflicts(local, remote, resolutions)

	// host-1 should be remote
	var h1 *core.HostRecord
	var h2 *core.HostRecord
	var h3Local *core.HostRecord
	var h3Synced *core.HostRecord

	for i := range resolved.Hosts {
		h := &resolved.Hosts[i]
		if h.ID == "host-1" {
			h1 = h
		}
		if h.ID == "host-2" {
			h2 = h
		}
		if h.ID == "host-3" {
			h3Local = h
		}
		if h.ID == "host-3-synced" {
			h3Synced = h
		}
	}

	if h1 == nil || h1.Label != "Host 1 Remote" {
		t.Errorf("expected host-1 to take remote version, got %+v", h1)
	}
	if h2 == nil || h2.Label != "Host 2 Local" {
		t.Errorf("expected host-2 to keep local version, got %+v", h2)
	}
	if h3Local == nil || h3Local.Label != "Host 3 Local" {
		t.Errorf("expected host-3 to retain local version, got %+v", h3Local)
	}
	if h3Synced == nil || h3Synced.Label != "Host 3 Remote (Synced)" {
		t.Errorf("expected host-3-synced with cloned remote version, got %+v", h3Synced)
	}
}

func TestVault_DetectSyncConflictFiles_F29(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "vault-sync-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create files:
	// 1. Normal active vault
	_ = os.WriteFile(filepath.Join(tempDir, "doubleagent.vault"), []byte("normal"), 0o600)
	// 2. Syncthing conflict file
	_ = os.WriteFile(filepath.Join(tempDir, "doubleagent.sync-conflict-20261110-120000-ABCDEF.vault"), []byte("conflict1"), 0o600)
	// 3. Google drive conflict file
	_ = os.WriteFile(filepath.Join(tempDir, "doubleagent (1).vault"), []byte("conflict2"), 0o600)
	// 4. Irrelevant file
	_ = os.WriteFile(filepath.Join(tempDir, "notes.txt"), []byte("ignore"), 0o600)

	detected := vault.DetectSyncConflictFiles(tempDir, "doubleagent.vault")

	if len(detected) != 2 {
		t.Fatalf("expected 2 detected conflict files, got %d: %v", len(detected), detected)
	}
}
