package core

import (
	"os"
	"time"
)

const CommandSnippetsFileName = "command_snippets.json"

// SnippetsFileConfig describes the filesystem path and status of external command snippets (F-15).
type SnippetsFileConfig struct {
	FilePath     string `json:"filePath"`
	SnippetCount int    `json:"snippetCount"`
	Exists       bool   `json:"exists"`
	LastModified string `json:"lastModified,omitempty"`
}

// GetDefaultCommandSnippets returns starter operational command snippets with context variables.
func GetDefaultCommandSnippets() []Snippet {
	return []Snippet{
		{
			ID:               "builtin-snip-linux-triage",
			Name:             "Linux: Quick Host & Privilege Triage",
			Description:      "Checks current user identity, OS release, sudo permissions, and active network sockets.",
			Body:             "id; uname -a; ip -brief addr; ss -tulpn || netstat -tulpn",
			Variables:        ExtractSnippetVariables("id; uname -a; ip -brief addr; ss -tulpn || netstat -tulpn"),
			Tags:             []string{"linux", "recon", "triage"},
			ConfirmBeforeRun: true,
		},
		{
			ID:               "builtin-snip-linux-suid",
			Name:             "Linux: Find SUID & Capabilities",
			Description:      "Lists SUID binaries and POSIX file capabilities for local privilege escalation review.",
			Body:             "find / -perm -4000 -type f 2>/dev/null; getcap -r / 2>/dev/null",
			Variables:        []SnippetVariable{},
			Tags:             []string{"linux", "privesc", "suid"},
			ConfirmBeforeRun: true,
		},
		{
			ID:               "builtin-snip-win-triage",
			Name:             "Windows: Token Privileges & Network Overview",
			Description:      "Inspects current user groups, privileges, OS version, and listening ports on Windows.",
			Body:             "whoami /all & ipconfig /all & netstat -ano",
			Variables:        []SnippetVariable{},
			Tags:             []string{"windows", "recon", "triage"},
			ConfirmBeforeRun: true,
		},
		{
			ID:               "builtin-snip-tar-cwd",
			Name:             "Archive Workspace Directory",
			Description:      "Creates a compressed tarball of {{CWD}} stamped with {{DATE}}.",
			Body:             "tar -czf /tmp/backup-{{HOST}}-{{DATE}}.tar.gz {{CWD}}",
			Variables:        ExtractSnippetVariables("tar -czf /tmp/backup-{{HOST}}-{{DATE}}.tar.gz {{CWD}}"),
			Tags:             []string{"linux", "utility"},
			ConfirmBeforeRun: true,
		},
	}
}

// ResolveSnippetsFilePath resolves the external JSON file path for command snippets.
func ResolveSnippetsFilePath(customPath string) string {
	return ResolveManagedJSONFilePath(customPath, CommandSnippetsFileName)
}

// GetSnippetsFileConfig returns disk existence, count, and timestamp for the external command snippets file.
func GetSnippetsFileConfig(filePath string) SnippetsFileConfig {
	target := ResolveSnippetsFilePath(filePath)
	cfg := SnippetsFileConfig{
		FilePath: target,
	}
	if fi, err := os.Stat(target); err == nil && !fi.IsDir() {
		cfg.Exists = true
		cfg.LastModified = fi.ModTime().UTC().Format(time.RFC3339)
		if list, loadErr := LoadSnippetsFromFile(target); loadErr == nil {
			cfg.SnippetCount = len(list)
		}
	}
	return cfg
}

// LoadSnippetsFromFile reads command snippets from an external JSON file, seeding defaults if missing.
func LoadSnippetsFromFile(filePath string) ([]Snippet, error) {
	return loadJSONTemplateList(filePath, CommandSnippetsFileName, GetDefaultCommandSnippets)
}

// SaveSnippetsToFile writes command snippets atomically to the external JSON file.
func SaveSnippetsToFile(filePath string, snippets []Snippet) error {
	target := ResolveSnippetsFilePath(filePath)
	if snippets == nil {
		snippets = []Snippet{}
	}
	return saveJSONFileAtomic(target, snippets)
}
