//go:build !windows
package ssh

import (
	"os/exec"
)

// setProcAttr is a no-op on Unix platforms.
func setProcAttr(cmd *exec.Cmd) {
}
