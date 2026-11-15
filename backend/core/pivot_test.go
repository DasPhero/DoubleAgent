package core

import (
	"slices"
	"strings"
	"testing"
)

func TestValidateNetworkRoute_F24(t *testing.T) {
	valid := NetworkRoute{
		ID:            "route-1",
		Name:          "Internal AD Pivot",
		Tool:          "ligolo-ng",
		BindAddress:   "0.0.0.0",
		ListenPort:    11601,
		InterfaceName: "ligolo0",
		Subnets:       []string{"10.10.20.0/24", "172.16.0.0/16"},
		SelfCert:      true,
	}
	if err := ValidateNetworkRoute(valid); err != nil {
		t.Fatalf("expected valid ligolo route, got error: %v", err)
	}

	cases := []struct {
		name string
		mod  func(r NetworkRoute) NetworkRoute
	}{
		{"empty name", func(r NetworkRoute) NetworkRoute { r.Name = "  "; return r }},
		{"unsupported tool", func(r NetworkRoute) NetworkRoute { r.Tool = "metasploit"; return r }},
		{"zero port", func(r NetworkRoute) NetworkRoute { r.ListenPort = 0; return r }},
		{"bad bind ip", func(r NetworkRoute) NetworkRoute { r.BindAddress = "not-an-ip"; return r }},
		{"bad iface", func(r NetworkRoute) NetworkRoute { r.InterfaceName = "bad;rm -rf"; return r }},
		{"bad cidr", func(r NetworkRoute) NetworkRoute { r.Subnets = []string{"10.999.0.0/24"}; return r }},
		{"shell metachar extra args", func(r NetworkRoute) NetworkRoute { r.ExtraArgs = "-v; whoami"; return r }},
	}

	for _, tc := range cases {
		if err := ValidateNetworkRoute(tc.mod(valid)); err == nil {
			t.Errorf("expected error for %s, got nil", tc.name)
		}
	}
}

func TestBuildPivotArgsAndCommandSet_F24(t *testing.T) {
	ligoloRoute := NetworkRoute{
		ID:            "r-ligolo",
		Name:          "Lab TUN",
		Tool:          "ligolo-ng",
		BindAddress:   "0.0.0.0",
		ListenPort:    11601,
		InterfaceName: "ligolo_lab",
		Subnets:       []string{"10.10.20.0/24", "192.168.50.0/24"},
		SelfCert:      true,
		IgnoreCert:    true,
	}

	bins, args, display := BuildPivotArgs(ligoloRoute)
	if !slices.Contains(bins, "ligolo-proxy") {
		t.Fatalf("expected ligolo-proxy candidate in %v", bins)
	}
	expectedArgs := []string{"-laddr", "0.0.0.0:11601", "-selfcert"}
	if !slices.Equal(args, expectedArgs) {
		t.Fatalf("expected args %v, got %v", expectedArgs, args)
	}
	if !strings.Contains(display, "-laddr 0.0.0.0:11601 -selfcert") {
		t.Fatalf("unexpected display cmd %q", display)
	}

	cmdSet := BuildPivotCommandSet(ligoloRoute, "10.10.14.9")
	if !strings.Contains(cmdSet.LinuxAgentCmd, "./agent -connect 10.10.14.9:11601 -ignore-cert") {
		t.Fatalf("unexpected linux agent cmd %q", cmdSet.LinuxAgentCmd)
	}
	if !strings.Contains(cmdSet.WindowsAgentCmd, `.\agent.exe -connect 10.10.14.9:11601 -ignore-cert`) {
		t.Fatalf("unexpected windows agent cmd %q", cmdSet.WindowsAgentCmd)
	}
	if len(cmdSet.RouteCommands) != 2 || !strings.Contains(cmdSet.RouteCommands[0], "ip route add 10.10.20.0/24 dev ligolo_lab") {
		t.Fatalf("unexpected route commands: %v", cmdSet.RouteCommands)
	}

	chiselRoute := NetworkRoute{
		ID:          "r-chisel",
		Name:        "Chisel Pivot",
		Tool:        "chisel",
		BindAddress: "10.10.14.9",
		ListenPort:  8443,
		SocksPort:   9050,
		Reverse:     true,
		Subnets:     []string{"10.10.20.0/24"},
	}

	cBins, cArgs, _ := BuildPivotArgs(chiselRoute)
	if cBins[0] != "chisel" {
		t.Fatalf("expected chisel binary, got %v", cBins)
	}
	if !slices.Contains(cArgs, "--reverse") || !slices.Contains(cArgs, "--socks5") {
		t.Fatalf("expected --reverse and --socks5 in chisel args %v", cArgs)
	}

	cSet := BuildPivotCommandSet(chiselRoute, "")
	if cSet.ProxychainsLine != "socks5 127.0.0.1 9050" {
		t.Fatalf("expected custom socks5 port 9050, got %q", cSet.ProxychainsLine)
	}
	if !strings.Contains(cSet.LinuxAgentCmd, "./chisel client 10.10.14.9:8443 R:9050:socks") {
		t.Fatalf("unexpected chisel linux cmd %q", cSet.LinuxAgentCmd)
	}
}

func TestAnalyzePivotOpsecAndParseSubnets_F24(t *testing.T) {
	subs := ParseSubnetsList("10.10.10.0/24, 10.10.10.0/24\n172.16.1.0/24 ; ")
	if len(subs) != 2 || subs[0] != "10.10.10.0/24" || subs[1] != "172.16.1.0/24" {
		t.Fatalf("unexpected parsed subnets: %v", subs)
	}

	warns := AnalyzePivotOpsec(NetworkRoute{
		Name:        "Loopback Test",
		Tool:        "ligolo-ng",
		BindAddress: "127.0.0.1",
		ListenPort:  4444,
		SelfCert:    true,
	})
	joined := strings.Join(warns, "\n")
	if !strings.Contains(joined, "4444") || !strings.Contains(joined, "127.0.0.1") || !strings.Contains(joined, "-selfcert") {
		t.Fatalf("expected opsec warnings for port 4444, loopback bind, and selfcert; got %v", warns)
	}
}
