# ADR-0008: Application Stack — Wails v2 (Go) + React/TypeScript + xterm.js

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Earlier specification drafts considered Electron + Node.js native modules (`node-pty`, `ssh2`). However, Electron bundles a full Chromium + Node runtime and requires rebuilding native modules against the Electron ABI on Windows and Linux. We need a single, lean standalone executable (`wails build`) that launches immediately without external runtime dependencies while retaining a rich web-based UI and `xterm.js`.

## Decision

1. **Shell & Packaging:** Wails v2 (`github.com/wailsapp/wails/v2`) producing a single native binary with embedded frontend assets.
2. **Backend:** Pure Go (`backend/core`, `backend/ssh`, `backend/pty`, `backend/vault`, `backend/data`). Optional history persistence uses `modernc.org/sqlite` (pure Go, no CGo).
3. **Frontend:** React + TypeScript (`strict: true`) + Vite + `xterm.js` running in the OS WebView.
4. **Security Boundary:** The Go process is the security boundary. The frontend opens no network sockets, holds no secrets, never renders terminal output or notes via `innerHTML`, and only invokes explicitly bound Go methods.

## Consequences

- `wails build` produces a standalone `.exe` on Windows and a native binary / AppImage on Linux without CGo or Node ABI issues.
- Strict separation between UI presentation and security-critical backend logic.

