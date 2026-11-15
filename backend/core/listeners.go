package core

import (
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

// ListenerProfile represents a configurable reverse or bind listener profile stored in the Vault (Spec F-32, Line 35, 54).
type ListenerProfile struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Kind         string            `json:"kind"` // "reverse", "bind"
	Tool         string            `json:"tool"` // "builtin", "nc", "rlwrap", "ncat-ssl", "socat"
	BindAddress  string            `json:"bindAddress"`
	BindPort     uint16            `json:"bindPort"`
	AutoSpawnTab bool              `json:"autoSpawnTab"`
	Options      map[string]string `json:"options,omitempty"`
	Notes        string            `json:"notes,omitempty"`
	CreatedAt    string            `json:"createdAt,omitempty"`
}

// ManagedListenerInfo describes the live operational telemetry of an active or managed listener (F-32).
type ManagedListenerInfo struct {
	ID             string               `json:"id"`
	ProfileID      string               `json:"profileId,omitempty"`
	Name           string               `json:"name"`
	Kind           string               `json:"kind"`
	Tool           string               `json:"tool"`
	BindAddress    string               `json:"bindAddress"`
	BindPort       uint16               `json:"bindPort"`
	Status         string               `json:"status"` // "listening", "active", "stopped", "error"
	ErrorMsg       string               `json:"errorMsg,omitempty"`
	StartedAt      string               `json:"startedAt,omitempty"`
	CatchCount     int                  `json:"catchCount"`
	ActiveSessions []RawTcpSessionStats `json:"activeSessions,omitempty"`
	CommandPreview string               `json:"commandPreview,omitempty"`
	OpsecWarnings  []string             `json:"opsecWarnings,omitempty"`
}

// ValidateListenerProfile validates listener configuration parameters before saving or starting (F-32).
func ValidateListenerProfile(profile ListenerProfile) error {
	name := strings.TrimSpace(profile.Name)
	if name == "" {
		return errors.New("listener name cannot be empty")
	}

	if profile.BindPort == 0 {
		return errors.New("listener bind port must be between 1 and 65535")
	}

	kind := strings.ToLower(strings.TrimSpace(profile.Kind))
	if kind != "" && kind != "reverse" && kind != "bind" {
		return fmt.Errorf("invalid listener kind %q (supported: reverse, bind)", profile.Kind)
	}

	tool := strings.ToLower(strings.TrimSpace(profile.Tool))
	validTools := map[string]bool{
		"builtin":  true,
		"raw-tcp":  true,
		"nc":       true,
		"netcat":   true,
		"rlwrap":   true,
		"ncat-ssl": true,
		"ncat":     true,
		"socat":    true,
	}
	if tool != "" && !validTools[tool] {
		return fmt.Errorf("invalid listener tool %q (supported: builtin, nc, rlwrap, ncat-ssl, socat)", profile.Tool)
	}

	addr := strings.TrimSpace(profile.BindAddress)
	if addr != "" && addr != "0.0.0.0" && addr != "127.0.0.1" && addr != "::" && addr != "::1" {
		if net.ParseIP(addr) == nil {
			return fmt.Errorf("invalid bind IP address %q", profile.BindAddress)
		}
	}

	return nil
}

// AnalyzeListenerOpsec evaluates operational security risks according to Threat Model & Spec Section 4 (F-32, F-33).
func AnalyzeListenerOpsec(kind string, bindAddress string, port uint16) []string {
	var warnings []string

	// Signature CTF & Metasploit Default Ports (Spec Line 73)
	if port == 4444 || port == 1337 || port == 31337 || port == 6667 {
		warnings = append(warnings, fmt.Sprintf("Port %d is a heavily signatured Metasploit/CTF default; consider stealth egress ports like 443, 80, 53, or 8443.", port))
	}

	// Loopback Bind Address for Reverse Listeners
	addr := strings.TrimSpace(bindAddress)
	isLoopback := addr == "127.0.0.1" || addr == "localhost" || addr == "::1"
	if strings.ToLower(kind) == "reverse" && isLoopback {
		warnings = append(warnings, "Listener is bound to loopback (127.0.0.1); reverse shells arriving from remote targets will fail to connect. Use 0.0.0.0 or your VPN adapter IP.")
	}

	return warnings
}

// BuildListenerCommand constructs the exact shell command string to launch external listener tools (F-32).
func BuildListenerCommand(profile ListenerProfile) string {
	tool := strings.ToLower(strings.TrimSpace(profile.Tool))
	port := profile.BindPort
	if port == 0 {
		port = 443
	}

	switch tool {
	case "nc", "netcat":
		// Standard Netcat listen command
		if profile.Options != nil && profile.Options["style"] == "bsd" {
			return fmt.Sprintf("nc -lv %d", port)
		}
		return fmt.Sprintf("nc -lvnp %d", port)

	case "rlwrap":
		// rlwrap wrapping netcat for command history and line editing
		return fmt.Sprintf("rlwrap -cAr nc -lvnp %d", port)

	case "ncat-ssl", "ncat":
		// Ncat with SSL/TLS encryption support
		cmd := fmt.Sprintf("ncat --ssl -lvnp %d", port)
		if profile.Options != nil {
			if cert := strings.TrimSpace(profile.Options["sslCert"]); cert != "" {
				cmd += fmt.Sprintf(" --ssl-cert %q", cert)
			}
			if key := strings.TrimSpace(profile.Options["sslKey"]); key != "" {
				cmd += fmt.Sprintf(" --ssl-key %q", key)
			}
		}
		return cmd

	case "socat":
		// Full interactive PTY handler via socat
		if profile.Options != nil && profile.Options["mode"] == "stdout" {
			return fmt.Sprintf("socat -d -d TCP-LISTEN:%d,reuseaddr STDOUT", port)
		}
		return fmt.Sprintf("socat file:`tty`,raw,echo=0 tcp-listen:%d", port)

	case "builtin", "raw-tcp":
		fallthrough
	default:
		return fmt.Sprintf("DoubleAgent Native Go Listener [0.0.0.0:%d]", port)
	}
}

// DefaultBuiltinListenerProfiles returns a structured set of initial listener profiles ready for operational use (F-32).
func DefaultBuiltinListenerProfiles() []ListenerProfile {
	return []ListenerProfile{
		{
			ID:           "prof-builtin-https-443",
			Name:         "Default Stealth HTTPS Reverse Listener",
			Kind:         "reverse",
			Tool:         "builtin",
			BindAddress:  "0.0.0.0",
			BindPort:     443,
			AutoSpawnTab: true,
			Notes:        "Recommended default: Bypasses strict outbound egress filters masquerading as HTTPS.",
		},
		{
			ID:           "prof-builtin-dns-53",
			Name:         "Default DNS Egress Reverse Listener",
			Kind:         "reverse",
			Tool:         "builtin",
			BindAddress:  "0.0.0.0",
			BindPort:     53,
			AutoSpawnTab: true,
			Notes:        "Stealth egress listener: Port 53 is almost universally permitted across firewalls.",
		},
		{
			ID:           "prof-builtin-http-80",
			Name:         "Default HTTP Reverse Listener",
			Kind:         "reverse",
			Tool:         "builtin",
			BindAddress:  "0.0.0.0",
			BindPort:     80,
			AutoSpawnTab: true,
			Notes:        "Standard HTTP egress port.",
		},
		{
			ID:           "prof-builtin-althttps-8443",
			Name:         "Alt-HTTPS Reverse Listener",
			Kind:         "reverse",
			Tool:         "builtin",
			BindAddress:  "0.0.0.0",
			BindPort:     8443,
			AutoSpawnTab: true,
			Notes:        "Alternative web proxy & egress port.",
		},
		{
			ID:           "prof-rlwrap-nc-443",
			Name:         "rlwrap Netcat Shell Catcher",
			Kind:         "reverse",
			Tool:         "rlwrap",
			BindAddress:  "0.0.0.0",
			BindPort:     443,
			AutoSpawnTab: true,
			Notes:        "Spawns rlwrap-enhanced Netcat with persistent command line history and arrow key navigation.",
		},
		{
			ID:           "prof-socat-pty-443",
			Name:         "Socat Interactive PTY Listener",
			Kind:         "reverse",
			Tool:         "socat",
			BindAddress:  "0.0.0.0",
			BindPort:     443,
			AutoSpawnTab: true,
			Notes:        "Spawns full raw PTY via socat file:`tty`,raw,echo=0 tcp-listen:443.",
		},
		{
			ID:           "prof-ncat-ssl-443",
			Name:         "Ncat SSL/TLS Encrypted Listener",
			Kind:         "reverse",
			Tool:         "ncat-ssl",
			BindAddress:  "0.0.0.0",
			BindPort:     443,
			AutoSpawnTab: true,
			Notes:        "Encrypted reverse shell listener defeating deep packet inspection (DPI) and plain text network monitoring.",
		},
	}
}

// GenerateManagedListenerID generates a unique identifier for a running listener instance.
func GenerateManagedListenerID(tool string, port uint16) string {
	cleanTool := strings.ToLower(strings.TrimSpace(tool))
	if cleanTool == "" {
		cleanTool = "builtin"
	}
	return fmt.Sprintf("listener-%s-%d-%d", cleanTool, port, time.Now().UnixNano())
}

