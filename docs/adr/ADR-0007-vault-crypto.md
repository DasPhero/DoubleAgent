# ADR-0007: Vault Cryptography with Argon2id + XChaCha20-Poly1305 behind `SecretStore`

- **Status:** Accepted (Spike S3 will validate implementation details)
- **Date:** 2026-11-04

## Context

DoubleAgent stores sensitive data (hosts, credentials, private keys, TOTP seeds, snippets, notes) locally on disk and optionally syncs the vault file across devices. The vault must resist offline brute-force attacks and never expose the master encryption key to the WebView frontend.

## Decision

1. Use `golang.org/x/crypto/argon2` (Argon2id) for key derivation from the master password and a random salt.
2. Use `golang.org/x/crypto/chacha20poly1305` (XChaCha20-Poly1305) for authenticated encryption of the JSON vault payload, with versioned headers and atomic file writes (temp file + rename).
3. Encapsulate all vault operations behind the `SecretStore` interface in `backend/core`, implemented in `backend/vault`.
4. Keep the derived master key strictly inside the Go process memory; never serialize or return it to the frontend.

## Consequences

- No custom cryptography; relies strictly on audited Go `x/crypto` primitives.
- Safe for file-based synchronization since the file on disk is always authenticated ciphertext.

