//go:build windows
// +build windows

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
	"unsafe"

	"golang.org/x/sys/windows"

	"doubleagent/backend/core"
)

type conPtySession struct {
	id        string
	title     string
	shellType string
	hPC       windows.Handle
	hProcess  windows.Handle
	stdin     *os.File
	stdout    *os.File
	mu        sync.Mutex
	closed    bool
}

func (s *conPtySession) ID() string        { return s.id }
func (s *conPtySession) Title() string     { return s.title }
func (s *conPtySession) ShellType() string { return s.shellType }
func (s *conPtySession) Stdin() io.Writer  { return s.stdin }
func (s *conPtySession) Stdout() io.Reader { return s.stdout }

func (s *conPtySession) Resize(size core.TerminalSize) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.hPC == 0 {
		return nil
	}
	cols := size.Cols
	rows := size.Rows
	if cols == 0 {
		cols = 120
	}
	if rows == 0 {
		rows = 34
	}
	return windows.ResizePseudoConsole(s.hPC, windows.Coord{X: int16(cols), Y: int16(rows)})
}

func (s *conPtySession) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	hPC := s.hPC
	s.hPC = 0
	hProcess := s.hProcess
	s.hProcess = 0
	s.mu.Unlock()

	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if hPC != 0 {
		windows.ClosePseudoConsole(hPC)
	}
	if hProcess != 0 {
		_ = windows.TerminateProcess(hProcess, 0)
		_ = windows.CloseHandle(hProcess)
	}
	if s.stdout != nil {
		_ = s.stdout.Close()
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
		if p, err := exec.LookPath("cmd.exe"); err == nil && p != "" {
			binary = p
		} else {
			binary = "cmd.exe"
		}
		args = []string{"/k"}
		title = "Local (CMD)"
		if opts.AsRoot {
			title = "Local (CMD Admin)"
		}
		normType = "cmd"
	case "wsl", "wsl.exe", "linux":
		if p, err := exec.LookPath("wsl.exe"); err == nil && p != "" {
			binary = p
		} else {
			binary = "wsl.exe"
		}
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
		} else if p, err := exec.LookPath("powershell.exe"); err == nil && p != "" {
			binary = p
		} else {
			binary = "powershell.exe"
		}
		args = []string{"-NoExit", "-NoLogo"}
		title = "Local (PowerShell)"
		if opts.AsRoot {
			title = "Local (PowerShell Admin)"
		}
		normType = "powershell"
	default:
		if p, err := exec.LookPath(normType); err == nil && p != "" {
			binary = p
		} else {
			binary = normType
		}
		args = nil
		title = fmt.Sprintf("Local (%s)", normType)
	}

	cols := opts.Size.Cols
	rows := opts.Size.Rows
	if cols == 0 {
		cols = 120
	}
	if rows == 0 {
		rows = 34
	}

	// 1. Create pseudo-console communication pipes
	var inPipeR, inPipeW windows.Handle
	if err := windows.CreatePipe(&inPipeR, &inPipeW, nil, 0); err != nil {
		return nil, fmt.Errorf("create input pipe: %w", err)
	}

	var outPipeR, outPipeW windows.Handle
	if err := windows.CreatePipe(&outPipeR, &outPipeW, nil, 0); err != nil {
		_ = windows.CloseHandle(inPipeR)
		_ = windows.CloseHandle(inPipeW)
		return nil, fmt.Errorf("create output pipe: %w", err)
	}

	// 2. Create the PseudoConsole
	var hPC windows.Handle
	coord := windows.Coord{X: int16(cols), Y: int16(rows)}
	if err := windows.CreatePseudoConsole(coord, inPipeR, outPipeW, 0, &hPC); err != nil {
		_ = windows.CloseHandle(inPipeR)
		_ = windows.CloseHandle(inPipeW)
		_ = windows.CloseHandle(outPipeR)
		_ = windows.CloseHandle(outPipeW)
		return nil, fmt.Errorf("create pseudo console: %w", err)
	}
	// ConPTY holds references to inPipeR and outPipeW; caller must close them.
	_ = windows.CloseHandle(inPipeR)
	_ = windows.CloseHandle(outPipeW)

	// 3. Attach PseudoConsole to child process StartupInfoEx
	al, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		windows.ClosePseudoConsole(hPC)
		_ = windows.CloseHandle(inPipeW)
		_ = windows.CloseHandle(outPipeR)
		return nil, fmt.Errorf("new proc thread attribute list: %w", err)
	}
	defer al.Delete()

	if err := al.Update(windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, *(*unsafe.Pointer)(unsafe.Pointer(&hPC)), unsafe.Sizeof(hPC)); err != nil {
		windows.ClosePseudoConsole(hPC)
		_ = windows.CloseHandle(inPipeW)
		_ = windows.CloseHandle(outPipeR)
		return nil, fmt.Errorf("update proc thread attribute: %w", err)
	}

	var siEx windows.StartupInfoEx
	siEx.Cb = uint32(unsafe.Sizeof(siEx))
	siEx.ProcThreadAttributeList = al.List()
	siEx.StartupInfo.Flags = windows.STARTF_USESTDHANDLES

	var pi windows.ProcessInformation
	flags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_UNICODE_ENVIRONMENT)

	var workingDirPtr *uint16
	if opts.WorkingDir != "" && normType != "wsl" {
		workingDirPtr = windows.StringToUTF16Ptr(opts.WorkingDir)
	}

	cmdLine := binary
	for _, a := range args {
		cmdLine += " " + a
	}

	if err := windows.CreateProcess(
		nil,
		windows.StringToUTF16Ptr(cmdLine),
		nil,
		nil,
		false,
		flags,
		nil,
		workingDirPtr,
		&siEx.StartupInfo,
		&pi,
	); err != nil {
		windows.ClosePseudoConsole(hPC)
		_ = windows.CloseHandle(inPipeW)
		_ = windows.CloseHandle(outPipeR)
		return nil, fmt.Errorf("create process %q: %w", cmdLine, err)
	}
	_ = windows.CloseHandle(pi.Thread)

	// Duplicate process handle for the background watcher goroutine so closing pi.Process
	// in sess.Close() does not cause STATUS_INVALID_HANDLE in WaitForSingleObject.
	currentProc, _ := windows.GetCurrentProcess()
	var watcherProc windows.Handle
	_ = windows.DuplicateHandle(currentProc, pi.Process, currentProc, &watcherProc, 0, false, windows.DUPLICATE_SAME_ACCESS)

	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	sessionID := "local-" + hex.EncodeToString(randBytes)

	stdinFile := os.NewFile(uintptr(inPipeW), "conpty_in")
	stdoutFile := os.NewFile(uintptr(outPipeR), "conpty_out")

	sess := &conPtySession{
		id:        sessionID,
		title:     title,
		shellType: normType,
		hPC:       hPC,
		hProcess:  pi.Process,
		stdin:     stdinFile,
		stdout:    stdoutFile,
	}

	// Auto-cleanup on process exit
	if watcherProc != 0 {
		go func() {
			defer windows.CloseHandle(watcherProc)
			_, _ = windows.WaitForSingleObject(watcherProc, windows.INFINITE)
			_ = sess.Close()
		}()
	}

	// Auto-cleanup on context cancellation
	if ctx != nil && ctx.Done() != nil {
		go func() {
			<-ctx.Done()
			_ = sess.Close()
		}()
	}

	return sess, nil
}
