//go:build !windows

package vault

import (
	"context"
	"errors"
)

// BiometricVerifier verifies user presence via OS biometric / FIDO prompt.
type BiometricVerifier func(ctx context.Context, message string) error

// KeyProtector wraps and unwraps the 32-byte vault master key using OS-level protection.
type KeyProtector interface {
	Protect(plaintext []byte) ([]byte, error)
	Unprotect(ciphertext []byte) ([]byte, error)
}

// DefaultBiometricVerifier returns an error on platforms without a configured native verifier.
func DefaultBiometricVerifier(_ context.Context, _ string) error {
	return errors.New("native biometric / security key prompt is not configured on this OS")
}

type fallbackProtector struct{}

func (fallbackProtector) Protect(_ []byte) ([]byte, error) {
	return nil, errors.New("os key protector not available on this platform")
}

func (fallbackProtector) Unprotect(_ []byte) ([]byte, error) {
	return nil, errors.New("os key protector not available on this platform")
}

// DefaultKeyProtector returns a fallback protector on non-Windows platforms.
func DefaultKeyProtector() KeyProtector {
	return fallbackProtector{}
}
