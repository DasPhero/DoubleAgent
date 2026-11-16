package report

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"strings"

	"doubleagent/backend/core"
)

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// populateArtifactHashes fills ContentSHA256 deterministically for every evidence artifact in doc.
func populateArtifactHashes(doc *core.CompiledReport) {
	if doc == nil {
		return
	}
	for hi := range doc.HostSections {
		sec := &doc.HostSections[hi]
		for fi := range sec.Findings {
			for ei := range sec.Findings[fi].Evidence {
				ev := &sec.Findings[fi].Evidence[ei]
				ev.ContentSHA256 = sha256Hex([]byte(ev.Content))
			}
		}
		for ei := range sec.StandaloneEvidence {
			ev := &sec.StandaloneEvidence[ei]
			ev.ContentSHA256 = sha256Hex([]byte(ev.Content))
		}
	}
}

func safeFenceFor(content string) string {
	if strings.Contains(content, "```") {
		return "````"
	}
	return "```"
}

func escapeMarkdownCell(s string) string {
	s = strings.ReplaceAll(s, "\r\n", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "|", `\|`)
	return s
}

func writeMarkdownEvidence(b *strings.Builder, idx int, ev core.ReportEvidenceArtifact) {
	scopeTag := ""
	if !ev.InReport {
		scopeTag = " `[INTERNAL VAULT ONLY]`"
	}
	b.WriteString(fmt.Sprintf("##### Evidence %d: %s%s\n\n", idx, ev.Title, scopeTag))
	b.WriteString(fmt.Sprintf("- **Artifact ID:** `%s`\n", ev.ID))
	b.WriteString(fmt.Sprintf("- **Category:** %s\n", ev.Category))
	if ev.Source != "" {
		b.WriteString(fmt.Sprintf("- **Source:** %s\n", ev.Source))
	}
	if ev.CapturedAt != "" {
		b.WriteString(fmt.Sprintf("- **Captured At (UTC):** %s\n", ev.CapturedAt))
	}
	if ev.ContentSHA256 != "" {
		b.WriteString(fmt.Sprintf("- **Content SHA-256:** `%s`\n", ev.ContentSHA256))
	}
	if len(ev.Tags) > 0 {
		b.WriteString(fmt.Sprintf("- **Tags:** `%s`\n", strings.Join(ev.Tags, "`, `")))
	}
	b.WriteString("\n")

	if ev.Table != nil && len(ev.Table.Headers) > 0 {
		headers := make([]string, len(ev.Table.Headers))
		seps := make([]string, len(ev.Table.Headers))
		for i, h := range ev.Table.Headers {
			headers[i] = escapeMarkdownCell(h)
			seps[i] = "---"
		}
		b.WriteString("| " + strings.Join(headers, " | ") + " |\n")
		b.WriteString("| " + strings.Join(seps, " | ") + " |\n")
		for _, row := range ev.Table.Rows {
			cells := make([]string, len(ev.Table.Headers))
			for i := range headers {
				if i < len(row) {
					cells[i] = escapeMarkdownCell(row[i])
				}
			}
			b.WriteString("| " + strings.Join(cells, " | ") + " |\n")
		}
		b.WriteString("\n")
		return
	}

	fence := safeFenceFor(ev.Content)
	b.WriteString(fence + "text\n")
	b.WriteString(ev.Content)
	if !strings.HasSuffix(ev.Content, "\n") {
		b.WriteString("\n")
	}
	b.WriteString(fence + "\n\n")
}

// RenderMarkdown renders a compiled per-host report into deterministic GitHub-Flavored Markdown and returns its SHA-256 digest (F-30).
func RenderMarkdown(doc *core.CompiledReport) (string, string) {
	populateArtifactHashes(doc)

	var b strings.Builder
	b.WriteString("# DoubleAgent — Security Assessment & Evidence Report\n\n")
	b.WriteString(fmt.Sprintf("- **Engagement:** %s\n", doc.EngagementName))
	if doc.EngagementScope != "" {
		b.WriteString(fmt.Sprintf("- **Scope:** %s\n", doc.EngagementScope))
	}
	if doc.EngagementTimeframe != "" {
		b.WriteString(fmt.Sprintf("- **Timeframe:** %s\n", doc.EngagementTimeframe))
	}
	b.WriteString(fmt.Sprintf("- **Revision Timestamp (UTC):** %s\n", doc.DeterministicTimestamp))
	b.WriteString(fmt.Sprintf("- **Host Sections:** %d | **Total Findings:** %d | **Total Evidence Artifacts:** %d\n",
		len(doc.HostSections), doc.TotalFindings, doc.TotalEvidence))
	if doc.InternalExcludedCount > 0 && !doc.IncludeInternal {
		b.WriteString(fmt.Sprintf("- **Internal Vault Privacy:** %d internal non-reportable proof artifacts excluded\n", doc.InternalExcludedCount))
	}
	b.WriteString("\n---\n\n")

	b.WriteString("## 1. Executive Severity Summary\n\n")
	b.WriteString("| Severity | Count |\n")
	b.WriteString("| :--- | ---: |\n")
	b.WriteString(fmt.Sprintf("| Critical | %d |\n", doc.TotalSeverityCounts.Critical))
	b.WriteString(fmt.Sprintf("| High | %d |\n", doc.TotalSeverityCounts.High))
	b.WriteString(fmt.Sprintf("| Medium | %d |\n", doc.TotalSeverityCounts.Medium))
	b.WriteString(fmt.Sprintf("| Low | %d |\n", doc.TotalSeverityCounts.Low))
	b.WriteString(fmt.Sprintf("| Info | %d |\n", doc.TotalSeverityCounts.Info))
	b.WriteString(fmt.Sprintf("| **Total Findings** | **%d** |\n\n", doc.TotalSeverityCounts.Total))

	b.WriteString("## 2. Target Host Index\n\n")
	if len(doc.HostSections) == 0 {
		b.WriteString("_No findings, evidence artifacts, or host records matched the selected filters._\n\n")
	} else {
		b.WriteString("| Host | Address | Findings | Evidence | Open Ports |\n")
		b.WriteString("| :--- | :--- | ---: | ---: | ---: |\n")
		for _, sec := range doc.HostSections {
			addr := sec.Address
			if addr == "" {
				addr = "-"
			}
			evTotal := len(sec.StandaloneEvidence)
			for _, f := range sec.Findings {
				evTotal += len(f.Evidence)
			}
			b.WriteString(fmt.Sprintf("| %s | %s | %d | %d | %d |\n",
				escapeMarkdownCell(sec.HostLabel), escapeMarkdownCell(addr), len(sec.Findings), evTotal, len(sec.PortFindings)))
		}
		b.WriteString("\n")
	}

	b.WriteString("---\n\n")
	b.WriteString("## 3. Per-Host Findings & Verified Evidence\n\n")

	for hIdx, sec := range doc.HostSections {
		titleAddr := ""
		if sec.Address != "" {
			titleAddr = fmt.Sprintf(" (%s)", sec.Address)
		}
		b.WriteString(fmt.Sprintf("### 3.%d Host: %s%s\n\n", hIdx+1, sec.HostLabel, titleAddr))
		if len(sec.Tags) > 0 {
			b.WriteString(fmt.Sprintf("- **Host Tags:** `%s`\n", strings.Join(sec.Tags, "`, `")))
		}
		b.WriteString(fmt.Sprintf("- **Severity Breakdown:** Critical: %d | High: %d | Medium: %d | Low: %d | Info: %d\n\n",
			sec.SeverityCounts.Critical, sec.SeverityCounts.High, sec.SeverityCounts.Medium, sec.SeverityCounts.Low, sec.SeverityCounts.Info))

		if len(sec.PortFindings) > 0 {
			b.WriteString("#### Discovered Ports & Services\n\n")
			b.WriteString("| Port | Proto | State | Service | Product / Version | Source |\n")
			b.WriteString("| ---: | :--- | :--- | :--- | :--- | :--- |\n")
			for _, pf := range sec.PortFindings {
				ver := strings.TrimSpace(pf.Product + " " + pf.Version)
				if ver == "" {
					ver = "-"
				}
				b.WriteString(fmt.Sprintf("| %d | %s | %s | %s | %s | %s |\n",
					pf.Port, escapeMarkdownCell(pf.Protocol), escapeMarkdownCell(pf.State),
					escapeMarkdownCell(pf.Service), escapeMarkdownCell(ver), escapeMarkdownCell(pf.Source)))
			}
			b.WriteString("\n")
		}

		for fIdx, fs := range sec.Findings {
			f := fs.Finding
			b.WriteString(fmt.Sprintf("#### 3.%d.%d [%s] %s\n\n", hIdx+1, fIdx+1, strings.ToUpper(f.Severity), f.Title))
			b.WriteString(fmt.Sprintf("- **Finding ID:** `%s`\n", f.ID))
			b.WriteString(fmt.Sprintf("- **Category:** %s | **Status:** %s\n", f.Category, strings.ToUpper(string(f.Status))))
			if f.CVE != "" {
				b.WriteString(fmt.Sprintf("- **CVE:** %s\n", f.CVE))
			}
			if f.CVSS != "" {
				vec := ""
				if f.CVSSVector != "" {
					vec = fmt.Sprintf(" (`%s`)", f.CVSSVector)
				}
				b.WriteString(fmt.Sprintf("- **CVSS v3.1:** %s%s\n", f.CVSS, vec))
			}
			if f.MitreAttack != "" {
				b.WriteString(fmt.Sprintf("- **MITRE ATT&CK:** %s\n", f.MitreAttack))
			}
			if !f.UpdatedAt.IsZero() {
				b.WriteString(fmt.Sprintf("- **Last Updated (UTC):** %s\n", f.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z")))
			}
			b.WriteString("\n")

			b.WriteString("##### Description\n\n")
			b.WriteString(f.Description + "\n\n")
			if strings.TrimSpace(f.Impact) != "" {
				b.WriteString("##### Impact\n\n")
				b.WriteString(f.Impact + "\n\n")
			}
			if strings.TrimSpace(f.Remediation) != "" {
				b.WriteString("##### Remediation\n\n")
				b.WriteString(f.Remediation + "\n\n")
			}

			if len(fs.Evidence) > 0 {
				b.WriteString(fmt.Sprintf("##### Supporting Proof Artifacts (%d)\n\n", len(fs.Evidence)))
				for evIdx, ev := range fs.Evidence {
					writeMarkdownEvidence(&b, evIdx+1, ev)
				}
			}

			if len(fs.Notes) > 0 {
				b.WriteString(fmt.Sprintf("##### Linked Killchain Notes (%d)\n\n", len(fs.Notes)))
				for _, np := range fs.Notes {
					fence := safeFenceFor(np.Body)
					b.WriteString(fmt.Sprintf("**%s** (`%s`)\n\n%smarkdown\n%s\n%s\n\n",
						np.Title, np.ID, fence, np.Body, fence))
				}
			}
		}

		if len(sec.StandaloneEvidence) > 0 {
			b.WriteString(fmt.Sprintf("#### Additional Host Evidence Artifacts (%d)\n\n", len(sec.StandaloneEvidence)))
			for evIdx, ev := range sec.StandaloneEvidence {
				writeMarkdownEvidence(&b, evIdx+1, ev)
			}
		}

		if len(sec.Notes) > 0 {
			b.WriteString(fmt.Sprintf("#### Host Documentation Notes (%d)\n\n", len(sec.Notes)))
			for _, np := range sec.Notes {
				fence := safeFenceFor(np.Body)
				b.WriteString(fmt.Sprintf("**%s** (Updated: %s)\n\n%smarkdown\n%s\n%s\n\n",
					np.Title, np.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"), fence, np.Body, fence))
			}
		}

		b.WriteString("---\n\n")
	}

	out := b.String()
	return out, sha256Hex([]byte(out))
}

var htmlReportTmpl = template.Must(template.New("report").Funcs(template.FuncMap{
	"upper": func(s string) string { return strings.ToUpper(s) },
	"join":  func(xs []string, sep string) string { return strings.Join(xs, sep) },
	"sevClass": func(s string) string {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "critical":
			return "sev-critical"
		case "high":
			return "sev-high"
		case "medium":
			return "sev-medium"
		case "low":
			return "sev-low"
		default:
			return "sev-info"
		}
	},
	"inc": func(i int) int { return i + 1 },
	"formatTime": func(t interface{ UTC() interface{} }) string {
		return fmt.Sprintf("%v", t)
	},
}).Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{{.EngagementName}} — DoubleAgent Assessment Report</title>
<style>
  :root {
    --bg: #0b1120;
    --surface: #111827;
    --border: #1e293b;
    --text: #e2e8f0;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --critical: #ef4444;
    --high: #f97316;
    --medium: #eab308;
    --low: #3b82f6;
    --info: #64748b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.55;
  }
  .container { max-width: 1120px; margin: 0 auto; }
  header {
    border-bottom: 2px solid var(--accent);
    padding-bottom: 1.25rem;
    margin-bottom: 1.5rem;
  }
  h1, h2, h3, h4 { margin: 0 0 0.6rem 0; color: #f8fafc; }
  h1 { font-size: 1.65rem; color: var(--accent); letter-spacing: 0.03em; }
  h2 { font-size: 1.2rem; margin-top: 1.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.35rem; }
  .meta-grid { display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; font-size: 0.88rem; color: var(--muted); }
  .meta-grid strong { color: var(--text); }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.65rem; margin: 1rem 0 1.5rem; }
  .kpi {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem;
    text-align: center;
  }
  .kpi .num { font-size: 1.45rem; font-weight: 700; display: block; }
  .kpi .lbl { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .badge {
    display: inline-block;
    padding: 0.14rem 0.5rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .sev-critical { background: rgba(239,68,68,0.2); color: #fca5a5; border: 1px solid var(--critical); }
  .sev-high { background: rgba(249,115,22,0.2); color: #fdba74; border: 1px solid var(--high); }
  .sev-medium { background: rgba(234,179,8,0.2); color: #fde047; border: 1px solid var(--medium); }
  .sev-low { background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid var(--low); }
  .sev-info { background: rgba(100,116,139,0.2); color: #cbd5e1; border: 1px solid var(--info); }
  .host-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    break-inside: avoid-page;
  }
  .finding-card {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    padding: 1rem;
    margin: 1rem 0;
  }
  .evidence-card {
    background: #020617;
    border: 1px solid #1e293b;
    border-radius: 5px;
    padding: 0.75rem;
    margin: 0.65rem 0;
  }
  .evidence-meta {
    font-size: 0.75rem;
    color: var(--muted);
    margin-bottom: 0.45rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  pre {
    margin: 0;
    padding: 0.65rem;
    background: rgba(15, 23, 42, 0.85);
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #e2e8f0;
  }
  table { width: 100%; border-collapse: collapse; margin: 0.6rem 0 1rem; font-size: 0.84rem; }
  th, td { border: 1px solid var(--border); padding: 0.45rem 0.6rem; text-align: left; }
  th { background: rgba(56, 189, 248, 0.1); color: var(--accent); font-weight: 600; }
  .notice {
    background: rgba(56, 189, 248, 0.08);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 5px;
    padding: 0.6rem 0.85rem;
    font-size: 0.84rem;
    color: #bae6fd;
    margin-bottom: 1rem;
  }
  @media print {
    body { background: #ffffff; color: #0f172a; padding: 0.75rem; }
    h1, h2, h3, h4 { color: #0f172a; }
    .host-card, .finding-card, .kpi { background: #ffffff; border-color: #cbd5e1; }
    .evidence-card, pre { background: #f8fafc; color: #0f172a; border-color: #cbd5e1; }
    th { background: #f1f5f9; color: #0f172a; }
    .meta-grid, .evidence-meta, .kpi .lbl { color: #475569; }
    .meta-grid strong { color: #0f172a; }
    .notice { background: #f8fafc; color: #0f172a; border-color: #94a3b8; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>DoubleAgent — Security Assessment &amp; Evidence Report</h1>
    <div class="meta-grid">
      <div><strong>Engagement:</strong> {{.EngagementName}}</div>
      {{if .EngagementScope}}<div><strong>Scope:</strong> {{.EngagementScope}}</div>{{end}}
      {{if .EngagementTimeframe}}<div><strong>Timeframe:</strong> {{.EngagementTimeframe}}</div>{{end}}
      <div><strong>Revision (UTC):</strong> {{.DeterministicTimestamp}}</div>
      <div><strong>Host Sections:</strong> {{len .HostSections}}</div>
      <div><strong>Findings:</strong> {{.TotalFindings}}</div>
      <div><strong>Evidence Proofs:</strong> {{.TotalEvidence}}</div>
    </div>
  </header>

  {{if and (gt .InternalExcludedCount 0) (not .IncludeInternal)}}
  <div class="notice">
    Internal Vault Privacy Guard: {{.InternalExcludedCount}} non-reportable internal vault artifact(s) were automatically excluded from this report.
  </div>
  {{end}}

  <section>
    <h2>Executive Severity Summary</h2>
    <div class="kpi-row">
      <div class="kpi"><span class="num" style="color:#ef4444">{{.TotalSeverityCounts.Critical}}</span><span class="lbl">Critical</span></div>
      <div class="kpi"><span class="num" style="color:#f97316">{{.TotalSeverityCounts.High}}</span><span class="lbl">High</span></div>
      <div class="kpi"><span class="num" style="color:#eab308">{{.TotalSeverityCounts.Medium}}</span><span class="lbl">Medium</span></div>
      <div class="kpi"><span class="num" style="color:#3b82f6">{{.TotalSeverityCounts.Low}}</span><span class="lbl">Low</span></div>
      <div class="kpi"><span class="num" style="color:#94a3b8">{{.TotalSeverityCounts.Info}}</span><span class="lbl">Info</span></div>
      <div class="kpi"><span class="num">{{.TotalSeverityCounts.Total}}</span><span class="lbl">Total Findings</span></div>
    </div>
  </section>

  <section>
    <h2>Per-Host Assessment Details</h2>
    {{if not .HostSections}}
      <p>No hosts, findings, or reportable evidence matched the export filter.</p>
    {{end}}
    {{range $hi, $sec := .HostSections}}
    <article class="host-card" id="host-{{$sec.Slug}}">
      <h3>{{inc $hi}}. {{$sec.HostLabel}}{{if $sec.Address}} ({{$sec.Address}}){{end}}</h3>
      <div class="meta-grid" style="margin-bottom:0.75rem;">
        <div><strong>Findings:</strong> {{len $sec.Findings}}</div>
        <div><strong>Ports:</strong> {{len $sec.PortFindings}}</div>
        {{if $sec.Tags}}<div><strong>Tags:</strong> {{join $sec.Tags ", "}}</div>{{end}}
      </div>

      {{if $sec.PortFindings}}
      <h4>Discovered Ports &amp; Services</h4>
      <table>
        <thead><tr><th>Port</th><th>Protocol</th><th>State</th><th>Service</th><th>Product / Version</th><th>Source</th></tr></thead>
        <tbody>
        {{range $sec.PortFindings}}
          <tr><td>{{.Port}}</td><td>{{.Protocol}}</td><td>{{.State}}</td><td>{{.Service}}</td><td>{{.Product}} {{.Version}}</td><td>{{.Source}}</td></tr>
        {{end}}
        </tbody>
      </table>
      {{end}}

      {{range $fi, $fs := $sec.Findings}}
      <div class="finding-card">
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.4rem;">
          <span class="badge {{sevClass $fs.Finding.Severity}}">{{upper $fs.Finding.Severity}}</span>
          <strong style="font-size:1.02rem;">{{$fs.Finding.Title}}</strong>
        </div>
        <div class="meta-grid" style="margin-bottom:0.65rem;">
          <div><strong>ID:</strong> {{$fs.Finding.ID}}</div>
          <div><strong>Category:</strong> {{$fs.Finding.Category}}</div>
          <div><strong>Status:</strong> {{upper (printf "%s" $fs.Finding.Status)}}</div>
          {{if $fs.Finding.CVE}}<div><strong>CVE:</strong> {{$fs.Finding.CVE}}</div>{{end}}
          {{if $fs.Finding.CVSS}}<div><strong>CVSS:</strong> {{$fs.Finding.CVSS}}{{if $fs.Finding.CVSSVector}} ({{$fs.Finding.CVSSVector}}){{end}}</div>{{end}}
          {{if $fs.Finding.MitreAttack}}<div><strong>MITRE ATT&amp;CK:</strong> {{$fs.Finding.MitreAttack}}</div>{{end}}
        </div>

        <p><strong>Description:</strong><br />{{$fs.Finding.Description}}</p>
        {{if $fs.Finding.Impact}}<p><strong>Impact:</strong><br />{{$fs.Finding.Impact}}</p>{{end}}
        {{if $fs.Finding.Remediation}}<p><strong>Remediation:</strong><br />{{$fs.Finding.Remediation}}</p>{{end}}

        {{if $fs.Evidence}}
        <h4>Supporting Evidence Artifacts ({{len $fs.Evidence}})</h4>
        {{range $fs.Evidence}}
        <div class="evidence-card">
          <div><strong>{{.Title}}</strong>{{if not .InReport}} <span class="badge sev-medium">INTERNAL VAULT ONLY</span>{{end}}</div>
          <div class="evidence-meta">
            ID: {{.ID}} · Category: {{.Category}}{{if .Source}} · Source: {{.Source}}{{end}}{{if .CapturedAt}} · Captured (UTC): {{.CapturedAt}}{{end}}{{if .ContentSHA256}} · SHA-256: {{.ContentSHA256}}{{end}}
          </div>
          {{if .Table}}
          <table>
            <thead><tr>{{range .Table.Headers}}<th>{{.}}</th>{{end}}</tr></thead>
            <tbody>{{range .Table.Rows}}<tr>{{range .}}<td>{{.}}</td>{{end}}</tr>{{end}}</tbody>
          </table>
          {{else}}
          <pre>{{.Content}}</pre>
          {{end}}
        </div>
        {{end}}
        {{end}}

        {{if $fs.Notes}}
        <h4>Linked Killchain Notes ({{len $fs.Notes}})</h4>
        {{range $fs.Notes}}
        <div class="evidence-card">
          <div><strong>{{.Title}}</strong></div>
          <pre>{{.Body}}</pre>
        </div>
        {{end}}
        {{end}}
      </div>
      {{end}}

      {{if $sec.StandaloneEvidence}}
      <h4>Additional Host Evidence Artifacts ({{len $sec.StandaloneEvidence}})</h4>
      {{range $sec.StandaloneEvidence}}
      <div class="evidence-card">
        <div><strong>{{.Title}}</strong>{{if not .InReport}} <span class="badge sev-medium">INTERNAL VAULT ONLY</span>{{end}}</div>
        <div class="evidence-meta">
          ID: {{.ID}} · Category: {{.Category}}{{if .Source}} · Source: {{.Source}}{{end}}{{if .CapturedAt}} · Captured (UTC): {{.CapturedAt}}{{end}}{{if .ContentSHA256}} · SHA-256: {{.ContentSHA256}}{{end}}
        </div>
        {{if .Table}}
        <table>
          <thead><tr>{{range .Table.Headers}}<th>{{.}}</th>{{end}}</tr></thead>
          <tbody>{{range .Table.Rows}}<tr>{{range .}}<td>{{.}}</td>{{end}}</tr>{{end}}</tbody>
        </table>
        {{else}}
        <pre>{{.Content}}</pre>
        {{end}}
      </div>
      {{end}}
      {{end}}

      {{if $sec.Notes}}
      <h4>Host Documentation Notes ({{len $sec.Notes}})</h4>
      {{range $sec.Notes}}
      <div class="evidence-card">
        <div><strong>{{.Title}}</strong></div>
        <pre>{{.Body}}</pre>
      </div>
      {{end}}
      {{end}}
    </article>
    {{end}}
  </section>
</div>
</body>
</html>
`))

// RenderHTML renders a compiled per-host report into a self-contained, XSS-escaped standalone HTML5 document and returns its SHA-256 digest (F-30).
func RenderHTML(doc *core.CompiledReport) (string, string, error) {
	populateArtifactHashes(doc)
	var buf bytes.Buffer
	if err := htmlReportTmpl.Execute(&buf, doc); err != nil {
		return "", "", fmt.Errorf("failed to execute HTML report template: %w", err)
	}
	out := buf.String()
	return out, sha256Hex([]byte(out)), nil
}

func renderReportArtifact(doc *core.CompiledReport, format string) (previewContent string, rawBytes []byte, b64 string, digest string, ext string, err error) {
	switch core.NormalizeReportFormat(format) {
	case core.ReportFormatHTML:
		content, sum, renderErr := RenderHTML(doc)
		if renderErr != nil {
			return "", nil, "", "", ".html", renderErr
		}
		raw := []byte(content)
		return content, raw, "", sum, ".html", nil
	case core.ReportFormatDOCX:
		raw, sum, renderErr := RenderDOCX(doc)
		if renderErr != nil {
			return "", nil, "", "", ".docx", renderErr
		}
		mdPreview, _ := RenderMarkdown(doc)
		banner := fmt.Sprintf("> **Word Pentest Report Scaffold (.docx)** — %d bytes · SHA-256: `%s`\n> Includes Cover & Document Control, Editable Executive Summary & Risk Matrix, Scope & Methodology, Attack Path Narrative, Per-Host Findings & Proof Artifacts, Port Discovery Appendix, and SHA-256 Provenance Manifest.\n\n", len(raw), sum)
		return banner + mdPreview, raw, base64.StdEncoding.EncodeToString(raw), sum, ".docx", nil
	default:
		content, sum := RenderMarkdown(doc)
		raw := []byte(content)
		return content, raw, "", sum, ".md", nil
	}
}

func writeContainedFile(baseDir string, filename string, data []byte) (string, error) {
	absBase, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	cleanName := filepath.Base(filename)
	if cleanName == "." || cleanName == ".." || cleanName == "" {
		return "", errors.New("invalid output filename")
	}
	target := filepath.Join(absBase, cleanName)
	rel, err := filepath.Rel(absBase, target)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", errors.New("path traversal detected in report export filename")
	}
	if err := os.WriteFile(target, data, 0o600); err != nil {
		return "", err
	}
	return target, nil
}

// CompileAndExport builds a report (Markdown/HTML/DOCX) and optionally writes consolidated or per-host files to OutputDir (F-30).
func CompileAndExport(req core.ReportExportRequest, payload core.VaultPayload) (*core.ReportExportResult, error) {
	req.Format = core.NormalizeReportFormat(req.Format)
	doc, err := core.BuildCompiledReport(req, payload)
	if err != nil {
		return nil, err
	}

	previewContent, rawBytes, b64, digest, ext, err := renderReportArtifact(doc, req.Format)
	if err != nil {
		return nil, err
	}

	baseSlug := core.SanitizeReportSlug(doc.EngagementName)
	if doc.TargetHostID != "" && len(doc.HostSections) == 1 {
		baseSlug += "-" + doc.HostSections[0].Slug
	}
	defaultFilename := baseSlug + "-report" + ext

	res := &core.ReportExportResult{
		Format:           req.Format,
		FileName:         defaultFilename,
		Content:          previewContent,
		ContentBase64:    b64,
		ContentSHA256:    digest,
		FindingsCount:    doc.TotalFindings,
		EvidenceCount:    doc.TotalEvidence,
		HostCount:        len(doc.HostSections),
		InternalExcluded: doc.InternalExcludedCount,
	}

	outDir := strings.TrimSpace(req.OutputDir)
	if outDir == "" {
		return res, nil
	}
	if err := os.MkdirAll(outDir, 0o750); err != nil {
		return nil, fmt.Errorf("failed to prepare report output directory: %w", err)
	}

	if req.SplitByHost && len(doc.HostSections) > 0 {
		var manifest strings.Builder
		seenNames := make(map[string]int)
		for _, sec := range doc.HostSections {
			hostReq := req
			hostReq.HostID = sec.HostID
			hostReq.OutputDir = ""
			hostDoc, hErr := core.BuildCompiledReport(hostReq, payload)
			if hErr != nil {
				return nil, hErr
			}
			_, hRaw, _, hDigest, _, hRenderErr := renderReportArtifact(hostDoc, req.Format)
			if hRenderErr != nil {
				return nil, hRenderErr
			}

			nameStem := fmt.Sprintf("%s-%s", baseSlug, sec.Slug)
			if seenNames[nameStem] > 0 {
				nameStem = fmt.Sprintf("%s-%d", nameStem, seenNames[nameStem]+1)
			}
			seenNames[nameStem]++
			fname := nameStem + ext

			writtenPath, wErr := writeContainedFile(outDir, fname, hRaw)
			if wErr != nil {
				return nil, wErr
			}
			res.WrittenFiles = append(res.WrittenFiles, core.ReportWrittenFile{
				HostID:    sec.HostID,
				HostLabel: sec.HostLabel,
				FileName:  fname,
				FilePath:  writtenPath,
				SHA256:    hDigest,
				Bytes:     len(hRaw),
			})
			manifest.WriteString(fmt.Sprintf("%s  %s\n", hDigest, fname))
		}

		manifestBytes := []byte(manifest.String())
		manifestPath, mErr := writeContainedFile(outDir, "manifest.sha256", manifestBytes)
		if mErr == nil {
			res.WrittenFiles = append(res.WrittenFiles, core.ReportWrittenFile{
				HostLabel: "SHA-256 Integrity Manifest",
				FileName:  "manifest.sha256",
				FilePath:  manifestPath,
				SHA256:    sha256Hex(manifestBytes),
				Bytes:     len(manifestBytes),
			})
		}
		return res, nil
	}

	writtenPath, err := writeContainedFile(outDir, defaultFilename, rawBytes)
	if err != nil {
		return nil, err
	}
	res.WrittenFiles = append(res.WrittenFiles, core.ReportWrittenFile{
		HostID:    doc.TargetHostID,
		HostLabel: doc.EngagementName,
		FileName:  defaultFilename,
		FilePath:  writtenPath,
		SHA256:    digest,
		Bytes:     len(rawBytes),
	})
	return res, nil
}

// ExportToFile compiles the report and writes it directly to the user-selected destination path (F-30).
func ExportToFile(req core.ReportExportRequest, payload core.VaultPayload, filePath string) (*core.ReportExportResult, error) {
	trimmed := strings.TrimSpace(filePath)
	if trimmed == "" {
		return nil, errors.New("destination file path cannot be empty")
	}
	doc, err := core.BuildCompiledReport(req, payload)
	if err != nil {
		return nil, err
	}
	previewContent, raw, b64, digest, _, err := renderReportArtifact(doc, req.Format)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(trimmed), 0o750); err != nil {
		return nil, fmt.Errorf("failed to create parent directory: %w", err)
	}
	if err := os.WriteFile(trimmed, raw, 0o600); err != nil {
		return nil, fmt.Errorf("failed to write report file: %w", err)
	}
	fname := filepath.Base(trimmed)
	return &core.ReportExportResult{
		Format:           core.NormalizeReportFormat(req.Format),
		FileName:         fname,
		Content:          previewContent,
		ContentBase64:    b64,
		ContentSHA256:    digest,
		FindingsCount:    doc.TotalFindings,
		EvidenceCount:    doc.TotalEvidence,
		HostCount:        len(doc.HostSections),
		InternalExcluded: doc.InternalExcludedCount,
		WrittenFiles: []core.ReportWrittenFile{
			{
				HostID:    req.HostID,
				HostLabel: fname,
				FileName:  fname,
				FilePath:  trimmed,
				SHA256:    digest,
				Bytes:     len(raw),
			},
		},
	}, nil
}

