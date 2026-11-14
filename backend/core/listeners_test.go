package core

import (
	"strings"
	"testing"
)

func TestValidateListenerProfile_F32(t *testing.T) {
	// Valid profile
	valid := ListenerProfile{
		ID:          "prof-1",
		Name:        "HTTPS Listener",
		Kind:        "reverse",
		Tool:        "builtin",
		BindAddress: "0.0.0.0",
		BindPort:    443,
	}
	if err := ValidateListenerProfile(valid); err != nil {
		t.Fatalf("expected valid profile, got error: %v", err)
	}

	// Missing name
	invalidName := valid
	invalidName.Name = "   "
	if err := ValidateListenerProfile(invalidName); err == nil {
		t.Fatalf("expected error for empty name, got nil")
	}

	// Port 0
	invalidPort := valid
	invalidPort.BindPort = 0
	if err := ValidateListenerProfile(invalidPort); err == nil {
		t.Fatalf("expected error for port 0, got nil")
	}

	// Invalid IP
	invalidIP := valid
	invalidIP.BindAddress = "not-an-ip"
	if err := ValidateListenerProfile(invalidIP); err == nil {
		t.Fatalf("expected error for invalid IP, got nil")
	}

	// Invalid Tool
	invalidTool := valid
	invalidTool.Tool = "unknown-tool"
	if err := ValidateListenerProfile(invalidTool); err == nil {
		t.Fatalf("expected error for invalid tool, got nil")
	}
}

func TestAnalyzeListenerOpsec_F32(t *testing.T) {
	// Stealth port on 0.0.0.0 should have no warnings
	warnings := AnalyzeListenerOpsec("reverse", "0.0.0.0", 443)
	if len(warnings) != 0 {
		t.Fatalf("expected 0 warnings for port 443 on 0.0.0.0, got: %v", warnings)
	}

	// Port 4444 (Metasploit default) should have OPSEC warning
	warn4444 := AnalyzeListenerOpsec("reverse", "0.0.0.0", 4444)
	if len(warn4444) == 0 {
		t.Fatalf("expected warning for port 4444, got 0")
	}
	if !strings.Contains(warn4444[0], "Metasploit/CTF") {
		t.Errorf("expected warning mentioning Metasploit/CTF, got: %s", warn4444[0])
	}

	// Loopback address on reverse listener should warn
	warnLoopback := AnalyzeListenerOpsec("reverse", "127.0.0.1", 443)
	if len(warnLoopback) == 0 {
		t.Fatalf("expected warning for loopback address on reverse listener, got 0")
	}
	if !strings.Contains(warnLoopback[0], "127.0.0.1") {
		t.Errorf("expected warning mentioning 127.0.0.1, got: %s", warnLoopback[0])
	}
}

func TestBuildListenerCommand_F32(t *testing.T) {
	// Netcat
	ncProf := ListenerProfile{Tool: "nc", BindPort: 443}
	if cmd := BuildListenerCommand(ncProf); cmd != "nc -lvnp 443" {
		t.Errorf("expected 'nc -lvnp 443', got: %s", cmd)
	}

	// rlwrap
	rlwrapProf := ListenerProfile{Tool: "rlwrap", BindPort: 443}
	if cmd := BuildListenerCommand(rlwrapProf); cmd != "rlwrap -cAr nc -lvnp 443" {
		t.Errorf("expected 'rlwrap -cAr nc -lvnp 443', got: %s", cmd)
	}

	// Ncat SSL
	ncatProf := ListenerProfile{Tool: "ncat-ssl", BindPort: 8443}
	if cmd := BuildListenerCommand(ncatProf); cmd != "ncat --ssl -lvnp 8443" {
		t.Errorf("expected 'ncat --ssl -lvnp 8443', got: %s", cmd)
	}

	// Socat PTY
	socatProf := ListenerProfile{Tool: "socat", BindPort: 443}
	if cmd := BuildListenerCommand(socatProf); !strings.Contains(cmd, "tcp-listen:443") {
		t.Errorf("expected socat command containing 'tcp-listen:443', got: %s", cmd)
	}

	// Built-in
	builtinProf := ListenerProfile{Tool: "builtin", BindPort: 443}
	if cmd := BuildListenerCommand(builtinProf); !strings.Contains(cmd, "443") {
		t.Errorf("expected builtin description containing '443', got: %s", cmd)
	}
}

func TestDefaultBuiltinListenerProfiles_F32(t *testing.T) {
	profiles := DefaultBuiltinListenerProfiles()
	if len(profiles) == 0 {
		t.Fatalf("expected at least 1 default profile, got 0")
	}

	for _, p := range profiles {
		if err := ValidateListenerProfile(p); err != nil {
			t.Errorf("builtin profile %q failed validation: %v", p.Name, err)
		}
	}
}
