package remoteagent

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestClientServerRPCLifecycle_F46(t *testing.T) {
	// Two full-duplex pipes simulate an SSH stdin/stdout channel completely offline.
	c2sReader, c2sWriter := io.Pipe()
	s2cReader, s2cWriter := io.Pipe()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := NewServer(c2sReader, s2cWriter)
	srvDone := make(chan error, 1)
	go func() {
		srvDone <- srv.Serve(ctx)
		_ = s2cWriter.Close()
	}()

	disconnected := make(chan string, 1)
	client := NewClientFromStreams(
		c2sWriter,
		s2cReader,
		func() error {
			_ = c2sWriter.Close()
			_ = s2cReader.Close()
			return nil
		},
		func(_ string, _ json.RawMessage) {},
		func(reason string) {
			select {
			case disconnected <- reason:
			default:
			}
		},
	)

	// 1. Ping handshake
	ping, err := client.Ping(ctx)
	if err != nil {
		t.Fatalf("Ping failed: %v", err)
	}
	if !ping.OK || ping.OS == "" || ping.Arch == "" {
		t.Fatalf("unexpected ping response: %+v", ping)
	}

	// 2. Network interfaces
	ips, err := client.ListNetworkIPs(ctx)
	if err != nil {
		t.Fatalf("ListNetworkIPs failed: %v", err)
	}
	_ = ips // may be empty in isolated sandbox, just verify RPC succeeded

	// 3. Filesystem listing, mkdir, and hashing
	tmpRoot := t.TempDir()
	subDir := filepath.Join(tmpRoot, "nested")
	if err := client.Mkdir(ctx, subDir); err != nil {
		t.Fatalf("Mkdir failed: %v", err)
	}
	sampleFile := filepath.Join(tmpRoot, "hello.txt")
	if err := os.WriteFile(sampleFile, []byte("doubleagent-f46"), 0600); err != nil {
		t.Fatalf("write sample file: %v", err)
	}

	listing, err := client.ListDir(ctx, tmpRoot)
	if err != nil {
		t.Fatalf("ListDir failed: %v", err)
	}
	if len(listing.Entries) != 2 {
		t.Fatalf("expected 2 entries in %s, got %d", tmpRoot, len(listing.Entries))
	}
	if !listing.Entries[0].IsDir || listing.Entries[0].Name != "nested" {
		t.Fatalf("expected directory 'nested' sorted first, got %+v", listing.Entries[0])
	}

	hashed, err := client.HashFile(ctx, tmpRoot, "hello.txt")
	if err != nil {
		t.Fatalf("HashFile failed: %v", err)
	}
	if hashed.SHA256 == "" || hashed.MD5 == "" || hashed.Size != int64(len("doubleagent-f46")) {
		t.Fatalf("unexpected hash result: %+v", hashed)
	}

	// 4. Closing client sends EOF to server stdin and terminates server cleanly.
	if err := client.Close(); err != nil {
		t.Fatalf("client Close failed: %v", err)
	}
	select {
	case sErr := <-srvDone:
		if sErr != nil {
			t.Fatalf("server returned error on EOF: %v", sErr)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for server to exit on stdin EOF")
	}
}
