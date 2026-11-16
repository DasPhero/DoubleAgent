package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	ReportFormatMarkdown = "markdown"
	ReportFormatHTML     = "html"
	ReportFormatDOCX     = "docx"
)

// ReportExportRequest configures a reproducible Markdown, HTML, or Word (.docx) Evidence-Vault export (Pentest F-30).
type ReportExportRequest struct {
	EngagementID            string `json:"engagementId,omitempty"`
	HostID                  string `json:"hostId,omitempty"` // "" exports all hosts grouped per-host
	Format                  string `json:"format"`           // "markdown" | "html" | "docx"
	SplitByHost             bool   `json:"splitByHost,omitempty"`
	IncludeInternalEvidence bool   `json:"includeInternalEvidence,omitempty"`
	IncludePortFindings     bool   `json:"includePortFindings"`
	IncludeUnlinkedEvidence bool   `json:"includeUnlinkedEvidence"`
	IncludeLinkedNotes      bool   `json:"includeLinkedNotes"`
	OutputDir               string `json:"outputDir,omitempty"`
}

// NormalizeReportFormat canonicalizes requested output format strings.
func NormalizeReportFormat(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "md", "markdown":
		return ReportFormatMarkdown
	case "htm", "html":
		return ReportFormatHTML
	case "doc", "docx", "word":
		return ReportFormatDOCX
	default:
		return strings.ToLower(strings.TrimSpace(raw))
	}
}

// ValidateReportExportRequest ensures format and options are valid.
func ValidateReportExportRequest(req ReportExportRequest) error {
	switch NormalizeReportFormat(req.Format) {
	case ReportFormatMarkdown, ReportFormatHTML, ReportFormatDOCX:
		return nil
	default:
		return fmt.Errorf("unsupported report format %q (expected markdown, html, or docx)", req.Format)
	}
}

// SanitizeReportSlug produces a filesystem-safe, traversal-proof filename segment from labels or hostnames.
func SanitizeReportSlug(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "engagement-wide"
	}
	var b strings.Builder
	prevUnderscore := false
	for _, r := range trimmed {
		isAlnum := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
		if isAlnum || r == '-' || r == '.' {
			b.WriteRune(r)
			prevUnderscore = false
		} else if !prevUnderscore {
			b.WriteByte('_')
			prevUnderscore = true
		}
	}
	slug := strings.Trim(b.String(), "._-")
	slug = strings.ReplaceAll(slug, "..", "_")
	if slug == "" {
		return "host"
	}
	return slug
}

// ReportSeverityCounts summarizes findings per severity level.
type ReportSeverityCounts struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
	Info     int `json:"info"`
	Total    int `json:"total"`
}

func (c *ReportSeverityCounts) add(sev string) {
	switch strings.ToLower(strings.TrimSpace(sev)) {
	case "critical":
		c.Critical++
	case "high":
		c.High++
	case "medium":
		c.Medium++
	case "low":
		c.Low++
	default:
		c.Info++
	}
	c.Total++
}

// ReportEvidenceArtifact is a compiled, reproducible proof record with provenance and hash slot.
type ReportEvidenceArtifact struct {
	ID            string                `json:"id"`
	Title         string                `json:"title"`
	Category      string                `json:"category"`
	Type          EvidenceType          `json:"type"`
	Severity      string                `json:"severity,omitempty"`
	Source        string                `json:"source,omitempty"`
	CapturedAt    string                `json:"capturedAt"` // Deterministic RFC3339 UTC
	InReport      bool                  `json:"inReport"`
	Content       string                `json:"content"`
	Table         *TableEvidenceContent `json:"table,omitempty"`
	Tags          []string              `json:"tags,omitempty"`
	ContentSHA256 string                `json:"contentSha256,omitempty"`
}

// ReportFindingSection groups a FindingItem with its linked reportable evidence and killchain notes.
type ReportFindingSection struct {
	Finding  FindingItem              `json:"finding"`
	Evidence []ReportEvidenceArtifact `json:"evidence,omitempty"`
	Notes    []NotePage               `json:"notes,omitempty"`
}

// ReportHostSection aggregates all reportable intelligence for a single target host (or Engagement-Wide).
type ReportHostSection struct {
	HostID             string                   `json:"hostId"`
	HostLabel          string                   `json:"hostLabel"`
	Address            string                   `json:"address,omitempty"`
	Slug               string                   `json:"slug"`
	Tags               []string                 `json:"tags,omitempty"`
	SeverityCounts     ReportSeverityCounts     `json:"severityCounts"`
	Findings           []ReportFindingSection   `json:"findings,omitempty"`
	StandaloneEvidence []ReportEvidenceArtifact `json:"standaloneEvidence,omitempty"`
	PortFindings       []PortFinding            `json:"portFindings,omitempty"`
	Notes              []NotePage               `json:"notes,omitempty"`
}

// CompiledReport is the deterministic structured representation rendered to Markdown or HTML (F-30).
type CompiledReport struct {
	EngagementID           string               `json:"engagementId,omitempty"`
	EngagementName         string               `json:"engagementName"`
	EngagementScope        string               `json:"engagementScope,omitempty"`
	EngagementTimeframe    string               `json:"engagementTimeframe,omitempty"`
	TargetHostID           string               `json:"targetHostId,omitempty"`
	Format                 string               `json:"format"`
	DeterministicTimestamp string               `json:"deterministicTimestamp"`
	IncludeInternal        bool                 `json:"includeInternal"`
	TotalSeverityCounts    ReportSeverityCounts `json:"totalSeverityCounts"`
	TotalFindings          int                  `json:"totalFindings"`
	TotalEvidence          int                  `json:"totalEvidence"`
	InternalExcludedCount  int                  `json:"internalExcludedCount"`
	HostSections           []ReportHostSection  `json:"hostSections"`
}

// ReportWrittenFile describes a single file written during consolidated or per-host batch export (F-30).
type ReportWrittenFile struct {
	HostID    string `json:"hostId,omitempty"`
	HostLabel string `json:"hostLabel"`
	FileName  string `json:"fileName"`
	FilePath  string `json:"filePath"`
	SHA256    string `json:"sha256"`
	Bytes     int    `json:"bytes"`
}

// ReportExportResult is returned to the UI after compiling or saving an F-30 report.
type ReportExportResult struct {
	Format           string              `json:"format"`
	FileName         string              `json:"fileName"`
	Content          string              `json:"content"`
	ContentBase64    string              `json:"contentBase64,omitempty"`
	ContentSHA256    string              `json:"contentSha256"`
	FindingsCount    int                 `json:"findingsCount"`
	EvidenceCount    int                 `json:"evidenceCount"`
	HostCount        int                 `json:"hostCount"`
	InternalExcluded int                 `json:"internalExcluded"`
	WrittenFiles     []ReportWrittenFile `json:"writtenFiles,omitempty"`
}

func severityRank(sev string) int {
	switch strings.ToLower(strings.TrimSpace(sev)) {
	case "critical":
		return 0
	case "high":
		return 1
	case "medium":
		return 2
	case "low":
		return 3
	default:
		return 4
	}
}

func toReportEvidenceArtifact(ev EvidenceItem) ReportEvidenceArtifact {
	ts := ""
	if !ev.CapturedAt.IsZero() {
		ts = ev.CapturedAt.UTC().Format(time.RFC3339)
	}
	art := ReportEvidenceArtifact{
		ID:         ev.ID,
		Title:      ev.Title,
		Category:   ev.Category,
		Type:       ev.Type,
		Severity:   ev.Severity,
		Source:     ev.Source,
		CapturedAt: ts,
		InReport:   ev.InReport,
		Content:    ev.Content,
		Tags:       append([]string(nil), ev.Tags...),
	}
	if ev.Type == EvidenceTypeTable && strings.TrimSpace(ev.Content) != "" {
		var tbl TableEvidenceContent
		if err := json.Unmarshal([]byte(ev.Content), &tbl); err == nil && len(tbl.Headers) > 0 {
			art.Table = &tbl
		}
	}
	return art
}

// BuildCompiledReport compiles a deterministic, per-host grouped pentest report from VaultPayload (F-30).
func BuildCompiledReport(req ReportExportRequest, payload VaultPayload) (*CompiledReport, error) {
	req.Format = NormalizeReportFormat(req.Format)
	if err := ValidateReportExportRequest(req); err != nil {
		return nil, err
	}

	engName := "Default Engagement"
	engScope := ""
	engTimeframe := ""
	for _, e := range payload.Engagements {
		if req.EngagementID != "" && e.ID == req.EngagementID {
			engName = e.Name
			engScope = e.Scope
			engTimeframe = e.Timeframe
			break
		}
	}

	hostByID := make(map[string]HostRecord, len(payload.Hosts))
	for _, h := range payload.Hosts {
		hostByID[h.ID] = h
	}
	if req.HostID != "" {
		if _, exists := hostByID[req.HostID]; !exists && req.HostID != "engagement-wide" {
			// Check whether any artifact references this HostID before failing.
			foundRef := false
			for _, f := range payload.Findings {
				if f.HostID == req.HostID {
					foundRef = true
					break
				}
			}
			for _, ev := range payload.Evidence {
				if ev.HostID == req.HostID {
					foundRef = true
					break
				}
			}
			if !foundRef {
				return nil, errors.New("requested host not found in vault")
			}
		}
	}

	noteByID := make(map[string]NotePage, len(payload.Notes))
	for _, np := range payload.Notes {
		noteByID[np.ID] = np
	}

	evByID := make(map[string]EvidenceItem, len(payload.Evidence))
	internalExcluded := 0
	var maxTS time.Time
	recordTime := func(t time.Time) {
		if !t.IsZero() && t.After(maxTS) {
			maxTS = t.UTC()
		}
	}

	for _, ev := range payload.Evidence {
		if req.EngagementID != "" && ev.EngagementID != "" && ev.EngagementID != req.EngagementID {
			continue
		}
		if req.HostID != "" && ev.HostID != req.HostID {
			continue
		}
		evByID[ev.ID] = ev
		if !ev.InReport && !req.IncludeInternalEvidence {
			internalExcluded++
		}
	}

	// Track which hosts appear in findings, evidence, ports, or requested HostID
	sectionMap := make(map[string]*ReportHostSection)
	getSection := func(hostID string) *ReportHostSection {
		key := strings.TrimSpace(hostID)
		if key == "" {
			key = "engagement-wide"
		}
		if sec, ok := sectionMap[key]; ok {
			return sec
		}
		label := "Engagement-Wide & Unassigned Artifacts"
		addr := ""
		var tags []string
		if key != "engagement-wide" {
			if h, ok := hostByID[key]; ok {
				label = h.Label
				addr = h.Address
				tags = append([]string(nil), h.Tags...)
			} else {
				label = key
			}
		}
		slugSource := label
		if addr != "" {
			slugSource = label + "-" + addr
		}
		sec := &ReportHostSection{
			HostID:    key,
			HostLabel: label,
			Address:   addr,
			Slug:      SanitizeReportSlug(slugSource),
			Tags:      tags,
		}
		sectionMap[key] = sec
		return sec
	}

	if req.HostID != "" {
		getSection(req.HostID)
	}

	usedEvidenceIDs := make(map[string]bool)
	totalFindings := 0
	totalEvidence := 0
	var totalCounts ReportSeverityCounts

	// 1. Collect & sort findings deterministically
	var filteredFindings []FindingItem
	for _, f := range payload.Findings {
		if req.EngagementID != "" && f.EngagementID != "" && f.EngagementID != req.EngagementID {
			continue
		}
		if req.HostID != "" {
			matchesHost := f.HostID == req.HostID
			if !matchesHost {
				for _, ah := range f.AffectedHosts {
					if ah == req.HostID {
						matchesHost = true
						break
					}
				}
			}
			if !matchesHost {
				continue
			}
		}
		filteredFindings = append(filteredFindings, f)
	}

	sort.Slice(filteredFindings, func(i, j int) bool {
		ri, rj := severityRank(filteredFindings[i].Severity), severityRank(filteredFindings[j].Severity)
		if ri != rj {
			return ri < rj
		}
		if filteredFindings[i].Title != filteredFindings[j].Title {
			return filteredFindings[i].Title < filteredFindings[j].Title
		}
		return filteredFindings[i].ID < filteredFindings[j].ID
	})

	for _, f := range filteredFindings {
		recordTime(f.CreatedAt)
		recordTime(f.UpdatedAt)

		secKey := f.HostID
		if req.HostID != "" {
			secKey = req.HostID
		}
		sec := getSection(secKey)
		sec.SeverityCounts.add(f.Severity)
		totalCounts.add(f.Severity)
		totalFindings++

		// Gather attached reportable evidence (deduplicated per finding)
		attachedSet := make(map[string]EvidenceItem)
		for _, eid := range f.EvidenceIDs {
			if ev, ok := payloadEvidenceLookup(payload.Evidence, eid); ok {
				if req.EngagementID != "" && ev.EngagementID != "" && ev.EngagementID != req.EngagementID {
					continue
				}
				if ev.InReport || req.IncludeInternalEvidence {
					attachedSet[ev.ID] = ev
				}
			}
		}
		for _, ev := range payload.Evidence {
			if ev.FindingID == f.ID {
				if req.EngagementID != "" && ev.EngagementID != "" && ev.EngagementID != req.EngagementID {
					continue
				}
				if ev.InReport || req.IncludeInternalEvidence {
					attachedSet[ev.ID] = ev
				}
			}
		}

		attachedList := make([]EvidenceItem, 0, len(attachedSet))
		for _, ev := range attachedSet {
			attachedList = append(attachedList, ev)
			usedEvidenceIDs[ev.ID] = true
			recordTime(ev.CapturedAt)
		}
		sort.Slice(attachedList, func(i, j int) bool {
			if !attachedList[i].CapturedAt.Equal(attachedList[j].CapturedAt) {
				return attachedList[i].CapturedAt.Before(attachedList[j].CapturedAt)
			}
			return attachedList[i].ID < attachedList[j].ID
		})

		artifacts := make([]ReportEvidenceArtifact, 0, len(attachedList))
		for _, ev := range attachedList {
			artifacts = append(artifacts, toReportEvidenceArtifact(ev))
			totalEvidence++
		}

		var linkedNotes []NotePage
		if req.IncludeLinkedNotes {
			for _, nid := range f.NoteIDs {
				if np, ok := noteByID[nid]; ok {
					linkedNotes = append(linkedNotes, np)
					recordTime(np.UpdatedAt)
				}
			}
			sort.Slice(linkedNotes, func(i, j int) bool {
				return linkedNotes[i].ID < linkedNotes[j].ID
			})
		}

		sec.Findings = append(sec.Findings, ReportFindingSection{
			Finding:  f,
			Evidence: artifacts,
			Notes:    linkedNotes,
		})
	}

	// 2. Standalone reportable evidence per host
	if req.IncludeUnlinkedEvidence {
		var standalone []EvidenceItem
		for _, ev := range payload.Evidence {
			if req.EngagementID != "" && ev.EngagementID != "" && ev.EngagementID != req.EngagementID {
				continue
			}
			if req.HostID != "" && ev.HostID != req.HostID {
				continue
			}
			if usedEvidenceIDs[ev.ID] {
				continue
			}
			if !ev.InReport && !req.IncludeInternalEvidence {
				continue
			}
			standalone = append(standalone, ev)
		}
		sort.Slice(standalone, func(i, j int) bool {
			if !standalone[i].CapturedAt.Equal(standalone[j].CapturedAt) {
				return standalone[i].CapturedAt.Before(standalone[j].CapturedAt)
			}
			return standalone[i].ID < standalone[j].ID
		})
		for _, ev := range standalone {
			recordTime(ev.CapturedAt)
			sec := getSection(ev.HostID)
			sec.StandaloneEvidence = append(sec.StandaloneEvidence, toReportEvidenceArtifact(ev))
			totalEvidence++
		}
	}

	// 3. Discovered PortFindings per host
	if req.IncludePortFindings {
		var ports []PortFinding
		for _, pf := range payload.PortFindings {
			if req.EngagementID != "" && pf.EngagementID != "" && pf.EngagementID != req.EngagementID {
				continue
			}
			if req.HostID != "" && pf.HostID != req.HostID {
				continue
			}
			ports = append(ports, pf)
		}
		sort.Slice(ports, func(i, j int) bool {
			if ports[i].Port != ports[j].Port {
				return ports[i].Port < ports[j].Port
			}
			if ports[i].Protocol != ports[j].Protocol {
				return ports[i].Protocol < ports[j].Protocol
			}
			return ports[i].ID < ports[j].ID
		})
		for _, pf := range ports {
			recordTime(pf.CreatedAt)
			sec := getSection(pf.HostID)
			sec.PortFindings = append(sec.PortFindings, pf)
		}
	}

	// 4. Optional host notes when requested
	if req.IncludeLinkedNotes {
		var hostNotes []NotePage
		for _, np := range payload.Notes {
			if np.HostID == "" {
				continue
			}
			if req.HostID != "" && np.HostID != req.HostID {
				continue
			}
			// Only attach notes for hosts already represented (or explicitly targeted)
			if _, ok := sectionMap[np.HostID]; ok || req.HostID == np.HostID {
				hostNotes = append(hostNotes, np)
			}
		}
		sort.Slice(hostNotes, func(i, j int) bool {
			if hostNotes[i].Title != hostNotes[j].Title {
				return hostNotes[i].Title < hostNotes[j].Title
			}
			return hostNotes[i].ID < hostNotes[j].ID
		})
		for _, np := range hostNotes {
			recordTime(np.UpdatedAt)
			sec := getSection(np.HostID)
			sec.Notes = append(sec.Notes, np)
		}
	}

	sections := make([]ReportHostSection, 0, len(sectionMap))
	for _, sec := range sectionMap {
		sections = append(sections, *sec)
	}
	sort.Slice(sections, func(i, j int) bool {
		// Push "engagement-wide" section after concrete hosts when multiple sections exist
		if sections[i].HostID == "engagement-wide" && sections[j].HostID != "engagement-wide" {
			return false
		}
		if sections[j].HostID == "engagement-wide" && sections[i].HostID != "engagement-wide" {
			return true
		}
		if sections[i].HostLabel != sections[j].HostLabel {
			return sections[i].HostLabel < sections[j].HostLabel
		}
		return sections[i].HostID < sections[j].HostID
	})

	detTS := "N/A (empty vault)"
	if !maxTS.IsZero() {
		detTS = maxTS.UTC().Format(time.RFC3339)
	}

	return &CompiledReport{
		EngagementID:           req.EngagementID,
		EngagementName:         engName,
		EngagementScope:        engScope,
		EngagementTimeframe:    engTimeframe,
		TargetHostID:           req.HostID,
		Format:                 req.Format,
		DeterministicTimestamp: detTS,
		IncludeInternal:        req.IncludeInternalEvidence,
		TotalSeverityCounts:    totalCounts,
		TotalFindings:          totalFindings,
		TotalEvidence:          totalEvidence,
		InternalExcludedCount:  internalExcluded,
		HostSections:           sections,
	}, nil
}

func payloadEvidenceLookup(items []EvidenceItem, id string) (EvidenceItem, bool) {
	for _, it := range items {
		if it.ID == id {
			return it, true
		}
	}
	return EvidenceItem{}, false
}
