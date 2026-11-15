package core

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
)

const (
	RouteCheckModePassive     = "local_only"
	RouteCheckModeThrottled   = "throttled_tcp"
	DefaultHealthThrottleMs   = 400
	MinHealthThrottleMs       = 200
	MaxHealthThrottleMs       = 10000
	DefaultHealthTimeoutMs    = 1500
	MinHealthTimeoutMs        = 250
	MaxHealthTimeoutMs        = 10000
	MaxHealthProbeTargetCount = 25
)

// RouteCheckRequest configures an on-demand, user-triggered F-38 route & tunnel health check.
type RouteCheckRequest struct {
	RouteIDs             []string `json:"routeIds,omitempty"`
	EngagementID         string   `json:"engagementId,omitempty"`
	CheckMode            string   `json:"checkMode"`                      // "local_only" | "throttled_tcp"
	SocksProxyAddr       string   `json:"socksProxyAddr,omitempty"`       // e.g. "127.0.0.1:1080" for -D / chisel SOCKS5
	CustomTargets        []string `json:"customTargets,omitempty"`        // e.g. ["10.10.20.10:445", "10.10.20.10:3389"]
	ThrottleMs           int      `json:"throttleMs"`                     // Sequential delay between probes (>= 200ms)
	TimeoutMs            int      `json:"timeoutMs"`                      // Per-probe TCP dial timeout
	ConfirmActiveTraffic bool     `json:"confirmActiveTraffic,omitempty"` // Explicit operator ack required for remote probes
}

// ProbeTargetResult captures the outcome of a single local socket, SOCKS5 handshake, or TCP connect probe.
type ProbeTargetResult struct {
	RouteID   string `json:"routeId,omitempty"`
	RouteName string `json:"routeName,omitempty"`
	RouteKind string `json:"routeKind,omitempty"`
	Target    string `json:"target"`
	ViaProxy  string `json:"viaProxy,omitempty"`
	Status    string `json:"status"` // "healthy", "refused", "timeout", "error", "skipped"
	Reachable bool   `json:"reachable"`
	LatencyMs int64  `json:"latencyMs"`
	Detail    string `json:"detail"`
	CheckedAt string `json:"checkedAt"`
}

// RouteHealthEntry summarizes runtime + probe health for one route, pivot, tunnel, or proxy profile.
type RouteHealthEntry struct {
	ID               string              `json:"id"`
	SourceType       string              `json:"sourceType"` // "pivot", "ssh-tunnel", "forward-rule", "proxy-profile", "custom"
	Name             string              `json:"name"`
	Kind             string              `json:"kind"` // "ligolo-ng", "chisel", "L", "R", "D", "socks5", etc.
	BindEndpoint     string              `json:"bindEndpoint,omitempty"`
	TargetEndpoint   string              `json:"targetEndpoint,omitempty"`
	Subnets          []string            `json:"subnets,omitempty"`
	Hops             []string            `json:"hops,omitempty"`
	Status           string              `json:"status"`       // "healthy", "degraded", "down", "idle", "error"
	RuntimeState     string              `json:"runtimeState"` // "running", "active", "stopped", "configured", "error"
	LigoloAgents     []string            `json:"ligoloAgents,omitempty"`
	BytesTransferred int64               `json:"bytesTransferred,omitempty"`
	ErrorMsg         string              `json:"errorMsg,omitempty"`
	Probes           []ProbeTargetResult `json:"probes,omitempty"`
	LastCheck        string              `json:"lastCheck"`
}

// RouteHealthReport is returned after a manual F-38 route health check finishes.
type RouteHealthReport struct {
	ReportID        string             `json:"reportId"`
	CheckedAt       string             `json:"checkedAt"`
	CheckMode       string             `json:"checkMode"`
	SocksProxyAddr  string             `json:"socksProxyAddr,omitempty"`
	ThrottleMs      int                `json:"throttleMs"`
	TimeoutMs       int                `json:"timeoutMs"`
	TotalRoutes     int                `json:"totalRoutes"`
	HealthyRoutes   int                `json:"healthyRoutes"`
	DegradedRoutes  int                `json:"degradedRoutes"`
	DownRoutes      int                `json:"downRoutes"`
	ProbesExecuted  int                `json:"probesExecuted"`
	ProbesSucceeded int                `json:"probesSucceeded"`
	DurationMs      int64              `json:"durationMs"`
	Entries         []RouteHealthEntry `json:"entries"`
	OpsecWarnings   []string           `json:"opsecWarnings,omitempty"`
}

// ParseProbeTargets splits and validates host:port targets for throttled TCP connect probing.
// Caps target count at MaxHealthProbeTargetCount (25) to prevent accidental high-volume scans (Spec Section 4).
func ParseProbeTargets(lines []string) ([]string, error) {
	seen := make(map[string]struct{})
	parsed := make([]string, 0, len(lines))

	for _, rawLine := range lines {
		fields := strings.FieldsFunc(rawLine, func(r rune) bool {
			return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
		})
		for _, candidate := range fields {
			token := strings.TrimSpace(candidate)
			if token == "" {
				continue
			}
			if shellMetaRe.MatchString(token) {
				return nil, fmt.Errorf("probe target %q contains disallowed characters", token)
			}
			host, portStr, err := net.SplitHostPort(token)
			if err != nil {
				return nil, fmt.Errorf("invalid probe target %q (expected host:port): %w", token, err)
			}
			host = strings.TrimSpace(host)
			if host == "" {
				return nil, fmt.Errorf("probe target %q has an empty host", token)
			}
			portNum, err := strconv.Atoi(portStr)
			if err != nil || portNum < 1 || portNum > 65535 {
				return nil, fmt.Errorf("probe target %q has invalid port %q", token, portStr)
			}
			normalized := net.JoinHostPort(host, strconv.Itoa(portNum))
			if _, exists := seen[normalized]; exists {
				continue
			}
			seen[normalized] = struct{}{}
			parsed = append(parsed, normalized)
			if len(parsed) > MaxHealthProbeTargetCount {
				return nil, fmt.Errorf("too many probe targets (max %d per OPSEC-throttled check)", MaxHealthProbeTargetCount)
			}
		}
	}
	return parsed, nil
}

// ValidateSocksProxyAddr verifies an optional SOCKS5 proxy address as host:port.
func ValidateSocksProxyAddr(addr string) (string, error) {
	trimmed := strings.TrimSpace(addr)
	if trimmed == "" {
		return "", nil
	}
	trimmed = strings.TrimPrefix(trimmed, "socks5://")
	trimmed = strings.TrimPrefix(trimmed, "socks5h://")
	if shellMetaRe.MatchString(trimmed) {
		return "", fmt.Errorf("SOCKS proxy address %q contains disallowed characters", addr)
	}
	host, portStr, err := net.SplitHostPort(trimmed)
	if err != nil {
		return "", fmt.Errorf("invalid SOCKS5 proxy address %q (expected host:port): %w", addr, err)
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return "", fmt.Errorf("SOCKS5 proxy address %q has empty host", addr)
	}
	portNum, err := strconv.Atoi(portStr)
	if err != nil || portNum < 1 || portNum > 65535 {
		return "", fmt.Errorf("SOCKS5 proxy address %q has invalid port %q", addr, portStr)
	}
	return net.JoinHostPort(host, strconv.Itoa(portNum)), nil
}

// NormalizeRouteCheckRequest validates and applies OPSEC-safe defaults and bounds to a health check request.
func NormalizeRouteCheckRequest(req RouteCheckRequest) (RouteCheckRequest, error) {
	mode := strings.ToLower(strings.TrimSpace(req.CheckMode))
	switch mode {
	case "", RouteCheckModePassive:
		mode = RouteCheckModePassive
	case RouteCheckModeThrottled, "active", "tcp":
		mode = RouteCheckModeThrottled
	default:
		return req, fmt.Errorf("unsupported check mode %q (use local_only or throttled_tcp)", req.CheckMode)
	}
	req.CheckMode = mode

	if req.ThrottleMs <= 0 {
		req.ThrottleMs = DefaultHealthThrottleMs
	} else if req.ThrottleMs < MinHealthThrottleMs {
		req.ThrottleMs = MinHealthThrottleMs
	} else if req.ThrottleMs > MaxHealthThrottleMs {
		req.ThrottleMs = MaxHealthThrottleMs
	}

	if req.TimeoutMs <= 0 {
		req.TimeoutMs = DefaultHealthTimeoutMs
	} else if req.TimeoutMs < MinHealthTimeoutMs {
		req.TimeoutMs = MinHealthTimeoutMs
	} else if req.TimeoutMs > MaxHealthTimeoutMs {
		req.TimeoutMs = MaxHealthTimeoutMs
	}

	proxyAddr, err := ValidateSocksProxyAddr(req.SocksProxyAddr)
	if err != nil {
		return req, err
	}
	req.SocksProxyAddr = proxyAddr

	targets, err := ParseProbeTargets(req.CustomTargets)
	if err != nil {
		return req, err
	}
	req.CustomTargets = targets

	if req.CheckMode == RouteCheckModeThrottled && len(req.CustomTargets) > 0 && !req.ConfirmActiveTraffic {
		return req, errors.New("explicit operator confirmation is required before sending throttled TCP connect probes to target hosts")
	}

	return req, nil
}

// AnalyzeRouteHealthOpsec evaluates the health check parameters and results for OPSEC advisories.
func AnalyzeRouteHealthOpsec(req RouteCheckRequest, entries []RouteHealthEntry) []string {
	warnings := make([]string, 0, 5)

	if req.CheckMode == RouteCheckModePassive {
		warnings = append(warnings,
			"Passive local inspection mode: zero probe packets sent to remote targets; only local tunnel sockets, SOCKS5 handshakes, and pivot sessions were checked.")
	} else {
		warnings = append(warnings,
			fmt.Sprintf("Throttled TCP connect mode active: sequential single-threaded probes with %dms delay between connections.", req.ThrottleMs))
		if len(req.CustomTargets) == 0 {
			warnings = append(warnings,
				"No custom host:port targets supplied — only active route endpoints and local forwards were tested.")
		}
		if req.SocksProxyAddr == "" && len(req.CustomTargets) > 0 {
			hasLigolo := false
			for _, e := range entries {
				if strings.Contains(strings.ToLower(e.Kind), "ligolo") && e.RuntimeState == "running" {
					hasLigolo = true
					break
				}
			}
			if !hasLigolo {
				warnings = append(warnings,
					"No SOCKS5 proxy selected and no running ligolo-ng TUN detected: custom TCP probes dial directly from the local routing table.")
			}
		}
	}

	waitingLigolo := false
	for _, e := range entries {
		if strings.Contains(strings.ToLower(e.Kind), "ligolo") && e.RuntimeState == "running" && len(e.LigoloAgents) == 0 {
			waitingLigolo = true
			break
		}
	}
	if waitingLigolo {
		warnings = append(warnings,
			"At least one ligolo-ng proxy is running without an active agent session yet — subnet traffic cannot traverse until an agent joins and TUN starts.")
	}

	return warnings
}
