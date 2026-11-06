package ssh

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"doubleagent/backend/core"
	"golang.org/x/crypto/ssh"
	"golang.org/x/net/proxy"
)

type proxyAddr struct {
	network string
	address string
}

func (a proxyAddr) Network() string { return a.network }
func (a proxyAddr) String() string  { return a.address }

// processConn wraps the standard input and output pipes of a spawned ProxyCommand process into a net.Conn (F-14).
type processConn struct {
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     io.ReadCloser
	localAddr  net.Addr
	remoteAddr net.Addr
	closed     atomic.Bool
	closeOnce  sync.Once
}

func (c *processConn) Read(b []byte) (n int, err error) {
	if c.closed.Load() {
		return 0, net.ErrClosed
	}
	return c.stdout.Read(b)
}

func (c *processConn) Write(b []byte) (n int, err error) {
	if c.closed.Load() {
		return 0, net.ErrClosed
	}
	return c.stdin.Write(b)
}

func (c *processConn) Close() error {
	var closeErr error
	c.closeOnce.Do(func() {
		c.closed.Store(true)
		if c.stdin != nil {
			_ = c.stdin.Close()
		}
		if c.stdout != nil {
			_ = c.stdout.Close()
		}
		if c.cmd != nil && c.cmd.Process != nil {
			_ = c.cmd.Process.Kill()
			_ = c.cmd.Wait()
		}
	})
	return closeErr
}

func (c *processConn) LocalAddr() net.Addr                { return c.localAddr }
func (c *processConn) RemoteAddr() net.Addr               { return c.remoteAddr }
func (c *processConn) SetDeadline(t time.Time) error      { return nil }
func (c *processConn) SetReadDeadline(t time.Time) error  { return nil }
func (c *processConn) SetWriteDeadline(t time.Time) error { return nil }

// dialProxyCommand executes a local command with %h and %p substitution and wraps it into a net.Conn (F-14).
func dialProxyCommand(ctx context.Context, commandStr, targetHost string, targetPort uint16) (net.Conn, error) {
	if strings.TrimSpace(commandStr) == "" {
		return nil, errors.New("empty proxy command")
	}

	// Expand %h, %p, %%
	portStr := strconv.Itoa(int(targetPort))
	expanded := strings.ReplaceAll(commandStr, "%%", "\x00")
	expanded = strings.ReplaceAll(expanded, "%h", targetHost)
	expanded = strings.ReplaceAll(expanded, "%p", portStr)
	expanded = strings.ReplaceAll(expanded, "\x00", "%")

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd.exe", "/c", expanded)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", expanded)
	}
	setProcAttr(cmd)

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("proxycommand stdin pipe: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdinPipe.Close()
		return nil, fmt.Errorf("proxycommand stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		_ = stdinPipe.Close()
		_ = stdoutPipe.Close()
		return nil, fmt.Errorf("start proxycommand %q: %w", expanded, err)
	}

	return &processConn{
		cmd:        cmd,
		stdin:      stdinPipe,
		stdout:     stdoutPipe,
		localAddr:  proxyAddr{network: "proxycommand", address: "local"},
		remoteAddr: proxyAddr{network: "proxycommand", address: net.JoinHostPort(targetHost, portStr)},
	}, nil
}

// dialSocks5 establishes a TCP connection to the target via a SOCKS5 proxy (F-14).
func dialSocks5(ctx context.Context, socksProxy, targetAddr string, auth *core.SocksAuth, timeout time.Duration) (net.Conn, error) {
	var proxyAuth *proxy.Auth
	if auth != nil && auth.Username != "" {
		proxyAuth = &proxy.Auth{
			User:     auth.Username,
			Password: auth.Password,
		}
	}

	forwardDialer := &net.Dialer{Timeout: timeout}
	dialer, err := proxy.SOCKS5("tcp", socksProxy, proxyAuth, forwardDialer)
	if err != nil {
		return nil, fmt.Errorf("socks5 proxy dialer init: %w", err)
	}

	if contextDialer, ok := dialer.(proxy.ContextDialer); ok {
		return contextDialer.DialContext(ctx, "tcp", targetAddr)
	}

	type dialRes struct {
		conn net.Conn
		err  error
	}
	ch := make(chan dialRes, 1)
	go func() {
		c, err := dialer.Dial("tcp", targetAddr)
		ch <- dialRes{conn: c, err: err}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		return res.conn, res.err
	}
}

// dialProxyJump connects through a chain of intermediate SSH bastions and returns a connection to the final target (F-14, F-25).
func (t *Transport) dialProxyJump(ctx context.Context, chain []core.SshSessionConfig, targetAddr string, timeout time.Duration) (net.Conn, []*ssh.Client, []io.Closer, error) {
	if len(chain) == 0 {
		return nil, nil, nil, errors.New("empty jump chain")
	}

	var (
		jumpClients []*ssh.Client
		closers     []io.Closer
		currClient  *ssh.Client
	)

	cleanup := func() {
		for i := len(jumpClients) - 1; i >= 0; i-- {
			_ = jumpClients[i].Close()
		}
		for i := len(closers) - 1; i >= 0; i-- {
			_ = closers[i].Close()
		}
	}

	for i, hop := range chain {
		hopPort := hop.Port
		if hopPort == 0 {
			hopPort = 22
		}
		hopTimeout := hop.Timeout
		if hopTimeout <= 0 {
			hopTimeout = timeout
		}

		t.mu.RLock()
		agentFn := t.agentSigners
		t.mu.RUnlock()

		hopAuth, err := buildAuthMethod(hop.Auth, agentFn)
		if err != nil {
			cleanup()
			return nil, nil, nil, fmt.Errorf("hop %d (%s) auth: %w", i, hop.Address, err)
		}

		hopConfig := &ssh.ClientConfig{
			User: hop.Username,
			Auth: []ssh.AuthMethod{hopAuth},
			HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
				return t.knownHosts.VerifyOrTrust(hop.Address, hopPort, key, hop.OnFirstSeenKey)
			},
			Timeout: hopTimeout,
		}

		if !hop.AllowLegacyAlgs {
			hopConfig.Config = ssh.Config{
				KeyExchanges: append([]string(nil), modernKeyExchanges...),
				Ciphers:      append([]string(nil), modernCiphers...),
				MACs:         append([]string(nil), modernMACs...),
			}
		}

		hopAddr := net.JoinHostPort(hop.Address, strconv.Itoa(int(hopPort)))
		var hopRawConn net.Conn

		if i == 0 {
			// First hop: dial from local machine
			if hop.ProxyCommand != "" {
				hopRawConn, err = dialProxyCommand(ctx, hop.ProxyCommand, hop.Address, hopPort)
			} else if hop.SocksProxy != "" {
				hopRawConn, err = dialSocks5(ctx, hop.SocksProxy, hopAddr, hop.SocksAuth, hopTimeout)
			} else {
				hopRawConn, err = t.dial(ctx, "tcp", hopAddr, hopTimeout)
			}
			if err != nil {
				cleanup()
				return nil, nil, nil, fmt.Errorf("dial hop %d (%s): %w", i, hopAddr, err)
			}
			closers = append(closers, hopRawConn)
		} else {
			// Subsequent hops: dial through previous jump client
			hopRawConn, err = currClient.Dial("tcp", hopAddr)
			if err != nil {
				cleanup()
				return nil, nil, nil, fmt.Errorf("dial hop %d (%s) via bastion: %w", i, hopAddr, err)
			}
			closers = append(closers, hopRawConn)
		}

		cConn, chans, reqs, err := ssh.NewClientConn(hopRawConn, hopAddr, hopConfig)
		if err != nil {
			_ = hopRawConn.Close()
			cleanup()
			return nil, nil, nil, fmt.Errorf("handshake hop %d (%s): %w", i, hopAddr, err)
		}
		currClient = ssh.NewClient(cConn, chans, reqs)
		jumpClients = append(jumpClients, currClient)
	}

	// Dial final target host through the last jump client
	targetConn, err := currClient.Dial("tcp", targetAddr)
	if err != nil {
		cleanup()
		return nil, nil, nil, fmt.Errorf("dial target %s via jump chain: %w", targetAddr, err)
	}

	return targetConn, jumpClients, closers, nil
}
