# ADR-0007: Vault Cryptography with Argon2id + XChaCha20-Poly1305 behind `SecretStore`

- **Status:** Accepted (Closed by [Spike S3](../spikes/S3-vault-crypto.md))
- **Date:** 2026-11-04

## Context

DoubleAgent stores sensitive data (hosts, credentials, private keys, TOTP seeds, snippets, notes) locally on disk and optionally syncs the vault file across devices. The vault must resist offline brute-force attacks and never expose the master encryption key to the WebView frontend.

## Decision

1. Use `golang.org/x/crypto/argon2` (`IDKey`, Argon2id) for key derivation from the master password and a 16-byte random salt.
2. Use `golang.org/x/crypto/chacha20poly1305` (`NewX`, XChaCha20-Poly1305) for authenticated encryption of the JSON vault payload, binding the versioned KDF header as Additional Authenticated Data (AAD).
3. Perform atomic file writes (`.tmp` + `Sync` + `os.Rename`) and maintain rolling backups (`.bak.1`..`.bak.N`).
4. Encapsulate all vault operations behind the `SecretStore` interface in `backend/core`, implemented in `backend/vault`.
5. Keep the derived master key strictly inside the Go process memory, zeroing it on `Lock()` or inactivity auto-lock timeout (`F-03`).

## Consequences

- No custom cryptography; relies strictly on audited Go `x/crypto` primitives.
- Safe for file-based synchronization since the file on disk is always authenticated ciphertext.
