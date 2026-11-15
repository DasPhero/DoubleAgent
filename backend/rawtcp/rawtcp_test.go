package rawtcp

import (
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestRawTcp_DialAndEcho_F31(t *testing.T) {
	// 1. Setup local echo server
	server, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to start test echo server: %v", err)
	}
	defer server.Close()

	port := uint16(server.Addr().(*net.TCPAddr).Port)

	go func() {
		for {
			conn, err := server.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = io.Copy(c, c)
			}(conn)
		}
	}()

	// 2. Dial using RawTcp Dial
	cfg := core.RawTcpConfig{
		Host:       "127.0.0.1",
		Port:       port,
		LineMode:   true,
		LineEnding: "crlf",
		TimeoutSec: 2,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sess, err := Dial(ctx, cfg)
	if err != nil {
		if strings.Contains(err.Error(), "forbidden by its access permissions") {
			t.Skipf("skipping raw TCP dial test: environment restricts loopback socket connections (%v)", err)
		}
		t.Fatalf("failed to dial raw TCP: %v", err)
	}
	defer sess.Close()

	if sess.ID() == "" || !strings.HasPrefix(sess.ID(), "raw-tcp-") {
		t.Errorf("unexpected session ID format: %s", sess.ID())
	}

	// 3. Send and receive data
	payload := []byte("PING\r\n")
	n, err := sess.Write(payload)
	if err != nil || n != len(payload) {
		t.Fatalf("write failed: n=%d err=%v", n, err)
	}

	buf := make([]byte, 64)
	n, err = sess.Read(buf)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if string(buf[:n]) != "PING\r\n" {
		t.Fatalf("echo mismatch: got %q, expected %q", string(buf[:n]), "PING\r\n")
	}

	// 4. Verify telemetry metrics
	if sess.BytesSent() < uint64(len(payload)) {
		t.Errorf("expected BytesSent >= %d, got %d", len(payload), sess.BytesSent())
	}
	if sess.BytesReceived() < uint64(len(payload)) {
		t.Errorf("expected BytesReceived >= %d, got %d", len(payload), sess.BytesReceived())
	}

	// 5. Check stats and configuration toggles
	stats := sess.Stats()
	if !stats.LineMode {
		t.Errorf("expected LineMode=true")
	}
	if stats.LineEnding != "crlf" {
		t.Errorf("expected LineEnding=crlf, got %s", stats.LineEnding)
	}

	sess.SetLineMode(false)
	sess.SetLineEnding("lf")
	stats = sess.Stats()
	if stats.LineMode {
		t.Errorf("expected LineMode=false after toggle")
	}
	if stats.LineEnding != "lf" {
		t.Errorf("expected LineEnding=lf after toggle")
	}
}

func findFreePort(t *testing.T) uint16 {
	for port := uint16(18200); port < 18300; port++ {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			_ = l.Close()
			return port
		}
	}
	t.Fatalf("could not find free port in range")
	return 0
}

func TestRawTcp_ListenAndAccept_F31(t *testing.T) {
	accepted := make(chan core.RawTcpSession, 1)

	port := findFreePort(t)

	// Start listener on dynamic port
	cfg := core.RawTcpListenerConfig{
		Port:         port,
		BindAddress:  "127.0.0.1",
		AutoSpawnTab: true,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	listener, err := Listen(ctx, cfg, func(sess core.RawTcpSession) {
		accepted <- sess
	})
	if err != nil {
		t.Fatalf("failed to start listener: %v", err)
	}
	defer listener.Close()

	info := listener.Info()
	if info.Status != "listening" {
		t.Errorf("expected status 'listening', got %s", info.Status)
	}
	if info.Port == 0 {
		t.Fatalf("expected non-zero dynamic port")
	}

	// Dial the listener from a standard TCP client
	targetAddr := fmt.Sprintf("127.0.0.1:%d", info.Port)
	clientConn, err := net.DialTimeout("tcp", targetAddr, 2*time.Second)
	if err != nil {
		if strings.Contains(err.Error(), "forbidden by its access permissions") {
			t.Skipf("skipping listener dial test: environment restricts loopback socket connections (%v)", err)
		}
		t.Fatalf("failed to dial listener on %s: %v", targetAddr, err)
	}
	defer clientConn.Close()

	// Wait for accepted session
	select {
	case sess := <-accepted:
		defer sess.Close()
		if !strings.HasPrefix(sess.ID(), "raw-tcp-in-") {
			t.Errorf("expected incoming session ID prefix 'raw-tcp-in-', got %s", sess.ID())
		}
		stats := sess.Stats()
		if !stats.IsListener {
			t.Errorf("expected IsListener=true")
		}

		// Send from client to accepted session
		_, _ = clientConn.Write([]byte("HELLO FROM REVERSE TARGET\n"))
		buf := make([]byte, 64)
		n, err := sess.Read(buf)
		if err != nil || !strings.Contains(string(buf[:n]), "HELLO") {
			t.Fatalf("failed to read from incoming session: n=%d err=%v buf=%s", n, err, string(buf[:n]))
		}

		// Send reply from accepted session to client
		_, _ = sess.Write([]byte("ACK FROM LISTENER\n"))
		cBuf := make([]byte, 64)
		cn, cErr := clientConn.Read(cBuf)
		if cErr != nil || !strings.Contains(string(cBuf[:cn]), "ACK") {
			t.Fatalf("client failed to read reply: cn=%d cErr=%v buf=%s", cn, cErr, string(cBuf[:cn]))
		}

	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for incoming connection on listener")
	}

	// Verify listener catches count
	updatedInfo := listener.Info()
	if updatedInfo.TotalCatches != 1 {
		t.Errorf("expected TotalCatches=1, got %d", updatedInfo.TotalCatches)
	}

	// Test Close
	if err := listener.Close(); err != nil {
		t.Errorf("listener Close failed: %v", err)
	}
	closedInfo := listener.Info()
	if closedInfo.Status != "stopped" {
		t.Errorf("expected status 'stopped', got %s", closedInfo.Status)
	}
}

func TestRawTcp_ValidationErrors_F31(t *testing.T) {
	// Dial with invalid port
	_, err := Dial(context.Background(), core.RawTcpConfig{
		Host: "127.0.0.1",
		Port: 0,
	})
	if err == nil {
		t.Errorf("expected error for port 0")
	}

	// Dial with invalid line ending
	_, err = Dial(context.Background(), core.RawTcpConfig{
		Host:       "127.0.0.1",
		Port:       8080,
		LineEnding: "bad_ending",
	})
	if err == nil {
		t.Errorf("expected error for bad line ending")
	}

	// Listen on invalid bind IP
	_, err = Listen(context.Background(), core.RawTcpListenerConfig{
		Port:        4444,
		BindAddress: "not-a-valid-ip",
	}, nil)
	if err == nil {
		t.Errorf("expected error for invalid bind address")
	}
}
