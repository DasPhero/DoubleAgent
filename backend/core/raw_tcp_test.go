package core

import (
	"testing"
)

func TestValidateRawTcpConfig_F31(t *testing.T) {
	// Valid default
	cfg := DefaultRawTcpConfig()
	if err := ValidateRawTcpConfig(cfg); err != nil {
		t.Fatalf("DefaultRawTcpConfig should be valid: %v", err)
	}

	// Empty host
	invalidCfg := cfg
	invalidCfg.Host = "   "
	if err := ValidateRawTcpConfig(invalidCfg); err == nil {
		t.Errorf("expected error for empty host, got nil")
	}

	// Zero port
	invalidCfg = cfg
	invalidCfg.Port = 0
	if err := ValidateRawTcpConfig(invalidCfg); err == nil {
		t.Errorf("expected error for port 0, got nil")
	}

	// Invalid line ending
	invalidCfg = cfg
	invalidCfg.LineEnding = "foo"
	if err := ValidateRawTcpConfig(invalidCfg); err == nil {
		t.Errorf("expected error for invalid line ending, got nil")
	}

	// Valid line endings
	for _, ending := range []string{"crlf", "lf", "cr", "CRLF", "LF"} {
		c := cfg
		c.LineEnding = ending
		if err := ValidateRawTcpConfig(c); err != nil {
			t.Errorf("line ending '%s' should be valid: %v", ending, err)
		}
	}
}

func TestValidateRawTcpListenerConfig_F31(t *testing.T) {
	// Valid configs (port 0 is allowed for OS-assigned ephemeral port)
	valid := []RawTcpListenerConfig{
		{Port: 4444, BindAddress: "0.0.0.0", AutoSpawnTab: true},
		{Port: 8080, BindAddress: "127.0.0.1", AutoSpawnTab: false},
		{Port: 9001, BindAddress: ""},
		{Port: 0, BindAddress: "127.0.0.1"},
	}
	for _, cfg := range valid {
		if err := ValidateRawTcpListenerConfig(cfg); err != nil {
			t.Errorf("expected valid config for %+v, got err: %v", cfg, err)
		}
	}

	// Invalid bind IP
	if err := ValidateRawTcpListenerConfig(RawTcpListenerConfig{Port: 4444, BindAddress: "invalid-ip-format"}); err == nil {
		t.Errorf("expected error for invalid bind IP, got nil")
	}
}
