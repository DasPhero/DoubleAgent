package remoteagent

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"doubleagent/backend/core"
)

// Client manages a framed NDJSON-RPC connection to a remote doubleagent-agent process (F-46).
type Client struct {
	stdin        io.WriteCloser
	stdout       io.Reader
	closeFn      func() error
	onEvent      func(event string, params json.RawMessage)
	onDisconnect func(reason string)

	writeMu   sync.Mutex
	mu        sync.Mutex
	pending   map[string]chan core.AgentRPCMessage
	closed    bool
	nextReqID uint64
}

// NewClientFromStreams wraps an already-open stdin/stdout RPC stream (used both over SSH
// ExecStream and in offline io.Pipe unit tests).
func NewClientFromStreams(
	stdin io.WriteCloser,
	stdout io.Reader,
	closeFn func() error,
	onEvent func(event string, params json.RawMessage),
	onDisconnect func(reason string),
) *Client {
	c := &Client{
		stdin:        stdin,
		stdout:       stdout,
		closeFn:      closeFn,
		onEvent:      onEvent,
		onDisconnect: onDisconnect,
		pending:      make(map[string]chan core.AgentRPCMessage),
	}
	go c.readLoop()
	return c
}

func (c *Client) readLoop() {
	scanner := bufio.NewScanner(c.stdout)
	scanner.Buffer(make([]byte, 64*1024), maxRPCScannerBytes)

	disconnectReason := "remote agent connection closed"
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var msg core.AgentRPCMessage
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "res":
			c.mu.Lock()
			ch, ok := c.pending[msg.ID]
			delete(c.pending, msg.ID)
			c.mu.Unlock()
			if ok {
				ch <- msg
				close(ch)
			}
		case "evt":
			if c.onEvent != nil {
				c.onEvent(msg.Event, msg.Params)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		disconnectReason = err.Error()
	}

	c.mu.Lock()
	wasClosed := c.closed
	c.closed = true
	for id, ch := range c.pending {
		ch <- core.AgentRPCMessage{Type: "res", ID: id, Error: disconnectReason}
		close(ch)
		delete(c.pending, id)
	}
	c.mu.Unlock()

	if !wasClosed && c.onDisconnect != nil {
		c.onDisconnect(disconnectReason)
	}
}

// Call invokes an RPC method on the remote agent and unmarshals the JSON result into out (if non-nil).
func (c *Client) Call(ctx context.Context, method string, params interface{}, out interface{}) error {
	if ctx == nil {
		ctx = context.Background()
	}
	var rawParams json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return fmt.Errorf("marshal %s params: %w", method, err)
		}
		rawParams = b
	}

	id := fmt.Sprintf("r-%d", atomic.AddUint64(&c.nextReqID, 1))
	ch := make(chan core.AgentRPCMessage, 1)

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return errors.New("remote agent client is closed")
	}
	c.pending[id] = ch
	c.mu.Unlock()

	req := core.AgentRPCMessage{
		Type:   "req",
		ID:     id,
		Method: method,
		Params: rawParams,
	}
	wire, err := json.Marshal(req)
	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return err
	}
	wire = append(wire, '\n')

	c.writeMu.Lock()
	_, wErr := c.stdin.Write(wire)
	c.writeMu.Unlock()
	if wErr != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return fmt.Errorf("write rpc %s: %w", method, wErr)
	}

	select {
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return ctx.Err()
	case resp := <-ch:
		if resp.Error != "" {
			return errors.New(resp.Error)
		}
		if out != nil && len(resp.Result) > 0 {
			if err := json.Unmarshal(resp.Result, out); err != nil {
				return fmt.Errorf("unmarshal %s result: %w", method, err)
			}
		}
		return nil
	}
}

// Close closes the underlying RPC stream, causing the remote agent to tear down cleanly on stdin EOF.
func (c *Client) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	for id, ch := range c.pending {
		ch <- core.AgentRPCMessage{Type: "res", ID: id, Error: "remote agent detached"}
		close(ch)
		delete(c.pending, id)
	}
	c.mu.Unlock()

	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	if c.closeFn != nil {
		return c.closeFn()
	}
	return nil
}

// Ping verifies the agent handshake and returns host metadata.
func (c *Client) Ping(ctx context.Context) (*PingResult, error) {
	var res PingResult
	if err := c.Call(ctx, "ping", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// ListNetworkIPs queries the remote host's non-loopback IPv4 interfaces (tun0, eth0, etc.).
func (c *Client) ListNetworkIPs(ctx context.Context) ([]core.NetworkInterfaceIP, error) {
	var ips []core.NetworkInterfaceIP
	if err := c.Call(ctx, "net_interfaces", nil, &ips); err != nil {
		return nil, err
	}
	return ips, nil
}

// SpawnPTY starts an interactive Linux PTY shell on the remote host.
func (c *Client) SpawnPTY(ctx context.Context, params SpawnPTYParams) (*SpawnPTYResult, error) {
	var res SpawnPTYResult
	if err := c.Call(ctx, "pty_spawn", params, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// WritePTY sends terminal keystrokes to a remote PTY.
func (c *Client) WritePTY(ctx context.Context, ptyID string, data []byte) error {
	return c.Call(ctx, "pty_write", WritePTYParams{
		PtyID:   ptyID,
		DataB64: base64.StdEncoding.EncodeToString(data),
	}, nil)
}

// ResizePTY resizes a remote PTY.
func (c *Client) ResizePTY(ctx context.Context, ptyID string, cols, rows uint16) error {
	return c.Call(ctx, "pty_resize", ResizePTYParams{
		PtyID: ptyID,
		Cols:  cols,
		Rows:  rows,
	}, nil)
}

// ClosePTY closes a remote PTY.
func (c *Client) ClosePTY(ctx context.Context, ptyID string) error {
	return c.Call(ctx, "pty_close", ClosePTYParams{PtyID: ptyID}, nil)
}

// ListDir lists files and subdirectories on the remote host.
func (c *Client) ListDir(ctx context.Context, dirPath string) (*core.RemoteDirListing, error) {
	var listing core.RemoteDirListing
	if err := c.Call(ctx, "fs_list", ListDirParams{Path: dirPath}, &listing); err != nil {
		return nil, err
	}
	return &listing, nil
}

// Mkdir creates a directory (including parents) on the remote host.
func (c *Client) Mkdir(ctx context.Context, dirPath string) error {
	return c.Call(ctx, "fs_mkdir", MkdirParams{Path: dirPath}, nil)
}

// HashFile computes SHA-256 and MD5 checksums for a file on the remote host.
func (c *Client) HashFile(ctx context.Context, rootDir, relPath string) (*core.HostedFileEntry, error) {
	var entry core.HostedFileEntry
	if err := c.Call(ctx, "fs_hash", HashFileParams{RootDir: rootDir, RelPath: relPath}, &entry); err != nil {
		return nil, err
	}
	return &entry, nil
}

// StartListener starts a managed reverse-shell listener on the remote host (F-32, F-46).
func (c *Client) StartListener(ctx context.Context, profile core.ListenerProfile) (*core.ManagedListenerInfo, error) {
	var info core.ManagedListenerInfo
	if err := c.Call(ctx, "listener_start", profile, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// StopListener stops an active remote listener by ID.
func (c *Client) StopListener(ctx context.Context, listenerID string) error {
	return c.Call(ctx, "listener_stop", StopListenerParams{ListenerID: listenerID}, nil)
}

// ListListeners lists all active managed listeners running on the remote host.
func (c *Client) ListListeners(ctx context.Context) ([]core.ManagedListenerInfo, error) {
	var list []core.ManagedListenerInfo
	if err := c.Call(ctx, "listener_list", nil, &list); err != nil {
		return nil, err
	}
	return list, nil
}

// WriteRawSession sends bytes to a caught reverse-shell socket on the remote host.
func (c *Client) WriteRawSession(ctx context.Context, sessionID string, data []byte) error {
	return c.Call(ctx, "session_write", WriteSessionParams{
		SessionID: sessionID,
		DataB64:   base64.StdEncoding.EncodeToString(data),
	}, nil)
}

// CloseRawSession closes a caught reverse-shell socket on the remote host.
func (c *Client) CloseRawSession(ctx context.Context, sessionID string) error {
	return c.Call(ctx, "session_close", CloseSessionParams{SessionID: sessionID}, nil)
}

// StartFileServer starts a built-in HTTP staging server on the remote host (F-31, F-46).
func (c *Client) StartFileServer(ctx context.Context, cfg core.FileTransferServerConfig) (*core.FileTransferServerInfo, error) {
	var info core.FileTransferServerInfo
	if err := c.Call(ctx, "fileserver_start", cfg, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// StopFileServer stops an active remote HTTP staging server by ID.
func (c *Client) StopFileServer(ctx context.Context, serverID string) error {
	return c.Call(ctx, "fileserver_stop", StopFileServerParams{ServerID: serverID}, nil)
}

// ListFileServers lists all active HTTP staging servers on the remote host.
func (c *Client) ListFileServers(ctx context.Context) ([]core.FileTransferServerInfo, error) {
	var list []core.FileTransferServerInfo
	if err := c.Call(ctx, "fileserver_list", nil, &list); err != nil {
		return nil, err
	}
	return list, nil
}

// DetectPivotBinaries checks which pivot binaries (ligolo-ng, chisel, sshuttle) are installed on the remote host (F-24, F-46).
func (c *Client) DetectPivotBinaries(ctx context.Context) ([]core.PivotBinaryStatus, error) {
	var bins []core.PivotBinaryStatus
	if err := c.Call(ctx, "pivot_detect_binaries", nil, &bins); err != nil {
		return nil, err
	}
	return bins, nil
}

// StartPivot launches a pivot process (ligolo-ng, chisel, sshuttle) on the remote host.
func (c *Client) StartPivot(ctx context.Context, route core.NetworkRoute) (*core.PivotInstanceInfo, error) {
	var info core.PivotInstanceInfo
	if err := c.Call(ctx, "pivot_start", route, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// StopPivot stops a remote pivot process by ID.
func (c *Client) StopPivot(ctx context.Context, instanceID string) error {
	return c.Call(ctx, "pivot_stop", StopPivotParams{InstanceID: instanceID}, nil)
}

// ListPivots lists active and recent pivot instances on the remote host.
func (c *Client) ListPivots(ctx context.Context) ([]core.PivotInstanceInfo, error) {
	var list []core.PivotInstanceInfo
	if err := c.Call(ctx, "pivot_list", nil, &list); err != nil {
		return nil, err
	}
	return list, nil
}

// SendPivotInput writes an interactive console line to a running remote pivot process.
func (c *Client) SendPivotInput(ctx context.Context, instanceID, input string) error {
	return c.Call(ctx, "pivot_stdin", PivotStdinParams{InstanceID: instanceID, Input: input}, nil)
}

// FindLocalAgentBinary locates the cross-compiled headless agent binary for the given Linux arch ("amd64" or "arm64").
func FindLocalAgentBinary(arch string) (string, error) {
	filename := fmt.Sprintf("doubleagent-agent-linux-%s", arch)
	var candidates []string

	if exe, err := os.Executable(); err == nil && exe != "" {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, filename),
			filepath.Join(exeDir, "agents", filename),
		)
	}
	if wd, err := os.Getwd(); err == nil && wd != "" {
		candidates = append(candidates,
			filepath.Join(wd, "build", "bin", filename),
			filepath.Join(wd, filename),
		)
	}

	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("agent binary %s not found; run build-all script or 'GOOS=linux GOARCH=%s CGO_ENABLED=0 go build -o build/bin/%s ./cmd/doubleagent-agent'", filename, arch, filename)
}

func computeLocalSHA256(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// DeployAndAttach probes the remote SSH host, ensures ~/.doubleagent/doubleagent-agent matches
// the local SHA-256 (uploading via SFTP if missing/stale), starts the ephemeral agent over
// ExecStream, and verifies connectivity via Ping (F-46).
func DeployAndAttach(
	ctx context.Context,
	transport core.SshTransport,
	sessionID string,
	label string,
	onEvent func(event string, params json.RawMessage),
	onDisconnect func(reason string),
) (*Client, core.RemoteAgentInfo, error) {
	runner, ok := transport.(core.SshBinaryRunner)
	if !ok {
		return nil, core.RemoteAgentInfo{}, errors.New("ssh transport does not support non-PTY ExecRaw")
	}
	streamer, ok := transport.(core.SshStreamStarter)
	if !ok {
		return nil, core.RemoteAgentInfo{}, errors.New("ssh transport does not support non-PTY ExecStream")
	}

	probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	out, errOut, code, err := runner.ExecRaw(probeCtx, sessionID, "uname -s; uname -m; printf '%s\\n' \"$HOME\"", nil, 8192)
	if err != nil || code != 0 {
		return nil, core.RemoteAgentInfo{}, fmt.Errorf("probe remote host failed (exit %d): %v %s", code, err, strings.TrimSpace(string(errOut)))
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) < 3 {
		return nil, core.RemoteAgentInfo{}, fmt.Errorf("unexpected remote probe output: %q", string(out))
	}
	remoteOS := strings.ToLower(strings.TrimSpace(lines[0]))
	remoteMachine := strings.ToLower(strings.TrimSpace(lines[1]))
	remoteHome := strings.TrimSpace(lines[2])

	if remoteOS != "linux" {
		return nil, core.RemoteAgentInfo{}, fmt.Errorf("remote companion agent currently requires a Linux host (detected: %s)", remoteOS)
	}
	var goArch string
	switch remoteMachine {
	case "x86_64", "amd64":
		goArch = "amd64"
	case "aarch64", "arm64":
		goArch = "arm64"
	default:
		return nil, core.RemoteAgentInfo{}, fmt.Errorf("unsupported remote Linux architecture: %s", remoteMachine)
	}

	localBin, err := FindLocalAgentBinary(goArch)
	if err != nil {
		return nil, core.RemoteAgentInfo{}, err
	}
	localHash, err := computeLocalSHA256(localBin)
	if err != nil {
		return nil, core.RemoteAgentInfo{}, fmt.Errorf("hash local agent binary: %w", err)
	}

	remoteDir := path.Join(remoteHome, ".doubleagent")
	remoteBin := path.Join(remoteDir, "doubleagent-agent")
	remoteTmp := path.Join(remoteDir, "doubleagent-agent.tmp")

	// Ensure ~/.doubleagent and ~/.doubleagent/staging exist and check existing binary hash.
	checkCmd := `mkdir -p "$HOME/.doubleagent/staging" && chmod 700 "$HOME/.doubleagent" && (sha256sum "$HOME/.doubleagent/doubleagent-agent" 2>/dev/null | awk '{print $1}' || true)`
	hashOut, _, _, _ := runner.ExecRaw(probeCtx, sessionID, checkCmd, nil, 4096)
	remoteHash := strings.TrimSpace(string(hashOut))

	if !strings.EqualFold(remoteHash, localHash) {
		sftpClient, sErr := transport.OpenSftp(ctx, sessionID)
		if sErr != nil {
			return nil, core.RemoteAgentInfo{}, fmt.Errorf("open SFTP to deploy agent: %w", sErr)
		}
		uploadErr := sftpClient.Upload(ctx, localBin, remoteTmp, nil)
		_ = sftpClient.Close()
		if uploadErr != nil {
			return nil, core.RemoteAgentInfo{}, fmt.Errorf("upload remote agent binary: %w", uploadErr)
		}

		installCmd := `chmod 700 "$HOME/.doubleagent/doubleagent-agent.tmp" && mv -f "$HOME/.doubleagent/doubleagent-agent.tmp" "$HOME/.doubleagent/doubleagent-agent"`
		_, installErrOut, installCode, installErr := runner.ExecRaw(probeCtx, sessionID, installCmd, nil, 4096)
		if installErr != nil || installCode != 0 {
			return nil, core.RemoteAgentInfo{}, fmt.Errorf("install remote agent binary failed (exit %d): %v %s", installCode, installErr, strings.TrimSpace(string(installErrOut)))
		}
	}

	stream, err := streamer.ExecStream(ctx, sessionID, fmt.Sprintf(`exec %q`, remoteBin))
	if err != nil {
		return nil, core.RemoteAgentInfo{}, fmt.Errorf("start remote agent stream: %w", err)
	}

	// Drain stderr in background so remote diagnostic logs never block the SSH channel.
	go func() {
		if stream.Stderr != nil {
			_, _ = io.Copy(io.Discard, stream.Stderr)
		}
	}()

	client := NewClientFromStreams(stream.Stdin, stream.Stdout, stream.Close, onEvent, onDisconnect)

	pingCtx, pingCancel := context.WithTimeout(ctx, 10*time.Second)
	defer pingCancel()
	ping, err := client.Ping(pingCtx)
	if err != nil {
		_ = client.Close()
		return nil, core.RemoteAgentInfo{}, fmt.Errorf("remote agent handshake failed: %w", err)
	}

	primaryIP := ""
	if ips, ipErr := client.ListNetworkIPs(pingCtx); ipErr == nil && len(ips) > 0 {
		primaryIP = ips[0].IP
	}

	if strings.TrimSpace(label) == "" {
		label = ping.Hostname
	}

	info := core.RemoteAgentInfo{
		SessionID:    sessionID,
		Label:        label,
		Hostname:     ping.Hostname,
		OS:           ping.OS,
		Arch:         ping.Arch,
		HomeDir:      ping.HomeDir,
		DefaultShell: ping.DefaultShell,
		StagingDir:   ping.StagingDir,
		PrimaryIP:    primaryIP,
		ConnectedAt:  time.Now().UTC().Format(time.RFC3339),
		Active:       true,
	}
	return client, info, nil
}
