package core

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	FindingTemplatesFileName  = "finding_templates.json"
	EvidenceTemplatesFileName = "evidence_templates.json"
	ReportTemplatesFileName   = "report_templates.json"
)

// ReportTemplate defines customizable narrative sections and metadata defaults for exported pentest reports.
type ReportTemplate struct {
	ID                    string   `json:"id"`
	Name                  string   `json:"name"`
	Description           string   `json:"description,omitempty"`
	TitlePrefix           string   `json:"titlePrefix,omitempty"`
	Author                string   `json:"author,omitempty"`
	Classification        string   `json:"classification,omitempty"`
	ExecutiveSummaryIntro string   `json:"executiveSummaryIntro,omitempty"`
	MethodologyText       string   `json:"methodologyText,omitempty"`
	ScopeNotes            string   `json:"scopeNotes,omitempty"`
	AttackPathTemplate    string   `json:"attackPathTemplate,omitempty"`
	LimitationsText       string   `json:"limitationsText,omitempty"`
	ConclusionText        string   `json:"conclusionText,omitempty"`
	Tags                  []string `json:"tags,omitempty"`
}

// ExternalManagedFileInfo describes an external template JSON file, vault file, or managed directory in Settings.
type ExternalManagedFileInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"` // "vault" | "json" | "directory"
	Description  string `json:"description"`
	FeatureLabel string `json:"featureLabel"`
	FilePath     string `json:"filePath"`
	DefaultName  string `json:"defaultName"`
	Exists       bool   `json:"exists"`
	ItemCount    int    `json:"itemCount"`
	SizeBytes    int64  `json:"sizeBytes"`
	LastModified string `json:"lastModified,omitempty"`
}

// ResolveManagedJSONFilePath resolves an external JSON file path given an optional override and default filename.
// If customPath is a directory or ends in a separator, it resolves to <dir>/<defaultFileName>.
func ResolveManagedJSONFilePath(customPath string, defaultFileName string) string {
	clean := strings.TrimSpace(customPath)
	if clean != "" {
		if fi, err := os.Stat(clean); err == nil && fi.IsDir() {
			return filepath.Join(clean, defaultFileName)
		}
		if strings.HasSuffix(clean, "/") || strings.HasSuffix(clean, string(filepath.Separator)) {
			return filepath.Join(clean, defaultFileName)
		}
		return filepath.Clean(clean)
	}

	localCandidate := filepath.Join("data", defaultFileName)
	if fi, err := os.Stat(localCandidate); err == nil && !fi.IsDir() {
		return localCandidate
	}
	rootCandidate := defaultFileName
	if fi, err := os.Stat(rootCandidate); err == nil && !fi.IsDir() {
		return rootCandidate
	}

	cfgDir, err := os.UserConfigDir()
	if err == nil && cfgDir != "" {
		return filepath.Join(cfgDir, "DoubleAgent", defaultFileName)
	}

	return filepath.Join(os.TempDir(), "doubleagent-"+defaultFileName)
}

func saveJSONFileAtomic(targetPath string, value any) error {
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("failed to create directory %q: %w", dir, err)
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize JSON templates: %w", err)
	}
	tmpFile := targetPath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0o600); err != nil {
		return fmt.Errorf("failed to write temporary file %q: %w", tmpFile, err)
	}
	if err := os.Rename(tmpFile, targetPath); err != nil {
		_ = os.Remove(tmpFile)
		return fmt.Errorf("failed to commit template file %q: %w", targetPath, err)
	}
	return nil
}

func loadJSONTemplateList[T any](filePath string, defaultFileName string, defaultsFn func() []T) ([]T, error) {
	target := ResolveManagedJSONFilePath(filePath, defaultFileName)
	raw, err := os.ReadFile(target)
	if err != nil {
		if os.IsNotExist(err) {
			defs := defaultsFn()
			if saveErr := saveJSONFileAtomic(target, defs); saveErr != nil {
				return nil, saveErr
			}
			return defs, nil
		}
		return nil, fmt.Errorf("failed to read %q: %w", target, err)
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return []T{}, nil
	}
	var parsed []T
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("failed to parse JSON templates from %q: %w", target, err)
	}
	return parsed, nil
}

// DefaultReportTemplates returns starter customer-facing penetration test report templates.
func DefaultReportTemplates() []ReportTemplate {
	return []ReportTemplate{
		{
			ID:             "tpl-rep-standard",
			Name:           "Standard Customer Pentest Report",
			Description:    "Balanced technical + executive structure for internal, external, or hybrid infrastructure engagements.",
			TitlePrefix:    "Penetration Test & Security Assessment Report",
			Author:         "Security Assessment Team",
			Classification: "CONFIDENTIAL — CLIENT DISTRIBUTION ONLY",
			ExecutiveSummaryIntro: "During the authorized engagement window, the assessment team evaluated the in-scope target systems to identify exploitable vulnerabilities, privilege escalation paths, and defense-in-depth gaps. The sections below summarize overall risk posture, prioritized findings, and verifiable supporting evidence captured during testing.",
			MethodologyText:       "Testing combined automated service enumeration, manual configuration review, credential and lateral-movement validation, and targeted proof-of-concept verification aligned with PTES and OWASP Testing Guide practices. All findings were manually verified before documentation.",
			ScopeNotes:            "Only authorized systems, IP ranges, and credentials explicitly approved for this engagement were tested. Out-of-scope production services and destructive denial-of-service vectors were excluded.",
			AttackPathTemplate:    "1. Initial Foothold & Service Enumeration: Identify exposed management interfaces, weak authentication, or misconfigured services.\n2. Credential Discovery & Privilege Escalation: Leverage discovered secrets, token privileges, or permissive sudo/service rules.\n3. Lateral Movement & Impact Validation: Demonstrate cross-host reachability and sensitive data exposure while maintaining strict audit logging.",
			LimitationsText:       "Findings reflect the point-in-time state observed during the engagement timeframe. Changes to firewall rules, patch levels, or credentials after the assessment window are outside this report's scope.",
			ConclusionText:        "Remediation should prioritize Critical and High findings first, focusing on eliminating hardcoded credentials, enforcing least privilege on administrative services, and segmenting internal management planes. Re-testing is recommended after fixes are deployed.",
			Tags:                  []string{"infrastructure", "standard", "customer"},
		},
		{
			ID:             "tpl-rep-ad",
			Name:           "Active Directory & Internal Network",
			Description:    "Tailored for internal Windows domain assessments covering Kerberos, NTLM/SMB signing, WinRM, and Tier-0 paths.",
			TitlePrefix:    "Internal Active Directory Security Assessment",
			Author:         "Red Team / AD Assessment Practice",
			Classification: "RESTRICTED — INTERNAL SECURITY & IT OPERATIONS",
			ExecutiveSummaryIntro: "This internal Active Directory security assessment measured resilience against realistic post-compromise attacker tradecraft from a standard domain-joined or non-domain foothold toward Tier-0 Domain Controller assets.",
			MethodologyText:       "Assessment activities covered network protocol poisoning posture, Active Directory Certificate Services (AD CS), Kerberos delegation/roasting vectors, WinRM/SMB administrative boundaries, and local privilege escalation across member servers.",
			ScopeNotes:            "Testing targeted internal subnets and domain controllers within the approved engagement CIDR blocks using controlled enumeration and lock-out-aware credential verification.",
			AttackPathTemplate:    "1. Domain Reconnaissance & Account Enumeration (Kerberos AS-REP / Kerberoasting).\n2. Host Compromise via Misconfigured Services / WinRM / Exposed Credentials.\n3. Delegation / ACL Abuse & Path to Domain Admin / Tier-0.",
			LimitationsText:       "Password spraying and brute-force checks were strictly bounded by the agreed account lockout threshold to prevent user disruption.",
			ConclusionText:        "Key strategic hardening steps include enforcing SMB signing and LDAP channel binding, tightening Tier-0 delegation and WinRM access, migrating service accounts to gMSAs, and auditing privilege group memberships.",
			Tags:                  []string{"active-directory", "windows", "internal"},
		},
		{
			ID:             "tpl-rep-webapp",
			Name:           "Web Application & API Penetration Test",
			Description:    "Focused narrative template for OWASP Top 10 / API Top 10 assessments and SSRF/auth findings.",
			TitlePrefix:    "Web Application & API Penetration Test Report",
			Author:         "Application Security Team",
			Classification: "CONFIDENTIAL — ENGINEERING & SECURITY",
			ExecutiveSummaryIntro: "The application security review evaluated authentication, session management, authorization boundaries, input validation, and backend API integrations across the target web platform.",
			MethodologyText:       "Methodology followed the OWASP Web Security Testing Guide (WSTG) and OWASP API Security Top 10, combining authenticated multi-role testing, server-side request validation, and business logic abuse verification.",
			ScopeNotes:            "Assessment covered the designated web origins, REST/GraphQL endpoints, and staging credentials provided for standard and privileged user roles.",
			AttackPathTemplate:    "1. Unauthenticated Endpoint & Parameter Discovery.\n2. Broken Access Control / Injection / SSRF Verification.\n3. Privilege Escalation to Administrative or Cloud Metadata Context.",
			LimitationsText:       "Automated high-volume fuzzing was rate-limited to avoid impacting shared application availability.",
			ConclusionText:        "Addressing server-side input validation, enforcing strict object-level authorization checks, hardening cloud metadata access (IMDSv2), and rotating exposed secrets will substantially reduce application risk.",
			Tags:                  []string{"webapp", "api", "owasp"},
		},
		{
			ID:             "tpl-rep-exec",
			Name:           "Executive Brief (Summary Focus)",
			Description:    "Concise leadership-oriented summary highlighting key business risks and top remediation priorities.",
			TitlePrefix:    "Executive Security Assessment Brief",
			Author:         "Lead Security Consultant",
			Classification: "CONFIDENTIAL — EXECUTIVE LEADERSHIP",
			ExecutiveSummaryIntro: "This brief provides leadership with an actionable summary of cyber risk exposures discovered during the assessment, translating technical vulnerabilities into concrete business impact and prioritized remediation milestones.",
			MethodologyText:       "Evidence-driven validation simulating real-world adversary objectives with zero unverified scanner noise.",
			ScopeNotes:            "Includes all verified findings from the approved engagement scope; supporting raw technical evidence is cataloged per-host below for engineering teams.",
			AttackPathTemplate:    "Critical exposure chains demonstrate how an external or low-privileged actor can escalate access to sensitive systems without early detection.",
			LimitationsText:       "Intended for executive decision-making; engineering remediation owners should reference the detailed host sections and SHA-256 evidence appendix.",
			ConclusionText:        "Allocating immediate engineering sprints to resolve Critical/High exposures and implementing centralized credential hygiene will deliver the highest measurable risk reduction.",
			Tags:                  []string{"executive", "summary", "leadership"},
		},
	}
}

// ResolveFindingTemplatesFilePath resolves the external finding templates JSON path.
func ResolveFindingTemplatesFilePath(customPath string) string {
	return ResolveManagedJSONFilePath(customPath, FindingTemplatesFileName)
}

// ResolveEvidenceTemplatesFilePath resolves the external evidence templates JSON path.
func ResolveEvidenceTemplatesFilePath(customPath string) string {
	return ResolveManagedJSONFilePath(customPath, EvidenceTemplatesFileName)
}

// ResolveReportTemplatesFilePath resolves the external report templates JSON path.
func ResolveReportTemplatesFilePath(customPath string) string {
	return ResolveManagedJSONFilePath(customPath, ReportTemplatesFileName)
}

// LoadFindingTemplates reads finding templates from JSON, initializing defaults if missing.
func LoadFindingTemplates(filePath string) ([]FindingItem, error) {
	return loadJSONTemplateList(filePath, FindingTemplatesFileName, DefaultFindingTemplates)
}

// SaveFindingTemplates saves finding templates atomically to JSON.
func SaveFindingTemplates(filePath string, items []FindingItem) error {
	target := ResolveFindingTemplatesFilePath(filePath)
	if items == nil {
		items = []FindingItem{}
	}
	return saveJSONFileAtomic(target, items)
}

// LoadEvidenceTemplates reads evidence templates from JSON, initializing defaults if missing.
func LoadEvidenceTemplates(filePath string) ([]EvidenceItem, error) {
	return loadJSONTemplateList(filePath, EvidenceTemplatesFileName, DefaultEvidenceTemplates)
}

// SaveEvidenceTemplates saves evidence templates atomically to JSON.
func SaveEvidenceTemplates(filePath string, items []EvidenceItem) error {
	target := ResolveEvidenceTemplatesFilePath(filePath)
	if items == nil {
		items = []EvidenceItem{}
	}
	return saveJSONFileAtomic(target, items)
}

// LoadReportTemplates reads report templates from JSON, initializing defaults if missing.
func LoadReportTemplates(filePath string) ([]ReportTemplate, error) {
	return loadJSONTemplateList(filePath, ReportTemplatesFileName, DefaultReportTemplates)
}

// SaveReportTemplates saves report templates atomically to JSON.
func SaveReportTemplates(filePath string, items []ReportTemplate) error {
	target := ResolveReportTemplatesFilePath(filePath)
	if items == nil {
		items = []ReportTemplate{}
	}
	return saveJSONFileAtomic(target, items)
}

// StatJSONTemplateFile builds ExternalManagedFileInfo metadata without auto-creating missing files if peekOnly is true,
// or counting items when the file exists.
func StatJSONTemplateFile(id, name, desc, featureLabel, resolvedPath, defaultName string, countItemsFn func(string) int) ExternalManagedFileInfo {
	info := ExternalManagedFileInfo{
		ID:           id,
		Name:         name,
		Kind:         "json",
		Description:  desc,
		FeatureLabel: featureLabel,
		FilePath:     resolvedPath,
		DefaultName:  defaultName,
	}
	if fi, err := os.Stat(resolvedPath); err == nil && !fi.IsDir() {
		info.Exists = true
		info.SizeBytes = fi.Size()
		info.LastModified = fi.ModTime().UTC().Format(time.RFC3339)
		if countItemsFn != nil {
			info.ItemCount = countItemsFn(resolvedPath)
		}
	}
	return info
}
