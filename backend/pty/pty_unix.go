//go:build !windows
// +build !windows

package pty

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"

	"doubleagent/backend/core"
)

type unixPtySession struct {
	id        string
	title     string
	shellType string
	cmd       *exec.Cmd
	ptmx      *os.File
	mu        sync.Mutex
	closed    bool
}

func (s *unixPtySession) ID() string        { return s.id }
func (s *unixPtySession) Title() string     { return s.title }
func (s *unixPtySession) ShellType() string { return s.shellType }
func (s *unixPtySession) Stdin() io.Writer  { return s.ptmx }
func (s *unixPtySession) Stdout() io.Reader { return s.ptmx }

func (s *unixPtySession) Resize(size core.TerminalSize) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.ptmx == nil {
		return nil
	}
	cols := size.Cols
	rows := size.Rows
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	return unix.IoctlSetWinsize(int(s.ptmx.Fd()), unix.TIOCSWINSZ, &unix.Winsize{
		Row: rows,
		Col: cols,
	})
}

func (s *unixPtySession) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	if s.ptmx != nil {
		_ = s.ptmx.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
		_, _ = s.cmd.Process.Wait()
	}
	return nil
}

func openLinuxPTY() (ptmx *os.File, pts *os.File, err error) {
	ptmx, err = os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("open /dev/ptmx: %w", err)
	}

	// Unlock slave PTY (TIOCSPTLCK with int(0)).
	var unlock int32
	if _, _, errno := syscall.Syscall(
		syscall.SYS_IOCTL,
		ptmx.Fd(),
		uintptr(unix.TIOCSPTLCK),
		uintptr(unsafe.Pointer(&unlock)),
	); errno != 0 {
		_ = ptmx.Close()
		return nil, nil, fmt.Errorf("unlock pty (TIOCSPTLCK): %w", errno)
	}

	// Query slave PTY number (TIOCGPTN).
	var ptyNum uint32
	if _, _, errno := syscall.Syscall(
		syscall.SYS_IOCTL,
		ptmx.Fd(),
		uintptr(unix.TIOCGPTN),
		uintptr(unsafe.Pointer(&ptyNum)),
	); errno != 0 {
		_ = ptmx.Close()
		return nil, nil, fmt.Errorf("get pty number (TIOCGPTN): %w", errno)
	}

	slavePath := fmt.Sprintf("/dev/pts/%d", ptyNum)
	pts, err = os.OpenFile(slavePath, os.O_RDWR|syscall.O_NOCTTY|syscall.O_CLOEXEC, 0)
	if err != nil {
		_ = ptmx.Close()
		return nil, nil, fmt.Errorf("open %s: %w", slavePath, err)
	}
	return ptmx, pts, nil
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
			binary = "/bin/bash"
			if _, err := os.Stat(binary); err != nil {
				binary = "/bin/sh"
			}
			title = "Local Shell"
		}
	}

	if opts.AsRoot {
		title += " (Root)"
		args = []string{"-i"}
		binary = "sudo"
	}

	ptmx, pts, err := openLinuxPTY()
	if err != nil {
		return nil, err
	}

	cols := opts.Size.Cols
	rows := opts.Size.Rows
	if cols == 0 {
		cols = 120
	}
	if rows == 0 {
		rows = 30
	}
	_ = unix.IoctlSetWinsize(int(ptmx.Fd()), unix.TIOCSWINSZ, &unix.Winsize{
		Row: rows,
		Col: cols,
	})

	cmd := exec.CommandContext(ctx, binary, args...)
	if opts.WorkingDir != "" {
		cmd.Dir = opts.WorkingDir
	}

	// Ensure TERM and COLORTERM are set for interactive shells (zsh/bash/vim/htop).
	env := os.Environ()
	hasTerm := false
	for i, kv := range env {
		if strings.HasPrefix(kv, "TERM=") {
			env[i] = "TERM=xterm-256color"
			hasTerm = true
		}
	}
	if !hasTerm {
		env = append(env, "TERM=xterm-256color")
	}
	env = append(env, "COLORTERM=truecolor")
	cmd.Env = env

	cmd.Stdin = pts
	cmd.Stdout = pts
	cmd.Stderr = pts
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid:  true,
		Setctty: true,
		Ctty:    0,
	}

	if err := cmd.Start(); err != nil {
		_ = pts.Close()
		_ = ptmx.Close()
		return nil, fmt.Errorf("start shell %q: %w", binary, err)
	}
	// Parent closes slave fd so EOF propagates cleanly when child shell exits.
	_ = pts.Close()

	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	sessionID := "local-" + hex.EncodeToString(randBytes)

	return &unixPtySession{
		id:        sessionID,
		title:     title,
		shellType: normType,
		cmd:       cmd,
		ptmx:      ptmx,
	}, nil
}
