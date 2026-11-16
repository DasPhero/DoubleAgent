package core

import (
	"errors"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var safeIfaceNameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,32}$`)
var shellMetaRe = regexp.MustCompile(`[;&|` + "`" + `$><\r\n]`)

// NetworkRoute defines a saved or active pivoting configuration in the encrypted vault (Spec Line 33, 57, F-24, F-38).
type NetworkRoute struct {
	ID            string   `json:"id"`
	EngagementID  string   `json:"engagementId,omitempty"` // "" = Global; otherwise scoped to specific engagement
	Name          string   `json:"name"`
	Kind          string   `json:"kind"`                    // "ligolo", "chisel", "sshuttle", "-L", "-R", "-D", "ProxyJump"
	Tool          string   `json:"tool"`                    // "ligolo-ng", "chisel"
	BindAddress   string   `json:"bindAddress"`             // e.g. "0.0.0.0"
	ListenPort    uint16   `json:"listenPort"`              // e.g. 11601 (ligolo) or 8443 (chisel server)
	SocksPort     uint16   `json:"socksPort,omitempty"`     // e.g. 1080 (chisel SOCKS5 listener)
	InterfaceName string   `json:"interfaceName,omitempty"` // e.g. "ligolo"
	Subnets       []string `json:"subnets,omitempty"`       // e.g. ["10.10.20.0/24", "172.16.5.0/24"]
	Hops          []string `json:"hops,omitempty"`          // Pivot hop host IDs / labels for topology & F-38
	RemoteSpecs   []string `json:"remoteSpecs,omitempty"`   // e.g. ["R:socks", "R:3389:10.10.20.10:3389"] for chisel
	Reverse       bool     `json:"reverse"`                 // Chisel: enable --reverse on server
	SelfCert      bool     `json:"selfCert"`                // Ligolo-ng: pass -selfcert
	IgnoreCert    bool     `json:"ignoreCert"`              // Ligolo agent: -ignore-cert in generated target snippet
	BinaryPath    string   `json:"binaryPath,omitempty"`    // Optional explicit binary path
	ExtraArgs     string   `json:"extraArgs,omitempty"`     // Optional extra CLI flags (shell metacharacters rejected)
	SshTarget     string   `json:"sshTarget,omitempty"`     // sshuttle / 2-step SSH relay host (e.g. user@jump[:port])
	RelayHostID   string   `json:"relayHostId,omitempty"`   // Saved Vault Host ID for reachable SSH relay
	ForwardMode   string   `json:"forwardMode,omitempty"`   // "local" (-L) or "socks" (-D) for 2-step SSH forward
	ForwardTarget string   `json:"forwardTarget,omitempty"` // Internal target host:port for 2-step -L forwarding
	Status        string   `json:"status,omitempty"`        // "configured", "running", "stopped", "error"
	LastCheck     string   `json:"lastCheck,omitempty"`     // ISO-8601 timestamp (F-38)
	Notes         string   `json:"notes,omitempty"`
	CreatedAt     string   `json:"createdAt,omitempty"`
}

// TwoStepSshPivotRequest launches a native Go chained SSH tunnel via a reachable Vault relay host (F-24, F-13).
type TwoStepSshPivotRequest struct {
	RelayHostID  string `json:"relayHostId"`
	EngagementID string `json:"engagementId,omitempty"`
	Mode         string `json:"mode"` // "local" (-L) | "socks" (-D)
	BindAddress  string `json:"bindAddress,omitempty"`
	LocalPort    uint16 `json:"localPort"`
	TargetHost   string `json:"targetHost,omitempty"`
	TargetPort   uint16 `json:"targetPort,omitempty"`
	Name         string `json:"name,omitempty"`
	SaveRule     bool   `json:"saveRule"`
}

// PivotInstanceInfo describes the live operational state of a running or recently stopped pivot process (F-24).
type PivotInstanceInfo struct {
	ID              string   `json:"id"`
	RouteID         string   `json:"routeId,omitempty"`
	EngagementID    string   `json:"engagementId,omitempty"`
	Name            string   `json:"name"`
	Tool            string   `json:"tool"`
	BindAddress     string   `json:"bindAddress"`
	ListenPort      uint16   `json:"listenPort"`
	SocksPort       uint16   `json:"socksPort,omitempty"`
	InterfaceName   string   `json:"interfaceName,omitempty"`
	Subnets         []string `json:"subnets,omitempty"`
	Status          string   `json:"status"` // "running", "stopped", "error"
	PID             int      `json:"pid,omitempty"`
	BinaryPath      string   `json:"binaryPath,omitempty"`
	StartedAt       string   `json:"startedAt,omitempty"`
	StoppedAt       string   `json:"stoppedAt,omitempty"`
	ErrorMsg        string   `json:"errorMsg,omitempty"`
	CommandPreview  string   `json:"commandPreview"`
	OpsecWarnings   []string `json:"opsecWarnings,omitempty"`
	RecentLogs      []string `json:"recentLogs,omitempty"`
	ConnectedAgents []string `json:"connectedAgents,omitempty"`
}

// PivotBinaryStatus reports whether a local pivoting binary (ligolo-ng / chisel) was found on PATH (F-24).
type PivotBinaryStatus struct {
	Tool       string `json:"tool"` // "ligolo-ng", "chisel"
	Found      bool   `json:"found"`
	BinaryName string `json:"binaryName"`
	Path       string `json:"path,omitempty"`
}

// PivotCommandSet holds generated operator setup, proxy, target agent, and proxychains commands for F-24.
type PivotCommandSet struct {
	Tool             string   `json:"tool"`
	LHOST            string   `json:"lhost"`
	ProxyCommand     string   `json:"proxyCommand"`
	SetupCommands    []string `json:"setupCommands,omitempty"`
	RouteCommands    []string `json:"routeCommands,omitempty"`
	ConsoleCommands  []string `json:"consoleCommands,omitempty"`
	LinuxAgentCmd    string   `json:"linuxAgentCmd"`
	WindowsAgentCmd  string   `json:"windowsAgentCmd"`
	ProxychainsLine  string   `json:"proxychainsLine,omitempty"`
	OpsecWarnings    []string `json:"opsecWarnings,omitempty"`
}

// NormalizePivotTool maps aliases like "ligolo" to canonical tool names.
func NormalizePivotTool(tool string) string {
	t := strings.ToLower(strings.TrimSpace(tool))
	switch t {
	case "", "ligolo", "ligolo-ng", "ligolo-proxy":
		return "ligolo-ng"
	case "chisel":
		return "chisel"
	case "sshuttle":
		return "sshuttle"
	case "ssh-forward", "ssh_forward", "2step-ssh", "twostep-ssh", "ssh":
		return "ssh-forward"
	default:
		return t
	}
}

// ValidateNetworkRoute validates a pivot / network route configuration before persistence or launch (F-24).
func ValidateNetworkRoute(route NetworkRoute) error {
	if strings.TrimSpace(route.Name) == "" {
		return errors.New("pivot route name cannot be empty")
	}

	tool := NormalizePivotTool(route.Tool)
	if tool != "ligolo-ng" && tool != "chisel" && tool != "sshuttle" && tool != "ssh-forward" {
		return fmt.Errorf("unsupported pivot tool %q (supported: ligolo-ng, chisel, sshuttle, ssh-forward)", route.Tool)
	}

	if tool != "sshuttle" && route.ListenPort == 0 {
		return errors.New("listen port must be between 1 and 65535")
	}

	addr := strings.TrimSpace(route.BindAddress)
	if addr != "" && addr != "0.0.0.0" && addr != "127.0.0.1" && addr != "::" && addr != "::1" && addr != "localhost" {
		if net.ParseIP(addr) == nil {
			return fmt.Errorf("invalid bind IP address %q", route.BindAddress)
		}
	}

	if iface := strings.TrimSpace(route.InterfaceName); iface != "" {
		if !safeIfaceNameRe.MatchString(iface) {
			return fmt.Errorf("invalid TUN interface name %q (use letters, digits, '_', '-', '.' up to 32 chars)", route.InterfaceName)
		}
	}

	for _, rawSub := range route.Subnets {
		sub := strings.TrimSpace(rawSub)
		if sub == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(sub); err != nil {
			return fmt.Errorf("invalid target subnet CIDR %q: %w", sub, err)
		}
	}

	if shellMetaRe.MatchString(route.SshTarget) {
		return errors.New("SSH relay target contains disallowed shell metacharacters")
	}
	if shellMetaRe.MatchString(route.ForwardTarget) {
		return errors.New("forward target contains disallowed shell metacharacters")
	}
	if tool == "ssh-forward" && strings.ToLower(strings.TrimSpace(route.ForwardMode)) != "socks" {
		ft := strings.TrimSpace(route.ForwardTarget)
		if ft != "" {
			if _, _, err := net.SplitHostPort(ft); err != nil {
				return fmt.Errorf("invalid 2-step forward target %q (expected host:port): %w", ft, err)
			}
		}
	}

	if shellMetaRe.MatchString(route.ExtraArgs) {
		return errors.New("extra arguments contain disallowed shell metacharacters")
	}

	if bin := strings.TrimSpace(route.BinaryPath); bin != "" && shellMetaRe.MatchString(bin) {
		return errors.New("binary path contains disallowed characters")
	}

	for _, spec := range route.RemoteSpecs {
		s := strings.TrimSpace(spec)
		if s != "" && shellMetaRe.MatchString(s) {
			return fmt.Errorf("remote spec %q contains disallowed characters", spec)
		}
	}

	return nil
}

// ParseSubnetsList parses comma/newline/whitespace-separated CIDR entries and strips blanks.
func ParseSubnetsList(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == ';' || r == ' ' || r == '\t'
	})
	seen := make(map[string]struct{}, len(parts))
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; !exists {
			seen[trimmed] = struct{}{}
			out = append(out, trimmed)
		}
	}
	return out
}

// splitSafeArgs splits extra CLI flags on whitespace while supporting single/double quotes without invoking a shell.
func splitSafeArgs(raw string) []string {
	var args []string
	var cur strings.Builder
	var quote rune
	for _, r := range strings.TrimSpace(raw) {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote = r
		case r == ' ' || r == '\t' || r == '\n' || r == '\r':
			if cur.Len() > 0 {
				args = append(args, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		args = append(args, cur.String())
	}
	return args
}

// BuildPivotArgs returns binary name candidates, direct exec arguments (no shell), and a display command string (F-24).
func BuildPivotArgs(route NetworkRoute) (binCandidates []string, args []string, displayCmd string) {
	tool := NormalizePivotTool(route.Tool)
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

	switch tool {
	case "chisel":
		binCandidates = []string{"chisel", "chisel.exe"}
		args = append(args, "server", "--host", addr, "-p", strconv.Itoa(int(port)))
		if route.Reverse {
			args = append(args, "--reverse")
		}
		args = append(args, "--socks5")
	case "sshuttle":
		binCandidates = []string{"sshuttle"}
		sshTarget := strings.TrimSpace(route.SshTarget)
		if sshTarget == "" {
			sshTarget = "user@jump-host"
		}
		args = append(args, "-r", sshTarget)
		subs := route.Subnets
		if len(subs) == 0 {
			subs = []string{"10.10.20.0/24"}
		}
		for _, sub := range subs {
			if t := strings.TrimSpace(sub); t != "" {
				args = append(args, t)
			}
		}
	case "ssh-forward":
		binCandidates = []string{"ssh", "ssh.exe"}
		bindHost := addr
		if bindHost == "0.0.0.0" || bindHost == "::" {
			bindHost = "127.0.0.1"
		}
		sshTarget := strings.TrimSpace(route.SshTarget)
		if sshTarget == "" {
			sshTarget = "user@relay-host"
		}
		if strings.ToLower(strings.TrimSpace(route.ForwardMode)) == "socks" {
			args = append(args, "-N", "-D", net.JoinHostPort(bindHost, strconv.Itoa(int(port))), sshTarget)
		} else {
			fwdTarget := strings.TrimSpace(route.ForwardTarget)
			if fwdTarget == "" {
				fwdTarget = "10.10.20.10:3389"
			}
			args = append(args, "-N", "-L", fmt.Sprintf("%s:%d:%s", bindHost, port, fwdTarget), sshTarget)
		}
	default: // "ligolo-ng"
		binCandidates = []string{"ligolo-proxy", "proxy", "ligolo-ng", "ligolo-proxy.exe", "proxy.exe"}
		args = append(args, "-laddr", net.JoinHostPort(addr, strconv.Itoa(int(port))))
		if route.SelfCert || !strings.Contains(route.ExtraArgs, "-autocert") && !strings.Contains(route.ExtraArgs, "-certfile") {
			args = append(args, "-selfcert")
		}
	}

	if extra := splitSafeArgs(route.ExtraArgs); len(extra) > 0 {
		args = append(args, extra...)
	}

	binDisplay := binCandidates[0]
	if custom := strings.TrimSpace(route.BinaryPath); custom != "" {
		binDisplay = custom
	}
	displayParts := make([]string, 0, len(args)+1)
	displayParts = append(displayParts, binDisplay)
	displayParts = append(displayParts, args...)
	displayCmd = strings.Join(displayParts, " ")
	return binCandidates, args, displayCmd
}

// BuildPivotCommandSet produces complete operator host setup, target agent invocation, and proxychains snippets (F-24).
func BuildPivotCommandSet(route NetworkRoute, lhost string) PivotCommandSet {
	tool := NormalizePivotTool(route.Tool)
	host := strings.TrimSpace(lhost)
	if host == "" {
		if route.BindAddress != "" && route.BindAddress != "0.0.0.0" && route.BindAddress != "::" {
			host = route.BindAddress
		} else {
			host = "<LHOST>"
		}
	}

	port := route.ListenPort
	if port == 0 {
		if tool == "chisel" {
			port = 8443
		} else {
			port = 11601
		}
	}

	_, _, proxyCmd := BuildPivotArgs(route)
	warnings := AnalyzePivotOpsec(route)

	if tool == "sshuttle" {
		sshTarget := strings.TrimSpace(route.SshTarget)
		if sshTarget == "" {
			sshTarget = "user@jump-host"
		}
		subs := make([]string, 0, len(route.Subnets))
		for _, sub := range route.Subnets {
			if t := strings.TrimSpace(sub); t != "" {
				subs = append(subs, t)
			}
		}
		if len(subs) == 0 {
			subs = append(subs, "10.10.20.0/24")
		}
		subsJoined := strings.Join(subs, " ")
		return PivotCommandSet{
			Tool:         "sshuttle",
			LHOST:        host,
			ProxyCommand: proxyCmd,
			SetupCommands: []string{
				"# No target binary upload needed — requires Python 3 on the SSH jump host",
				fmt.Sprintf("ssh %s python3 --version", sshTarget),
			},
			RouteCommands: []string{
				fmt.Sprintf("nmap -sT -Pn %s", subs[0]),
			},
			ConsoleCommands: []string{},
			LinuxAgentCmd:   fmt.Sprintf("sshuttle -r %s %s --dns", sshTarget, subsJoined),
			WindowsAgentCmd: fmt.Sprintf("wsl sshuttle -r %s %s --dns", sshTarget, subsJoined),
			OpsecWarnings:   warnings,
		}
	}

	if tool == "ssh-forward" {
		bindHost := strings.TrimSpace(route.BindAddress)
		if bindHost == "" || bindHost == "0.0.0.0" || bindHost == "::" {
			bindHost = "127.0.0.1"
		}
		localPort := route.ListenPort
		if localPort == 0 {
			localPort = 1080
		}
		sshTarget := strings.TrimSpace(route.SshTarget)
		if sshTarget == "" {
			sshTarget = "user@relay-host"
		}
		isSocks := strings.ToLower(strings.TrimSpace(route.ForwardMode)) == "socks"
		fwdTarget := strings.TrimSpace(route.ForwardTarget)
		if fwdTarget == "" {
			fwdTarget = "10.10.20.10:3389"
		}

		var cliCmd string
		var proxychainsLine string
		var routeCmds []string
		if isSocks {
			cliCmd = fmt.Sprintf("ssh -N -D %s:%d %s", bindHost, localPort, sshTarget)
			proxychainsLine = fmt.Sprintf("socks5 %s %d", bindHost, localPort)
			sub := "10.10.20.0/24"
			if len(route.Subnets) > 0 && strings.TrimSpace(route.Subnets[0]) != "" {
				sub = strings.TrimSpace(route.Subnets[0])
			}
			routeCmds = []string{
				fmt.Sprintf("proxychains4 -q nmap -sT -Pn %s", sub),
			}
		} else {
			cliCmd = fmt.Sprintf("ssh -N -L %s:%d:%s %s", bindHost, localPort, fwdTarget, sshTarget)
			routeCmds = []string{
				fmt.Sprintf("# Connect directly to %s:%d -> forwarded via %s to %s", bindHost, localPort, sshTarget, fwdTarget),
			}
		}

		return PivotCommandSet{
			Tool:            "ssh-forward",
			LHOST:           host,
			ProxyCommand:    proxyCmd,
			SetupCommands:   []string{"# Pure-Go native SSH forwarding inside DoubleAgent (no external pivot binary required on target)"},
			RouteCommands:   routeCmds,
			ConsoleCommands: []string{},
			LinuxAgentCmd:   cliCmd,
			WindowsAgentCmd: cliCmd,
			ProxychainsLine: proxychainsLine,
			OpsecWarnings:   warnings,
		}
	}

	if tool == "chisel" {
		socksPort := route.SocksPort
		if socksPort == 0 {
			socksPort = 1080
		}
		specs := make([]string, 0, len(route.RemoteSpecs)+1)
		for _, sp := range route.RemoteSpecs {
			if t := strings.TrimSpace(sp); t != "" {
				specs = append(specs, t)
			}
		}
		if len(specs) == 0 {
			if socksPort == 1080 {
				specs = append(specs, "R:socks")
			} else {
				specs = append(specs, fmt.Sprintf("R:%d:socks", socksPort))
			}
		}
		specJoined := strings.Join(specs, " ")
		targetEndpoint := net.JoinHostPort(host, strconv.Itoa(int(port)))
		if strings.HasPrefix(host, "<") {
			targetEndpoint = fmt.Sprintf("%s:%d", host, port)
		}

		setupCmds := []string{
			proxyCmd,
			fmt.Sprintf("# Verify local SOCKS5 relay on 127.0.0.1:%d once client connects", socksPort),
		}
		var routeCmds []string
		for _, sub := range route.Subnets {
			trimmed := strings.TrimSpace(sub)
			if trimmed != "" {
				routeCmds = append(routeCmds, fmt.Sprintf("proxychains4 -q nmap -sT -Pn %s", trimmed))
			}
		}

		return PivotCommandSet{
			Tool:            "chisel",
			LHOST:           host,
			ProxyCommand:    proxyCmd,
			SetupCommands:   setupCmds,
			RouteCommands:   routeCmds,
			ConsoleCommands: []string{},
			LinuxAgentCmd:   fmt.Sprintf("./chisel client %s %s", targetEndpoint, specJoined),
			WindowsAgentCmd: fmt.Sprintf(`.\chisel.exe client %s %s`, targetEndpoint, specJoined),
			ProxychainsLine: fmt.Sprintf("socks5 127.0.0.1 %d", socksPort),
			OpsecWarnings:   warnings,
		}
	}

	// ligolo-ng command set
	iface := strings.TrimSpace(route.InterfaceName)
	if iface == "" {
		iface = "ligolo"
	}

	setupCmds := []string{
		fmt.Sprintf("sudo ip tuntap add user $USER mode tun %s", iface),
		fmt.Sprintf("sudo ip link set %s up", iface),
		fmt.Sprintf("# Inside ligolo-proxy interactive console: interface_create --name %s", iface),
	}

	var routeCmds []string
	for _, sub := range route.Subnets {
		trimmed := strings.TrimSpace(sub)
		if trimmed != "" {
			routeCmds = append(routeCmds, fmt.Sprintf("sudo ip route add %s dev %s", trimmed, iface))
		}
	}
	if len(routeCmds) == 0 {
		routeCmds = append(routeCmds, fmt.Sprintf("sudo ip route add 10.10.20.0/24 dev %s", iface))
	}

	consoleCmds := []string{
		"session",
		"ifconfig",
		fmt.Sprintf("start --tun %s", iface),
	}

	targetEndpoint := net.JoinHostPort(host, strconv.Itoa(int(port)))
	if strings.HasPrefix(host, "<") {
		targetEndpoint = fmt.Sprintf("%s:%d", host, port)
	}
	ignoreFlag := ""
	if route.IgnoreCert || route.SelfCert {
		ignoreFlag = " -ignore-cert"
	}

	return PivotCommandSet{
		Tool:            "ligolo-ng",
		LHOST:           host,
		ProxyCommand:    proxyCmd,
		SetupCommands:   setupCmds,
		RouteCommands:   routeCmds,
		ConsoleCommands: consoleCmds,
		LinuxAgentCmd:   fmt.Sprintf("./agent -connect %s%s", targetEndpoint, ignoreFlag),
		WindowsAgentCmd: fmt.Sprintf(`.\agent.exe -connect %s%s`, targetEndpoint, ignoreFlag),
		OpsecWarnings:   warnings,
	}
}

// AnalyzePivotOpsec evaluates OPSEC & connectivity pitfalls for a pivot configuration (F-24, Spec Section 4).
func AnalyzePivotOpsec(route NetworkRoute) []string {
	var warnings []string
	tool := NormalizePivotTool(route.Tool)

	if tool == "sshuttle" {
		if strings.TrimSpace(route.SshTarget) == "" {
			warnings = append(warnings, "Specify the reachable SSH jump target (e.g. user@10.10.14.5) to run sshuttle.")
		}
		if len(route.Subnets) == 0 {
			warnings = append(warnings, "Add at least one internal CIDR subnet (e.g. 10.10.20.0/24) to route through sshuttle.")
		}
		return warnings
	}

	if tool == "ssh-forward" {
		if strings.TrimSpace(route.BindAddress) == "" || route.BindAddress == "0.0.0.0" {
			warnings = append(warnings, "Recommend binding local forward listener to 127.0.0.1 unless LAN clients need access.")
		}
		return warnings
	}

	if route.ListenPort == 4444 || route.ListenPort == 1337 || route.ListenPort == 31337 {
		warnings = append(warnings, fmt.Sprintf("Port %d is a common signatured CTF/offsec port; prefer 443, 8443, or 11601 with TLS.", route.ListenPort))
	}

	addr := strings.TrimSpace(route.BindAddress)
	if addr == "127.0.0.1" || addr == "::1" || strings.EqualFold(addr, "localhost") {
		warnings = append(warnings, "Proxy is bound to loopback (127.0.0.1); remote pivot agents cannot reach it without an SSH remote forward (-R).")
	} else if addr == "" || addr == "0.0.0.0" || addr == "::" {
		warnings = append(warnings, "Bound to 0.0.0.0 (all interfaces). Bind explicitly to your VPN/tun IP in untrusted networks when possible.")
	}

	if tool == "ligolo-ng" && (route.IgnoreCert || route.SelfCert) {
		warnings = append(warnings, "Using -selfcert / -ignore-cert skips agent TLS certificate pinning against MITM; acceptable in lab/authorized tests only.")
	}

	if tool == "chisel" && !strings.Contains(route.ExtraArgs, "--auth") && !strings.Contains(route.ExtraArgs, "--tls") {
		warnings = append(warnings, "Chisel HTTP/WebSocket tunnel runs without --auth credentials configured.")
	}

	if tool == "ligolo-ng" && len(route.Subnets) == 0 {
		warnings = append(warnings, "No target CIDR subnets specified yet; add internal CIDRs (e.g. 10.10.20.0/24) to generate TUN routing rules.")
	}

	return warnings
}

// DefaultBuiltinNetworkRoutes returns starter pivot configurations for quick deployment (F-24).
func DefaultBuiltinNetworkRoutes() []NetworkRoute {
	now := time.Now().UTC().Format(time.RFC3339)
	return []NetworkRoute{
		{
			ID:            "pivot-preset-ligolo-11601",
			Name:          "Ligolo-ng TUN Proxy (Default 11601)",
			Kind:          "ligolo",
			Tool:          "ligolo-ng",
			BindAddress:   "0.0.0.0",
			ListenPort:    11601,
			InterfaceName: "ligolo",
			Subnets:       []string{"10.10.20.0/24"},
			SelfCert:      true,
			IgnoreCert:    true,
			Status:        "configured",
			Notes:         "Standard ligolo-ng v0.7+ L3 TUN pivot relay on port 11601 with self-signed TLS.",
			CreatedAt:     now,
		},
		{
			ID:            "pivot-preset-ligolo-8443",
			Name:          "Ligolo-ng Stealth Alt-HTTPS (8443)",
			Kind:          "ligolo",
			Tool:          "ligolo-ng",
			BindAddress:   "0.0.0.0",
			ListenPort:    8443,
			InterfaceName: "ligolo_DMZ",
			Subnets:       []string{"172.16.10.0/24"},
			SelfCert:      true,
			IgnoreCert:    true,
			Status:        "configured",
			Notes:         "Firewall-friendly HTTPS port 8443 for strict egress environments.",
			CreatedAt:     now,
		},
		{
			ID:          "pivot-preset-chisel-socks",
			Name:        "Chisel Reverse SOCKS5 Relay (8443 -> 1080)",
			Kind:        "chisel",
			Tool:        "chisel",
			BindAddress: "0.0.0.0",
			ListenPort:  8443,
			SocksPort:   1080,
			RemoteSpecs: []string{"R:socks"},
			Reverse:     true,
			Status:      "configured",
			Notes:       "Fast userspace HTTP/WebSocket reverse SOCKS5 pivot when TUN/admin privileges are unavailable.",
			CreatedAt:   now,
		},
		{
			ID:          "pivot-preset-chisel-portfwd",
			Name:        "Chisel Reverse Port Forward (8000 -> 1445)",
			Kind:        "chisel",
			Tool:        "chisel",
			BindAddress: "0.0.0.0",
			ListenPort:  8000,
			SocksPort:   1445,
			RemoteSpecs: []string{"R:1445:10.10.20.10:445"},
			Reverse:     true,
			Subnets:     []string{"10.10.20.0/24"},
			Status:      "configured",
			Notes:       "Forwards remote internal port (e.g. SMB 445) back to operator 127.0.0.1:1445 without proxychains.",
			CreatedAt:   now,
		},
		{
			ID:        "pivot-preset-sshuttle",
			Name:      "sshuttle Agentless VPN Pivot (No Remote Binary)",
			Kind:      "sshuttle",
			Tool:      "sshuttle",
			SshTarget: "user@10.10.20.5",
			Subnets:   []string{"10.10.20.0/24"},
			Status:    "configured",
			Notes:     "Transparent CIDR routing over SSH without uploading ligolo/chisel binaries (requires Python on jump host).",
			CreatedAt: now,
		},
		{
			ID:            "pivot-preset-2step-ssh-forward",
			Name:          "Two-Step Native SSH Target Forward (127.0.0.1:3389 -> Internal)",
			Kind:          "ssh-forward",
			Tool:          "ssh-forward",
			BindAddress:   "127.0.0.1",
			ListenPort:    3389,
			ForwardMode:   "local",
			ForwardTarget: "10.10.20.10:3389",
			SshTarget:     "user@relay-host",
			Subnets:       []string{"10.10.20.0/24"},
			Status:        "configured",
			Notes:         "Uses an existing reachable SSH host as a relay to reach an internal target port via pure Go x/crypto/ssh.",
			CreatedAt:     now,
		},
	}
}
