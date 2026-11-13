package core_test

import (
	"errors"
	"strings"
	"testing"

	"doubleagent/backend/core"
)

func TestSnippetChain_Validation_F16(t *testing.T) {
	// 1. Missing name
	badChain := core.SnippetChain{
		Name: "",
		Steps: []core.SnippetChainStep{
			{Title: "Step 1", Command: "whoami"},
		},
	}
	if err := core.ValidateSnippetChain(badChain); err == nil {
		t.Fatal("expected error for empty chain name, got nil")
	}

	// 2. No steps
	badChain = core.SnippetChain{
		Name:  "Empty Steps Chain",
		Steps: []core.SnippetChainStep{},
	}
	if err := core.ValidateSnippetChain(badChain); err == nil {
		t.Fatal("expected error for empty chain steps, got nil")
	}

	// 3. Step without command or snippetId
	badChain = core.SnippetChain{
		Name: "Missing Command Chain",
		Steps: []core.SnippetChainStep{
			{Title: "Step 1", Command: ""},
		},
	}
	if err := core.ValidateSnippetChain(badChain); err == nil {
		t.Fatal("expected error for empty step command and snippetId, got nil")
	}

	// 4. Hardcoded plaintext password (violates Threat Model / Spec Section 4)
	badChain = core.SnippetChain{
		Name: "Insecure Password Chain",
		Steps: []core.SnippetChainStep{
			{Title: "Step 1", Command: "sshpass -p password=Secret123 ssh user@host"},
		},
	}
	if err := core.ValidateSnippetChain(badChain); err == nil {
		t.Fatal("expected error for hardcoded plaintext password, got nil")
	}

	// 5. Valid chain with secret variable reference
	validChain := core.SnippetChain{
		ID:          "chain-1",
		Name:        "Valid Escalation Chain",
		StopOnError: true,
		Steps: []core.SnippetChainStep{
			{
				ID:               "step-1",
				Title:            "Enumerate sudo",
				Command:          "sudo -l",
				ConfirmBeforeRun: true,
			},
			{
				ID:               "step-2",
				Title:            "Execute Payload with Secret",
				Command:          "curl -u admin:{{SECRET:cred-vault-1}} http://{{HOST}}:{{PORT=8080}}/exploit",
				ConfirmBeforeRun: true,
			},
		},
	}
	if err := core.ValidateSnippetChain(validChain); err != nil {
		t.Fatalf("expected valid chain to pass, got error: %v", err)
	}
}

func TestSnippetChain_ExtractVariables_F16(t *testing.T) {
	chain := core.SnippetChain{
		ID:   "chain-extract",
		Name: "Variable Extraction Chain",
		Steps: []core.SnippetChainStep{
			{
				Title:   "Step 1",
				Command: "ping -c {{COUNT=4:Packet count}} {{HOST}}",
			},
			{
				Title:   "Step 2",
				Command: "nc -lvnp {{PORT=4444:Listen port}}",
			},
			{
				Title:   "Step 3",
				Command: "echo 'Pinged {{HOST}} on port {{PORT}}'",
			},
		},
	}

	vars := core.ExtractChainVariables(chain)
	if len(vars) != 3 {
		t.Fatalf("expected 3 unique variables (COUNT, HOST, PORT), got %d: %+v", len(vars), vars)
	}

	varMap := make(map[string]core.SnippetVariable)
	for _, v := range vars {
		varMap[strings.ToUpper(v.Name)] = v
	}

	if countVar, ok := varMap["COUNT"]; !ok || countVar.DefaultValue != "4" {
		t.Errorf("expected COUNT variable with default 4, got: %+v", countVar)
	}
	if portVar, ok := varMap["PORT"]; !ok || portVar.DefaultValue != "4444" {
		t.Errorf("expected PORT variable with default 4444, got: %+v", portVar)
	}
	if hostVar, ok := varMap["HOST"]; !ok {
		t.Errorf("expected HOST variable, got nil")
	} else if !core.IsBuiltinSnippetVariable(hostVar.Name) {
		t.Errorf("expected HOST to be identified as built-in variable")
	}
}

func TestSnippetChain_ResolveStep_F16(t *testing.T) {
	ctx := core.SnippetContext{
		HostID:    "host-1",
		HostLabel: "DC-Primary",
		Address:   "10.10.10.5",
		Username:  "pentester",
		Port:      22,
	}

	secrets := map[string]string{
		"cred-ntlm-1": "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0",
	}
	secretResolver := func(ref string) (string, error) {
		if val, ok := secrets[ref]; ok {
			return val, nil
		}
		return "", errors.New("secret not found")
	}

	snippetDb := map[string]*core.Snippet{
		"snip-whoami": {
			ID:   "snip-whoami",
			Name: "Whoami with privs",
			Body: "whoami /priv && echo 'Target Host: {{HOST}}'",
		},
	}
	snippetLookup := func(id string) (*core.Snippet, error) {
		if s, ok := snippetDb[id]; ok {
			return s, nil
		}
		return nil, nil
	}

	// 1. Resolve inline step with secret reference and context variables
	stepInline := core.SnippetChainStep{
		ID:      "step-1",
		Title:   "Pass-The-Hash Step",
		Command: "pth-winexe -U '{{USER}}%{{SECRET:cred-ntlm-1}}' //{{HOST}} cmd.exe",
	}

	resolved, err := core.ResolveChainStep(stepInline, ctx, nil, secretResolver, snippetLookup)
	if err != nil {
		t.Fatalf("failed to resolve inline step: %v", err)
	}
	expected := "pth-winexe -U 'pentester%aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0' //10.10.10.5 cmd.exe"
	if resolved != expected {
		t.Errorf("expected resolved command:\n%s\ngot:\n%s", expected, resolved)
	}

	// 2. Resolve referenced snippet
	stepRef := core.SnippetChainStep{
		ID:        "step-2",
		Title:     "Execute referenced snippet",
		SnippetID: "snip-whoami",
	}

	resolvedSnip, err := core.ResolveChainStep(stepRef, ctx, nil, secretResolver, snippetLookup)
	if err != nil {
		t.Fatalf("failed to resolve referenced snippet step: %v", err)
	}
	if !strings.Contains(resolvedSnip, "whoami /priv") || !strings.Contains(resolvedSnip, "10.10.10.5") {
		t.Errorf("expected resolved snippet to contain whoami /priv and 10.10.10.5, got: %s", resolvedSnip)
	}
}

func TestSnippetChain_FilterByHostAndOS_F16(t *testing.T) {
	chains := []core.SnippetChain{
		{
			ID:       "c-global-any",
			Name:     "Global Any OS",
			HostID:   "",
			TargetOS: "any",
		},
		{
			ID:       "c-global-linux",
			Name:     "Global Linux Only",
			HostID:   "",
			TargetOS: "linux",
		},
		{
			ID:       "c-host1-linux",
			Name:     "Host 1 Linux Specific",
			HostID:   "host-1",
			TargetOS: "linux",
		},
		{
			ID:       "c-host2-windows",
			Name:     "Host 2 Windows Specific",
			HostID:   "host-2",
			TargetOS: "windows",
		},
	}

	// Query for Host 1 (Linux)
	filtered := core.FilterSnippetChains(chains, "host-1", "linux")
	if len(filtered) != 3 {
		t.Fatalf("expected 3 chains for host-1 on linux (c-global-any, c-global-linux, c-host1-linux), got %d", len(filtered))
	}
	for _, c := range filtered {
		if c.ID == "c-host2-windows" {
			t.Errorf("unexpected chain %s in host-1 linux results", c.ID)
		}
	}

	// Query for Host 2 (Windows)
	filteredWin := core.FilterSnippetChains(chains, "host-2", "windows")
	if len(filteredWin) != 2 {
		t.Fatalf("expected 2 chains for host-2 on windows (c-global-any, c-host2-windows), got %d", len(filteredWin))
	}
	if filteredWin[0].ID != "c-global-any" || filteredWin[1].ID != "c-host2-windows" {
		t.Errorf("unexpected windows filtered chains: %+v", filteredWin)
	}
}

func TestSnippetChain_BuiltinPresets_F16(t *testing.T) {
	presets := core.GetBuiltinSnippetChains()
	if len(presets) < 4 {
		t.Fatalf("expected at least 4 built-in preset chains, got %d", len(presets))
	}

	for _, chain := range presets {
		if err := core.ValidateSnippetChain(chain); err != nil {
			t.Errorf("built-in preset chain %q failed validation: %v", chain.Name, err)
		}

		// Spec criterion: "Bestätigung je Schritt als Default; Abbruch bei Fehler; 'ohne Nachfrage' nur bewusst pro Kette freischaltbar"
		if chain.AutoRunWithoutPrompt {
			t.Errorf("built-in preset chain %q must NOT enable AutoRunWithoutPrompt by default (must be false)", chain.Name)
		}

		for i, step := range chain.Steps {
			if !step.ConfirmBeforeRun {
				t.Errorf("built-in preset %q step %d must have ConfirmBeforeRun=true by default", chain.Name, i+1)
			}
		}
	}
}

