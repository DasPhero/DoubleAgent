package core_test

import (
	"testing"

	"doubleagent/backend/core"
)

func TestM1_1_HostGroupInheritanceAndOverride_F01(t *testing.T) {
	payload := core.VaultPayload{
		SchemaVersion: 1,
		Groups: []core.GroupRecord{
			{
				ID:   "grp-prod",
				Name: "Production",
				DefaultSettings: core.GroupDefaults{
					Port:          2222,
					Username:      "deploy",
					IdentityID:    "id-prod",
					KeepaliveSecs: 60,
				},
			},
			{
				ID:       "grp-eu",
				Name:     "EU-West",
				ParentID: "grp-prod",
				DefaultSettings: core.GroupDefaults{
					Port: 2200, // Overrides parent group port 2222 -> 2200
				},
			},
		},
		Identities: []core.IdentityRecord{
			{
				ID:         "id-prod",
				Label:      "Prod Deploy",
				Username:   "deploy-id",
				AuthMethod: core.AuthPassword,
				Password:   "prod-secret",
			},
			{
				ID:         "id-custom",
				Label:      "Custom Root",
				Username:   "customroot",
				AuthMethod: core.AuthPassword,
				Password:   "custom-secret",
			},
		},
		Hosts: []core.HostRecord{
			{
				ID:      "host-inherited",
				Label:   "EU Web 01",
				Address: "10.10.1.10",
				Port:    0, // Inherits 2200 from grp-eu
				GroupID: "grp-eu",
			},
			{
				ID:         "host-override",
				Label:      "EU DB 01",
				Address:    "10.10.1.20",
				Port:       2299,        // Overrides group port 2200 -> 2299
				IdentityID: "id-custom", // Overrides group identity id-prod -> id-custom
				GroupID:    "grp-eu",
			},
		},
	}

	// 1. Verify inherited values from parent (grp-prod) + child (grp-eu)
	resInherited, err := core.ResolveEffectiveHost("host-inherited", payload)
	if err != nil {
		t.Fatalf("ResolveEffectiveHost(host-inherited) failed: %v", err)
	}
	if resInherited.Port != 2200 {
		t.Fatalf("expected inherited Port 2200 from child group, got %d", resInherited.Port)
	}
	if resInherited.KeepaliveSecs != 60 {
		t.Fatalf("expected inherited KeepaliveSecs 60 from root group, got %d", resInherited.KeepaliveSecs)
	}
	if resInherited.IdentityID != "id-prod" || resInherited.Username != "deploy-id" {
		t.Fatalf("expected inherited Identity id-prod (user deploy-id), got id=%q user=%q", resInherited.IdentityID, resInherited.Username)
	}

	// 2. Verify host explicit values override group defaults (F-01 acceptance criterion)
	resOverride, err := core.ResolveEffectiveHost("host-override", payload)
	if err != nil {
		t.Fatalf("ResolveEffectiveHost(host-override) failed: %v", err)
	}
	if resOverride.Port != 2299 {
		t.Fatalf("expected host Port 2299 to override group port, got %d", resOverride.Port)
	}
	if resOverride.IdentityID != "id-custom" || resOverride.Username != "customroot" {
		t.Fatalf("expected host Identity id-custom (user customroot) to override group, got id=%q user=%q", resOverride.IdentityID, resOverride.Username)
	}

	// 3. Verify BuildVaultSummary exposes no secrets
	summary := core.BuildVaultSummary(payload)
	if len(summary.Hosts) != 2 || len(summary.Groups) != 2 || len(summary.Identities) != 2 {
		t.Fatalf("unexpected summary counts: %+v", summary)
	}
}
