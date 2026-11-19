package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"doubleagent/backend/core"
	"doubleagent/backend/remoteagent"
)

func (a *App) getActiveRemoteAgent() (*remoteagent.Client, *core.RemoteAgentInfo) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.activeExecAgentID == "" {
		return nil, nil
	}
	client := a.remoteAgents[a.activeExecAgentID]
	if client == nil {
		return nil, nil
	}
	info := a.remoteAgentInfos[a.activeExecAgentID]
	info.Active = true
	return client, &info
}

func (a *App) buildRemoteExecutionContextLocked() core.RemoteExecutionContext {
	attached := make([]core.RemoteAgentInfo, 0, len(a.remoteAgentInfos))
	var activeInfo *core.RemoteAgentInfo
	for sid, info := range a.remoteAgentInfos {
		cp := info
		cp.Active = sid == a.activeExecAgentID
		if cp.Active {
			activeCopy := cp
			activeInfo = &activeCopy
		}
		attached = append(attached, cp)
	}
	sort.Slice(attached, func(i, j int) bool {
		return attached[i].ConnectedAt < attached[j].ConnectedAt
	})
	mode := "local"
	if activeInfo != nil {
		mode = "agent"
	}
	return core.RemoteExecutionContext{
		Mode:            mode,
		ActiveSessionID: a.activeExecAgentID,
		ActiveAgent:     activeInfo,
		AttachedAgents:  attached,
	}
}

func (a *App) emitRemoteContextUpdate() {
	a.mu.Lock()
	ctxPayload := a.buildRemoteExecutionContextLocked()
	a.mu.Unlock()
	a.emit(a.ctx, "remote-agent:updated", ctxPayload)
}

func (a *App) handleRemoteAgentEvent(agentSessionID string, event string, params json.RawMessage) {
	switch event {
	case "pty:data":
		var evt remoteagent.PtyDataEvent
		if err := json.Unmarshal(params, &evt); err != nil || evt.PtyID == "" {
			return
		}
		raw, err := base64.StdEncoding.DecodeString(evt.DataB64)
		if err != nil {
			return
		}
		chunk := string(raw)
		if a.logMgr != nil {
			a.logMgr.WriteOutput(evt.PtyID, chunk)
		}
		a.emit(a.ctx, "terminal:data", core.TerminalDataEvent{
			SessionID: evt.PtyID,
			Data:      chunk,
		})

	case "pty:exit":
		var evt remoteagent.PtyExitEvent
		if err := json.Unmarshal(params, &evt); err != nil || evt.PtyID == "" {
			return
		}
		a.mu.Lock()
		delete(a.remotePtys, evt.PtyID)
		a.mu.Unlock()
		a.emit(a.ctx, "terminal:exit", core.TerminalExitEvent{
			SessionID: evt.PtyID,
			Reason:    evt.Reason,
		})

	case "listener:incoming":
		var evt core.RawTcpIncomingEvent
		if err := json.Unmarshal(params, &evt); err != nil || evt.SessionID == "" {
			return
		}
		a.mu.Lock()
		if a.remoteRawSessions == nil {
			a.remoteRawSessions = make(map[string]string)
		}
		a.remoteRawSessions[evt.SessionID] = agentSessionID
		a.mu.Unlock()
		a.emit(a.ctx, "listener:incoming", evt)
		a.emit(a.ctx, "raw-tcp:incoming", evt)
		a.emit(a.ctx, "listeners:updated", true)

	case "session:data":
		var evt remoteagent.SessionDataEvent
		if err := json.Unmarshal(params, &evt); err != nil || evt.SessionID == "" {
			return
		}
		raw, err := base64.StdEncoding.DecodeString(evt.DataB64)
		if err != nil {
			return
		}
		chunk := string(raw)
		if a.logMgr != nil {
			a.logMgr.WriteOutput(evt.SessionID, chunk)
		}
		a.emit(a.ctx, "terminal:data", core.TerminalDataEvent{
			SessionID: evt.SessionID,
			Data:      chunk,
		})

	case "session:closed":
		var evt remoteagent.SessionClosedEvent
		if err := json.Unmarshal(params, &evt); err != nil || evt.SessionID == "" {
			return
		}
		a.mu.Lock()
		delete(a.remoteRawSessions, evt.SessionID)
		a.mu.Unlock()
		a.emit(a.ctx, "terminal:exit", core.TerminalExitEvent{
			SessionID: evt.SessionID,
			Reason:    evt.Reason,
		})

	case "transfer:event":
		var env remoteagent.TransferServerEventEnvelope
		if err := json.Unmarshal(params, &env); err != nil {
			return
		}
		a.emit(a.ctx, "transfer:event", map[string]interface{}{
			"serverId": env.ServerID,
			"event":    env.Event,
		})
		a.emit(a.ctx, "transfer:servers-updated", true)

	case "pivot:updated":
		var info core.PivotInstanceInfo
		if err := json.Unmarshal(params, &info); err != nil {
			return
		}
		a.emit(a.ctx, "pivot:updated", info)
	}
}

func (a *App) handleRemoteAgentDisconnect(agentSessionID string, reason string) {
	a.mu.Lock()
	_, existed := a.remoteAgents[agentSessionID]
	delete(a.remoteAgents, agentSessionID)
	delete(a.remoteAgentInfos, agentSessionID)
	if a.activeExecAgentID == agentSessionID {
		a.activeExecAgentID = ""
	}
	var orphanedPtys []string
	for ptyID, owner := range a.remotePtys {
		if owner == agentSessionID {
			orphanedPtys = append(orphanedPtys, ptyID)
			delete(a.remotePtys, ptyID)
		}
	}
	for rawID, owner := range a.remoteRawSessions {
		if owner == agentSessionID {
			orphanedPtys = append(orphanedPtys, rawID)
			delete(a.remoteRawSessions, rawID)
		}
	}
	a.mu.Unlock()

	for _, ptyID := range orphanedPtys {
		a.emit(a.ctx, "terminal:exit", core.TerminalExitEvent{
			SessionID: ptyID,
			Reason:    "remote agent disconnected: " + reason,
		})
	}
	if existed {
		a.emitRemoteContextUpdate()
	}
}

func (a *App) detachAllRemoteAgents() {
	a.mu.Lock()
	clients := make([]*remoteagent.Client, 0, len(a.remoteAgents))
	for _, c := range a.remoteAgents {
		if c != nil {
			clients = append(clients, c)
		}
	}
	a.remoteAgents = make(map[string]*remoteagent.Client)
	a.remoteAgentInfos = make(map[string]core.RemoteAgentInfo)
	a.remotePtys = make(map[string]string)
	a.remoteRawSessions = make(map[string]string)
	a.activeExecAgentID = ""
	a.mu.Unlock()

	for _, c := range clients {
		_ = c.Close()
	}
}

// GetRemoteExecutionContext returns the active execution context ("local" or "agent") and all attached agents (F-46).
func (a *App) GetRemoteExecutionContext() core.RemoteExecutionContext {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.buildRemoteExecutionContextLocked()
}

// AttachRemoteAgent deploys (if needed) and attaches the ephemeral companion agent over an active Linux SSH session (F-46).
func (a *App) AttachRemoteAgent(sessionID string, label string) (*core.RemoteAgentInfo, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, errors.New("an active SSH session ID is required to attach a remote agent")
	}

	// If already attached on this SSH session, simply activate it.
	a.mu.Lock()
	if existing, ok := a.remoteAgentInfos[sessionID]; ok && a.remoteAgents[sessionID] != nil {
		a.activeExecAgentID = sessionID
		existing.Active = true
		a.mu.Unlock()
		a.emitRemoteContextUpdate()
		return &existing, nil
	}
	a.mu.Unlock()

	baseCtx := a.ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}

	client, info, err := remoteagent.DeployAndAttach(
		baseCtx,
		a.transport,
		sessionID,
		label,
		func(event string, params json.RawMessage) {
			a.handleRemoteAgentEvent(sessionID, event, params)
		},
		func(reason string) {
			a.handleRemoteAgentDisconnect(sessionID, reason)
		},
	)
	if err != nil {
		return nil, err
	}

	a.mu.Lock()
	if a.remoteAgents == nil {
		a.remoteAgents = make(map[string]*remoteagent.Client)
	}
	if a.remoteAgentInfos == nil {
		a.remoteAgentInfos = make(map[string]core.RemoteAgentInfo)
	}
	a.remoteAgents[sessionID] = client
	a.remoteAgentInfos[sessionID] = info
	a.activeExecAgentID = sessionID
	a.mu.Unlock()

	a.emitRemoteContextUpdate()
	return &info, nil
}

// SetActiveExecutionContext switches execution between "local" (empty sessionID) and an attached remote agent (F-46).
func (a *App) SetActiveExecutionContext(sessionID string) (core.RemoteExecutionContext, error) {
	sessionID = strings.TrimSpace(sessionID)
	a.mu.Lock()
	if sessionID == "" {
		a.activeExecAgentID = ""
		ctxPayload := a.buildRemoteExecutionContextLocked()
		a.mu.Unlock()
		a.emit(a.ctx, "remote-agent:updated", ctxPayload)
		return ctxPayload, nil
	}
	if a.remoteAgents[sessionID] == nil {
		a.mu.Unlock()
		return core.RemoteExecutionContext{}, fmt.Errorf("no remote agent attached on session %s", sessionID)
	}
	a.activeExecAgentID = sessionID
	ctxPayload := a.buildRemoteExecutionContextLocked()
	a.mu.Unlock()
	a.emit(a.ctx, "remote-agent:updated", ctxPayload)
	return ctxPayload, nil
}

// DetachRemoteAgent cleanly closes the ephemeral agent on the specified SSH session (F-46).
func (a *App) DetachRemoteAgent(sessionID string) (core.RemoteExecutionContext, error) {
	sessionID = strings.TrimSpace(sessionID)
	a.mu.Lock()
	client := a.remoteAgents[sessionID]
	delete(a.remoteAgents, sessionID)
	delete(a.remoteAgentInfos, sessionID)
	if a.activeExecAgentID == sessionID {
		a.activeExecAgentID = ""
	}
	var orphanedPtys []string
	for ptyID, owner := range a.remotePtys {
		if owner == sessionID {
			orphanedPtys = append(orphanedPtys, ptyID)
			delete(a.remotePtys, ptyID)
		}
	}
	ctxPayload := a.buildRemoteExecutionContextLocked()
	a.mu.Unlock()

	if client != nil {
		_ = client.Close()
	}
	for _, ptyID := range orphanedPtys {
		a.emit(a.ctx, "terminal:exit", core.TerminalExitEvent{
			SessionID: ptyID,
			Reason:    "remote agent detached",
		})
	}
	a.emit(a.ctx, "remote-agent:updated", ctxPayload)
	return ctxPayload, nil
}

// OpenRemoteAgentTerminal spawns a native Linux PTY shell on the active remote agent in workingDir (F-46).
func (a *App) OpenRemoteAgentTerminal(workingDir string, size core.TerminalSize) (string, error) {
	client, info := a.getActiveRemoteAgent()
	if client == nil || info == nil {
		return "", errors.New("no active remote agent attached")
	}
	baseCtx := a.ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	callCtx, cancel := context.WithTimeout(baseCtx, 15*time.Second)
	defer cancel()

	res, err := client.SpawnPTY(callCtx, remoteagent.SpawnPTYParams{
		ShellType:  "default",
		WorkingDir: strings.TrimSpace(workingDir),
		Cols:       size.Cols,
		Rows:       size.Rows,
	})
	if err != nil {
		return "", err
	}

	a.mu.Lock()
	if a.remotePtys == nil {
		a.remotePtys = make(map[string]string)
	}
	a.remotePtys[res.PtyID] = info.SessionID
	a.mu.Unlock()
	return res.PtyID, nil
}

// ListRemoteAgentDir lists files and subdirectories on the active remote agent (F-46).
func (a *App) ListRemoteAgentDir(dirPath string) (*core.RemoteDirListing, error) {
	client, _ := a.getActiveRemoteAgent()
	if client == nil {
		return nil, errors.New("no active remote agent attached")
	}
	baseCtx := a.ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	callCtx, cancel := context.WithTimeout(baseCtx, 10*time.Second)
	defer cancel()
	return client.ListDir(callCtx, dirPath)
}

// MakeRemoteAgentDir creates a directory on the active remote agent (F-46).
func (a *App) MakeRemoteAgentDir(dirPath string) error {
	client, _ := a.getActiveRemoteAgent()
	if client == nil {
		return errors.New("no active remote agent attached")
	}
	baseCtx := a.ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	callCtx, cancel := context.WithTimeout(baseCtx, 10*time.Second)
	defer cancel()
	return client.Mkdir(callCtx, dirPath)
}

// PushLocalFileToRemoteStaging opens a native local file picker and uploads the chosen file
// directly into the active remote agent's staging directory via SFTP (F-31, F-46).
func (a *App) PushLocalFileToRemoteStaging(remoteDestDir string) (string, error) {
	_, info := a.getActiveRemoteAgent()
	if info == nil {
		return "", errors.New("no active remote agent attached")
	}
	if a.ctx == nil {
		return "", errors.New("application context not initialized")
	}
	localPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Push Local File to Remote Staging Directory",
	})
	if err != nil {
		return "", err
	}
	localPath = strings.TrimSpace(localPath)
	if localPath == "" {
		return "", nil
	}

	destDir := strings.TrimSpace(remoteDestDir)
	if destDir == "" {
		destDir = info.StagingDir
	}
	if destDir == "" {
		destDir = path.Join(info.HomeDir, ".doubleagent", "staging")
	}

	sftpClient, err := a.getOrOpenSftp(info.SessionID)
	if err != nil {
		return "", fmt.Errorf("open sftp for remote push: %w", err)
	}

	fileName := filepath.Base(localPath)
	remotePath := path.Join(destDir, fileName)

	callCtx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
	defer cancel()
	if err := sftpClient.Upload(callCtx, localPath, remotePath, nil); err != nil {
		return "", fmt.Errorf("upload %s to %s: %w", fileName, remotePath, err)
	}
	return fileName, nil
}
