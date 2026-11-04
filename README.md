# DoubleAgent

DoubleAgent is a modern, lean, cross-platform (Windows + Linux) native **SSH client** built with **Wails v2** (Go backend) and **React + TypeScript + xterm.js** (frontend in the system WebView).

- **Operating Manual**: [AGENTS.md](./AGENTS.md)
- **Canonical Specification**: [docs/SPEC.md](./docs/SPEC.md)
- **Current Project State**: [docs/tech/STATE.md](./docs/tech/STATE.md)
- **Technical Documentation**: [docs/tech/README.md](./docs/tech/README.md)
- **User Handbook**: [docs/handbook/README.md](./docs/handbook/README.md)
- **Architecture Decision Records**: [docs/adr/](./docs/adr/)

## Repository Layout

```text
.
├── main.go                 # Wails application entrypoint & embedded frontend assets
├── app.go                  # Bound Go application struct (minimal frontend-facing surface)
├── wails.json              # Wails v2 project configuration
├── backend/
│   ├── core/               # Domain models & strict boundary interfaces (SshTransport, TerminalEngine, SecretStore)
│   ├── ssh/                # SSH transport implementation (golang.org/x/crypto/ssh + pkg/sftp)
│   ├── pty/                # Local PTY implementation (ConPTY on Windows, creack/pty on Unix)
│   ├── vault/              # Encrypted vault implementation (Argon2id + XChaCha20-Poly1305)
│   └── data/               # Non-secret settings, workspace state, optional pure-Go SQLite history
├── frontend/               # React + TypeScript + Vite + xterm.js UI
├── build/                  # Packaging configuration and compiled standalone binaries (build/bin/)
└── docs/
    ├── SPEC.md             # Canonical Core Specification
    ├── adr/                # Architecture Decision Records
    ├── handbook/           # User-facing documentation
    ├── spikes/             # Technical spike reports
    └── tech/               # Developer & architectural documentation (including STATE.md)
```

Dependencies point **downwards only**:
- `frontend` → explicitly bound Go methods on `App`
- `backend/{ssh,pty,vault,data}` → `backend/core` (the interfaces)
- `backend/core` imports no external SSH, PTY, or crypto packages and is unit-testable in isolation.

## Commands

```bash
wails dev                     # Renderer + native app window with hot reload
wails build                   # Build standalone binary → build/bin/
go test ./...                 # Run backend unit tests
go vet ./... && golangci-lint run
cd frontend && npm run test   # Run frontend unit tests (Vitest)
cd frontend && npm run build  # Typecheck and bundle frontend assets
```

