# Spike S2: SSH Transport on `golang.org/x/crypto/ssh` behind `SshTransport`

- **Status:** Completed
- **Closes:** [ADR-0006](../adr/ADR-0006-ssh-transport.md)
- **Related Features:** `F-01` (Host Connect), `F-04` (Key Auth), `F-06` (Known Hosts SHA256 TOFU & MITM Block), `F-07` (Remote PTY Shell & Resize), `F-20` (Keyboard-Interactive 2FA)

## Objective

Validate that `golang.org/x/crypto/ssh` cleanly supports all required MVP authentication methods, strict host-key verification (`SHA256:...` fingerprint, TOFU callback, hard block on key change), modern cryptographic algorithm defaults, and interactive PTY shell streaming + window resize behind `core.SshTransport`.

## Findings & Implementation (`backend/ssh/transport.go`)

1. **Authentication Methods (`TestS2_PasswordAuthAndKnownHostsTOFU_F01_F06`, `TestS2_PrivateKeyAuthEd25519AndRSA_F04`, `TestS2_KeyboardInteractive2FA_F20`):**
   - Password (`ssh.Password`) works out of the box.
   - Private Key (`ssh.PublicKeys`) supports both Ed25519 and RSA keys, including passphrase-protected PEM blocks via `ssh.ParsePrivateKeyWithPassphrase`.
   - Keyboard-Interactive 2FA (`ssh.KeyboardInteractive`) cleanly bridges challenge prompts to `core.KeyboardInteractiveResponder`.
2. **Host-Key Verification (`F-06` — `TestS2_ChangedHostKeyHardBlocksConnection_F06`):**
   - `KnownHostsStore.VerifyOrTrust` computes `ssh.FingerprintSHA256(key)`.
   - On first connection to a `[host]:port`, `OnFirstSeenKey` (TOFU callback) receives the `core.HostKeyInfo` with `SHA256:...` fingerprint.
   - On subsequent connections, if the fingerprint or key type differs from the stored record, `VerifyOrTrust` returns `core.ErrHostKeyMismatch` immediately without invoking `OnFirstSeenKey` (hard block against MITM).
3. **Modern Algorithm Hardening (Spec Section 6):**
   - By default (`AllowLegacyAlgs: false`), `Transport.Connect` restricts `ssh.Config` to Curve25519 / ECDH P-256/384/521 key exchanges, AEAD/CTR ciphers (`chacha20-poly1305@openssh.com`, `aes256-gcm@openssh.com`, `aes128-gcm@openssh.com`), and ETM/SHA-2 MACs.
4. **Interactive PTY Shell & Resize (`F-07` — `TestS2_InteractivePtyShellAndResize_F07`):**
   - `OpenShell` requests an `xterm-256color` PTY and exposes `Stdin`, `Stdout`, and `Stderr` streams via `core.SshShellStreams`.
   - `ResizeShell` sends `WindowChange(rows, cols)` over the active SSH session channel.
5. **Custom Dialer Abstraction (`DialFunc`):**
   - `NewTransportWithDialer` abstracts raw connection establishment so `ProxyJump` chains (`F-14`/`F-25`) and in-memory buffered pipe tests run identically without requiring external network sockets.
