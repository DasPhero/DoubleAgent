//go:build windows
// +build windows

package pty

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"

	"doubleagent/backend/core"
)

type localProcessSession struct {
	id        string
	title     string
	shellType string
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    io.ReadCloser
	mu        sync.Mutex
	closed    bool
}

func (s *localProcessSession) ID() string        { return s.id }
func (s *localProcessSession) Title() string     { return s.title }
func (s *localProcessSession) ShellType() string { return s.shellType }
func (s *localProcessSession) Stdin() io.Writer  { return s.stdin }
func (s *localProcessSession) Stdout() io.Reader { return s.stdout }

func (s *localProcessSession) Resize(_ core.TerminalSize) error {
	// Standard pipe process does not have a dynamic ConPTY resize requirement
	return nil
}

func (s *localProcessSession) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true

	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if s.stdout != nil {
		_ = s.stdout.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return nil
}

func startPlatformShell(ctx context.Context, shellType string, size core.TerminalSize) (Session, error) {
	return startPlatformShellWithOptions(ctx, ShellOptions{ShellType: shellType, Size: size})
}

func startPlatformShellWithOptions(ctx context.Context, opts ShellOptions) (Session, error) {
	normType := strings.ToLower(strings.TrimSpace(opts.ShellType))
	var binary string
	var args []string
	var title string

	switch normType {
	case "cmd", "cmd.exe", "command prompt":
		binary = "cmd.exe"
		args = []string{"/Q"}
		title = "Local (CMD)"
		if opts.AsRoot {
			title = "Local (CMD Admin)"
		}
		normType = "cmd"
	case "wsl", "wsl.exe", "linux":
		binary = "wsl.exe"
		title = "Local (WSL)"
		normType = "wsl"
		if opts.AsRoot {
			title = "Local (WSL Root)"
			args = append(args, "-u", "root")
		}
		if opts.WorkingDir != "" {
			args = append(args, "--cd", opts.WorkingDir)
		}
	case "powershell", "pwsh", "powershell.exe", "":
		if p, err := exec.LookPath("pwsh.exe"); err == nil && p != "" {
			binary = p
		} else {
			binary = "powershell.exe"
		}
		args = []string{"-NoLogo"}
		title = "Local (PowerShell)"
		if opts.AsRoot {
			title = "Local (PowerShell Admin)"
		}
		normType = "powershell"
	default:
		binary = normType
		args = nil
		title = fmt.Sprintf("Local (%s)", normType)
	}

	cmd := exec.CommandContext(ctx, binary, args...)
	if opts.WorkingDir != "" && normType != "wsl" {
		cmd.Dir = opts.WorkingDir
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe for %s: %w", binary, err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("stdout pipe for %s: %w", binary, err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("start shell %q: %w", binary, err)
	}

	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	sessionID := "local-" + hex.EncodeToString(randBytes)

	return &localProcessSession{
		id:        sessionID,
		title:     title,
		shellType: normType,
		cmd:       cmd,
		stdin:     stdin,
		stdout:    stdout,
	}, nil
}
