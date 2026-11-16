package core_test

import (
	"os"
	"path/filepath"
	"testing"

	"doubleagent/backend/core"
)

func TestExternalTemplatesRoundTripAndDefaults(t *testing.T) {
	dir := t.TempDir()

	// 1. Finding templates bootstrap defaults to external JSON file
	fPath := filepath.Join(dir, core.FindingTemplatesFileName)
	findings, err := core.LoadFindingTemplates(fPath)
	if err != nil {
		t.Fatalf("LoadFindingTemplates initial: %v", err)
	}
	if len(findings) == 0 {
		t.Fatal("expected seeded default finding templates")
	}
	if _, err := os.Stat(fPath); err != nil {
		t.Fatalf("expected %s to be initialized on disk: %v", fPath, err)
	}

	findings = append(findings, core.FindingItem{
		ID:       "tpl-custom-1",
		Title:    "Custom Redis Unauth Access",
		Category: "Network",
		Severity: "high",
	})
	if err := core.SaveFindingTemplates(fPath, findings); err != nil {
		t.Fatalf("SaveFindingTemplates: %v", err)
	}
	reloadedFindings, err := core.LoadFindingTemplates(fPath)
	if err != nil {
		t.Fatalf("LoadFindingTemplates reload: %v", err)
	}
	if len(reloadedFindings) != len(findings) || reloadedFindings[len(reloadedFindings)-1].ID != "tpl-custom-1" {
		t.Fatalf("expected custom finding template to persist, got %+v", reloadedFindings)
	}

	// 2. Evidence templates bootstrap defaults to external JSON file
	ePath := filepath.Join(dir, core.EvidenceTemplatesFileName)
	evidences, err := core.LoadEvidenceTemplates(ePath)
	if err != nil {
		t.Fatalf("LoadEvidenceTemplates initial: %v", err)
	}
	if len(evidences) == 0 {
		t.Fatal("expected seeded default evidence templates")
	}
	if _, err := os.Stat(ePath); err != nil {
		t.Fatalf("expected %s to be initialized on disk: %v", ePath, err)
	}

	// 3. Report templates bootstrap defaults and save custom updates
	rPath := filepath.Join(dir, core.ReportTemplatesFileName)
	reps, err := core.LoadReportTemplates(rPath)
	if err != nil {
		t.Fatalf("LoadReportTemplates initial: %v", err)
	}
	if len(reps) < 4 {
		t.Fatalf("expected at least 4 seeded report templates, got %d", len(reps))
	}
	reps[0].Author = "Red Team Lead"
	if err := core.SaveReportTemplates(rPath, reps); err != nil {
		t.Fatalf("SaveReportTemplates: %v", err)
	}
	reloadedReps, err := core.LoadReportTemplates(rPath)
	if err != nil {
		t.Fatalf("LoadReportTemplates reload: %v", err)
	}
	if reloadedReps[0].Author != "Red Team Lead" {
		t.Fatalf("expected updated Author in report templates, got %q", reloadedReps[0].Author)
	}

	// 4. Directory override appends default filename
	dirOverride := core.ResolveManagedJSONFilePath(dir+string(filepath.Separator), core.ReportTemplatesFileName)
	if dirOverride != rPath {
		t.Fatalf("expected directory override to resolve %q, got %q", rPath, dirOverride)
	}
}
