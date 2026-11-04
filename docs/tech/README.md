# DoubleAgent — Technical Documentation

## Architecture Overview

DoubleAgent is structured as a Wails v2 application (see [ADR-0008](../adr/ADR-0008-wails-stack.md)):

1. **Entrypoint (`main.go`, `app.go`)**:
   - Embeds `frontend/dist` into the compiled Go binary.
   - Exposes a minimal, explicitly typed `App` struct to the frontend via Wails bindings.
2. **Core Boundary (`backend/core/`)**:
   - Defines pure domain models and the three core boundary interfaces:
     - `SshTransport` (see [ADR-0006](../adr/ADR-0006-ssh-transport.md))
     - `TerminalEngine`
     - `SecretStore` (see [ADR-0007](../adr/ADR-0007-vault-crypto.md))
   - Imports **zero** external SSH, PTY, or cryptography packages.
3. **Backend Packages (`backend/{ssh,pty,vault,data}`)**:
   - Implement the `backend/core` interfaces.
4. **Frontend (`frontend/`)**:
   - React 18 + TypeScript (`strict: true`) + Vite + Vitest.
   - English-only UI. Never holds secrets or opens raw sockets.

## Bound-Method Surface (`M0-0`)

- `App.HealthCheck() core.AppStatus`: Returns application name, version, and current milestone status for the walking skeleton check.

## How to Run & Test

```bash
# Backend tests & static analysis
go test ./...
go vet ./...

# Frontend tests & build
cd frontend
npm run lint
npm run test
npm run build

# Standalone binary build
wails build
```

