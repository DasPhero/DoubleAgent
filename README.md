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
wails dev                         # Renderer + native app window with hot reload
./scripts/build-all.ps1           # Windows host: verify Windows+Linux Go, test, build Windows + Linux (via Docker/WSL)
./scripts/build-all.sh            # Linux host: verify, test, build Linux + cross-build Windows binary
wails build                       # Single-OS standalone binary → build/bin/
go test ./...                     # Run backend unit tests
go vet ./... && golangci-lint run
cd frontend && npm run test       # Run frontend unit tests (Vitest)
cd frontend && npm run build      # Typecheck and bundle frontend assets
```

### Building for Both Windows & Linux

- **Output binaries** (written to `build/bin/`):
  - Windows (`amd64`): `build/bin/DoubleAgent.exe`
  - Linux (`amd64`): `build/bin/DoubleAgent-linux-amd64` (desktop entry in `build/linux/doubleagent.desktop`)
- **On Linux (Ubuntu 24.04 / Debian 12+ / Kali / Arch):**
  ```bash
  sudo apt-get update && sudo apt-get install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
  ./scripts/build-all.sh
  ./scripts/install-linux.sh        # Installs global `doubleagent` command + app launcher icon (or `--user` for ~/.local/bin)
  ```
  `scripts/build-all.sh` auto-detects `webkit2gtk-4.1` (`-tags webkit2_41`) vs `webkit2gtk-4.0`, builds `DoubleAgent-linux-amd64`, and cross-compiles `DoubleAgent.exe` in one step. After installing, launch from any terminal via `doubleagent` (remove anytime with `./scripts/install-linux.sh --uninstall`).
- **On Windows:**
  ```powershell
  ./scripts/build-all.ps1
  ```
  Always cross-checks `GOOS=linux GOARCH=amd64` Go vet/build, builds `DoubleAgent.exe`, and builds `DoubleAgent-linux-amd64` automatically when **Docker Desktop** (`Dockerfile.linux-build`) or **WSL2** (with GTK3 + WebKit2GTK) is installed. *(Wails v2 Linux GUI binaries link against GTK3/WebKit2GTK via CGo, so a Linux userspace via Docker, WSL2, a Linux host, or GitHub Actions CI is required for linking the Linux binary.)*
- **GitHub Actions CI (`.github/workflows/ci.yml`):** Automatically tests and builds both `DoubleAgent-Windows` and `DoubleAgent-Linux` binaries on every push and pull request.

