package core_test

import (
	"strings"
	"testing"

	"doubleagent/backend/core"
)

const sampleAliveCheckXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nmaprun>
<nmaprun scanner="nmap" args="nmap -sn 192.168.1.0/24" start="1699990000" startstr="Mon Nov 13 10:00:00 2026" version="7.94">
  <host starttime="1699990000" endtime="1699990001">
    <status state="up" reason="arp-response" reason_ttl="0"/>
    <address addr="192.168.1.1" addrtype="ipv4"/>
    <address addr="00:50:56:C0:00:01" addrtype="mac" vendor="VMware"/>
    <hostnames>
      <hostname name="gateway.corp.local" type="PTR"/>
    </hostnames>
  </host>
  <host starttime="1699990000" endtime="1699990001">
    <status state="up" reason="echo-reply" reason_ttl="64"/>
    <address addr="192.168.1.50" addrtype="ipv4"/>
    <hostnames/>
  </host>
  <host starttime="1699990000" endtime="1699990001">
    <status state="down" reason="no-response" reason_ttl="0"/>
    <address addr="192.168.1.99" addrtype="ipv4"/>
  </host>
  <runstats>
    <finished time="1699990005" timestr="Mon Nov 13 10:00:05 2026" summary="Nmap done: 256 IP addresses (2 hosts up) scanned in 5.00 seconds" elapsed="5.00"/>
    <hosts up="2" down="1" total="3"/>
  </runstats>
</nmaprun>`

const samplePortScanXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nmaprun>
<nmaprun scanner="nmap" args="nmap -sV -sC -oX scan.xml 10.10.10.5" start="1699991000" startstr="Mon Nov 13 10:15:00 2026" version="7.94">
  <host starttime="1699991000" endtime="1699991010">
    <status state="up" reason="syn-ack" reason_ttl="64"/>
    <address addr="10.10.10.5" addrtype="ipv4"/>
    <hostnames>
      <hostname name="ares.target.htb" type="PTR"/>
    </hostnames>
    <ports>
      <extraports state="closed" count="998"/>
      <port protocol="tcp" portid="22">
        <state state="open" reason="syn-ack"/>
        <service name="ssh" product="OpenSSH" version="8.2p1 Ubuntu" extrainfo="Ubuntu Linux; protocol 2.0" ostype="Linux">
          <cpe>cpe:/a:openbsd:openssh:8.2p1</cpe>
        </service>
        <script id="ssh-hostkey" output="2048 SHA256:abc123... (RSA)"/>
      </port>
      <port protocol="tcp" portid="80">
        <state state="open" reason="syn-ack"/>
        <service name="http" product="Apache httpd" version="2.4.41" extrainfo="(Ubuntu)">
          <cpe>cpe:/a:apache:httpd:2.4.41</cpe>
        </service>
        <script id="http-title" output="Apache2 Ubuntu Default Page: It works"/>
        <script id="http-server-header" output="Apache/2.4.41 (Ubuntu)"/>
      </port>
    </ports>
    <os>
      <osmatch name="Linux 5.4" accuracy="100"/>
    </os>
  </host>
  <runstats>
    <finished time="1699991010" timestr="Mon Nov 13 10:15:10 2026" summary="Nmap done: 1 IP address (1 host up) scanned in 10.00 seconds" elapsed="10.00"/>
    <hosts up="1" down="0" total="1"/>
  </runstats>
</nmaprun>`

func TestNmap_ParseAliveCheck_F39(t *testing.T) {
	result, err := core.ParseNmapXML([]byte(sampleAliveCheckXML))
	if err != nil {
		t.Fatalf("ParseNmapXML failed on alive check: %v", err)
	}

	if result.ScanKind != core.NmapScanKindAliveCheck {
		t.Fatalf("expected ScanKind alive_check, got %s", result.ScanKind)
	}

	if result.TotalHosts != 3 {
		t.Fatalf("expected 3 total hosts, got %d", result.TotalHosts)
	}
	if result.UpHostsCount != 2 {
		t.Fatalf("expected 2 up hosts, got %d", result.UpHostsCount)
	}
	if result.DownHostsCount != 1 {
		t.Fatalf("expected 1 down host, got %d", result.DownHostsCount)
	}

	// Host 1: Gateway
	h1 := result.Hosts[0]
	if h1.IPv4 != "192.168.1.1" {
		t.Errorf("expected IPv4 192.168.1.1, got %s", h1.IPv4)
	}
	if h1.PrimaryName != "gateway.corp.local" {
		t.Errorf("expected primary name gateway.corp.local, got %s", h1.PrimaryName)
	}
	if h1.Reason != "arp-response" {
		t.Errorf("expected reason arp-response, got %s", h1.Reason)
	}
	if h1.MACVendor != "VMware" {
		t.Errorf("expected vendor VMware, got %s", h1.MACVendor)
	}
	if !h1.IsAliveOnly {
		t.Errorf("expected IsAliveOnly true for ping sweep host")
	}

	// Host 2: IP only
	h2 := result.Hosts[1]
	if h2.IPv4 != "192.168.1.50" {
		t.Errorf("expected IPv4 192.168.1.50, got %s", h2.IPv4)
	}
	if h2.PrimaryName != "192.168.1.50" {
		t.Errorf("expected primary name 192.168.1.50, got %s", h2.PrimaryName)
	}
	if h2.Reason != "echo-reply" {
		t.Errorf("expected reason echo-reply, got %s", h2.Reason)
	}
}

func TestNmap_ParsePortScan_F39(t *testing.T) {
	result, err := core.ParseNmapXML([]byte(samplePortScanXML))
	if err != nil {
		t.Fatalf("ParseNmapXML failed on port scan: %v", err)
	}

	if result.ScanKind != core.NmapScanKindPortScan {
		t.Fatalf("expected ScanKind port_scan, got %s", result.ScanKind)
	}

	if result.UpHostsCount != 1 {
		t.Fatalf("expected 1 up host, got %d", result.UpHostsCount)
	}
	if result.TotalOpenPorts != 2 {
		t.Fatalf("expected 2 open ports, got %d", result.TotalOpenPorts)
	}

	h := result.Hosts[0]
	if h.PrimaryName != "ares.target.htb" {
		t.Errorf("expected primary name ares.target.htb, got %s", h.PrimaryName)
	}
	if h.OSName != "Linux 5.4" {
		t.Errorf("expected OS Linux 5.4, got %s", h.OSName)
	}
	if h.IsAliveOnly {
		t.Errorf("expected IsAliveOnly false for port scan host")
	}

	if len(h.OpenPorts) != 2 {
		t.Fatalf("expected 2 open ports, got %d", len(h.OpenPorts))
	}

	// Check SSH port
	ssh := h.OpenPorts[0]
	if ssh.Port != 22 || ssh.Service != "ssh" || ssh.Product != "OpenSSH" {
		t.Errorf("unexpected ssh port values: %+v", ssh)
	}
	if ssh.Scripts["ssh-hostkey"] == "" {
		t.Errorf("expected ssh-hostkey script output")
	}

	// Check HTTP port
	http := h.OpenPorts[1]
	if http.Port != 80 || http.Service != "http" || http.Product != "Apache httpd" {
		t.Errorf("unexpected http port values: %+v", http)
	}
	if !strings.Contains(http.Scripts["http-title"], "Apache2 Ubuntu Default Page") {
		t.Errorf("expected http-title in script output, got: %s", http.Scripts["http-title"])
	}
}

func TestNmap_ImportScan_F39(t *testing.T) {
	parsedScan, err := core.ParseNmapXML([]byte(samplePortScanXML))
	if err != nil {
		t.Fatalf("ParseNmapXML failed: %v", err)
	}

	payload := &core.VaultPayload{
		Hosts:        make([]core.HostRecord, 0),
		Notes:        make([]core.NotePage, 0),
		PortFindings: make([]core.PortFinding, 0),
	}

	opts := core.NmapImportOptions{
		EngagementID:       "eng-test-01",
		CreateHostRecords:  true,
		CreatePortNotes:    true,
		CreateSummaryNotes: true,
		CreatePortFindings: true,
		OnlyUpHosts:        true,
	}

	summary, err := core.ImportNmapScan(payload, parsedScan, opts)
	if err != nil {
		t.Fatalf("ImportNmapScan failed: %v", err)
	}

	if summary.CreatedHosts != 1 {
		t.Errorf("expected 1 created host, got %d", summary.CreatedHosts)
	}
	if summary.CreatedPortFindings != 2 {
		t.Errorf("expected 2 created port findings, got %d", summary.CreatedPortFindings)
	}
	// 1 Summary Note + 2 Port Subpage Notes = 3 Notes total
	if summary.CreatedNotes != 3 {
		t.Errorf("expected 3 total notes (1 summary + 2 ports), got %d", summary.CreatedNotes)
	}
	if summary.CreatedPortNotes != 2 {
		t.Errorf("expected 2 port subpages, got %d", summary.CreatedPortNotes)
	}

	// Verify Host Record
	if len(payload.Hosts) != 1 {
		t.Fatalf("expected 1 host in payload, got %d", len(payload.Hosts))
	}
	host := payload.Hosts[0]
	if host.Address != "10.10.10.5" {
		t.Errorf("expected host address 10.10.10.5, got %s", host.Address)
	}
	if host.Label != "ares.target.htb" {
		t.Errorf("expected host label ares.target.htb, got %s", host.Label)
	}
	if host.Port != 22 {
		t.Errorf("expected host primary port 22, got %d", host.Port)
	}
	if host.EngagementID != "eng-test-01" {
		t.Errorf("expected engagement ID eng-test-01, got %s", host.EngagementID)
	}

	// Verify Notes Hierarchy
	summaryNote := payload.Notes[0]
	if !summaryNote.IsFolder {
		t.Errorf("expected summary note to be a folder container for port subpages")
	}
	if !strings.Contains(summaryNote.Body, "Apache httpd") {
		t.Errorf("expected summary note to list open ports in table")
	}

	port22Note := payload.Notes[1]
	if port22Note.ParentID != summaryNote.ID {
		t.Errorf("expected port 22 note ParentID to match summary note %s, got %s", summaryNote.ID, port22Note.ParentID)
	}
	if !strings.Contains(port22Note.Body, "ssh-hostkey") {
		t.Errorf("expected port 22 note to contain NSE script output")
	}

	port80Note := payload.Notes[2]
	if port80Note.ParentID != summaryNote.ID {
		t.Errorf("expected port 80 note ParentID to match summary note %s, got %s", summaryNote.ID, port80Note.ParentID)
	}
	if !strings.Contains(port80Note.Body, "Apache2 Ubuntu Default Page") {
		t.Errorf("expected port 80 note to contain http-title NSE script output")
	}

	// Verify PortFindings
	if len(payload.PortFindings) != 2 {
		t.Fatalf("expected 2 PortFindings in payload, got %d", len(payload.PortFindings))
	}
	pf1 := payload.PortFindings[0]
	if pf1.Port != 22 || pf1.Service != "ssh" || pf1.HostID != host.ID {
		t.Errorf("unexpected PortFinding 1: %+v", pf1)
	}
	pf2 := payload.PortFindings[1]
	if pf2.Port != 80 || pf2.Service != "http" || pf2.Product != "Apache httpd" {
		t.Errorf("unexpected PortFinding 2: %+v", pf2)
	}
}

func TestNmap_ImportAliveCheck_F39(t *testing.T) {
	parsedScan, err := core.ParseNmapXML([]byte(sampleAliveCheckXML))
	if err != nil {
		t.Fatalf("ParseNmapXML failed: %v", err)
	}

	payload := &core.VaultPayload{
		Hosts: make([]core.HostRecord, 0),
		Notes: make([]core.NotePage, 0),
	}

	opts := core.NmapImportOptions{
		CreateHostRecords:  true,
		CreatePortNotes:    true,
		CreateSummaryNotes: true,
		OnlyUpHosts:        true,
	}

	summary, err := core.ImportNmapScan(payload, parsedScan, opts)
	if err != nil {
		t.Fatalf("ImportNmapScan failed: %v", err)
	}

	// Only 2 up hosts imported, 1 down host skipped
	if summary.CreatedHosts != 2 {
		t.Errorf("expected 2 created hosts, got %d", summary.CreatedHosts)
	}
	if summary.CreatedPortNotes != 0 {
		t.Errorf("expected 0 port subpages for alive check, got %d", summary.CreatedPortNotes)
	}
	if summary.CreatedNotes != 2 {
		t.Errorf("expected 2 alive check notes, got %d", summary.CreatedNotes)
	}

	// Check tags
	h1 := payload.Hosts[0]
	hasAliveTag := false
	for _, t := range h1.Tags {
		if t == "alive-check" {
			hasAliveTag = true
			break
		}
	}
	if !hasAliveTag {
		t.Errorf("expected alive-check tag on host %s, got tags: %v", h1.Label, h1.Tags)
	}
}
