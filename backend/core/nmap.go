package core

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"
)

// NmapScanKind categorizes the imported Nmap scan.
type NmapScanKind string

const (
	NmapScanKindAliveCheck NmapScanKind = "alive_check" // -sn, -sP, ping/ARP host discovery
	NmapScanKindPortScan   NmapScanKind = "port_scan"   // -sS, -sT, -p, -sV, etc.
	NmapScanKindMixed      NmapScanKind = "mixed"       // Combined discovery & port scan
)

// XML structures matching Nmap -oX output schema
type NmapRunXML struct {
	XMLName      xml.Name      `xml:"nmaprun"`
	Scanner      string        `xml:"scanner,attr"`
	Args         string        `xml:"args,attr"`
	Start        string        `xml:"start,attr"`
	StartStr     string        `xml:"startstr,attr"`
	Version      string        `xml:"version,attr"`
	ScanInfo     []ScanInfoXML `xml:"scaninfo"`
	Hosts        []NmapHostXML `xml:"host"`
	RunStats     RunStatsXML   `xml:"runstats"`
}

type ScanInfoXML struct {
	Type        string `xml:"type,attr"`
	Protocol    string `xml:"protocol,attr"`
	NumServices int    `xml:"numservices,attr"`
	Services    string `xml:"services,attr"`
}

type NmapHostXML struct {
	StartTime string            `xml:"starttime,attr"`
	EndTime   string            `xml:"endtime,attr"`
	Status    NmapStatusXML     `xml:"status"`
	Addresses []NmapAddrXML     `xml:"address"`
	Hostnames []NmapHNXML       `xml:"hostnames>hostname"`
	Ports     NmapPortsXML      `xml:"ports"`
	OS        NmapOSXML         `xml:"os"`
}

type NmapStatusXML struct {
	State     string `xml:"state,attr"` // "up", "down"
	Reason    string `xml:"reason,attr"` // e.g. "syn-ack", "arp-response", "echo-reply", "conn-refused"
	ReasonTTL string `xml:"reason_ttl,attr"`
}

type NmapAddrXML struct {
	Addr     string `xml:"addr,attr"`
	AddrType string `xml:"addrtype,attr"` // "ipv4", "ipv6", "mac"
	Vendor   string `xml:"vendor,attr"`
}

type NmapHNXML struct {
	Name string `xml:"name,attr"`
	Type string `xml:"type,attr"` // "PTR", "user"
}

type NmapPortsXML struct {
	ExtraPorts []NmapExtraPortsXML `xml:"extraports"`
	Ports      []NmapPortXML       `xml:"port"`
}

type NmapExtraPortsXML struct {
	State string `xml:"state,attr"`
	Count int    `xml:"count,attr"`
}

type NmapPortXML struct {
	Protocol string          `xml:"protocol,attr"` // "tcp", "udp"
	PortID   uint16          `xml:"portid,attr"`
	State    NmapPStateXML   `xml:"state"`
	Service  NmapServiceXML  `xml:"service"`
	Scripts  []NmapScriptXML `xml:"script"`
}

type NmapPStateXML struct {
	State     string `xml:"state,attr"` // "open", "filtered", "closed", "open|filtered"
	Reason    string `xml:"reason,attr"`
	ReasonTTL string `xml:"reason_ttl,attr"`
}

type NmapServiceXML struct {
	Name      string   `xml:"name,attr"`
	Product   string   `xml:"product,attr"`
	Version   string   `xml:"version,attr"`
	ExtraInfo string   `xml:"extrainfo,attr"`
	OSType    string   `xml:"ostype,attr"`
	Method    string   `xml:"method,attr"`
	Conf      string   `xml:"conf,attr"`
	CPEs      []string `xml:"cpe"`
}

type NmapScriptXML struct {
	ID     string `xml:"id,attr"`
	Output string `xml:"output,attr"`
}

type NmapOSXML struct {
	Matches []NmapOSMatchXML `xml:"osmatch"`
}

type NmapOSMatchXML struct {
	Name     string `xml:"name,attr"`
	Accuracy string `xml:"accuracy,attr"`
}

type RunStatsXML struct {
	Finished struct {
		Time    string `xml:"time,attr"`
		TimeStr string `xml:"timestr,attr"`
		Summary string `xml:"summary,attr"`
		Elapsed string `xml:"elapsed,attr"`
	} `xml:"finished"`
	Hosts struct {
		Up    int `xml:"up,attr"`
		Down  int `xml:"down,attr"`
		Total int `xml:"total,attr"`
	} `xml:"hosts"`
}

// ParsedNmapPort represents an individual open or filtered port.
type ParsedNmapPort struct {
	Port      uint16            `json:"port"`
	Protocol  string            `json:"protocol"` // "tcp", "udp"
	State     string            `json:"state"`    // "open", "filtered", "closed"
	Reason    string            `json:"reason"`
	Service   string            `json:"service"`
	Product   string            `json:"product"`
	Version   string            `json:"version"`
	ExtraInfo string            `json:"extraInfo"`
	OSType    string            `json:"osType"`
	CPEs      []string          `json:"cpes"`
	Scripts   map[string]string `json:"scripts"` // Script ID -> Output
}

// ParsedNmapHost represents a discovered target host and its scan telemetry.
type ParsedNmapHost struct {
	IPv4          string           `json:"ipv4"`
	IPv6          string           `json:"ipv6"`
	MAC           string           `json:"mac"`
	MACVendor     string           `json:"macVendor"`
	Hostnames     []string         `json:"hostnames"`
	PrimaryName   string           `json:"primaryName"` // Primary display label (Hostname or IP)
	State         string           `json:"state"`       // "up" or "down"
	Reason        string           `json:"reason"`      // "arp-response", "syn-ack", "echo-reply", etc.
	OSName        string           `json:"osName"`
	OSAccuracy    string           `json:"osAccuracy"`
	OpenPorts     []ParsedNmapPort `json:"openPorts"`
	FilteredPorts []ParsedNmapPort `json:"filteredPorts"`
	ClosedCount   int              `json:"closedCount"`
	FilteredCount int              `json:"filteredCount"`
	IsAliveOnly   bool             `json:"isAliveOnly"`
}

// NmapScanResult holds the complete normalized scan results for UI preview and import.
type NmapScanResult struct {
	Scanner        string           `json:"scanner"`
	Args           string           `json:"args"`
	Version        string           `json:"version"`
	StartStr       string           `json:"startStr"`
	Summary        string           `json:"summary"`
	ElapsedSecs    string           `json:"elapsedSecs"`
	ScanKind       NmapScanKind     `json:"scanKind"` // "alive_check", "port_scan", "mixed"
	TotalHosts     int              `json:"totalHosts"`
	UpHostsCount   int              `json:"upHostsCount"`
	DownHostsCount int              `json:"downHostsCount"`
	TotalOpenPorts int              `json:"totalOpenPorts"`
	Hosts          []ParsedNmapHost `json:"hosts"`
}

// NmapImportOptions configures how parsed scan results are integrated into the vault (F-39).
type NmapImportOptions struct {
	EngagementID       string `json:"engagementId,omitempty"`
	GroupID            string `json:"groupId,omitempty"`
	CreateHostRecords  bool   `json:"createHostRecords"`  // Create/update HostRecords in vault
	CreatePortNotes    bool   `json:"createPortNotes"`    // Creates note subpages per port (F-39)
	CreateSummaryNotes bool   `json:"createSummaryNotes"` // Creates overall Nmap Scan note on host
	CreatePortFindings bool   `json:"createPortFindings"` // Creates PortFinding records
	OnlyUpHosts        bool   `json:"onlyUpHosts"`        // Skip hosts that are 'down'
	TagPrefix          string `json:"tagPrefix,omitempty"`
}

// NmapImportRequest wraps the parsed data or raw XML with options for the backend.
type NmapImportRequest struct {
	XMLContent string            `json:"xmlContent"`
	Options    NmapImportOptions `json:"options"`
}

// NmapImportSummary reports the outcome of the import operation.
type NmapImportSummary struct {
	CreatedHosts        int      `json:"createdHosts"`
	UpdatedHosts        int      `json:"updatedHosts"`
	CreatedNotes        int      `json:"createdNotes"`
	CreatedPortNotes    int      `json:"createdPortNotes"`
	CreatedPortFindings int      `json:"createdPortFindings"`
	HostIDs             []string `json:"hostIds"`
	ScanKind            string   `json:"scanKind"`
	Message             string   `json:"message"`
}

// ParseNmapXML parses and normalizes Nmap XML (-oX) data into structured scan results (F-39).
func ParseNmapXML(data []byte) (*NmapScanResult, error) {
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, fmt.Errorf("nmap XML content is empty")
	}

	var run NmapRunXML
	if err := xml.Unmarshal(data, &run); err != nil {
		return nil, fmt.Errorf("failed to parse Nmap XML: %w", err)
	}

	result := &NmapScanResult{
		Scanner:     run.Scanner,
		Args:        run.Args,
		Version:     run.Version,
		StartStr:    run.StartStr,
		Summary:     run.RunStats.Finished.Summary,
		ElapsedSecs: run.RunStats.Finished.Elapsed,
		Hosts:       make([]ParsedNmapHost, 0, len(run.Hosts)),
	}
	if result.Scanner == "" {
		result.Scanner = "nmap"
	}

	// Classify scan kind based on command line arguments and probed port characteristics
	isSnArg := strings.Contains(run.Args, "-sn") || strings.Contains(run.Args, "-sP")
	hostsWithOpenPorts := 0
	aliveOnlyHosts := 0

	for _, hXML := range run.Hosts {
		h := ParsedNmapHost{
			State:         hXML.Status.State,
			Reason:        hXML.Status.Reason,
			Hostnames:     make([]string, 0, len(hXML.Hostnames)),
			OpenPorts:     make([]ParsedNmapPort, 0),
			FilteredPorts: make([]ParsedNmapPort, 0),
		}

		for _, addr := range hXML.Addresses {
			switch strings.ToLower(addr.AddrType) {
			case "ipv4":
				h.IPv4 = addr.Addr
			case "ipv6":
				h.IPv6 = addr.Addr
			case "mac":
				h.MAC = addr.Addr
				h.MACVendor = addr.Vendor
			}
		}

		for _, hn := range hXML.Hostnames {
			trimmed := strings.TrimSpace(hn.Name)
			if trimmed != "" {
				h.Hostnames = append(h.Hostnames, trimmed)
			}
		}

		// Pick primary display name: first hostname or IPv4 or IPv6
		if len(h.Hostnames) > 0 {
			h.PrimaryName = h.Hostnames[0]
		} else if h.IPv4 != "" {
			h.PrimaryName = h.IPv4
		} else if h.IPv6 != "" {
			h.PrimaryName = h.IPv6
		} else {
			h.PrimaryName = "Discovered Host"
		}

		// Top OS match
		if len(hXML.OS.Matches) > 0 {
			h.OSName = hXML.OS.Matches[0].Name
			h.OSAccuracy = hXML.OS.Matches[0].Accuracy
		}

		// Count extraports (closed/filtered)
		for _, ep := range hXML.Ports.ExtraPorts {
			switch strings.ToLower(ep.State) {
			case "closed":
				h.ClosedCount += ep.Count
			case "filtered":
				h.FilteredCount += ep.Count
			}
		}

		// Process individual port records
		for _, pXML := range hXML.Ports.Ports {
			state := strings.ToLower(pXML.State.State)
			scripts := make(map[string]string)
			for _, s := range pXML.Scripts {
				if s.ID != "" && s.Output != "" {
					scripts[s.ID] = s.Output
				}
			}

			parsedPort := ParsedNmapPort{
				Port:      pXML.PortID,
				Protocol:  strings.ToLower(pXML.Protocol),
				State:     state,
				Reason:    pXML.State.Reason,
				Service:   pXML.Service.Name,
				Product:   pXML.Service.Product,
				Version:   pXML.Service.Version,
				ExtraInfo: pXML.Service.ExtraInfo,
				OSType:    pXML.Service.OSType,
				CPEs:      pXML.Service.CPEs,
				Scripts:   scripts,
			}

			if state == "open" {
				h.OpenPorts = append(h.OpenPorts, parsedPort)
			} else if strings.Contains(state, "filtered") {
				h.FilteredPorts = append(h.FilteredPorts, parsedPort)
			}
		}

		if len(h.OpenPorts) > 0 {
			hostsWithOpenPorts++
			h.IsAliveOnly = false
		} else {
			aliveOnlyHosts++
			h.IsAliveOnly = true
		}

		if h.State == "up" {
			result.UpHostsCount++
		} else {
			result.DownHostsCount++
		}
		result.TotalOpenPorts += len(h.OpenPorts)
		result.Hosts = append(result.Hosts, h)
	}

	result.TotalHosts = len(result.Hosts)

	// Determine overall ScanKind
	if isSnArg || (hostsWithOpenPorts == 0 && aliveOnlyHosts > 0) {
		result.ScanKind = NmapScanKindAliveCheck
	} else if aliveOnlyHosts == 0 && hostsWithOpenPorts > 0 {
		result.ScanKind = NmapScanKindPortScan
	} else {
		result.ScanKind = NmapScanKindMixed
	}

	return result, nil
}

// detectOsTag helper maps detected OS string to standard tags.
func detectOsTag(osName string) string {
	low := strings.ToLower(osName)
	if strings.Contains(low, "windows") {
		return "windows"
	}
	if strings.Contains(low, "linux") || strings.Contains(low, "ubuntu") || strings.Contains(low, "debian") || strings.Contains(low, "centos") || strings.Contains(low, "red hat") {
		return "linux"
	}
	if strings.Contains(low, "bsd") {
		return "bsd"
	}
	if strings.Contains(low, "cisco") {
		return "cisco"
	}
	return ""
}

// ImportNmapScan applies parsed Nmap scan results into the VaultPayload (F-39).
func ImportNmapScan(payload *VaultPayload, result *NmapScanResult, opts NmapImportOptions) (*NmapImportSummary, error) {
	if payload == nil {
		return nil, fmt.Errorf("vault payload is nil")
	}
	if result == nil {
		return nil, fmt.Errorf("nmap scan result is nil")
	}

	summary := &NmapImportSummary{
		HostIDs:  make([]string, 0),
		ScanKind: string(result.ScanKind),
	}

	tagPrefix := opts.TagPrefix
	if tagPrefix == "" {
		tagPrefix = "nmap"
	}

	for _, host := range result.Hosts {
		if opts.OnlyUpHosts && host.State != "up" {
			continue
		}

		targetAddr := host.IPv4
		if targetAddr == "" {
			targetAddr = host.IPv6
		}
		if targetAddr == "" && len(host.Hostnames) > 0 {
			targetAddr = host.Hostnames[0]
		}
		if targetAddr == "" {
			continue
		}

		// Find existing host in vault by IP or Label
		var targetHost *HostRecord
		for i := range payload.Hosts {
			h := &payload.Hosts[i]
			if (targetAddr != "" && h.Address == targetAddr) || (host.PrimaryName != "" && h.Label == host.PrimaryName) {
				targetHost = h
				break
			}
		}

		var hostID string
		if targetHost != nil {
			// Update existing host
			hostID = targetHost.ID
			summary.UpdatedHosts++
			// Add nmap tag if missing
			hasTag := false
			for _, t := range targetHost.Tags {
				if t == tagPrefix || t == "nmap-imported" {
					hasTag = true
					break
				}
			}
			if !hasTag {
				targetHost.Tags = append(targetHost.Tags, "nmap-imported")
			}
			if osTag := detectOsTag(host.OSName); osTag != "" {
				hasOs := false
				for _, t := range targetHost.Tags {
					if t == osTag {
						hasOs = true
						break
					}
				}
				if !hasOs {
					targetHost.Tags = append(targetHost.Tags, osTag)
				}
			}
			if opts.EngagementID != "" && targetHost.EngagementID == "" {
				targetHost.EngagementID = opts.EngagementID
			}
		} else if opts.CreateHostRecords {
			// Create new host record
			hostID = fmt.Sprintf("host-nmap-%d-%d", time.Now().UnixNano()%1000000, len(payload.Hosts)+1)
			primaryPort := uint16(22)
			has22 := false
			for _, p := range host.OpenPorts {
				if p.Port == 22 && p.Protocol == "tcp" {
					has22 = true
					break
				}
			}
			if !has22 && len(host.OpenPorts) > 0 {
				primaryPort = host.OpenPorts[0].Port
			}

			tags := []string{"nmap-imported"}
			if osTag := detectOsTag(host.OSName); osTag != "" {
				tags = append(tags, osTag)
			}
			if host.IsAliveOnly {
				tags = append(tags, "alive-check")
			}

			newHost := HostRecord{
				ID:           hostID,
				Label:        host.PrimaryName,
				Address:      targetAddr,
				Port:         primaryPort,
				GroupID:      opts.GroupID,
				EngagementID: opts.EngagementID,
				Tags:         tags,
			}
			payload.Hosts = append(payload.Hosts, newHost)
			summary.CreatedHosts++
		}

		if hostID == "" {
			continue
		}
		summary.HostIDs = append(summary.HostIDs, hostID)

		// Create Port Findings if enabled
		if opts.CreatePortFindings && len(host.OpenPorts) > 0 {
			for _, p := range host.OpenPorts {
				// Check for duplicate port finding
				exists := false
				for _, pf := range payload.PortFindings {
					if pf.HostID == hostID && pf.Port == p.Port && pf.Protocol == p.Protocol {
						exists = true
						break
					}
				}
				if !exists {
					scriptResults := make([]ScriptResult, 0, len(p.Scripts))
					for sID, sOut := range p.Scripts {
						scriptResults = append(scriptResults, ScriptResult{
							ID:     sID,
							Output: sOut,
						})
					}

					pf := PortFinding{
						ID:            fmt.Sprintf("pf-%s-%d-%s", hostID, p.Port, p.Protocol),
						HostID:        hostID,
						EngagementID:  opts.EngagementID,
						Port:          p.Port,
						Protocol:      p.Protocol,
						Service:       p.Service,
						Product:       p.Product,
						Version:       p.Version,
						State:         p.State,
						ScriptResults: scriptResults,
						Source:        "nmap",
						CreatedAt:     time.Now(),
					}
					payload.PortFindings = append(payload.PortFindings, pf)
					summary.CreatedPortFindings++
				}
			}
		}

		// Create Notes (Summary Note + Child Port Subpages per F-39)
		var summaryNoteID string
		if opts.CreateSummaryNotes {
			summaryNoteID = fmt.Sprintf("note-nmap-summary-%s-%d", hostID, time.Now().UnixNano()%1000000)
			now := time.Now()

			var title string
			var body strings.Builder

			if host.IsAliveOnly {
				title = fmt.Sprintf("Nmap Alive Check: %s", host.PrimaryName)
				body.WriteString(fmt.Sprintf("# Host Discovery / Alive Check: %s\n\n", host.PrimaryName))
				body.WriteString(fmt.Sprintf("- **Status:** UP (Reason: `%s`)\n", host.Reason))
				body.WriteString(fmt.Sprintf("- **IP Address:** `%s`\n", targetAddr))
				if len(host.Hostnames) > 0 {
					body.WriteString(fmt.Sprintf("- **Hostnames:** %s\n", strings.Join(host.Hostnames, ", ")))
				}
				if host.MAC != "" {
					body.WriteString(fmt.Sprintf("- **MAC Address:** `%s`", host.MAC))
					if host.MACVendor != "" {
						body.WriteString(fmt.Sprintf(" (%s)", host.MACVendor))
					}
					body.WriteString("\n")
				}
				if host.OSName != "" {
					body.WriteString(fmt.Sprintf("- **OS Match:** %s (%s%% accuracy)\n", host.OSName, host.OSAccuracy))
				}
				body.WriteString(fmt.Sprintf("- **Scanner Args:** `%s`\n", result.Args))
				body.WriteString(fmt.Sprintf("- **Timestamp:** %s\n", now.Format("2006-01-02 15:04:05")))
			} else {
				title = fmt.Sprintf("Nmap Scan: %s (%d open ports)", host.PrimaryName, len(host.OpenPorts))
				body.WriteString(fmt.Sprintf("# Nmap Port Scan Report: %s\n\n", host.PrimaryName))
				body.WriteString(fmt.Sprintf("- **Target:** `%s`\n", targetAddr))
				if len(host.Hostnames) > 0 {
					body.WriteString(fmt.Sprintf("- **Hostnames:** %s\n", strings.Join(host.Hostnames, ", ")))
				}
				body.WriteString(fmt.Sprintf("- **Host State:** UP (Reason: `%s`)\n", host.Reason))
				if host.OSName != "" {
					body.WriteString(fmt.Sprintf("- **OS Detection:** %s (%s%% accuracy)\n", host.OSName, host.OSAccuracy))
				}
				body.WriteString(fmt.Sprintf("- **Scanner Args:** `%s`\n\n", result.Args))

				body.WriteString("## Open Ports & Services\n\n")
				body.WriteString("| Port | Protocol | State | Service | Product / Version |\n")
				body.WriteString("| :--- | :--- | :--- | :--- | :--- |\n")
				for _, p := range host.OpenPorts {
					ver := p.Product
					if p.Version != "" {
						if ver != "" {
							ver += " " + p.Version
						} else {
							ver = p.Version
						}
					}
					if p.ExtraInfo != "" {
						ver += " " + p.ExtraInfo
					}
					if ver == "" {
						ver = "-"
					}
					body.WriteString(fmt.Sprintf("| `%d` | %s | **%s** | `%s` | %s |\n", p.Port, strings.ToUpper(p.Protocol), p.State, p.Service, ver))
				}
			}

			summaryNote := NotePage{
				ID:           summaryNoteID,
				HostID:       hostID,
				EngagementID: opts.EngagementID,
				IsFolder:     opts.CreatePortNotes && len(host.OpenPorts) > 0,
				Title:        title,
				Type:         "markdown",
				Body:         body.String(),
				Order:        1,
				CreatedAt:    now,
				UpdatedAt:    now,
			}
			payload.Notes = append(payload.Notes, summaryNote)
			summary.CreatedNotes++
		}

		// Create Port Subpages per F-39
		if opts.CreatePortNotes && len(host.OpenPorts) > 0 {
			now := time.Now()
			for idx, p := range host.OpenPorts {
				var portBody strings.Builder
				portTitle := fmt.Sprintf("Port %d/%s (%s)", p.Port, p.Protocol, p.Service)
				if p.Product != "" {
					portTitle = fmt.Sprintf("Port %d/%s (%s - %s)", p.Port, p.Protocol, p.Service, p.Product)
				}

				portBody.WriteString(fmt.Sprintf("# Port %d/%s — %s\n\n", p.Port, strings.ToUpper(p.Protocol), p.Service))
				portBody.WriteString(fmt.Sprintf("- **State:** `%s` (Reason: `%s`)\n", p.State, p.Reason))
				portBody.WriteString(fmt.Sprintf("- **Service:** `%s`\n", p.Service))
				if p.Product != "" {
					portBody.WriteString(fmt.Sprintf("- **Product:** `%s`\n", p.Product))
				}
				if p.Version != "" {
					portBody.WriteString(fmt.Sprintf("- **Version:** `%s`\n", p.Version))
				}
				if p.ExtraInfo != "" {
					portBody.WriteString(fmt.Sprintf("- **Extra Info:** `%s`\n", p.ExtraInfo))
				}
				if p.OSType != "" {
					portBody.WriteString(fmt.Sprintf("- **OS Type:** `%s`\n", p.OSType))
				}
				if len(p.CPEs) > 0 {
					portBody.WriteString("\n### CPE Identifiers\n")
					for _, cpe := range p.CPEs {
						portBody.WriteString(fmt.Sprintf("- `%s`\n", cpe))
					}
				}

				if len(p.Scripts) > 0 {
					portBody.WriteString("\n## NSE Script Results\n")
					for sID, sOut := range p.Scripts {
						portBody.WriteString(fmt.Sprintf("\n### Script: `%s`\n```\n%s\n```\n", sID, strings.TrimSpace(sOut)))
					}
				}

				portNote := NotePage{
					ID:           fmt.Sprintf("note-nmap-port-%s-%d-%s", hostID, p.Port, p.Protocol),
					HostID:       hostID,
					EngagementID: opts.EngagementID,
					ParentID:     summaryNoteID,
					IsFolder:     false,
					Title:        portTitle,
					Type:         "markdown",
					Body:         portBody.String(),
					Order:        idx + 2,
					CreatedAt:    now,
					UpdatedAt:    now,
				}
				payload.Notes = append(payload.Notes, portNote)
				summary.CreatedPortNotes++
				summary.CreatedNotes++
			}
		}
	}

	summary.Message = fmt.Sprintf(
		"Nmap import completed successfully: %d created hosts, %d updated hosts, %d total notes (%d port subpages), %d port findings.",
		summary.CreatedHosts, summary.UpdatedHosts, summary.CreatedNotes, summary.CreatedPortNotes, summary.CreatedPortFindings,
	)
	return summary, nil
}
