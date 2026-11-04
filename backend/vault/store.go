// Package vault implements core.SecretStore using Argon2id and XChaCha20-Poly1305.
package vault

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"

	"doubleagent/backend/core"
)

const (
	currentFormatVersion = 1
	currentSchemaVersion = 1
	saltSize             = 16
	defaultMaxBackups    = 3
)

// KDFParams stores the Argon2id parameters in the vault file header (Spec Section 8).
type KDFParams struct {
	Algorithm    string `json:"algorithm"`
	Time         uint32 `json:"time"`
	MemoryKB     uint32 `json:"memoryKb"`
	Threads      uint8  `json:"threads"`
	KeyLen       uint32 `json:"keyLen"`
	Passwordless bool   `json:"passwordless,omitempty"`
}

// DefaultKDFParams returns secure Argon2id parameters suitable for interactive desktop unlock.
func DefaultKDFParams() KDFParams {
	return KDFParams{
		Algorithm: "argon2id",
		Time:      3,
		MemoryKB:  64 * 1024, // 64 MiB
		Threads:   4,
		KeyLen:    chacha20poly1305.KeySize,
	}
}

// fileEnvelope is the on-disk JSON structure containing the cleartext KDF header and authenticated ciphertext.
type fileEnvelope struct {
	Version    int       `json:"version"`
	KDF        KDFParams `json:"kdf"`
	Salt       string    `json:"salt"`       // base64
	Nonce      string    `json:"nonce"`      // base64 (24-byte XChaCha20-Poly1305 nonce)
	Ciphertext string    `json:"ciphertext"` // base64
}

// StoreOptions configures file paths, KDF parameters, backup retention, auto-lock timeout, and biometric verification.
type StoreOptions struct {
	FilePath        string
	MaxBackups      int
	AutoLockTimeout time.Duration
	KDF             KDFParams
	OnAutoLock      func()
	Verifier        BiometricVerifier
}

// Store implements core.SecretStore using Argon2id + XChaCha20-Poly1305 (ADR-0007, F-03).
type Store struct {
	mu              sync.Mutex
	filePath        string
	maxBackups      int
	autoLockTimeout time.Duration
	kdf             KDFParams
	onAutoLock      func()
	verifier        BiometricVerifier

	locked     bool
	masterKey  []byte
	salt       []byte
	payload    core.VaultPayload
	lockTimer  *time.Timer

	// Ephemeral in-memory key wrapping for Windows Hello / Security Key Quick Unlock after auto-lock (Spec Section 6: never the sole protection on disk).
	quickWrapKey   []byte
	quickWrappedMK []byte
}

// Ensure Store satisfies core.SecretStore at compile time.
var _ core.SecretStore = (*Store)(nil)

// NewStore creates a new encrypted Vault Store starting in the locked state (F-03).
func NewStore(opts StoreOptions) *Store {
	maxBackups := opts.MaxBackups
	if maxBackups <= 0 {
		maxBackups = defaultMaxBackups
	}
	kdf := opts.KDF
	if kdf.Time == 0 || kdf.MemoryKB == 0 || kdf.Threads == 0 || kdf.KeyLen == 0 {
		kdf = DefaultKDFParams()
	}
	verifier := opts.Verifier
	if verifier == nil {
		verifier = DefaultBiometricVerifier
	}
	return &Store{
		filePath:        opts.FilePath,
		maxBackups:      maxBackups,
		autoLockTimeout: opts.AutoLockTimeout,
		kdf:             kdf,
		onAutoLock:      opts.OnAutoLock,
		verifier:        verifier,
		locked:          true,
	}
}

// IsInitialized reports whether a vault file already exists on disk.
func (s *Store) IsInitialized() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := os.Stat(s.filePath)
	return err == nil
}

// IsPasswordless reports whether the existing vault file was initialized with an empty master password.
func (s *Store) IsPasswordless() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	rawBytes, err := os.ReadFile(s.filePath)
	if err != nil {
		return false
	}
	var env fileEnvelope
	if err := json.Unmarshal(rawBytes, &env); err != nil {
		return false
	}
	return env.KDF.Passwordless
}

// HasQuickUnlock reports whether Windows Hello / Security Key quick-unlock is armed for this session.
func (s *Store) HasQuickUnlock() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.quickWrapKey) == chacha20poly1305.KeySize && len(s.quickWrappedMK) > 0
}

// Initialize creates a brand-new encrypted vault file on disk.
// Passing an empty masterPassword initializes the vault in passwordless mode (can be set later via ChangePassword).
func (s *Store) Initialize(_ context.Context, masterPassword string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := os.Stat(s.filePath); err == nil {
		return errors.New("vault is already initialized")
	}

	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		return fmt.Errorf("generate salt: %w", err)
	}

	kdf := s.kdf
	kdf.Passwordless = (masterPassword == "")

	key := deriveKey(masterPassword, salt, kdf)
	initialPayload := core.VaultPayload{
		SchemaVersion: currentSchemaVersion,
		Hosts:         []core.HostRecord{},
		Groups:        []core.GroupRecord{},
		Identities:    []core.IdentityRecord{},
		Keys:          []core.SshKeyRecord{},
	}

	if err := s.writeEncryptedLocked(key, salt, kdf, initialPayload); err != nil {
		zeroBytes(key)
		return err
	}

	s.kdf = kdf
	s.replaceKeyLocked(key)
	s.salt = salt
	s.payload = initialPayload
	s.locked = false
	s.resetAutoLockTimerLocked()
	return nil
}

// Unlock derives the master key via Argon2id and decrypts the vault file (or initializes it if not yet present).
func (s *Store) Unlock(ctx context.Context, masterPassword string) error {
	s.mu.Lock()
	_, statErr := os.Stat(s.filePath)
	s.mu.Unlock()

	if errors.Is(statErr, os.ErrNotExist) {
		return s.Initialize(ctx, masterPassword)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	return s.unlockFromDiskWithKeyFuncLocked(ctx, func(salt []byte, kdf KDFParams) ([]byte, error) {
		if !kdf.Passwordless && masterPassword == "" {
			return nil, core.ErrVaultInvalidAuth
		}
		return deriveKey(masterPassword, salt, kdf), nil
	})
}

func (s *Store) unlockFromDiskWithKeyFuncLocked(ctx context.Context, keyFn func(salt []byte, kdf KDFParams) ([]byte, error)) error {
	rawBytes, err := os.ReadFile(s.filePath)
	if err != nil {
		return fmt.Errorf("read vault file: %w", err)
	}

	var env fileEnvelope
	if err := json.Unmarshal(rawBytes, &env); err != nil {
		return fmt.Errorf("%w: invalid json envelope", core.ErrVaultCorrupted)
	}
	if env.Version != currentFormatVersion || env.KDF.Algorithm != "argon2id" || env.KDF.KeyLen != chacha20poly1305.KeySize {
		return fmt.Errorf("%w: unsupported header version or kdf", core.ErrVaultCorrupted)
	}

	salt, err := base64.StdEncoding.DecodeString(env.Salt)
	if err != nil || len(salt) != saltSize {
		return fmt.Errorf("%w: invalid salt", core.ErrVaultCorrupted)
	}
	nonce, err := base64.StdEncoding.DecodeString(env.Nonce)
	if err != nil || len(nonce) != chacha20poly1305.NonceSizeX {
		return fmt.Errorf("%w: invalid nonce", core.ErrVaultCorrupted)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil {
		return fmt.Errorf("%w: invalid ciphertext encoding", core.ErrVaultCorrupted)
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	key, err := keyFn(salt, env.KDF)
	if err != nil {
		return err
	}

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		zeroBytes(key)
		return err
	}

	aad, err := headerAAD(env.Version, env.KDF, env.Salt)
	if err != nil {
		zeroBytes(key)
		return err
	}

	plaintext, err := aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		zeroBytes(key)
		return core.ErrVaultInvalidAuth
	}
	defer zeroBytes(plaintext)

	var payload core.VaultPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		zeroBytes(key)
		return fmt.Errorf("%w: invalid payload json", core.ErrVaultCorrupted)
	}

	s.kdf = env.KDF
	s.replaceKeyLocked(key)
	s.salt = salt
	s.payload = ensureNonNilSlices(payload)
	s.locked = false
	s.resetAutoLockTimerLocked()
	return nil
}

// ChangePassword verifies currentPassword, generates a fresh salt, re-derives the Argon2id key with newPassword
// (which may also be set on a previously passwordless vault), and atomically re-encrypts the vault file (F-03).
func (s *Store) ChangePassword(ctx context.Context, currentPassword, newPassword string) error {
	if err := s.Unlock(ctx, currentPassword); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	newSalt := make([]byte, saltSize)
	if _, err := rand.Read(newSalt); err != nil {
		return fmt.Errorf("generate new salt: %w", err)
	}

	newKDF := s.kdf
	newKDF.Passwordless = (newPassword == "")
	newKey := deriveKey(newPassword, newSalt, newKDF)

	if err := s.writeEncryptedLocked(newKey, newSalt, newKDF, s.payload); err != nil {
		zeroBytes(newKey)
		return err
	}

	s.kdf = newKDF
	s.salt = newSalt
	s.replaceKeyLocked(newKey)
	// Clear any cached quick-unlock wrap key so it must be re-armed for the new key
	zeroBytes(s.quickWrapKey)
	s.quickWrapKey = nil
	s.quickWrappedMK = nil
	s.resetAutoLockTimerLocked()
	return nil
}

// EnableQuickUnlock wraps the active master key in memory with an ephemeral XChaCha20-Poly1305 key
// gated by Windows Hello / FIDO2 verification so the user can re-unlock after auto-lock (F-03).
func (s *Store) EnableQuickUnlock() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.locked || len(s.masterKey) != chacha20poly1305.KeySize {
		return core.ErrVaultLocked
	}

	wrapKey := make([]byte, chacha20poly1305.KeySize)
	if _, err := rand.Read(wrapKey); err != nil {
		return err
	}
	aead, err := chacha20poly1305.NewX(wrapKey)
	if err != nil {
		zeroBytes(wrapKey)
		return err
	}
	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(nonce); err != nil {
		zeroBytes(wrapKey)
		return err
	}

	wrapped := aead.Seal(nonce, nonce, s.masterKey, nil)
	zeroBytes(s.quickWrapKey)
	s.quickWrapKey = wrapKey
	s.quickWrappedMK = wrapped
	return nil
}

// UnlockWithQuickUnlock prompts Windows Hello / FIDO2 security key verification and unwraps the session master key.
func (s *Store) UnlockWithQuickUnlock(ctx context.Context) error {
	s.mu.Lock()
	hasQuick := len(s.quickWrapKey) == chacha20poly1305.KeySize && len(s.quickWrappedMK) > chacha20poly1305.NonceSizeX
	verifier := s.verifier
	s.mu.Unlock()

	if !hasQuick {
		return errors.New("quick unlock is not enabled for this session; unlock with master password first")
	}

	if err := verifier(ctx, "Verify your identity to unlock the DoubleAgent Vault"); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.quickWrapKey) != chacha20poly1305.KeySize || len(s.quickWrappedMK) <= chacha20poly1305.NonceSizeX {
		return errors.New("quick unlock state expired")
	}

	aead, err := chacha20poly1305.NewX(s.quickWrapKey)
	if err != nil {
		return err
	}
	nonce := s.quickWrappedMK[:chacha20poly1305.NonceSizeX]
	ct := s.quickWrappedMK[chacha20poly1305.NonceSizeX:]
	unwrappedKey, err := aead.Open(nil, nonce, ct, nil)
	if err != nil {
		return core.ErrVaultInvalidAuth
	}

	return s.unlockFromDiskWithKeyFuncLocked(ctx, func(_ []byte, _ KDFParams) ([]byte, error) {
		return unwrappedKey, nil
	})
}

// ResetVault archives any existing vault file to a timestamped .reset.bak file and locks/clears memory
// so the user can initialize a fresh vault if they forgot their master password.
func (s *Store) ResetVault() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.lockInternalLocked()
	zeroBytes(s.quickWrapKey)
	s.quickWrapKey = nil
	s.quickWrappedMK = nil

	if _, err := os.Stat(s.filePath); err == nil {
		backupPath := fmt.Sprintf("%s.reset.%d.bak", s.filePath, time.Now().UTC().Unix())
		if err := os.Rename(s.filePath, backupPath); err != nil {
			return fmt.Errorf("archive old vault during reset: %w", err)
		}
	}
	return nil
}

// Lock wipes the master key and decrypted payload from memory and marks the vault locked (F-03).
func (s *Store) Lock() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lockInternalLocked()
	return nil
}

func (s *Store) lockInternalLocked() {
	if s.lockTimer != nil {
		s.lockTimer.Stop()
		s.lockTimer = nil
	}
	zeroBytes(s.masterKey)
	s.masterKey = nil
	s.payload = core.VaultPayload{}
	s.locked = true
}

// IsLocked reports whether the vault is currently locked.
func (s *Store) IsLocked() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.locked
}

// Touch resets the inactivity auto-lock timer when the user interacts with the vault (F-03).
func (s *Store) Touch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.locked {
		s.resetAutoLockTimerLocked()
	}
}

// GetPayload returns a deep copy of the decrypted vault payload if unlocked.
func (s *Store) GetPayload() (core.VaultPayload, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.locked {
		return core.VaultPayload{}, core.ErrVaultLocked
	}
	s.resetAutoLockTimerLocked()
	return clonePayload(s.payload), nil
}

// SavePayload encrypts and atomically writes the updated payload to disk, rotating backups (Spec Section 8, F-03).
func (s *Store) SavePayload(ctx context.Context, payload core.VaultPayload) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.locked || len(s.masterKey) == 0 {
		return core.ErrVaultLocked
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	normalized := ensureNonNilSlices(payload)
	if normalized.SchemaVersion == 0 {
		normalized.SchemaVersion = currentSchemaVersion
	}

	if err := s.writeEncryptedLocked(s.masterKey, s.salt, s.kdf, normalized); err != nil {
		return err
	}
	s.payload = clonePayload(normalized)
	s.resetAutoLockTimerLocked()
	return nil
}

func (s *Store) writeEncryptedLocked(key, salt []byte, kdf KDFParams, payload core.VaultPayload) error {
	plaintext, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal vault payload: %w", err)
	}
	defer zeroBytes(plaintext)

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return err
	}

	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(nonce); err != nil {
		return fmt.Errorf("generate nonce: %w", err)
	}

	saltB64 := base64.StdEncoding.EncodeToString(salt)
	aad, err := headerAAD(currentFormatVersion, kdf, saltB64)
	if err != nil {
		return err
	}

	ciphertext := aead.Seal(nil, nonce, plaintext, aad)
	env := fileEnvelope{
		Version:    currentFormatVersion,
		KDF:        kdf,
		Salt:       saltB64,
		Nonce:      base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
	}

	encoded, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal vault envelope: %w", err)
	}

	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create vault directory: %w", err)
	}

	// Rotate backups if an existing vault file is present on disk (Spec Section 8: last N versions).
	if _, err := os.Stat(s.filePath); err == nil && s.maxBackups > 0 {
		if err := rotateBackups(s.filePath, s.maxBackups); err != nil {
			return fmt.Errorf("rotate vault backups: %w", err)
		}
	}

	// Atomic write: write to temporary file in the same directory, sync, then rename.
	tmpPath := s.filePath + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open temp vault file: %w", err)
	}
	if _, err := f.Write(encoded); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("write temp vault file: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("sync temp vault file: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close temp vault file: %w", err)
	}

	if err := os.Rename(tmpPath, s.filePath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp vault file: %w", err)
	}
	return nil
}

func rotateBackups(filePath string, maxBackups int) error {
	for i := maxBackups; i >= 1; i-- {
		src := fmt.Sprintf("%s.bak.%d", filePath, i-1)
		if i == 1 {
			src = filePath
		}
		dst := fmt.Sprintf("%s.bak.%d", filePath, i)
		if _, err := os.Stat(src); err == nil {
			raw, err := os.ReadFile(src)
			if err != nil {
				return err
			}
			if err := os.WriteFile(dst, raw, 0o600); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) resetAutoLockTimerLocked() {
	if s.lockTimer != nil {
		s.lockTimer.Stop()
		s.lockTimer = nil
	}
	if s.autoLockTimeout <= 0 || s.locked {
		return
	}
	s.lockTimer = time.AfterFunc(s.autoLockTimeout, func() {
		s.mu.Lock()
		wasUnlocked := !s.locked
		s.lockInternalLocked()
		cb := s.onAutoLock
		s.mu.Unlock()
		if wasUnlocked && cb != nil {
			cb()
		}
	})
}

func (s *Store) replaceKeyLocked(newKey []byte) {
	zeroBytes(s.masterKey)
	s.masterKey = newKey
}

func deriveKey(password string, salt []byte, kdf KDFParams) []byte {
	pwBytes := []byte(password)
	defer zeroBytes(pwBytes)
	return argon2.IDKey(pwBytes, salt, kdf.Time, kdf.MemoryKB, kdf.Threads, kdf.KeyLen)
}

func headerAAD(version int, kdf KDFParams, saltB64 string) ([]byte, error) {
	type aadHeader struct {
		Version int       `json:"version"`
		KDF     KDFParams `json:"kdf"`
		Salt    string    `json:"salt"`
	}
	return json.Marshal(aadHeader{
		Version: version,
		KDF:     kdf,
		Salt:    saltB64,
	})
}

func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

func ensureNonNilSlices(p core.VaultPayload) core.VaultPayload {
	if p.Hosts == nil {
		p.Hosts = []core.HostRecord{}
	}
	if p.Groups == nil {
		p.Groups = []core.GroupRecord{}
	}
	if p.Identities == nil {
		p.Identities = []core.IdentityRecord{}
	}
	if p.Keys == nil {
		p.Keys = []core.SshKeyRecord{}
	}
	return p
}

func clonePayload(p core.VaultPayload) core.VaultPayload {
	raw, _ := json.Marshal(p)
	var out core.VaultPayload
	_ = json.Unmarshal(raw, &out)
	return ensureNonNilSlices(out)
}
