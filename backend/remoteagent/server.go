package remoteagent

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"doubleagent/backend/core"
	"doubleagent/backend/pivot"
	"doubleagent/backend/pty"
	"doubleagent/backend/transfer"
)

const maxRPCScannerBytes = 16 * 1024 * 1024

// PingResult is returned by the remote agent's "ping" RPC (F-46).
type PingResult struct {
	OK           bool   `json:"ok"`
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	HomeDir      string `json:"homeDir"`
	DefaultShell string `json:"defaultShell"`
	StagingDir   string `json:"stagingDir"`
}

// SpawnPTYParams configures a remote interactive PTY session on the agent host.
type SpawnPTYParams struct {
	ShellType  string `json:"shellType,omitempty"`
	WorkingDir string `json:"workingDir,omitempty"`
	AsRoot     bool   `json:"asRoot,omitempty"`
	Cols       uint16 `json:"cols"`
	Rows       uint16 `json:"rows"`
}

// SpawnPTYResult returns the spawned remote PTY identifier and title.
type SpawnPTYResult struct {
	PtyID string `json:"ptyId"`
	Title string `json:"title"`
}

// WritePTYParams writes base64-encoded terminal input bytes to a remote PTY.
type WritePTYParams struct {
	PtyID   string `json:"ptyId"`
	DataB64 string `json:"dataB64"`
}

// ResizePTYParams resizes an active remote PTY.
type ResizePTYParams struct {
	PtyID string `json:"ptyId"`
	Cols  uint16 `json:"cols"`
	Rows  uint16 `json:"rows"`
}

// ClosePTYParams closes an active remote PTY.
type ClosePTYParams struct {
	PtyID string `json:"ptyId"`
}

// PtyDataEvent is emitted asynchronously by the agent when a remote PTY produces output.
type PtyDataEvent struct {
	PtyID   string `json:"ptyId"`
	DataB64 string `json:"dataB64"`
}

// PtyExitEvent is emitted asynchronously when a remote PTY exits.
type PtyExitEvent struct {
	PtyID  string `json:"ptyId"`
	Reason string `json:"reason"`
}

// ListDirParams requests a directory listing on the remote host.
type ListDirParams struct {
	Path string `json:"path"`
}

// MkdirParams creates a directory on the remote host.
type MkdirParams struct {
	Path string `json:"path"`
}

// HashFileParams requests SHA-256 and MD5 checksums for a file on the remote host.
type HashFileParams struct {
	RootDir string `json:"rootDir"`
	RelPath string `json:"relPath"`
}

// Server serves framed NDJSON-RPC requests over stdin/stdout on the remote Linux host (F-46).
// When stdin closes (SSH disconnect or client detach), Serve cleanly tears down all active
// PTYs, listeners, caught sockets, staging servers, and pivot processes before returning.
type Server struct {
	in  io.Reader
	out io.Writer

	writeMu     sync.Mutex
	mu          sync.Mutex
	ptys        map[string]pty.Session
	listeners   map[string]*agentListener
	rawSessions map[string]core.RawTcpSession
	fileServers map[string]*transfer.ManagedServer
	pivotMgr    *pivot.Manager
}

// NewServer creates a new headless companion agent RPC server reading from in and writing to out.
func NewServer(in io.Reader, out io.Writer) *Server {
	s := &Server{
		in:          in,
		out:         out,
		ptys:        make(map[string]pty.Session),
		listeners:   make(map[string]*agentListener),
		rawSessions: make(map[string]core.RawTcpSession),
		fileServers: make(map[string]*transfer.ManagedServer),
	}
	s.pivotMgr = pivot.NewManager(func(info core.PivotInstanceInfo) {
		s.emitEvent("pivot:updated", info)
	})
	return s
}

// Serve runs the NDJSON-RPC loop until stdin hits EOF or ctx is canceled.
func (s *Server) Serve(ctx context.Context) error {
	defer s.shutdownAll()

	scanner := bufio.NewScanner(s.in)
	scanner.Buffer(make([]byte, 64*1024), maxRPCScannerBytes)

	type scanResult struct {
		line []byte
		ok   bool
		err  error
	}
	lines := make(chan scanResult, 8)
	go func() {
		defer close(lines)
		for scanner.Scan() {
			cp := append([]byte(nil), scanner.Bytes()...)
			lines <- scanResult{line: cp, ok: true}
		}
		if err := scanner.Err(); err != nil {
			lines <- scanResult{err: err}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return nil
		case res, open := <-lines:
			if !open {
				return nil
			}
			if res.err != nil {
				return res.err
			}
			if !res.ok || len(strings.TrimSpace(string(res.line))) == 0 {
				continue
			}
			var msg core.AgentRPCMessage
			if err := json.Unmarshal(res.line, &msg); err != nil {
				_ = s.sendMessage(core.AgentRPCMessage{
					Type:  "res",
					Error: fmt.Sprintf("invalid rpc json: %v", err),
				})
				continue
			}
			if msg.Type != "req" {
				continue
			}
			go s.handleRequest(ctx, msg)
		}
	}
}

func (s *Server) sendMessage(msg core.AgentRPCMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err = s.out.Write(data)
	return err
}

func (s *Server) emitEvent(event string, payload interface{}) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_ = s.sendMessage(core.AgentRPCMessage{
		Type:   "evt",
		Event:  event,
		Params: raw,
	})
}

func (s *Server) handleRequest(ctx context.Context, req core.AgentRPCMessage) {
	result, err := s.dispatch(ctx, req.Method, req.Params)
	resp := core.AgentRPCMessage{
		Type: "res",
		ID:   req.ID,
	}
	if err != nil {
		resp.Error = err.Error()
	} else if result != nil {
		raw, mErr := json.Marshal(result)
		if mErr != nil {
			resp.Error = fmt.Sprintf("marshal result: %v", mErr)
		} else {
			resp.Result = raw
		}
	}
	_ = s.sendMessage(resp)
}

func (s *Server) dispatch(ctx context.Context, method string, params json.RawMessage) (interface{}, error) {
	switch method {
	case "ping":
		return s.handlePing(), nil

	case "net_interfaces":
		return core.ListLocalIPv4Interfaces(), nil

	case "pty_spawn":
		var p SpawnPTYParams
		if len(params) > 0 {
			if err := json.Unmarshal(params, &p); err != nil {
				return nil, fmt.Errorf("invalid pty_spawn params: %w", err)
			}
		}
		return s.handleSpawnPTY(ctx, p)

	case "pty_write":
		var p WritePTYParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid pty_write params: %w", err)
		}
		return nil, s.handleWritePTY(p)

	case "pty_resize":
		var p ResizePTYParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid pty_resize params: %w", err)
		}
		return nil, s.handleResizePTY(p)

	case "pty_close":
		var p ClosePTYParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid pty_close params: %w", err)
		}
		return nil, s.handleClosePTY(p.PtyID)

	case "fs_list":
		var p ListDirParams
		if len(params) > 0 {
			if err := json.Unmarshal(params, &p); err != nil {
				return nil, fmt.Errorf("invalid fs_list params: %w", err)
			}
		}
		return s.handleListDir(p.Path)

	case "fs_mkdir":
		var p MkdirParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid fs_mkdir params: %w", err)
		}
		return nil, s.handleMkdir(p.Path)

	case "fs_hash":
		var p HashFileParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid fs_hash params: %w", err)
		}
		return s.handleHashFile(p)

	case "listener_start":
		var prof core.ListenerProfile
		if err := json.Unmarshal(params, &prof); err != nil {
			return nil, fmt.Errorf("invalid listener_start params: %w", err)
		}
		return s.handleStartListener(ctx, prof)

	case "listener_stop":
		var p StopListenerParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid listener_stop params: %w", err)
		}
		return nil, s.handleStopListener(p.ListenerID)

	case "listener_list":
		return s.handleListListeners(), nil

	case "session_write":
		var p WriteSessionParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid session_write params: %w", err)
		}
		return nil, s.handleWriteRawSession(p)

	case "session_close":
		var p CloseSessionParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid session_close params: %w", err)
		}
		return nil, s.handleCloseRawSession(p.SessionID)

	case "fileserver_start":
		var cfg core.FileTransferServerConfig
		if err := json.Unmarshal(params, &cfg); err != nil {
			return nil, fmt.Errorf("invalid fileserver_start params: %w", err)
		}
		return s.handleStartFileServer(cfg)

	case "fileserver_stop":
		var p StopFileServerParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid fileserver_stop params: %w", err)
		}
		return nil, s.handleStopFileServer(ctx, p.ServerID)

	case "fileserver_list":
		return s.handleListFileServers(), nil

	case "pivot_detect_binaries":
		return pivot.DetectBinaries(), nil

	case "pivot_start":
		var route core.NetworkRoute
		if err := json.Unmarshal(params, &route); err != nil {
			return nil, fmt.Errorf("invalid pivot_start params: %w", err)
		}
		return s.handleStartPivot(ctx, route)

	case "pivot_stop":
		var p StopPivotParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid pivot_stop params: %w", err)
		}
		return nil, s.handleStopPivot(p.InstanceID)

	case "pivot_list":
		return s.handleListPivots(), nil

	case "pivot_stdin":
		var p PivotStdinParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid pivot_stdin params: %w", err)
		}
		return nil, s.handlePivotStdin(p)

	default:
		return nil, fmt.Errorf("unknown agent rpc method: %s", method)
	}
}

func (s *Server) handlePing() PingResult {
	hostname, _ := os.Hostname()
	homeDir, _ := os.UserHomeDir()
	if homeDir == "" {
		homeDir = "/"
	}
	stagingDir := filepath.Join(homeDir, ".doubleagent", "staging")
	_ = os.MkdirAll(stagingDir, 0700)

	defaultShell := os.Getenv("SHELL")
	if defaultShell == "" {
		if runtime.GOOS == "windows" {
			defaultShell = "powershell.exe"
		} else {
			defaultShell = "/bin/bash"
		}
	}

	return PingResult{
		OK:           true,
		Hostname:     hostname,
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		HomeDir:      homeDir,
		DefaultShell: defaultShell,
		StagingDir:   stagingDir,
	}
}

func (s *Server) handleSpawnPTY(ctx context.Context, p SpawnPTYParams) (*SpawnPTYResult, error) {
	cols := p.Cols
	rows := p.Rows
	if cols == 0 {
		cols = 120
	}
	if rows == 0 {
		rows = 30
	}
	workingDir := strings.TrimSpace(p.WorkingDir)
	if workingDir == "~" || strings.HasPrefix(workingDir, "~/") {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			if workingDir == "~" {
				workingDir = home
			} else {
				workingDir = filepath.Join(home, strings.TrimPrefix(workingDir, "~/"))
			}
		}
	}

	sess, err := pty.StartShellWithOptions(ctx, pty.ShellOptions{
		ShellType:  p.ShellType,
		WorkingDir: workingDir,
		AsRoot:     p.AsRoot,
		Size:       core.TerminalSize{Cols: cols, Rows: rows},
	})
	if err != nil {
		return nil, err
	}

	ptyID := "rpty-" + sess.ID()
	s.mu.Lock()
	s.ptys[ptyID] = sess
	s.mu.Unlock()

	go func() {
		buf := make([]byte, 16*1024)
		for {
			n, rErr := sess.Stdout().Read(buf)
			if n > 0 {
				s.emitEvent("pty:data", PtyDataEvent{
					PtyID:   ptyID,
					DataB64: base64.StdEncoding.EncodeToString(buf[:n]),
				})
			}
			if rErr != nil {
				reason := "remote shell exited"
				if !errors.Is(rErr, io.EOF) {
					reason = rErr.Error()
				}
				s.mu.Lock()
				delete(s.ptys, ptyID)
				s.mu.Unlock()
				_ = sess.Close()
				s.emitEvent("pty:exit", PtyExitEvent{
					PtyID:  ptyID,
					Reason: reason,
				})
				return
			}
		}
	}()

	return &SpawnPTYResult{
		PtyID: ptyID,
		Title: sess.Title(),
	}, nil
}

func (s *Server) handleWritePTY(p WritePTYParams) error {
	s.mu.Lock()
	sess, ok := s.ptys[p.PtyID]
	s.mu.Unlock()
	if !ok || sess == nil {
		return core.ErrSessionNotFound
	}
	raw, err := base64.StdEncoding.DecodeString(p.DataB64)
	if err != nil {
		return fmt.Errorf("decode pty data: %w", err)
	}
	_, err = sess.Stdin().Write(raw)
	return err
}

func (s *Server) handleResizePTY(p ResizePTYParams) error {
	s.mu.Lock()
	sess, ok := s.ptys[p.PtyID]
	s.mu.Unlock()
	if !ok || sess == nil {
		return core.ErrSessionNotFound
	}
	return sess.Resize(core.TerminalSize{Cols: p.Cols, Rows: p.Rows})
}

func (s *Server) handleClosePTY(ptyID string) error {
	s.mu.Lock()
	sess, ok := s.ptys[ptyID]
	delete(s.ptys, ptyID)
	s.mu.Unlock()
	if !ok || sess == nil {
		return nil
	}
	return sess.Close()
}

func resolveAgentPath(raw string) string {
	p := strings.TrimSpace(raw)
	home, _ := os.UserHomeDir()
	if p == "" || p == "~" {
		if home != "" {
			return home
		}
		return "/"
	}
	if strings.HasPrefix(p, "~/") && home != "" {
		p = filepath.Join(home, strings.TrimPrefix(p, "~/"))
	}
	return filepath.Clean(p)
}

func (s *Server) handleListDir(rawPath string) (*core.RemoteDirListing, error) {
	target := resolveAgentPath(rawPath)
	entries, err := os.ReadDir(target)
	if err != nil {
		return nil, err
	}

	items := make([]core.HostedFileEntry, 0, len(entries))
	for _, ent := range entries {
		info, iErr := ent.Info()
		var size int64
		var modTime string
		if iErr == nil && info != nil {
			size = info.Size()
			modTime = info.ModTime().UTC().Format(time.RFC3339)
		}
		full := filepath.Join(target, ent.Name())
		items = append(items, core.HostedFileEntry{
			Name:     ent.Name(),
			RelPath:  ent.Name(),
			FullPath: full,
			Size:     size,
			IsDir:    ent.IsDir(),
			ModTime:  modTime,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	parent := filepath.Dir(target)
	if parent == target {
		parent = ""
	}
	return &core.RemoteDirListing{
		Path:    target,
		Parent:  parent,
		Entries: items,
	}, nil
}

func (s *Server) handleMkdir(rawPath string) error {
	target := resolveAgentPath(rawPath)
	if target == "" || target == "/" {
		return errors.New("invalid directory path")
	}
	return os.MkdirAll(target, 0750)
}

func (s *Server) handleHashFile(p HashFileParams) (*core.HostedFileEntry, error) {
	rootDir := resolveAgentPath(p.RootDir)
	safePath, err := core.ResolveSafeHostedPath(rootDir, p.RelPath)
	if err != nil {
		return nil, err
	}
	sha, md5Hex, size, err := transfer.ComputeFileHashes(safePath)
	if err != nil {
		return nil, err
	}
	fi, err := os.Stat(safePath)
	if err != nil {
		return nil, err
	}
	return &core.HostedFileEntry{
		Name:     fi.Name(),
		RelPath:  filepath.ToSlash(strings.TrimLeft(p.RelPath, "/\\")),
		FullPath: safePath,
		Size:     size,
		IsDir:    false,
		ModTime:  fi.ModTime().UTC().Format(time.RFC3339),
		SHA256:   sha,
		MD5:      md5Hex,
	}, nil
}

func (s *Server) shutdownAll() {
	s.mu.Lock()
	ptysToClose := make([]pty.Session, 0, len(s.ptys))
	for id, sess := range s.ptys {
		if sess != nil {
			ptysToClose = append(ptysToClose, sess)
		}
		delete(s.ptys, id)
	}
	listenersToClose := make([]*agentListener, 0, len(s.listeners))
	for id, l := range s.listeners {
		if l != nil {
			listenersToClose = append(listenersToClose, l)
		}
		delete(s.listeners, id)
	}
	rawToClose := make([]core.RawTcpSession, 0, len(s.rawSessions))
	for id, sess := range s.rawSessions {
		if sess != nil {
			rawToClose = append(rawToClose, sess)
		}
		delete(s.rawSessions, id)
	}
	serversToStop := make([]*transfer.ManagedServer, 0, len(s.fileServers))
	for id, srv := range s.fileServers {
		if srv != nil {
			serversToStop = append(serversToStop, srv)
		}
		delete(s.fileServers, id)
	}
	s.mu.Unlock()

	for _, sess := range ptysToClose {
		_ = sess.Close()
	}
	for _, l := range listenersToClose {
		if l.rawListener != nil {
			_ = l.rawListener.Close()
		}
	}
	for _, sess := range rawToClose {
		_ = sess.Close()
	}
	stopCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for _, srv := range serversToStop {
		_ = srv.Stop(stopCtx)
	}
	if s.pivotMgr != nil {
		s.pivotMgr.StopAll()
	}
}
