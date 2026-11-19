# AGENTS.md — operating manual for the coding agent

This file governs how DoubleAgent is built. Read it fully before any change.
`CLAUDE.md` points here. The canonical product spec is linked in `README.md` and
`docs/SPEC.md` (this file never duplicates the spec). Feature IDs below (F-xx) refer to
that spec.

## What DoubleAgent is

A cross-platform (Windows + Linux) **SSH client**: a lean, native app with a great
terminal. The whole UI is **English**. It is general-purpose software (hosts, terminal,
tabs, SFTP, tunnels, vault, notes, TOTP). A separate optional module has its own spec and
is built only after the core stands.

## The specification is the only source of requirements

**Every feature, data shape, rule and acceptance criterion comes from the specification.**
Do not invent features, rename things, or change scope on your own. If the spec is silent
or ambiguous, **stop and ask** — do not guess. Decisions are recorded as ADRs
(`docs/adr/`). Feature IDs (F-xx) in commits and tests trace to the spec.

**Two specs, built in order.** The **Core spec** (this SSH client) is built first and in
full, including a runnable binary. The separate optional-module spec is fed and built only
after the Core stands. Until then, take features only from the Core spec.

## Stack (see ADR-0008)

- **Wails v2** shell → one native binary. **Go** backend, **React + TypeScript** frontend
  in the system WebView, **xterm.js** terminal.
- SSH: `golang.org/x/crypto/ssh` + `pkg/sftp`. PTY: `creack/pty` (Unix) / ConPTY (Windows).
- Crypto: Go stdlib `argon2` + `chacha20poly1305`. Persistence: encrypted JSON vault +
  optional `modernc.org/sqlite` (pure Go, no CGo). Map: react-flow.

## Golden rules (non-negotiable)

1. **Typed and clean.** Go with `go vet` + `golangci-lint` clean; TypeScript strict in the
   frontend, ESLint errors fail the build.
2. **Security boundary = the Go process.** The frontend holds no secrets and opens no
   network sockets itself; it only calls **explicitly bound Go methods**. Bind the minimal
   surface. **Terminal output and notes are never rendered as HTML** (write to xterm.js /
   text nodes, never `innerHTML`). The vault key lives only in the Go process.
3. **No custom cryptography.** Only Go stdlib / `golang.org/x/crypto`. Vault, auth and TOTP
   always ship with tests.
4. **Cross the boundaries only through the interfaces.** `x/crypto/ssh` → `SshTransport`,
   PTY → `TerminalEngine`, the vault → `SecretStore` (all in `backend/core`). UI and the
   rest of the backend never import the ssh / pty / crypto packages directly.
5. **New dependencies only after asking**, and only if maintained, slim and permissively
   licensed. **Avoid copyleft (GPL/AGPL)** — a commercial release must stay possible.
   `go mod tidy`, a committed `go.sum`, `govulncheck` and an SBOM per release run in CI.
6. **Every feature references its F-ID** in the commit subject and the test name.
7. **Integration tests run against a Dockerized OpenSSH server** (password, key, 2FA, jump
   host). No live external hosts in CI.
8. **English-only UI.** No non-English strings in the product.
9. **No emojis in the UI.** Strictly require cyberpunk-styled vector SVGs via `CyberIcon.tsx`.
   Never use Unicode emojis in buttons, badges, tabs, headers, dialogs, or terminal
   toolbars. All icons must be crisp vector graphics matching the dark HUD aesthetic.

## Walking skeleton — a runnable binary first, and after every phase

**This is the first rule.** Before any feature, produce a runnable **standalone binary**:
`wails build` yields a single file (`.exe` on Windows, a binary / AppImage on Linux) that
runs on a clean machine with no prior install — at first just an empty window. Get the
build working and **locked** before writing features. Then **every milestone ends with an
updated, runnable binary**; if it does not launch standalone, the milestone is not done.

Why Wails makes this easy (and why the old Electron attempt hurt): Go compiles statically
to one binary and the WebView comes from the OS — no bundled Node runtime, no native-module
rebuild. Keep the backend pure Go (e.g. `modernc.org/sqlite`, not a CGo driver) so
cross-compilation stays trivial.

## Repo layout

See `README.md`. Dependencies point **downwards only**: frontend → bound Go methods;
`backend/{ssh,pty,vault,data}` → `backend/core` (the interfaces). `core` imports no ssh /
pty / crypto package, so it is unit-testable in isolation.

## Commands

```bash
wails dev                         # renderer + app window, hot reload
./scripts/build-all.ps1           # Windows host: tests + Windows binary + Linux binary (via Docker/WSL)
./scripts/build-all.sh            # Linux host: tests + Linux binary (-tags webkit2_41) + Windows cross-build
wails build                       # single-OS standalone binary → build/bin/
go test ./...                     # backend tests
GOOS=linux GOARCH=amd64 go vet ./backend/... && GOOS=linux GOARCH=amd64 go build ./backend/...
go vet ./... && golangci-lint run
cd frontend && npm run test       # frontend (Vitest)
```

> **Always target Windows + Linux:** Run `GOOS=linux GOARCH=amd64 go vet ./backend/...` and `go build ./backend/...` on Windows hosts and use `./scripts/build-all.ps1` (Docker/WSL) or `./scripts/build-all.sh` (Linux) / GitHub Actions CI (`.github/workflows/ci.yml`) to produce both `build/bin/DoubleAgent.exe` and `build/bin/DoubleAgent-linux-amd64`.

## Documentation is part of every slice (mandatory)

A feature is not "done" until its docs are written/updated in the same PR, in English:

1. **User handbook** — `docs/handbook/`. What each feature does and how to use it.
2. **Technical documentation** — `docs/tech/`. **What was built, how, and why**, so anyone
   can resume where the last one stopped: packages and files touched, the bound-method
   surface and events, interfaces, decisions (link the ADR), known gaps, how to run/test.
   Keep `docs/tech/STATE.md` answering "what works / in progress / next" at a glance, plus
   the current model stage.

## How work is done

- **One milestone sub-goal per session.** Show the plan, get a go, then build small
  vertical slices.
- **Each milestone is staged by model tier** (fast → flagship); see "Model routing". The
  flagship Stage 2 closes the gate.
- **Definition of done for a slice:** green `go test` / `go vet` / lint / frontend tests, a
  successful `wails build` on the target OS, **and** the handbook + technical docs updated.
  A **milestone** is done only after its Stage 2 flagship pass (security review +
  hardening) is green **and it still produces a runnable standalone binary**.
- **Spikes** (`docs/spikes/`) are throwaway probes with a written result; they close the
  open ADRs before feature work.
- **Commits:** Conventional Commits + the F-ID. Never weaken rule 2 or 3 to make a build
  pass.

## Model routing — phased, per milestone (model-agnostic)

Two capability tiers are used, **independent of provider or product name**: a **fast
model** (cheap, quick) and a **flagship model** (the strongest available). Map whatever
models you have to these two tiers. Some IDEs cannot switch models automatically and no
file can select one — the user switches (e.g. `/model`, or an `agent.md` `model:` pin). So
the work is **phased**: every milestone runs the fast tier first, the flagship tier last,
so each phase ends secure and concise.

1. **Fast tier** — scaffolding, boilerplate, obvious UI from an established pattern, test
   stubs, doc skeletons. Broad strokes. **No security-critical code here.**
2. **Flagship tier** — the feature logic *and* the finish: wire real services, edge cases,
   then security review (bound-method surface, vault/crypto, auth, host-key), tighten and
   simplify (**concise**), verify acceptance criteria, update docs, close the gate. **The
   milestone is NOT done until this stage is green.** All security-critical code is written
   or reviewed here — never shipped from the fast tier.

### Switch markers — how you signal the user to change model

At the stage boundary the agent **STOPS and prints a banner on its own lines, then waits**
for the user to switch. Never continue silently past a boundary.

```
═══════════════════════════════════════════════
⚡  SWITCH MODEL →  FAST tier      · Stage 1: scaffolding / boilerplate
═══════════════════════════════════════════════
```
```
═══════════════════════════════════════════════
🔶  SWITCH MODEL →  FLAGSHIP tier  · Stage 2: feature logic · security · finish
═══════════════════════════════════════════════
```

If the fast tier runs into security-critical code, or stumbles twice on the same task,
print the flagship banner early and stop — escalate, don't force. Keep context lean:
feed the flagship tier only the changed files, this file, the spec section in scope, and
`docs/tech/STATE.md`. **Record the stage in `docs/tech/STATE.md`** (`Stage: 1-fast |
2-flagship`).

## First four issues (M0)

- **M0-0** — Walking skeleton: `wails init`, build a runnable empty-window binary on both
  OS, lock it. No features yet.
- **S2** — SSH transport on `x/crypto/ssh` behind `SshTransport` (closes ADR-0006).
- **S1** — terminal: xterm.js bound to the ssh session (local PTY / node of terminals later).
- **S3** — vault crypto (argon2 + XChaCha20-Poly1305) behind `SecretStore` (closes ADR-0007).
