package core

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	ErrRemoteEditNotFound = errors.New("remote edit session not found")
	ErrRemoteEditConflict = errors.New("parallel modification conflict detected on remote server")
	ErrRemoteEditIsDir    = errors.New("cannot edit directory as text file")
)

// RemoteEditManager coordinates local file staging, change watching, and remote upload with conflict detection (F-28).
type RemoteEditManager struct {
	mu          sync.RWMutex
	stagingBase string
	sessions    map[string]*RemoteEditSession
	stopWatchCh map[string]chan struct{}
}

// NewRemoteEditManager creates a new RemoteEditManager with an isolated staging directory.
func NewRemoteEditManager(stagingBase string) *RemoteEditManager {
	if stagingBase == "" {
		stagingBase = filepath.Join(os.TempDir(), "doubleagent_remote_edit")
	}
	_ = os.MkdirAll(stagingBase, 0o700)
	return &RemoteEditManager{
		stagingBase: stagingBase,
		sessions:    make(map[string]*RemoteEditSession),
		stopWatchCh: make(map[string]chan struct{}),
	}
}

// StartEdit downloads a remote file to local staging and initializes tracking metadata (F-28).
func (m *RemoteEditManager) StartEdit(ctx context.Context, client SftpClient, sessionID, remotePath string) (*RemoteEditSession, error) {
	if client == nil {
		return nil, errors.New("sftp client is nil")
	}

	stat, err := client.Stat(ctx, remotePath)
	if err != nil {
		return nil, fmt.Errorf("stat remote file %q: %w", remotePath, err)
	}
	if stat.IsDir {
		return nil, ErrRemoteEditIsDir
	}

	editID := fmt.Sprintf("edit-%d-%d", time.Now().UnixNano(), rand.Intn(100000))
	stageDir := filepath.Join(m.stagingBase, editID)
	if err := os.MkdirAll(stageDir, 0o700); err != nil {
		return nil, fmt.Errorf("create staging directory: %w", err)
	}

	filename := stat.Name
	if filename == "" {
		filename = filepath.Base(remotePath)
	}
	localPath := filepath.Join(stageDir, filename)

	if err := client.Download(ctx, remotePath, localPath, nil); err != nil {
		_ = os.RemoveAll(stageDir)
		return nil, fmt.Errorf("download remote file: %w", err)
	}

	hash, _ := computeFileHash(localPath)

	sess := &RemoteEditSession{
		ID:             editID,
		SessionID:      sessionID,
		RemotePath:     remotePath,
		LocalPath:      localPath,
		Filename:       filename,
		InitialModTime: stat.ModTime,
		InitialSize:    stat.Size,
		InitialHash:    hash,
		Status:         RemoteEditStatusActive,
		LastUploadedAt: time.Now().Unix(),
		HasConflict:    false,
	}

	m.mu.Lock()
	m.sessions[editID] = sess
	m.mu.Unlock()

	return sess, nil
}

// GetSession returns an active remote edit session by ID.
func (m *RemoteEditManager) GetSession(editID string) (*RemoteEditSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sess, ok := m.sessions[editID]
	if !ok {
		return nil, ErrRemoteEditNotFound
	}
	return sess, nil
}

// ListSessions returns a copy of all active remote edit sessions.
func (m *RemoteEditManager) ListSessions() []RemoteEditSession {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]RemoteEditSession, 0, len(m.sessions))
	for _, s := range m.sessions {
		list = append(list, *s)
	}
	return list
}

// ReadContent returns the local staged file contents as a string.
func (m *RemoteEditManager) ReadContent(editID string) (string, error) {
	sess, err := m.GetSession(editID)
	if err != nil {
		return "", err
	}
	bytes, err := os.ReadFile(sess.LocalPath)
	if err != nil {
		return "", fmt.Errorf("read local staging file: %w", err)
	}
	return string(bytes), nil
}

// AutoSyncLocalFile reads the modified staged file from disk and uploads it, checking for conflicts (F-28).
func (m *RemoteEditManager) AutoSyncLocalFile(ctx context.Context, client SftpClient, editID string) (*RemoteEditResult, error) {
	sess, err := m.GetSession(editID)
	if err != nil {
		return nil, err
	}
	bytes, err := os.ReadFile(sess.LocalPath)
	if err != nil {
		return nil, fmt.Errorf("read local staging file: %w", err)
	}
	return m.SaveContent(ctx, client, editID, string(bytes), false)
}

// CheckConflict inspects the remote server file to verify if it changed since download/last upload (F-28).
func (m *RemoteEditManager) CheckConflict(ctx context.Context, client SftpClient, editID string) (*RemoteConflictInfo, error) {
	sess, err := m.GetSession(editID)
	if err != nil {
		return nil, err
	}
	if client == nil {
		return nil, errors.New("sftp client is nil")
	}

	remoteStat, err := client.Stat(ctx, sess.RemotePath)
	if err != nil {
		return nil, fmt.Errorf("stat remote file: %w", err)
	}

	hasConflict := detectConflict(sess.InitialModTime, sess.InitialSize, remoteStat.ModTime, remoteStat.Size)

	m.mu.Lock()
	sess.HasConflict = hasConflict
	if hasConflict {
		sess.Status = RemoteEditStatusConflict
	}
	m.mu.Unlock()

	info := &RemoteConflictInfo{
		HasConflict:    hasConflict,
		RemotePath:     sess.RemotePath,
		InitialModTime: sess.InitialModTime,
		RemoteModTime:  remoteStat.ModTime,
		InitialSize:    sess.InitialSize,
		RemoteSize:     remoteStat.Size,
	}
	if hasConflict {
		info.Message = fmt.Sprintf("File on remote server was modified at %s (size %d bytes) after initial download at %s (size %d bytes)",
			time.Unix(remoteStat.ModTime, 0).Format(time.RFC3339), remoteStat.Size,
			time.Unix(sess.InitialModTime, 0).Format(time.RFC3339), sess.InitialSize)
	}
	return info, nil
}

// SaveContent updates local file content and uploads it back to the remote server, validating conflicts (F-28).
func (m *RemoteEditManager) SaveContent(ctx context.Context, client SftpClient, editID, content string, force bool) (*RemoteEditResult, error) {
	sess, err := m.GetSession(editID)
	if err != nil {
		return nil, err
	}
	if client == nil {
		return nil, errors.New("sftp client is nil")
	}

	// Write new content to local file
	if err := os.WriteFile(sess.LocalPath, []byte(content), 0o600); err != nil {
		return nil, fmt.Errorf("write local staging file: %w", err)
	}

	// Check conflict unless force overwrite is requested
	if !force {
		conflictInfo, err := m.CheckConflict(ctx, client, editID)
		if err != nil {
			return nil, err
		}
		if conflictInfo.HasConflict {
			return &RemoteEditResult{
				Success:       false,
				Conflict:      true,
				RemoteModTime: conflictInfo.RemoteModTime,
				RemoteSize:    conflictInfo.RemoteSize,
				Message:       conflictInfo.Message,
			}, ErrRemoteEditConflict
		}
	}

	m.mu.Lock()
	sess.Status = RemoteEditStatusSyncing
	m.mu.Unlock()

	// Upload to remote
	if err := client.Upload(ctx, sess.LocalPath, sess.RemotePath, nil); err != nil {
		m.mu.Lock()
		sess.Status = RemoteEditStatusActive
		sess.ErrorMessage = err.Error()
		m.mu.Unlock()
		return nil, fmt.Errorf("upload to remote: %w", err)
	}

	// Refresh remote metadata
	newStat, err := client.Stat(ctx, sess.RemotePath)
	newModTime := time.Now().Unix()
	newSize := int64(len(content))
	if err == nil {
		newModTime = newStat.ModTime
		newSize = newStat.Size
	}

	newHash, _ := computeFileHash(sess.LocalPath)

	m.mu.Lock()
	sess.InitialModTime = newModTime
	sess.InitialSize = newSize
	sess.InitialHash = newHash
	sess.LastUploadedAt = time.Now().Unix()
	sess.HasConflict = false
	sess.Status = RemoteEditStatusActive
	sess.ErrorMessage = ""
	m.mu.Unlock()

	return &RemoteEditResult{
		Success:       true,
		Conflict:      false,
		RemoteModTime: newModTime,
		RemoteSize:    newSize,
		Message:       "Successfully uploaded remote file.",
	}, nil
}

// StartWatcher observes the local staging file for changes made by external text editors (F-28).
func (m *RemoteEditManager) StartWatcher(editID string, onChange func(editID string)) error {
	sess, err := m.GetSession(editID)
	if err != nil {
		return err
	}

	m.mu.Lock()
	if _, ok := m.stopWatchCh[editID]; ok {
		m.mu.Unlock()
		return nil // watcher already running
	}
	stopCh := make(chan struct{})
	m.stopWatchCh[editID] = stopCh
	m.mu.Unlock()

	go func() {
		localPath := sess.LocalPath
		lastMod := getFileModTime(localPath)

		ticker := time.NewTicker(350 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				currentMod := getFileModTime(localPath)
				if currentMod > 0 && currentMod > lastMod {
					lastMod = currentMod
					if onChange != nil {
						onChange(editID)
					}
				}
			}
		}
	}()

	return nil
}

// StopWatcher stops observing the local staging file.
func (m *RemoteEditManager) StopWatcher(editID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if stopCh, ok := m.stopWatchCh[editID]; ok {
		close(stopCh)
		delete(m.stopWatchCh, editID)
	}
}

// Close removes the local staging directory and stops watchers (F-28).
func (m *RemoteEditManager) Close(editID string) error {
	m.StopWatcher(editID)

	m.mu.Lock()
	sess, ok := m.sessions[editID]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	delete(m.sessions, editID)
	m.mu.Unlock()

	stageDir := filepath.Dir(sess.LocalPath)
	_ = os.RemoveAll(stageDir)
	return nil
}

// CloseAll cleans up all staging files and active watchers.
func (m *RemoteEditManager) CloseAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	for _, id := range ids {
		_ = m.Close(id)
	}
}

func detectConflict(initMod int64, initSize int64, remoteMod int64, remoteSize int64) bool {
	// If remote is strictly newer than initial download time
	if remoteMod > initMod {
		return true
	}
	// If timestamps differ by more than 1 second and file size changed
	if (remoteMod != initMod) && (remoteSize != initSize) {
		return true
	}
	return false
}

func getFileModTime(path string) int64 {
	stat, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return stat.ModTime().Unix()
}

func computeFileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	hasher := fnv.New128a()
	if _, err := io.Copy(hasher, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
