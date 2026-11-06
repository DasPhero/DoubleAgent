package ssh

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"

	"doubleagent/backend/core"
)

type tunnelWrapper struct {
	mu          sync.Mutex
	id          string
	ruleID      string
	sessionID   string
	hostID      string
	tunnelType  core.ForwardRuleType
	bindAddr    string
	bindPort    uint16
	targetHost  string
	targetPort  uint16
	listener    net.Listener
	closed      bool
	bytesIn     int64
	bytesOut    int64
	activeConns int64
	errMsg      string
	connsMu     sync.Mutex
	conns       map[io.Closer]struct{}
}

func (t *tunnelWrapper) GetStatus() core.ForwardTunnelStatus {
	t.mu.Lock()
	defer t.mu.Unlock()

	status := "active"
	if t.closed {
		status = "closed"
	} else if t.errMsg != "" {
		status = "error"
	}

	return core.ForwardTunnelStatus{
		ID:           t.id,
		RuleID:       t.ruleID,
		SessionID:    t.sessionID,
		HostID:       t.hostID,
		Type:         t.tunnelType,
		BindAddress:  t.bindAddr,
		BindPort:     t.bindPort,
		TargetHost:   t.targetHost,
		TargetPort:   t.targetPort,
		Status:       status,
		BytesIn:      atomic.LoadInt64(&t.bytesIn),
		BytesOut:     atomic.LoadInt64(&t.bytesOut),
		ActiveConns:  int(atomic.LoadInt64(&t.activeConns)),
		ErrorMessage: t.errMsg,
	}
}

func (t *tunnelWrapper) Close() error {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil
	}
	t.closed = true
	var err error
	if t.listener != nil {
		err = t.listener.Close()
	}
	t.mu.Unlock()

	// Close any active forwarded connections
	t.connsMu.Lock()
	for c := range t.conns {
		_ = c.Close()
	}
	t.conns = make(map[io.Closer]struct{})
	t.connsMu.Unlock()

	return err
}

func (t *tunnelWrapper) trackConn(c io.Closer) {
	t.connsMu.Lock()
	t.conns[c] = struct{}{}
	t.connsMu.Unlock()
}

func (t *tunnelWrapper) untrackConn(c io.Closer) {
	t.connsMu.Lock()
	delete(t.conns, c)
	t.connsMu.Unlock()
}

// pipeWithMetrics copies data bidirectionally between c1 and c2 while updating tunnel metrics.
func (t *tunnelWrapper) pipeWithMetrics(c1, c2 io.ReadWriteCloser) {
	atomic.AddInt64(&t.activeConns, 1)
	defer atomic.AddInt64(&t.activeConns, -1)

	t.trackConn(c1)
	t.trackConn(c2)
	defer func() {
		t.untrackConn(c1)
		t.untrackConn(c2)
		_ = c1.Close()
		_ = c2.Close()
	}()

	var once sync.Once
	closeBoth := func() {
		once.Do(func() {
			_ = c1.Close()
			_ = c2.Close()
		})
	}

	var wg sync.WaitGroup
	wg.Add(2)

	// c1 -> c2 (bytes in / uploaded)
	go func() {
		defer wg.Done()
		defer closeBoth()
		buf := make([]byte, 32*1024)
		for {
			nr, er := c1.Read(buf)
			if nr > 0 {
				nw, ew := c2.Write(buf[0:nr])
				if nw > 0 {
					atomic.AddInt64(&t.bytesIn, int64(nw))
				}
				if ew != nil {
					break
				}
			}
			if er != nil {
				break
			}
		}
	}()

	// c2 -> c1 (bytes out / downloaded)
	go func() {
		defer wg.Done()
		defer closeBoth()
		buf := make([]byte, 32*1024)
		for {
			nr, er := c2.Read(buf)
			if nr > 0 {
				nw, ew := c1.Write(buf[0:nr])
				if nw > 0 {
					atomic.AddInt64(&t.bytesOut, int64(nw))
				}
				if ew != nil {
					break
				}
			}
			if er != nil {
				break
			}
		}
	}()

	wg.Wait()
}

// StartForwardLocal starts local port forwarding (-L) where DoubleAgent listens on a local address/port
// and tunnels incoming connections through the SSH client to a target host and port reachable from the remote server.
func (t *Transport) StartForwardLocal(
	ctx context.Context,
	sessionID string,
	bindAddr string,
	bindPort uint16,
	targetHost string,
	targetPort uint16,
) (core.ForwardTunnel, error) {
	sess, err := t.getSession(sessionID)
	if err != nil {
		return nil, err
	}

	if bindAddr == "" {
		bindAddr = "127.0.0.1"
	}

	listener, err := net.Listen("tcp", net.JoinHostPort(bindAddr, fmt.Sprintf("%d", bindPort)))
	if err != nil {
		return nil, fmt.Errorf("local listen failed on %s:%d: %w", bindAddr, bindPort, err)
	}

	actualPort := bindPort
	if tcpAddr, ok := listener.Addr().(*net.TCPAddr); ok && actualPort == 0 {
		actualPort = uint16(tcpAddr.Port)
	}

	tun := &tunnelWrapper{
		id:         fmt.Sprintf("tun-L-%d", time.Now().UnixNano()),
		sessionID:  sessionID,
		tunnelType: core.ForwardLocal,
		bindAddr:   bindAddr,
		bindPort:   actualPort,
		targetHost: targetHost,
		targetPort: targetPort,
		listener:   listener,
		conns:      make(map[io.Closer]struct{}),
	}

	go func() {
		targetAddr := net.JoinHostPort(targetHost, fmt.Sprintf("%d", targetPort))
		for {
			localConn, acceptErr := listener.Accept()
			if acceptErr != nil {
				tun.mu.Lock()
				if !tun.closed {
					tun.errMsg = acceptErr.Error()
				}
				tun.mu.Unlock()
				return
			}

			go func(lConn net.Conn) {
				remoteConn, dialErr := sess.client.Dial("tcp", targetAddr)
				if dialErr != nil {
					_ = lConn.Close()
					return
				}
				tun.pipeWithMetrics(lConn, remoteConn)
			}(localConn)
		}
	}()

	return tun, nil
}

// StartForwardRemote starts remote port forwarding (-R) where the SSH server listens on a remote address/port
// and tunnels incoming connections through the SSH client to a local target host and port.
func (t *Transport) StartForwardRemote(
	ctx context.Context,
	sessionID string,
	bindAddr string,
	bindPort uint16,
	targetHost string,
	targetPort uint16,
) (core.ForwardTunnel, error) {
	sess, err := t.getSession(sessionID)
	if err != nil {
		return nil, err
	}

	if bindAddr == "" {
		bindAddr = "127.0.0.1"
	}

	remoteListener, err := sess.client.Listen("tcp", net.JoinHostPort(bindAddr, fmt.Sprintf("%d", bindPort)))
	if err != nil {
		return nil, fmt.Errorf("remote listen failed on %s:%d: %w", bindAddr, bindPort, err)
	}

	actualPort := bindPort
	if tcpAddr, ok := remoteListener.Addr().(*net.TCPAddr); ok && actualPort == 0 {
		actualPort = uint16(tcpAddr.Port)
	}

	tun := &tunnelWrapper{
		id:         fmt.Sprintf("tun-R-%d", time.Now().UnixNano()),
		sessionID:  sessionID,
		tunnelType: core.ForwardRemote,
		bindAddr:   bindAddr,
		bindPort:   actualPort,
		targetHost: targetHost,
		targetPort: targetPort,
		listener:   remoteListener,
		conns:      make(map[io.Closer]struct{}),
	}

	go func() {
		targetAddr := net.JoinHostPort(targetHost, fmt.Sprintf("%d", targetPort))
		for {
			remoteConn, acceptErr := remoteListener.Accept()
			if acceptErr != nil {
				tun.mu.Lock()
				if !tun.closed {
					tun.errMsg = acceptErr.Error()
				}
				tun.mu.Unlock()
				return
			}

			go func(rConn net.Conn) {
				localConn, dialErr := net.Dial("tcp", targetAddr)
				if dialErr != nil {
					_ = rConn.Close()
					return
				}
				tun.pipeWithMetrics(rConn, localConn)
			}(remoteConn)
		}
	}()

	return tun, nil
}

// StartForwardDynamic starts dynamic SOCKS5 forwarding (-D) where DoubleAgent listens locally as a SOCKS5 proxy
// and dials destinations through the remote SSH client according to RFC 1928.
func (t *Transport) StartForwardDynamic(
	ctx context.Context,
	sessionID string,
	bindAddr string,
	bindPort uint16,
) (core.ForwardTunnel, error) {
	sess, err := t.getSession(sessionID)
	if err != nil {
		return nil, err
	}

	if bindAddr == "" {
		bindAddr = "127.0.0.1"
	}

	listener, err := net.Listen("tcp", net.JoinHostPort(bindAddr, fmt.Sprintf("%d", bindPort)))
	if err != nil {
		return nil, fmt.Errorf("dynamic SOCKS5 listen failed on %s:%d: %w", bindAddr, bindPort, err)
	}

	actualPort := bindPort
	if tcpAddr, ok := listener.Addr().(*net.TCPAddr); ok && actualPort == 0 {
		actualPort = uint16(tcpAddr.Port)
	}

	tun := &tunnelWrapper{
		id:         fmt.Sprintf("tun-D-%d", time.Now().UnixNano()),
		sessionID:  sessionID,
		tunnelType: core.ForwardDynamic,
		bindAddr:   bindAddr,
		bindPort:   actualPort,
		listener:   listener,
		conns:      make(map[io.Closer]struct{}),
	}

	go func() {
		for {
			clientConn, acceptErr := listener.Accept()
			if acceptErr != nil {
				tun.mu.Lock()
				if !tun.closed {
					tun.errMsg = acceptErr.Error()
				}
				tun.mu.Unlock()
				return
			}

			go handleSocks5Connection(tun, sess.client, clientConn)
		}
	}()

	return tun, nil
}

// handleSocks5Connection executes the RFC 1928 SOCKS Protocol Version 5 handshake and connect request.
func handleSocks5Connection(tun *tunnelWrapper, sshClient *ssh.Client, conn net.Conn) {
	defer conn.Close()

	// 1. Negotiation handshake: VER | NMETHODS | METHODS
	header := make([]byte, 2)
	if _, err := io.ReadFull(conn, header); err != nil {
		return
	}
	if header[0] != 0x05 { // SOCKS version 5
		return
	}

	nMethods := int(header[1])
	methods := make([]byte, nMethods)
	if _, err := io.ReadFull(conn, methods); err != nil {
		return
	}

	// DoubleAgent supports Method 0x00: NO AUTHENTICATION REQUIRED
	hasNoAuth := false
	for _, m := range methods {
		if m == 0x00 {
			hasNoAuth = true
			break
		}
	}
	if !hasNoAuth {
		// 0xFF: NO ACCEPTABLE METHODS
		_, _ = conn.Write([]byte{0x05, 0xFF})
		return
	}

	// Reply: VER (0x05) | METHOD (0x00)
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
		return
	}

	// 2. Client request: VER (0x05) | CMD | RSV (0x00) | ATYP | DST.ADDR | DST.PORT
	reqHeader := make([]byte, 4)
	if _, err := io.ReadFull(conn, reqHeader); err != nil {
		return
	}
	if reqHeader[0] != 0x05 {
		return
	}

	cmd := reqHeader[1]
	if cmd != 0x01 { // 0x01 = CONNECT (DoubleAgent supports TCP CONNECT)
		// Reply 0x07: Command not supported
		_, _ = conn.Write([]byte{0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}

	atyp := reqHeader[3]
	var destHost string

	switch atyp {
	case 0x01: // IPv4
		ipv4 := make([]byte, 4)
		if _, err := io.ReadFull(conn, ipv4); err != nil {
			return
		}
		destHost = net.IP(ipv4).String()

	case 0x03: // Domain name
		lenBuf := make([]byte, 1)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			return
		}
		domainLen := int(lenBuf[0])
		domainBuf := make([]byte, domainLen)
		if _, err := io.ReadFull(conn, domainBuf); err != nil {
			return
		}
		destHost = string(domainBuf)

	case 0x04: // IPv6
		ipv6 := make([]byte, 16)
		if _, err := io.ReadFull(conn, ipv6); err != nil {
			return
		}
		destHost = net.IP(ipv6).String()

	default:
		// 0x08: Address type not supported
		_, _ = conn.Write([]byte{0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}

	portBuf := make([]byte, 2)
	if _, err := io.ReadFull(conn, portBuf); err != nil {
		return
	}
	destPort := binary.BigEndian.Uint16(portBuf)
	targetAddr := net.JoinHostPort(destHost, fmt.Sprintf("%d", destPort))

	// 3. Dial target address via remote SSH connection
	remoteConn, dialErr := sshClient.Dial("tcp", targetAddr)
	if dialErr != nil {
		// 0x04: Host unreachable
		_, _ = conn.Write([]byte{0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}

	// 4. Send success reply: VER (0x05) | REP (0x00) | RSV (0x00) | ATYP (0x01) | BND.ADDR (0.0.0.0) | BND.PORT (0)
	if _, err := conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
		_ = remoteConn.Close()
		return
	}

	// 5. Transfer data between client and target
	tun.pipeWithMetrics(conn, remoteConn)
}
