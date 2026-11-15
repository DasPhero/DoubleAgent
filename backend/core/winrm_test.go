package core

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestValidateWinrmProfileAndHash_F41(t *testing.T) {
	if err := ValidateWinrmProfile(WinrmProfile{}); err == nil {
		t.Fatal("expected error for empty WinRM host")
	}
	if err := ValidateWinrmProfile(WinrmProfile{
		Host:     "10.10.20.10",
		AuthType: WinrmAuthNTLM,
	}); err == nil {
		t.Fatal("expected error when username missing for NTLM")
	}

	// Supports both 32-hex NT and LM:NT pair
	hash32 := "8846f7eaee8fb117ad06bdd830b7586c"
	b1, err := ParseNtHashHex(hash32)
	if err != nil || len(b1) != 16 {
		t.Fatalf("failed to parse 32-hex NT hash: %v", err)
	}
	b2, err := ParseNtHashHex("aad3b435b51404eeaad3b435b51404ee:" + hash32)
	if err != nil || len(b2) != 16 {
		t.Fatalf("failed to parse LM:NT hash: %v", err)
	}
	if _, err := ParseNtHashHex("not-valid-hex"); err == nil {
		t.Fatal("expected invalid NT hash error")
	}

	prof := NormalizeWinrmProfile(WinrmProfile{
		Host:     "dc01.corp.local",
		UseTLS:   true,
		AuthType: "pass-the-hash",
		Domain:   "CORP",
		Username: "administrator",
		NtHash:   hash32,
	})
	if prof.Port != DefaultWinrmHTTPSPort || prof.AuthType != WinrmAuthPtH {
		t.Fatalf("unexpected normalization: %+v", prof)
	}
	if err := ValidateWinrmProfile(prof); err != nil {
		t.Fatalf("unexpected validation failure: %v", err)
	}

	// Secret stripping check (Golden Rule 2)
	sum := prof.ToSummary()
	if !sum.HasNtHash || sum.HasPassword {
		t.Fatalf("unexpected summary flags: %+v", sum)
	}
}

func TestEncodePowerShellAndOpsec_F41(t *testing.T) {
	enc := EncodePowerShellUTF16Base64("whoami")
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		t.Fatalf("invalid base64: %v", err)
	}
	// UTF-16LE of "whoami" is 12 bytes: w\x00h\x00o\x00a\x00m\x00i\x00
	if len(raw) != 12 || raw[0] != 'w' || raw[1] != 0 {
		t.Fatalf("unexpected UTF-16LE bytes: %x", raw)
	}

	opsec := AnalyzeWinrmOpsec(WinrmProfile{
		Host:     "10.10.20.10",
		UseTLS:   false,
		AuthType: WinrmAuthBasic,
		Username: "admin",
	})
	joined := strings.Join(opsec, " ")
	if !strings.Contains(joined, "CRITICAL OPSEC") || !strings.Contains(joined, "5985") {
		t.Fatalf("expected Basic HTTP OPSEC warning, got %v", opsec)
	}

	cli := BuildEvilWinrmCLI(WinrmProfile{
		Host:           "dc01.corp.local",
		UseTLS:         true,
		AuthType:       WinrmAuthPtH,
		Domain:         "CORP",
		Username:       "Administrator",
		NtHash:         "8846f7eaee8fb117ad06bdd830b7586c",
		SocksProxyAddr: "127.0.0.1:1080",
	})
	if !strings.Contains(cli, "proxychains4 -q evil-winrm -i dc01.corp.local -P 5986 -S -u CORP\\Administrator -H <NT_HASH>") {
		t.Fatalf("unexpected CLI preview: %s", cli)
	}
}
