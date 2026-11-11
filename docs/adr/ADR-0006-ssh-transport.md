# ADR-0006: SSH Transport on `golang.org/x/crypto/ssh` behind `SshTransport`

- **Status:** Accepted (Closed by [Spike S2](../spikes/S2-ssh-transport.md))
- **Date:** 2026-11-04

## Context

DoubleAgent requires SSH connectivity supporting password authentication, public-key authentication (Ed25519, RSA), keyboard-interactive (2FA/TOTP), SSH agent / Pageant integration, strict `known_hosts` verification, port forwarding (`-L`, `-R`, `-D`), `ProxyJump` chains, and SFTP file transfers.

## Decision

1. Use `golang.org/x/crypto/ssh` (and `github.com/pkg/sftp` when SFTP `F-12` is built) in the Go backend (`backend/ssh`).
2. Encapsulate all SSH operations behind the `SshTransport` interface defined in `backend/core`.
3. Enforce strict `SHA256` host-key verification via `KnownHostsStore` (TOFU on first connection, hard block with `core.ErrHostKeyMismatch` on key change) and modern KEX/Cipher/MAC defaults.
4. Abstract dial establishment via `DialFunc` (`NewTransportWithDialer`) to support `ProxyJump` chains (`F-14`/`F-25`) and deterministic in-memory testing.

## Consequences

- Pure Go compilation with zero CGo dependencies.
- `backend/core` remains completely independent of transport libraries and is verified by `TestM0_0_CoreBoundaryNoForbiddenImports`.

