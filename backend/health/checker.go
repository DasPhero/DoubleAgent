package health

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	"doubleagent/backend/core"
)

// Snapshot aggregates current routes, tunnels, pivots, and proxy profiles for an on-demand health check (F-38).
type Snapshot struct {
	Routes        []core.NetworkRoute
	ActivePivots  []core.PivotInstanceInfo
	ForwardRules  []core.ForwardRule
	ActiveTunnels []core.ForwardTunnelStatus
	ProxyProfiles []core.ProxyProfile
	// DialContext optionally overrides net.Dialer.DialContext (used by sandboxed unit tests; nil uses real TCP sockets).
	DialContext func(ctx context.Context, network, addr string) (net.Conn, error) `json:"-"`
}

func generateReportID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "rhc-" + hex.EncodeToString(b)
}

func includesRoute(filter []string, id string) bool {
	if len(filter) == 0 {
		return true
	}
	for _, f := range filter {
		if f == id {
			return true
		}
	}
	return false
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func localBindHost(bindAddr string) string {
	addr := strings.TrimSpace(bindAddr)
	if addr == "" || addr == "0.0.0.0" || addr == "::" {
		return "127.0.0.1"
	}
	return addr
}

// RunCheck performs a strictly user-triggered, throttled, OPSEC-aware route and tunnel health check (F-38).
// Zero background polling occurs; remote probes only fire when CheckMode == "throttled_tcp" and ConfirmActiveTraffic == true.
func RunCheck(ctx context.Context, rawReq core.RouteCheckRequest, snap Snapshot) (*core.RouteHealthReport, error) {
	req, err := core.NormalizeRouteCheckRequest(rawReq)
	if err != nil {
		return nil, err
	}

	started := time.Now().UTC()
	timeout := time.Duration(req.TimeoutMs) * time.Millisecond
	throttle := time.Duration(req.ThrottleMs) * time.Millisecond

	report := &core.RouteHealthReport{
		ReportID:       generateReportID(),
		CheckedAt:      started.Format(time.RFC3339),
		CheckMode:      req.CheckMode,
		SocksProxyAddr: req.SocksProxyAddr,
		ThrottleMs:     req.ThrottleMs,
		TimeoutMs:      req.TimeoutMs,
		Entries:        make([]core.RouteHealthEntry, 0),
	}

	probesFired := 0
	paceBeforeProbe := func() error {
		if probesFired > 0 {
			if err := sleepWithContext(ctx, throttle); err != nil {
				return err
			}
		}
		probesFired++
		return nil
	}

	dialFn := snap.DialContext
	if dialFn == nil {
		dialFn = func(dctx context.Context, network, addr string) (net.Conn, error) {
			d := net.Dialer{Timeout: timeout}
			return d.DialContext(dctx, network, addr)
		}
	}

	// Index active pivots by routeId and fallback tool:port
	pivotByRoute := make(map[string]core.PivotInstanceInfo)
	pivotMatched := make(map[string]bool)
	for _, p := range snap.ActivePivots {
		if p.RouteID != "" {
			pivotByRoute[p.RouteID] = p
		}
	}

	// 1. Saved NetworkRoutes (ligolo-ng / chisel / etc.)
	for _, route := range snap.Routes {
		if req.EngagementID != "" && route.EngagementID != "" && route.EngagementID != req.EngagementID {
			continue
		}
		if !includesRoute(req.RouteIDs, route.ID) {
			continue
		}

		var live *core.PivotInstanceInfo
		if inst, ok := pivotByRoute[route.ID]; ok {
			copyInst := inst
			live = &copyInst
			pivotMatched[inst.ID] = true
		} else {
			for i := range snap.ActivePivots {
				p := snap.ActivePivots[i]
				if !pivotMatched[p.ID] && core.NormalizePivotTool(p.Tool) == core.NormalizePivotTool(route.Tool) && p.ListenPort == route.ListenPort {
					copyInst := p
					live = &copyInst
					pivotMatched[p.ID] = true
					break
				}
			}
		}

		entry := inspectNetworkRoute(ctx, route, live, timeout, paceBeforeProbe, dialFn)
		report.Entries = append(report.Entries, entry)
	}

	// 1b. Unsaved/ad-hoc running pivot instances
	for _, p := range snap.ActivePivots {
		if pivotMatched[p.ID] {
			continue
		}
		if req.EngagementID != "" && p.EngagementID != "" && p.EngagementID != req.EngagementID {
			continue
		}
		if !includesRoute(req.RouteIDs, p.ID) {
			continue
		}
		synth := core.NetworkRoute{
			ID:            p.ID,
			EngagementID:  p.EngagementID,
			Name:          p.Name,
			Kind:          p.Tool,
			Tool:          p.Tool,
			BindAddress:   p.BindAddress,
			ListenPort:    p.ListenPort,
			SocksPort:     p.SocksPort,
			InterfaceName: p.InterfaceName,
			Subnets:       p.Subnets,
		}
		copyInst := p
		entry := inspectNetworkRoute(ctx, synth, &copyInst, timeout, paceBeforeProbe, dialFn)
		entry.SourceType = "pivot"
		report.Entries = append(report.Entries, entry)
	}

	// 2. SSH ForwardRules + Live ForwardTunnels (-L, -R, -D)
	tunnelByRule := make(map[string]core.ForwardTunnelStatus)
	tunnelMatched := make(map[string]bool)
	for _, tun := range snap.ActiveTunnels {
		if tun.RuleID != "" {
			tunnelByRule[tun.RuleID] = tun
		}
	}

	for _, rule := range snap.ForwardRules {
		if req.EngagementID != "" && rule.EngagementID != "" && rule.EngagementID != req.EngagementID {
			continue
		}
		if !includesRoute(req.RouteIDs, rule.ID) {
			continue
		}
		var live *core.ForwardTunnelStatus
		if t, ok := tunnelByRule[rule.ID]; ok {
			copyT := t
			live = &copyT
			tunnelMatched[t.ID] = true
		}
		entry := inspectForwardRule(ctx, rule, live, timeout, paceBeforeProbe, dialFn)
		report.Entries = append(report.Entries, entry)
	}

	for _, tun := range snap.ActiveTunnels {
		if tunnelMatched[tun.ID] {
			continue
		}
		if !includesRoute(req.RouteIDs, tun.ID) {
			continue
		}
		synthRule := core.ForwardRule{
			ID:          tun.ID,
			Label:       fmt.Sprintf("-%s :%d", tun.Type, tun.BindPort),
			Type:        tun.Type,
			BindAddress: tun.BindAddress,
			BindPort:    tun.BindPort,
			TargetHost:  tun.TargetHost,
			TargetPort:  tun.TargetPort,
		}
		copyT := tun
		entry := inspectForwardRule(ctx, synthRule, &copyT, timeout, paceBeforeProbe, dialFn)
		entry.SourceType = "ssh-tunnel"
		report.Entries = append(report.Entries, entry)
	}

	// 3. Saved ProxyProfiles (SOCKS5 / HTTP)
	for _, prof := range snap.ProxyProfiles {
		if req.EngagementID != "" && prof.EngagementID != "" && prof.EngagementID != req.EngagementID {
			continue
		}
		if !includesRoute(req.RouteIDs, prof.ID) {
			continue
		}
		entry := inspectProxyProfile(ctx, prof, req.CheckMode, timeout, paceBeforeProbe, dialFn)
		report.Entries = append(report.Entries, entry)
	}

	// 4. Explicit Custom TCP Connect Targets (only in throttled_tcp + ConfirmActiveTraffic)
	if req.CheckMode == core.RouteCheckModeThrottled && len(req.CustomTargets) > 0 {
		customEntry := core.RouteHealthEntry{
			ID:           "custom-probes",
			SourceType:   "custom",
			Name:         "Custom Target Reachability Probes",
			Kind:         "tcp-connect",
			RuntimeState: "active",
			Status:       "down",
			LastCheck:    time.Now().UTC().Format(time.RFC3339),
			Probes:       make([]core.ProbeTargetResult, 0, len(req.CustomTargets)),
		}
		if req.SocksProxyAddr != "" {
			customEntry.BindEndpoint = "socks5://" + req.SocksProxyAddr
			customEntry.Kind = "socks5-tcp"
		}
		okCount := 0
		for _, target := range req.CustomTargets {
			if ctx.Err() != nil {
				break
			}
			if err := paceBeforeProbe(); err != nil {
				break
			}
			var res core.ProbeTargetResult
			if req.SocksProxyAddr != "" {
				res = probeViaSocks5(ctx, req.SocksProxyAddr, target, timeout, dialFn)
			} else {
				res = probeDirectTCP(ctx, target, timeout, dialFn)
			}
			res.RouteID = customEntry.ID
			res.RouteName = customEntry.Name
			res.RouteKind = customEntry.Kind
			if res.Reachable {
				okCount++
			}
			customEntry.Probes = append(customEntry.Probes, res)
		}
		switch {
		case okCount == len(customEntry.Probes) && okCount > 0:
			customEntry.Status = "healthy"
		case okCount > 0:
			customEntry.Status = "degraded"
		default:
			customEntry.Status = "down"
		}
		report.Entries = append(report.Entries, customEntry)
	}

	// Summarize counters & OPSEC warnings
	for _, e := range report.Entries {
		switch e.Status {
		case "healthy":
			report.HealthyRoutes++
		case "degraded":
			report.DegradedRoutes++
		case "down", "error":
			report.DownRoutes++
		}
		for _, p := range e.Probes {
			if p.Status != "skipped" {
				report.ProbesExecuted++
				if p.Reachable {
					report.ProbesSucceeded++
				}
			}
		}
	}
	report.TotalRoutes = len(report.Entries)
	report.DurationMs = time.Since(started).Milliseconds()
	report.OpsecWarnings = core.AnalyzeRouteHealthOpsec(req, report.Entries)
	return report, nil
}

func inspectNetworkRoute(
	ctx context.Context,
	route core.NetworkRoute,
	live *core.PivotInstanceInfo,
	timeout time.Duration,
	pace func() error,
	dialFn func(ctx context.Context, network, addr string) (net.Conn, error),
) core.RouteHealthEntry {
	nowStr := time.Now().UTC().Format(time.RFC3339)
	entry := core.RouteHealthEntry{
		ID:           route.ID,
		SourceType:   "pivot",
		Name:         route.Name,
		Kind:         core.NormalizePivotTool(route.Tool),
		BindEndpoint: net.JoinHostPort(localBindHost(route.BindAddress), strconv.Itoa(int(route.ListenPort))),
		Subnets:      append([]string(nil), route.Subnets...),
		Hops:         append([]string(nil), route.Hops...),
		LastCheck:    nowStr,
	}

	if live == nil {
		entry.RuntimeState = "stopped"
		entry.Status = "idle"
		if route.Status == "error" {
			entry.Status = "error"
			entry.RuntimeState = "error"
		}
		return entry
	}

	entry.RuntimeState = live.Status
	entry.ErrorMsg = live.ErrorMsg
	entry.LigoloAgents = append([]string(nil), live.ConnectedAgents...)

	if live.Status == "error" {
		entry.Status = "error"
		return entry
	}
	if live.Status != "running" {
		entry.Status = "down"
		return entry
	}

	// Process is running — verify local listener socket and optional SOCKS5 listener.
	_ = pace()
	listenProbe := probeDirectTCP(ctx, net.JoinHostPort(localBindHost(live.BindAddress), strconv.Itoa(int(live.ListenPort))), timeout, dialFn)
	listenProbe.RouteID = entry.ID
	listenProbe.RouteName = entry.Name
	listenProbe.RouteKind = entry.Kind
	if listenProbe.Reachable {
		listenProbe.Detail = fmt.Sprintf("Pivot listener active (%s)", listenProbe.Detail)
	}
	entry.Probes = append(entry.Probes, listenProbe)

	socksPort := live.SocksPort
	if socksPort == 0 && entry.Kind == "chisel" && containsSocksSpec(route.RemoteSpecs) {
		socksPort = 1080
	}
	if socksPort > 0 && entry.Kind == "chisel" {
		_ = pace()
		socksProbe := probeSocks5Greeting(ctx, net.JoinHostPort("127.0.0.1", strconv.Itoa(int(socksPort))), timeout, dialFn)
		socksProbe.RouteID = entry.ID
		socksProbe.RouteName = entry.Name
		socksProbe.RouteKind = "chisel-socks5"
		entry.Probes = append(entry.Probes, socksProbe)
	}

	if !listenProbe.Reachable {
		entry.Status = "error"
		if entry.ErrorMsg == "" {
			entry.ErrorMsg = listenProbe.Detail
		}
		return entry
	}

	if len(entry.LigoloAgents) == 0 {
		entry.Status = "degraded"
		return entry
	}
	entry.Status = "healthy"
	return entry
}

func containsSocksSpec(specs []string) bool {
	for _, s := range specs {
		if strings.Contains(strings.ToLower(s), "socks") {
			return true
		}
	}
	return false
}

func inspectForwardRule(
	ctx context.Context,
	rule core.ForwardRule,
	live *core.ForwardTunnelStatus,
	timeout time.Duration,
	pace func() error,
	dialFn func(ctx context.Context, network, addr string) (net.Conn, error),
) core.RouteHealthEntry {
	nowStr := time.Now().UTC().Format(time.RFC3339)
	name := rule.Label
	if strings.TrimSpace(name) == "" {
		name = fmt.Sprintf("-%s :%d", rule.Type, rule.BindPort)
	}
	targetEp := ""
	if rule.TargetHost != "" && rule.TargetPort > 0 {
		targetEp = net.JoinHostPort(rule.TargetHost, strconv.Itoa(int(rule.TargetPort)))
	}
	entry := core.RouteHealthEntry{
		ID:             rule.ID,
		SourceType:     "forward-rule",
		Name:           name,
		Kind:           "-" + string(rule.Type),
		BindEndpoint:   net.JoinHostPort(localBindHost(rule.BindAddress), strconv.Itoa(int(rule.BindPort))),
		TargetEndpoint: targetEp,
		LastCheck:      nowStr,
	}

	if live == nil {
		entry.RuntimeState = "stopped"
		entry.Status = "idle"
		return entry
	}

	entry.RuntimeState = live.Status
	entry.BytesTransferred = live.BytesIn + live.BytesOut
	entry.ErrorMsg = live.ErrorMessage

	if live.Status == "error" || live.Status == "closed" {
		entry.Status = "down"
		return entry
	}

	// For local listeners (-L and -D), perform a local loopback socket/SOCKS5 check.
	if rule.Type == core.ForwardDynamic || rule.Type == core.ForwardLocal {
		_ = pace()
		localEp := net.JoinHostPort(localBindHost(live.BindAddress), strconv.Itoa(int(live.BindPort)))
		var probe core.ProbeTargetResult
		if rule.Type == core.ForwardDynamic {
			probe = probeSocks5Greeting(ctx, localEp, timeout, dialFn)
		} else {
			probe = probeDirectTCP(ctx, localEp, timeout, dialFn)
		}
		probe.RouteID = entry.ID
		probe.RouteName = entry.Name
		probe.RouteKind = entry.Kind
		entry.Probes = append(entry.Probes, probe)
		if probe.Reachable {
			entry.Status = "healthy"
		} else {
			entry.Status = "degraded"
		}
		return entry
	}

	// -R listens remotely on the SSH target; active tunnel status indicates health without probing target.
	entry.Status = "healthy"
	return entry
}

func inspectProxyProfile(
	ctx context.Context,
	prof core.ProxyProfile,
	mode string,
	timeout time.Duration,
	pace func() error,
	dialFn func(ctx context.Context, network, addr string) (net.Conn, error),
) core.RouteHealthEntry {
	nowStr := time.Now().UTC().Format(time.RFC3339)
	entry := core.RouteHealthEntry{
		ID:           prof.ID,
		SourceType:   "proxy-profile",
		Name:         prof.Name,
		Kind:         string(prof.Type),
		BindEndpoint: strings.TrimSpace(prof.SocksAddress),
		Hops:         append([]string(nil), prof.JumpHostIDs...),
		RuntimeState: "configured",
		Status:       "idle",
		LastCheck:    nowStr,
	}
	if prof.Type != core.ProxyTypeSocks5 || entry.BindEndpoint == "" {
		return entry
	}

	host, _, err := net.SplitHostPort(entry.BindEndpoint)
	if err != nil {
		return entry
	}
	isLoopback := host == "127.0.0.1" || host == "localhost" || host == "::1"
	if !isLoopback && mode != core.RouteCheckModeThrottled {
		return entry
	}

	_ = pace()
	res := probeSocks5Greeting(ctx, entry.BindEndpoint, timeout, dialFn)
	res.RouteID = entry.ID
	res.RouteName = entry.Name
	res.RouteKind = entry.Kind
	entry.Probes = append(entry.Probes, res)
	if res.Reachable {
		entry.Status = "healthy"
		entry.RuntimeState = "running"
	} else {
		entry.Status = "down"
		entry.RuntimeState = "stopped"
	}
	return entry
}

func probeDirectTCP(ctx context.Context, target string, timeout time.Duration, dialFn func(ctx context.Context, network, addr string) (net.Conn, error)) core.ProbeTargetResult {
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	start := time.Now()
	dctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := dialFn(dctx, "tcp", target)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		status := classifyDialError(err)
		return core.ProbeTargetResult{
			Target:    target,
			Status:    status,
			Reachable: false,
			LatencyMs: latency,
			Detail:    err.Error(),
			CheckedAt: checkedAt,
		}
	}
	_ = conn.Close()
	return core.ProbeTargetResult{
		Target:    target,
		Status:    "healthy",
		Reachable: true,
		LatencyMs: latency,
		Detail:    fmt.Sprintf("TCP connect OK (%dms)", latency),
		CheckedAt: checkedAt,
	}
}

func probeSocks5Greeting(ctx context.Context, addr string, timeout time.Duration, dialFn func(ctx context.Context, network, addr string) (net.Conn, error)) core.ProbeTargetResult {
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	start := time.Now()
	dctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := dialFn(dctx, "tcp", addr)
	if err != nil {
		latency := time.Since(start).Milliseconds()
		return core.ProbeTargetResult{
			Target:    addr,
			Status:    classifyDialError(err),
			Reachable: false,
			LatencyMs: latency,
			Detail:    err.Error(),
			CheckedAt: checkedAt,
		}
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	// SOCKS5 version=5, nmethods=1, method=0x00 (NO AUTH)
	if _, err := conn.Write([]byte{0x05, 0x01, 0x00}); err != nil {
		return core.ProbeTargetResult{
			Target:    addr,
			Status:    "error",
			Reachable: false,
			LatencyMs: time.Since(start).Milliseconds(),
			Detail:    fmt.Sprintf("SOCKS5 greeting write failed: %v", err),
			CheckedAt: checkedAt,
		}
	}
	resp := make([]byte, 2)
	if _, err := io.ReadFull(conn, resp); err != nil {
		return core.ProbeTargetResult{
			Target:    addr,
			Status:    "error",
			Reachable: false,
			LatencyMs: time.Since(start).Milliseconds(),
			Detail:    fmt.Sprintf("SOCKS5 greeting read failed: %v", err),
			CheckedAt: checkedAt,
		}
	}
	latency := time.Since(start).Milliseconds()
	if resp[0] != 0x05 {
		return core.ProbeTargetResult{
			Target:    addr,
			Status:    "error",
			Reachable: false,
			LatencyMs: latency,
			Detail:    fmt.Sprintf("unexpected SOCKS5 version byte 0x%02x", resp[0]),
			CheckedAt: checkedAt,
		}
	}
	return core.ProbeTargetResult{
		Target:    addr,
		Status:    "healthy",
		Reachable: true,
		LatencyMs: latency,
		Detail:    fmt.Sprintf("SOCKS5 handshake OK (%dms)", latency),
		CheckedAt: checkedAt,
	}
}

// probeViaSocks5 performs an RFC 1928 SOCKS5 CONNECT request to target through proxyAddr.
func probeViaSocks5(ctx context.Context, proxyAddr string, target string, timeout time.Duration, dialFn func(ctx context.Context, network, addr string) (net.Conn, error)) core.ProbeTargetResult {
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	start := time.Now()
	via := "socks5://" + proxyAddr

	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		return core.ProbeTargetResult{
			Target:    target,
			ViaProxy:  via,
			Status:    "error",
			Reachable: false,
			Detail:    err.Error(),
			CheckedAt: checkedAt,
		}
	}
	portNum, err := strconv.Atoi(portStr)
	if err != nil || portNum < 1 || portNum > 65535 {
		return core.ProbeTargetResult{
			Target:    target,
			ViaProxy:  via,
			Status:    "error",
			Reachable: false,
			Detail:    "invalid target port",
			CheckedAt: checkedAt,
		}
	}

	dctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := dialFn(dctx, "tcp", proxyAddr)
	if err != nil {
		return core.ProbeTargetResult{
			Target:    target,
			ViaProxy:  via,
			Status:    classifyDialError(err),
			Reachable: false,
			LatencyMs: time.Since(start).Milliseconds(),
			Detail:    fmt.Sprintf("SOCKS5 proxy dial failed: %v", err),
			CheckedAt: checkedAt,
		}
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	// Greeting: VER=5, NMETHODS=1, NOAUTH=0
	if _, err := conn.Write([]byte{0x05, 0x01, 0x00}); err != nil {
		return core.ProbeTargetResult{
			Target:    target,
			ViaProxy:  via,
			Status:    "error",
			Reachable: false,
			LatencyMs: time.Since(start).Milliseconds(),
			Detail:    fmt.Sprintf("SOCKS5 greeting failed: %v", err),
			CheckedAt: checkedAt,
		}
	}
	authResp := make([]byte, 2)
	if _, err := io.ReadFull(conn, authResp); err != nil || authResp[0] != 0x05 || authResp[1] != 0x00 {
		return core.ProbeTargetResult{
			Target:    target,
			ViaProxy:  via,
			Status:    "error",
			Reachable: false,
			LatencyMs: time.Since(start).Milliseconds(),
			Detail:    fmt.Sprintf("SOCKS5 auth negotiation rejected (%v)", err),
			CheckedAt: checkedAt,
		}
	}

	// Build CONNECT packet: VER=5, CMD=1 (CONNECT), RSV=0, ATYP, DST.ADDR, DST.PORT
	reqPkt := []byte{0x05, 0x01, 0x00}
	if ip := net.ParseIP(host); ip != nil {
		if v4 := ip.To4(); v4 != nil {
			reqPkt = append(reqPkt, 0x01)
			reqPkt = append(reqPkt, v4...)
		} else {
			reqPkt = append(reqPkt, 0x04)
			reqPkt = append(reqPkt, ip.To16()...)
		}
	} else {
		if len(host) > 255 {
			return core.ProbeTargetResult{
				Target:    target,
				ViaProxy:  via,
				Status:    "error",
				Reachable: false,
				Detail:    "hostname exceeds 255 bytes",
				CheckedAt: checkedAt,
			}
		}
		reqPkt = append(reqPkt, 0x03, byte(len(host)))
		reqPkt = append(reqPkt, []byte(host)...)
	}
	portBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(portBuf, uint16(portNum))
	reqPkt = append(reqPkt, portBuf...)

	if _, err := conn.Write(reqPkt); err != nil {
		return core.ProbeTargetResult{
			Target:    target,
			ViaProxy:  via,
			Status:    "error",
			Reachable: false,
			LatencyMs: time.Since(start).Milliseconds(),
			Detail:    fmt.Sprintf("SOCKS5 CONNECT write failed: %v", err),
			CheckedAt: checkedAt,
		}
	}

	hdr := make([]byte, 4)
	if _, err := io.ReadFull(conn, hdr); err != nil {
		return core.ProbeTargetResult{
			Target:    target,
			ViaProxy:  via,
			Status:    classifyDialError(err),
			Reachable: false,
			LatencyMs: time.Since(start).Milliseconds(),
			Detail:    fmt.Sprintf("SOCKS5 CONNECT response failed: %v", err),
			CheckedAt: checkedAt,
		}
	}

	// Drain bound addr before evaluating reply status
	var addrBytes int
	switch hdr[3] {
	case 0x01:
		addrBytes = 4
	case 0x04:
		addrBytes = 16
	case 0x03:
		l := make([]byte, 1)
		if _, err := io.ReadFull(conn, l); err == nil {
			addrBytes = int(l[0])
		}
	}
	if addrBytes > 0 {
		_, _ = io.CopyN(io.Discard, conn, int64(addrBytes)+2)
	} else {
		_, _ = io.CopyN(io.Discard, conn, 2)
	}

	latency := time.Since(start).Milliseconds()
	if hdr[1] == 0x00 {
		return core.ProbeTargetResult{
			Target:    target,
			ViaProxy:  via,
			Status:    "healthy",
			Reachable: true,
			LatencyMs: latency,
			Detail:    fmt.Sprintf("SOCKS5 CONNECT OK (%dms)", latency),
			CheckedAt: checkedAt,
		}
	}

	status := "error"
	if hdr[1] == 0x05 {
		status = "refused"
	} else if hdr[1] == 0x06 {
		status = "timeout"
	}
	return core.ProbeTargetResult{
		Target:    target,
		ViaProxy:  via,
		Status:    status,
		Reachable: false,
		LatencyMs: latency,
		Detail:    fmt.Sprintf("SOCKS5 reply error code 0x%02x (%s)", hdr[1], socksReplyDesc(hdr[1])),
		CheckedAt: checkedAt,
	}
}

func socksReplyDesc(code byte) string {
	switch code {
	case 0x01:
		return "general failure"
	case 0x02:
		return "connection not allowed by ruleset"
	case 0x03:
		return "network unreachable"
	case 0x04:
		return "host unreachable"
	case 0x05:
		return "connection refused"
	case 0x06:
		return "TTL expired / timeout"
	default:
		return "unknown SOCKS5 error"
	}
}

func classifyDialError(err error) string {
	if err == nil {
		return "healthy"
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return "timeout"
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "refused") {
		return "refused"
	}
	return "error"
}
