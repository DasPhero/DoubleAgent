package core

import (
	"strings"
	"testing"
)

func TestNormalizeRouteCheckRequest_F38(t *testing.T) {
	// Default passive mode clamps bounds safely.
	req, err := NormalizeRouteCheckRequest(RouteCheckRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.CheckMode != RouteCheckModePassive {
		t.Fatalf("expected passive default mode, got %q", req.CheckMode)
	}
	if req.ThrottleMs != DefaultHealthThrottleMs || req.TimeoutMs != DefaultHealthTimeoutMs {
		t.Fatalf("unexpected default timings: throttle=%d timeout=%d", req.ThrottleMs, req.TimeoutMs)
	}

	// Minimum throttle floor enforced (200ms).
	req, err = NormalizeRouteCheckRequest(RouteCheckRequest{
		CheckMode:            RouteCheckModeThrottled,
		ThrottleMs:           10,
		TimeoutMs:            50,
		SocksProxyAddr:       "socks5://127.0.0.1:1080",
		CustomTargets:        []string{"10.10.20.10:445, 10.10.20.10:445", "10.10.20.11:3389"},
		ConfirmActiveTraffic: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.ThrottleMs != MinHealthThrottleMs {
		t.Fatalf("expected min throttle %dms, got %d", MinHealthThrottleMs, req.ThrottleMs)
	}
	if req.TimeoutMs != MinHealthTimeoutMs {
		t.Fatalf("expected min timeout %dms, got %d", MinHealthTimeoutMs, req.TimeoutMs)
	}
	if req.SocksProxyAddr != "127.0.0.1:1080" {
		t.Fatalf("expected normalized SOCKS proxy 127.0.0.1:1080, got %q", req.SocksProxyAddr)
	}
	if len(req.CustomTargets) != 2 {
		t.Fatalf("expected deduplicated 2 targets, got %v", req.CustomTargets)
	}

	// Unconfirmed active probes must be rejected.
	if _, err := NormalizeRouteCheckRequest(RouteCheckRequest{
		CheckMode:            RouteCheckModeThrottled,
		CustomTargets:        []string{"10.10.20.10:445"},
		ConfirmActiveTraffic: false,
	}); err == nil {
		t.Fatal("expected error when active probe traffic is not explicitly confirmed")
	}
}

func TestParseProbeTargets_F38(t *testing.T) {
	if _, err := ParseProbeTargets([]string{"10.10.20.10"}); err == nil {
		t.Fatal("expected error for missing port")
	}
	if _, err := ParseProbeTargets([]string{"10.10.20.10:99999"}); err == nil {
		t.Fatal("expected error for out-of-range port")
	}
	if _, err := ParseProbeTargets([]string{"10.10.20.10:80;whoami"}); err == nil {
		t.Fatal("expected error for shell metacharacters")
	}

	tooMany := make([]string, 0, MaxHealthProbeTargetCount+2)
	for i := 1; i <= MaxHealthProbeTargetCount+1; i++ {
		tooMany = append(tooMany, "10.10.20.10:"+string(rune('0'+(i%9)+1))+"0")
	}
	// Construct 26 distinct valid targets.
	distinct := make([]string, 0, 26)
	for i := 1; i <= 26; i++ {
		distinct = append(distinct, "10.10.20."+strconvItoa(i)+":445")
	}
	if _, err := ParseProbeTargets(distinct); err == nil {
		t.Fatalf("expected error exceeding max %d probe targets", MaxHealthProbeTargetCount)
	}
}

func strconvItoa(v int) string {
	if v == 0 {
		return "0"
	}
	var buf [12]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}

func TestAnalyzeRouteHealthOpsec_F38(t *testing.T) {
	passiveWarnings := AnalyzeRouteHealthOpsec(RouteCheckRequest{CheckMode: RouteCheckModePassive}, nil)
	if len(passiveWarnings) == 0 || !strings.Contains(strings.ToLower(passiveWarnings[0]), "zero probe packets") {
		t.Fatalf("expected passive zero-traffic note, got %v", passiveWarnings)
	}

	activeWarnings := AnalyzeRouteHealthOpsec(
		RouteCheckRequest{
			CheckMode:     RouteCheckModeThrottled,
			ThrottleMs:    400,
			CustomTargets: []string{"10.10.20.10:445"},
		},
		[]RouteHealthEntry{
			{Kind: "ligolo-ng", RuntimeState: "running"},
		},
	)
	joined := strings.ToLower(strings.Join(activeWarnings, " "))
	if !strings.Contains(joined, "400ms") || !strings.Contains(joined, "without an active agent session") {
		t.Fatalf("expected throttle + missing ligolo agent warnings, got %v", activeWarnings)
	}
}
