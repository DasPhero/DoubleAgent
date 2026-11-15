package core_test

import (
	"testing"
	"time"

	"doubleagent/backend/core"
)

func TestBuildCompiledReport_PerHostGroupingAndIntegrity_F30(t *testing.T) {
	t1 := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 11, 15, 12, 30, 0, 0, time.UTC)

	payload := core.VaultPayload{
		Engagements: []core.Engagement{
			{ID: "eng-1", Name: "ACME Red Team", Scope: "10.10.0.0/16", Timeframe: "2026-11"},
		},
		Hosts: []core.HostRecord{
			{ID: "h-dc", Label: "DC01", Address: "10.10.20.10", Tags: []string{"ad", "dc"}},
			{ID: "h-web", Label: "WEB01", Address: "10.10.20.50", Tags: []string{"web"}},
		},
		Findings: []core.FindingItem{
			{
				ID:           "f-low",
				EngagementID: "eng-1",
				HostID:       "h-web",
				Title:        "Verbose Server Header",
				Category:     "Web",
				Severity:     "low",
				Status:       core.FindingStatusConfirmed,
				Description:  "Nginx banner exposed.",
				CreatedAt:    t1,
				UpdatedAt:    t1,
			},
			{
				ID:           "f-crit",
				EngagementID: "eng-1",
				HostID:       "h-dc",
				Title:        "Kerberoastable Domain Admin SPN",
				Category:     "Active Directory",
				Severity:     "critical",
				Status:       core.FindingStatusConfirmed,
				CVSS:         "9.1",
				MitreAttack:  "T1558.003",
				Description:  "Service account has weak RC4 password.",
				EvidenceIDs:  []string{"ev-rep", "ev-int"},
				NoteIDs:      []string{"n-1"},
				CreatedAt:    t1,
				UpdatedAt:    t2,
			},
		},
		Evidence: []core.EvidenceItem{
			{
				ID:           "ev-rep",
				EngagementID: "eng-1",
				FindingID:    "f-crit",
				HostID:       "h-dc",
				Category:     "Active Directory",
				Title:        "GetUserSPNs Proof",
				Type:         core.EvidenceTypeText,
				Content:      "$krb5tgs$23$*svc_sql*",
				Source:       "impacket",
				CapturedAt:   t2,
				InReport:     true,
			},
			{
				ID:           "ev-int",
				EngagementID: "eng-1",
				FindingID:    "f-crit",
				HostID:       "h-dc",
				Category:     "Credentials",
				Title:        "Raw Internal Scratchpad Dump",
				Type:         core.EvidenceTypeText,
				Content:      "internal secret dump",
				Source:       "manual",
				CapturedAt:   t2,
				InReport:     false,
			},
			{
				ID:           "ev-tbl",
				EngagementID: "eng-1",
				HostID:       "h-web",
				Category:     "Open Ports/Services",
				Title:        "Exposed Admin Endpoints",
				Type:         core.EvidenceTypeTable,
				Content:      `{"headers":["Path","Code"],"rows":[["/admin","200"]]}`,
				Source:       "ffuf",
				CapturedAt:   t1,
				InReport:     true,
			},
		},
		PortFindings: []core.PortFinding{
			{ID: "pf-80", HostID: "h-web", EngagementID: "eng-1", Port: 80, Protocol: "tcp", Service: "http", State: "open", Source: "nmap", CreatedAt: t1},
			{ID: "pf-88", HostID: "h-dc", EngagementID: "eng-1", Port: 88, Protocol: "tcp", Service: "kerberos", State: "open", Source: "nmap", CreatedAt: t1},
		},
		Notes: []core.NotePage{
			{ID: "n-1", HostID: "h-dc", Title: "AD Killchain", Body: "Kerberoast -> DA", UpdatedAt: t2},
		},
	}

	// 1. All-hosts grouped compilation (internal excluded by default)
	doc, err := core.BuildCompiledReport(core.ReportExportRequest{
		EngagementID:            "eng-1",
		Format:                  core.ReportFormatMarkdown,
		IncludePortFindings:     true,
		IncludeUnlinkedEvidence: true,
		IncludeLinkedNotes:      true,
	}, payload)
	if err != nil {
		t.Fatalf("BuildCompiledReport failed: %v", err)
	}
	if doc.TotalFindings != 2 || doc.TotalEvidence != 2 || doc.InternalExcludedCount != 1 {
		t.Fatalf("unexpected counts: findings=%d evidence=%d excluded=%d", doc.TotalFindings, doc.TotalEvidence, doc.InternalExcludedCount)
	}
	if len(doc.HostSections) != 2 {
		t.Fatalf("expected 2 host sections (DC01, WEB01), got %d", len(doc.HostSections))
	}
	if doc.HostSections[0].HostLabel != "DC01" || len(doc.HostSections[0].Findings[0].Evidence) != 1 {
		t.Fatalf("expected DC01 with 1 reportable finding evidence, got %+v", doc.HostSections[0])
	}
	if doc.HostSections[1].HostLabel != "WEB01" || doc.HostSections[1].StandaloneEvidence[0].Table == nil {
		t.Fatalf("expected WEB01 parsed table evidence, got %+v", doc.HostSections[1])
	}
	if doc.DeterministicTimestamp != "2026-11-15T12:30:00Z" {
		t.Fatalf("unexpected deterministic timestamp: %s", doc.DeterministicTimestamp)
	}

	// 2. Single-host filter with internal evidence explicitly enabled
	single, err := core.BuildCompiledReport(core.ReportExportRequest{
		EngagementID:            "eng-1",
		HostID:                  "h-dc",
		Format:                  core.ReportFormatHTML,
		IncludeInternalEvidence: true,
		IncludePortFindings:     true,
		IncludeUnlinkedEvidence: true,
		IncludeLinkedNotes:      true,
	}, payload)
	if err != nil {
		t.Fatalf("single-host BuildCompiledReport failed: %v", err)
	}
	if len(single.HostSections) != 1 || single.TotalFindings != 1 || single.TotalEvidence != 2 {
		t.Fatalf("unexpected single host compiled result: %+v", single)
	}

	if slug := core.SanitizeReportSlug("..\\..\\evil/host:01"); slug != "evil_host_01" {
		t.Fatalf("unexpected sanitized slug: %q", slug)
	}
}

