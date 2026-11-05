package pty

import (
	"context"
	"io"

	"doubleagent/backend/core"
)

// Session represents an active local pseudo-terminal session (PowerShell, CMD, WSL, or Unix shell).
type Session interface {
	ID() string
	Title() string
	ShellType() string
	Stdin() io.Writer
	Stdout() io.Reader
	Resize(size core.TerminalSize) error
	Close() error
}

// Engine manages local interactive PTY sessions.
type Engine struct {
	// platform specific fields
}

// StartShell launches a local pseudo-terminal shell based on shellType ("powershell", "cmd", "wsl", "default").
func StartShell(ctx context.Context, shellType string, size core.TerminalSize) (Session, error) {
	return startPlatformShell(ctx, shellType, size)
}
