package report

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"doubleagent/backend/core"
)

var deterministicZipModTime = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// stripInvalidXMLRunes removes ASCII control characters forbidden in XML 1.0 (keeping tab, LF, CR)
// so raw terminal evidence dumps never corrupt the generated Word document.
func stripInvalidXMLRunes(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\t' || r == '\n' || r == '\r' ||
			(r >= 0x20 && r <= 0xD7FF) ||
			(r >= 0xE000 && r <= 0xFFFD) ||
			(r >= 0x10000 && r <= 0x10FFFF) {
			if utf8.ValidRune(r) {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

func escXML(s string) string {
	var buf bytes.Buffer
	_ = xml.EscapeText(&buf, []byte(stripInvalidXMLRunes(s)))
	return buf.String()
}

type docxBuilder struct {
	buf strings.Builder
}

func (d *docxBuilder) writeParagraph(text string, opts docxParaOpts) {
	d.buf.WriteString(`<w:p>`)
	hasPPr := opts.Style != "" || opts.SpaceBefore > 0 || opts.SpaceAfter > 0 || opts.ShadingFill != "" || opts.LeftBorderColor != "" || opts.KeepNext || opts.PageBreakBefore
	if hasPPr {
		d.buf.WriteString(`<w:pPr>`)
		if opts.Style != "" {
			d.buf.WriteString(fmt.Sprintf(`<w:pStyle w:val="%s"/>`, escXML(opts.Style)))
		}
		if opts.KeepNext {
			d.buf.WriteString(`<w:keepNext/>`)
		}
		if opts.PageBreakBefore {
			d.buf.WriteString(`<w:pageBreakBefore/>`)
		}
		if opts.LeftBorderColor != "" {
			d.buf.WriteString(fmt.Sprintf(`<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="%s"/></w:pBdr>`, escXML(opts.LeftBorderColor)))
		}
		if opts.ShadingFill != "" {
			d.buf.WriteString(fmt.Sprintf(`<w:shd w:val="clear" w:color="auto" w:fill="%s"/>`, escXML(opts.ShadingFill)))
		}
		if opts.SpaceBefore > 0 || opts.SpaceAfter > 0 {
			d.buf.WriteString(fmt.Sprintf(`<w:spacing w:before="%d" w:after="%d"/>`, opts.SpaceBefore, opts.SpaceAfter))
		}
		d.buf.WriteString(`</w:pPr>`)
	}

	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	for idx, line := range lines {
		d.buf.WriteString(`<w:r>`)
		if opts.Bold || opts.Italic || opts.Color != "" || opts.FontSizeHalfPt > 0 || opts.FontFamily != "" {
			d.buf.WriteString(`<w:rPr>`)
			if opts.FontFamily != "" {
				f := escXML(opts.FontFamily)
				d.buf.WriteString(fmt.Sprintf(`<w:rFonts w:ascii="%s" w:hAnsi="%s" w:cs="%s"/>`, f, f, f))
			}
			if opts.Bold {
				d.buf.WriteString(`<w:b/>`)
			}
			if opts.Italic {
				d.buf.WriteString(`<w:i/>`)
			}
			if opts.Color != "" {
				d.buf.WriteString(fmt.Sprintf(`<w:color w:val="%s"/>`, escXML(opts.Color)))
			}
			if opts.FontSizeHalfPt > 0 {
				d.buf.WriteString(fmt.Sprintf(`<w:sz w:val="%d"/><w:szCs w:val="%d"/>`, opts.FontSizeHalfPt, opts.FontSizeHalfPt))
			}
			d.buf.WriteString(`</w:rPr>`)
		}
		d.buf.WriteString(`<w:t xml:space="preserve">`)
		d.buf.WriteString(escXML(line))
		d.buf.WriteString(`</w:t></w:r>`)
		if idx < len(lines)-1 {
			d.buf.WriteString(`<w:r><w:br/></w:r>`)
		}
	}
	d.buf.WriteString(`</w:p>`)
}

type docxParaOpts struct {
	Style           string
	Bold            bool
	Italic          bool
	Color           string
	FontSizeHalfPt  int // e.g. 22 = 11pt, 18 = 9pt
	FontFamily      string
	SpaceBefore     int // twips
	SpaceAfter      int
	ShadingFill     string // 6-hex without #
	LeftBorderColor string
	KeepNext        bool
	PageBreakBefore bool
}

type docxTableCell struct {
	Text  string
	Bold  bool
	Fill  string
	Color string
	Mono  bool
}

func (d *docxBuilder) writeTable(headers []string, rows [][]docxTableCell) {
	if len(headers) == 0 {
		return
	}
	colCount := len(headers)
	colWidth := 9360 / colCount // ~6.5 inches US Letter/A4 printable width in twips

	d.buf.WriteString(`<w:tbl><w:tblPr>`)
	d.buf.WriteString(`<w:tblW w:w="9360" w:type="dxa"/>`)
	d.buf.WriteString(`<w:tblBorders>`)
	for _, b := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
		d.buf.WriteString(fmt.Sprintf(`<w:%s w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`, b))
	}
	d.buf.WriteString(`</w:tblBorders></w:tblPr>`)
	d.buf.WriteString(`<w:tblGrid>`)
	for i := 0; i < colCount; i++ {
		d.buf.WriteString(fmt.Sprintf(`<w:gridCol w:w="%d"/>`, colWidth))
	}
	d.buf.WriteString(`</w:tblGrid>`)

	// Header row
	d.buf.WriteString(`<w:tr><w:trPr><w:tblHeader/></w:trPr>`)
	for _, h := range headers {
		d.writeCell(docxTableCell{
			Text:  h,
			Bold:  true,
			Fill:  "0F172A",
			Color: "F8FAFC",
		}, colWidth)
	}
	d.buf.WriteString(`</w:tr>`)

	for rIdx, row := range rows {
		d.buf.WriteString(`<w:tr>`)
		defaultFill := "FFFFFF"
		if rIdx%2 == 1 {
			defaultFill = "F8FAFC"
		}
		for cIdx := 0; cIdx < colCount; cIdx++ {
			var cell docxTableCell
			if cIdx < len(row) {
				cell = row[cIdx]
			}
			if cell.Fill == "" {
				cell.Fill = defaultFill
			}
			if cell.Color == "" {
				cell.Color = "1E293B"
			}
			d.writeCell(cell, colWidth)
		}
		d.buf.WriteString(`</w:tr>`)
	}
	d.buf.WriteString(`</w:tbl>`)
	d.writeParagraph("", docxParaOpts{SpaceAfter: 100})
}

func (d *docxBuilder) writeCell(cell docxTableCell, width int) {
	d.buf.WriteString(fmt.Sprintf(`<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>`, width))
	if cell.Fill != "" {
		d.buf.WriteString(fmt.Sprintf(`<w:shd w:val="clear" w:color="auto" w:fill="%s"/>`, escXML(cell.Fill)))
	}
	d.buf.WriteString(`<w:tcMar><w:top w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>`)
	opts := docxParaOpts{
		Bold:           cell.Bold,
		Color:          cell.Color,
		FontSizeHalfPt: 18,
		SpaceAfter:     20,
	}
	if cell.Mono {
		opts.FontFamily = "Consolas"
		opts.FontSizeHalfPt = 16
	}
	d.writeParagraph(cell.Text, opts)
	d.buf.WriteString(`</w:tc>`)
}

func severityDocxStyle(sev string) (fill string, text string) {
	switch strings.ToLower(strings.TrimSpace(sev)) {
	case "critical":
		return "FEE2E2", "991B1B"
	case "high":
		return "FFEDD5", "9A3412"
	case "medium":
		return "FEF9C3", "854D0E"
	case "low":
		return "DBEAFE", "1E40AF"
	default:
		return "F1F5F9", "334155"
	}
}

func writeZipFile(zw *zip.Writer, name string, data []byte) error {
	hdr := &zip.FileHeader{
		Name:   name,
		Method: zip.Deflate,
	}
	hdr.Modified = deterministicZipModTime
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

// RenderDOCX builds a deterministic, customer-ready editable Word (.docx) Pentest Report scaffold (F-30).
// Covers Cover/Document Control, Executive Summary narrative placeholder & Risk Matrix, Scope & Methodology,
// Attack Path narrative, Detailed Per-Host Findings & Evidence, Port Matrix Appendix, and Integrity Manifest.
func RenderDOCX(doc *core.CompiledReport) ([]byte, string, error) {
	if doc == nil {
		return nil, "", fmt.Errorf("compiled report cannot be nil")
	}
	populateArtifactHashes(doc)

	b := &docxBuilder{}

	// Cover / Document Control Banner
	bannerTitle := "SECURITY ASSESSMENT & PENETRATION TEST REPORT"
	authorText := "[AUTHOR NOTE: Insert Assessor Name & Organization]"
	classText := "CONFIDENTIAL — AUTHORIZED RECIPIENTS ONLY"
	execIntroText := "[AUTHOR NOTE — REPLACE BEFORE PDF EXPORT]: Summarize the overall security posture, primary business risks observed during the engagement, and top 3 strategic remediation themes for executive stakeholders."
	execIntroIsTemplate := false
	methText := "[AUTHOR NOTE]: Describe rules of engagement, testing perspective (External / Internal / Assumed Breach), source IP(s) used, and any out-of-scope exclusions. Standard phases followed: Reconnaissance -> Service Enumeration -> Vulnerability Validation -> Privilege Escalation / Lateral Movement -> Evidence Verification -> Reporting."
	methIsTemplate := false
	scopeNotesText := ""
	limitationsText := ""
	attackPathText := "[AUTHOR NOTE]: Walk through the end-to-end attack narrative—how initial access or misconfigurations combined to reach high-value assets."
	attackPathIsTemplate := false
	conclusionText := ""

	if doc.Template != nil {
		if v := strings.TrimSpace(doc.Template.TitlePrefix); v != "" {
			bannerTitle = strings.ToUpper(v)
		}
		if v := strings.TrimSpace(doc.Template.Author); v != "" {
			authorText = v
		}
		if v := strings.TrimSpace(doc.Template.Classification); v != "" {
			classText = v
		}
		if v := strings.TrimSpace(doc.Template.ExecutiveSummaryIntro); v != "" {
			execIntroText = v
			execIntroIsTemplate = true
		}
		if v := strings.TrimSpace(doc.Template.MethodologyText); v != "" {
			methText = v
			methIsTemplate = true
		}
		scopeNotesText = strings.TrimSpace(doc.Template.ScopeNotes)
		limitationsText = strings.TrimSpace(doc.Template.LimitationsText)
		if v := strings.TrimSpace(doc.Template.AttackPathTemplate); v != "" {
			attackPathText = v
			attackPathIsTemplate = true
		}
		conclusionText = strings.TrimSpace(doc.Template.ConclusionText)
	}

	b.writeParagraph(bannerTitle, docxParaOpts{
		Bold:           true,
		Color:          "0284C7",
		FontSizeHalfPt: 20,
		SpaceAfter:     80,
	})
	b.writeParagraph(doc.EngagementName, docxParaOpts{
		Style:          "Title",
		Bold:           true,
		Color:          "0F172A",
		FontSizeHalfPt: 48,
		SpaceAfter:     120,
	})
	b.writeParagraph("Customer Deliverable Scaffold · Pre-populated from DoubleAgent Encrypted Vault", docxParaOpts{
		Italic:         true,
		Color:          "475569",
		FontSizeHalfPt: 22,
		SpaceAfter:     240,
	})

	scopeText := doc.EngagementScope
	if strings.TrimSpace(scopeText) == "" {
		scopeText = "[AUTHOR NOTE: Specify tested IP ranges, domains, and target applications]"
	}
	timeframeText := doc.EngagementTimeframe
	if strings.TrimSpace(timeframeText) == "" {
		timeframeText = "[AUTHOR NOTE: Specify testing start and end dates]"
	}

	b.writeTable(
		[]string{"Document Field", "Value"},
		[][]docxTableCell{
			{{Text: "Client / Engagement", Bold: true}, {Text: doc.EngagementName}},
			{{Text: "Authorized Scope", Bold: true}, {Text: scopeText}},
			{{Text: "Assessment Window", Bold: true}, {Text: timeframeText}},
			{{Text: "Report Timestamp (UTC)", Bold: true}, {Text: doc.DeterministicTimestamp}},
			{{Text: "Lead Tester / Author", Bold: true}, {Text: authorText}},
			{{Text: "Document Classification", Bold: true}, {Text: classText, Bold: true, Color: "991B1B"}},
			{{Text: "Compiled Totals", Bold: true}, {Text: fmt.Sprintf("%d Host(s) · %d Finding(s) · %d Evidence Artifact(s)", len(doc.HostSections), doc.TotalFindings, doc.TotalEvidence)}},
		},
	)

	// 1. Executive Summary
	b.writeParagraph("1. Executive Summary", docxParaOpts{
		Style:           "Heading1",
		Bold:            true,
		Color:           "0F172A",
		FontSizeHalfPt:  32,
		SpaceBefore:     200,
		SpaceAfter:      120,
		KeepNext:        true,
		PageBreakBefore: true,
	})
	execParaOpts := docxParaOpts{
		Italic:          true,
		Color:           "92400E",
		FontSizeHalfPt:  20,
		ShadingFill:     "FEF3C7",
		LeftBorderColor: "D97706",
		SpaceAfter:      160,
	}
	if execIntroIsTemplate {
		execParaOpts = docxParaOpts{
			Color:          "1E293B",
			FontSizeHalfPt: 21,
			SpaceAfter:     160,
		}
	}
	b.writeParagraph(execIntroText, execParaOpts)

	b.writeTable(
		[]string{"Severity Rating", "Count", "Remediation SLA Guidance (Template)"},
		[][]docxTableCell{
			{{Text: "CRITICAL", Bold: true, Fill: "FEE2E2", Color: "991B1B"}, {Text: strconv.Itoa(doc.TotalSeverityCounts.Critical), Bold: true}, {Text: "Immediate containment / emergency patch (< 7 days)"}},
			{{Text: "HIGH", Bold: true, Fill: "FFEDD5", Color: "9A3412"}, {Text: strconv.Itoa(doc.TotalSeverityCounts.High), Bold: true}, {Text: "Prioritized remediation (< 30 days)"}},
			{{Text: "MEDIUM", Bold: true, Fill: "FEF9C3", Color: "854D0E"}, {Text: strconv.Itoa(doc.TotalSeverityCounts.Medium), Bold: true}, {Text: "Planned remediation cycle (< 90 days)"}},
			{{Text: "LOW", Bold: true, Fill: "DBEAFE", Color: "1E40AF"}, {Text: strconv.Itoa(doc.TotalSeverityCounts.Low), Bold: true}, {Text: "Defense-in-depth hardening (< 180 days)"}},
			{{Text: "INFORMATIONAL", Bold: true, Fill: "F1F5F9", Color: "334155"}, {Text: strconv.Itoa(doc.TotalSeverityCounts.Info), Bold: true}, {Text: "Architectural observation / advisory"}},
			{{Text: "TOTAL FINDINGS", Bold: true}, {Text: strconv.Itoa(doc.TotalFindings), Bold: true}, {Text: fmt.Sprintf("%d verified evidence proof(s) attached", doc.TotalEvidence)}},
		},
	)

	// 2. Scope & Methodology
	b.writeParagraph("2. Assessment Scope & Methodology", docxParaOpts{
		Style:          "Heading1",
		Bold:           true,
		Color:          "0F172A",
		FontSizeHalfPt: 32,
		SpaceBefore:    200,
		SpaceAfter:     120,
		KeepNext:       true,
	})
	methParaOpts := docxParaOpts{
		Italic:          true,
		Color:           "1E3A8A",
		FontSizeHalfPt:  20,
		ShadingFill:     "EFF6FF",
		LeftBorderColor: "2563EB",
		SpaceAfter:      140,
	}
	if methIsTemplate {
		methParaOpts = docxParaOpts{
			Color:          "1E293B",
			FontSizeHalfPt: 21,
			SpaceAfter:     100,
		}
	}
	b.writeParagraph(methText, methParaOpts)
	if scopeNotesText != "" {
		b.writeParagraph("Scope Notes: "+scopeNotesText, docxParaOpts{
			Color:          "334155",
			FontSizeHalfPt: 20,
			SpaceAfter:     80,
		})
	}
	if limitationsText != "" {
		b.writeParagraph("Assessment Limitations: "+limitationsText, docxParaOpts{
			Color:          "475569",
			FontSizeHalfPt: 20,
			SpaceAfter:     120,
		})
	}

	if len(doc.HostSections) > 0 {
		hostRows := make([][]docxTableCell, 0, len(doc.HostSections))
		for _, sec := range doc.HostSections {
			addr := sec.Address
			if addr == "" {
				addr = "N/A"
			}
			tags := "-"
			if len(sec.Tags) > 0 {
				tags = strings.Join(sec.Tags, ", ")
			}
			hostRows = append(hostRows, []docxTableCell{
				{Text: sec.HostLabel, Bold: true},
				{Text: addr, Mono: true},
				{Text: tags},
				{Text: fmt.Sprintf("%d finding(s), %d port(s)", len(sec.Findings), len(sec.PortFindings))},
			})
		}
		b.writeTable([]string{"Target Host", "IP / Address", "Tags / Role", "Coverage Summary"}, hostRows)
	}

	// 3. Attack Path & Key Takeaways
	b.writeParagraph("3. Attack Path & Key Takeaways", docxParaOpts{
		Style:          "Heading1",
		Bold:           true,
		Color:          "0F172A",
		FontSizeHalfPt: 32,
		SpaceBefore:    180,
		SpaceAfter:     100,
		KeepNext:       true,
	})
	attackParaOpts := docxParaOpts{
		Italic:          true,
		Color:           "92400E",
		FontSizeHalfPt:  20,
		ShadingFill:     "FEF3C7",
		LeftBorderColor: "D97706",
		SpaceAfter:      120,
	}
	if attackPathIsTemplate {
		attackParaOpts = docxParaOpts{
			Color:          "1E293B",
			FontSizeHalfPt: 21,
			SpaceAfter:     120,
		}
	}
	b.writeParagraph(attackPathText, attackParaOpts)
	highImpactCount := 0
	for _, sec := range doc.HostSections {
		for _, fs := range sec.Findings {
			sevLower := strings.ToLower(fs.Finding.Severity)
			if sevLower == "critical" || sevLower == "high" {
				highImpactCount++
				b.writeParagraph(
					fmt.Sprintf("• [%s] %s (%s)", strings.ToUpper(fs.Finding.Severity), fs.Finding.Title, sec.HostLabel),
					docxParaOpts{Bold: true, Color: "1E293B", FontSizeHalfPt: 20, SpaceAfter: 40},
				)
			}
		}
	}
	if highImpactCount == 0 {
		b.writeParagraph("• Review detailed technical findings below for complete risk context.", docxParaOpts{Color: "475569", FontSizeHalfPt: 20, SpaceAfter: 80})
	}

	// 4. Detailed Technical Findings Grouped Per Host
	b.writeParagraph("4. Detailed Technical Findings (Per Target Host)", docxParaOpts{
		Style:           "Heading1",
		Bold:            true,
		Color:           "0F172A",
		FontSizeHalfPt:  32,
		SpaceBefore:     200,
		SpaceAfter:      120,
		KeepNext:        true,
		PageBreakBefore: true,
	})

	var portRows [][]docxTableCell
	var provenanceRows [][]docxTableCell

	for hostIdx, sec := range doc.HostSections {
		hostHeading := fmt.Sprintf("4.%d Target Host: %s", hostIdx+1, sec.HostLabel)
		if sec.Address != "" {
			hostHeading += fmt.Sprintf(" (%s)", sec.Address)
		}
		b.writeParagraph(hostHeading, docxParaOpts{
			Style:           "Heading2",
			Bold:            true,
			Color:           "0369A1",
			FontSizeHalfPt:  28,
			SpaceBefore:     180,
			SpaceAfter:      100,
			LeftBorderColor: "0284C7",
			KeepNext:        true,
		})

		for fIdx, fs := range sec.Findings {
			f := fs.Finding
			sevFill, sevColor := severityDocxStyle(f.Severity)
			b.writeParagraph(fmt.Sprintf("4.%d.%d [%s] %s", hostIdx+1, fIdx+1, strings.ToUpper(f.Severity), f.Title), docxParaOpts{
				Style:          "Heading3",
				Bold:           true,
				Color:          "0F172A",
				FontSizeHalfPt: 24,
				SpaceBefore:    140,
				SpaceAfter:     80,
				KeepNext:       true,
			})

			cvssDisplay := f.CVSS
			if cvssDisplay == "" {
				cvssDisplay = "[TODO]"
			} else if f.CVSSVector != "" {
				cvssDisplay += " (" + f.CVSSVector + ")"
			}
			cveDisplay := f.CVE
			if cveDisplay == "" {
				cveDisplay = "-"
			}
			mitreDisplay := f.MitreAttack
			if mitreDisplay == "" {
				mitreDisplay = "-"
			}

			b.writeTable(
				[]string{"Severity", "Status", "Category", "CVSS v3.1", "CVE / MITRE ATT&CK"},
				[][]docxTableCell{
					{
						{Text: strings.ToUpper(f.Severity), Bold: true, Fill: sevFill, Color: sevColor},
						{Text: strings.ToUpper(string(f.Status)), Bold: true},
						{Text: f.Category},
						{Text: cvssDisplay, Mono: true},
						{Text: fmt.Sprintf("CVE: %s | ATT&CK: %s", cveDisplay, mitreDisplay)},
					},
				},
			)

			b.writeParagraph("Description", docxParaOpts{Bold: true, Color: "0F172A", FontSizeHalfPt: 21, SpaceAfter: 40, KeepNext: true})
			desc := strings.TrimSpace(f.Description)
			if desc == "" {
				desc = "[AUTHOR NOTE: Describe technical root cause and affected endpoint.]"
			}
			b.writeParagraph(desc, docxParaOpts{Color: "1E293B", FontSizeHalfPt: 20, SpaceAfter: 100})

			b.writeParagraph("Business Impact", docxParaOpts{Bold: true, Color: "0F172A", FontSizeHalfPt: 21, SpaceAfter: 40, KeepNext: true})
			impact := strings.TrimSpace(f.Impact)
			if impact == "" {
				impact = "[AUTHOR NOTE: Explain confidentiality, integrity, or operational impact if exploited.]"
			}
			b.writeParagraph(impact, docxParaOpts{Color: "1E293B", FontSizeHalfPt: 20, SpaceAfter: 100})

			b.writeParagraph("Remediation Recommendation", docxParaOpts{Bold: true, Color: "0F172A", FontSizeHalfPt: 21, SpaceAfter: 40, KeepNext: true})
			rem := strings.TrimSpace(f.Remediation)
			if rem == "" {
				rem = "[AUTHOR NOTE: Specify actionable configuration change, patch, or compensating control.]"
			}
			b.writeParagraph(rem, docxParaOpts{Color: "1E293B", FontSizeHalfPt: 20, SpaceAfter: 120})

			if len(fs.Evidence) > 0 {
				b.writeParagraph(fmt.Sprintf("Verified Proof & Evidence (%d)", len(fs.Evidence)), docxParaOpts{
					Bold:           true,
					Color:          "0369A1",
					FontSizeHalfPt: 21,
					SpaceAfter:     60,
					KeepNext:       true,
				})
				for evIdx, ev := range fs.Evidence {
					writeDocxEvidence(b, evIdx+1, sec.HostLabel, ev, &provenanceRows)
				}
			}

			if len(fs.Notes) > 0 {
				b.writeParagraph(fmt.Sprintf("Linked Killchain Notes (%d)", len(fs.Notes)), docxParaOpts{
					Bold:           true,
					Color:          "334155",
					FontSizeHalfPt: 20,
					SpaceAfter:     40,
					KeepNext:       true,
				})
				for _, np := range fs.Notes {
					b.writeParagraph(fmt.Sprintf("%s\n%s", np.Title, np.Body), docxParaOpts{
						FontFamily:      "Consolas",
						FontSizeHalfPt:  17,
						Color:           "1E293B",
						ShadingFill:     "F8FAFC",
						LeftBorderColor: "64748B",
						SpaceAfter:      80,
					})
				}
			}
		}

		if len(sec.StandaloneEvidence) > 0 {
			b.writeParagraph(fmt.Sprintf("Additional Host Evidence Artifacts — %s (%d)", sec.HostLabel, len(sec.StandaloneEvidence)), docxParaOpts{
				Bold:           true,
				Color:          "0369A1",
				FontSizeHalfPt: 22,
				SpaceBefore:    100,
				SpaceAfter:     60,
				KeepNext:       true,
			})
			for evIdx, ev := range sec.StandaloneEvidence {
				writeDocxEvidence(b, evIdx+1, sec.HostLabel, ev, &provenanceRows)
			}
		}

		if len(sec.Notes) > 0 {
			b.writeParagraph(fmt.Sprintf("Host Recon & Operator Notes — %s (%d)", sec.HostLabel, len(sec.Notes)), docxParaOpts{
				Bold:           true,
				Color:          "334155",
				FontSizeHalfPt: 21,
				SpaceBefore:    80,
				SpaceAfter:     40,
				KeepNext:       true,
			})
			for _, np := range sec.Notes {
				b.writeParagraph(fmt.Sprintf("%s\n%s", np.Title, np.Body), docxParaOpts{
					FontFamily:      "Consolas",
					FontSizeHalfPt:  17,
					Color:           "1E293B",
					ShadingFill:     "F8FAFC",
					LeftBorderColor: "64748B",
					SpaceAfter:      80,
				})
			}
		}

		for _, pf := range sec.PortFindings {
			prod := strings.TrimSpace(strings.TrimSpace(pf.Product) + " " + strings.TrimSpace(pf.Version))
			if prod == "" {
				prod = "-"
			}
			portRows = append(portRows, []docxTableCell{
				{Text: sec.HostLabel, Bold: true},
				{Text: fmt.Sprintf("%d/%s", pf.Port, pf.Protocol), Mono: true},
				{Text: pf.Service},
				{Text: prod},
				{Text: pf.State},
				{Text: pf.Source},
			})
		}
	}

	if conclusionText != "" {
		b.writeParagraph("Conclusion & Strategic Remediation Roadmap", docxParaOpts{
			Style:          "Heading1",
			Bold:           true,
			Color:          "0F172A",
			FontSizeHalfPt: 30,
			SpaceBefore:    180,
			SpaceAfter:     100,
			KeepNext:       true,
		})
		b.writeParagraph(conclusionText, docxParaOpts{
			Color:          "1E293B",
			FontSizeHalfPt: 21,
			SpaceAfter:     140,
		})
	}

	// 5. Appendix A: Discovered Ports & Services
	b.writeParagraph("5. Appendix A — Discovered Ports & Services Matrix", docxParaOpts{
		Style:           "Heading1",
		Bold:            true,
		Color:           "0F172A",
		FontSizeHalfPt:  32,
		SpaceBefore:     200,
		SpaceAfter:      100,
		KeepNext:        true,
		PageBreakBefore: true,
	})
	if len(portRows) > 0 {
		b.writeTable([]string{"Host", "Port/Proto", "Service", "Product / Version", "State", "Source"}, portRows)
	} else {
		b.writeParagraph("No port discovery entries were attached to this report export.", docxParaOpts{Italic: true, Color: "64748B", FontSizeHalfPt: 20, SpaceAfter: 120})
	}

	// 6. Appendix B: Integrity & Provenance Manifest
	b.writeParagraph("6. Appendix B — Evidence Provenance & SHA-256 Integrity Manifest", docxParaOpts{
		Style:          "Heading1",
		Bold:           true,
		Color:          "0F172A",
		FontSizeHalfPt: 32,
		SpaceBefore:    180,
		SpaceAfter:     100,
		KeepNext:       true,
	})
	if len(provenanceRows) > 0 {
		b.writeTable([]string{"Artifact ID", "Title", "Host", "Source", "Captured (UTC)", "SHA-256 Digest"}, provenanceRows)
	} else {
		b.writeParagraph("No evidence artifacts were included in this export.", docxParaOpts{Italic: true, Color: "64748B", FontSizeHalfPt: 20, SpaceAfter: 100})
	}

	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)

	contentTypesXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

	rootRelsXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

	docRelsXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

	stylesXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="21"/><w:szCs w:val="21"/>
    </w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
</w:styles>`

	documentXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>` + b.buf.String() + `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`

	zipEntries := []struct {
		name string
		data string
	}{
		{name: "[Content_Types].xml", data: contentTypesXML},
		{name: "_rels/.rels", data: rootRelsXML},
		{name: "word/_rels/document.xml.rels", data: docRelsXML},
		{name: "word/styles.xml", data: stylesXML},
		{name: "word/document.xml", data: documentXML},
	}
	for _, entry := range zipEntries {
		if err := writeZipFile(zw, entry.name, []byte(entry.data)); err != nil {
			_ = zw.Close()
			return nil, "", err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, "", err
	}

	rawBytes := zipBuf.Bytes()
	return rawBytes, sha256Hex(rawBytes), nil
}

func writeDocxEvidence(b *docxBuilder, idx int, hostLabel string, ev core.ReportEvidenceArtifact, provenanceRows *[][]docxTableCell) {
	title := fmt.Sprintf("Evidence %d: %s", idx, ev.Title)
	if !ev.InReport {
		title += " [INTERNAL VAULT ONLY]"
	}
	b.writeParagraph(title, docxParaOpts{
		Bold:           true,
		Color:          "0F172A",
		FontSizeHalfPt: 20,
		SpaceBefore:    80,
		SpaceAfter:     20,
		KeepNext:       true,
	})
	meta := fmt.Sprintf("ID: %s · Source: %s · Captured UTC: %s · SHA-256: %s", ev.ID, ev.Source, ev.CapturedAt, ev.ContentSHA256)
	b.writeParagraph(meta, docxParaOpts{
		FontFamily:     "Consolas",
		FontSizeHalfPt: 15,
		Color:          "64748B",
		SpaceAfter:     40,
		KeepNext:       true,
	})

	*provenanceRows = append(*provenanceRows, []docxTableCell{
		{Text: ev.ID, Mono: true},
		{Text: ev.Title},
		{Text: hostLabel},
		{Text: ev.Source},
		{Text: ev.CapturedAt, Mono: true},
		{Text: ev.ContentSHA256, Mono: true},
	})

	if ev.Table != nil && len(ev.Table.Headers) > 0 {
		tRows := make([][]docxTableCell, 0, len(ev.Table.Rows))
		for _, r := range ev.Table.Rows {
			cells := make([]docxTableCell, len(ev.Table.Headers))
			for i := range ev.Table.Headers {
				if i < len(r) {
					cells[i] = docxTableCell{Text: r[i], Mono: true}
				}
			}
			tRows = append(tRows, cells)
		}
		b.writeTable(ev.Table.Headers, tRows)
		return
	}

	b.writeParagraph(ev.Content, docxParaOpts{
		FontFamily:      "Consolas",
		FontSizeHalfPt:  17,
		Color:           "0F172A",
		ShadingFill:     "F1F5F9",
		LeftBorderColor: "0284C7",
		SpaceAfter:      100,
	})
}
