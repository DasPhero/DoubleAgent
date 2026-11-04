# Project State (`STATE.md`)

- **Current Milestone:** `M0-0` — Walking Skeleton (COMPLETED)
- **Next Milestone:** `S2` — SSH transport on `golang.org/x/crypto/ssh` behind `SshTransport` (closes `ADR-0006`)
- **Stage:** `2-flagship` (Gate `M0-0` closed; ready to switch to `1-fast` for `S2`)

## What Works
- **Repository & Docs (`M0-0`)**:
  - Git repository initialized with [`.gitignore`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/.gitignore), [`CLAUDE.md`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/CLAUDE.md), [`README.md`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/README.md).
  - Canonical specification placed at [`docs/SPEC.md`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/SPEC.md).
  - Architecture Decision Records: [`ADR-0006`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/adr/ADR-0006-ssh-transport.md), [`ADR-0007`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/adr/ADR-0007-vault-crypto.md), [`ADR-0008`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/adr/ADR-0008-wails-stack.md).
  - User handbook ([`docs/handbook/README.md`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/handbook/README.md)) and technical docs ([`docs/tech/README.md`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/docs/tech/README.md)).
- **Backend & Core Boundaries (`M0-0`)**:
  - Go module (`go.mod`) aligned to Wails `v2.17.1` with committed `go.sum`.
  - Wails entrypoints ([`main.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/main.go), [`app.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/app.go)) with minimal bound surface (`App.HealthCheck()`) and test ([`app_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/app_test.go)).
  - Core interfaces in [`backend/core/interfaces.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/interfaces.go) (`SshTransport`, `TerminalEngine`, `SecretStore`) and automated AST import boundary test ([`backend/core/interfaces_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/interfaces_test.go)).
- **Frontend (`M0-0`)**:
  - React 18 + TypeScript (`strict: true`) + Vite + Vitest + ESLint in [`frontend/`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend) with strict CSP in [`index.html`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/index.html) and zero `innerHTML` usage.
- **Standalone Binary & CI (`M0-0`)**:
  - Standalone Windows executable built and verified at `build/bin/DoubleAgent.exe` via `wails build`.
  - GitHub Actions CI configured at [`.github/workflows/ci.yml`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/.github/workflows/ci.yml) for both `windows-latest` and `ubuntu-latest`.

## In Progress
- None (`M0-0` gate closed).

## Next
- **`S2`**: SSH transport on `golang.org/x/crypto/ssh` behind `SshTransport` (closes `ADR-0006`), including spike report in `docs/spikes/`.
- **`S1`**: Terminal (`xterm.js`) bound to the SSH session.
- **`S3`**: Vault cryptography (`argon2` + `XChaCha20-Poly1305`) behind `SecretStore` (closes `ADR-0007`).
