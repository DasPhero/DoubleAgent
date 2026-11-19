package ssh

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"doubleagent/backend/core"
)

const socketScanMaxBytes = 512 * 1024

var (
	ssProcRe   = regexp.MustCompile(`users:\(\("([^"]+)",pid=(\d+)`)
	pidProgRe  = regexp.MustCompile(`^(\d+)/(.*)$`)
)

// DiscoverRemoteSockets inspects open listening sockets on-demand over an active SSH session
// without requesting a PTY, supporting Linux (ss / netstat / /proc/net/tcp) and Windows (netstat -ano) (F-45).
func DiscoverRemoteSockets(
	ctx context.Context,
	runner core.SshBinaryRunner,
	sessionID string,
) (*core.RemoteSocketScanResult, error) {
	if runner == nil {
		return nil, errors.New("ssh binary runner unavailable")
	}
	if strings.TrimSpace(sessionID) == "" {
		return nil, errors.New("sessionId is required")
	}

	scanCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	// Detect platform first with a harmless read-only command
	uOut, _, uExit, _ := runner.ExecRaw(scanCtx, sessionID, "uname -s", nil, 4096)
	uText := strings.ToLower(strings.TrimSpace(string(uOut)))

	isUnix := uExit == 0 && (strings.Contains(uText, "linux") || strings.Contains(uText, "darwin") || strings.Contains(uText, "bsd"))

	if isUnix {
		// 1. Prefer ss -tulnp (or ss -tuln without root)
		out, errOut, code, err := runner.ExecRaw(scanCtx, sessionID, "ss -tulnp", nil, socketScanMaxBytes)
		if err == nil && code == 0 && len(strings.TrimSpace(string(out))) > 0 {
			entries := ParseLinuxSS(string(out))
			return finalizeScanResult(sessionID, "linux", "ss -tulnp", entries, string(out)), nil
		}
		_ = errOut

		// 2. Fallback to netstat -tulnp / netstat -tuln
		out, _, code, err = runner.ExecRaw(scanCtx, sessionID, "netstat -tuln", nil, socketScanMaxBytes)
		if err == nil && code == 0 && len(strings.TrimSpace(string(out))) > 0 {
			entries := ParseLinuxNetstat(string(out))
			return finalizeScanResult(sessionID, "linux", "netstat -tuln", entries, string(out)), nil
		}

		// 3. Fallback directly to /proc/net/tcp + /proc/net/tcp6 (minimal/distroless Linux)
		out4, _, code4, err4 := runner.ExecRaw(scanCtx, sessionID, "cat /proc/net/tcp", nil, socketScanMaxBytes)
		out6, _, code6, _ := runner.ExecRaw(scanCtx, sessionID, "cat /proc/net/tcp6", nil, socketScanMaxBytes)
		var entries []core.RemoteSocketEntry
		var rawCombined strings.Builder
		if err4 == nil && code4 == 0 && len(out4) > 0 {
			entries = append(entries, ParseLinuxProcNetTcp(string(out4), false)...)
			rawCombined.Write(out4)
		}
		if code6 == 0 && len(out6) > 0 {
			entries = append(entries, ParseLinuxProcNetTcp(string(out6), true)...)
			rawCombined.Write(out6)
		}
		if rawCombined.Len() > 0 {
			return finalizeScanResult(sessionID, "linux", "cat /proc/net/tcp{,6}", entries, rawCombined.String()), nil
		}

		return &core.RemoteSocketScanResult{
			SessionID: sessionID,
			Platform:  "linux",
			Error:     "neither ss, netstat, nor /proc/net/tcp returned listening sockets",
		}, nil
	}

	// Windows OpenSSH (or fallback when uname is unavailable) -> netstat -ano
	wOut, wErrOut, wCode, wErr := runner.ExecRaw(scanCtx, sessionID, "netstat -ano", nil, socketScanMaxBytes)
	if wErr == nil && wCode == 0 && len(strings.TrimSpace(string(wOut))) > 0 {
		entries := ParseWindowsNetstat(string(wOut))
		return finalizeScanResult(sessionID, "windows", "netstat -ano", entries, string(wOut)), nil
	}

	errMsg := strings.TrimSpace(string(wErrOut))
	if wErr != nil {
		errMsg = wErr.Error()
	}
	if errMsg == "" {
		errMsg = fmt.Sprintf("remote socket discovery failed (exit %d)", wCode)
	}
	return &core.RemoteSocketScanResult{
		SessionID: sessionID,
		Platform:  "unknown",
		Error:     errMsg,
	}, nil
}

func finalizeScanResult(
	sessionID string,
	platform string,
	cmd string,
	entries []core.RemoteSocketEntry,
	rawOutput string,
) *core.RemoteSocketScanResult {
	// Deduplicate by proto + localAddress + localPort
	seen := make(map[string]bool, len(entries))
	dedup := make([]core.RemoteSocketEntry, 0, len(entries))
	for _, e := range entries {
		key := fmt.Sprintf("%s|%s|%d", e.Proto, e.LocalAddress, e.LocalPort)
		if seen[key] {
			continue
		}
		seen[key] = true
		e.Platform = platform
		dedup = append(dedup, e)
	}

	// Sort: loopback services first (primary tunnel targets), then ascending port
	sort.Slice(dedup, func(i, j int) bool {
		if dedup[i].IsLoopback != dedup[j].IsLoopback {
			return dedup[i].IsLoopback
		}
		if dedup[i].LocalPort != dedup[j].LocalPort {
			return dedup[i].LocalPort < dedup[j].LocalPort
		}
		return dedup[i].LocalAddress < dedup[j].LocalAddress
	})

	if len(rawOutput) > 16384 {
		rawOutput = rawOutput[:16384] + "\n... [truncated]"
	}
	return &core.RemoteSocketScanResult{
		SessionID:   sessionID,
		Platform:    platform,
		CommandUsed: cmd,
		Entries:     dedup,
		RawOutput:   rawOutput,
	}
}

// ParseLinuxSS parses output from `ss -tulnp` or `ss -tuln` into RemoteSocketEntry rows (F-45).
func ParseLinuxSS(output string) []core.RemoteSocketEntry {
	var out []core.RemoteSocketEntry
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		proto := strings.ToLower(fields[0])
		if !strings.HasPrefix(proto, "tcp") && !strings.HasPrefix(proto, "udp") {
			continue
		}
		state := strings.ToUpper(fields[1])
		// UDP listening sockets appear as UNCONN in ss
		if state != "LISTEN" && state != "UNCONN" {
			continue
		}
		addr, port, ok := splitHostPortToken(fields[4])
		if !ok || port == 0 {
			continue
		}
		remoteAddr := ""
		if len(fields) >= 6 {
			remoteAddr = fields[5]
		}
		procName := ""
		pid := ""
		if len(fields) >= 7 {
			rest := strings.Join(fields[6:], " ")
			if m := ssProcRe.FindStringSubmatch(rest); len(m) == 3 {
				procName = m[1]
				pid = m[2]
			}
		}
		out = append(out, core.RemoteSocketEntry{
			Proto:         proto,
			State:         state,
			LocalAddress:  addr,
			LocalPort:     port,
			RemoteAddress: remoteAddr,
			Process:       procName,
			PID:           pid,
			IsLoopback:    isLoopbackAddr(addr),
			Platform:      "linux",
		})
	}
	return out
}

// ParseLinuxNetstat parses output from `netstat -tuln` or `netstat -tulnp` (F-45).
func ParseLinuxNetstat(output string) []core.RemoteSocketEntry {
	var out []core.RemoteSocketEntry
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		proto := strings.ToLower(fields[0])
		if proto != "tcp" && proto != "tcp6" && proto != "udp" && proto != "udp6" {
			continue
		}
		addr, port, ok := splitHostPortToken(fields[3])
		if !ok || port == 0 {
			continue
		}
		remoteAddr := ""
		if len(fields) >= 5 {
			remoteAddr = fields[4]
		}
		state := ""
		procIdx := 5
		if strings.HasPrefix(proto, "tcp") && len(fields) >= 6 {
			state = strings.ToUpper(fields[5])
			procIdx = 6
			if state != "LISTEN" {
				continue
			}
		} else {
			state = "UNCONN"
		}
		procName := ""
		pid := ""
		if len(fields) > procIdx {
			tail := fields[procIdx]
			if m := pidProgRe.FindStringSubmatch(tail); len(m) == 3 {
				pid = m[1]
				procName = strings.TrimRight(m[2], " ")
			}
		}
		out = append(out, core.RemoteSocketEntry{
			Proto:         proto,
			State:         state,
			LocalAddress:  addr,
			LocalPort:     port,
			RemoteAddress: remoteAddr,
			Process:       procName,
			PID:           pid,
			IsLoopback:    isLoopbackAddr(addr),
			Platform:      "linux",
		})
	}
	return out
}

// ParseLinuxProcNetTcp parses `/proc/net/tcp` (ipv6=false) or `/proc/net/tcp6` (ipv6=true) LISTEN rows (F-45).
func ParseLinuxProcNetTcp(output string, ipv6 bool) []core.RemoteSocketEntry {
	var out []core.RemoteSocketEntry
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 || fields[0] == "sl" {
			continue
		}
		// st == "0A" means TCP_LISTEN
		if !strings.EqualFold(fields[3], "0A") {
			continue
		}
		hexHost, hexPort, ok := strings.Cut(fields[1], ":")
		if !ok {
			continue
		}
		port64, err := strconv.ParseUint(hexPort, 16, 16)
		if err != nil || port64 == 0 {
			continue
		}
		addr, err := decodeProcHexIP(hexHost, ipv6)
		if err != nil {
			continue
		}
		proto := "tcp"
		if ipv6 {
			proto = "tcp6"
		}
		out = append(out, core.RemoteSocketEntry{
			Proto:        proto,
			State:        "LISTEN",
			LocalAddress: addr,
			LocalPort:    uint16(port64),
			IsLoopback:   isLoopbackAddr(addr),
			Platform:     "linux",
		})
	}
	return out
}

func decodeProcHexIP(hexStr string, ipv6 bool) (string, error) {
	b, err := hex.DecodeString(strings.TrimSpace(hexStr))
	if err != nil {
		return "", err
	}
	if !ipv6 && len(b) == 4 {
		// Linux /proc/net/tcp stores IPv4 in little-endian 32-bit host order on x86/arm64 LE
		ip := net.IPv4(b[3], b[2], b[1], b[0])
		return ip.String(), nil
	}
	if ipv6 && len(b) == 16 {
		// Stored as four 32-bit little-endian words
		var ipBytes [16]byte
		for w := 0; w < 4; w++ {
			base := w * 4
			ipBytes[base+0] = b[base+3]
			ipBytes[base+1] = b[base+2]
			ipBytes[base+2] = b[base+1]
			ipBytes[base+3] = b[base+0]
		}
		ip := net.IP(ipBytes[:])
		return ip.String(), nil
	}
	return "", errors.New("unexpected /proc/net/tcp IP byte length")
}

// ParseWindowsNetstat parses `netstat -ano` output into RemoteSocketEntry rows (F-45).
func ParseWindowsNetstat(output string) []core.RemoteSocketEntry {
	var out []core.RemoteSocketEntry
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		proto := strings.ToLower(fields[0])
		if proto != "tcp" && proto != "udp" {
			continue
		}
		addr, port, ok := splitHostPortToken(fields[1])
		if !ok || port == 0 {
			continue
		}
		if proto == "tcp" {
			if len(fields) < 5 {
				continue
			}
			state := strings.ToUpper(fields[3])
			// Localized Windows may use ABHÖREN or LISTENING; accept LISTENING or ABHÖREN
			if state != "LISTENING" && !strings.HasPrefix(state, "ABH") {
				continue
			}
			out = append(out, core.RemoteSocketEntry{
				Proto:         "tcp",
				State:         "LISTENING",
				LocalAddress:  addr,
				LocalPort:     port,
				RemoteAddress: fields[2],
				PID:           fields[4],
				IsLoopback:    isLoopbackAddr(addr),
				Platform:      "windows",
			})
		} else {
			// UDP has no state column: UDP 127.0.0.1:5353 *:* <PID>
			out = append(out, core.RemoteSocketEntry{
				Proto:         "udp",
				State:         "UNCONN",
				LocalAddress:  addr,
				LocalPort:     port,
				RemoteAddress: fields[2],
				PID:           fields[3],
				IsLoopback:    isLoopbackAddr(addr),
				Platform:      "windows",
			})
		}
	}
	return out
}

func splitHostPortToken(tok string) (string, uint16, bool) {
	s := strings.TrimSpace(tok)
	if s == "" {
		return "", 0, false
	}
	// Strip [brackets] when splitting
	if strings.HasPrefix(s, "[") {
		idx := strings.LastIndex(s, "]:")
		if idx < 0 {
			return "", 0, false
		}
		host := cleanZoneSuffix(s[1:idx])
		p, err := strconv.ParseUint(s[idx+2:], 10, 16)
		if err != nil {
			return "", 0, false
		}
		return host, uint16(p), true
	}
	idx := strings.LastIndex(s, ":")
	if idx < 0 {
		return "", 0, false
	}
	host := cleanZoneSuffix(s[:idx])
	pStr := s[idx+1:]
	if pStr == "*" {
		return "", 0, false
	}
	p, err := strconv.ParseUint(pStr, 10, 16)
	if err != nil {
		return "", 0, false
	}
	if host == "" {
		host = "::"
	}
	return host, uint16(p), true
}

func cleanZoneSuffix(host string) string {
	// e.g. "127.0.0.53%lo" -> "127.0.0.53"
	if pct := strings.IndexByte(host, '%'); pct >= 0 {
		host = host[:pct]
	}
	return strings.TrimSpace(host)
}

func isLoopbackAddr(addr string) bool {
	a := strings.ToLower(cleanZoneSuffix(addr))
	if a == "localhost" || a == "::1" || a == "[::1]" {
		return true
	}
	if strings.HasPrefix(a, "::ffff:") {
		a = strings.TrimPrefix(a, "::ffff:")
	}
	ip := net.ParseIP(a)
	return ip != nil && ip.IsLoopback()
}
