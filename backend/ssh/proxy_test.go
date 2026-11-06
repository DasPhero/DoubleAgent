package ssh

import (
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/proxy"

	"doubleagent/backend/core"
)

func TestProxyCommand_F14(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Use echo %h:%p to verify command substitution and stdout pipe
	cmdStr := "echo %h:%p"

	conn, err := dialProxyCommand(ctx, cmdStr, "example.internal", 2222)
	if err != nil {
		t.Fatalf("dialProxyCommand failed: %v", err)
	}
	defer conn.Close()

	if conn.RemoteAddr().String() != "example.internal:2222" {
		t.Errorf("unexpected remote addr: %s", conn.RemoteAddr().String())
	}

	buf := make([]byte, 128)
	n, err := conn.Read(buf)
	if err != nil && err != io.EOF {
		t.Fatalf("read from proxycommand conn failed: %v", err)
	}
	output := string(buf[:n])
	if !strings.Contains(output, "example.internal:2222") {
		t.Errorf("expected output containing 'example.internal:2222', got %q", output)
	}
}

type mockDialer struct {
	conn net.Conn
}

func (m *mockDialer) Dial(network, addr string) (net.Conn, error) {
	return m.conn, nil
}

func TestProxySocks5_F14(t *testing.T) {
	cClient, cServer := net.Pipe()
	defer cClient.Close()
	defer cServer.Close()

	// In background, handle SOCKS5 handshake (no auth, connect request)
	go func() {
		// Read greeting: version 5, nmethods, methods
		greet := make([]byte, 3)
		if _, err := io.ReadFull(cServer, greet); err != nil {
			return
		}
		// Reply NO AUTH (0x05, 0x00)
		_, _ = cServer.Write([]byte{0x05, 0x00})

		// Read connect request: 0x05, 0x01 (CONNECT), 0x00, 0x01 (IPv4), 4 bytes IP, 2 bytes port
		req := make([]byte, 10)
		if _, err := io.ReadFull(cServer, req); err != nil {
			return
		}

		// Reply success (0x05, 0x00, 0x00, 0x01, 127.0.0.1, port)
		_, _ = cServer.Write([]byte{0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80})

		// Echo back any traffic
		_, _ = io.Copy(cServer, cServer)
	}()

	// Use pure in-memory net.Pipe to test without OS loopback sockets
	rawDialer, err := proxy.SOCKS5("tcp", "127.0.0.1:1080", nil, &mockDialer{conn: cClient})
	if err != nil {
		t.Fatalf("proxy.SOCKS5 init failed: %v", err)
	}

	conn, err := rawDialer.Dial("tcp", "127.0.0.1:80")
	if err != nil {
		t.Fatalf("dialSocks5 failed: %v", err)
	}
	defer conn.Close()

	testData := []byte("socks5 test payload")
	go func() {
		_, _ = conn.Write(testData)
	}()

	res := make([]byte, len(testData))
	if _, err := io.ReadFull(conn, res); err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if string(res) != string(testData) {
		t.Fatalf("expected %q, got %q", string(testData), string(res))
	}
}

func TestProxyJump_ChainValidation_F14(t *testing.T) {
	tr := NewTransport(nil)
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	// Empty chain should fail
	_, _, _, err := tr.dialProxyJump(ctx, nil, "127.0.0.1:22", 1*time.Second)
	if err == nil {
		t.Fatal("expected error on empty jump chain")
	}

	// Invalid auth method in chain hop should fail validation
	badHop := core.SshSessionConfig{
		Address:  "127.0.0.1",
		Port:     2222,
		Username: "user",
		Auth: core.SshAuthConfig{
			Method: core.AuthMethodType("invalid_auth_type"),
		},
	}
	_, _, _, err = tr.dialProxyJump(ctx, []core.SshSessionConfig{badHop}, "127.0.0.1:22", 1*time.Second)
	if err == nil {
		t.Fatal("expected error on invalid auth method in hop")
	}
}
