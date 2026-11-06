//go:build windows
package ssh

import (
	"os/exec"
	"syscall"
)

// setProcAttr configures OS-specific process attributes for spawned ProxyCommand processes.
// On Windows, it hides the console window to prevent intrusive popups.
func setProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}

