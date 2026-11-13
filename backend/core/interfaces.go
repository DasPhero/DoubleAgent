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

// ConnectRequest represents the frontend-bound parameters for starting an SSH terminal session (S1, F-01, F-04, F-05, F-07, F-14).
type ConnectRequest struct {
	Address        string       `json:"address"`
	Port           uint16       `json:"port"`
	Username       string       `json:"username"`
	Password       string       `json:"password"`
	KeyID          string       `json:"keyId,omitempty"`
	PrivateKey     string       `json:"privateKey"`
	Passphrase     string       `json:"passphrase"`
	UseAgent       bool         `json:"useAgent,omitempty"`
	ProxyProfileID string       `json:"proxyProfileId,omitempty"`
	ProxyJump      string       `json:"proxyJump,omitempty"`
	ProxyCommand   string       `json:"proxyCommand,omitempty"`
	Size           TerminalSize `json:"size"`
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

// SocksAuth holds optional credentials for authenticating against a SOCKS5 proxy (F-14).
type SocksAuth struct {
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

// SshSessionConfig holds connection parameters for opening an SSH session (F-01, F-04, F-06, F-14, F-25).
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
	JumpChain       []SshSessionConfig // Intermediate SSH hops (ProxyJump)
	ProxyCommand    string             // Local command with %h / %p substitution (ProxyCommand)
	SocksProxy      string             // SOCKS5 proxy address (e.g. 127.0.0.1:1080)
	SocksAuth       *SocksAuth         // SOCKS5 username/password auth
}

// SshShellStreams provides access to a remote PTY shell's standard streams and resize/close lifecycle.
type SshShellStreams struct {
	Stdin  io.WriteCloser
	Stdout io.Reader
	Stderr io.Reader
}

// SshTransport defines the strict boundary interface for all SSH, SFTP, and port forwarding operations (ADR-0006, F-12, F-13).
// Implementations live in backend/ssh; backend/core never imports golang.org/x/crypto/ssh.
type SshTransport interface {
	Connect(ctx context.Context, cfg SshSessionConfig) (sessionID string, err error)
	OpenShell(ctx context.Context, sessionID string, size TerminalSize) (*SshShellStreams, error)
	OpenShellWithOptions(ctx context.Context, sessionID string, size TerminalSize, initialDir string, asRoot bool) (*SshShellStreams, error)
	OpenSftp(ctx context.Context, sessionID string) (SftpClient, error)
	StartForwardLocal(ctx context.Context, sessionID string, ruleID string, bindAddr string, bindPort uint16, targetHost string, targetPort uint16) (ForwardTunnel, error)
	StartForwardRemote(ctx context.Context, sessionID string, ruleID string, bindAddr string, bindPort uint16, targetHost string, targetPort uint16) (ForwardTunnel, error)
	StartForwardDynamic(ctx context.Context, sessionID string, ruleID string, bindAddr string, bindPort uint16) (ForwardTunnel, error)
	ResizeShell(ctx context.Context, sessionID string, size TerminalSize) error
	Disconnect(ctx context.Context, sessionID string) error
}

// ForwardRuleType defines the direction of SSH port forwarding (F-13).
type ForwardRuleType string

const (
	ForwardLocal   ForwardRuleType = "L" // Local port forwarding (-L)
	ForwardRemote  ForwardRuleType = "R" // Remote port forwarding (-R)
	ForwardDynamic ForwardRuleType = "D" // Dynamic SOCKS5 forwarding (-D)
)

// ForwardRule defines a saved port forwarding configuration in the vault (Spec Section 8, F-13).
type ForwardRule struct {
	ID          string          `json:"id"`
	HostID      string          `json:"hostId,omitempty"`
	Type        ForwardRuleType `json:"type"` // "L", "R", "D"
	BindAddress string          `json:"bindAddress"`
	BindPort    uint16          `json:"bindPort"`
	TargetHost  string          `json:"targetHost,omitempty"`
	TargetPort  uint16          `json:"targetPort,omitempty"`
	AutoStart   bool            `json:"autoStart"`
	Label       string          `json:"label,omitempty"`
}

// ForwardTunnelStatus represents the runtime status and metrics of an active port forwarding tunnel (F-13).
type ForwardTunnelStatus struct {
	ID           string          `json:"id"`
	RuleID       string          `json:"ruleId"`
	SessionID    string          `json:"sessionId"`
	HostID       string          `json:"hostId,omitempty"`
	Type         ForwardRuleType `json:"type"`
	BindAddress  string          `json:"bindAddress"`
	BindPort     uint16          `json:"bindPort"`
	TargetHost   string          `json:"targetHost,omitempty"`
	TargetPort   uint16          `json:"targetPort,omitempty"`
	Status       string          `json:"status"` // "active", "error", "closed"
	BytesIn      int64           `json:"bytesIn"`
	BytesOut     int64           `json:"bytesOut"`
	ActiveConns  int             `json:"activeConns"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
}

// ForwardTunnel defines an active port-forwarding tunnel listener lifecycle and metrics (F-13).
type ForwardTunnel interface {
	io.Closer
	GetStatus() ForwardTunnelStatus
}

// FileItem represents a local or remote file/directory entry for the SFTP two-column browser (F-12).
type FileItem struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	IsDir       bool   `json:"isDir"`
	ModTime     int64  `json:"modTime"`
	Permissions string `json:"permissions"`
}

// TransferStatus indicates the current lifecycle state of an SFTP file transfer (F-12).
type TransferStatus string

const (
	TransferQueued    TransferStatus = "queued"
	TransferRunning   TransferStatus = "running"
	TransferCompleted TransferStatus = "completed"
	TransferFailed    TransferStatus = "failed"
	TransferCancelled TransferStatus = "cancelled"
)

// TransferTask represents an entry in the SFTP transfer queue (F-12).
type TransferTask struct {
	ID               string         `json:"id"`
	SessionID        string         `json:"sessionId"`
	Direction        string         `json:"direction"` // "upload" or "download"
	LocalPath        string         `json:"localPath"`
	RemotePath       string         `json:"remotePath"`
	TotalBytes       int64          `json:"totalBytes"`
	TransferredBytes int64          `json:"transferredBytes"`
	SpeedBytesPerSec int64          `json:"speedBytesPerSec"`
	Status           TransferStatus `json:"status"`
	Error            string         `json:"error,omitempty"`
}

// TransferProgressEvent is emitted to the frontend during an active file transfer (F-12).
type TransferProgressEvent struct {
	TaskID           string         `json:"taskId"`
	TransferredBytes int64          `json:"transferredBytes"`
	TotalBytes       int64          `json:"totalBytes"`
	SpeedBytesPerSec int64          `json:"speedBytesPerSec"`
	Percent          float64        `json:"percent"`
	Status           TransferStatus `json:"status"`
	Error            string         `json:"error,omitempty"`
}

// SftpClient defines the strict boundary interface for remote SFTP file operations (F-12).
type SftpClient interface {
	List(ctx context.Context, path string) ([]FileItem, error)
	Stat(ctx context.Context, path string) (FileItem, error)
	Mkdir(ctx context.Context, path string) error
	Remove(ctx context.Context, path string) error
	Rename(ctx context.Context, oldPath, newPath string) error
	Upload(ctx context.Context, localPath, remotePath string, onProgress func(transferred, total int64)) error
	Download(ctx context.Context, remotePath, localPath string, onProgress func(transferred, total int64)) error
	Close() error
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

// ProxyProfileType defines the proxying mechanism for a ProxyProfile (Spec Section 8, F-14).
type ProxyProfileType string

const (
	ProxyTypeJump    ProxyProfileType = "jump"    // ProxyJump (SSH bastion hops)
	ProxyTypeCommand ProxyProfileType = "command" // ProxyCommand (arbitrary process stream)
	ProxyTypeSocks5  ProxyProfileType = "socks5"  // SOCKS5 proxy server
)

// ProxyProfile represents a saved proxying configuration stored in the encrypted vault (Spec Section 8, F-14).
type ProxyProfile struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Type          ProxyProfileType `json:"type"` // "jump", "command", "socks5"
	JumpHostIDs   []string         `json:"jumpHostIds,omitempty"`
	Command       string           `json:"command,omitempty"`
	SocksAddress  string           `json:"socksAddress,omitempty"`
	SocksUsername string           `json:"socksUsername,omitempty"`
	SocksPassword string           `json:"socksPassword,omitempty"`
}

// ProxyProfileSummary is a non-secret view of a saved proxy profile exposed to the frontend UI (Golden Rule 2, F-14).
type ProxyProfileSummary struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Type          ProxyProfileType `json:"type"`
	JumpHostIDs   []string         `json:"jumpHostIds,omitempty"`
	Command       string           `json:"command,omitempty"`
	SocksAddress  string           `json:"socksAddress,omitempty"`
	SocksUsername string           `json:"socksUsername,omitempty"`
	HasPassword   bool             `json:"hasPassword,omitempty"`
}

// HostRecord represents a configured SSH target stored inside the encrypted vault (Spec Section 8, F-01, F-10, F-14, F-21).
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
	ProxyProfileID string   `json:"proxyProfileId,omitempty"`
	ProxyCommand   string   `json:"proxyCommand,omitempty"`
	SessionLogging *bool    `json:"sessionLogging,omitempty"`
	EngagementID   string   `json:"engagementId,omitempty"`
}

// GroupDefaults holds inheritable connection settings for a host group (F-01, F-10, F-14, F-21).
type GroupDefaults struct {
	Port           uint16 `json:"port,omitempty"`
	Username       string `json:"username,omitempty"`
	IdentityID     string `json:"identityId,omitempty"`
	InitialDir     string `json:"initialDir,omitempty"`
	KeepaliveSecs  uint16 `json:"keepaliveSecs,omitempty"`
	ProxyProfileID string `json:"proxyProfileId,omitempty"`
	SessionLogging *bool  `json:"sessionLogging,omitempty"`
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

// SnippetVariable represents a variable parameter defined in a command snippet (F-15).
type SnippetVariable struct {
	Name         string `json:"name"`                   // e.g. "TARGET_PORT", "INTERFACE"
	DefaultValue string `json:"defaultValue,omitempty"` // default fallback value
	Description  string `json:"description,omitempty"`  // human-readable hint in prompt modal
	SecretRef    string `json:"secretRef,omitempty"`    // optional IdentityID / Vault secret reference
}

// Snippet represents a reusable command snippet stored in the encrypted vault (Spec Section 8, F-15).
type Snippet struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Description      string            `json:"description,omitempty"`
	Body             string            `json:"body"`
	Variables        []SnippetVariable `json:"variables,omitempty"`
	Tags             []string          `json:"tags,omitempty"`
	ConfirmBeforeRun bool              `json:"confirmBeforeRun"`
}

// SnippetContext holds session context for automatic variable interpolation (F-15).
type SnippetContext struct {
	HostID     string            `json:"hostId,omitempty"`
	HostLabel  string            `json:"hostLabel,omitempty"`
	Address    string            `json:"address,omitempty"`
	Hostname   string            `json:"hostname,omitempty"`
	IP         string            `json:"ip,omitempty"`
	Port       uint16            `json:"port,omitempty"`
	Username   string            `json:"username,omitempty"`
	WorkingDir string            `json:"workingDir,omitempty"`
	Timestamp  string            `json:"timestamp,omitempty"`
	Date       string            `json:"date,omitempty"`
	Time       string            `json:"time,omitempty"`
	CustomVars map[string]string `json:"customVars,omitempty"`
}

// SnippetChainStep represents a single sequential command stage in an automated or interactive attack chain (Spec F-16).
type SnippetChainStep struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Description      string `json:"description,omitempty"`
	SnippetID        string `json:"snippetId,omitempty"` // optional reference to an existing Snippet
	Command          string `json:"command"`            // shell command template with {{VAR}} support
	ConfirmBeforeRun bool   `json:"confirmBeforeRun"`   // default: true (Spec F-16 Akzeptanzkriterium)
	DelayMs          int    `json:"delayMs,omitempty"`  // execution delay in milliseconds before/after step
	StopOnError      bool   `json:"stopOnError"`        // halt the chain if this step fails (default: true)
}

// SnippetChain represents a multi-stage command execution sequence scoped to a host or global (Spec F-16).
type SnippetChain struct {
	ID                   string             `json:"id"`
	Name                 string             `json:"name"`
	Description          string             `json:"description,omitempty"`
	HostID               string             `json:"hostId,omitempty"`   // host association: empty means global/all hosts
	TargetOS             string             `json:"targetOs,omitempty"` // "any", "linux", "windows"
	Category             string             `json:"category,omitempty"` // e.g. "PrivEsc", "Pivot", "Stabilization", "Recon"
	Steps                []SnippetChainStep `json:"steps"`
	StopOnError          bool               `json:"stopOnError"`          // abort chain on any error (default: true)
	AutoRunWithoutPrompt bool               `json:"autoRunWithoutPrompt"` // "ohne Nachfrage" - strictly false by default, conscious opt-in per chain
	Tags                 []string           `json:"tags,omitempty"`
	CreatedAt            string             `json:"createdAt,omitempty"`
	UpdatedAt            string             `json:"updatedAt,omitempty"`
}

// PayloadTemplate represents a configurable reverse or bind payload template (Spec F-33).
// Commands are loaded dynamically from an external file rather than compiled into the binary.
type PayloadTemplate struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`        // e.g. "Bash Interactive TCP", "PowerShell TCP Client"
	Description string            `json:"description,omitempty"`
	OS          string            `json:"os"`          // "linux", "windows", "macos", "any"
	Shell       string            `json:"shell"`       // "bash", "python", "powershell", "socat", "nc", "php", "ruby", "perl"
	Kind        string            `json:"kind"`        // "reverse", "bind", "msfvenom", "one-liner"
	Command     string            `json:"command"`     // template containing {{LHOST}}, {{LPORT}}, etc.
	DefaultPort uint16            `json:"defaultPort,omitempty"`
	Variables   []SnippetVariable `json:"variables,omitempty"`
	Tags        []string          `json:"tags,omitempty"`
	OpsecRisk   string            `json:"opsecRisk,omitempty"` // "low", "medium", "high"
	Notes       string            `json:"notes,omitempty"`
}

// PayloadRenderOptions specifies parameter values and encodings for rendering a payload (F-33).
type PayloadRenderOptions struct {
	TemplateID string            `json:"templateId"`
	LHOST      string            `json:"lhost"`
	LPORT      uint16            `json:"lport"`
	Encoding   string            `json:"encoding,omitempty"` // "none", "base64", "url", "powershell_b64", "hex"
	CustomVars map[string]string `json:"customVars,omitempty"`
}

// PayloadRenderResult contains the generated payload string and OPSEC warnings (F-33).
type PayloadRenderResult struct {
	TemplateID    string            `json:"templateId"`
	RawCommand    string            `json:"rawCommand"`
	Rendered      string            `json:"rendered"`
	Encoding      string            `json:"encoding"`
	OpsecWarnings []string          `json:"opsecWarnings,omitempty"`
	ResolvedVars  map[string]string `json:"resolvedVars"`
}

// PayloadFileConfig holds metadata about the external payload templates file (F-33).
type PayloadFileConfig struct {
	FilePath      string `json:"filePath"`
	TemplateCount int    `json:"templateCount"`
	Exists        bool   `json:"exists"`
	LastModified  string `json:"lastModified,omitempty"`
}

// TotpRecord represents a time-based one-time password secret stored in the encrypted vault (Spec Section 8, F-20).
// The Secret seed never leaves the Go process (Golden Rule 2, Threat Model Line 155).
type TotpRecord struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Issuer    string `json:"issuer,omitempty"`
	Secret    string `json:"secret"`              // Encrypted in vault; never exposed in summaries
	Algorithm string `json:"algorithm,omitempty"` // "SHA1", "SHA256", "SHA512" (default "SHA1")
	Digits    int    `json:"digits,omitempty"`    // 6 or 8 (default 6)
	Period    int    `json:"period,omitempty"`    // step in seconds (default 30)
	HostID    string `json:"hostId,omitempty"`    // optional host or service association
	CreatedAt string `json:"createdAt,omitempty"`
}

// TotpSummary provides a non-secret view of a saved TOTP authenticator entry for the frontend UI (F-20, Golden Rule 2).
type TotpSummary struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Issuer    string `json:"issuer,omitempty"`
	Algorithm string `json:"algorithm"`
	Digits    int    `json:"digits"`
	Period    int    `json:"period"`
	HostID    string `json:"hostId,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

// TotpCodeResponse contains an ephemeral calculated TOTP code and remaining countdown seconds (F-20).
type TotpCodeResponse struct {
	ID               string `json:"id"`
	Code             string `json:"code"`
	RemainingSeconds int    `json:"remainingSeconds"`
	Period           int    `json:"period"`
}

// NotePage describes a hierarchical markdown note or documentation document linked to a host or global (Spec Line 129, Line 210, F-17).
type NotePage struct {
	ID           string    `json:"id"`
	HostID       string    `json:"hostId,omitempty"`       // empty for global / workspace notes
	EngagementID string    `json:"engagementId,omitempty"` // empty for global notes
	ParentID     string    `json:"parentId,omitempty"`     // empty for root page / folder
	IsFolder     bool      `json:"isFolder"`               // true if folder container
	Title        string    `json:"title"`
	Type         string    `json:"type"`                   // "markdown" or "table"
	Body         string    `json:"body"`
	Order        int       `json:"order"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// NotePageSummary describes the non-secret metadata and preview snippet of a note page (F-17).
type NotePageSummary struct {
	ID           string    `json:"id"`
	HostID       string    `json:"hostId,omitempty"`
	EngagementID string    `json:"engagementId,omitempty"`
	ParentID     string    `json:"parentId,omitempty"`
	IsFolder     bool      `json:"isFolder"`
	Title        string    `json:"title"`
	Type         string    `json:"type"`
	Order        int       `json:"order"`
	Snippet      string    `json:"snippet,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// NoteSearchResult represents a full-text search match in notes (F-17, F-02).
type NoteSearchResult struct {
	Note         NotePageSummary `json:"note"`
	MatchSnippet string          `json:"matchSnippet"`
	MatchCount   int             `json:"matchCount"`
}

// SessionLogRecord describes a recorded terminal session log file with timestamps (Spec Line 131, F-21).
type SessionLogRecord struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	HostID    string `json:"hostId,omitempty"`
	HostLabel string `json:"hostLabel"`
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt,omitempty"`
	FilePath  string `json:"filePath"`
	ByteCount int64  `json:"byteCount"`
	LineCount int    `json:"lineCount"`
	Active    bool   `json:"active"`
}

// SessionLogStatus describes the live recording state of an active terminal session (F-21).
type SessionLogStatus struct {
	SessionID string `json:"sessionId"`
	LogID     string `json:"logId,omitempty"`
	Active    bool   `json:"active"`
	FilePath  string `json:"filePath,omitempty"`
	ByteCount int64  `json:"byteCount"`
	LineCount int    `json:"lineCount"`
}

// VaultPayload is the top-level document encrypted inside the vault file (Spec Section 8, F-03, F-13, F-14, F-15, F-17, F-20).
type VaultPayload struct {
	SchemaVersion int               `json:"schemaVersion"`
	Hosts         []HostRecord      `json:"hosts"`
	Groups        []GroupRecord     `json:"groups"`
	Identities    []IdentityRecord  `json:"identities"`
	Keys          []SshKeyRecord    `json:"keys"`
	ForwardRules  []ForwardRule     `json:"forwardRules,omitempty"`
	ProxyProfiles []ProxyProfile    `json:"proxyProfiles,omitempty"`
	Snippets      []Snippet         `json:"snippets,omitempty"`
	SnippetChains []SnippetChain    `json:"snippetChains,omitempty"`
	TotpRecords   []TotpRecord      `json:"totpRecords,omitempty"`
	Notes         []NotePage        `json:"notes,omitempty"`
	Engagements   []Engagement      `json:"engagements,omitempty"`
	Credentials   []CredentialEntry `json:"credentials,omitempty"`
	Evidence      []EvidenceItem    `json:"evidence,omitempty"`
	Findings      []FindingItem     `json:"findings,omitempty"`
	PortFindings  []PortFinding     `json:"portFindings,omitempty"`
}

// RemoteEditStatus defines the synchronization status of a remote edited file (F-28).
type RemoteEditStatus string

const (
	RemoteEditStatusActive   RemoteEditStatus = "active"
	RemoteEditStatusSyncing  RemoteEditStatus = "syncing"
	RemoteEditStatusConflict RemoteEditStatus = "conflict"
	RemoteEditStatusClosed   RemoteEditStatus = "closed"
)

// RemoteEditSession tracks an active remote file editing lifecycle (F-28).
type RemoteEditSession struct {
	ID             string           `json:"id"`
	SessionID      string           `json:"sessionId"`
	RemotePath     string           `json:"remotePath"`
	LocalPath      string           `json:"localPath"`
	Filename       string           `json:"filename"`
	InitialModTime int64            `json:"initialModTime"`
	InitialSize    int64            `json:"initialSize"`
	InitialHash    string           `json:"initialHash"`
	Status         RemoteEditStatus `json:"status"`
	LastUploadedAt int64            `json:"lastUploadedAt"`
	HasConflict    bool             `json:"hasConflict"`
	ErrorMessage   string           `json:"errorMessage,omitempty"`
}

// RemoteEditResult contains the outcome of saving/uploading an edited remote file (F-28).
type RemoteEditResult struct {
	Success       bool   `json:"success"`
	Conflict      bool   `json:"conflict"`
	RemoteModTime int64  `json:"remoteModTime"`
	RemoteSize    int64  `json:"remoteSize"`
	Message       string `json:"message"`
}

// RemoteConflictInfo describes parallel server modification details (F-28).
type RemoteConflictInfo struct {
	HasConflict    bool   `json:"hasConflict"`
	RemotePath     string `json:"remotePath"`
	InitialModTime int64  `json:"initialModTime"`
	RemoteModTime  int64  `json:"remoteModTime"`
	InitialSize    int64  `json:"initialSize"`
	RemoteSize     int64  `json:"remoteSize"`
	Message        string `json:"message"`
}

// RemoteEditEvent is emitted over Wails when remote file status changes or auto-upload occurs (F-28).
type RemoteEditEvent struct {
	EditSessionID string           `json:"editSessionId"`
	Status        RemoteEditStatus `json:"status"`
	HasConflict   bool             `json:"hasConflict"`
	Message       string           `json:"message,omitempty"`
}

// VaultSyncStatus describes the synchronization state of the on-disk encrypted vault file (F-29).
type VaultSyncStatus string

const (
	VaultSyncStatusSynced         VaultSyncStatus = "synced"
	VaultSyncStatusExternalChange VaultSyncStatus = "external_change"
	VaultSyncStatusConflict       VaultSyncStatus = "conflict"
)

// VaultConflictResolution specifies how to resolve a conflict for an item (F-29).
type VaultConflictResolution string

const (
	ResolutionKeepLocal  VaultConflictResolution = "local"
	ResolutionKeepRemote VaultConflictResolution = "remote"
	ResolutionKeepBoth   VaultConflictResolution = "both"
)

// VaultConflictItem represents a single conflicting entity between local and remote vaults (F-29).
type VaultConflictItem struct {
	ID            string `json:"id"`
	Type          string `json:"type"` // "host", "group", "identity", "key", "snippet", "note", "totp", "forward_rule", "proxy_profile"
	Label         string `json:"label"`
	LocalSummary  string `json:"localSummary"`
	RemoteSummary string `json:"remoteSummary"`
}

// VaultConflictReport summarizes detected conflicts when merging two vaults (F-29).
type VaultConflictReport struct {
	HasConflicts bool                `json:"hasConflicts"`
	Conflicts    []VaultConflictItem `json:"conflicts"`
	AutoMerged   int                 `json:"autoMerged"`
}

// VaultSyncInfo provides telemetry and file metadata for the active vault file (F-29).
type VaultSyncInfo struct {
	FilePath          string          `json:"filePath"`
	FileSize          int64           `json:"fileSize"`
	LastModified      int64           `json:"lastModified"`
	Status            VaultSyncStatus `json:"status"`
	SyncConflictFiles []string        `json:"syncConflictFiles,omitempty"`
	DetectedConflict  bool            `json:"detectedConflict"`
	ConflictCount     int             `json:"conflictCount"`
}

// SecretStore defines the strict boundary interface for the encrypted vault (ADR-0007, F-03, F-29).
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
	GetFilePath() string
	SetFilePath(newPath string) error
	GetSyncInfo() (VaultSyncInfo, error)
	CheckExternalChange() (bool, error)
}
