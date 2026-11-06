package ssh

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/sftp"

	"doubleagent/backend/core"
)

type sftpClientWrapper struct {
	client *sftp.Client
}

func (w *sftpClientWrapper) List(ctx context.Context, path string) ([]core.FileItem, error) {
	if w.client == nil {
		return nil, core.ErrSessionNotFound
	}
	if path == "" {
		path = "."
	}

	entries, err := w.client.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("read remote dir %q: %w", path, err)
	}

	result := make([]core.FileItem, 0, len(entries))
	for _, entry := range entries {
		itemPath := filepath.ToSlash(filepath.Join(path, entry.Name()))
		result = append(result, core.FileItem{
			Name:        entry.Name(),
			Path:        itemPath,
			Size:        entry.Size(),
			IsDir:       entry.IsDir(),
			ModTime:     entry.ModTime().Unix(),
			Permissions: entry.Mode().String(),
		})
	}
	return result, nil
}

func (w *sftpClientWrapper) Stat(ctx context.Context, path string) (core.FileItem, error) {
	if w.client == nil {
		return core.FileItem{}, core.ErrSessionNotFound
	}
	fi, err := w.client.Stat(path)
	if err != nil {
		return core.FileItem{}, fmt.Errorf("stat remote file %q: %w", path, err)
	}
	return core.FileItem{
		Name:        fi.Name(),
		Path:        filepath.ToSlash(path),
		Size:        fi.Size(),
		IsDir:       fi.IsDir(),
		ModTime:     fi.ModTime().Unix(),
		Permissions: fi.Mode().String(),
	}, nil
}

func (w *sftpClientWrapper) Mkdir(ctx context.Context, path string) error {
	if w.client == nil {
		return core.ErrSessionNotFound
	}
	return w.client.MkdirAll(path)
}

func (w *sftpClientWrapper) Remove(ctx context.Context, path string) error {
	if w.client == nil {
		return core.ErrSessionNotFound
	}
	fi, err := w.client.Stat(path)
	if err != nil {
		// Attempt removal anyway
		return w.client.Remove(path)
	}
	if fi.IsDir() {
		return w.client.RemoveDirectory(path)
	}
	return w.client.Remove(path)
}

func (w *sftpClientWrapper) Rename(ctx context.Context, oldPath, newPath string) error {
	if w.client == nil {
		return core.ErrSessionNotFound
	}
	return w.client.Rename(oldPath, newPath)
}

// progressWriter wraps an io.Writer and triggers onProgress on writes.
type progressWriter struct {
	writer      io.Writer
	transferred int64
	total       int64
	onProgress  func(transferred, total int64)
	lastUpdate  time.Time
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n, err := pw.writer.Write(p)
	if n > 0 {
		pw.transferred += int64(n)
		now := time.Now()
		if pw.onProgress != nil && (now.Sub(pw.lastUpdate) >= 100*time.Millisecond || pw.transferred >= pw.total) {
			pw.lastUpdate = now
			pw.onProgress(pw.transferred, pw.total)
		}
	}
	return n, err
}

func (w *sftpClientWrapper) Upload(ctx context.Context, localPath, remotePath string, onProgress func(transferred, total int64)) error {
	if w.client == nil {
		return core.ErrSessionNotFound
	}

	srcFile, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open local file %q: %w", localPath, err)
	}
	defer srcFile.Close()

	stat, err := srcFile.Stat()
	if err != nil {
		return fmt.Errorf("stat local file %q: %w", localPath, err)
	}
	totalSize := stat.Size()

	// Ensure remote directory exists
	remoteDir := filepath.ToSlash(filepath.Dir(remotePath))
	if remoteDir != "." && remoteDir != "/" && remoteDir != "" {
		_ = w.client.MkdirAll(remoteDir)
	}

	dstFile, err := w.client.Create(remotePath)
	if err != nil {
		return fmt.Errorf("create remote file %q: %w", remotePath, err)
	}
	defer dstFile.Close()

	pw := &progressWriter{
		writer:     dstFile,
		total:      totalSize,
		onProgress: onProgress,
		lastUpdate: time.Now(),
	}

	// Copy in chunks with context cancellation check
	buf := make([]byte, 64*1024)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		nr, readErr := srcFile.Read(buf)
		if nr > 0 {
			nw, writeErr := pw.Write(buf[0:nr])
			if writeErr != nil {
				return fmt.Errorf("write remote chunk: %w", writeErr)
			}
			if nr != nw {
				return io.ErrShortWrite
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return fmt.Errorf("read local chunk: %w", readErr)
		}
	}

	if onProgress != nil {
		onProgress(totalSize, totalSize)
	}
	return nil
}

func (w *sftpClientWrapper) Download(ctx context.Context, remotePath, localPath string, onProgress func(transferred, total int64)) error {
	if w.client == nil {
		return core.ErrSessionNotFound
	}

	srcFile, err := w.client.Open(remotePath)
	if err != nil {
		return fmt.Errorf("open remote file %q: %w", remotePath, err)
	}
	defer srcFile.Close()

	stat, err := srcFile.Stat()
	if err != nil {
		return fmt.Errorf("stat remote file %q: %w", remotePath, err)
	}
	totalSize := stat.Size()

	// Ensure local directory exists
	localDir := filepath.Dir(localPath)
	if err := os.MkdirAll(localDir, 0755); err != nil {
		return fmt.Errorf("create local dir %q: %w", localDir, err)
	}

	dstFile, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("create local file %q: %w", localPath, err)
	}
	defer dstFile.Close()

	pw := &progressWriter{
		writer:     dstFile,
		total:      totalSize,
		onProgress: onProgress,
		lastUpdate: time.Now(),
	}

	buf := make([]byte, 64*1024)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		nr, readErr := srcFile.Read(buf)
		if nr > 0 {
			nw, writeErr := pw.Write(buf[0:nr])
			if writeErr != nil {
				return fmt.Errorf("write local chunk: %w", writeErr)
			}
			if nr != nw {
				return io.ErrShortWrite
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return fmt.Errorf("read remote chunk: %w", readErr)
		}
	}

	if onProgress != nil {
		onProgress(totalSize, totalSize)
	}
	return nil
}

func (w *sftpClientWrapper) Close() error {
	if w.client != nil {
		return w.client.Close()
	}
	return nil
}

// OpenSftp initializes an SFTP client over the existing SSH connection (F-12).
func (t *Transport) OpenSftp(ctx context.Context, sessionID string) (core.SftpClient, error) {
	t.mu.RLock()
	sess, exists := t.sessions[sessionID]
	t.mu.RUnlock()

	if !exists || sess == nil {
		return nil, core.ErrSessionNotFound
	}

	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.closed || sess.client == nil {
		return nil, core.ErrSessionNotFound
	}

	client, err := sftp.NewClient(sess.client)
	if err != nil {
		return nil, fmt.Errorf("create sftp client: %w", err)
	}

	return &sftpClientWrapper{client: client}, nil
}
