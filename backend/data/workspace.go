package data

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"doubleagent/backend/core"
)

// WorkspaceStore persists and restores workspace layout (tabs, split panes, host associations) across app restarts (F-27).
type WorkspaceStore interface {
	Save(state core.WorkspaceState) error
	Load() (core.WorkspaceState, error)
	Clear() error
}

type fileWorkspaceStore struct {
	mu       sync.RWMutex
	filePath string
}

// NewWorkspaceStore creates a persistent workspace store at filePath.
func NewWorkspaceStore(filePath string) WorkspaceStore {
	return &fileWorkspaceStore{
		filePath: filePath,
	}
}

// Save atomically writes the workspace state to workspace.json (F-27).
func (s *fileWorkspaceStore) Save(state core.WorkspaceState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if state.Version == 0 {
		state.Version = 1
	}
	state.SavedAt = time.Now().UTC()

	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create workspace directory: %w", err)
	}

	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal workspace state: %w", err)
	}

	tmpFile := s.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, raw, 0600); err != nil {
		return fmt.Errorf("failed to write temporary workspace file: %w", err)
	}

	if err := os.Rename(tmpFile, s.filePath); err != nil {
		// On Windows, fallback to remove + rename if target already exists
		_ = os.Remove(s.filePath)
		if err2 := os.Rename(tmpFile, s.filePath); err2 != nil {
			_ = os.Remove(tmpFile)
			return fmt.Errorf("failed to replace workspace file: %w", err2)
		}
	}

	return nil
}

// Load reads the workspace state from workspace.json. If the file does not exist, an empty state is returned without error (F-27).
func (s *fileWorkspaceStore) Load() (core.WorkspaceState, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	raw, err := os.ReadFile(s.filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return core.WorkspaceState{
				Version:     1,
				AutoRestore: true,
				Tabs:        []core.TabItem{},
			}, nil
		}
		return core.WorkspaceState{}, fmt.Errorf("failed to read workspace file: %w", err)
	}

	var state core.WorkspaceState
	if err := json.Unmarshal(raw, &state); err != nil {
		return core.WorkspaceState{}, fmt.Errorf("corrupted workspace file: %w", err)
	}

	return state, nil
}

// Clear removes the persisted workspace.json file (F-27).
func (s *fileWorkspaceStore) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	err := os.Remove(s.filePath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("failed to remove workspace file: %w", err)
	}
	return nil
}

