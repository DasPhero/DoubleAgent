package vault

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"hash"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	"doubleagent/backend/core"
)

var (
	// ErrInvalidTotpSecret is returned when a TOTP secret is empty or cannot be base32-decoded.
	ErrInvalidTotpSecret = errors.New("invalid or unparseable base32 TOTP secret")
	// ErrInvalidOtpAuthURI is returned when an otpauth:// URI fails schema or query validation.
	ErrInvalidOtpAuthURI = errors.New("invalid otpauth URI")
)

// DecodeBase32Key cleans and decodes a base32-encoded TOTP secret key (RFC 4648).
// Ignores whitespace, dashes, and handles missing padding.
func DecodeBase32Key(raw string) ([]byte, error) {
	cleaned := strings.ToUpper(strings.TrimSpace(raw))
	cleaned = strings.ReplaceAll(cleaned, " ", "")
	cleaned = strings.ReplaceAll(cleaned, "-", "")
	cleaned = strings.ReplaceAll(cleaned, "=", "")

	if cleaned == "" {
		return nil, ErrInvalidTotpSecret
	}

	// RFC 4648 without padding
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(cleaned)
	if err != nil {
		// Fallback to padded decoding
		padLen := (8 - (len(cleaned) % 8)) % 8
		padded := cleaned + strings.Repeat("=", padLen)
		decoded, err = base32.StdEncoding.DecodeString(padded)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidTotpSecret, err)
		}
	}
	return decoded, nil
}

// GenerateTOTPCode calculates the RFC 6238 time-based one-time password and remaining seconds.
// Supports SHA1, SHA256, and SHA512 algorithms, 6 or 8 digits, and custom period (default 30s).
func GenerateTOTPCode(secret string, t time.Time, algorithm string, digits int, period int) (string, int, error) {
	keyBytes, err := DecodeBase32Key(secret)
	if err != nil {
		return "", 0, err
	}

	if digits != 8 {
		digits = 6
	}
	if period <= 0 {
		period = 30
	}

	var hasher func() hash.Hash
	switch strings.ToUpper(algorithm) {
	case "SHA256":
		hasher = sha256.New
	case "SHA512":
		hasher = sha512.New
	default:
		hasher = sha1.New
	}

	nowSec := t.Unix()
	step := uint64(nowSec / int64(period))

	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], step)

	mac := hmac.New(hasher, keyBytes)
	mac.Write(msg[:])
	h := mac.Sum(nil)

	// Dynamic Truncation (RFC 4226 Section 5.4)
	offset := h[len(h)-1] & 0x0f
	binCode := binary.BigEndian.Uint32(h[offset:offset+4]) & 0x7fffffff

	mod := uint32(math.Pow10(digits))
	codeNum := binCode % mod

	format := fmt.Sprintf("%%0%dd", digits)
	code := fmt.Sprintf(format, codeNum)

	elapsed := nowSec % int64(period)
	remaining := period - int(elapsed)
	if remaining <= 0 {
		remaining = period
	}

	return code, remaining, nil
}

// ParseOTPAuthURI parses a standard Google Authenticator / RFC 6238 `otpauth://totp/...` URI.
func ParseOTPAuthURI(uriStr string) (*core.TotpRecord, error) {
	trimmed := strings.TrimSpace(uriStr)
	if !strings.HasPrefix(strings.ToLower(trimmed), "otpauth://") {
		return nil, fmt.Errorf("%w: missing otpauth:// prefix", ErrInvalidOtpAuthURI)
	}

	u, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidOtpAuthURI, err)
	}

	if strings.ToLower(u.Host) != "totp" {
		return nil, fmt.Errorf("%w: expected 'totp' type, got %q", ErrInvalidOtpAuthURI, u.Host)
	}

	q := u.Query()
	secret := strings.TrimSpace(q.Get("secret"))
	if secret == "" {
		return nil, fmt.Errorf("%w: secret parameter is missing", ErrInvalidOtpAuthURI)
	}

	// Verify the secret is valid base32
	if _, err := DecodeBase32Key(secret); err != nil {
		return nil, err
	}

	// Extract label and account
	rawPath := strings.TrimPrefix(u.Path, "/")
	unescapedLabel, _ := url.PathUnescape(rawPath)
	unescapedLabel = strings.TrimSpace(unescapedLabel)

	issuerParam := strings.TrimSpace(q.Get("issuer"))
	issuer := issuerParam
	label := unescapedLabel

	if strings.Contains(unescapedLabel, ":") {
		parts := strings.SplitN(unescapedLabel, ":", 2)
		prefixIssuer := strings.TrimSpace(parts[0])
		account := strings.TrimSpace(parts[1])
		if issuer == "" {
			issuer = prefixIssuer
		}
		label = account
	}

	if label == "" {
		if issuer != "" {
			label = issuer
		} else {
			label = "TOTP Authenticator"
		}
	}

	algorithm := strings.ToUpper(strings.TrimSpace(q.Get("algorithm")))
	if algorithm == "" {
		algorithm = "SHA1"
	}

	digits := 6
	if digitsStr := strings.TrimSpace(q.Get("digits")); digitsStr != "" {
		if d, err := strconv.Atoi(digitsStr); err == nil && (d == 6 || d == 8) {
			digits = d
		}
	}

	period := 30
	if periodStr := strings.TrimSpace(q.Get("period")); periodStr != "" {
		if p, err := strconv.Atoi(periodStr); err == nil && p > 0 {
			period = p
		}
	}

	return &core.TotpRecord{
		Label:     label,
		Issuer:    issuer,
		Secret:    secret,
		Algorithm: algorithm,
		Digits:    digits,
		Period:    period,
	}, nil
}

// FormatOTPAuthURI constructs a standard RFC 6238 otpauth://totp/... URI from a TotpRecord.
func FormatOTPAuthURI(rec core.TotpRecord) string {
	label := strings.TrimSpace(rec.Label)
	issuer := strings.TrimSpace(rec.Issuer)
	if label == "" {
		if issuer != "" {
			label = issuer
		} else {
			label = "Authenticator"
		}
	}

	fullLabel := label
	if issuer != "" && !strings.HasPrefix(strings.ToLower(label), strings.ToLower(issuer)+":") {
		fullLabel = issuer + ":" + label
	}

	encodedLabel := url.PathEscape(fullLabel)

	q := url.Values{}
	q.Set("secret", strings.TrimSpace(rec.Secret))
	if issuer != "" {
		q.Set("issuer", issuer)
	}
	if rec.Algorithm != "" && strings.ToUpper(rec.Algorithm) != "SHA1" {
		q.Set("algorithm", strings.ToUpper(rec.Algorithm))
	}
	if rec.Digits > 0 && rec.Digits != 6 {
		q.Set("digits", strconv.Itoa(rec.Digits))
	}
	if rec.Period > 0 && rec.Period != 30 {
		q.Set("period", strconv.Itoa(rec.Period))
	}

	return fmt.Sprintf("otpauth://totp/%s?%s", encodedLabel, q.Encode())
}
