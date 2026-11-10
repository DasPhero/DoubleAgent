package core

import (
	"testing"
)

func TestImport_PuTTYRegContent_F30(t *testing.T) {
	sampleReg := `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\Production%20Bastion]
"HostName"="bastion.example.org"
"PortNumber"=dword:000008ae
"UserName"="ops-admin"
"PublicKeyFile"="C:\\Users\\admin\\.ssh\\id_rsa.ppk"
"PortForwardings"="L8080=localhost:80,R9000=127.0.0.1:9000,D1080"

[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\Staging%20API]
"HostName"="api-stage.internal"
"PortNumber"=dword:00000016
"UserName"="stageuser"
"PortForwardings"=""

[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\Default%20Settings]
"HostName"=""
`

	result := ParsePuTTYRegContent(sampleReg)
	if result.TotalFound != 2 {
		t.Fatalf("expected 2 sessions, got %d", result.TotalFound)
	}

	h1 := result.Hosts[0]
	if h1.Label != "Production Bastion" {
		t.Errorf("expected label 'Production Bastion', got %q", h1.Label)
	}
	if h1.Address != "bastion.example.org" {
		t.Errorf("expected address 'bastion.example.org', got %q", h1.Address)
	}
	// 0x8ae = 2222
	if h1.Port != 2222 {
		t.Errorf("expected port 2222, got %d", h1.Port)
	}
	if h1.Username != "ops-admin" {
		t.Errorf("expected user 'ops-admin', got %q", h1.Username)
	}
	if h1.KeyPath != `C:\Users\admin\.ssh\id_rsa.ppk` {
		t.Errorf("expected key path, got %q", h1.KeyPath)
	}
	if len(h1.ForwardRules) != 3 {
		t.Fatalf("expected 3 forward rules, got %d", len(h1.ForwardRules))
	}
	if h1.ForwardRules[0].Type != "L" || h1.ForwardRules[0].BindPort != 8080 || h1.ForwardRules[0].TargetHost != "localhost" || h1.ForwardRules[0].TargetPort != 80 {
		t.Errorf("unexpected rule 0: %+v", h1.ForwardRules[0])
	}
	if h1.ForwardRules[2].Type != "D" || h1.ForwardRules[2].BindPort != 1080 {
		t.Errorf("unexpected rule 2: %+v", h1.ForwardRules[2])
	}

	h2 := result.Hosts[1]
	if h2.Label != "Staging API" || h2.Port != 22 {
		t.Errorf("unexpected h2: %+v", h2)
	}
}

func TestImport_PuTTYSessionFile_F30(t *testing.T) {
	sampleFile := `HostName\192.168.10.50
PortNumber\2222
UserName\root
PublicKeyFile\/home/admin/.ssh/key.ppk
PortForwardings\L3000=localhost:3000
`
	entry, err := ParsePuTTYSessionFile("My%20Linux%20Box", sampleFile)
	if err != nil {
		t.Fatalf("ParsePuTTYSessionFile error: %v", err)
	}
	if entry.Label != "My%20Linux%20Box" {
		t.Errorf("expected label, got %q", entry.Label)
	}
	if entry.Address != "192.168.10.50" || entry.Port != 2222 || entry.Username != "root" {
		t.Errorf("unexpected entry values: %+v", entry)
	}
	if len(entry.ForwardRules) != 1 || entry.ForwardRules[0].BindPort != 3000 {
		t.Errorf("unexpected rules: %+v", entry.ForwardRules)
	}
}

func TestImport_TermiusJSON_Nested_F30(t *testing.T) {
	termiusJSON := `{
  "groups": [
    {"id": "grp-1", "label": "Cloud Cluster"}
  ],
  "hosts": [
    {
      "label": "Web Node 1",
      "address": "10.0.1.10",
      "port": 22,
      "username": "deploy",
      "group_id": "grp-1",
      "tags": ["web", "frontend"]
    },
    {
      "name": "DB Primary",
      "hostname": "10.0.2.20",
      "port": 5432,
      "user": "postgres",
      "tags": ["db"]
    }
  ]
}`

	res := ParseTermiusJSON(termiusJSON)
	if res.TotalFound != 2 {
		t.Fatalf("expected 2 hosts, got %d", res.TotalFound)
	}
	if len(res.Groups) != 1 || res.Groups[0] != "Cloud Cluster" {
		t.Errorf("unexpected groups: %+v", res.Groups)
	}

	h1 := res.Hosts[0]
	if h1.Label != "Web Node 1" || h1.Address != "10.0.1.10" || h1.Group != "Cloud Cluster" {
		t.Errorf("unexpected h1: %+v", h1)
	}
	if len(h1.Tags) != 2 || h1.Tags[0] != "web" {
		t.Errorf("unexpected tags: %+v", h1.Tags)
	}

	h2 := res.Hosts[1]
	if h2.Label != "DB Primary" || h2.Address != "10.0.2.20" || h2.Port != 5432 || h2.Username != "postgres" {
		t.Errorf("unexpected h2: %+v", h2)
	}
}

func TestImport_TermiusJSON_FlatArray_F30(t *testing.T) {
	flatJSON := `[
  {
    "label": "Direct Host",
    "address": "direct.domain.com",
    "port": 2202,
    "username": "admin",
    "group": "External"
  }
]`
	res := ParseTermiusJSON(flatJSON)
	if res.TotalFound != 1 {
		t.Fatalf("expected 1 host, got %d", res.TotalFound)
	}
	h := res.Hosts[0]
	if h.Label != "Direct Host" || h.Port != 2202 || h.Group != "External" {
		t.Errorf("unexpected h: %+v", h)
	}
}

func TestImport_TermiusCSV_F30(t *testing.T) {
	sampleCSV := `Label,Address,Port,Username,Group,Tags
Bastion-Prod,198.51.100.1,22,secops,Production,"infra,bastion"
Worker-01,198.51.100.2,2222,worker,Workers,"k8s,node"
`
	res := ParseTermiusCSV(sampleCSV)
	if res.TotalFound != 2 {
		t.Fatalf("expected 2 hosts from CSV, got %d", res.TotalFound)
	}
	h1 := res.Hosts[0]
	if h1.Label != "Bastion-Prod" || h1.Address != "198.51.100.1" || h1.Username != "secops" || h1.Group != "Production" {
		t.Errorf("unexpected h1: %+v", h1)
	}
	if len(h1.Tags) != 2 || h1.Tags[0] != "infra" {
		t.Errorf("unexpected tags: %+v", h1.Tags)
	}
}

