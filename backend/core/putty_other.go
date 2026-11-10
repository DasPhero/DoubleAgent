//go:build !windows

package core

import (
	"fmt"
	"os"
	"path/filepath"
)

// ScanLocalPuTTYSessions scans PuTTY saved sessions from ~/.putty/sessions on Unix systems (F-30).
func ScanLocalPuTTYSessions() (ImportScanResult, error) {
	result := ImportScanResult{
		SourceType: ImportSourcePuTTYSession,
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return result, fmt.Errorf("find user home: %w", err)
	}

	sessionsDir := filepath.Join(home, ".putty", "sessions")
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		if os.IsNotExist(err) {
			result.Warnings = append(result.Warnings, fmt.Sprintf("PuTTY sessions directory not found: %s", sessionsDir))
			return result, nil
		}
		return result, err
	}

	for _, d := range entries {
		if d.IsDir() || d.Name() == "Default%20Settings" || d.Name() == "Default Settings" {
			continue
		}
		filePath := filepath.Join(sessionsDir, d.Name())
		raw, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}
		sessionLabel := UnescapePuTTYSessionName(d.Name())
		if host, err := ParsePuTTYSessionFile(sessionLabel, string(raw)); err == nil && host.Address != "" {
			result.Hosts = append(result.Hosts, host)
		}
	}

	result.TotalFound = len(result.Hosts)
	return result, nil
}

