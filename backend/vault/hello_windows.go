package vault

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// BiometricVerifier verifies user presence via Windows Hello / FIDO security key / OS prompt.
type BiometricVerifier func(ctx context.Context, message string) error

// DefaultBiometricVerifier triggers the native Windows Hello / FIDO2 UserConsentVerifier dialog on Windows.
func DefaultBiometricVerifier(ctx context.Context, message string) error {
	safeMsg := strings.ReplaceAll(message, "'", "''")
	psScript := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
[Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime] | Out-Null
$op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('%s')
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`+"`"+`1'
})[0].MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult])
$task = $asTask.Invoke($null, @($op))
$result = $task.GetAwaiter().GetResult()
if ($result -ne [Windows.Security.Credentials.UI.UserConsentVerificationResult]::Verified) {
    Write-Error "Verification failed: $result"
    exit 1
}
`, safeMsg)

	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", psScript)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("windows hello / security key verification failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}
