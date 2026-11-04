//go:build !windows

package vault

import (
	"context"
	"errors"
)

// BiometricVerifier verifies user presence via OS biometric / FIDO prompt.
type BiometricVerifier func(ctx context.Context, message string) error

// DefaultBiometricVerifier returns an error on platforms without a configured native verifier.
func DefaultBiometricVerifier(_ context.Context, _ string) error {
	return errors.New("native biometric / security key prompt is not configured on this OS")
}
