package pivot

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"doubleagent/backend/core"
)

const maxLogLines = 150

func generateInstanceID(tool string, port uint16) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("piv-%s-%d-%s", tool, port, hex.EncodeToString(b))
}

// Instance represents a supervised external ligolo-ng / chisel subprocess (F-24).
type Instance struct {
	mu              sync.RWMutex
	info            core.PivotInstanceInfo
	cmd             *exec.Cmd
	stdin           io.WriteCloser
	cancel          context.CancelFunc
	onUpdate        func(core.PivotInstanceInfo)
	seenAgents      map[string]struct{}
	stopRequested   bool
	doneCh          chan struct{}
}

func (inst *Instance) snapshot() core.PivotInstanceInfo {
	inst.mu.RLock()
	defer inst.mu.RUnlock()
	cp := inst.info
	cp.Subnets = append([]string(nil), inst.info.Subnets...)
	cp.OpsecWarnings = append([]string(nil), inst.info.OpsecWarnings...)
	cp.RecentLogs = append([]string(nil), inst.info.RecentLogs...)
	cp.ConnectedAgents = append([]string(nil), inst.info.ConnectedAgents...)
	return cp
}

func (inst *Instance) appendLog(source string, line string) {
	trimmed := strings.TrimRight(line, "\r\n")
	if trimmed == "" {
		return
	}

	inst.mu.Lock()
	ts := time.Now().Format("15:04:05")
	entry := fmt.Sprintf("[%s] [%s] %s", ts, source, trimmed)
	inst.info.RecentLogs = append(inst.info.RecentLogs, entry)
	if len(inst.info.RecentLogs) > maxLogLines {
		inst.info.RecentLogs = inst.info.RecentLogs[len(inst.info.RecentLogs)-maxLogLines:]
	}

	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "agent joined") ||
		strings.Contains(lower, "connected") ||
		strings.Contains(lower, "session:") ||
		strings.Contains(lower, "tun:") {
		if _, exists := inst.seenAgents[trimmed]; !exists && len(inst.info.ConnectedAgents) < 32 {
			inst.seenAgents[trimmed] = struct{}{}
			inst.info.ConnectedAgents = append(inst.info.ConnectedAgents, trimmed)
		}
	}
	cb := inst.onUpdate
	snap := inst.snapshotLocked()
	inst.mu.Unlock()

	if cb != nil {
		cb(snap)
	}
}

func (inst *Instance) snapshotLocked() core.PivotInstanceInfo {
	cp := inst.info
	cp.Subnets = append([]string(nil), inst.info.Subnets...)
	cp.OpsecWarnings = append([]string(nil), inst.info.OpsecWarnings...)
	cp.RecentLogs = append([]string(nil), inst.info.RecentLogs...)
	cp.ConnectedAgents = append([]string(nil), inst.info.ConnectedAgents...)
	return cp
}

// Manager supervises active and recently stopped pivoting subprocesses (F-24).
type Manager struct {
	mu        sync.RWMutex
	instances map[string]*Instance
	onUpdate  func(core.PivotInstanceInfo)
}

// NewManager initializes a pivot process supervisor.
func NewManager(onUpdate func(core.PivotInstanceInfo)) *Manager {
	return &Manager{
		instances: make(map[string]*Instance),
		onUpdate:  onUpdate,
	}
}

// DetectBinaries checks PATH for ligolo-ng and chisel executables (F-24).
func DetectBinaries() []core.PivotBinaryStatus {
	checks := []struct {
		tool       string
		candidates []string
	}{
		{
			tool:       "ligolo-ng",
			candidates: []string{"ligolo-proxy", "proxy", "ligolo-ng", "ligolo-proxy.exe", "proxy.exe"},
		},
		{
			tool:       "chisel",
			candidates: []string{"chisel", "chisel.exe"},
		},
	}

	results := make([]core.PivotBinaryStatus, 0, len(checks))
	for _, chk := range checks {
		status := core.PivotBinaryStatus{
			Tool:       chk.tool,
			BinaryName: chk.candidates[0],
		}
		for _, cand := range chk.candidates {
			if p, err := exec.LookPath(cand); err == nil && p != "" {
				status.Found = true
				status.BinaryName = cand
				status.Path = p
				break
			}
		}
		results = append(results, status)
	}
	return results
}

func resolveBinaryPath(customPath string, candidates []string) (string, error) {
	custom := strings.TrimSpace(customPath)
	if custom != "" {
		abs, err := filepath.Abs(custom)
		if err != nil {
			return "", fmt.Errorf("invalid binary path %q: %w", customPath, err)
		}
		st, err := os.Stat(abs)
		if err != nil {
			return "", fmt.Errorf("configured binary not found at %q: %w", abs, err)
		}
		if st.IsDir() {
			return "", fmt.Errorf("configured binary path %q is a directory", abs)
		}
		return abs, nil
	}

	for _, cand := range candidates {
		if p, err := exec.LookPath(cand); err == nil && p != "" {
			return p, nil
		}
	}

	return "", fmt.Errorf("executable not found on PATH (searched: %s); install it locally or set a custom binary path", strings.Join(candidates, ", "))
}

// Start validates route, resolves the local tool executable, and starts the pivot process (F-24).
func (m *Manager) Start(ctx context.Context, route core.NetworkRoute) (core.PivotInstanceInfo, error) {
	if err := core.ValidateNetworkRoute(route); err != nil {
		return core.PivotInstanceInfo{}, err
	}

	tool := core.NormalizePivotTool(route.Tool)
	addr := strings.TrimSpace(route.BindAddress)
	if addr == "" {
		addr = "0.0.0.0"
	}
	port := route.ListenPort
	if port == 0 {
		if tool == "chisel" {
			port = 8443
		} else {
			port = 11601
		}
	}

	m.mu.Lock()
	for _, existing := range m.instances {
		snap := existing.snapshot()
		if snap.Status == "running" && snap.ListenPort == port {
			m.mu.Unlock()
			return core.PivotInstanceInfo{}, fmt.Errorf("a pivot instance (%s) is already running on port %d", snap.Name, port)
		}
	}
	m.mu.Unlock()

	candidates, args, cmdPreview := core.BuildPivotArgs(route)
	opsec := core.AnalyzePivotOpsec(route)
	instID := generateInstanceID(tool, port)

	binPath, err := resolveBinaryPath(route.BinaryPath, candidates)
	if err != nil {
		errInfo := core.PivotInstanceInfo{
			ID:             instID,
			RouteID:        route.ID,
			EngagementID:   route.EngagementID,
			Name:           route.Name,
			Tool:           tool,
			BindAddress:    addr,
			ListenPort:     port,
			SocksPort:      route.SocksPort,
			InterfaceName:  route.InterfaceName,
			Subnets:        append([]string(nil), route.Subnets...),
			Status:         "error",
			StartedAt:      time.Now().UTC().Format(time.RFC3339),
			StoppedAt:      time.Now().UTC().Format(time.RFC3339),
			ErrorMsg:       err.Error(),
			CommandPreview: cmdPreview,
			OpsecWarnings:  opsec,
			RecentLogs:     []string{fmt.Sprintf("[ERROR] %s", err.Error())},
		}
		m.mu.Lock()
		m.instances[instID] = &Instance{info: errInfo, seenAgents: map[string]struct{}{}}
		m.mu.Unlock()
		return errInfo, err
	}

	if ctx == nil {
		ctx = context.Background()
	}
	runCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(runCtx, binPath, args...)

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return core.PivotInstanceInfo{}, fmt.Errorf("failed to attach stdin pipe: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return core.PivotInstanceInfo{}, fmt.Errorf("failed to attach stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return core.PivotInstanceInfo{}, fmt.Errorf("failed to attach stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return core.PivotInstanceInfo{}, fmt.Errorf("failed to launch %s: %w", filepath.Base(binPath), err)
	}

	info := core.PivotInstanceInfo{
		ID:             instID,
		RouteID:        route.ID,
		EngagementID:   route.EngagementID,
		Name:           route.Name,
		Tool:           tool,
		BindAddress:    addr,
		ListenPort:     port,
		SocksPort:      route.SocksPort,
		InterfaceName:  route.InterfaceName,
		Subnets:        append([]string(nil), route.Subnets...),
		Status:         "running",
		PID:            cmd.Process.Pid,
		BinaryPath:     binPath,
		StartedAt:      time.Now().UTC().Format(time.RFC3339),
		CommandPreview: cmdPreview,
		OpsecWarnings:  opsec,
		RecentLogs:     []string{fmt.Sprintf("[%s] [SYS] Started %s (PID %d): %s", time.Now().Format("15:04:05"), filepath.Base(binPath), cmd.Process.Pid, cmdPreview)},
	}

	inst := &Instance{
		info:       info,
		cmd:        cmd,
		stdin:      stdinPipe,
		cancel:     cancel,
		onUpdate:   m.onUpdate,
		seenAgents: make(map[string]struct{}),
		doneCh:     make(chan struct{}),
	}

	m.mu.Lock()
	m.instances[instID] = inst
	m.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)
	readStream := func(label string, r io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		buf := make([]byte, 0, 16*1024)
		sc.Buffer(buf, 256*1024)
		for sc.Scan() {
			inst.appendLog(label, sc.Text())
		}
	}

	go readStream("OUT", stdoutPipe)
	go readStream("ERR", stderrPipe)

	go func() {
		wg.Wait()
		waitErr := cmd.Wait()
		inst.mu.Lock()
		inst.info.StoppedAt = time.Now().UTC().Format(time.RFC3339)
		if inst.stopRequested {
			inst.info.Status = "stopped"
			inst.info.ErrorMsg = ""
		} else if waitErr != nil {
			inst.info.Status = "error"
			inst.info.ErrorMsg = fmt.Sprintf("process exited: %v", waitErr)
			inst.info.RecentLogs = append(inst.info.RecentLogs, fmt.Sprintf("[%s] [ERR] %s", time.Now().Format("15:04:05"), inst.info.ErrorMsg))
		} else {
			inst.info.Status = "stopped"
		}
		cb := inst.onUpdate
		snap := inst.snapshotLocked()
		close(inst.doneCh)
		inst.mu.Unlock()

		if cb != nil {
			cb(snap)
		}
	}()

	return inst.snapshot(), nil
}

// SendInput writes an interactive console command to a running pivot instance (e.g., ligolo-proxy) (F-24).
func (m *Manager) SendInput(instanceID string, input string) error {
	m.mu.RLock()
	inst, ok := m.instances[instanceID]
	m.mu.RUnlock()
	if !ok || inst == nil {
		return errors.New("pivot instance not found")
	}

	inst.mu.Lock()
	defer inst.mu.Unlock()
	if inst.info.Status != "running" || inst.stdin == nil {
		return errors.New("pivot instance is not running")
	}

	line := strings.TrimRight(input, "\r\n") + "\n"
	if _, err := io.WriteString(inst.stdin, line); err != nil {
		return fmt.Errorf("failed to send command to pivot console: %w", err)
	}
	inst.info.RecentLogs = append(inst.info.RecentLogs, fmt.Sprintf("[%s] [IN] > %s", time.Now().Format("15:04:05"), strings.TrimSpace(input)))
	if len(inst.info.RecentLogs) > maxLogLines {
		inst.info.RecentLogs = inst.info.RecentLogs[len(inst.info.RecentLogs)-maxLogLines:]
	}
	return nil
}

// Stop terminates a running pivot subprocess and waits briefly for cleanup (F-24).
func (m *Manager) Stop(instanceID string) error {
	m.mu.RLock()
	inst, ok := m.instances[instanceID]
	m.mu.RUnlock()
	if !ok || inst == nil {
		return errors.New("pivot instance not found")
	}

	inst.mu.Lock()
	if inst.info.Status != "running" {
		// Remove stopped/error cards if user clicks Stop/Dismiss on an already terminated entry
		inst.mu.Unlock()
		m.mu.Lock()
		delete(m.instances, instanceID)
		m.mu.Unlock()
		return nil
	}
	inst.stopRequested = true
	cancel := inst.cancel
	stdin := inst.stdin
	doneCh := inst.doneCh
	inst.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}
	if cancel != nil {
		cancel()
	}

	if doneCh != nil {
		select {
		case <-doneCh:
		case <-time.After(2 * time.Second):
			if inst.cmd != nil && inst.cmd.Process != nil {
				_ = inst.cmd.Process.Kill()
			}
		}
	}

	return nil
}

// StopAll terminates every active pivot subprocess cleanly during app shutdown (F-24).
func (m *Manager) StopAll() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.instances))
	for id, inst := range m.instances {
		if inst != nil && inst.snapshot().Status == "running" {
			ids = append(ids, id)
		}
	}
	m.mu.RUnlock()

	for _, id := range ids {
		_ = m.Stop(id)
	}
}

// List returns snapshots of all active and recently stopped/errored pivot instances (F-24).
func (m *Manager) List() []core.PivotInstanceInfo {
	m.mu.RLock()
	list := make([]core.PivotInstanceInfo, 0, len(m.instances))
	for _, inst := range m.instances {
		if inst != nil {
			list = append(list, inst.snapshot())
		}
	}
	m.mu.RUnlock()

	sort.Slice(list, func(i, j int) bool {
		if list[i].Status != list[j].Status {
			return list[i].Status == "running"
		}
		return list[i].StartedAt > list[j].StartedAt
	})
	return list
}
