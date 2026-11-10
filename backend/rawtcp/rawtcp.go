package rawtcp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"doubleagent/backend/core"
)

func generateID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s-%s", prefix, hex.EncodeToString(b))
}

// rawTcpConnSession wraps a net.Conn with traffic metrics, state, and identity.
type rawTcpConnSession struct {
	id            string
	conn          net.Conn
	remoteAddr    string
	localAddr     string
	isListener    bool
	listenerPort  uint16
	bytesSent     uint64
	bytesReceived uint64
	connectedAt   time.Time

	mu         sync.RWMutex
	lineMode   bool
	lineEnding string
}

func newSession(conn net.Conn, isListener bool, listenerPort uint16, lineMode bool, lineEnding string) *rawTcpConnSession {
	prefix := "raw-tcp"
	if isListener {
		prefix = "raw-tcp-in"
	}
	remAddr := ""
	locAddr := ""
	if conn != nil {
		if conn.RemoteAddr() != nil {
			remAddr = conn.RemoteAddr().String()
		}
		if conn.LocalAddr() != nil {
			locAddr = conn.LocalAddr().String()
		}
	}
	if lineEnding == "" {
		lineEnding = "crlf"
	}

	return &rawTcpConnSession{
		id:           generateID(prefix),
		conn:         conn,
		remoteAddr:   remAddr,
		localAddr:    locAddr,
		isListener:   isListener,
		listenerPort: listenerPort,
		connectedAt:  time.Now(),
		lineMode:     lineMode,
		lineEnding:   lineEnding,
	}
}

func (s *rawTcpConnSession) ID() string {
	return s.id
}

func (s *rawTcpConnSession) RemoteAddr() string {
	return s.remoteAddr
}

func (s *rawTcpConnSession) LocalAddr() string {
	return s.localAddr
}

func (s *rawTcpConnSession) BytesSent() uint64 {
	return atomic.LoadUint64(&s.bytesSent)
}

func (s *rawTcpConnSession) BytesReceived() uint64 {
	return atomic.LoadUint64(&s.bytesReceived)
}

func (s *rawTcpConnSession) Stats() core.RawTcpSessionStats {
	s.mu.RLock()
	lm := s.lineMode
	le := s.lineEnding
	s.mu.RUnlock()

	return core.RawTcpSessionStats{
		ID:            s.id,
		RemoteAddr:    s.remoteAddr,
		LocalAddr:     s.localAddr,
		IsListener:    s.isListener,
		ListenerPort:  s.listenerPort,
		BytesSent:     atomic.LoadUint64(&s.bytesSent),
		BytesReceived: atomic.LoadUint64(&s.bytesReceived),
		ConnectedAt:   s.connectedAt,
		LineMode:      lm,
		LineEnding:    le,
	}
}

func (s *rawTcpConnSession) SetLineMode(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lineMode = enabled
}

func (s *rawTcpConnSession) SetLineEnding(ending string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lineEnding = strings.ToLower(strings.TrimSpace(ending))
}

func (s *rawTcpConnSession) Read(p []byte) (int, error) {
	if s.conn == nil {
		return 0, net.ErrClosed
	}
	n, err := s.conn.Read(p)
	if n > 0 {
		atomic.AddUint64(&s.bytesReceived, uint64(n))
	}
	return n, err
}

func (s *rawTcpConnSession) Write(p []byte) (int, error) {
	if s.conn == nil {
		return 0, net.ErrClosed
	}
	n, err := s.conn.Write(p)
	if n > 0 {
		atomic.AddUint64(&s.bytesSent, uint64(n))
	}
	return n, err
}

func (s *rawTcpConnSession) Close() error {
	if s.conn == nil {
		return nil
	}
	return s.conn.Close()
}

// Dial establishes an outgoing raw TCP client connection to the specified host and port (F-31).
func Dial(ctx context.Context, cfg core.RawTcpConfig) (core.RawTcpSession, error) {
	if err := core.ValidateRawTcpConfig(cfg); err != nil {
		return nil, err
	}

	timeout := 10 * time.Second
	if cfg.TimeoutSec > 0 {
		timeout = time.Duration(cfg.TimeoutSec) * time.Second
	}

	target := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	dialer := net.Dialer{Timeout: timeout}

	conn, err := dialer.DialContext(ctx, "tcp", target)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to %s: %w", target, err)
	}

	sess := newSession(conn, false, 0, cfg.LineMode, cfg.LineEnding)
	return sess, nil
}

// rawTcpListener manages a listening socket for incoming TCP connections (F-31).
type rawTcpListener struct {
	id           string
	port         uint16
	bindAddress  string
	listener     net.Listener
	startedAt    time.Time
	totalCatches int64

	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	closed bool
}

func (l *rawTcpListener) ID() string {
	return l.id
}

func (l *rawTcpListener) Port() uint16 {
	return l.port
}

func (l *rawTcpListener) BindAddress() string {
	return l.bindAddress
}

func (l *rawTcpListener) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil
	}
	l.closed = true
	l.cancel()
	if l.listener != nil {
		return l.listener.Close()
	}
	return nil
}

func (l *rawTcpListener) Info() core.RawTcpListenerInfo {
	l.mu.Lock()
	isClosed := l.closed
	l.mu.Unlock()

	status := "listening"
	if isClosed {
		status = "stopped"
	}

	return core.RawTcpListenerInfo{
		ID:           l.id,
		Port:         l.port,
		BindAddress:  l.bindAddress,
		Status:       status,
		StartedAt:    l.startedAt,
		TotalCatches: int(atomic.LoadInt64(&l.totalCatches)),
	}
}

// Listen starts a TCP listener on the configured bind address and port (F-31).
func Listen(ctx context.Context, cfg core.RawTcpListenerConfig, onAccept func(sess core.RawTcpSession)) (core.RawTcpListener, error) {
	if err := core.ValidateRawTcpListenerConfig(cfg); err != nil {
		return nil, err
	}

	bindAddr := cfg.BindAddress
	if strings.TrimSpace(bindAddr) == "" {
		bindAddr = "0.0.0.0"
	}

	listenTarget := net.JoinHostPort(bindAddr, fmt.Sprintf("%d", cfg.Port))
	l, err := net.Listen("tcp", listenTarget)
	if err != nil {
		return nil, fmt.Errorf("failed to bind listener to %s: %w", listenTarget, err)
	}

	// Resolve actual bound port (in case port 0 was passed for dynamic testing)
	actualPort := cfg.Port
	if tcpAddr, ok := l.Addr().(*net.TCPAddr); ok {
		actualPort = uint16(tcpAddr.Port)
	}

	listenCtx, cancel := context.WithCancel(ctx)
	listenerObj := &rawTcpListener{
		id:          generateID("raw-listener"),
		port:        actualPort,
		bindAddress: bindAddr,
		listener:    l,
		startedAt:   time.Now(),
		ctx:         listenCtx,
		cancel:      cancel,
	}

	go listenerObj.acceptLoop(onAccept)
	return listenerObj, nil
}

func (l *rawTcpListener) acceptLoop(onAccept func(sess core.RawTcpSession)) {
	for {
		conn, err := l.listener.Accept()
		if err != nil {
			l.mu.Lock()
			closed := l.closed
			l.mu.Unlock()
			if closed || l.ctx.Err() != nil {
				return
			}
			// Transient accept error
			select {
			case <-l.ctx.Done():
				return
			case <-time.After(50 * time.Millisecond):
				continue
			}
		}

		atomic.AddInt64(&l.totalCatches, 1)
		// For incoming reverse shells or raw connections, start in raw mode by default
		sess := newSession(conn, true, l.port, false, "crlf")
		if onAccept != nil {
			onAccept(sess)
		}
	}
}

