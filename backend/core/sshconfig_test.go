package core

import (
	"strings"
	"testing"
)

func TestM1_3_ParseSSHConfigAndReportUnknown_F22(t *testing.T) {
	sample := `
# Global defaults
Host *
    User ubuntu
    ForwardAgent no

Host bastion
    HostName 203.0.113.10
    User ops
    Port 2222
    IdentityFile ~/.ssh/id_ed25519_bastion

Host app-internal db-internal
    HostName 10.20.0.15
    Port 2200
    ProxyJump bastion, jump2.internal
    Compression yes
`

	res := ParseSSHConfig(sample)
	if len(res.Entries) != 3 {
		t.Fatalf("expected 3 host entries (bastion, app-internal, db-internal), got %d: %+v", len(res.Entries), res.Entries)
	}

	b := res.Entries[0]
	if b.HostAlias != "bastion" || b.HostName != "203.0.113.10" || b.User != "ops" || b.Port != 2222 || b.IdentityFile != "~/.ssh/id_ed25519_bastion" {
		t.Fatalf("unexpected bastion entry: %+v", b)
	}

	app := res.Entries[1]
	// Should inherit User "ubuntu" from Host * global defaults and parse ProxyJump
	if app.HostAlias != "app-internal" || app.HostName != "10.20.0.15" || app.User != "ubuntu" || app.Port != 2200 {
		t.Fatalf("unexpected app-internal entry: %+v", app)
	}
	if len(app.ProxyJump) != 2 || app.ProxyJump[0] != "bastion" || app.ProxyJump[1] != "jump2.internal" {
		t.Fatalf("expected 2 ProxyJump hops on app-internal, got %+v", app.ProxyJump)
	}

	// Verify unknown directives (ForwardAgent, Compression) were reported
	if len(res.Warnings) != 2 {
		t.Fatalf("expected 2 warnings for unsupported directives, got %d: %+v", len(res.Warnings), res.Warnings)
	}
	if !strings.Contains(res.Warnings[0], "ForwardAgent") || !strings.Contains(res.Warnings[1], "Compression") {
		t.Fatalf("expected warnings to mention ForwardAgent and Compression, got %+v", res.Warnings)
	}
}

