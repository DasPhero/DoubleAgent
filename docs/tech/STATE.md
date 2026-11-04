# Project State (`STATE.md`)

- **Current Milestone:** `S2` — SSH transport on `golang.org/x/crypto/ssh` behind `SshTransport` (COMPLETED)
- **Next Milestone:** `S1` — Terminal (`xterm.js`) bound to the SSH session
- **Stage:** `2-flagship` (Gate `S2` closed; ready to switch to `1-fast` for `S1`)

## What Works
- **`M0-0` Walking Skeleton**: Completed (`65d458d`).
- **`S2` SSH Transport (`backend/ssh/transport.go`, `backend/ssh/transport_test.go`)**:
  - `Transport` implements `core.SshTransport` (`Connect`, `OpenShell`, `ResizeShell`, `Disconnect`) on `golang.org/x/crypto/ssh`.
  - Password (`F-01`), Ed25519 & RSA private keys with passphrase (`F-04`), and keyboard-interactive 2FA (`F-20`) tested and passing.
  - `KnownHostsStore` enforces `F-06`: `SHA256` fingerprint on first connection (TOFU) and hard block (`core.ErrHostKeyMismatch`) if a known host key changes.
  - Modern KEX/Cipher/MAC hardening enabled by default.
  - Interactive `xterm-256color` PTY shell streaming and `WindowChange` resize (`F-07`) verified against an embedded SSH server.
  - Closed [`ADR-0006`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/adr/ADR-0006-ssh-transport.md) and documented findings in [`docs/spikes/S2-ssh-transport.md`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/spikes/S2-ssh-transport.md).

## In Progress
- None (`S2` gate closed).

## Next
- **`S1`**: Terminal (`xterm.js`) in the frontend bound to the SSH session via Wails bindings/events (`F-07`).
- **`S3`**: Vault cryptography (`argon2` + `XChaCha20-Poly1305`) behind `SecretStore` (closes `ADR-0007`).
