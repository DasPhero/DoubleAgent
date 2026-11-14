package core

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
)

var (
	// ErrTemplateNotFound indicates the requested payload template ID does not exist in the templates store.
	ErrTemplateNotFound = errors.New("payload template not found")
	// ErrEmptyPayloadCommand indicates the template defines no command.
	ErrEmptyPayloadCommand = errors.New("payload template command must not be empty")
)

// ResolveDefaultPayloadFilePath locates or resolves the external JSON file used to store payload templates (F-33).
// Does not hardcode payloads in the binary; templates are read dynamically from this file.
func ResolveDefaultPayloadFilePath(customPath string) string {
	if strings.TrimSpace(customPath) != "" {
		return filepath.Clean(customPath)
	}

	// 1. Check local working directory (e.g. workspace data directory)
	localCandidate := filepath.Join("data", "payload_templates.json")
	if fi, err := os.Stat(localCandidate); err == nil && !fi.IsDir() {
		return localCandidate
	}
	rootCandidate := "payload_templates.json"
	if fi, err := os.Stat(rootCandidate); err == nil && !fi.IsDir() {
		return rootCandidate
	}

	// 2. User configuration directory: <UserConfigDir>/DoubleAgent/payload_templates.json
	cfgDir, err := os.UserConfigDir()
	if err == nil && cfgDir != "" {
		return filepath.Join(cfgDir, "DoubleAgent", "payload_templates.json")
	}

	// 3. Fallback to temp directory
	return filepath.Join(os.TempDir(), "doubleagent-payload_templates.json")
}

// LoadPayloadTemplates reads and parses payload templates from the external JSON file (F-33).
// If the file does not exist, it safely initializes an empty template file so users can populate it.
func LoadPayloadTemplates(filePath string) ([]PayloadTemplate, error) {
	targetPath := ResolveDefaultPayloadFilePath(filePath)

	data, err := os.ReadFile(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Initialize empty template file ready for population
			emptyList := []PayloadTemplate{}
			if writeErr := SavePayloadTemplates(targetPath, emptyList); writeErr != nil {
				return nil, fmt.Errorf("failed to initialize empty payload template file at %q: %w", targetPath, writeErr)
			}
			return emptyList, nil
		}
		return nil, fmt.Errorf("failed to read payload templates file at %q: %w", targetPath, err)
	}

	// Handle empty file
	if len(strings.TrimSpace(string(data))) == 0 {
		return []PayloadTemplate{}, nil
	}

	var templates []PayloadTemplate
	if err := json.Unmarshal(data, &templates); err != nil {
		return nil, fmt.Errorf("failed to parse payload templates JSON from %q: %w", targetPath, err)
	}

	return templates, nil
}

// SavePayloadTemplates writes payload templates to the specified external JSON file (F-33).
func SavePayloadTemplates(filePath string, templates []PayloadTemplate) error {
	targetPath := ResolveDefaultPayloadFilePath(filePath)

	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("failed to create directory %q: %w", dir, err)
	}

	if templates == nil {
		templates = []PayloadTemplate{}
	}

	data, err := json.MarshalIndent(templates, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize payload templates: %w", err)
	}

	// Atomic write
	tmpFile := targetPath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0o600); err != nil {
		return fmt.Errorf("failed to write temporary payload file: %w", err)
	}

	if err := os.Rename(tmpFile, targetPath); err != nil {
		_ = os.Remove(tmpFile)
		return fmt.Errorf("failed to atomically update payload templates file: %w", err)
	}

	return nil
}

// GetPayloadFileConfig retrieves current configuration status of the external payload templates file (F-33).
func GetPayloadFileConfig(filePath string) PayloadFileConfig {
	targetPath := ResolveDefaultPayloadFilePath(filePath)
	cfg := PayloadFileConfig{
		FilePath: targetPath,
	}

	fi, err := os.Stat(targetPath)
	if err == nil && !fi.IsDir() {
		cfg.Exists = true
		cfg.LastModified = fi.ModTime().UTC().Format(time.RFC3339)

		// Attempt count
		if tmpls, loadErr := LoadPayloadTemplates(targetPath); loadErr == nil {
			cfg.TemplateCount = len(tmpls)
		}
	}

	return cfg
}

// RenderPayload generates the final command string from a PayloadTemplate by substituting LHOST, LPORT,
// evaluating custom variables, applying optional encodings, and inspecting OPSEC risk (F-33).
func RenderPayload(tmpl PayloadTemplate, opts PayloadRenderOptions) (*PayloadRenderResult, error) {
	rawCmd := strings.TrimSpace(tmpl.Command)
	if rawCmd == "" {
		return nil, ErrEmptyPayloadCommand
	}

	lhost := strings.TrimSpace(opts.LHOST)
	if lhost == "" {
		lhost = "10.10.14.1" // Standard pentest fallback placeholder
	}

	lport := opts.LPORT
	if lport == 0 {
		if tmpl.DefaultPort > 0 {
			lport = tmpl.DefaultPort
		} else {
			lport = 443 // Stealth egress default port (Spec Section 4)
		}
	}

	resolvedVars := make(map[string]string)
	resolvedVars["LHOST"] = lhost
	resolvedVars["LPORT"] = fmt.Sprintf("%d", lport)

	// Ingest custom variables
	if opts.CustomVars != nil {
		for k, v := range opts.CustomVars {
			resolvedVars[strings.ToUpper(strings.TrimSpace(k))] = v
		}
	}

	// Variable substitution: matches {{LHOST}}, {{LPORT}}, {{VAR}}, etc.
	rendered := snippetVarRegex.ReplaceAllStringFunc(rawCmd, func(match string) string {
		rawInside := strings.TrimSpace(match[2 : len(match)-2])
		name, defaultVal, _, _ := parseSnippetVariableSpec(rawInside)
		upperName := strings.ToUpper(name)

		switch upperName {
		case "LHOST", "HOST", "IP":
			return lhost
		case "LPORT", "PORT":
			return fmt.Sprintf("%d", lport)
		default:
			if val, ok := resolvedVars[upperName]; ok && val != "" {
				return val
			}
			if defaultVal != "" {
				return defaultVal
			}
			return match
		}
	})

	// Also substitute simple placeholders like $LHOST or %LHOST% if present in templates
	rendered = strings.ReplaceAll(rendered, "$LHOST", lhost)
	rendered = strings.ReplaceAll(rendered, "$LPORT", fmt.Sprintf("%d", lport))
	rendered = strings.ReplaceAll(rendered, "%LHOST%", lhost)
	rendered = strings.ReplaceAll(rendered, "%LPORT%", fmt.Sprintf("%d", lport))

	// OPSEC Analysis (Threat Model & Spec Section 4: "Payload/Listener auf lautem Port")
	var opsecWarnings []string
	if lport == 4444 || lport == 1337 || lport == 31337 || lport == 6667 {
		opsecWarnings = append(opsecWarnings, fmt.Sprintf("Port %d is a widely signatured Metasploit/CTF default; consider stealth egress ports like 443, 80, or 53.", lport))
	}
	if lhost == "127.0.0.1" || lhost == "localhost" || lhost == "0.0.0.0" {
		opsecWarnings = append(opsecWarnings, fmt.Sprintf("LHOST %q is a local loopback address; reverse shells will not connect from external targets.", lhost))
	}
	if tmpl.OpsecRisk == "high" && tmpl.Notes != "" {
		opsecWarnings = append(opsecWarnings, fmt.Sprintf("Template OPSEC risk high: %s", tmpl.Notes))
	}

	// Encoding Transformation
	encoding := strings.ToLower(strings.TrimSpace(opts.Encoding))
	if encoding == "" {
		encoding = "none"
	}

	finalRendered := rendered
	switch encoding {
	case "none", "raw":
		finalRendered = rendered
	case "base64":
		finalRendered = base64.StdEncoding.EncodeToString([]byte(rendered))
	case "url":
		finalRendered = url.QueryEscape(rendered)
	case "powershell_b64":
		// PowerShell expects UTF-16LE bytes encoded into Base64 for -EncodedCommand
		utf16Runes := utf16.Encode([]rune(rendered))
		utf16Bytes := make([]byte, len(utf16Runes)*2)
		for i, r := range utf16Runes {
			utf16Bytes[i*2] = byte(r)
			utf16Bytes[i*2+1] = byte(r >> 8)
		}
		b64 := base64.StdEncoding.EncodeToString(utf16Bytes)
		finalRendered = fmt.Sprintf("powershell.exe -nop -w hidden -e %s", b64)
	case "hex":
		finalRendered = hex.EncodeToString([]byte(rendered))
	default:
		// Unsupported encoding, fallback to raw
		finalRendered = rendered
	}

	return &PayloadRenderResult{
		TemplateID:    tmpl.ID,
		RawCommand:    rawCmd,
		Rendered:      finalRendered,
		Encoding:      encoding,
		OpsecWarnings: opsecWarnings,
		ResolvedVars:  resolvedVars,
	}, nil
}

// PayloadToSnippet converts a rendered payload into a reusable Snippet entity for Vault storage (F-33, F-15).
func PayloadToSnippet(tmpl PayloadTemplate, renderedResult string, snippetName string) Snippet {
	name := strings.TrimSpace(snippetName)
	if name == "" {
		name = fmt.Sprintf("Payload: %s (%s)", tmpl.Name, strings.ToUpper(tmpl.Shell))
	}

	tags := append([]string{"payload", tmpl.Shell, tmpl.OS, tmpl.Kind}, tmpl.Tags...)

	return Snippet{
		ID:               fmt.Sprintf("snip-payload-%d", time.Now().UnixNano()),
		Name:             name,
		Description:      fmt.Sprintf("Generated from payload template %s (%s)", tmpl.Name, tmpl.OS),
		Body:             renderedResult,
		Tags:             tags,
		ConfirmBeforeRun: true,
	}
}

