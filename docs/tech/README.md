# DoubleAgent — Technical Documentation

## Architecture Overview

DoubleAgent is structured as a Wails v2 application (see [ADR-0008](../adr/ADR-0008-wails-stack.md)):

1. **Entrypoint (`main.go`, `app.go`)**:
   - Embeds `frontend/dist` into the compiled Go binary.
   - Exposes a minimal, explicitly typed `App` struct to the frontend via Wails bindings.
2. **Core Boundary (`backend/core/`)**:
   - Defines pure domain models and the three core boundary interfaces:
     - `SshTransport` (see [ADR-0006](../adr/ADR-0006-ssh-transport.md) & [Spike S2](../spikes/S2-ssh-transport.md))
     - `TerminalEngine`
     - `SecretStore` (see [ADR-0007](../adr/ADR-0007-vault-crypto.md))
   - Imports **zero** external SSH, PTY, or cryptography packages (enforced by `TestM0_0_CoreBoundaryNoForbiddenImports`).
3. **SSH Transport (`backend/ssh/`)**:
   - `Transport` implements `core.SshTransport` using `golang.org/x/crypto/ssh`.
   - `KnownHostsStore` enforces `F-06` (`SHA256` fingerprint TOFU via `KnownHostDecisionFunc` and hard block via `core.ErrHostKeyMismatch` when a known key changes).
   - Opens interactive `xterm-256color` PTY shells (`OpenShell`) and dynamic window resizing (`ResizeShell`).
4. **Frontend (`frontend/`)**:
   - React 18 + TypeScript (`strict: true`) + Vite + Vitest + `xterm.js` (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-unicode11`, `@xterm/addon-webgl`).
   - [`TerminalView.tsx`](../../frontend/src/components/TerminalView.tsx) renders terminal output strictly via `term.write()`, never `innerHTML`.

## Bound-Method Surface & Events (`app.go`)

### Bound Methods
- `App.HealthCheck() core.AppStatus`
- `App.ConnectSSH(req core.ConnectRequest) (string, error)`
- `App.ResolveHostKeyPrompt(host string, port uint16, trust bool) error`
- `App.WriteTerminal(sessionID string, data string) error`
- `App.ResizeTerminal(sessionID string, cols uint16, rows uint16) error`
- `App.DisconnectSession(sessionID string) error`

### Backend → Frontend Events
- `ssh:hostkey-prompt` (`core.HostKeyInfo`): Emitted when connecting to an unknown host key (TOFU).
- `terminal:data` (`core.TerminalDataEvent`): Emitted with 32 KB sanitized chunks (`StripOSC52Sequences`) from the remote PTY.
- `terminal:exit` (`core.TerminalExitEvent`): Emitted when the remote shell closes.

## How to Run & Test

```bash
# Backend tests & static analysis
go vet ./backend/... .
go test -v ./backend/... .

# Frontend tests & build
cd frontend
npm run lint
npm run test
npm run build

# Standalone binary build
wails build
```
