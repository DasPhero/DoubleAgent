package data

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestWorkspaceStore_SaveLoadRoundtrip_F27(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "workspace.json")
	store := NewWorkspaceStore(path)

	// Initially non-existent file
	initial, err := store.Load()
	if err != nil {
		t.Fatalf("Load on non-existent file failed: %v", err)
	}
	if !initial.AutoRestore {
		t.Errorf("expected default AutoRestore true, got false")
	}
	if len(initial.Tabs) != 0 {
		t.Errorf("expected 0 tabs, got %d", len(initial.Tabs))
	}

	// Save workspace state
	state := core.WorkspaceState{
		Version:     1,
		ActiveTabID: "tab-1",
		AutoRestore: true,
		Tabs: []core.TabItem{
			{
				ID:           "tab-1",
				Title:        "Server Alpha",
				HostID:       "host-alpha",
				ActivePaneID: "pane-1",
				RootNode: &core.WorkspaceNode{
					Type:      core.NodeTypeSplit,
					ID:        "split-1",
					Direction: core.SplitHorizontal,
					Children: []*core.WorkspaceNode{
						{
							Type:      core.NodeTypePane,
							ID:        "pane-1",
							SessionID: "sess-1",
							HostID:    "host-alpha",
							Title:     "Server Alpha",
							PaneType:  "terminal",
						},
						{
							Type:        core.NodeTypePane,
							ID:          "pane-2",
							HostID:      "host-alpha",
							Title:       "Notes - Alpha",
							PaneType:    "notes",
							NotesHostID: "host-alpha",
						},
					},
				},
			},
		},
	}

	if err := store.Save(state); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Load and verify
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if loaded.ActiveTabID != "tab-1" {
		t.Errorf("expected ActiveTabID tab-1, got %s", loaded.ActiveTabID)
	}
	if len(loaded.Tabs) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(loaded.Tabs))
	}
	tab := loaded.Tabs[0]
	if tab.Title != "Server Alpha" || tab.HostID != "host-alpha" {
		t.Errorf("tab fields mismatch: %+v", tab)
	}
	if tab.RootNode == nil || len(tab.RootNode.Children) != 2 {
		t.Fatalf("root node hierarchy mismatch: %+v", tab.RootNode)
	}
	if tab.RootNode.Children[1].PaneType != "notes" {
		t.Errorf("expected paneType notes, got %s", tab.RootNode.Children[1].PaneType)
	}
	if time.Since(loaded.SavedAt) > 10*time.Second {
		t.Errorf("savedAt time seems invalid: %v", loaded.SavedAt)
	}

	// Clear
	if err := store.Clear(); err != nil {
		t.Fatalf("Clear failed: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("file should not exist after Clear")
	}
}

func TestWorkspaceStore_CorruptedFile_F27(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "corrupted.json")
	if err := os.WriteFile(path, []byte("{invalid json"), 0600); err != nil {
		t.Fatalf("failed to write corrupted file: %v", err)
	}

	store := NewWorkspaceStore(path)
	_, err := store.Load()
	if err == nil {
		t.Fatalf("expected error loading corrupted file, got nil")
	}
}

