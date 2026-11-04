package vault_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"doubleagent/backend/core"
	"doubleagent/backend/vault"
)

func fastTestKDF() vault.KDFParams {
	return vault.KDFParams{
		Algorithm: "argon2id",
		Time:      1,
		MemoryKB:  8 * 1024, // 8 MiB for fast unit tests
		Threads:   1,
		KeyLen:    32,
	}
}

func TestS3_VaultEncryptDecryptAndWrongPassword_F03(t *testing.T) {
	tmpDir := t.TempDir()
	vaultPath := filepath.Join(tmpDir, "doubleagent.vault")

	store := vault.NewStore(vault.StoreOptions{
		FilePath:   vaultPath,
		MaxBackups: 2,
		KDF:        fastTestKDF(),
	})

	if !store.IsLocked() {
		t.Fatal("expected vault to start locked (F-03)")
	}

	// 1. First unlock initializes the encrypted vault file
	if err := store.Unlock(context.Background(), "master-pass-123!"); err != nil {
		t.Fatalf("Unlock (init) failed: %v", err)
	}
	if store.IsLocked() {
		t.Fatal("expected vault to be unlocked after Unlock")
	}

	// 2. Save a host and identity inside the encrypted vault
	err := store.SavePayload(context.Background(), core.VaultPayload{
		SchemaVersion: 1,
		Hosts: []core.HostRecord{
			{
				ID:      "host-1",
				Label:   "Production Bastion",
				Address: "10.20.30.40",
				Port:    2222,
			},
		},
		Identities: []core.IdentityRecord{
			{
				ID:         "id-1",
				Label:      "Admin",
				Username:   "admin",
				AuthMethod: core.AuthPassword,
				Password:   "top-secret-password-999",
			},
		},
	})
	if err != nil {
		t.Fatalf("SavePayload failed: %v", err)
	}

	// Verify that neither host address nor secret password appears in cleartext on disk
	rawDisk, err := os.ReadFile(vaultPath)
	if err != nil {
		t.Fatalf("read vault file failed: %v", err)
	}
	if strings.Contains(string(rawDisk), "top-secret-password-999") || strings.Contains(string(rawDisk), "10.20.30.40") {
		t.Fatal("cleartext secret or host address leaked into vault file on disk (F-03)")
	}

	// 3. Lock the vault and verify payload access is denied
	if err := store.Lock(); err != nil {
		t.Fatalf("Lock failed: %v", err)
	}
	if _, err := store.GetPayload(); !errors.Is(err, core.ErrVaultLocked) {
		t.Fatalf("expected ErrVaultLocked when locked, got %v", err)
	}

	// 4. Unlocking with wrong password must fail with ErrVaultInvalidAuth
	if err := store.Unlock(context.Background(), "wrong-password"); !errors.Is(err, core.ErrVaultInvalidAuth) {
		t.Fatalf("expected ErrVaultInvalidAuth on wrong password, got %v", err)
	}

	// 5. Unlocking with correct password restores the saved payload
	if err := store.Unlock(context.Background(), "master-pass-123!"); err != nil {
		t.Fatalf("re-unlock failed: %v", err)
	}
	loaded, err := store.GetPayload()
	if err != nil {
		t.Fatalf("GetPayload failed: %v", err)
	}
	if len(loaded.Hosts) != 1 || loaded.Hosts[0].Address != "10.20.30.40" {
		t.Fatalf("unexpected decrypted hosts: %+v", loaded.Hosts)
	}
	if len(loaded.Identities) != 1 || loaded.Identities[0].Password != "top-secret-password-999" {
		t.Fatalf("unexpected decrypted identities: %+v", loaded.Identities)
	}
}

func TestS3_VaultTamperDetectionAndBackups_F03(t *testing.T) {
	tmpDir := t.TempDir()
	vaultPath := filepath.Join(tmpDir, "doubleagent.vault")

	store := vault.NewStore(vault.StoreOptions{
		FilePath:   vaultPath,
		MaxBackups: 2,
		KDF:        fastTestKDF(),
	})

	if err := store.Unlock(context.Background(), "pass-abc"); err != nil {
		t.Fatalf("init unlock failed: %v", err)
	}

	// Save twice to trigger rolling backups (.bak.1 and .bak.2)
	for i := 0; i < 2; i++ {
		if err := store.SavePayload(context.Background(), core.VaultPayload{SchemaVersion: 1}); err != nil {
			t.Fatalf("SavePayload %d failed: %v", i, err)
		}
	}

	if _, err := os.Stat(vaultPath + ".bak.1"); err != nil {
		t.Fatalf("expected backup .bak.1 to exist: %v", err)
	}
	if _, err := os.Stat(vaultPath + ".bak.2"); err != nil {
		t.Fatalf("expected backup .bak.2 to exist: %v", err)
	}

	_ = store.Lock()

	// Tamper with header parameter on disk (must fail AAD authentication tag verification)
	raw, err := os.ReadFile(vaultPath)
	if err != nil {
		t.Fatalf("read vault: %v", err)
	}
	tampered := strings.Replace(string(raw), `"threads": 1`, `"threads": 2`, 1)
	if err := os.WriteFile(vaultPath, []byte(tampered), 0o600); err != nil {
		t.Fatalf("write tampered vault: %v", err)
	}

	if err := store.Unlock(context.Background(), "pass-abc"); !errors.Is(err, core.ErrVaultInvalidAuth) {
		t.Fatalf("expected ErrVaultInvalidAuth on tampered AAD header, got %v", err)
	}
}

func TestS3_VaultAutoLockTimer_F03(t *testing.T) {
	tmpDir := t.TempDir()
	vaultPath := filepath.Join(tmpDir, "doubleagent.vault")

	lockedNotify := make(chan struct{}, 1)
	store := vault.NewStore(vault.StoreOptions{
		FilePath:        vaultPath,
		AutoLockTimeout: 60 * time.Millisecond,
		KDF:             fastTestKDF(),
		OnAutoLock: func() {
			select {
			case lockedNotify <- struct{}{}:
			default:
			}
		},
	})

	if err := store.Unlock(context.Background(), "auto-lock-pass"); err != nil {
		t.Fatalf("Unlock failed: %v", err)
	}

	select {
	case <-lockedNotify:
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for vault auto-lock callback (F-03)")
	}

	if !store.IsLocked() {
		t.Fatal("expected store.IsLocked() to be true after auto-lock timeout")
	}
}
