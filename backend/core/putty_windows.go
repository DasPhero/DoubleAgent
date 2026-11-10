//go:build windows

package core

import (
	"fmt"
	"strconv"

	"golang.org/x/sys/windows/registry"
)

// ScanLocalPuTTYSessions scans PuTTY saved sessions from the Windows Registry (F-30).
// Location: HKCU\Software\SimonTatham\PuTTY\Sessions
func ScanLocalPuTTYSessions() (ImportScanResult, error) {
	result := ImportScanResult{
		SourceType: ImportSourcePuTTYRegistry,
	}

	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\SimonTatham\PuTTY\Sessions`, registry.READ)
	if err != nil {
		// PuTTY sessions key might not exist if PuTTY was never installed/run on this machine
		result.Warnings = append(result.Warnings, fmt.Sprintf("No local PuTTY sessions registry key found: %v", err))
		return result, nil
	}
	defer k.Close()

	subkeys, err := k.ReadSubKeyNames(-1)
	if err != nil {
		return result, fmt.Errorf("read putty session keys: %w", err)
	}

	for _, sub := range subkeys {
		if sub == "Default%20Settings" || sub == "Default Settings" {
			continue
		}
		sessionKey, err := registry.OpenKey(k, sub, registry.READ)
		if err != nil {
			continue
		}

		sessionLabel := UnescapePuTTYSessionName(sub)
		props := make(map[string]string)

		if host, _, err := sessionKey.GetStringValue("HostName"); err == nil && host != "" {
			props["HostName"] = host
		}
		if user, _, err := sessionKey.GetStringValue("UserName"); err == nil {
			props["UserName"] = user
		}
		if port, _, err := sessionKey.GetIntegerValue("PortNumber"); err == nil && port > 0 {
			props["PortNumber"] = strconv.FormatUint(port, 10)
		}
		if keyPath, _, err := sessionKey.GetStringValue("PublicKeyFile"); err == nil {
			props["PublicKeyFile"] = keyPath
		}
		if fwd, _, err := sessionKey.GetStringValue("PortForwardings"); err == nil {
			props["PortForwardings"] = fwd
		}
		sessionKey.Close()

		if props["HostName"] != "" {
			entry := buildHostFromPuTTYProps(sessionLabel, props)
			result.Hosts = append(result.Hosts, entry)
		}
	}

	result.TotalFound = len(result.Hosts)
	return result, nil
}
