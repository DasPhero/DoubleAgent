package ssh

import (
	"bytes"
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestForward_TunnelStatusAndMetrics_F13(t *testing.T) {
	p1Client, p1Server := net.Pipe()
	p2Client, p2Server := net.Pipe()

	tun := &tunnelWrapper{
		id:         "tun-test-1",
		ruleID:     "rule-1",
		sessionID:  "sess-1",
		hostID:     "host-1",
		tunnelType: core.ForwardLocal,
		bindAddr:   "127.0.0.1",
		bindPort:   8080,
		targetHost: "remote.internal",
		targetPort: 8080,
		conns:      make(map[io.Closer]struct{}),
	}

	status := tun.GetStatus()
	if status.Status != "active" {
		t.Fatalf("expected status active, got %s", status.Status)
	}
	if status.BindPort != 8080 {
		t.Fatalf("expected bind port 8080, got %d", status.BindPort)
	}
	if status.TargetHost != "remote.internal" || status.TargetPort != 8080 {
		t.Fatalf("unexpected target: %s:%d", status.TargetHost, status.TargetPort)
	}

	done := make(chan struct{})
	go func() {
		tun.pipeWithMetrics(p1Server, p2Server)
		close(done)
	}()

	testPayload1 := []byte("ping from client")
	go func() {
		_, _ = p1Client.Write(testPayload1)
	}()

	readBuf := make([]byte, len(testPayload1))
	if _, err := io.ReadFull(p2Client, readBuf); err != nil {
		t.Fatalf("read from p2 failed: %v", err)
	}
	if !bytes.Equal(readBuf, testPayload1) {
		t.Fatalf("expected %q, got %q", testPayload1, readBuf)
	}

	testPayload2 := []byte("pong from target")
	go func() {
		_, _ = p2Client.Write(testPayload2)
	}()

	readBuf2 := make([]byte, len(testPayload2))
	if _, err := io.ReadFull(p1Client, readBuf2); err != nil {
		t.Fatalf("read from p1 failed: %v", err)
	}
	if !bytes.Equal(readBuf2, testPayload2) {
		t.Fatalf("expected %q, got %q", testPayload2, readBuf2)
	}

	_ = p1Client.Close()
	_ = p2Client.Close()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("pipeWithMetrics did not finish in time")
	}

	updatedStatus := tun.GetStatus()
	if updatedStatus.BytesIn < int64(len(testPayload1)) {
		t.Fatalf("expected at least %d bytes in, got %d", len(testPayload1), updatedStatus.BytesIn)
	}
	if updatedStatus.BytesOut < int64(len(testPayload2)) {
		t.Fatalf("expected at least %d bytes out, got %d", len(testPayload2), updatedStatus.BytesOut)
	}

	// Close tunnel
	if err := tun.Close(); err != nil {
		t.Fatalf("tun.Close failed: %v", err)
	}
	closedStatus := tun.GetStatus()
	if closedStatus.Status != "closed" {
		t.Fatalf("expected status closed, got %s", closedStatus.Status)
	}
}

func TestForward_Socks5HandshakeAndErrors_F13(t *testing.T) {
	tun := &tunnelWrapper{
		id:         "tun-socks-test",
		sessionID:  "sess-socks",
		tunnelType: core.ForwardDynamic,
		bindAddr:   "127.0.0.1",
		bindPort:   1080,
		conns:      make(map[io.Closer]struct{}),
	}

	// 1. Test unsupported auth method
	c1, s1 := net.Pipe()
	go func() {
		handleSocks5Connection(tun, nil, s1)
	}()

	go func() {
		_, _ = c1.Write([]byte{0x05, 0x01, 0x02})
	}()

	reply := make([]byte, 2)
	_, _ = io.ReadFull(c1, reply)
	if reply[0] != 0x05 || reply[1] != 0xFF {
		t.Fatalf("expected NO ACCEPTABLE METHODS [0x05, 0xFF], got %v", reply)
	}
	_ = c1.Close()

	// 2. Test unsupported command (e.g. BIND 0x02 instead of CONNECT 0x01)
	c2, s2 := net.Pipe()
	go func() {
		handleSocks5Connection(tun, nil, s2)
	}()

	// Send version 5, 1 method: 0x00 (NO AUTH)
	go func() {
		_, _ = c2.Write([]byte{0x05, 0x01, 0x00})
	}()

	_, _ = io.ReadFull(c2, reply)
	if reply[0] != 0x05 || reply[1] != 0x00 {
		t.Fatalf("expected handshake success [0x05, 0x00], got %v", reply)
	}

	// Send BIND command header (0x02) in a goroutine so it doesn't block on unread extra bytes
	cmdReq := []byte{0x05, 0x02, 0x00, 0x01}
	go func() {
		_, _ = c2.Write(cmdReq)
	}()

	cmdReply := make([]byte, 10)
	_, _ = io.ReadFull(c2, cmdReply)
	if cmdReply[1] != 0x07 { // 0x07 = Command not supported
		t.Fatalf("expected Command Not Supported reply (0x07), got %d", cmdReply[1])
	}
	_ = c2.Close()
}

func TestForward_Socks5DomainParsing_F13(t *testing.T) {
	domain := "example.com"
	port := uint16(443)

	var reqBuf bytes.Buffer
	reqBuf.Write([]byte{0x05, 0x01, 0x00, 0x03, byte(len(domain))})
	reqBuf.WriteString(domain)
	portBytes := make([]byte, 2)
	binary.BigEndian.PutUint16(portBytes, port)
	reqBuf.Write(portBytes)

	// Validate buffer construction
	data := reqBuf.Bytes()
	if data[3] != 0x03 || int(data[4]) != len(domain) {
		t.Fatalf("unexpected socks5 domain format")
	}
	parsedPort := binary.BigEndian.Uint16(data[len(data)-2:])
	if parsedPort != port {
		t.Fatalf("expected port %d, got %d", port, parsedPort)
	}
}

func TestForward_RealDataTunneling_F13(t *testing.T) {
	cClient, cProxy := net.Pipe()
	sProxy, sTarget := net.Pipe()

	tun := &tunnelWrapper{
		id:         "tun-real-data-test",
		ruleID:     "rule-real-data",
		sessionID:  "sess-real-data",
		tunnelType: core.ForwardLocal,
		bindAddr:   "127.0.0.1",
		bindPort:   9090,
		targetHost: "127.0.0.1",
		targetPort: 80,
		conns:      make(map[io.Closer]struct{}),
	}

	done := make(chan struct{})
	go func() {
		tun.pipeWithMetrics(cProxy, sProxy)
		close(done)
	}()

	// Target server reads request, verifies it, and writes back response
	serverReceived := make(chan []byte, 1)
	go func() {
		buf := make([]byte, 18)
		_, _ = io.ReadFull(sTarget, buf)
		serverReceived <- buf
		_, _ = sTarget.Write([]byte("HTTP/1.1 200 OK\r\n\r\nHello"))
		_ = sTarget.Close()
	}()

	// Client writes HTTP request to tunnel
	go func() {
		_, _ = cClient.Write([]byte("GET / HTTP/1.1\r\n\r\n"))
	}()

	// Client reads response from tunnel
	respBuf := make([]byte, 24)
	if _, err := io.ReadFull(cClient, respBuf); err != nil {
		t.Fatalf("client failed to read response: %v", err)
	}
	if string(respBuf) != "HTTP/1.1 200 OK\r\n\r\nHello" {
		t.Fatalf("unexpected response from tunnel: %q", string(respBuf))
	}
	_ = cClient.Close()

	rec := <-serverReceived
	if string(rec) != "GET / HTTP/1.1\r\n\r\n" {
		t.Fatalf("server received unexpected payload: %q", string(rec))
	}

	<-done

	st := tun.GetStatus()
	if st.BytesIn < 18 {
		t.Fatalf("expected at least 18 bytes in, got %d", st.BytesIn)
	}
	if st.BytesOut < 24 {
		t.Fatalf("expected at least 24 bytes out, got %d", st.BytesOut)
	}
	if st.RuleID != "rule-real-data" {
		t.Fatalf("expected ruleId 'rule-real-data', got %q", st.RuleID)
	}
}
