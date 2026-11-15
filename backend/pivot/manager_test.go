package pivot

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestMain(m *testing.M) {
	if os.Getenv("GO_WANT_PIVOT_HELPER") == "1" {
		fmt.Println("INFO: Listening on 0.0.0.0:11601")
		fmt.Println("INFO: Agent joined id=1 session:lab-dc01")
		sc := bufio.NewScanner(os.Stdin)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			fmt.Printf("ECHO:%s\n", line)
			if line == "exit" {
				break
			}
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestManager_StartMissingBinaryAndList_F24(t *testing.T) {
	mgr := NewManager(nil)
	route := core.NetworkRoute{
		ID:          "r-missing",
		Name:        "Missing Binary Test",
		Tool:        "ligolo-ng",
		BindAddress: "0.0.0.0",
		ListenPort:  11699,
		BinaryPath:  `Z:\nonexistent\ligolo-proxy-missing.exe`,
	}

	info, err := mgr.Start(context.Background(), route)
	if err == nil {
		t.Fatal("expected error for missing binary path")
	}
	if info.Status != "error" || info.ErrorMsg == "" {
		t.Fatalf("expected error status and ErrorMsg, got status=%q err=%q", info.Status, info.ErrorMsg)
	}

	list := mgr.List()
	if len(list) != 1 || list[0].Status != "error" {
		t.Fatalf("expected error instance visible in List(), got %+v", list)
	}

	if err := mgr.Stop(info.ID); err != nil {
		t.Fatalf("expected dismiss stop on error instance to succeed, got: %v", err)
	}
	if len(mgr.List()) != 0 {
		t.Fatalf("expected error instance to be dismissed, got %d remaining", len(mgr.List()))
	}
}

func TestManager_StartInputAndStopLifecycle_F24(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("failed to get test executable: %v", err)
	}
	t.Setenv("GO_WANT_PIVOT_HELPER", "1")

	updates := make(chan core.PivotInstanceInfo, 16)
	mgr := NewManager(func(info core.PivotInstanceInfo) {
		select {
		case updates <- info:
		default:
		}
	})

	route := core.NetworkRoute{
		ID:            "r-live",
		Name:          "Live Helper Pivot",
		Tool:          "ligolo-ng",
		BindAddress:   "0.0.0.0",
		ListenPort:    11601,
		InterfaceName: "ligolo",
		Subnets:       []string{"10.10.20.0/24"},
		BinaryPath:    exe,
	}

	info, err := mgr.Start(context.Background(), route)
	if err != nil {
		t.Fatalf("failed to start helper pivot process: %v", err)
	}
	if info.Status != "running" || info.PID <= 0 {
		t.Fatalf("expected running status with valid PID, got %+v", info)
	}

	// Duplicate port should be rejected while running
	if _, dupErr := mgr.Start(context.Background(), route); dupErr == nil {
		t.Fatal("expected duplicate port start to fail")
	}

	// Send interactive stdin command
	if err := mgr.SendInput(info.ID, "ifconfig"); err != nil {
		t.Fatalf("SendInput failed: %v", err)
	}

	// Wait briefly for helper stdout lines & agent detection
	deadline := time.Now().Add(3 * time.Second)
	var latest core.PivotInstanceInfo
	for time.Now().Before(deadline) {
		items := mgr.List()
		if len(items) > 0 {
			latest = items[0]
			joined := strings.Join(latest.RecentLogs, "\n")
			if strings.Contains(joined, "ECHO:ifconfig") && len(latest.ConnectedAgents) > 0 {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}

	joinedLogs := strings.Join(latest.RecentLogs, "\n")
	if !strings.Contains(joinedLogs, "ECHO:ifconfig") {
		t.Fatalf("expected echoed input in RecentLogs, got: %v", latest.RecentLogs)
	}
	if len(latest.ConnectedAgents) == 0 {
		t.Fatalf("expected agent detection in ConnectedAgents, got: %v", latest.ConnectedAgents)
	}

	if err := mgr.Stop(info.ID); err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	items := mgr.List()
	if len(items) == 0 || items[0].Status != "stopped" {
		t.Fatalf("expected stopped status after Stop, got: %+v", items)
	}
}
