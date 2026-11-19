package remoteagent

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"doubleagent/backend/core"
	"doubleagent/backend/rawtcp"
	"doubleagent/backend/transfer"
)

type agentListener struct {
	id             string
	profileID      string
	name           string
	kind           string
	tool           string
	bindAddress    string
	port           uint16
	autoSpawnTab   bool
	rawListener    core.RawTcpListener
	startedAt      time.Time
	catchCount     int
	commandPreview string
}

// StopListenerParams identifies a remote managed listener to stop.
type StopListenerParams struct {
	ListenerID string `json:"listenerId"`
}

// WriteSessionParams writes base64-encoded bytes to a caught remote raw TCP session.
type WriteSessionParams struct {
	SessionID string `json:"sessionId"`
	DataB64   string `json:"dataB64"`
}

// CloseSessionParams closes a caught remote raw TCP session.
type CloseSessionParams struct {
	SessionID string `json:"sessionId"`
}

// SessionDataEvent is emitted when a caught remote raw TCP session produces output.
type SessionDataEvent struct {
	SessionID string `json:"sessionId"`
	DataB64   string `json:"dataB64"`
}

// SessionClosedEvent is emitted when a caught remote raw TCP session closes.
type SessionClosedEvent struct {
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason"`
}

// StopFileServerParams identifies a remote HTTP staging server to stop.
type StopFileServerParams struct {
	ServerID string `json:"serverId"`
}

// TransferServerEventEnvelope wraps a transfer.ManagedServer request event for RPC emission.
type TransferServerEventEnvelope struct {
	ServerID string                 `json:"serverId"`
	Event    core.FileTransferEvent `json:"event"`
}

// StopPivotParams identifies a remote pivot process to stop.
type StopPivotParams struct {
	InstanceID string `json:"instanceId"`
}

// PivotStdinParams sends an interactive console line to a remote pivot process.
type PivotStdinParams struct {
	InstanceID string `json:"instanceId"`
	Input      string `json:"input"`
}

func (s *Server) handleStartListener(ctx context.Context, profile core.ListenerProfile) (*core.ManagedListenerInfo, error) {
	if err := core.ValidateListenerProfile(profile); err != nil {
		return nil, err
	}

	bindAddr := strings.TrimSpace(profile.BindAddress)
	if bindAddr == "" {
		bindAddr = "0.0.0.0"
	}
	port := profile.BindPort
	tool := strings.ToLower(strings.TrimSpace(profile.Tool))
	if tool == "" {
		tool = "builtin"
	}

	s.mu.Lock()
	for _, existing := range s.listeners {
		if existing != nil && existing.port == port {
			s.mu.Unlock()
			return nil, fmt.Errorf("a remote listener is already active on port %d (%s)", port, existing.name)
		}
	}
	s.mu.Unlock()

	instID := fmt.Sprintf("rlst-%d", time.Now().UnixNano())
	cmdPreview := core.BuildListenerCommand(profile)

	inst := &agentListener{
		id:             instID,
		profileID:      profile.ID,
		name:           profile.Name,
		kind:           profile.Kind,
		tool:           tool,
		bindAddress:    bindAddr,
		port:           port,
		autoSpawnTab:   profile.AutoSpawnTab,
		startedAt:      time.Now(),
		commandPreview: cmdPreview,
	}

	if tool == "builtin" || tool == "raw-tcp" {
		cfg := core.RawTcpListenerConfig{
			Port:         port,
			BindAddress:  bindAddr,
			AutoSpawnTab: profile.AutoSpawnTab,
		}
		rawListener, err := rawtcp.Listen(ctx, cfg, func(sess core.RawTcpSession) {
			sessionID := "rraw-" + sess.ID()
			s.mu.Lock()
			s.rawSessions[sessionID] = sess
			inst.catchCount++
			s.mu.Unlock()

			stats := sess.Stats()
			s.emitEvent("listener:incoming", core.RawTcpIncomingEvent{
				SessionID:    sessionID,
				ListenerID:   instID,
				ListenerPort: port,
				RemoteAddr:   stats.RemoteAddr,
			})

			go func() {
				buf := make([]byte, 16*1024)
				for {
					n, rErr := sess.Read(buf)
					if n > 0 {
						s.emitEvent("session:data", SessionDataEvent{
							SessionID: sessionID,
							DataB64:   base64.StdEncoding.EncodeToString(buf[:n]),
						})
					}
					if rErr != nil {
						reason := "remote socket closed"
						if !errors.Is(rErr, io.EOF) {
							reason = rErr.Error()
						}
						s.mu.Lock()
						delete(s.rawSessions, sessionID)
						s.mu.Unlock()
						_ = sess.Close()
						s.emitEvent("session:closed", SessionClosedEvent{
							SessionID: sessionID,
							Reason:    reason,
						})
						return
					}
				}
			}()
		})
		if err != nil {
			return nil, fmt.Errorf("start remote listener on %s:%d: %w", bindAddr, port, err)
		}
		inst.rawListener = rawListener
	}

	s.mu.Lock()
	s.listeners[instID] = inst
	s.mu.Unlock()

	info := core.ManagedListenerInfo{
		ID:             inst.id,
		ProfileID:      inst.profileID,
		Name:           inst.name,
		Kind:           inst.kind,
		Tool:           inst.tool,
		BindAddress:    inst.bindAddress,
		BindPort:       inst.port,
		Status:         "listening",
		CatchCount:     inst.catchCount,
		StartedAt:      inst.startedAt.UTC().Format(time.RFC3339),
		CommandPreview: inst.commandPreview,
	}
	return &info, nil
}

func (s *Server) handleStopListener(listenerID string) error {
	s.mu.Lock()
	inst, ok := s.listeners[listenerID]
	delete(s.listeners, listenerID)
	s.mu.Unlock()
	if !ok || inst == nil {
		return nil
	}
	if inst.rawListener != nil {
		return inst.rawListener.Close()
	}
	return nil
}

func (s *Server) handleListListeners() []core.ManagedListenerInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := make([]core.ManagedListenerInfo, 0, len(s.listeners))
	for _, inst := range s.listeners {
		if inst == nil {
			continue
		}
		list = append(list, core.ManagedListenerInfo{
			ID:             inst.id,
			ProfileID:      inst.profileID,
			Name:           inst.name,
			Kind:           inst.kind,
			Tool:           inst.tool,
			BindAddress:    inst.bindAddress,
			BindPort:       inst.port,
			Status:         "listening",
			CatchCount:     inst.catchCount,
			StartedAt:      inst.startedAt.UTC().Format(time.RFC3339),
			CommandPreview: inst.commandPreview,
		})
	}
	return list
}

func (s *Server) handleWriteRawSession(p WriteSessionParams) error {
	s.mu.Lock()
	sess, ok := s.rawSessions[p.SessionID]
	s.mu.Unlock()
	if !ok || sess == nil {
		return core.ErrSessionNotFound
	}
	raw, err := base64.StdEncoding.DecodeString(p.DataB64)
	if err != nil {
		return fmt.Errorf("decode session data: %w", err)
	}
	_, err = sess.Write(raw)
	return err
}

func (s *Server) handleCloseRawSession(sessionID string) error {
	s.mu.Lock()
	sess, ok := s.rawSessions[sessionID]
	delete(s.rawSessions, sessionID)
	s.mu.Unlock()
	if !ok || sess == nil {
		return nil
	}
	return sess.Close()
}

func (s *Server) handleStartFileServer(cfg core.FileTransferServerConfig) (*core.FileTransferServerInfo, error) {
	if cfg.Port == 0 {
		cfg.Port = 8000
	}
	if strings.TrimSpace(cfg.BindAddress) == "" {
		cfg.BindAddress = "0.0.0.0"
	}
	if strings.TrimSpace(cfg.Directory) == "" {
		home, _ := os.UserHomeDir()
		if home == "" {
			home = "/"
		}
		cfg.Directory = filepath.Join(home, ".doubleagent", "staging")
		_ = os.MkdirAll(cfg.Directory, 0700)
	} else {
		cfg.Directory = resolveAgentPath(cfg.Directory)
	}

	s.mu.Lock()
	for _, existing := range s.fileServers {
		if existing != nil && existing.Port() == cfg.Port {
			s.mu.Unlock()
			return nil, fmt.Errorf("a remote file staging server is already running on port %d", cfg.Port)
		}
	}
	s.mu.Unlock()

	srv, err := transfer.StartServer(cfg, func(serverID string, evt core.FileTransferEvent) {
		s.emitEvent("transfer:event", TransferServerEventEnvelope{
			ServerID: serverID,
			Event:    evt,
		})
	})
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.fileServers[srv.ID()] = srv
	s.mu.Unlock()

	info := srv.Info()
	return &info, nil
}

func (s *Server) handleStopFileServer(ctx context.Context, serverID string) error {
	s.mu.Lock()
	srv, ok := s.fileServers[serverID]
	delete(s.fileServers, serverID)
	s.mu.Unlock()
	if !ok || srv == nil {
		return nil
	}
	return srv.Stop(ctx)
}

func (s *Server) handleListFileServers() []core.FileTransferServerInfo {
	s.mu.Lock()
	servers := make([]*transfer.ManagedServer, 0, len(s.fileServers))
	for _, srv := range s.fileServers {
		if srv != nil {
			servers = append(servers, srv)
		}
	}
	s.mu.Unlock()

	list := make([]core.FileTransferServerInfo, 0, len(servers))
	for _, srv := range servers {
		list = append(list, srv.Info())
	}
	return list
}

func (s *Server) handleStartPivot(ctx context.Context, route core.NetworkRoute) (*core.PivotInstanceInfo, error) {
	if s.pivotMgr == nil {
		return nil, errors.New("remote pivot manager not initialized")
	}
	info, err := s.pivotMgr.Start(ctx, route)
	if err != nil {
		return &info, err
	}
	return &info, nil
}

func (s *Server) handleStopPivot(instanceID string) error {
	if s.pivotMgr == nil {
		return errors.New("remote pivot manager not initialized")
	}
	return s.pivotMgr.Stop(instanceID)
}

func (s *Server) handleListPivots() []core.PivotInstanceInfo {
	if s.pivotMgr == nil {
		return []core.PivotInstanceInfo{}
	}
	return s.pivotMgr.List()
}

func (s *Server) handlePivotStdin(p PivotStdinParams) error {
	if s.pivotMgr == nil {
		return errors.New("remote pivot manager not initialized")
	}
	return s.pivotMgr.SendInput(p.InstanceID, p.Input)
}
