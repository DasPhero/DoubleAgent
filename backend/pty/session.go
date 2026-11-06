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

// ShellOptions configures launch parameters for a local PTY shell (F-10, F-23).
type ShellOptions struct {
	ShellType  string
	WorkingDir string
	AsRoot     bool
	Size       core.TerminalSize
}

// Engine manages local interactive PTY sessions.
type Engine struct {
	// platform specific fields
}

// StartShell launches a local pseudo-terminal shell based on shellType ("powershell", "cmd", "wsl", "default").
func StartShell(ctx context.Context, shellType string, size core.TerminalSize) (Session, error) {
	return StartShellWithOptions(ctx, ShellOptions{ShellType: shellType, Size: size})
}

// StartShellWithOptions launches a local pseudo-terminal shell with specific working directory and root elevation (F-10).
func StartShellWithOptions(ctx context.Context, opts ShellOptions) (Session, error) {
	return startPlatformShellWithOptions(ctx, opts)
}

