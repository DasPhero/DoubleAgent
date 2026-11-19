package main

import "testing"

func TestIsRemoteDisplayEnvironmentEnvOverride(t *testing.T) {
	t.Setenv("DOUBLEAGENT_RDP_MODE", "1")
	if !isRemoteDisplayEnvironment() {
		t.Fatalf("expected isRemoteDisplayEnvironment() to return true when DOUBLEAGENT_RDP_MODE=1")
	}

	app := NewApp()
	if !app.IsRemoteDisplayEnvironment() {
		t.Fatalf("expected App.IsRemoteDisplayEnvironment() to return true when DOUBLEAGENT_RDP_MODE=1")
	}

	t.Setenv("DOUBLEAGENT_RDP_MODE", "0")
	if isRemoteDisplayEnvironment() {
		t.Fatalf("expected isRemoteDisplayEnvironment() to return false when DOUBLEAGENT_RDP_MODE=0")
	}
	if app.IsRemoteDisplayEnvironment() {
		t.Fatalf("expected App.IsRemoteDisplayEnvironment() to return false when DOUBLEAGENT_RDP_MODE=0")
	}
}
