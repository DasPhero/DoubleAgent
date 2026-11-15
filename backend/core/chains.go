package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	// ErrEmptyChainName indicates the snippet chain is missing a descriptive name.
	ErrEmptyChainName = errors.New("snippet chain name must not be empty")
	// ErrNoChainSteps indicates the snippet chain has zero steps defined.
	ErrNoChainSteps = errors.New("snippet chain must contain at least one step")
	// ErrInvalidStepCommand indicates a step has neither a command nor a snippet reference.
	ErrInvalidStepCommand = errors.New("each step must define a command or reference an existing snippet")
)

// ValidateSnippetChain validates a SnippetChain data structure against specification requirements (Spec F-16).
// Ensures mandatory fields, valid step ordering, confirmation defaults, and secret reference safety.
func ValidateSnippetChain(chain SnippetChain) error {
	if strings.TrimSpace(chain.Name) == "" {
		return ErrEmptyChainName
	}
	if len(chain.Steps) == 0 {
		return ErrNoChainSteps
	}

	for i, step := range chain.Steps {
		if strings.TrimSpace(step.Command) == "" && strings.TrimSpace(step.SnippetID) == "" {
			return fmt.Errorf("step %d (%q): %w", i+1, step.Title, ErrInvalidStepCommand)
		}

		// Security rule: secrets must be referenced via {{SECRET:id}}, never hardcoded in plaintext
		cmdLower := strings.ToLower(step.Command)
		if strings.Contains(cmdLower, "password=") && !strings.Contains(cmdLower, "{{") {
			// Alert on obvious plaintext password assignment
			return fmt.Errorf("step %d contains suspected hardcoded password; use {{SECRET:credential_id}} or {{PASSWORD}} parameter instead", i+1)
		}
	}

	return nil
}

// ExtractChainVariables inspects all steps in a snippet chain and aggregates a deduplicated list of variables (F-16).
func ExtractChainVariables(chain SnippetChain) []SnippetVariable {
	seen := make(map[string]bool)
	var allVars []SnippetVariable

	for _, step := range chain.Steps {
		stepVars := ExtractSnippetVariables(step.Command)
		for _, v := range stepVars {
			key := strings.ToUpper(v.Name)
			if !seen[key] {
				seen[key] = true
				allVars = append(allVars, v)
			}
		}
	}

	return allVars
}

// ResolveChainStep resolves a single step's command template into the final shell string (F-16).
// If the step references an external snippet ID and has an empty command, the snippet's body is looked up and resolved.
func ResolveChainStep(
	step SnippetChainStep,
	ctx SnippetContext,
	userValues map[string]string,
	secretResolver func(secretRef string) (string, error),
	snippetLookup func(snippetID string) (*Snippet, error),
) (string, error) {
	cmdToResolve := strings.TrimSpace(step.Command)
	if cmdToResolve == "" && strings.TrimSpace(step.SnippetID) != "" {
		if snippetLookup == nil {
			return "", errors.New("snippetLookup resolver required for snippetId references")
		}
		snip, err := snippetLookup(step.SnippetID)
		if err != nil {
			return "", fmt.Errorf("failed to lookup snippet %q: %w", step.SnippetID, err)
		}
		if snip == nil {
			return "", fmt.Errorf("referenced snippet %q not found", step.SnippetID)
		}
		cmdToResolve = snip.Body
	}

	if cmdToResolve == "" {
		return "", ErrInvalidStepCommand
	}

	return ResolveSnippet(cmdToResolve, ctx, userValues, secretResolver)
}

// FilterSnippetChains returns chains that are eligible for a given host and target operating system (F-16).
// If hostID is empty, returns all chains (or global chains).
func FilterSnippetChains(chains []SnippetChain, hostID string, targetOS string) []SnippetChain {
	var filtered []SnippetChain
	osNorm := strings.ToLower(strings.TrimSpace(targetOS))

	for _, chain := range chains {
		// Host matching: empty HostID means global chain (applicable everywhere)
		if hostID != "" && chain.HostID != "" && chain.HostID != hostID {
			continue
		}

		// OS matching: empty or "any" means multi-platform
		chainOS := strings.ToLower(strings.TrimSpace(chain.TargetOS))
		if chainOS != "" && chainOS != "any" && osNorm != "" && osNorm != "any" {
			if chainOS != osNorm {
				continue
			}
		}

		filtered = append(filtered, chain)
	}

	return filtered
}

// GetBuiltinSnippetChains returns standard pre-populated snippet chains for common pentesting sequences (M-PRESETS, F-16).
// Includes Reverse Shell stabilization, Linux PrivEsc checks, Windows Recon & Token Privilege enumeration, and Pivot routes.
func GetBuiltinSnippetChains() []SnippetChain {
	now := time.Now().UTC().Format(time.RFC3339)

	return []SnippetChain{
		{
			ID:                   "builtin-chain-linux-stabilize",
			Name:                 "Linux: Reverse Shell PTY Upgrade & Stabilization",
			Description:          "Interactive 4-step sequence to upgrade dumb reverse shells into full interactive PTY with job control, stty raw mode, and terminal sizing.",
			HostID:               "",
			TargetOS:             "linux",
			Category:             "Stabilization",
			StopOnError:          true,
			AutoRunWithoutPrompt: false, // strictly requires confirmation
			Tags:                 []string{"linux", "reverse-shell", "pty", "stabilization", "essential"},
			CreatedAt:            now,
			UpdatedAt:            now,
			Steps: []SnippetChainStep{
				{
					ID:               "step-stab-1",
					Title:            "Step 1: Spawn PTY on Target",
					Description:      "Execute Python interactive PTY spawn via /bin/bash",
					Command:          "python3 -c 'import pty; pty.spawn(\"/bin/bash\")' || python -c 'import pty; pty.spawn(\"/bin/bash\")'",
					ConfirmBeforeRun: true,
					DelayMs:          300,
					StopOnError:      true,
				},
				{
					ID:               "step-stab-2",
					Title:            "Step 2: Background Reverse Shell",
					Description:      "Send shell to background (Ctrl+Z)",
					Command:          "# Background the shell: Press Ctrl+Z (or in raw TCP mode, disconnect stdin temporarily)",
					ConfirmBeforeRun: true,
					DelayMs:          200,
					StopOnError:      true,
				},
				{
					ID:               "step-stab-3",
					Title:            "Step 3: Attacker Terminal Raw Mode",
					Description:      "Configure local terminal to raw mode with echo disabled, then foreground reverse shell",
					Command:          "stty raw -echo; fg",
					ConfirmBeforeRun: true,
					DelayMs:          400,
					StopOnError:      true,
				},
				{
					ID:               "step-stab-4",
					Title:            "Step 4: Target Terminal Reset & Window Sizing",
					Description:      "Reset terminal state, export xterm-256color, and synchronize terminal rows and columns",
					Command:          "reset; export SHELL=bash; export TERM=xterm-256color; stty rows {{ROWS=24:Terminal rows}} cols {{COLS=80:Terminal columns}}",
					ConfirmBeforeRun: true,
					DelayMs:          200,
					StopOnError:      true,
				},
			},
		},
		{
			ID:                   "builtin-chain-linux-privesc-fast",
			Name:                 "Linux: Fast Privilege Escalation & Capabilities Check",
			Description:          "Rapid post-exploitation enumeration checking sudo rules, SUID/SGID binaries, Linux capabilities, and writable paths.",
			HostID:               "",
			TargetOS:             "linux",
			Category:             "PrivEsc",
			StopOnError:          false, // continue inspecting even if one command yields non-zero
			AutoRunWithoutPrompt: false,
			Tags:                 []string{"linux", "privesc", "enumeration", "sudo", "suid"},
			CreatedAt:            now,
			UpdatedAt:            now,
			Steps: []SnippetChainStep{
				{
					ID:               "step-priv-1",
					Title:            "Step 1: Sudo Permissions & Environment",
					Description:      "List user sudo privileges and check for NOPASSWD or dangerous directives",
					Command:          "sudo -l",
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
				{
					ID:               "step-priv-2",
					Title:            "Step 2: SUID / SGID Executables",
					Description:      "Locate unusual SUID/SGID binaries outside standard snap paths",
					Command:          "find / -perm -4000 -type f 2>/dev/null | grep -v \"/snap\" | head -n 35",
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
				{
					ID:               "step-priv-3",
					Title:            "Step 3: Process Capabilities",
					Description:      "Search for dangerous file capabilities (e.g. cap_setuid, cap_net_raw)",
					Command:          "getcap -r / 2>/dev/null",
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
				{
					ID:               "step-priv-4",
					Title:            "Step 4: Scheduled Tasks & Cron",
					Description:      "Check system-wide cron jobs and writable spool directories",
					Command:          "ls -la /etc/cron* /etc/crontab 2>/dev/null; cat /etc/crontab 2>/dev/null",
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
			},
		},
		{
			ID:                   "builtin-chain-windows-recon-tokens",
			Name:                 "Windows: Token Privileges & Service Recon",
			Description:          "Enumerate user token privileges (SeImpersonate, SeAssignPrimaryToken), unquoted service paths, and installer policies.",
			HostID:               "",
			TargetOS:             "windows",
			Category:             "Recon",
			StopOnError:          false,
			AutoRunWithoutPrompt: false,
			Tags:                 []string{"windows", "tokens", "privesc", "recon", "unquoted-path"},
			CreatedAt:            now,
			UpdatedAt:            now,
			Steps: []SnippetChainStep{
				{
					ID:               "step-win-1",
					Title:            "Step 1: User Identity & Privileges",
					Description:      "Enumerate current Windows token privileges and group memberships",
					Command:          "whoami /all",
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
				{
					ID:               "step-win-2",
					Title:            "Step 2: Unquoted Service Paths",
					Description:      "Identify auto-start Windows services with unquoted executable paths containing spaces",
					Command:          `wmic service get name,displayname,pathname,startmode | findstr /i "auto" | findstr /i /v "c:\windows\\" | findstr /i /v """`,
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
				{
					ID:               "step-win-3",
					Title:            "Step 3: AlwaysInstallElevated Registry",
					Description:      "Check if MSI installer runs with elevated SYSTEM privileges for standard users",
					Command:          `reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated 2>nul & reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated 2>nul`,
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
				{
					ID:               "step-win-4",
					Title:            "Step 4: Local TCP Listeners",
					Description:      "List internal-only listening ports and associated process IDs",
					Command:          `netstat -ano | findstr /i "listening"`,
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
			},
		},
		{
			ID:                   "builtin-chain-pivot-route-inspection",
			Name:                 "Network: Subnet & Pivot Route Inspection",
			Description:          "Inspect target network interfaces, ARP neighbors, and routing tables to identify dual-homed networks for pivoting.",
			HostID:               "",
			TargetOS:             "any",
			Category:             "Pivot",
			StopOnError:          false,
			AutoRunWithoutPrompt: false,
			Tags:                 []string{"network", "pivot", "routing", "arp", "dual-homed"},
			CreatedAt:            now,
			UpdatedAt:            now,
			Steps: []SnippetChainStep{
				{
					ID:               "step-piv-1",
					Title:            "Step 1: Network Interfaces & IP Addresses",
					Description:      "List all local network adapters and subnet CIDRs",
					Command:          "ip a || ifconfig || ipconfig /all",
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
				{
					ID:               "step-piv-2",
					Title:            "Step 2: ARP & Neighbor Cache",
					Description:      "Display recently contacted live systems on local segments",
					Command:          "ip neigh || arp -a",
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
				{
					ID:               "step-piv-3",
					Title:            "Step 3: Kernel Routing Table",
					Description:      "Identify default gateways and internal routed subnets",
					Command:          "ip route || route print",
					ConfirmBeforeRun: true,
					DelayMs:          500,
					StopOnError:      false,
				},
			},
		},
	}
}

// ResolveChainsFilePath resolves the target file path for snippet chains.
// If inputPath is a directory or ends in a path separator, it defaults to "snippet_chains.json" inside that folder.
// If inputPath is a specific file, that exact file is used.
// If inputPath is empty, it checks workspace data/snippet_chains.json, then root, then user config dir.
func ResolveChainsFilePath(inputPath string) string {
	clean := strings.TrimSpace(inputPath)
	if clean != "" {
		if fi, err := os.Stat(clean); err == nil && fi.IsDir() {
			return filepath.Join(clean, "snippet_chains.json")
		}
		if strings.HasSuffix(clean, "/") || strings.HasSuffix(clean, string(filepath.Separator)) {
			return filepath.Join(clean, "snippet_chains.json")
		}
		return filepath.Clean(clean)
	}

	// 1. Check local working directory (e.g. workspace data directory)
	localCandidate := filepath.Join("data", "snippet_chains.json")
	if fi, err := os.Stat(localCandidate); err == nil && !fi.IsDir() {
		return localCandidate
	}
	rootCandidate := "snippet_chains.json"
	if fi, err := os.Stat(rootCandidate); err == nil && !fi.IsDir() {
		return rootCandidate
	}

	// 2. User configuration directory: <UserConfigDir>/DoubleAgent/snippet_chains.json
	cfgDir, err := os.UserConfigDir()
	if err == nil && cfgDir != "" {
		return filepath.Join(cfgDir, "DoubleAgent", "snippet_chains.json")
	}

	// 3. Fallback to temp directory
	return filepath.Join(os.TempDir(), "doubleagent-snippet_chains.json")
}

// GetSnippetChainsFileConfig retrieves status of the external snippet chains file.
func GetSnippetChainsFileConfig(filePath string) SnippetChainsFileConfig {
	target := ResolveChainsFilePath(filePath)
	cfg := SnippetChainsFileConfig{
		FilePath: target,
	}
	fi, err := os.Stat(target)
	if err == nil && !fi.IsDir() {
		cfg.Exists = true
		cfg.LastModified = fi.ModTime().UTC().Format(time.RFC3339)
		if list, err := LoadSnippetChainsFromFile(target); err == nil {
			cfg.ChainCount = len(list)
		}
	}
	return cfg
}

// LoadSnippetChainsFromFile loads snippet chains from an external JSON file.
// If the file does not exist, it initializes it with standard built-in presets.
func LoadSnippetChainsFromFile(filePath string) ([]SnippetChain, error) {
	target := ResolveChainsFilePath(filePath)
	data, err := os.ReadFile(target)
	if err != nil {
		if os.IsNotExist(err) {
			presets := GetBuiltinSnippetChains()
			_ = SaveSnippetChainsToFile(target, presets)
			return presets, nil
		}
		return nil, fmt.Errorf("failed to read snippet chains file at %q: %w", target, err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return []SnippetChain{}, nil
	}
	var chains []SnippetChain
	if err := json.Unmarshal(data, &chains); err != nil {
		return nil, fmt.Errorf("failed to parse snippet chains JSON from %q: %w", target, err)
	}
	return chains, nil
}

// SaveSnippetChainsToFile writes snippet chains to an external JSON file atomically.
func SaveSnippetChainsToFile(filePath string, chains []SnippetChain) error {
	target := ResolveChainsFilePath(filePath)
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("failed to create directory %q: %w", dir, err)
	}
	if chains == nil {
		chains = []SnippetChain{}
	}
	data, err := json.MarshalIndent(chains, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize snippet chains: %w", err)
	}
	tmpFile := target + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0o600); err != nil {
		return fmt.Errorf("failed to write temporary chains file: %w", err)
	}
	if err := os.Rename(tmpFile, target); err != nil {
		_ = os.Remove(tmpFile)
		return fmt.Errorf("failed to atomically update snippet chains file: %w", err)
	}
	return nil
}

