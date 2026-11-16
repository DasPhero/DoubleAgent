package health

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestRunCheck_PassiveAndLigoloSessions_F38(t *testing.T) {
	mockDial := func(_ context.Context, _ string, addr string) (net.Conn, error) {
		if addr != "127.0.0.1:11601" {
			return nil, errors.New("connection refused")
		}
		client, server := net.Pipe()
		go func() { _ = server.Close() }()
		return client, nil
	}

	snap := Snapshot{
		DialContext: mockDial,
		Routes: []core.NetworkRoute{
			{
				ID:          "rt-ligolo-ready",
				Name:        "Corp Internal Ligolo",
				Tool:        "ligolo-ng",
				BindAddress: "127.0.0.1",
				ListenPort:  11601,
				Subnets:     []string{"10.10.20.0/24"},
			},
			{
				ID:          "rt-ligolo-wait",
				Name:        "DMZ Waiting Agent",
				Tool:        "ligolo-ng",
				BindAddress: "127.0.0.1",
				ListenPort:  11601,
			},
		},
		ActivePivots: []core.PivotInstanceInfo{
			{
				ID:              "piv-1",
				RouteID:         "rt-ligolo-ready",
				Name:            "Corp Internal Ligolo",
				Tool:            "ligolo-ng",
				BindAddress:     "127.0.0.1",
				ListenPort:      11601,
				Status:          "running",
				ConnectedAgents: []string{"Agent joined: CORP\\DC01"},
			},
			{
				ID:              "piv-2",
				RouteID:         "rt-ligolo-wait",
				Name:            "DMZ Waiting Agent",
				Tool:            "ligolo-ng",
				BindAddress:     "127.0.0.1",
				ListenPort:      11601,
				Status:          "running",
				ConnectedAgents: nil,
			},
		},
	}

	report, err := RunCheck(context.Background(), core.RouteCheckRequest{
		CheckMode: core.RouteCheckModePassive,
	}, snap)
	if err != nil {
		t.Fatalf("RunCheck failed: %v", err)
	}
	if report.TotalRoutes != 2 || report.HealthyRoutes != 1 || report.DegradedRoutes != 1 {
		t.Fatalf("unexpected counts: total=%d healthy=%d degraded=%d entries=%+v", report.TotalRoutes, report.HealthyRoutes, report.DegradedRoutes, report.Entries)
	}
}

func TestRunCheck_ThrottledTCPAndSocks5_F38(t *testing.T) {
	const (
		socksAddr  = "127.0.0.1:1080"
		openTarget = "10.10.20.10:445"
		closedPort = "10.10.20.10:3389"
	)

	mockDial := func(_ context.Context, _ string, addr string) (net.Conn, error) {
		if addr != socksAddr {
			return nil, errors.New("connection refused")
		}
		client, server := net.Pipe()
		go handleMockSocks5Pipe(server, openTarget)
		return client, nil
	}

	snap := Snapshot{
		DialContext: mockDial,
		ForwardRules: []core.ForwardRule{
			{
				ID:          "rule-socks",
				Label:       "Dynamic Jump",
				Type:        core.ForwardDynamic,
				BindAddress: "127.0.0.1",
				BindPort:    1080,
			},
		},
		ActiveTunnels: []core.ForwardTunnelStatus{
			{
				ID:          "tun-socks",
				RuleID:      "rule-socks",
				Type:        core.ForwardDynamic,
				BindAddress: "127.0.0.1",
				BindPort:    1080,
				Status:      "active",
			},
		},
	}

	start := time.Now()
	report, err := RunCheck(context.Background(), core.RouteCheckRequest{
		CheckMode:            core.RouteCheckModeThrottled,
		SocksProxyAddr:       socksAddr,
		CustomTargets:        []string{openTarget, closedPort},
		ThrottleMs:           200,
		TimeoutMs:            1000,
		ConfirmActiveTraffic: true,
	}, snap)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("throttled check failed: %v", err)
	}

	// 1 route probe (-D) + 2 custom targets = 3 probes => at least 2 throttle intervals (~400ms)
	if elapsed < 350*time.Millisecond {
		t.Fatalf("expected throttled sequential execution >= 350ms, finished in %v", elapsed)
	}

	if report.TotalRoutes != 2 {
		t.Fatalf("expected 2 entries (-D rule + custom probes), got %d", report.TotalRoutes)
	}
	if report.HealthyRoutes != 1 || report.DegradedRoutes != 1 {
		t.Fatalf("expected 1 healthy (-D SOCKS5) and 1 degraded (1 ok, 1 refused), got healthy=%d degraded=%d entries=%+v", report.HealthyRoutes, report.DegradedRoutes, report.Entries)
	}

	custom := report.Entries[1]
	if len(custom.Probes) != 2 || !custom.Probes[0].Reachable || custom.Probes[1].Reachable {
		t.Fatalf("unexpected custom probe outcomes: %+v", custom.Probes)
	}
	if custom.Probes[1].Status != "refused" {
		t.Fatalf("expected refused status for closed SOCKS5 target, got %q (%s)", custom.Probes[1].Status, custom.Probes[1].Detail)
	}
}

func handleMockSocks5Pipe(c net.Conn, allowTarget string) {
	defer func() { _ = c.Close() }()
	buf := make([]byte, 3)
	if _, err := io.ReadFull(c, buf); err != nil {
		return
	}
	_, _ = c.Write([]byte{0x05, 0x00})

	// Next read is either closed (greeting-only check) or a SOCKS5 CONNECT frame.
	hdr := make([]byte, 4)
	if _, err := io.ReadFull(c, hdr); err != nil {
		return
	}
	var host string
	switch hdr[3] {
	case 0x01:
		ip := make([]byte, 4)
		_, _ = io.ReadFull(c, ip)
		host = net.IP(ip).String()
	case 0x03:
		l := make([]byte, 1)
		_, _ = io.ReadFull(c, l)
		dom := make([]byte, l[0])
		_, _ = io.ReadFull(c, dom)
		host = string(dom)
	default:
		_, _ = c.Write([]byte{0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	pbuf := make([]byte, 2)
	_, _ = io.ReadFull(c, pbuf)
	port := binary.BigEndian.Uint16(pbuf)

	if net.JoinHostPort(host, strconv.Itoa(int(port))) == allowTarget {
		_, _ = c.Write([]byte{0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0})
	} else {
		_, _ = c.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
	}
}

func TestRunCheck_IncludesActiveShellListenersAndFileServers_F38(t *testing.T) {
	snap := Snapshot{
		ActiveListeners: []core.ManagedListenerInfo{
			{
				ID:          "lst-4444",
				Name:        "Reverse Catcher",
				Kind:        "reverse",
				Tool:        "rawtcp",
				BindAddress: "0.0.0.0",
				BindPort:    4444,
				Status:      "listening",
				CatchCount:  2,
			},
		},
		ActiveFileServers: []core.FileTransferServerInfo{
			{
				ID:          "srv-8000",
				Name:        "Payload Stage :8000",
				Kind:        "builtin",
				Directory:   "/tmp/tools",
				BindAddress: "127.0.0.1",
				Port:        8000,
				Status:      "running",
				ServedCount: 5,
				UploadCount: 1,
			},
		},
		DialContext: func(_ context.Context, _ string, addr string) (net.Conn, error) {
			c1, c2 := net.Pipe()
			_ = c2.Close()
			return c1, nil
		},
	}

	report, err := RunCheck(context.Background(), core.RouteCheckRequest{
		CheckMode: core.RouteCheckModePassive,
	}, snap)
	if err != nil {
		t.Fatalf("RunCheck failed: %v", err)
	}
	if report.TotalRoutes != 2 || report.HealthyRoutes != 2 {
		t.Fatalf("expected 2 healthy dashboard entries, got %+v", report)
	}
	var sawListener, sawServer bool
	for _, e := range report.Entries {
		if e.SourceType == "shell-listener" && strings.Contains(e.MetaSummary, "Catches: 2") {
			sawListener = true
		}
		if e.SourceType == "transfer-server" && strings.Contains(e.MetaSummary, "Served: 5") {
			sawServer = true
		}
	}
	if !sawListener || !sawServer {
		t.Fatalf("expected both shell-listener and transfer-server entries with telemetry, got %+v", report.Entries)
	}
}
