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
	Algorithm string `json:"algorithm"`
	Time      uint32 `json:"time"`
	MemoryKB  uint32 `json:"memoryKb"`
	Threads   uint8  `json:"threads"`
	KeyLen    uint32 `json:"keyLen"`
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

// StoreOptions configures file paths, KDF parameters, backup retention, and auto-lock timeout.
type StoreOptions struct {
	FilePath        string
	MaxBackups      int
	AutoLockTimeout time.Duration
	KDF             KDFParams
	OnAutoLock      func()
}

// Store implements core.SecretStore using Argon2id + XChaCha20-Poly1305 (ADR-0007, F-03).
type Store struct {
	mu              sync.Mutex
	filePath        string
	maxBackups      int
	autoLockTimeout time.Duration
	kdf             KDFParams
	onAutoLock      func()

	locked     bool
	masterKey  []byte
	salt       []byte
	payload    core.VaultPayload
	lockTimer  *time.Timer
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
	return &Store{
		filePath:        opts.FilePath,
		maxBackups:      maxBackups,
		autoLockTimeout: opts.AutoLockTimeout,
		kdf:             kdf,
		onAutoLock:      opts.OnAutoLock,
		locked:          true,
	}
}

// Unlock derives the master key via Argon2id and either decrypts an existing vault file
// or initializes a new encrypted vault file on disk if none exists yet (F-03).
func (s *Store) Unlock(ctx context.Context, masterPassword string) error {
	if masterPassword == "" {
		return errors.New("master password cannot be empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	rawBytes, err := os.ReadFile(s.filePath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("read vault file: %w", err)
		}
		// First-time initialization: generate fresh salt, derive key, and write initial encrypted vault.
		salt := make([]byte, saltSize)
		if _, err := rand.Read(salt); err != nil {
			return fmt.Errorf("generate salt: %w", err)
		}
		key := deriveKey(masterPassword, salt, s.kdf)
		initialPayload := core.VaultPayload{
			SchemaVersion: currentSchemaVersion,
			Hosts:         []core.HostRecord{},
			Groups:        []core.GroupRecord{},
			Identities:    []core.IdentityRecord{},
			Keys:          []core.SshKeyRecord{},
		}
		if err := s.writeEncryptedLocked(key, salt, s.kdf, initialPayload); err != nil {
			zeroBytes(key)
			return err
		}
		s.replaceKeyLocked(key)
		s.salt = salt
		s.payload = initialPayload
		s.locked = false
		s.resetAutoLockTimerLocked()
		return nil
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

	key := deriveKey(masterPassword, salt, env.KDF)
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
