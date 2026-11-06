package core_test

import (
	"strings"
	"testing"

	"doubleagent/backend/core"
)

func TestProxychainsExport_F14(t *testing.T) {
	t.Run("default options formatting", func(t *testing.T) {
		opts := core.ProxychainsExportOptions{
			ChainType:         core.ChainStrict,
			ProxyDNS:          true,
			QuietMode:         false,
			TCPReadTimeout:    15000,
			TCPConnectTimeout: 8000,
			Proxies: []core.ProxychainsProxyEntry{
				{
					Type: "socks5",
					Host: "127.0.0.1",
					Port: 1080,
				},
				{
					Type:     "socks5",
					Host:     "10.0.0.1",
					Port:     9050,
					Username: "alice",
					Password: "secretpassword",
					Comment:  "Tor router",
				},
			},
		}

		cfg := core.GenerateProxychainsConfig(opts)
		if !strings.Contains(cfg, "strict_chain") {
			t.Errorf("expected strict_chain, got:\n%s", cfg)
		}
		if !strings.Contains(cfg, "proxy_dns") {
			t.Errorf("expected proxy_dns, got:\n%s", cfg)
		}
		if !strings.Contains(cfg, "tcp_read_time_out 15000") {
			t.Errorf("expected tcp_read_time_out 15000, got:\n%s", cfg)
		}
		if !strings.Contains(cfg, "socks5     127.0.0.1        1080") {
			t.Errorf("expected formatted proxy line for 127.0.0.1:1080, got:\n%s", cfg)
		}
		if !strings.Contains(cfg, "alice secretpassword # Tor router") {
			t.Errorf("expected proxy credentials and comment, got:\n%s", cfg)
		}
	})

	t.Run("dynamic chain and quiet mode", func(t *testing.T) {
		opts := core.ProxychainsExportOptions{
			ChainType:         core.ChainDynamic,
			ProxyDNS:          false,
			QuietMode:         true,
			TCPReadTimeout:    5000,
			TCPConnectTimeout: 2000,
			Proxies: []core.ProxychainsProxyEntry{
				{
					Type: "http",
					Host: "proxy.internal",
					Port: 8080,
				},
			},
		}

		cfg := core.GenerateProxychainsConfig(opts)
		if !strings.Contains(cfg, "dynamic_chain") {
			t.Errorf("expected dynamic_chain, got:\n%s", cfg)
		}
		if strings.Contains(cfg, "proxy_dns") {
			t.Errorf("did not expect proxy_dns, got:\n%s", cfg)
		}
		if !strings.Contains(cfg, "quiet_mode") {
			t.Errorf("expected quiet_mode, got:\n%s", cfg)
		}
		if !strings.Contains(cfg, "http       proxy.internal   8080") {
			t.Errorf("expected http proxy line, got:\n%s", cfg)
		}
	})

	t.Run("build defaults from vault payload", func(t *testing.T) {
		payload := core.VaultPayload{
			ForwardRules: []core.ForwardRule{
				{
					ID:          "rule-d1",
					Type:        core.ForwardDynamic,
					BindAddress: "127.0.0.1",
					BindPort:    1080,
					Label:       "Dev Dynamic SOCKS",
				},
				{
					ID:          "rule-l1",
					Type:        core.ForwardLocal,
					BindAddress: "127.0.0.1",
					BindPort:    5432,
					TargetHost:  "db.internal",
					TargetPort:  5432,
				},
			},
			ProxyProfiles: []core.ProxyProfile{
				{
					ID:           "prof-socks1",
					Name:         "Corporate SOCKS5",
					Type:         core.ProxyTypeSocks5,
					SocksAddress: "10.50.0.1:1088",
				},
			},
		}

		opts := core.BuildDefaultProxychainsOptions(payload)
		if len(opts.Proxies) != 2 {
			t.Fatalf("expected 2 proxies extracted, got %d", len(opts.Proxies))
		}
		if opts.Proxies[0].Port != 1080 || opts.Proxies[0].Type != "socks5" {
			t.Errorf("unexpected first proxy: %+v", opts.Proxies[0])
		}
		if opts.Proxies[1].Port != 1088 || opts.Proxies[1].Host != "10.50.0.1" {
			t.Errorf("unexpected second proxy: %+v", opts.Proxies[1])
		}
	})
}
