package report_test

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"doubleagent/backend/core"
	"doubleagent/backend/report"
)

func buildF30TestPayload(includeXSS bool) core.VaultPayload {
	t1 := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 11, 15, 12, 30, 0, 0, time.UTC)

	title := "Kerberoastable Domain Admin SPN"
	desc := "Service account has weak RC4 password."
	if includeXSS {
		title = `XSS Test <script>alert(1)</script>`
		desc = `<img src=x onerror="alert('xss')">`
	}

	return core.VaultPayload{
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
				Title:        title,
				Category:     "Active Directory",
				Severity:     "critical",
				Status:       core.FindingStatusConfirmed,
				CVSS:         "9.1",
				MitreAttack:  "T1558.003",
				Description:  desc,
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
}

func TestExporter_MarkdownAndHTMLPerHostReproducibility_F30(t *testing.T) {
	payload := buildF30TestPayload(true)
	req := core.ReportExportRequest{
		EngagementID:            "eng-1",
		Format:                  core.ReportFormatMarkdown,
		IncludePortFindings:     true,
		IncludeUnlinkedEvidence: true,
		IncludeLinkedNotes:      true,
	}

	md1, err := report.CompileAndExport(req, payload)
	if err != nil {
		t.Fatalf("CompileAndExport markdown 1 failed: %v", err)
	}
	md2, err := report.CompileAndExport(req, payload)
	if err != nil {
		t.Fatalf("CompileAndExport markdown 2 failed: %v", err)
	}
	if md1.ContentSHA256 == "" || md1.ContentSHA256 != md2.ContentSHA256 || md1.Content != md2.Content {
		t.Fatalf("expected byte-for-byte reproducible markdown export: sha1=%s sha2=%s", md1.ContentSHA256, md2.ContentSHA256)
	}
	if md1.HostCount != 2 || md1.FindingsCount != 2 || md1.InternalExcluded != 1 {
		t.Fatalf("unexpected counts: hosts=%d findings=%d internalExcluded=%d", md1.HostCount, md1.FindingsCount, md1.InternalExcluded)
	}
	for _, want := range []string{
		"DC01",
		"WEB01",
		"GetUserSPNs Proof",
		"impacket",
		"2026-11-15T12:30:00Z",
		"| Path | Code |",
		"| /admin | 200 |",
		"AD Killchain",
	} {
		if !strings.Contains(md1.Content, want) {
			t.Fatalf("markdown export missing %q", want)
		}
	}
	if strings.Contains(md1.Content, "Raw Internal Scratchpad Dump") {
		t.Fatalf("internal evidence (inReport=false) leaked into default markdown export")
	}

	htmlReq := req
	htmlReq.Format = core.ReportFormatHTML
	html1, err := report.CompileAndExport(htmlReq, payload)
	if err != nil {
		t.Fatalf("CompileAndExport html 1 failed: %v", err)
	}
	html2, err := report.CompileAndExport(htmlReq, payload)
	if err != nil {
		t.Fatalf("CompileAndExport html 2 failed: %v", err)
	}
	if html1.ContentSHA256 == "" || html1.ContentSHA256 != html2.ContentSHA256 || html1.Content != html2.Content {
		t.Fatalf("expected byte-for-byte reproducible html export: sha1=%s sha2=%s", html1.ContentSHA256, html2.ContentSHA256)
	}
	if strings.Contains(html1.Content, "<script>alert(1)</script>") {
		t.Fatalf("raw unescaped <script> tag present in HTML output")
	}
	if !strings.Contains(html1.Content, "&lt;script&gt;alert(1)&lt;/script&gt;") {
		t.Fatalf("expected escaped script payload in HTML output")
	}
	if !strings.Contains(html1.Content, "<!DOCTYPE html>") || !strings.Contains(html1.Content, "GetUserSPNs Proof") {
		t.Fatalf("HTML export missing document structure or evidence")
	}
}

func TestExporter_SplitByHostAndFileExport_F30(t *testing.T) {
	payload := buildF30TestPayload(false)
	outDir := t.TempDir()

	batchReq := core.ReportExportRequest{
		EngagementID:            "eng-1",
		Format:                  core.ReportFormatHTML,
		SplitByHost:             true,
		IncludePortFindings:     true,
		IncludeUnlinkedEvidence: true,
		OutputDir:               outDir,
	}
	res, err := report.CompileAndExport(batchReq, payload)
	if err != nil {
		t.Fatalf("SplitByHost export failed: %v", err)
	}
	if len(res.WrittenFiles) != 3 {
		t.Fatalf("expected 2 per-host files + manifest.sha256 written, got %d (%+v)", len(res.WrittenFiles), res.WrittenFiles)
	}
	htmlFiles := 0
	for _, wf := range res.WrittenFiles {
		raw, err := os.ReadFile(wf.FilePath)
		if err != nil {
			t.Fatalf("read written host file %s: %v", wf.FilePath, err)
		}
		sum := sha256.Sum256(raw)
		if hex.EncodeToString(sum[:]) != wf.SHA256 {
			t.Fatalf("checksum mismatch for %s", wf.FilePath)
		}
		if wf.FileName != "manifest.sha256" {
			htmlFiles++
			if !strings.HasSuffix(wf.FileName, ".html") {
				t.Fatalf("expected .html suffix for %s", wf.FileName)
			}
		}
	}
	if htmlFiles != 2 {
		t.Fatalf("expected 2 host HTML files, got %d", htmlFiles)
	}
	manifestBytes, err := os.ReadFile(filepath.Join(outDir, "manifest.sha256"))
	if err != nil {
		t.Fatalf("expected manifest.sha256 in batch export dir: %v", err)
	}
	if !strings.Contains(string(manifestBytes), res.WrittenFiles[0].SHA256) {
		t.Fatalf("manifest.sha256 missing file hash")
	}

	singlePath := filepath.Join(t.TempDir(), "single-dc01.md")
	singleRes, err := report.ExportToFile(core.ReportExportRequest{
		EngagementID:        "eng-1",
		HostID:              "h-dc",
		Format:              core.ReportFormatMarkdown,
		IncludePortFindings: true,
	}, payload, singlePath)
	if err != nil {
		t.Fatalf("ExportToFile single host failed: %v", err)
	}
	diskBytes, err := os.ReadFile(singlePath)
	if err != nil {
		t.Fatalf("read single export file: %v", err)
	}
	diskSum := sha256.Sum256(diskBytes)
	if hex.EncodeToString(diskSum[:]) != singleRes.ContentSHA256 {
		t.Fatalf("single file SHA-256 mismatch")
	}
	if strings.Contains(string(diskBytes), "WEB01") {
		t.Fatalf("single-host filtered export unexpectedly included WEB01")
	}
}

func TestExporter_DocxScaffoldReproducibilityAndXML_F30(t *testing.T) {
	payload := buildF30TestPayload(true)
	req := core.ReportExportRequest{
		EngagementID:            "eng-1",
		Format:                  core.ReportFormatDOCX,
		IncludePortFindings:     true,
		IncludeUnlinkedEvidence: true,
		IncludeLinkedNotes:      true,
	}

	d1, err := report.CompileAndExport(req, payload)
	if err != nil {
		t.Fatalf("CompileAndExport docx 1 failed: %v", err)
	}
	d2, err := report.CompileAndExport(req, payload)
	if err != nil {
		t.Fatalf("CompileAndExport docx 2 failed: %v", err)
	}
	if d1.ContentSHA256 == "" || d1.ContentSHA256 != d2.ContentSHA256 || d1.ContentBase64 != d2.ContentBase64 {
		t.Fatalf("expected deterministic byte-for-byte reproducible docx export: sha1=%s sha2=%s", d1.ContentSHA256, d2.ContentSHA256)
	}

	rawZip, err := base64.StdEncoding.DecodeString(d1.ContentBase64)
	if err != nil {
		t.Fatalf("decode ContentBase64 failed: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(rawZip), int64(len(rawZip)))
	if err != nil {
		t.Fatalf("invalid OOXML zip container: %v", err)
	}

	var docXML string
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			rc, oErr := f.Open()
			if oErr != nil {
				t.Fatalf("open word/document.xml: %v", oErr)
			}
			b, rErr := io.ReadAll(rc)
			_ = rc.Close()
			if rErr != nil {
				t.Fatalf("read word/document.xml: %v", rErr)
			}
			docXML = string(b)
		}
	}
	if docXML == "" {
		t.Fatal("missing word/document.xml in generated .docx package")
	}

	// Verify XML well-formedness strictly with encoding/xml decoder
	dec := xml.NewDecoder(strings.NewReader(docXML))
	for {
		if _, err := dec.Token(); err != nil {
			if err == io.EOF {
				break
			}
			t.Fatalf("malformed XML in word/document.xml: %v", err)
		}
	}

	for _, want := range []string{
		"1. Executive Summary",
		"2. Assessment Scope",
		"3. Attack Path",
		"4. Detailed Technical Findings",
		"5. Appendix A",
		"6. Appendix B",
		"[AUTHOR NOTE",
		"DC01",
		"GetUserSPNs Proof",
		"&lt;script&gt;alert(1)&lt;/script&gt;",
	} {
		if !strings.Contains(docXML, want) {
			t.Fatalf("word/document.xml missing expected section/content %q", want)
		}
	}

	outPath := filepath.Join(t.TempDir(), "customer-report.docx")
	if _, err := report.ExportToFile(req, payload, outPath); err != nil {
		t.Fatalf("ExportToFile .docx failed: %v", err)
	}
	diskBytes, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("read written .docx file: %v", err)
	}
	if !bytes.Equal(diskBytes, rawZip) {
		t.Fatalf("written .docx bytes on disk differed from compiled Base64 artifact")
	}
}

func TestF30ReportTemplatePopulatesMarkdownHTMLAndDOCX(t *testing.T) {
	payload := buildF30TestPayload(false)
	tpl := core.DefaultReportTemplates()[1] // tpl-rep-ad
	tpl.Author = "Jane Operator (DoubleAgent Red Team)"
	tpl.Classification = "STRICTLY CONFIDENTIAL — ACME CORP"
	tpl.ExecutiveSummaryIntro = "Domain takeover confirmed via Kerberoasting and weak service ACLs."
	tpl.MethodologyText = "Assumed-breach Active Directory audit using BloodHound and Impacket."
	tpl.ScopeNotes = "Internal AD forest corp.acme.local (DC01 and member servers)."
	tpl.AttackPathTemplate = "Unprivileged user to Kerberoast svc_sql to DA compromise."
	tpl.LimitationsText = "Legacy mainframe segment excluded by written ROE."
	tpl.ConclusionText = "Rotate krbtgt twice and migrate SQL SPNs to gMSA accounts."

	for _, format := range []string{"markdown", "html"} {
		res, err := report.CompileAndExport(core.ReportExportRequest{
			EngagementID:   "eng-1",
			Format:         format,
			ReportTemplate: &tpl,
		}, payload)
		if err != nil {
			t.Fatalf("CompileAndExport(%s) failed: %v", format, err)
		}
		for _, want := range []string{
			tpl.TitlePrefix,
			tpl.Author,
			tpl.Classification,
			tpl.ExecutiveSummaryIntro,
			tpl.MethodologyText,
			tpl.ScopeNotes,
			tpl.AttackPathTemplate,
			tpl.LimitationsText,
			tpl.ConclusionText,
		} {
			if !strings.Contains(res.Content, want) {
				t.Fatalf("%s export missing template content %q", format, want)
			}
		}
	}

	docxRes, err := report.CompileAndExport(core.ReportExportRequest{
		EngagementID:   "eng-1",
		Format:         "docx",
		ReportTemplate: &tpl,
	}, payload)
	if err != nil {
		t.Fatalf("CompileAndExport(docx) failed: %v", err)
	}
	rawZip, err := base64.StdEncoding.DecodeString(docxRes.ContentBase64)
	if err != nil {
		t.Fatalf("decode base64 docx: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(rawZip), int64(len(rawZip)))
	if err != nil {
		t.Fatalf("open docx zip: %v", err)
	}
	var docXML string
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			_ = rc.Close()
			docXML = string(b)
		}
	}
	for _, want := range []string{
		strings.ToUpper(tpl.TitlePrefix),
		tpl.Author,
		tpl.Classification,
		tpl.ExecutiveSummaryIntro,
		tpl.MethodologyText,
		tpl.ScopeNotes,
		tpl.AttackPathTemplate,
		tpl.LimitationsText,
		tpl.ConclusionText,
	} {
		if !strings.Contains(docXML, want) {
			t.Fatalf("docx word/document.xml missing template text %q", want)
		}
	}
	if strings.Contains(docXML, "[AUTHOR NOTE — REPLACE BEFORE PDF EXPORT]") || strings.Contains(docXML, "[AUTHOR NOTE: Insert Assessor Name") {
		t.Fatalf("docx should replace report-level [AUTHOR NOTE placeholders when ReportTemplate is supplied")
	}
}
