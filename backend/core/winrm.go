package core

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
)

const (
	WinrmAuthNTLM     = "ntlm"
	WinrmAuthPtH      = "pth"
	WinrmAuthKerberos = "kerberos"
	WinrmAuthBasic    = "basic"

	DefaultWinrmHTTPPort  uint16 = 5985
	DefaultWinrmHTTPSPort uint16 = 5986
)

// WinrmProfile defines a saved WinRM connection configuration stored in the encrypted vault (F-41).
// Secrets (Password, NtHash) are omitted from WinrmProfileSummary and never sent unnecessarily to the UI.
type WinrmProfile struct {
	ID                 string `json:"id"`
	EngagementID       string `json:"engagementId,omitempty"` // "" = Global; otherwise scoped to specific engagement
	HostID             string `json:"hostId,omitempty"`
	Name               string `json:"name"`
	Host               string `json:"host"`
	Port               uint16 `json:"port"`                         // 5985 (HTTP) or 5986 (HTTPS)
	UseTLS             bool   `json:"useTls"`                       // HTTPS 5986 when true
	InsecureSkipVerify bool   `json:"insecureSkipVerify,omitempty"` // Skip TLS cert validation (self-signed labs)
	AuthType           string `json:"authType"`                     // "ntlm" | "pth" | "kerberos" | "basic"
	Domain             string `json:"domain,omitempty"`
	Username           string `json:"username,omitempty"`
	Password           string `json:"password,omitempty"`
	NtHash             string `json:"ntHash,omitempty"`
	IdentityID         string `json:"identityId,omitempty"`
	CredentialID       string `json:"credentialId,omitempty"`
	SocksProxyAddr     string `json:"socksProxyAddr,omitempty"` // Optional SOCKS5 host:port (-D / Chisel)
	TimeoutSec         int    `json:"timeoutSec,omitempty"`
	Notes              string `json:"notes,omitempty"`
	CreatedAt          string `json:"createdAt,omitempty"`
}

// WinrmProfileSummary is the secret-free representation of WinrmProfile exposed to the frontend UI (Golden Rule 2).
type WinrmProfileSummary struct {
	ID                 string `json:"id"`
	EngagementID       string `json:"engagementId,omitempty"`
	HostID             string `json:"hostId,omitempty"`
	Name               string `json:"name"`
	Host               string `json:"host"`
	Port               uint16 `json:"port"`
	UseTLS             bool   `json:"useTls"`
	InsecureSkipVerify bool   `json:"insecureSkipVerify,omitempty"`
	AuthType           string `json:"authType"`
	Domain             string `json:"domain,omitempty"`
	Username           string `json:"username,omitempty"`
	HasPassword        bool   `json:"hasPassword"`
	HasNtHash          bool   `json:"hasNtHash"`
	IdentityID         string `json:"identityId,omitempty"`
	CredentialID       string `json:"credentialId,omitempty"`
	SocksProxyAddr     string `json:"socksProxyAddr,omitempty"`
	TimeoutSec         int    `json:"timeoutSec,omitempty"`
	Notes              string `json:"notes,omitempty"`
	CreatedAt          string `json:"createdAt,omitempty"`
}

// ToSummary strips secret fields from a WinrmProfile for safe IPC transport to WebView.
func (p WinrmProfile) ToSummary() WinrmProfileSummary {
	return WinrmProfileSummary{
		ID:                 p.ID,
		EngagementID:       p.EngagementID,
		HostID:             p.HostID,
		Name:               p.Name,
		Host:               p.Host,
		Port:               p.Port,
		UseTLS:             p.UseTLS,
		InsecureSkipVerify: p.InsecureSkipVerify,
		AuthType:           NormalizeWinrmAuthType(p.AuthType),
		Domain:             p.Domain,
		Username:           p.Username,
		HasPassword:        strings.TrimSpace(p.Password) != "",
		HasNtHash:          strings.TrimSpace(p.NtHash) != "",
		IdentityID:         p.IdentityID,
		CredentialID:       p.CredentialID,
		SocksProxyAddr:     p.SocksProxyAddr,
		TimeoutSec:         p.TimeoutSec,
		Notes:              p.Notes,
		CreatedAt:          p.CreatedAt,
	}
}

// WinrmConnectRequest opens a live WinRM session, resolving stored vault secrets in Go when ProfileID/IdentityID/CredentialID is set.
type WinrmConnectRequest struct {
	ProfileID          string `json:"profileId,omitempty"`
	HostID             string `json:"hostId,omitempty"`
	EngagementID       string `json:"engagementId,omitempty"`
	Name               string `json:"name,omitempty"`
	Host               string `json:"host"`
	Port               uint16 `json:"port,omitempty"`
	UseTLS             bool   `json:"useTls"`
	InsecureSkipVerify bool   `json:"insecureSkipVerify,omitempty"`
	AuthType           string `json:"authType"`
	Domain             string `json:"domain,omitempty"`
	Username           string `json:"username,omitempty"`
	Password           string `json:"password,omitempty"`
	NtHash             string `json:"ntHash,omitempty"`
	IdentityID         string `json:"identityId,omitempty"`
	CredentialID       string `json:"credentialId,omitempty"`
	SocksProxyAddr     string `json:"socksProxyAddr,omitempty"`
	TimeoutSec         int    `json:"timeoutSec,omitempty"`
}

// WinrmSessionInfo describes an active interactive WinRM / PowerShell Remoting session (F-41).
type WinrmSessionInfo struct {
	SessionID     string   `json:"sessionId"`
	ProfileID     string   `json:"profileId,omitempty"`
	HostID        string   `json:"hostId,omitempty"`
	Name          string   `json:"name"`
	Host          string   `json:"host"`
	Port          uint16   `json:"port"`
	UseTLS        bool     `json:"useTls"`
	AuthType      string   `json:"authType"`
	Domain        string   `json:"domain,omitempty"`
	Username      string   `json:"username"`
	ShellID       string   `json:"shellId,omitempty"`
	CurrentDir    string   `json:"currentDir,omitempty"`
	Status        string   `json:"status"` // "connected", "error", "closed"
	BackendMode   string   `json:"backendMode"`
	SocksProxy    string   `json:"socksProxy,omitempty"`
	OpsecWarnings []string `json:"opsecWarnings,omitempty"`
	ConnectedAt   string   `json:"connectedAt"`
	CommandCount  int      `json:"commandCount"`
	ErrorMsg      string   `json:"errorMsg,omitempty"`
}

// WinrmExecResult captures the output of a single WinRM PowerShell / cmd execution (F-41).
type WinrmExecResult struct {
	SessionID  string `json:"sessionId"`
	ShellID    string `json:"shellId,omitempty"`
	Command    string `json:"command"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exitCode"`
	DurationMs int64  `json:"durationMs"`
}

// WinrmTransferResult captures the outcome of a chunked Base64 WinRM file upload or download (F-41).
type WinrmTransferResult struct {
	SessionID  string `json:"sessionId"`
	Direction  string `json:"direction"` // "upload" | "download"
	LocalPath  string `json:"localPath"`
	RemotePath string `json:"remotePath"`
	Bytes      int64  `json:"bytes"`
	SHA256     string `json:"sha256,omitempty"`
	DurationMs int64  `json:"durationMs"`
}

// WinrmToolStatus reports external WinRM helper binaries detected on PATH (evil-winrm / pwsh).
type WinrmToolStatus struct {
	Tool  string `json:"tool"`
	Found bool   `json:"found"`
	Path  string `json:"path,omitempty"`
}

// NormalizeWinrmAuthType canonicalizes WinRM authentication mechanisms.
func NormalizeWinrmAuthType(auth string) string {
	switch strings.ToLower(strings.TrimSpace(auth)) {
	case "", "ntlm", "ntlmv2":
		return WinrmAuthNTLM
	case "pth", "pass-the-hash", "hash", "nt":
		return WinrmAuthPtH
	case "kerberos", "krb", "krb5", "negotiate":
		return WinrmAuthKerberos
	case "basic":
		return WinrmAuthBasic
	default:
		return strings.ToLower(strings.TrimSpace(auth))
	}
}

// NormalizeWinrmProfile fills sensible defaults on a WinrmProfile.
func NormalizeWinrmProfile(p WinrmProfile) WinrmProfile {
	p.Name = strings.TrimSpace(p.Name)
	p.Host = strings.TrimSpace(p.Host)
	p.Domain = strings.TrimSpace(p.Domain)
	p.Username = strings.TrimSpace(p.Username)
	p.AuthType = NormalizeWinrmAuthType(p.AuthType)
	if p.Port == 0 {
		if p.UseTLS {
			p.Port = DefaultWinrmHTTPSPort
		} else {
			p.Port = DefaultWinrmHTTPPort
		}
	}
	if p.TimeoutSec <= 0 {
		p.TimeoutSec = 15
	} else if p.TimeoutSec > 120 {
		p.TimeoutSec = 120
	}
	if p.Name == "" && p.Host != "" {
		p.Name = p.Host
	}
	return p
}

// ParseNtHashHex accepts either a 32-hex NT hash or an "LM:NT" 65-char pair and returns the raw 16-byte NT hash.
// Returns generic error wording so secret hex bytes never enter logs or error messages.
func ParseNtHashHex(raw string) ([]byte, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("NT hash is empty")
	}
	if idx := strings.LastIndex(trimmed, ":"); idx >= 0 {
		trimmed = strings.TrimSpace(trimmed[idx+1:])
	}
	if len(trimmed) != 32 {
		return nil, errors.New("NT hash must be 32 hex characters (or LM:NT format)")
	}
	decoded, err := hex.DecodeString(trimmed)
	if err != nil || len(decoded) != 16 {
		return nil, errors.New("NT hash contains invalid hex characters")
	}
	return decoded, nil
}

// ValidateWinrmProfile checks a WinRM configuration before saving or dialing.
func ValidateWinrmProfile(p WinrmProfile) error {
	p = NormalizeWinrmProfile(p)
	if p.Host == "" {
		return errors.New("WinRM target host cannot be empty")
	}
	if shellMetaRe.MatchString(p.Host) {
		return errors.New("WinRM host contains disallowed shell metacharacters")
	}
	if p.Port == 0 {
		return errors.New("WinRM port must be between 1 and 65535")
	}
	switch p.AuthType {
	case WinrmAuthNTLM, WinrmAuthPtH, WinrmAuthKerberos, WinrmAuthBasic:
	default:
		return fmt.Errorf("unsupported WinRM auth type %q", p.AuthType)
	}
	if p.AuthType != WinrmAuthKerberos && strings.TrimSpace(p.Username) == "" {
		return errors.New("username is required for NTLM, Pass-the-Hash, and Basic WinRM auth")
	}
	if p.AuthType == WinrmAuthPtH && strings.TrimSpace(p.NtHash) != "" {
		if _, err := ParseNtHashHex(p.NtHash); err != nil {
			return err
		}
	}
	if strings.TrimSpace(p.SocksProxyAddr) != "" {
		if _, err := ValidateSocksProxyAddr(p.SocksProxyAddr); err != nil {
			return err
		}
	}
	return nil
}

// EncodePowerShellUTF16Base64 encodes a PowerShell script block for `powershell -NoProfile -NonInteractive -EncodedCommand`.
func EncodePowerShellUTF16Base64(script string) string {
	runes := []rune(script)
	buf := make([]byte, 0, len(runes)*2)
	for _, r := range runes {
		if r <= 0xFFFF {
			buf = append(buf, byte(r), byte(r>>8))
		} else {
			// Surrogate pair for characters above BMP
			r -= 0x10000
			hi := 0xD800 + (r >> 10)
			lo := 0xDC00 + (r & 0x3FF)
			buf = append(buf, byte(hi), byte(hi>>8), byte(lo), byte(lo>>8))
		}
	}
	return base64.StdEncoding.EncodeToString(buf)
}

// AnalyzeWinrmOpsec produces OPSEC and transport security advisories for a WinRM profile.
func AnalyzeWinrmOpsec(p WinrmProfile) []string {
	p = NormalizeWinrmProfile(p)
	warnings := make([]string, 0, 4)

	if !p.UseTLS && p.Port == DefaultWinrmHTTPPort {
		if p.AuthType == WinrmAuthBasic {
			warnings = append(warnings,
				"CRITICAL OPSEC: Basic auth over unencrypted HTTP (5985) transmits Base64 credentials in cleartext on the wire.")
		} else {
			warnings = append(warnings,
				"Unencrypted WinRM HTTP (5985): NTLMv2 negotiates message sealing when supported, or switch to HTTPS (5986) for TLS transport encryption.")
		}
	}
	if p.UseTLS && p.InsecureSkipVerify {
		warnings = append(warnings,
			"TLS certificate verification is disabled (self-signed mode): vulnerable to on-path MITM on untrusted networks.")
	}
	if p.AuthType == WinrmAuthKerberos && net.ParseIP(p.Host) != nil {
		warnings = append(warnings,
			"Kerberos WinRM requires a DNS FQDN SPN (HTTP/dc01.corp.local), not an IP address.")
	}
	if p.AuthType == WinrmAuthPtH {
		warnings = append(warnings,
			"Pass-the-Hash active: authenticating with NTLMv2 NT hash without cleartext password.")
	}
	return warnings
}

// BuildEvilWinrmCLI constructs a safe external `evil-winrm` command preview (masking secrets).
func BuildEvilWinrmCLI(p WinrmProfile) string {
	p = NormalizeWinrmProfile(p)
	parts := []string{"evil-winrm"}
	if p.Host != "" {
		parts = append(parts, "-i", p.Host)
	}
	parts = append(parts, "-P", strconv.Itoa(int(p.Port)))
	if p.UseTLS {
		parts = append(parts, "-S")
	}
	if p.Username != "" {
		userArg := p.Username
		if p.Domain != "" && p.AuthType != WinrmAuthKerberos {
			userArg = p.Domain + `\` + p.Username
		}
		parts = append(parts, "-u", userArg)
	}
	switch p.AuthType {
	case WinrmAuthPtH:
		parts = append(parts, "-H", "<NT_HASH>")
	case WinrmAuthKerberos:
		if p.Domain != "" {
			parts = append(parts, "-r", strings.ToUpper(p.Domain))
		}
	default:
		parts = append(parts, "-p", "<PASSWORD>")
	}
	cmd := strings.Join(parts, " ")
	if strings.TrimSpace(p.SocksProxyAddr) != "" {
		cmd = "proxychains4 -q " + cmd
	}
	return cmd
}
