package ssh_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"doubleagent/backend/core"
	dassh "doubleagent/backend/ssh"
)

// embeddedSSHServer runs a real golang.org/x/crypto/ssh server in-process over net.Pipe
// supporting password, publickey, and keyboard-interactive 2FA, plus PTY shell + window-change.
type embeddedSSHServer struct {
	hostSigner ssh.Signer
	srvCfg     *ssh.ServerConfig
	addr       string
	port       uint16

	mu       sync.Mutex
	lastCols uint32
	lastRows uint32
	resizeCh chan core.TerminalSize
}

func startEmbeddedSSHServer(t *testing.T, port uint16, clientPubKey ssh.PublicKey) *embeddedSSHServer {
	t.Helper()

	_, hostPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate host key: %v", err)
	}
	hostSigner, err := ssh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatalf("create host signer: %v", err)
	}

	srv := &embeddedSSHServer{
		hostSigner: hostSigner,
		addr:       "127.0.0.1",
		port:       port,
		resizeCh:   make(chan core.TerminalSize, 4),
	}

	srvCfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if c.User() == "alice" && string(pass) == "correct-horse-battery-staple" {
				return nil, nil
			}
			return nil, errors.New("invalid password")
		},
		PublicKeyCallback: func(c ssh.ConnMetadata, pubKey ssh.PublicKey) (*ssh.Permissions, error) {
			if clientPubKey != nil && bytes.Equal(pubKey.Marshal(), clientPubKey.Marshal()) {
				return nil, nil
			}
			return nil, errors.New("unauthorized public key")
		},
		KeyboardInteractiveCallback: func(c ssh.ConnMetadata, client ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
			ans, err := client(c.User(), "Two-Factor Authentication", []string{"Verification code: "}, []bool{false})
			if err != nil {
				return nil, err
			}
			if len(ans) == 1 && ans[0] == "654321" {
				return nil, nil
			}
			return nil, errors.New("invalid totp code")
		},
	}
	srvCfg.AddHostKey(hostSigner)
	srv.srvCfg = srvCfg

	return srv
}

type bufferedPipeConn struct {
	net.Conn
	r io.ReadCloser
	w io.WriteCloser
}

func (c *bufferedPipeConn) Read(b []byte) (int, error)  { return c.r.Read(b) }
func (c *bufferedPipeConn) Write(b []byte) (int, error) { return c.w.Write(b) }
func (c *bufferedPipeConn) Close() error {
	_ = c.w.Close()
	return c.r.Close()
}
func (c *bufferedPipeConn) LocalAddr() net.Addr                { return dummyAddr("local") }
func (c *bufferedPipeConn) RemoteAddr() net.Addr               { return dummyAddr("remote") }
func (c *bufferedPipeConn) SetDeadline(_ time.Time) error      { return nil }
func (c *bufferedPipeConn) SetReadDeadline(_ time.Time) error  { return nil }
func (c *bufferedPipeConn) SetWriteDeadline(_ time.Time) error { return nil }

type dummyAddr string

func (d dummyAddr) Network() string { return "pipe" }
func (d dummyAddr) String() string  { return string(d) }

type asyncRingPipe struct {
	mu     sync.Mutex
	cond   *sync.Cond
	buf    bytes.Buffer
	closed bool
}

func newAsyncRingPipe() *asyncRingPipe {
	p := &asyncRingPipe{}
	p.cond = sync.NewCond(&p.mu)
	return p
}

func (p *asyncRingPipe) Read(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for p.buf.Len() == 0 && !p.closed {
		p.cond.Wait()
	}
	if p.buf.Len() == 0 && p.closed {
		return 0, io.EOF
	}
	return p.buf.Read(b)
}

func (p *asyncRingPipe) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return 0, io.ErrClosedPipe
	}
	n, err := p.buf.Write(b)
	p.cond.Broadcast()
	return n, err
}

func (p *asyncRingPipe) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.cond.Broadcast()
	return nil
}

func (s *embeddedSSHServer) dial(_ context.Context, _, _ string, _ time.Duration) (net.Conn, error) {
	cToS := newAsyncRingPipe()
	sToC := newAsyncRingPipe()
	clientConn := &bufferedPipeConn{r: sToC, w: cToS}
	serverConn := &bufferedPipeConn{r: cToS, w: sToC}
	go s.handleConn(serverConn, s.srvCfg)
	return clientConn, nil
}

func (s *embeddedSSHServer) handleConn(rawConn net.Conn, cfg *ssh.ServerConfig) {
	_, chans, reqs, err := ssh.NewServerConn(rawConn, cfg)
	if err != nil {
		_ = rawConn.Close()
		return
	}
	go ssh.DiscardRequests(reqs)

	for newChan := range chans {
		if newChan.ChannelType() != "session" {
			_ = newChan.Reject(ssh.UnknownChannelType, "only session channels are supported")
			continue
		}
		ch, requests, err := newChan.Accept()
		if err != nil {
			continue
		}
		go s.handleSession(ch, requests)
	}
}

func (s *embeddedSSHServer) handleSession(ch ssh.Channel, requests <-chan *ssh.Request) {
	for req := range requests {
		switch req.Type {
		case "pty-req":
			// Payload: string term, uint32 cols, uint32 rows, ...
			if len(req.Payload) >= 4 {
				termLen := binary.BigEndian.Uint32(req.Payload[:4])
				if uint32(len(req.Payload)) >= 4+termLen+8 {
					cols := binary.BigEndian.Uint32(req.Payload[4+termLen : 4+termLen+4])
					rows := binary.BigEndian.Uint32(req.Payload[4+termLen+4 : 4+termLen+8])
					s.mu.Lock()
					s.lastCols = cols
					s.lastRows = rows
					s.mu.Unlock()
				}
			}
			go func(r *ssh.Request) { _ = r.Reply(true, nil) }(req)

		case "shell":
			go func() {
				_ = req.Reply(true, nil)
				defer func() { _ = ch.Close() }()
				_, _ = io.Copy(ch, ch)
			}()

		case "window-change":
			if len(req.Payload) >= 8 {
				cols := binary.BigEndian.Uint32(req.Payload[0:4])
				rows := binary.BigEndian.Uint32(req.Payload[4:8])
				select {
				case s.resizeCh <- core.TerminalSize{Cols: uint16(cols), Rows: uint16(rows)}:
				default:
				}
			}
			if req.WantReply {
				go func(r *ssh.Request) { _ = r.Reply(true, nil) }(req)
			}

		default:
			if req.WantReply {
				go func(r *ssh.Request) { _ = r.Reply(false, nil) }(req)
			}
		}
	}
}

func generateEd25519PEM(t *testing.T, passphrase string) ([]byte, ssh.PublicKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatalf("ssh public key: %v", err)
	}

	var block *pem.Block
	if passphrase != "" {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(priv, "", []byte(passphrase))
	} else {
		block, err = ssh.MarshalPrivateKey(priv, "")
	}
	if err != nil {
		t.Fatalf("marshal private key: %v", err)
	}
	return pem.EncodeToMemory(block), sshPub
}

func generateRSAPEM(t *testing.T) ([]byte, ssh.PublicKey) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	sshPub, err := ssh.NewPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("ssh public key: %v", err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatalf("marshal rsa key: %v", err)
	}
	return pem.EncodeToMemory(block), sshPub
}

func TestS2_PasswordAuthAndKnownHostsTOFU_F01_F06(t *testing.T) {
	srv := startEmbeddedSSHServer(t, 2222, nil)
	store := dassh.NewKnownHostsStore()
	transport := dassh.NewTransportWithDialer(store, srv.dial)

	var seenKey core.HostKeyInfo
	sessionID, err := transport.Connect(context.Background(), core.SshSessionConfig{
		Address:  srv.addr,
		Port:     srv.port,
		Username: "alice",
		Auth: core.SshAuthConfig{
			Method:   core.AuthPassword,
			Password: "correct-horse-battery-staple",
		},
		OnFirstSeenKey: func(info core.HostKeyInfo) (bool, error) {
			seenKey = info
			return true, nil
		},
	})
	if err != nil {
		t.Fatalf("expected password connect to succeed, got: %v", err)
	}
	defer func() { _ = transport.Disconnect(context.Background(), sessionID) }()

	if !strings.HasPrefix(seenKey.Fingerprint, "SHA256:") {
		t.Fatalf("expected SHA256 fingerprint on first connection (F-06), got %q", seenKey.Fingerprint)
	}

	stored, ok := store.Lookup(srv.addr, srv.port)
	if !ok || stored.Fingerprint != seenKey.Fingerprint {
		t.Fatalf("expected host key to be persisted in KnownHostsStore, got %+v", stored)
	}
}

func TestS2_ChangedHostKeyHardBlocksConnection_F06(t *testing.T) {
	srv1 := startEmbeddedSSHServer(t, 2223, nil)
	srv2 := startEmbeddedSSHServer(t, 2224, nil) // Different generated host key

	store := dassh.NewKnownHostsStore()
	transport1 := dassh.NewTransportWithDialer(store, srv1.dial)
	transport2 := dassh.NewTransportWithDialer(store, srv2.dial)

	// 1. Trust srv1's host key on srv1.port
	sess1, err := transport1.Connect(context.Background(), core.SshSessionConfig{
		Address:  srv1.addr,
		Port:     srv1.port,
		Username: "alice",
		Auth: core.SshAuthConfig{
			Method:   core.AuthPassword,
			Password: "correct-horse-battery-staple",
		},
		OnFirstSeenKey: func(_ core.HostKeyInfo) (bool, error) {
			return true, nil
		},
	})
	if err != nil {
		t.Fatalf("initial connect failed: %v", err)
	}
	_ = transport1.Disconnect(context.Background(), sess1)

	// 2. Pre-seed srv2's port with srv1's key to simulate a MITM / changed host key on srv2
	err = store.VerifyOrTrust(srv2.addr, srv2.port, srv1.hostSigner.PublicKey(), func(_ core.HostKeyInfo) (bool, error) {
		return true, nil
	})
	if err != nil {
		t.Fatalf("seed known host failed: %v", err)
	}

	// 3. Connecting to srv2 MUST fail with ErrHostKeyMismatch and MUST NOT invoke OnFirstSeenKey
	tofuCalled := false
	_, err = transport2.Connect(context.Background(), core.SshSessionConfig{
		Address:  srv2.addr,
		Port:     srv2.port,
		Username: "alice",
		Auth: core.SshAuthConfig{
			Method:   core.AuthPassword,
			Password: "correct-horse-battery-staple",
		},
		OnFirstSeenKey: func(_ core.HostKeyInfo) (bool, error) {
			tofuCalled = true
			return true, nil
		},
	})
	if !errors.Is(err, core.ErrHostKeyMismatch) {
		t.Fatalf("expected ErrHostKeyMismatch on changed host key (F-06), got: %v", err)
	}
	if tofuCalled {
		t.Fatal("OnFirstSeenKey must never be called when a known host key changes (F-06 hard block)")
	}
}

func TestS2_PrivateKeyAuthEd25519AndRSA_F04(t *testing.T) {
	edPEM, edPub := generateEd25519PEM(t, "key-passphrase-123")
	srvEd := startEmbeddedSSHServer(t, 2225, edPub)
	transportEd := dassh.NewTransportWithDialer(nil, srvEd.dial)

	sessEd, err := transportEd.Connect(context.Background(), core.SshSessionConfig{
		Address:  srvEd.addr,
		Port:     srvEd.port,
		Username: "alice",
		Auth: core.SshAuthConfig{
			Method:     core.AuthPrivateKey,
			PrivateKey: edPEM,
			Passphrase: "key-passphrase-123",
		},
		OnFirstSeenKey: func(_ core.HostKeyInfo) (bool, error) { return true, nil },
	})
	if err != nil {
		t.Fatalf("Ed25519 private key connect failed: %v", err)
	}
	_ = transportEd.Disconnect(context.Background(), sessEd)

	rsaPEM, rsaPub := generateRSAPEM(t)
	srvRSA := startEmbeddedSSHServer(t, 2226, rsaPub)
	transportRSA := dassh.NewTransportWithDialer(nil, srvRSA.dial)
	sessRSA, err := transportRSA.Connect(context.Background(), core.SshSessionConfig{
		Address:  srvRSA.addr,
		Port:     srvRSA.port,
		Username: "alice",
		Auth: core.SshAuthConfig{
			Method:     core.AuthPrivateKey,
			PrivateKey: rsaPEM,
		},
		OnFirstSeenKey: func(_ core.HostKeyInfo) (bool, error) { return true, nil },
	})
	if err != nil {
		t.Fatalf("RSA private key connect failed: %v", err)
	}
	_ = transportRSA.Disconnect(context.Background(), sessRSA)
}

func TestS2_KeyboardInteractive2FA_F20(t *testing.T) {
	srv := startEmbeddedSSHServer(t, 2227, nil)
	transport := dassh.NewTransportWithDialer(nil, srv.dial)

	sessID, err := transport.Connect(context.Background(), core.SshSessionConfig{
		Address:  srv.addr,
		Port:     srv.port,
		Username: "alice",
		Auth: core.SshAuthConfig{
			Method: core.AuthKeyboardInteractive,
			Interactive: func(_, _ string, questions []string, _ []bool) ([]string, error) {
				if len(questions) == 1 {
					return []string{"654321"}, nil
				}
				return nil, errors.New("unexpected prompt")
			},
		},
		OnFirstSeenKey: func(_ core.HostKeyInfo) (bool, error) { return true, nil },
	})
	if err != nil {
		t.Fatalf("keyboard-interactive 2FA connect failed: %v", err)
	}
	_ = transport.Disconnect(context.Background(), sessID)
}

func TestS2_InteractivePtyShellAndResize_F07(t *testing.T) {
	srv := startEmbeddedSSHServer(t, 2228, nil)
	transport := dassh.NewTransportWithDialer(nil, srv.dial)

	sessID, err := transport.Connect(context.Background(), core.SshSessionConfig{
		Address:  srv.addr,
		Port:     srv.port,
		Username: "alice",
		Auth: core.SshAuthConfig{
			Method:   core.AuthPassword,
			Password: "correct-horse-battery-staple",
		},
		OnFirstSeenKey: func(_ core.HostKeyInfo) (bool, error) { return true, nil },
	})
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	defer func() { _ = transport.Disconnect(context.Background(), sessID) }()

	streams, err := transport.OpenShell(context.Background(), sessID, core.TerminalSize{Cols: 120, Rows: 40})
	if err != nil {
		t.Fatalf("OpenShell failed: %v", err)
	}

	payload := []byte("echo hello-doubleagent\n")
	if _, err := streams.Stdin.Write(payload); err != nil {
		t.Fatalf("write to shell stdin failed: %v", err)
	}

	buf := make([]byte, len(payload))
	if _, err := io.ReadFull(streams.Stdout, buf); err != nil {
		t.Fatalf("read from shell stdout failed: %v", err)
	}
	if !bytes.Equal(buf, payload) {
		t.Fatalf("expected echoed %q, got %q", payload, buf)
	}

	if err := transport.ResizeShell(context.Background(), sessID, core.TerminalSize{Cols: 160, Rows: 50}); err != nil {
		t.Fatalf("ResizeShell failed: %v", err)
	}

	select {
	case resized := <-srv.resizeCh:
		if resized.Cols != 160 || resized.Rows != 50 {
			t.Fatalf("expected server to receive 160x50, got %+v", resized)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for server to receive window-change request")
	}
}
