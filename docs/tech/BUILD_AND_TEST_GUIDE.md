# DoubleAgent — AI Agent Build, Test & Executable Guide

This guide explains the exact prerequisites, commands, verification gates, and repository pitfalls for building, testing, and producing standalone native executables (`DoubleAgent.exe` on Windows / `DoubleAgent` on Linux).

---

## 1. Architecture & Toolchain Overview

DoubleAgent is a **Wails v2** desktop application ([`ADR-0008`](../adr/ADR-0008-wails-stack.md)):
- **Go backend (`app.go`, `main.go`, `backend/`):** Pure Go (`go 1.26.0` in [`go.mod`](../../go.mod), CI tests with Go `1.22+`). Embeds `frontend/dist` directly via `//go:embed all:frontend/dist` (`main.go`). Zero CGo database drivers.
- **React + TypeScript frontend (`frontend/`):** React 18, TypeScript (`strict: true`), Vite, ESLint, Vitest (`jsdom`), `@xterm/xterm`, `reactflow` ([`frontend/package.json`](../../frontend/package.json)).
- **Packager (`wails` CLI `v2.17.1`):** Configured in [`wails.json`](../../wails.json) (`"outputfilename": "DoubleAgent"`).

### Prerequisites
- **Go** (`go` on `PATH`)
- **Node.js & npm** (Node `22+` recommended, matching [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml))
- **Wails v2 CLI:** `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- **OS WebView dependencies:**
  - **Windows:** WebView2 Runtime (built into Windows 10/11)
  - **Linux:** `sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev` (matching CI; newer distros with WebKit 4.1 use `-tags webkit2_41` if needed)

---

## 2. Step-by-Step Build & Verification Order

Always run checks in this order after making changes so failures surface fast:

### Step 1 — Install Frontend Dependencies *(first time or after `package.json` edits)*
```powershell
npm --prefix frontend ci
# or on Windows outside sandbox when modifying/installing packages:
cd frontend; npm install
```

### Step 2 — Frontend Lint, Unit Tests & Production Build
Run from the repo root (or `cd frontend`):

```powershell
# 1. ESLint (must finish with 0 errors and 0 warnings)
npm --prefix frontend run lint

# 2. Vitest suite (must use --run so it exits instead of watching)
npm --prefix frontend run test -- --run

# 3. TypeScript strict typecheck + Vite bundle -> frontend/dist
npm --prefix frontend run build
```

> **Note for Windows / Vitest:** Always run Vitest via `npm --prefix frontend run test -- --run` (not bare `npx vitest` from repo root without `--prefix` / working dir) so Vite resolves `frontend/vite.config.ts` and loads the `jsdom` environment properly.

### Step 3 — Go Static Analysis & Full Test Suite
```powershell
# Vet all backend packages and root Wails App package
go vet ./backend/... .

# Run all Go unit & integration tests cleanly without test cache
go test -count=1 ./backend/... .
```

**Important architectural test enforced automatically:**
- `TestM0_0_CoreBoundaryNoForbiddenImports` (`backend/core`) fails if `backend/core` imports any SSH (`golang.org/x/crypto/ssh`), PTY (`creack/pty`), or crypto (`crypto/*`, `golang.org/x/crypto`) package. Keep `backend/core` pure Go domain logic + interfaces only.

### Step 4 — Build the Standalone Executable (`wails build`)
Run from the repository root:

```powershell
wails build
```

**What `wails build` executes automatically:**
1. Inspects exported methods and structs on `App` (`app.go`, `backend/core`) and regenerates TypeScript/JS Wails bindings in `frontend/wailsjs/`.
2. Runs `npm install` + `npm run build` (`tsc --noEmit && vite build`) inside `frontend/`, generating `frontend/dist`.
3. Compiles the Go binary embedding `frontend/dist` and writes the standalone executable to:
   - **Windows:** `build/bin/DoubleAgent.exe`
   - **Linux:** `build/bin/DoubleAgent`

**Live development (hot-reload WebView window):**
```powershell
wails dev
```

---

## 3. Repository-Specific Pitfalls for AI Agents

1. **PowerShell vs. Bash Command Chaining (Windows):**
   - Windows sessions run PowerShell (`pwsh` / Windows PowerShell). Use `;` instead of `&&`, or run commands separately.
2. **Never Leak `t.TempDir()` Paths Into Real User Config:**
   - Tests touching vault sync or external template JSON stores (`SetPayloadTemplatesPath`, `SetSnippetChainsPath`, `SetSnippetsPath`, `SetManagedFilePath`) must always inject a `vault.NewStore` inside `t.TempDir()` and avoid mutating real `%APPDATA%\DoubleAgent\` files.
   - `App` sets `skipGlobalVaultPointer = true` automatically when a `vaultStore` is injected into `NewAppWithDependencies`, preventing `RelocateVaultFile` tests from overwriting `%APPDATA%\DoubleAgent\vault_location.txt`.
3. **Large `frontend/src/App.tsx` (>600 KB) Editor Buffer / Diff Hazard:**
   - Because `frontend/src/App.tsx` is over 600 KB (~14.8k+ lines), avoid loading the entire file into context or leaving a diff-preview buffer open in an IDE while building (`... [truncated for diff preview]` can occur if an editor saves a truncated preview buffer).
   - Read only targeted line ranges (`StartLine` / `EndLine`) or apply deterministic Python/scripted patches after locating exact targets with `Select-String`.
4. **Windows Sandbox Rules (when applicable):**
   - Always test `go test` / `npm run test` / `wails build` inside the standard sandbox first. Only use unsandboxed execution when network access (`npm install`, `go install`) or external paths are genuinely required.
5. **No Skipped Assertions & Re-Run After Final Edit:**
   - Every change requires re-running `eslint`, `vitest`, `go vet`, `go test`, and `wails build` **after the final edit** before claiming completion.
   - Update [`docs/tech/STATE.md`](STATE.md) and [`docs/handbook/README.md`](../handbook/README.md) in the same slice whenever user-facing behavior or bound methods change.
