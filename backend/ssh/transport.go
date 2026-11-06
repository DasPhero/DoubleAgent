// Package ssh implements core.SshTransport using golang.org/x/crypto/ssh.
package ssh

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strconv"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	"doubleagent/backend/core"
)

// Modern cryptographic defaults per Spec Section 6 (Threat Model: Weak Cryptography).
var (
	modernKeyExchanges = []string{
		ssh.KeyExchangeCurve25519,
		"curve25519-sha256@libssh.org",
		ssh.KeyExchangeECDHP256,
		ssh.KeyExchangeECDHP384,
		ssh.KeyExchangeECDHP521,
	}

	modernCiphers = []string{
		ssh.CipherChaCha20Poly1305,
		ssh.CipherAES256GCM,
		ssh.CipherAES128GCM,
		ssh.CipherAES256CTR,
		ssh.CipherAES128CTR,
	}

	modernMACs = []string{
		ssh.HMACSHA256ETM,
		ssh.HMACSHA512ETM,
		ssh.HMACSHA256,
		ssh.HMACSHA512,
	}
)

// KnownHostsStore manages known host keys and SHA256 fingerprints (F-06).
type KnownHostsStore struct {
	mu      sync.RWMutex
	records map[string]core.HostKeyInfo
}

// NewKnownHostsStore creates a KnownHostsStore ready for TOFU and mismatch checks.
func NewKnownHostsStore() *KnownHostsStore {
	return &KnownHostsStore{
		records: make(map[string]core.HostKeyInfo),
	}
}

func hostRecordKey(host string, port uint16) string {
	return fmt.Sprintf("[%s]:%d", host, port)
}

// Lookup returns a previously trusted HostKeyInfo if present.
func (s *KnownHostsStore) Lookup(host string, port uint16) (core.HostKeyInfo, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	info, ok := s.records[hostRecordKey(host, port)]
	return info, ok
}

// VerifyOrTrust evaluates the server's public key against the store (F-06).
// - If already known and fingerprint matches: updates LastSeen and succeeds.
// - If already known and fingerprint differs: returns core.ErrHostKeyMismatch (hard block, no bypass).
// - If seen for the first time: calls onFirstSeen (TOFU); if absent or false, returns core.ErrHostKeyUntrusted.
func (s *KnownHostsStore) VerifyOrTrust(host string, port uint16, key ssh.PublicKey, onFirstSeen core.KnownHostDecisionFunc) error {
	now := time.Now().UTC()
	fp := ssh.FingerprintSHA256(key)
	kType := key.Type()
	recKey := hostRecordKey(host, port)

	s.mu.Lock()
	existing, exists := s.records[recKey]
	if exists {
		if existing.Fingerprint != fp || existing.KeyType != kType {
			s.mu.Unlock()
			return fmt.Errorf("%w: expected %s (%s), got %s (%s)",
				core.ErrHostKeyMismatch, existing.Fingerprint, existing.KeyType, fp, kType)
		}
		existing.LastSeen = now
		s.records[recKey] = existing
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	if onFirstSeen == nil {
		return core.ErrHostKeyUntrusted
	}

	candidate := core.HostKeyInfo{
		HostPattern: host,
		Port:        port,
		KeyType:     kType,
		Fingerprint: fp,
		FirstSeen:   now,
		LastSeen:    now,
	}

	trusted, err := onFirstSeen(candidate)
	if err != nil {
		return fmt.Errorf("%w: %v", core.ErrHostKeyUntrusted, err)
	}
	if !trusted {
		return core.ErrHostKeyUntrusted
	}

	s.mu.Lock()
	// Re-check under lock in case a concurrent connection populated a different key.
	if raced, racedExists := s.records[recKey]; racedExists {
		if raced.Fingerprint != fp || raced.KeyType != kType {
			s.mu.Unlock()
			return core.ErrHostKeyMismatch
		}
		raced.LastSeen = now
		s.records[recKey] = raced
		s.mu.Unlock()
		return nil
	}
	s.records[recKey] = candidate
	s.mu.Unlock()
	return nil
}

type activeSession struct {
	mu      sync.Mutex
	client  *ssh.Client
	shell   *ssh.Session
	closed  bool
}

// DialFunc abstracts network connection establishment (needed for ProxyJump chains F-14/F-25 and sandboxed tests).
type DialFunc func(ctx context.Context, network, addr string, timeout time.Duration) (net.Conn, error)

// Transport implements core.SshTransport on top of golang.org/x/crypto/ssh.
type Transport struct {
	mu           sync.RWMutex
	knownHosts   *KnownHostsStore
	dial         DialFunc
	agentSigners func() ([]ssh.Signer, error)
	sessions     map[string]*activeSession
}

// NewTransport constructs a new SSH Transport instance with the default TCP dialer.
func NewTransport(knownHosts *KnownHostsStore) *Transport {
	return NewTransportWithDialer(knownHosts, nil)
}

// NewTransportWithDialer constructs a new SSH Transport instance with a custom DialFunc.
func NewTransportWithDialer(knownHosts *KnownHostsStore, dial DialFunc) *Transport {
	if knownHosts == nil {
		knownHosts = NewKnownHostsStore()
	}
	if dial == nil {
		dial = func(ctx context.Context, network, addr string, timeout time.Duration) (net.Conn, error) {
			d := net.Dialer{Timeout: timeout}
			return d.DialContext(ctx, network, addr)
		}
	}
	return &Transport{
		knownHosts:   knownHosts,
		dial:         dial,
		agentSigners: DefaultAgentSigners,
		sessions:     make(map[string]*activeSession),
	}
}

// SetAgentSignersFunc overrides the SSH agent signer provider (used for testing F-05).
func (t *Transport) SetAgentSignersFunc(fn func() ([]ssh.Signer, error)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.agentSigners = fn
}

// Ensure Transport satisfies core.SshTransport at compile time.
var _ core.SshTransport = (*Transport)(nil)

// Connect establishes an authenticated SSH connection with strict host-key checking and modern algorithms.
func (t *Transport) Connect(ctx context.Context, cfg core.SshSessionConfig) (string, error) {
	if cfg.Address == "" || cfg.Username == "" {
		return "", errors.New("ssh address and username are required")
	}
	port := cfg.Port
	if port == 0 {
		port = 22
	}

	t.mu.RLock()
	agentFn := t.agentSigners
	t.mu.RUnlock()

	authMethod, err := buildAuthMethod(cfg.Auth, agentFn)
	if err != nil {
		return "", err
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	sshConfig := &ssh.ClientConfig{
		User: cfg.Username,
		Auth: []ssh.AuthMethod{authMethod},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			return t.knownHosts.VerifyOrTrust(cfg.Address, port, key, cfg.OnFirstSeenKey)
		},
		Timeout: timeout,
	}

	if !cfg.AllowLegacyAlgs {
		sshConfig.Config = ssh.Config{
			KeyExchanges: append([]string(nil), modernKeyExchanges...),
			Ciphers:      append([]string(nil), modernCiphers...),
			MACs:         append([]string(nil), modernMACs...),
		}
	}

	targetAddr := net.JoinHostPort(cfg.Address, strconv.Itoa(int(port)))
	rawConn, err := t.dial(ctx, "tcp", targetAddr, timeout)
	if err != nil {
		return "", fmt.Errorf("tcp dial %s: %w", targetAddr, err)
	}

	// Respect context cancellation during the SSH handshake.
	handshakeDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = rawConn.Close()
		case <-handshakeDone:
		}
	}()

	sshConn, chans, reqs, err := ssh.NewClientConn(rawConn, targetAddr, sshConfig)
	close(handshakeDone)
	if err != nil {
		_ = rawConn.Close()
		return "", err
	}

	client := ssh.NewClient(sshConn, chans, reqs)
	sessionID, err := generateSessionID()
	if err != nil {
		_ = client.Close()
		return "", err
	}

	t.mu.Lock()
	t.sessions[sessionID] = &activeSession{
		client: client,
	}
	t.mu.Unlock()

	return sessionID, nil
}

// OpenShell opens an interactive PTY shell on an active SSH session (F-07).
func (t *Transport) OpenShell(ctx context.Context, sessionID string, size core.TerminalSize) (*core.SshShellStreams, error) {
	return t.OpenShellWithOptions(ctx, sessionID, size, "", false)
}

// OpenShellWithOptions opens an interactive PTY shell with optional initial directory and root elevation (F-10).
func (t *Transport) OpenShellWithOptions(_ context.Context, sessionID string, size core.TerminalSize, initialDir string, asRoot bool) (*core.SshShellStreams, error) {
	sess, err := t.getSession(sessionID)
	if err != nil {
		return nil, err
	}

	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.closed {
		return nil, core.ErrSessionNotFound
	}
	if sess.shell != nil {
		return nil, errors.New("shell already open for this session")
	}

	sshSess, err := sess.client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("create ssh session: %w", err)
	}

	cols := int(size.Cols)
	if cols <= 0 {
		cols = 80
	}
	rows := int(size.Rows)
	if rows <= 0 {
		rows = 24
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 38400,
		ssh.TTY_OP_OSPEED: 38400,
	}

	if err := sshSess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = sshSess.Close()
		return nil, fmt.Errorf("request pty: %w", err)
	}

	stdin, err := sshSess.StdinPipe()
	if err != nil {
		_ = sshSess.Close()
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := sshSess.StdoutPipe()
	if err != nil {
		_ = sshSess.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := sshSess.StderrPipe()
	if err != nil {
		_ = sshSess.Close()
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}

	if asRoot {
		var startCmd string
		if initialDir != "" {
			startCmd = fmt.Sprintf("sudo -s -H sh -c 'cd %q && exec \"${SHELL:-/bin/bash}\"'", initialDir)
		} else {
			startCmd = "sudo -s"
		}
		if err := sshSess.Start(startCmd); err != nil {
			_ = sshSess.Close()
			return nil, fmt.Errorf("start remote root shell: %w", err)
		}
	} else if initialDir != "" {
		startCmd := fmt.Sprintf("sh -c 'cd %q && exec \"${SHELL:-/bin/bash}\" -l'", initialDir)
		if err := sshSess.Start(startCmd); err != nil {
			_ = sshSess.Close()
			return nil, fmt.Errorf("start remote shell in dir: %w", err)
		}
	} else {
		if err := sshSess.Shell(); err != nil {
			_ = sshSess.Close()
			return nil, fmt.Errorf("start remote shell: %w", err)
		}
	}

	sess.shell = sshSess
	return &core.SshShellStreams{
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: stderr,
	}, nil
}

// ResizeShell updates the PTY window dimensions of an active shell (F-07).
func (t *Transport) ResizeShell(_ context.Context, sessionID string, size core.TerminalSize) error {
	if size.Cols == 0 || size.Rows == 0 {
		return errors.New("terminal cols and rows must be greater than zero")
	}

	sess, err := t.getSession(sessionID)
	if err != nil {
		return err
	}

	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.closed || sess.shell == nil {
		return core.ErrSessionNotFound
	}

	return sess.shell.WindowChange(int(size.Rows), int(size.Cols))
}

// Disconnect closes any active shell and terminates the underlying SSH connection.
func (t *Transport) Disconnect(_ context.Context, sessionID string) error {
	t.mu.Lock()
	sess, ok := t.sessions[sessionID]
	if !ok {
		t.mu.Unlock()
		return core.ErrSessionNotFound
	}
	delete(t.sessions, sessionID)
	t.mu.Unlock()

	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.closed = true

	if sess.shell != nil {
		_ = sess.shell.Close()
		sess.shell = nil
	}
	return sess.client.Close()
}

func (t *Transport) getSession(sessionID string) (*activeSession, error) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	sess, ok := t.sessions[sessionID]
	if !ok {
		return nil, core.ErrSessionNotFound
	}
	return sess, nil
}

func buildAuthMethod(auth core.SshAuthConfig, agentFn func() ([]ssh.Signer, error)) (ssh.AuthMethod, error) {
	switch auth.Method {
	case core.AuthPassword:
		if auth.Password == "" {
			return nil, errors.New("password is required for password authentication")
		}
		return ssh.Password(auth.Password), nil

	case core.AuthPrivateKey:
		if len(auth.PrivateKey) == 0 {
			return nil, errors.New("private key PEM is required for key authentication")
		}
		var (
			signer ssh.Signer
			err    error
		)
		if auth.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(auth.PrivateKey, []byte(auth.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(auth.PrivateKey)
		}
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return ssh.PublicKeys(signer), nil

	case core.AuthAgent:
		if agentFn == nil {
			agentFn = DefaultAgentSigners
		}
		signers, err := agentFn()
		if err != nil {
			return nil, err
		}
		return ssh.PublicKeys(signers...), nil

	case core.AuthKeyboardInteractive:
		if auth.Interactive == nil {
			return nil, errors.New("interactive responder is required for keyboard-interactive authentication")
		}
		return ssh.KeyboardInteractive(func(name, instruction string, questions []string, echos []bool) ([]string, error) {
			return auth.Interactive(name, instruction, questions, echos)
		}), nil

	default:
		return nil, fmt.Errorf("%w: %q", core.ErrUnsupportedAuthType, auth.Method)
	}
}

func generateSessionID() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("generate session id: %w", err)
	}
	return hex.EncodeToString(buf[:]), nil
}
