package core

import (
	"context"
	"encoding/json"
	"io"
	"net"
)

// SshExecStream represents a live, non-PTY SSH exec channel with raw stdin/stdout/stderr
// streams used by the Ephemeral Remote Companion Agent (F-46).
type SshExecStream struct {
	Stdin  io.WriteCloser
	Stdout io.Reader
	Stderr io.Reader
	Wait   func() error
	Close  func() error
}

// SshStreamStarter is an optional interface implemented by SshTransport backends
// that support long-lived non-PTY exec channels (F-46).
type SshStreamStarter interface {
	ExecStream(ctx context.Context, sessionID string, command string) (*SshExecStream, error)
}

// SshContextForwarder is an optional interface implemented by SshTransport backends
// that can bind port forwards (-L, -R, -D) directly on an active remote agent host
// rather than the local workstation (F-46 Phase 3).
type SshContextForwarder interface {
	StartForwardLocalVia(ctx context.Context, viaSessionID, sessionID, ruleID, bindAddr string, bindPort uint16, targetHost string, targetPort uint16) (ForwardTunnel, error)
	StartForwardRemoteVia(ctx context.Context, viaSessionID, sessionID, ruleID, bindAddr string, bindPort uint16, targetHost string, targetPort uint16) (ForwardTunnel, error)
	StartForwardDynamicVia(ctx context.Context, viaSessionID, sessionID, ruleID, bindAddr string, bindPort uint16) (ForwardTunnel, error)
	DialViaSession(ctx context.Context, viaSessionID, network, addr string) (net.Conn, error)
}

// RemoteAgentInfo describes an attached ephemeral companion agent running on a remote Linux host (F-46).
type RemoteAgentInfo struct {
	SessionID    string `json:"sessionId"`
	Label        string `json:"label"`
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	HomeDir      string `json:"homeDir"`
	DefaultShell string `json:"defaultShell"`
	StagingDir   string `json:"stagingDir"`
	PrimaryIP    string `json:"primaryIp,omitempty"`
	ConnectedAt  string `json:"connectedAt"`
	Active       bool   `json:"active"`
}

// RemoteExecutionContext reports whether DoubleAgent is executing locally or via an attached remote agent (F-46).
type RemoteExecutionContext struct {
	Mode            string            `json:"mode"` // "local" or "agent"
	ActiveSessionID string            `json:"activeSessionId,omitempty"`
	ActiveAgent     *RemoteAgentInfo  `json:"activeAgent,omitempty"`
	AttachedAgents  []RemoteAgentInfo `json:"attachedAgents"`
}

// RemoteDirListing represents a directory listing returned by a remote companion agent (F-46).
type RemoteDirListing struct {
	Path    string            `json:"path"`
	Parent  string            `json:"parent"`
	Entries []HostedFileEntry `json:"entries"`
}

// AgentRPCMessage is the framed NDJSON-RPC envelope exchanged over the SSH exec channel (F-46).
type AgentRPCMessage struct {
	Type   string          `json:"type"`             // "req", "res", or "evt"
	ID     string          `json:"id,omitempty"`     // request/response correlation ID
	Method string          `json:"method,omitempty"` // RPC method name (for type="req")
	Event  string          `json:"event,omitempty"`  // event name (for type="evt")
	Params json.RawMessage `json:"params,omitempty"` // request or event payload
	Result json.RawMessage `json:"result,omitempty"` // response payload
	Error  string          `json:"error,omitempty"`  // error string (for type="res")
}
