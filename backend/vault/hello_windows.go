package vault

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// BiometricVerifier verifies user presence via Windows Hello / FIDO security key / OS prompt.
type BiometricVerifier func(ctx context.Context, message string) error

// KeyProtector wraps and unwraps the 32-byte vault master key using OS-level hardware/user protection (Windows DPAPI).
type KeyProtector interface {
	Protect(plaintext []byte) ([]byte, error)
	Unprotect(ciphertext []byte) ([]byte, error)
}

var (
	user32                      = syscall.NewLazyDLL("user32.dll")
	procAllowSetForegroundWin   = user32.NewProc("AllowSetForegroundWindow")
	procFindWindowW             = user32.NewProc("FindWindowW")
	procSetForegroundWindow     = user32.NewProc("SetForegroundWindow")
	procBringWindowToTop        = user32.NewProc("BringWindowToTop")
)

const asfwAny = uintptr(0xFFFFFFFF)

func focusWindowsSecurityDialog(stop <-chan struct{}) {
	className, err := syscall.UTF16PtrFromString("Credential Dialog Xaml Host")
	if err != nil {
		return
	}
	ticker := time.NewTicker(120 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			hwnd, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(className)), 0)
			if hwnd != 0 {
				_, _, _ = procBringWindowToTop.Call(hwnd)
				_, _, _ = procSetForegroundWindow.Call(hwnd)
			}
		}
	}
}

// DefaultBiometricVerifier triggers the native Windows Hello / FIDO2 UserConsentVerifier dialog on Windows,
// explicitly loading System.Runtime.WindowsRuntime for AsTask awaiting and bringing the security dialog to the foreground.
func DefaultBiometricVerifier(ctx context.Context, message string) error {
	// Grant child/broker processes permission to take foreground focus from DoubleAgent.
	_, _, _ = procAllowSetForegroundWin.Call(asfwAny)

	stopFocus := make(chan struct{})
	defer close(stopFocus)
	go focusWindowsSecurityDialog(stopFocus)

	safeMsg := strings.ReplaceAll(message, "'", "''")
	psScript := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime] | Out-Null

$op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('%s')
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`+"`"+`1'
})[0]
$asTask = $asTaskGeneric.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult])
$task = $asTask.Invoke($null, @($op))
$task.Wait()
$result = $task.Result

if ($result -ne [Windows.Security.Credentials.UI.UserConsentVerificationResult]::Verified) {
    Write-Error "Verification cancelled or rejected ($result)"
    exit 1
}
`, safeMsg)

	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", psScript)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("windows hello / security key verification failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

type dpapiBlob struct {
	cbData uint32
	pbData *byte
}

var (
	crypt32                = syscall.NewLazyDLL("crypt32.dll")
	kernel32               = syscall.NewLazyDLL("kernel32.dll")
	procCryptProtectData   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
	procLocalFree          = kernel32.NewProc("LocalFree")
)

type windowsDPAPIProtector struct{}

// DefaultKeyProtector returns a Windows DPAPI (CryptProtectData / CryptUnprotectData) protector bound to the current Windows user & machine.
func DefaultKeyProtector() KeyProtector {
	return windowsDPAPIProtector{}
}

func bytesToBlob(b []byte) *dpapiBlob {
	if len(b) == 0 {
		return &dpapiBlob{}
	}
	return &dpapiBlob{
		cbData: uint32(len(b)),
		pbData: &b[0],
	}
}

func (windowsDPAPIProtector) Protect(plaintext []byte) ([]byte, error) {
	inBlob := bytesToBlob(plaintext)
	var outBlob dpapiBlob
	r, _, err := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(inBlob)),
		0,
		0,
		0,
		0,
		0,
		uintptr(unsafe.Pointer(&outBlob)),
	)
	if r == 0 {
		return nil, fmt.Errorf("dpapi CryptProtectData: %w", err)
	}
	defer func() {
		_, _, _ = procLocalFree.Call(uintptr(unsafe.Pointer(outBlob.pbData)))
	}()

	out := make([]byte, outBlob.cbData)
	copy(out, unsafe.Slice(outBlob.pbData, outBlob.cbData))
	return out, nil
}

func (windowsDPAPIProtector) Unprotect(ciphertext []byte) ([]byte, error) {
	inBlob := bytesToBlob(ciphertext)
	var outBlob dpapiBlob
	r, _, err := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(inBlob)),
		0,
		0,
		0,
		0,
		0,
		uintptr(unsafe.Pointer(&outBlob)),
	)
	if r == 0 {
		return nil, fmt.Errorf("dpapi CryptUnprotectData: %w", err)
	}
	defer func() {
		_, _, _ = procLocalFree.Call(uintptr(unsafe.Pointer(outBlob.pbData)))
	}()

	out := make([]byte, outBlob.cbData)
	copy(out, unsafe.Slice(outBlob.pbData, outBlob.cbData))
	return out, nil
}
