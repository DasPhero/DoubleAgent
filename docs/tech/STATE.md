# Project State (`STATE.md`)

- **Current Milestone:** `S1` — Terminal (`xterm.js`) bound to the SSH session (COMPLETED)
- **Next Milestone:** `S3` — Vault cryptography (`argon2` + `XChaCha20-Poly1305`) behind `SecretStore` (closes `ADR-0007`)
- **Stage:** `2-flagship` (Gate `S1` closed; ready to switch to `1-fast` for `S3`)

## What Works
- **`M0-0` Walking Skeleton**: Completed (`65d458d`).
- **`S2` SSH Transport**: Completed (`fece6eb`).
- **`S1` Terminal (`xterm.js`) Bound to SSH Session (`app.go`, `frontend/src/components/TerminalView.tsx`, `frontend/src/App.tsx`)**:
  - Wired `App.ConnectSSH`, `App.ResolveHostKeyPrompt`, `App.WriteTerminal`, `App.ResizeTerminal`, and `App.DisconnectSession` to `core.SshTransport`.
  - Sanitized remote PTY output via `StripOSC52Sequences` before emitting `terminal:data` events (`F-07`, Spec Section 6).
  - Built `TerminalView.tsx` using `@xterm/xterm` (`FitAddon`, `SearchAddon`, `Unicode11Addon`) with 10,000-line scrollback (`F-11`) and `term.write()` only (zero `innerHTML`).
  - Added Quick Connect bar and interactive `Verify Unknown Host Key (F-06)` modal displaying the `SHA256` fingerprint in `App.tsx`.
  - Documented findings in [`docs/spikes/S1-terminal-xterm.md`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/spikes/S1-terminal-xterm.md).

## In Progress
- None (`S1` gate closed).

## Next
- **`S3`**: Vault cryptography (`argon2` + `XChaCha20-Poly1305`) behind `SecretStore` (closes `ADR-0007`), completing the M0 foundation.
