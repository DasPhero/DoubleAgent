package core

import (
	"testing"
)

func TestM1_2_ParseQuickConnectTarget_F02(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantOK   bool
		wantUser string
		wantHost string
		wantPort int
	}{
		{
			name:     "full user@host:port",
			input:    "deploy@10.20.30.40:2222",
			wantOK:   true,
			wantUser: "deploy",
			wantHost: "10.20.30.40",
			wantPort: 2222,
		},
		{
			name:     "user@host defaults to port 22",
			input:    "ubuntu@bastion.example.org",
			wantOK:   true,
			wantUser: "ubuntu",
			wantHost: "bastion.example.org",
			wantPort: 22,
		},
		{
			name:     "host:port defaults to root",
			input:    "192.168.10.5:22022",
			wantOK:   true,
			wantUser: "root",
			wantHost: "192.168.10.5",
			wantPort: 22022,
		},
		{
			name:     "ssh command with -p flag",
			input:    "ssh -p 2022 admin@db.internal",
			wantOK:   true,
			wantUser: "admin",
			wantHost: "db.internal",
			wantPort: 2022,
		},
		{
			name:   "plain word without @ or :port is not treated as quick-connect target",
			input:  "production",
			wantOK: false,
		},
		{
			name:   "out of range port rejected",
			input:  "root@10.0.0.1:70000",
			wantOK: false,
		},
		{
			name:   "empty user before @ rejected",
			input:  "@10.0.0.1:22",
			wantOK: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseQuickConnectTarget(tc.input)
			if ok != tc.wantOK {
				t.Fatalf("ParseQuickConnectTarget(%q) ok = %v, want %v (got %+v)", tc.input, ok, tc.wantOK, got)
			}
			if !tc.wantOK {
				return
			}
			if got.User != tc.wantUser || got.Address != tc.wantHost || got.Port != tc.wantPort {
				t.Fatalf("ParseQuickConnectTarget(%q) = %+v, want user=%q host=%q port=%d",
					tc.input, got, tc.wantUser, tc.wantHost, tc.wantPort)
			}
		})
	}
}

func TestM1_2_SearchHostsFuzzy_F02(t *testing.T) {
	hosts := []HostSummary{
		{
			ID:            "h1",
			Label:         "prod-web-01",
			Address:       "10.10.1.15",
			GroupID:       "g-prod",
			EffectiveUser: "deploy",
			EffectivePort: 2222,
			Tags:          []string{"nginx", "frontend", "eu-central"},
		},
		{
			ID:            "h2",
			Label:         "staging-db-primary",
			Address:       "10.20.5.99",
			GroupID:       "g-stage",
			EffectiveUser: "postgres",
			EffectivePort: 22,
			Tags:          []string{"postgres", "database"},
		},
		{
			ID:            "h3",
			Label:         "k8s-worker-node",
			Address:       "172.16.0.42",
			GroupID:       "g-cluster",
			EffectiveUser: "ubuntu",
			EffectivePort: 22,
			Tags:          []string{"kubernetes", "docker"},
		},
	}

	// 1. Fuzzy match by subsequence in Name ("pw01" -> "prod-web-01")
	resName := SearchHostsFuzzy(hosts, "pw01")
	if len(resName) == 0 || resName[0].Host.ID != "h1" {
		t.Fatalf("expected 'pw01' fuzzy query to match prod-web-01 first, got %+v", resName)
	}

	// 2. Match by IP address fragment ("10.20.5" -> "staging-db-primary")
	resAddr := SearchHostsFuzzy(hosts, "10.20.5")
	if len(resAddr) != 1 || resAddr[0].Host.ID != "h2" {
		t.Fatalf("expected '10.20.5' query to match h2, got %+v", resAddr)
	}

	// 3. Match by Tag ("nginx" -> "prod-web-01")
	resTag := SearchHostsFuzzy(hosts, "nginx")
	if len(resTag) != 1 || resTag[0].Host.ID != "h1" {
		t.Fatalf("expected 'nginx' tag query to match h1, got %+v", resTag)
	}

	// 4. Multi-token query across Group/Name and Tag ("staging database" -> "h2")
	resMulti := SearchHostsFuzzy(hosts, "staging database")
	if len(resMulti) != 1 || resMulti[0].Host.ID != "h2" {
		t.Fatalf("expected 'staging database' multi-token query to match h2, got %+v", resMulti)
	}
}
