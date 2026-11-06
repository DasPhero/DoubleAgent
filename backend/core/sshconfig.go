package core

import (
	"fmt"
	"strconv"
	"strings"
)

// SSHConfigHostEntry represents a single parsed Host block from an OpenSSH ssh_config file (F-22).
type SSHConfigHostEntry struct {
	HostAlias    string   `json:"hostAlias"`
	HostName     string   `json:"hostName"`
	User         string   `json:"user"`
	Port         uint16   `json:"port"`
	IdentityFile string   `json:"identityFile"`
	ProxyJump    []string `json:"proxyJump"`
	ProxyCommand string   `json:"proxyCommand,omitempty"`
}

// SSHConfigParseResult holds the extracted Host entries and any unknown/unsupported directive warnings (F-22).
type SSHConfigParseResult struct {
	Entries  []SSHConfigHostEntry `json:"entries"`
	Warnings []string             `json:"warnings"`
}

// ParseSSHConfig parses an OpenSSH config file, extracting Host, HostName, User, Port, IdentityFile, and ProxyJump,
// and reporting any unknown or unsupported directives with line numbers (F-22).
func ParseSSHConfig(content string) SSHConfigParseResult {
	lines := strings.Split(content, "\n")
	var entries []SSHConfigHostEntry
	var warnings []string

	var currentAliases []string
	var current SSHConfigHostEntry
	var globalDefaults SSHConfigHostEntry
	inBlock := false
	isWildcardOnly := false

	flushCurrent := func() {
		if !inBlock || isWildcardOnly {
			return
		}
		for _, alias := range currentAliases {
			if strings.ContainsAny(alias, "*?!") {
				continue
			}
			entry := current
			entry.HostAlias = alias
			if entry.HostName == "" {
				entry.HostName = alias
			}
			if entry.User == "" {
				entry.User = globalDefaults.User
			}
			if entry.Port == 0 {
				if globalDefaults.Port != 0 {
					entry.Port = globalDefaults.Port
				} else {
					entry.Port = 22
				}
			}
			if entry.IdentityFile == "" {
				entry.IdentityFile = globalDefaults.IdentityFile
			}
			if len(entry.ProxyJump) == 0 && len(globalDefaults.ProxyJump) > 0 {
				entry.ProxyJump = append([]string(nil), globalDefaults.ProxyJump...)
			}
			if entry.ProxyCommand == "" {
				entry.ProxyCommand = globalDefaults.ProxyCommand
			}
			entries = append(entries, entry)
		}
	}

	for idx, rawLine := range lines {
		lineNum := idx + 1
		line := strings.TrimSpace(stripInlineComment(rawLine))
		if line == "" {
			continue
		}

		key, val, ok := splitDirective(line)
		if !ok {
			warnings = append(warnings, fmt.Sprintf("Line %d: malformed directive %q", lineNum, line))
			continue
		}

		lowerKey := strings.ToLower(key)
		if lowerKey == "host" {
			flushCurrent()
			aliases := strings.Fields(val)
			currentAliases = aliases
			current = SSHConfigHostEntry{}
			inBlock = len(aliases) > 0
			isWildcardOnly = true
			for _, a := range aliases {
				if !strings.ContainsAny(a, "*?!") {
					isWildcardOnly = false
					break
				}
			}
			continue
		}

		target := &current
		if !inBlock || isWildcardOnly {
			target = &globalDefaults
		}

		switch lowerKey {
		case "hostname":
			target.HostName = strings.Trim(val, "\"")
		case "user":
			target.User = strings.Trim(val, "\"")
		case "port":
			p, err := strconv.Atoi(strings.TrimSpace(val))
			if err != nil || p < 1 || p > 65535 {
				warnings = append(warnings, fmt.Sprintf("Line %d: invalid Port value %q", lineNum, val))
			} else {
				target.Port = uint16(p)
			}
		case "identityfile":
			target.IdentityFile = strings.Trim(val, "\"")
		case "proxyjump":
			jumps := strings.Split(val, ",")
			cleaned := make([]string, 0, len(jumps))
			for _, j := range jumps {
				trimmed := strings.TrimSpace(j)
				if trimmed != "" && !strings.EqualFold(trimmed, "none") {
					cleaned = append(cleaned, trimmed)
				}
			}
			target.ProxyJump = cleaned
		case "proxycommand":
			cmdVal := strings.Trim(val, "\"")
			if !strings.EqualFold(cmdVal, "none") {
				target.ProxyCommand = cmdVal
			}
		default:
			scope := "global"
			if inBlock && len(currentAliases) > 0 {
				scope = "Host " + strings.Join(currentAliases, " ")
			}
			warnings = append(warnings, fmt.Sprintf("Line %d [%s]: unsupported directive %q (%s %s)", lineNum, scope, key, key, val))
		}
	}

	flushCurrent()

	if entries == nil {
		entries = []SSHConfigHostEntry{}
	}
	if warnings == nil {
		warnings = []string{}
	}
	return SSHConfigParseResult{
		Entries:  entries,
		Warnings: warnings,
	}
}

func stripInlineComment(s string) string {
	inQuotes := false
	for i := 0; i < len(s); i++ {
		if s[i] == '"' {
			inQuotes = !inQuotes
		} else if s[i] == '#' && !inQuotes {
			return s[:i]
		}
	}
	return s
}

func splitDirective(line string) (string, string, bool) {
	// OpenSSH allows either "Key Value" or "Key=Value"
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return "", "", false
	}
	for i := 0; i < len(trimmed); i++ {
		c := trimmed[i]
		if c == ' ' || c == '\t' || c == '=' {
			key := strings.TrimSpace(trimmed[:i])
			rest := strings.TrimSpace(trimmed[i+1:])
			rest = strings.TrimPrefix(rest, "=")
			rest = strings.TrimSpace(rest)
			if key == "" || rest == "" {
				return "", "", false
			}
			return key, rest, true
		}
	}
	return "", "", false
}

