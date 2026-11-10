package vault

import (
	"strings"
	"testing"
	"time"

	"doubleagent/backend/core"
)

// TestTOTP_RFC6238_F20 verifies standard RFC 6238 test vectors (F-20).
// Secret "12345678901234567890" ASCII corresponds to Base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" (20 bytes).
func TestTOTP_RFC6238_F20(t *testing.T) {
	const secretBase32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

	tests := []struct {
		name      string
		unixTime  int64
		algorithm string
		digits    int
		wantCode  string
	}{
		// RFC 6238 Table 1 test vectors for SHA1 (8 digits)
		{"Time 59 SHA1 8dig", 59, "SHA1", 8, "94287082"},
		{"Time 1111111109 SHA1 8dig", 1111111109, "SHA1", 8, "07081804"},
		{"Time 1111111111 SHA1 8dig", 1111111111, "SHA1", 8, "14050471"},
		{"Time 1234567890 SHA1 8dig", 1234567890, "SHA1", 8, "89005924"},
		{"Time 2000000000 SHA1 8dig", 2000000000, "SHA1", 8, "69279037"},

		// Standard 6-digit test vectors (mod 10^6)
		{"Time 59 SHA1 6dig", 59, "SHA1", 6, "287082"},
		{"Time 1111111109 SHA1 6dig", 1111111109, "SHA1", 6, "081804"},
		{"Time 1111111111 SHA1 6dig", 1111111111, "SHA1", 6, "050471"},
		{"Time 1234567890 SHA1 6dig", 1234567890, "SHA1", 6, "005924"},
		{"Time 2000000000 SHA1 6dig", 2000000000, "SHA1", 6, "279037"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tm := time.Unix(tt.unixTime, 0).UTC()
			code, remaining, err := GenerateTOTPCode(secretBase32, tm, tt.algorithm, tt.digits, 30)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if code != tt.wantCode {
				t.Errorf("GenerateTOTPCode() code = %q, want %q", code, tt.wantCode)
			}
			expectedRemaining := 30 - int(tt.unixTime%30)
			if expectedRemaining == 0 {
				expectedRemaining = 30
			}
			if remaining != expectedRemaining {
				t.Errorf("GenerateTOTPCode() remaining = %d, want %d", remaining, expectedRemaining)
			}
		})
	}
}

// TestTOTP_ParseOTPAuthURI_F20 tests otpauth URI parsing including edge cases and parameters (F-20).
func TestTOTP_ParseOTPAuthURI_F20(t *testing.T) {
	t.Run("Valid Standard URI", func(t *testing.T) {
		uri := "otpauth://totp/GitHub:octocat@github.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30"
		rec, err := ParseOTPAuthURI(uri)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if rec.Issuer != "GitHub" {
			t.Errorf("expected Issuer GitHub, got %q", rec.Issuer)
		}
		if rec.Label != "octocat@github.com" {
			t.Errorf("expected Label octocat@github.com, got %q", rec.Label)
		}
		if rec.Secret != "JBSWY3DPEHPK3PXP" {
			t.Errorf("expected Secret JBSWY3DPEHPK3PXP, got %q", rec.Secret)
		}
		if rec.Digits != 6 {
			t.Errorf("expected Digits 6, got %d", rec.Digits)
		}
		if rec.Period != 30 {
			t.Errorf("expected Period 30, got %d", rec.Period)
		}
	})

	t.Run("URI with URL Encoding and 8 Digits", func(t *testing.T) {
		uri := "otpauth://totp/AWS%20Cloud:admin%40corp?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8&period=60&algorithm=SHA256"
		rec, err := ParseOTPAuthURI(uri)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if rec.Issuer != "AWS Cloud" {
			t.Errorf("expected Issuer AWS Cloud, got %q", rec.Issuer)
		}
		if rec.Label != "admin@corp" {
			t.Errorf("expected Label admin@corp, got %q", rec.Label)
		}
		if rec.Digits != 8 {
			t.Errorf("expected Digits 8, got %d", rec.Digits)
		}
		if rec.Period != 60 {
			t.Errorf("expected Period 60, got %d", rec.Period)
		}
		if rec.Algorithm != "SHA256" {
			t.Errorf("expected Algorithm SHA256, got %q", rec.Algorithm)
		}
	})

	t.Run("Invalid URIs", func(t *testing.T) {
		invalidURIs := []string{
			"https://example.com",
			"otpauth://hotp/test?secret=JBSWY3DPEHPK3PXP&counter=1",
			"otpauth://totp/test",                               // missing secret
			"otpauth://totp/test?secret=invalid!base32!secret@", // invalid base32
		}

		for _, inv := range invalidURIs {
			_, err := ParseOTPAuthURI(inv)
			if err == nil {
				t.Errorf("expected error for invalid URI %q, got nil", inv)
			}
		}
	})
}

// TestTOTP_SecretNormalization_F20 ensures spaces, dashes, and lowercase are handled gracefully.
func TestTOTP_SecretNormalization_F20(t *testing.T) {
	variants := []string{
		"JBSWY3DPEHPK3PXP",
		"jbswy3dpehpk3pxp",
		"jbsw y3dp ehpk 3pxp",
		"JBSW-Y3DP-EHPK-3PXP",
	}

	tm := time.Unix(1000000000, 0)
	var expectedCode string

	for i, v := range variants {
		code, _, err := GenerateTOTPCode(v, tm, "SHA1", 6, 30)
		if err != nil {
			t.Fatalf("variant %d (%q) failed: %v", i, v, err)
		}
		if i == 0 {
			expectedCode = code
		} else if code != expectedCode {
			t.Errorf("variant %d (%q) gave %q, want %q", i, v, code, expectedCode)
		}
	}
}

// TestTOTP_FormatAndRoundTrip_F20 ensures FormatOTPAuthURI constructs valid RFC 6238 URIs that round-trip.
func TestTOTP_FormatAndRoundTrip_F20(t *testing.T) {
	orig := core.TotpRecord{
		Label:     "user@bastion.corp",
		Issuer:    "CyberBastion",
		Secret:    "JBSWY3DPEHPK3PXP",
		Algorithm: "SHA256",
		Digits:    8,
		Period:    60,
	}

	uri := FormatOTPAuthURI(orig)
	if !strings.HasPrefix(uri, "otpauth://totp/") {
		t.Fatalf("expected otpauth://totp/ prefix, got %q", uri)
	}

	parsed, err := ParseOTPAuthURI(uri)
	if err != nil {
		t.Fatalf("failed to parse formatted URI: %v", err)
	}

	if parsed.Issuer != orig.Issuer {
		t.Errorf("expected Issuer %q, got %q", orig.Issuer, parsed.Issuer)
	}
	if parsed.Label != orig.Label {
		t.Errorf("expected Label %q, got %q", orig.Label, parsed.Label)
	}
	if parsed.Secret != orig.Secret {
		t.Errorf("expected Secret %q, got %q", orig.Secret, parsed.Secret)
	}
	if parsed.Algorithm != orig.Algorithm {
		t.Errorf("expected Algorithm %q, got %q", orig.Algorithm, parsed.Algorithm)
	}
	if parsed.Digits != orig.Digits {
		t.Errorf("expected Digits %d, got %d", orig.Digits, parsed.Digits)
	}
	if parsed.Period != orig.Period {
		t.Errorf("expected Period %d, got %d", orig.Period, parsed.Period)
	}
}
