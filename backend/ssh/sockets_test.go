package ssh_test

import (
	"context"
	"errors"
	"testing"

	"doubleagent/backend/core"
	sshpkg "doubleagent/backend/ssh"
)

type mockSshRunner struct {
	responses map[string]struct {
		out  string
		err  string
		code int
		goErr error
	}
}

func (m *mockSshRunner) ExecRaw(_ context.Context, _ string, command string, _ []byte, _ int) ([]byte, []byte, int, error) {
	if r, ok := m.responses[command]; ok {
		return []byte(r.out), []byte(r.err), r.code, r.goErr
	}
	return nil, []byte("not found"), 127, nil
}

func TestSocketParsersAndDiscovery_F45(t *testing.T) {
	ssOut := `Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
tcp   LISTEN 0      128    127.0.0.1:11434    0.0.0.0:*         users:(("ollama",pid=1234,fd=7))
tcp   LISTEN 0      128    0.0.0.0:22         0.0.0.0:*         users:(("sshd",pid=811,fd=3))
tcp   LISTEN 0      64     [::1]:8080         [::]:*            users:(("admin-api",pid=2222,fd=5))
udp   UNCONN 0      0      127.0.0.53%lo:53   0.0.0.0:*         users:(("systemd-resolve",pid=410,fd=12))`

	parsedSS := sshpkg.ParseLinuxSS(ssOut)
	if len(parsedSS) != 4 {
		t.Fatalf("expected 4 ss entries, got %d: %+v", len(parsedSS), parsedSS)
	}
	if !parsedSS[0].IsLoopback || parsedSS[0].LocalPort != 11434 || parsedSS[0].Process != "ollama" || parsedSS[0].PID != "1234" {
		t.Fatalf("unexpected loopback ollama entry: %+v", parsedSS[0])
	}
	if parsedSS[1].IsLoopback || parsedSS[1].LocalPort != 22 {
		t.Fatalf("expected non-loopback 0.0.0.0:22, got %+v", parsedSS[1])
	}
	if !parsedSS[2].IsLoopback || parsedSS[2].LocalAddress != "::1" || parsedSS[2].LocalPort != 8080 {
		t.Fatalf("expected IPv6 ::1:8080 loopback, got %+v", parsedSS[2])
	}
	if !parsedSS[3].IsLoopback || parsedSS[3].LocalAddress != "127.0.0.53" || parsedSS[3].LocalPort != 53 {
		t.Fatalf("expected zone-stripped 127.0.0.53 loopback, got %+v", parsedSS[3])
	}

	// /proc/net/tcp parser (0100007F:1F90 == 127.0.0.1:8080, st 0A == LISTEN; st 01 == ESTABLISHED ignored)
	procOut := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 00000000 100 0 0 10 0
   1: 0100007F:9999 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 12346 1 00000000 100 0 0 10 0`
	parsedProc := sshpkg.ParseLinuxProcNetTcp(procOut, false)
	if len(parsedProc) != 1 || parsedProc[0].LocalAddress != "127.0.0.1" || parsedProc[0].LocalPort != 8080 || !parsedProc[0].IsLoopback {
		t.Fatalf("unexpected /proc/net/tcp parse result: %+v", parsedProc)
	}

	// Windows netstat -ano parser
	winOut := `Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       904
  TCP    127.0.0.1:5985         0.0.0.0:0              LISTENING       4
  TCP    10.0.0.5:445           10.0.0.99:55112        ESTABLISHED     4
  TCP    [::1]:9000             [::]:0                 LISTENING       5120
  UDP    127.0.0.1:5353         *:*                                    1800`
	parsedWin := sshpkg.ParseWindowsNetstat(winOut)
	if len(parsedWin) != 4 {
		t.Fatalf("expected 4 windows listening sockets, got %d: %+v", len(parsedWin), parsedWin)
	}
	if !parsedWin[1].IsLoopback || parsedWin[1].LocalPort != 5985 || parsedWin[1].PID != "4" {
		t.Fatalf("unexpected windows loopback entry: %+v", parsedWin[1])
	}

	// End-to-end DiscoverRemoteSockets Linux fallback to /proc/net/tcp when ss & netstat missing
	linuxMock := &mockSshRunner{
		responses: map[string]struct {
			out  string
			err  string
			code int
			goErr error
		}{
			"uname -s":         {out: "Linux\n", code: 0},
			"cat /proc/net/tcp": {out: procOut, code: 0},
		},
	}
	resLinux, err := sshpkg.DiscoverRemoteSockets(context.Background(), linuxMock, "sess-1")
	if err != nil {
		t.Fatalf("DiscoverRemoteSockets linux error: %v", err)
	}
	if resLinux.Platform != "linux" || len(resLinux.Entries) != 1 || resLinux.Entries[0].LocalPort != 8080 {
		t.Fatalf("unexpected linux fallback result: %+v", resLinux)
	}

	// End-to-end Windows discovery (uname missing -> netstat -ano)
	winMock := &mockSshRunner{
		responses: map[string]struct {
			out  string
			err  string
			code int
			goErr error
		}{
			"uname -s":     {out: "", err: "not recognized", code: 1},
			"netstat -ano": {out: winOut, code: 0},
		},
	}
	resWin, err := sshpkg.DiscoverRemoteSockets(context.Background(), winMock, "sess-2")
	if err != nil {
		t.Fatalf("DiscoverRemoteSockets windows error: %v", err)
	}
	if resWin.Platform != "windows" || len(resWin.Entries) != 4 {
		t.Fatalf("unexpected windows scan result: %+v", resWin)
	}
	// Sorted loopback first -> entry 0 must be loopback
	if !resWin.Entries[0].IsLoopback {
		t.Fatalf("expected loopback entry sorted first, got %+v", resWin.Entries)
	}

	if _, err := sshpkg.DiscoverRemoteSockets(context.Background(), nil, "sess-1"); !errors.Is(err, err) || err == nil {
		t.Fatalf("expected error on nil runner")
	}
	var _ core.RemoteSocketScanResult = *resWin
}
