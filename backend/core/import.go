package core

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// ImportSourceType indicates the originating format of the imported data (F-30).
type ImportSourceType string

const (
	ImportSourcePuTTYRegistry ImportSourceType = "putty_registry"
	ImportSourcePuTTYRegFile  ImportSourceType = "putty_reg"
	ImportSourcePuTTYSession  ImportSourceType = "putty_session"
	ImportSourceTermiusJSON   ImportSourceType = "termius_json"
	ImportSourceTermiusCSV    ImportSourceType = "termius_csv"
)

// ImportedForwardRule represents a port forwarding rule extracted during import (F-30).
type ImportedForwardRule struct {
	Type       string `json:"type"` // "L", "R", "D"
	BindPort   uint16 `json:"bindPort"`
	TargetHost string `json:"targetHost"`
	TargetPort uint16 `json:"targetPort"`
}

// ImportedHostEntry represents a normalized host candidate ready for preview and vault insertion (F-30).
type ImportedHostEntry struct {
	Label        string                `json:"label"`
	Address      string                `json:"address"`
	Port         uint16                `json:"port"`
	Username     string                `json:"username"`
	Group        string                `json:"group,omitempty"`
	Tags         []string              `json:"tags,omitempty"`
	KeyPath      string                `json:"keyPath,omitempty"`
	Password     string                `json:"password,omitempty"`
	ProxyCommand string                `json:"proxyCommand,omitempty"`
	ForwardRules []ImportedForwardRule `json:"forwardRules,omitempty"`
	AlreadyExist bool                  `json:"alreadyExist,omitempty"`
}

// ImportScanResult holds the extracted hosts, groups, and any warnings from parsing (F-30).
type ImportScanResult struct {
	SourceType   ImportSourceType    `json:"sourceType"`
	Hosts        []ImportedHostEntry `json:"hosts"`
	Groups       []string            `json:"groups"`
	TotalFound   int                 `json:"totalFound"`
	Warnings     []string            `json:"warnings"`
}

// ImportExecuteOptions specifies which items the user selected to import and options (F-30).
type ImportExecuteOptions struct {
	SelectedHosts []ImportedHostEntry `json:"selectedHosts"`
	DefaultGroup  string              `json:"defaultGroup,omitempty"`
	ImportKeys    bool                `json:"importKeys"`
}

// ImportExecuteResult provides a summary of the successfully imported items (F-30).
type ImportExecuteResult struct {
	HostsImported    int      `json:"hostsImported"`
	GroupsCreated    int      `json:"groupsCreated"`
	KeysImported     int      `json:"keysImported"`
	TunnelsConfigured int     `json:"tunnelsConfigured"`
	Warnings         []string `json:"warnings"`
}

// UnescapePuTTYSessionName unescapes URL-encoded PuTTY session names (e.g. "Prod%20Server" -> "Prod Server").
func UnescapePuTTYSessionName(raw string) string {
	decoded, err := url.PathUnescape(raw)
	if err == nil && decoded != "" {
		return decoded
	}
	return raw
}

// ParsePuTTYPortForwardings parses PuTTY's PortForwardings string (e.g., "L8080=localhost:80,R9000=127.0.0.1:9000,D1080").
func ParsePuTTYPortForwardings(raw string) []ImportedForwardRule {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var rules []ImportedForwardRule
	parts := strings.Split(raw, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if len(p) < 2 {
			continue
		}
		ruleType := strings.ToUpper(p[:1])
		rest := p[1:]

		switch ruleType {
		case "D":
			// Dynamic SOCKS: e.g. "D1080"
			port, err := strconv.Atoi(rest)
			if err == nil && port > 0 && port <= 65535 {
				rules = append(rules, ImportedForwardRule{
					Type:     "D",
					BindPort: uint16(port),
				})
			}
		case "L", "R":
			// Local or Remote: e.g. "8080=localhost:80" or "8080=127.0.0.1:80"
			kv := strings.SplitN(rest, "=", 2)
			if len(kv) == 2 {
				bindPort, err1 := strconv.Atoi(strings.TrimSpace(kv[0]))
				targetParts := strings.SplitN(strings.TrimSpace(kv[1]), ":", 2)
				if err1 == nil && len(targetParts) == 2 {
					tPort, err2 := strconv.Atoi(strings.TrimSpace(targetParts[1]))
					if err2 == nil && bindPort > 0 && tPort > 0 {
						rules = append(rules, ImportedForwardRule{
							Type:       ruleType,
							BindPort:   uint16(bindPort),
							TargetHost: strings.TrimSpace(targetParts[0]),
							TargetPort: uint16(tPort),
						})
					}
				}
			}
		}
	}
	return rules
}

// ParsePuTTYRegContent parses the content of a PuTTY registry export (.reg) file (F-30).
func ParsePuTTYRegContent(content string) ImportScanResult {
	result := ImportScanResult{
		SourceType: ImportSourcePuTTYRegFile,
	}

	scanner := bufio.NewScanner(strings.NewReader(content))
	var currentSession string
	currentProps := make(map[string]string)

	flushCurrent := func() {
		if currentSession == "" || len(currentProps) == 0 {
			return
		}
		host := buildHostFromPuTTYProps(currentSession, currentProps)
		if host.Address != "" {
			result.Hosts = append(result.Hosts, host)
		}
		currentSession = ""
		currentProps = make(map[string]string)
	}

	sessionKeyPrefix := `[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\`
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") {
			continue
		}

		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			flushCurrent()
			if strings.HasPrefix(line, sessionKeyPrefix) {
				rawName := strings.TrimSuffix(strings.TrimPrefix(line, sessionKeyPrefix), "]")
				if rawName != "Default%20Settings" {
					currentSession = UnescapePuTTYSessionName(rawName)
				}
			}
			continue
		}

		if currentSession != "" && strings.Contains(line, "=") {
			parts := strings.SplitN(line, "=", 2)
			key := strings.Trim(strings.TrimSpace(parts[0]), "\"")
			val := strings.TrimSpace(parts[1])

			// Strip quotes or parse dword:
			if strings.HasPrefix(val, "dword:") {
				hexVal := strings.TrimPrefix(val, "dword:")
				if parsed, err := strconv.ParseUint(hexVal, 16, 32); err == nil {
					currentProps[key] = strconv.FormatUint(parsed, 10)
				}
			} else {
				rawStr := strings.Trim(val, "\"")
				rawStr = strings.ReplaceAll(rawStr, `\\`, `\`)
				rawStr = strings.ReplaceAll(rawStr, `\"`, `"`)
				currentProps[key] = rawStr
			}
		}
	}
	flushCurrent()

	result.TotalFound = len(result.Hosts)
	return result
}

// ParsePuTTYSessionFile parses a single Linux PuTTY session file from ~/.putty/sessions/<name> (F-30).
func ParsePuTTYSessionFile(sessionName, content string) (ImportedHostEntry, error) {
	props := make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "\\", 2)
		if len(parts) == 2 {
			props[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		} else {
			parts = strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				props[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
			}
		}
	}

	entry := buildHostFromPuTTYProps(sessionName, props)
	if entry.Address == "" {
		return ImportedHostEntry{}, fmt.Errorf("no HostName in PuTTY session %q", sessionName)
	}
	return entry, nil
}

func buildHostFromPuTTYProps(label string, props map[string]string) ImportedHostEntry {
	rawHost := props["HostName"]
	username := props["UserName"]
	port := uint16(22)

	if pStr, ok := props["PortNumber"]; ok && pStr != "" {
		if p, err := strconv.Atoi(pStr); err == nil && p > 0 && p <= 65535 {
			port = uint16(p)
		}
	}

	// If rawHost contains user@address:port
	if strings.Contains(rawHost, "@") {
		uParts := strings.SplitN(rawHost, "@", 2)
		if username == "" {
			username = uParts[0]
		}
		rawHost = uParts[1]
	}

	// Address might contain :port
	if strings.Contains(rawHost, ":") && !strings.Contains(rawHost, "[") {
		hParts := strings.SplitN(rawHost, ":", 2)
		rawHost = hParts[0]
		if p, err := strconv.Atoi(hParts[1]); err == nil && p > 0 && p <= 65535 {
			port = uint16(p)
		}
	}

	keyPath := props["PublicKeyFile"]
	rules := ParsePuTTYPortForwardings(props["PortForwardings"])

	return ImportedHostEntry{
		Label:        label,
		Address:      strings.TrimSpace(rawHost),
		Port:         port,
		Username:     strings.TrimSpace(username),
		KeyPath:      strings.TrimSpace(keyPath),
		ForwardRules: rules,
	}
}

// ParseTermiusJSON parses Termius exported JSON files (supports flat array or {hosts, groups} root) (F-30).
func ParseTermiusJSON(content string) ImportScanResult {
	result := ImportScanResult{
		SourceType: ImportSourceTermiusJSON,
	}

	// 1. Try generic map / structure
	var rootObj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &rootObj); err == nil {
		// Check for "hosts" key
		if hostsRaw, ok := rootObj["hosts"]; ok {
			var hostsList []map[string]interface{}
			if err := json.Unmarshal(hostsRaw, &hostsList); err == nil {
				// Also extract group lookup if present
				groupMap := make(map[string]string)
				if groupsRaw, ok := rootObj["groups"]; ok {
					var groupsList []map[string]interface{}
					if err := json.Unmarshal(groupsRaw, &groupsList); err == nil {
						for _, g := range groupsList {
							gid := fmt.Sprintf("%v", g["id"])
							glabel := fmt.Sprintf("%v", g["label"])
							if glabel == "" || glabel == "<nil>" {
								glabel = fmt.Sprintf("%v", g["name"])
							}
							if gid != "" && glabel != "" && glabel != "<nil>" {
								groupMap[gid] = glabel
								result.Groups = append(result.Groups, glabel)
							}
						}
					}
				}

				for _, h := range hostsList {
					entry := parseTermiusHostItem(h, groupMap)
					if entry.Address != "" {
						result.Hosts = append(result.Hosts, entry)
					}
				}
				result.TotalFound = len(result.Hosts)
				return result
			}
		}
	}

	// 2. Try direct array of hosts
	var flatHosts []map[string]interface{}
	if err := json.Unmarshal([]byte(content), &flatHosts); err == nil {
		for _, h := range flatHosts {
			entry := parseTermiusHostItem(h, nil)
			if entry.Address != "" {
				result.Hosts = append(result.Hosts, entry)
			}
		}
		result.TotalFound = len(result.Hosts)
		return result
	}

	result.Warnings = append(result.Warnings, "Could not find valid Termius host entries in JSON export.")
	return result
}

func parseTermiusHostItem(h map[string]interface{}, groupMap map[string]string) ImportedHostEntry {
	label := getString(h, "label", "name", "title")
	address := getString(h, "address", "hostname", "ip", "host")
	username := getString(h, "username", "user")
	port := uint16(22)

	if pVal, ok := h["port"]; ok {
		switch v := pVal.(type) {
		case float64:
			if v > 0 && v <= 65535 {
				port = uint16(v)
			}
		case string:
			if p, err := strconv.Atoi(v); err == nil && p > 0 && p <= 65535 {
				port = uint16(p)
			}
		}
	}

	group := getString(h, "group", "group_name")
	if group == "" {
		if gid := getString(h, "group_id"); gid != "" && groupMap != nil {
			group = groupMap[gid]
		}
	}

	var tags []string
	if rawTags, ok := h["tags"].([]interface{}); ok {
		for _, t := range rawTags {
			if s, ok := t.(string); ok && strings.TrimSpace(s) != "" {
				tags = append(tags, strings.TrimSpace(s))
			}
		}
	}

	if label == "" {
		label = address
	}

	return ImportedHostEntry{
		Label:    label,
		Address:  address,
		Port:     port,
		Username: username,
		Group:    group,
		Tags:     tags,
	}
}

// ParseTermiusCSV parses Termius exported CSV files (Label, Address, Port, Username, Group, Tags) (F-30).
func ParseTermiusCSV(content string) ImportScanResult {
	result := ImportScanResult{
		SourceType: ImportSourceTermiusCSV,
	}

	reader := csv.NewReader(strings.NewReader(content))
	records, err := reader.ReadAll()
	if err != nil {
		result.Warnings = append(result.Warnings, fmt.Sprintf("CSV parse error: %v", err))
		return result
	}

	if len(records) < 2 {
		result.Warnings = append(result.Warnings, "CSV contains no data rows.")
		return result
	}

	// Detect header columns
	headers := records[0]
	colMap := make(map[string]int)
	for i, h := range headers {
		colMap[strings.ToLower(strings.TrimSpace(h))] = i
	}

	for lineIdx, row := range records[1:] {
		getValue := func(keys ...string) string {
			for _, k := range keys {
				if idx, ok := colMap[k]; ok && idx < len(row) {
					return strings.TrimSpace(row[idx])
				}
			}
			return ""
		}

		address := getValue("address", "hostname", "ip", "host")
		if address == "" {
			continue
		}

		label := getValue("label", "name", "title")
		if label == "" {
			label = address
		}

		username := getValue("username", "user")
		port := uint16(22)
		if pStr := getValue("port"); pStr != "" {
			if p, err := strconv.Atoi(pStr); err == nil && p > 0 && p <= 65535 {
				port = uint16(p)
			}
		}

		group := getValue("group", "group_name")
		var tags []string
		if tStr := getValue("tags", "tag"); tStr != "" {
			parts := strings.Split(tStr, ",")
			for _, p := range parts {
				trimmed := strings.TrimSpace(p)
				if trimmed != "" {
					tags = append(tags, trimmed)
				}
			}
		}

		result.Hosts = append(result.Hosts, ImportedHostEntry{
			Label:    label,
			Address:  address,
			Port:     port,
			Username: username,
			Group:    group,
			Tags:     tags,
		})
		_ = lineIdx
	}

	result.TotalFound = len(result.Hosts)
	return result
}

func getString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if val, ok := m[k]; ok && val != nil {
			s := strings.TrimSpace(fmt.Sprintf("%v", val))
			if s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}
