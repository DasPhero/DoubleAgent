package core

import (
	"context"
	"errors"
	"io"
	"time"
)

// Common domain errors for SSH transport and host-key verification.
var (
	ErrSessionNotFound     = errors.New("ssh session not found")
	ErrHostKeyMismatch     = errors.New("remote host key has changed (potential MITM)")
	ErrHostKeyUntrusted    = errors.New("remote host key is not trusted")
	ErrUnsupportedAuthType = errors.New("unsupported authentication method")
)

// AppStatus represents the basic health and metadata of the DoubleAgent process.
type AppStatus struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Milestone string `json:"milestone"`
	VaultLock bool   `json:"vaultLocked"`
}

// AuthMethodType enumerates supported SSH authentication mechanisms (F-01, F-04, F-05, F-20).
type AuthMethodType string

const (
	AuthPassword            AuthMethodType = "password"
	AuthPrivateKey          AuthMethodType = "key"
	AuthAgent               AuthMethodType = "agent"
	AuthKeyboardInteractive AuthMethodType = "interactive"
)

// KeyboardInteractiveChallenge Responder answers 2FA / PAM prompts during keyboard-interactive auth.
type KeyboardInteractiveResponder func(user, instruction string, questions []string, echos []bool) ([]string, error)

// SshAuthConfig holds credentials resolved from the vault or prompt for a single connection attempt.
type SshAuthConfig struct {
	Method      AuthMethodType
	Password    string
	PrivateKey  []byte
	Passphrase  string
	Interactive KeyboardInteractiveResponder
}

// HostKeyInfo describes the server's presented public key during the SSH handshake (F-06).
type HostKeyInfo struct {
	HostPattern string    `json:"hostPattern"`
	Port        uint16    `json:"port"`
	KeyType     string    `json:"keyType"`
	Fingerprint string    `json:"fingerprint"` // SHA256:... format
	FirstSeen   time.Time `json:"firstSeen"`
	LastSeen    time.Time `json:"lastSeen"`
}

// HostKeyDecision represents the outcome of checking a server's host key against KnownHosts (F-06).
type HostKeyDecision int

const (
	HostKeyTrusted HostKeyDecision = iota
	HostKeyFirstSeen
	HostKeyChanged
)

// KnownHostDecisionFunc is invoked when a host key is seen for the first time (TOFU prompt).
// Returning true trusts and records the key; returning false aborts the handshake.
type KnownHostDecisionFunc func(info HostKeyInfo) (trust bool, err error)

// SshSessionConfig holds connection parameters for opening an SSH session.
type SshSessionConfig struct {
	HostID          string
	Address         string
	Port            uint16
	Username        string
	IdentityID      string
	Timeout         time.Duration
	AllowLegacyAlgs bool
	Auth            SshAuthConfig
	OnFirstSeenKey  KnownHostDecisionFunc
}

// SshShellStreams provides access to a remote PTY shell's standard streams and resize/close lifecycle.
type SshShellStreams struct {
	Stdin  io.WriteCloser
	Stdout io.Reader
	Stderr io.Reader
}

// SshTransport defines the strict boundary interface for all SSH and SFTP operations (ADR-0006).
// Implementations live in backend/ssh; backend/core never imports golang.org/x/crypto/ssh.
type SshTransport interface {
	Connect(ctx context.Context, cfg SshSessionConfig) (sessionID string, err error)
	OpenShell(ctx context.Context, sessionID string, size TerminalSize) (*SshShellStreams, error)
	ResizeShell(ctx context.Context, sessionID string, size TerminalSize) error
	Disconnect(ctx context.Context, sessionID string) error
}

// TerminalSize represents terminal dimensions in columns and rows.
type TerminalSize struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// TerminalEngine defines the strict boundary interface for local PTY or remote shell I/O.
// Implementations live in backend/pty or backend/ssh; backend/core never imports PTY packages.
type TerminalEngine interface {
	Write(ctx context.Context, sessionID string, data []byte) error
	Resize(ctx context.Context, sessionID string, size TerminalSize) error
	Close(ctx context.Context, sessionID string) error
}

// SecretStore defines the strict boundary interface for the encrypted vault (ADR-0007).
// Implementations live in backend/vault; the master key never leaves the Go process.
type SecretStore interface {
	Unlock(ctx context.Context, masterPassword string) error
	Lock() error
	IsLocked() bool
}
