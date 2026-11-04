# Project State (`STATE.md`)

- **Current Milestone:** `S3` — Vault cryptography (`argon2` + `XChaCha20-Poly1305`) behind `SecretStore` (COMPLETED — All M0 Foundation Milestones Done!)
- **Next Milestone:** `M1-1` (`F-01` Hosts & Groups CRUD with group inheritance in the encrypted Vault)
- **Stage:** `2-flagship`

## What Works
- **`M0-0` Walking Skeleton**: Completed (`65d458d`).
- **`S2` SSH Transport**: Completed (`fece6eb`).
- **`S1` Terminal (`xterm.js`) Bound to SSH Session**: Completed (`c83f85a`).
- **`S3` Vault Cryptography (`backend/vault/store.go`, `backend/vault/store_test.go`, `app.go`, `frontend/src/App.tsx`)**:
  - `Store` implements `core.SecretStore` using Argon2id (`golang.org/x/crypto/argon2`) and XChaCha20-Poly1305 (`golang.org/x/crypto/chacha20poly1305`).
  - Header parameters (`Version`, `KDFParams`, `Salt`) are authenticated via AEAD Additional Authenticated Data (AAD).
  - Atomic file writes (`.tmp` + `Sync` + `Rename`) and rolling backup rotation (`.bak.1`..`.bak.N`).
  - Starts locked (`F-03`), wipes master key bytes from memory on `Lock()` or inactivity auto-lock timeout (`AutoLockTimeout`), and emits `vault:locked` events.
  - Closed [`ADR-0007`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/adr/ADR-0007-vault-crypto.md) and documented findings in [`docs/spikes/S3-vault-crypto.md`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/spikes/S3-vault-crypto.md).

## In Progress
- None (Entire `M0` phase — `M0-0`, `S2`, `S1`, `S3` — is complete).

## Next
- **`M1-1` (`F-01`)**: Hosts and Groups management in the encrypted Vault (Groups inherit `Port`, `User`, `Keepalive`; Host overrides Group; sidebar Host list + one-click connect).
- **`M1-2` (`F-02`)**: Command Palette (`Ctrl+K`) with fuzzy search over hosts/tags and direct `user@host:port` quick connect.
- **`M1-3` (`F-04`, `F-05`, `F-22`)**: Keychain (Ed25519/RSA key generation, OpenSSH & PuTTY `.ppk` import, copy public key), SSH Agent / Pageant integration, and `~/.ssh/config` import.
