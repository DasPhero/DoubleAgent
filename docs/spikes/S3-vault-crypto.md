# Spike S3: Vault Cryptography (`argon2` + `XChaCha20-Poly1305`) Behind `SecretStore`

- **Status:** Completed
- **Closes:** [ADR-0007](../adr/ADR-0007-vault-crypto.md)
- **Related Features:** `F-03` (Encrypted Vault, Start Locked, Auto-Lock Timer, Atomic Saves & Backups)

## Objective

Verify that `golang.org/x/crypto/argon2` (`IDKey`) and `golang.org/x/crypto/chacha20poly1305` (`NewX`) provide authenticated, tamper-evident local vault storage behind `core.SecretStore`, keeping the master key strictly inside the Go process memory.

## Findings & Implementation (`backend/vault/store.go`)

1. **Key Derivation (`argon2.IDKey`):**
   - Derives a 32-byte encryption key from the master password and a 16-byte cryptographic random salt (`crypto/rand`).
   - Production defaults: `Time=3`, `MemoryKB=65536` (64 MiB), `Threads=4`, `KeyLen=32`.
   - Password bytes are wiped (`zeroBytes`) immediately after key derivation.
2. **Authenticated Encryption (`chacha20poly1305.NewX`):**
   - Uses 24-byte random nonces (`NonceSizeX`) per write operation.
   - Binds the cleartext JSON envelope header (`Version`, `KDFParams`, `Salt`) as **Additional Authenticated Data (AAD)** so any modification to KDF parameters or salt on disk causes `aead.Open` to fail with `core.ErrVaultInvalidAuth` (`TestS3_VaultTamperDetectionAndBackups_F03`).
3. **Atomic Writes & Rolling Backups (Spec Section 8):**
   - Before overwriting an existing vault file, rotates up to `MaxBackups` (default 3) `.bak.1`..`.bak.N` copies.
   - Writes new ciphertext to `<vault>.tmp`, calls `f.Sync()`, closes, and atomically renames over `<vault>`.
4. **Inactivity Auto-Lock & Key Zeroing (`F-03`):**
   - `Store` starts locked (`IsLocked() == true`).
   - `Lock()` and the inactivity timer (`AutoLockTimeout`) zero the `masterKey` byte slice in memory, clear the in-memory `VaultPayload`, and invoke `OnAutoLock` (`vault:locked` event to UI).
