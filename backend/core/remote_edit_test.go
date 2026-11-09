package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type mockMemorySftp struct {
	mu      sync.Mutex
	files   map[string][]byte
	modTime map[string]int64
}

func newMockSftp() *mockMemorySftp {
	return &mockMemorySftp{
		files:   make(map[string][]byte),
		modTime: make(map[string]int64),
	}
}

func (m *mockMemorySftp) List(ctx context.Context, path string) ([]FileItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var list []FileItem
	for p, content := range m.files {
		list = append(list, FileItem{
			Name:    filepath.Base(p),
			Path:    p,
			Size:    int64(len(content)),
			ModTime: m.modTime[p],
			IsDir:   false,
		})
	}
	return list, nil
}

func (m *mockMemorySftp) Stat(ctx context.Context, path string) (FileItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	content, ok := m.files[path]
	if !ok {
		return FileItem{}, os.ErrNotExist
	}
	return FileItem{
		Name:    filepath.Base(path),
		Path:    path,
		Size:    int64(len(content)),
		ModTime: m.modTime[path],
		IsDir:   false,
	}, nil
}

func (m *mockMemorySftp) Mkdir(ctx context.Context, path string) error {
	return nil
}

func (m *mockMemorySftp) Remove(ctx context.Context, path string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.files, path)
	delete(m.modTime, path)
	return nil
}

func (m *mockMemorySftp) Rename(ctx context.Context, oldPath, newPath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files[newPath] = m.files[oldPath]
	m.modTime[newPath] = m.modTime[oldPath]
	delete(m.files, oldPath)
	delete(m.modTime, oldPath)
	return nil
}

func (m *mockMemorySftp) Upload(ctx context.Context, localPath, remotePath string, onProgress func(transferred, total int64)) error {
	bytes, err := os.ReadFile(localPath)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.files[remotePath] = bytes
	m.modTime[remotePath] = time.Now().Unix()
	m.mu.Unlock()
	if onProgress != nil {
		onProgress(int64(len(bytes)), int64(len(bytes)))
	}
	return nil
}

func (m *mockMemorySftp) Download(ctx context.Context, remotePath, localPath string, onProgress func(transferred, total int64)) error {
	m.mu.Lock()
	bytes, ok := m.files[remotePath]
	m.mu.Unlock()
	if !ok {
		return os.ErrNotExist
	}
	if err := os.WriteFile(localPath, bytes, 0o600); err != nil {
		return err
	}
	if onProgress != nil {
		onProgress(int64(len(bytes)), int64(len(bytes)))
	}
	return nil
}

func (m *mockMemorySftp) Close() error {
	return nil
}

func TestRemoteEdit_Lifecycle_F28(t *testing.T) {
	tempBase := t.TempDir()
	mgr := NewRemoteEditManager(tempBase)
	defer mgr.CloseAll()

	client := newMockSftp()
	remotePath := "/etc/nginx/nginx.conf"
	initialContent := "worker_processes 1;\nevents { worker_connections 1024; }"
	client.files[remotePath] = []byte(initialContent)
	client.modTime[remotePath] = time.Now().Add(-10 * time.Minute).Unix()

	ctx := context.Background()

	// 1. Start remote edit
	sess, err := mgr.StartEdit(ctx, client, "sess-1", remotePath)
	if err != nil {
		t.Fatalf("StartEdit failed: %v", err)
	}
	if sess.Filename != "nginx.conf" {
		t.Errorf("expected filename nginx.conf, got %q", sess.Filename)
	}
	if sess.Status != RemoteEditStatusActive {
		t.Errorf("expected active status, got %q", sess.Status)
	}

	// 2. Read local content
	content, err := mgr.ReadContent(sess.ID)
	if err != nil {
		t.Fatalf("ReadContent failed: %v", err)
	}
	if content != initialContent {
		t.Errorf("content mismatch, expected %q, got %q", initialContent, content)
	}

	// 3. Save modified content
	newContent := "worker_processes 4;\nevents { worker_connections 2048; }"
	result, err := mgr.SaveContent(ctx, client, sess.ID, newContent, false)
	if err != nil {
		t.Fatalf("SaveContent failed: %v", err)
	}
	if !result.Success || result.Conflict {
		t.Fatalf("expected successful save without conflict, got %+v", result)
	}

	// 4. Verify remote client updated
	if string(client.files[remotePath]) != newContent {
		t.Errorf("expected remote content %q, got %q", newContent, string(client.files[remotePath]))
	}
}

func TestRemoteEdit_ConflictDetection_F28(t *testing.T) {
	tempBase := t.TempDir()
	mgr := NewRemoteEditManager(tempBase)
	defer mgr.CloseAll()

	client := newMockSftp()
	remotePath := "/var/config.json"
	client.files[remotePath] = []byte(`{"version": 1}`)
	client.modTime[remotePath] = time.Now().Add(-5 * time.Minute).Unix()

	ctx := context.Background()

	sess, err := mgr.StartEdit(ctx, client, "sess-2", remotePath)
	if err != nil {
		t.Fatalf("StartEdit failed: %v", err)
	}

	// Simulate parallel server modification by another user
	client.mu.Lock()
	client.files[remotePath] = []byte(`{"version": 2, "updated_by": "admin"}`)
	client.modTime[remotePath] = time.Now().Add(10 * time.Second).Unix()
	client.mu.Unlock()

	// Check conflict
	conflictInfo, err := mgr.CheckConflict(ctx, client, sess.ID)
	if err != nil {
		t.Fatalf("CheckConflict failed: %v", err)
	}
	if !conflictInfo.HasConflict {
		t.Fatalf("expected conflict detected, got false")
	}

	// Saving without force must fail with ErrRemoteEditConflict
	res, err := mgr.SaveContent(ctx, client, sess.ID, `{"version": 1, "my_edit": true}`, false)
	if err == nil {
		t.Fatalf("expected error on conflict save, got nil")
	}
	if !strings.Contains(err.Error(), "conflict") {
		t.Errorf("expected conflict error, got %v", err)
	}
	if res == nil || !res.Conflict {
		t.Errorf("expected res.Conflict == true, got %+v", res)
	}

	// Force overwrite must succeed
	resForce, err := mgr.SaveContent(ctx, client, sess.ID, `{"version": 3, "forced": true}`, true)
	if err != nil {
		t.Fatalf("expected force save to succeed, got %v", err)
	}
	if !resForce.Success {
		t.Errorf("expected resForce.Success == true, got %+v", resForce)
	}
}

func TestRemoteEdit_Watcher_F28(t *testing.T) {
	tempBase := t.TempDir()
	mgr := NewRemoteEditManager(tempBase)
	defer mgr.CloseAll()

	client := newMockSftp()
	remotePath := "/tmp/notes.txt"
	client.files[remotePath] = []byte("line 1")
	client.modTime[remotePath] = time.Now().Unix()

	ctx := context.Background()
	sess, err := mgr.StartEdit(ctx, client, "sess-3", remotePath)
	if err != nil {
		t.Fatalf("StartEdit failed: %v", err)
	}

	changedCh := make(chan string, 1)
	err = mgr.StartWatcher(sess.ID, func(editID string) {
		select {
		case changedCh <- editID:
		default:
		}
	})
	if err != nil {
		t.Fatalf("StartWatcher failed: %v", err)
	}

	// Wait 10ms then update local file modification time & content
	time.Sleep(50 * time.Millisecond)
	_ = os.WriteFile(sess.LocalPath, []byte("line 1\nline 2 (external edit)"), 0o600)
	now := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(sess.LocalPath, now, now)

	select {
	case id := <-changedCh:
		if id != sess.ID {
			t.Errorf("expected watcher callback for %q, got %q", sess.ID, id)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for file watcher callback")
	}

	mgr.StopWatcher(sess.ID)
}

func TestRemoteEdit_CloseAndCleanup_F28(t *testing.T) {
	tempBase := t.TempDir()
	mgr := NewRemoteEditManager(tempBase)

	client := newMockSftp()
	remotePath := "/tmp/test.txt"
	client.files[remotePath] = []byte("data")
	client.modTime[remotePath] = time.Now().Unix()

	sess, err := mgr.StartEdit(context.Background(), client, "sess-4", remotePath)
	if err != nil {
		t.Fatalf("StartEdit failed: %v", err)
	}

	localDir := filepath.Dir(sess.LocalPath)
	if _, err := os.Stat(localDir); os.IsNotExist(err) {
		t.Fatalf("expected local staging directory to exist")
	}

	if err := mgr.Close(sess.ID); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	// Verify session removed from manager
	if _, err := mgr.GetSession(sess.ID); err != ErrRemoteEditNotFound {
		t.Errorf("expected session not found, got %v", err)
	}

	// Verify local directory deleted
	if _, err := os.Stat(localDir); !os.IsNotExist(err) {
		t.Errorf("expected local staging directory to be cleaned up")
	}
}
