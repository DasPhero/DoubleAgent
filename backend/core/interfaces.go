package core

import "context"

// AppStatus represents the basic health and metadata of the DoubleAgent process.
type AppStatus struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Milestone string `json:"milestone"`
	VaultLock bool   `json:"vaultLocked"`
}

// SshSessionConfig holds connection parameters for opening an SSH session.
type SshSessionConfig struct {
	HostID     string
	Address    string
	Port       uint16
	Username   string
	IdentityID string
}

// SshTransport defines the strict boundary interface for all SSH and SFTP operations (ADR-0006).
// Implementations live in backend/ssh; backend/core never imports golang.org/x/crypto/ssh.
type SshTransport interface {
	Connect(ctx context.Context, cfg SshSessionConfig) (sessionID string, err error)
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

