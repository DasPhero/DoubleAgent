# ADR-0006: SSH Transport on `golang.org/x/crypto/ssh` behind `SshTransport`

- **Status:** Accepted (Spike S2 will validate implementation details)
- **Date:** 2026-11-04

## Context

DoubleAgent requires SSH connectivity supporting password authentication, public-key authentication (Ed25519, RSA), keyboard-interactive (2FA/TOTP), SSH agent / Pageant integration, strict `known_hosts` verification, port forwarding (`-L`, `-R`, `-D`), `ProxyJump` chains, and SFTP file transfers.

## Decision

1. Use `golang.org/x/crypto/ssh` and `github.com/pkg/sftp` in the Go backend (`backend/ssh`).
2. Encapsulate all SSH operations behind the `SshTransport` interface defined in `backend/core`.
3. No code outside `backend/ssh` may import `golang.org/x/crypto/ssh` or `github.com/pkg/sftp` directly.

## Consequences

- Pure Go compilation with zero CGo dependencies.
- `backend/core` remains completely independent of transport libraries and can be tested with mock implementations.

