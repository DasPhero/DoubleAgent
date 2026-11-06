package ssh

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pkg/sftp"

	"doubleagent/backend/core"
)

func setupTestSftpServer(t *testing.T) (core.SftpClient, func()) {
	t.Helper()

	clientConn, serverConn := net.Pipe()

	server, err := sftp.NewServer(serverConn)
	if err != nil {
		t.Fatalf("failed to create in-memory sftp server: %v", err)
	}

	go func() {
		_ = server.Serve()
	}()

	client, err := sftp.NewClientPipe(clientConn, clientConn)
	if err != nil {
		t.Fatalf("failed to create sftp client: %v", err)
	}

	wrapper := &sftpClientWrapper{client: client}

	cleanup := func() {
		_ = wrapper.Close()
		_ = server.Close()
		_ = clientConn.Close()
		_ = serverConn.Close()
	}

	return wrapper, cleanup
}

func TestSFTP_ListAndStat_F12(t *testing.T) {
	client, cleanup := setupTestSftpServer(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// List current workspace
	tempDir := t.TempDir()
	testFile := filepath.Join(tempDir, "hello.txt")
	if err := os.WriteFile(testFile, []byte("Hello SFTP"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	entries, err := client.List(ctx, filepath.ToSlash(tempDir))
	if err != nil {
		t.Fatalf("failed to list directory: %v", err)
	}

	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Name != "hello.txt" {
		t.Errorf("expected entry name hello.txt, got %s", entries[0].Name)
	}
	if entries[0].Size != int64(len("Hello SFTP")) {
		t.Errorf("expected size %d, got %d", len("Hello SFTP"), entries[0].Size)
	}

	stat, err := client.Stat(ctx, filepath.ToSlash(testFile))
	if err != nil {
		t.Fatalf("failed to stat file: %v", err)
	}
	if stat.Name != "hello.txt" || stat.IsDir {
		t.Errorf("unexpected stat result: %+v", stat)
	}
}

func TestSFTP_UploadDownloadProgress_F12(t *testing.T) {
	client, cleanup := setupTestSftpServer(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tempDir := t.TempDir()
	localSrc := filepath.Join(tempDir, "upload_src.bin")
	remoteDst := filepath.ToSlash(filepath.Join(tempDir, "remote", "upload_dst.bin"))
	localDst := filepath.Join(tempDir, "download_dst.bin")

	// 128KB payload
	payload := make([]byte, 128*1024)
	for i := range payload {
		payload[i] = byte(i % 256)
	}
	if err := os.WriteFile(localSrc, payload, 0644); err != nil {
		t.Fatalf("failed to write src payload: %v", err)
	}

	// Test Upload
	var uploadProgressTotal int64
	uploadErr := client.Upload(ctx, localSrc, remoteDst, func(transferred, total int64) {
		uploadProgressTotal = total
	})
	if uploadErr != nil {
		t.Fatalf("upload failed: %v", uploadErr)
	}
	if uploadProgressTotal != int64(len(payload)) {
		t.Errorf("expected upload progress total %d, got %d", len(payload), uploadProgressTotal)
	}

	// Test Download
	var downloadProgressTotal int64
	downloadErr := client.Download(ctx, remoteDst, localDst, func(transferred, total int64) {
		downloadProgressTotal = total
	})
	if downloadErr != nil {
		t.Fatalf("download failed: %v", downloadErr)
	}
	if downloadProgressTotal != int64(len(payload)) {
		t.Errorf("expected download progress total %d, got %d", len(payload), downloadProgressTotal)
	}

	// Verify content
	downloadedBytes, err := os.ReadFile(localDst)
	if err != nil {
		t.Fatalf("failed to read downloaded file: %v", err)
	}
	if len(downloadedBytes) != len(payload) {
		t.Fatalf("size mismatch: expected %d, got %d", len(payload), len(downloadedBytes))
	}
}

func TestSFTP_MkdirAndRemove_F12(t *testing.T) {
	client, cleanup := setupTestSftpServer(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tempDir := t.TempDir()
	newFolder := filepath.ToSlash(filepath.Join(tempDir, "subfolder"))

	if err := client.Mkdir(ctx, newFolder); err != nil {
		t.Fatalf("failed to mkdir: %v", err)
	}

	stat, err := client.Stat(ctx, newFolder)
	if err != nil {
		t.Fatalf("failed to stat created folder: %v", err)
	}
	if !stat.IsDir {
		t.Errorf("expected stat.IsDir to be true")
	}

	if err := client.Remove(ctx, newFolder); err != nil {
		t.Fatalf("failed to remove folder: %v", err)
	}
}
