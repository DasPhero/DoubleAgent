# Spike S1: Terminal (`xterm.js`) Bound to the SSH Session

- **Status:** Completed
- **Related Features:** `F-06` (Host-Key TOFU Modal), `F-07` (xterm.js Truecolor, Resize, 50-MB Output Fluidity), `F-11` (10,000-line Scrollback & Search Addon)

## Objective

Bind `xterm.js` in the React frontend to an active `core.SshTransport` remote PTY shell session in the Go backend via Wails bindings and events, ensuring:
1. Terminal output is never interpreted as HTML (`term.write()` only — Golden Rule 2).
2. Window resize in `xterm.js` (`FitAddon`) propagates to the remote SSH PTY (`ResizeTerminal` → `SshTransport.ResizeShell`).
3. High-throughput output is streamed in 32 KB chunks and sanitized of dangerous OSC 52 clipboard escape sequences (`F-07`, Spec Section 6).
4. First-seen host keys trigger an interactive SHA256 fingerprint confirmation prompt (`F-06`).

## Findings & Implementation (`app.go`, `frontend/src/components/TerminalView.tsx`, `frontend/src/App.tsx`)

1. **Bound Method & Event Architecture (`app.go`):**
   - `App.ConnectSSH` dials via `core.SshTransport`, opens an `xterm-256color` PTY shell, and spawns `streamReaderLoop` goroutines for `Stdout` and `Stderr`.
   - `App.WriteTerminal` writes user input from `term.onData` directly to the remote PTY `Stdin`.
   - `App.ResizeTerminal` forwards `term.onResize` dimensions to `SshTransport.ResizeShell`.
   - `App.ResolveHostKeyPrompt` unblocks the synchronous `OnFirstSeenKey` handshake callback after the user inspects the `SHA256` fingerprint in the UI modal (`ssh:hostkey-prompt` event).
2. **Escape Sequence Sanitization (`StripOSC52Sequences`):**
   - Remote output chunks pass through `StripOSC52Sequences` before `terminal:data` emission, stripping any `\x1b]52;...(\x07|\x1b\\)` clipboard manipulation sequences per Spec Section 6.
3. **Frontend Terminal (`TerminalView.tsx`):**
   - Configures `xterm.js` with 10,000-line scrollback (`F-11`), `FitAddon`, `SearchAddon`, and `Unicode11Addon`.
   - Writes remote output exclusively via `term.write(chunk)` (never `innerHTML`).
