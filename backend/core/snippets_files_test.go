package core_test

import (
	"os"
	"path/filepath"
	"testing"

	"doubleagent/backend/core"
)

func TestCommandSnippetsExternalFileRoundTrip_F15(t *testing.T) {
	dir := t.TempDir()
	resolved := core.ResolveSnippetsFilePath(dir + string(filepath.Separator))
	wantPath := filepath.Join(dir, core.CommandSnippetsFileName)
	if resolved != wantPath {
		t.Fatalf("expected %q, got %q", wantPath, resolved)
	}

	// Bootstraps defaults on first load
	list, err := core.LoadSnippetsFromFile(resolved)
	if err != nil {
		t.Fatalf("LoadSnippetsFromFile initial: %v", err)
	}
	if len(list) < 4 {
		t.Fatalf("expected starter snippets, got %d", len(list))
	}
	if _, err := os.Stat(resolved); err != nil {
		t.Fatalf("expected snippets file created at %s: %v", resolved, err)
	}

	// Add custom snippet and verify round-trip
	list = append(list, core.Snippet{
		ID:               "snip-custom-1",
		Name:             "Custom Service Restart",
		Body:             "sudo systemctl restart {{SERVICE=nginx}}",
		Tags:             []string{"linux"},
		ConfirmBeforeRun: true,
	})
	if err := core.SaveSnippetsToFile(resolved, list); err != nil {
		t.Fatalf("SaveSnippetsToFile: %v", err)
	}

	cfg := core.GetSnippetsFileConfig(resolved)
	if !cfg.Exists || cfg.SnippetCount != len(list) {
		t.Fatalf("unexpected SnippetsFileConfig: %+v", cfg)
	}
}
