//go:build !windows

package ssh

import (
	"errors"
	"fmt"
	"net"
	"os"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// DefaultAgentSigners connects to the Unix SSH agent socket (SSH_AUTH_SOCK) and returns its signers (F-05).
func DefaultAgentSigners() ([]gossh.Signer, error) {
	sock := os.Getenv("SSH_AUTH_SOCK")
	if sock == "" {
		return nil, errors.New("SSH_AUTH_SOCK is not set")
	}
	conn, err := net.Dial("unix", sock)
	if err != nil {
		return nil, fmt.Errorf("connect to SSH_AUTH_SOCK: %w", err)
	}
	ag := agent.NewClient(conn)
	signers, err := ag.Signers()
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if len(signers) == 0 {
		_ = conn.Close()
		return nil, errors.New("no keys loaded in SSH agent")
	}
	return signers, nil
}

