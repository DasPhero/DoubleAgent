package core

import (
	"context"
	"errors"
	"io"
	"time"
)

// Common domain errors for SSH transport, host-key verification, and vault operations.
var (
	ErrSessionNotFound     = errors.New("ssh session not found")
	ErrHostKeyMismatch     = errors.New("remote host key has changed (potential MITM)")
	ErrHostKeyUntrusted    = errors.New("remote host key is not trusted")
	ErrUnsupportedAuthType = errors.New("unsupported authentication method")
	ErrVaultLocked         = errors.New("vault is locked")
	ErrVaultInvalidAuth    = errors.New("invalid master password or corrupted vault")
	ErrVaultCorrupted      = errors.New("vault file format is invalid or corrupted")
)

// AppStatus represents the basic health and metadata of the DoubleAgent process.
type AppStatus struct {
	Name             string `json:"name"`
	Version          string `json:"version"`
	Milestone        string `json:"milestone"`
	VaultLock        bool   `json:"vaultLocked"`
	VaultInitialized bool   `json:"vaultInitialized"`
	Passwordless     bool   `json:"passwordless"`
	QuickUnlockReady bool   `json:"quickUnlockReady"`
}

// ConnectRequest represents the frontend-bound parameters for starting an SSH terminal session (S1, F-01, F-05, F-07).
type ConnectRequest struct {
	Address    string       `json:"address"`
	Port       uint16       `json:"port"`
	Username   string       `json:"username"`
	Password   string       `json:"password"`
	PrivateKey string       `json:"privateKey"`
	Passphrase string       `json:"passphrase"`
	UseAgent   bool         `json:"useAgent,omitempty"`
	Size       TerminalSize `json:"size"`
}

// TerminalDataEvent is emitted from the Go backend to the frontend when remote PTY output arrives (F-07).
type TerminalDataEvent struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"`
}

// TerminalExitEvent is emitted when an SSH shell session closes or disconnects.
type TerminalExitEvent struct {
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason"`
}

// AuthMethodType enumerates supported SSH authentication mechanisms (F-01, F-04, F-05, F-20).
type AuthMethodType string

const (
	AuthPassword            AuthMethodType = "password"
	AuthPrivateKey          AuthMethodType = "key"
	AuthAgent               AuthMethodType = "agent"
	AuthKeyboardInteractive AuthMethodType = "interactive"
)

// KeyboardInteractiveResponder answers 2FA / PAM prompts during keyboard-interactive auth.
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
	OpenShellWithOptions(ctx context.Context, sessionID string, size TerminalSize, initialDir string, asRoot bool) (*SshShellStreams, error)
	ResizeShell(ctx context.Context, sessionID string, size TerminalSize) error
	Disconnect(ctx context.Context, sessionID string) error
}

// TerminalSize represents terminal dimensions in columns and rows.
type TerminalSize struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// TerminalSpawnOptions configures how a new terminal is opened in relation to working directory and privileges (F-10).
type TerminalSpawnOptions struct {
	Mode       string       `json:"mode"`       // "default", "current", "root"
	WorkingDir string       `json:"workingDir"` // CWD path
	SplitDir   string       `json:"splitDir"`   // "none", "horizontal", "vertical"
	Size       TerminalSize `json:"size"`
}

// TerminalEngine defines the strict boundary interface for local PTY or remote shell I/O.
// Implementations live in backend/pty or backend/ssh; backend/core never imports PTY packages.
type TerminalEngine interface {
	Write(ctx context.Context, sessionID string, data []byte) error
	Resize(ctx context.Context, sessionID string, size TerminalSize) error
	Close(ctx context.Context, sessionID string) error
}

// HostRecord represents a configured SSH target stored inside the encrypted vault (Spec Section 8, F-01, F-10).
type HostRecord struct {
	ID             string   `json:"id"`
	Label          string   `json:"label"`
	Address        string   `json:"address"`
	Port           uint16   `json:"port"`
	GroupID        string   `json:"groupId,omitempty"`
	IdentityID     string   `json:"identityId,omitempty"`
	InitialDir     string   `json:"initialDir,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	Color          string   `json:"color,omitempty"`
	Favorite       bool     `json:"favorite,omitempty"`
	JumpChain      []string `json:"jumpChain,omitempty"`
	ForwardRuleIDs []string `json:"forwardRuleIds,omitempty"`
}

// GroupDefaults holds inheritable connection settings for a host group (F-01, F-10).
type GroupDefaults struct {
	Port          uint16 `json:"port,omitempty"`
	Username      string `json:"username,omitempty"`
	IdentityID    string `json:"identityId,omitempty"`
	InitialDir    string `json:"initialDir,omitempty"`
	KeepaliveSecs uint16 `json:"keepaliveSecs,omitempty"`
}

// GroupRecord represents a hierarchical host folder stored in the vault (Spec Section 8, F-01).
type GroupRecord struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	ParentID        string        `json:"parentId,omitempty"`
	DefaultSettings GroupDefaults `json:"defaultSettings"`
}

// IdentityRecord represents reusable authentication credentials stored in the vault (Spec Section 8).
type IdentityRecord struct {
	ID         string         `json:"id"`
	Label      string         `json:"label"`
	Username   string         `json:"username"`
	AuthMethod AuthMethodType `json:"authMethod"`
	Password   string         `json:"password,omitempty"`
	KeyID      string         `json:"keyId,omitempty"`
	TotpID     string         `json:"totpId,omitempty"`
}

// SshKeyRecord represents an SSH keypair stored in the vault (Spec Section 8, F-04).
type SshKeyRecord struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Type        string `json:"type"`
	PublicKey   string `json:"publicKey"`
	PrivateKey  string `json:"privateKey"`
	Passphrase  string `json:"passphrase,omitempty"`
	Fingerprint string `json:"fingerprint"`
}

// VaultPayload is the top-level document encrypted inside the vault file (Spec Section 8, F-03).
type VaultPayload struct {
	SchemaVersion int              `json:"schemaVersion"`
	Hosts         []HostRecord     `json:"hosts"`
	Groups        []GroupRecord    `json:"groups"`
	Identities    []IdentityRecord `json:"identities"`
	Keys          []SshKeyRecord   `json:"keys"`
}

// SecretStore defines the strict boundary interface for the encrypted vault (ADR-0007, F-03).
// Implementations live in backend/vault; the master key never leaves the Go process.
type SecretStore interface {
	IsInitialized() bool
	IsPasswordless() bool
	HasQuickUnlock() bool
	Initialize(ctx context.Context, masterPassword string) error
	InitializeWithHello(ctx context.Context) error
	Unlock(ctx context.Context, masterPassword string) error
	ChangePassword(ctx context.Context, currentPassword, newPassword string) error
	EnableQuickUnlock() error
	UnlockWithQuickUnlock(ctx context.Context) error
	ResetVault() error
	Lock() error
	IsLocked() bool
	Touch()
	GetPayload() (VaultPayload, error)
	SavePayload(ctx context.Context, payload VaultPayload) error
}
