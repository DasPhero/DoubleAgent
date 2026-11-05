//go:build !windows
// +build !windows

package pty

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"

	"doubleagent/backend/core"
)

type unixPtySession struct {
	id        string
	title     string
	shellType string
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    io.ReadCloser
	mu        sync.Mutex
	closed    bool
}

func (s *unixPtySession) ID() string        { return s.id }
func (s *unixPtySession) Title() string     { return s.title }
func (s *unixPtySession) ShellType() string { return s.shellType }
func (s *unixPtySession) Stdin() io.Writer  { return s.stdin }
func (s *unixPtySession) Stdout() io.Reader { return s.stdout }

func (s *unixPtySession) Resize(_ core.TerminalSize) error {
	return nil
}

func (s *unixPtySession) Close() error {
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

func startPlatformShell(ctx context.Context, shellType string, _ core.TerminalSize) (Session, error) {
	normType := strings.ToLower(strings.TrimSpace(shellType))
	var binary string
	var title string
	switch normType {
	case "bash", "bash.exe":
		binary = "bash"
		title = "Local (Bash)"
	case "sh", "sh.exe":
		binary = "sh"
		title = "Local (sh)"
	default:
		if envShell := os.Getenv("SHELL"); envShell != "" {
			binary = envShell
			title = fmt.Sprintf("Local (%s)", binary)
		} else {
			binary = "/bin/sh"
			title = "Local Shell"
		}
	}

	cmd := exec.CommandContext(ctx, binary)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
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

	return &unixPtySession{
		id:        sessionID,
		title:     title,
		shellType: normType,
		cmd:       cmd,
		stdin:     stdin,
		stdout:    stdout,
	}, nil
}
