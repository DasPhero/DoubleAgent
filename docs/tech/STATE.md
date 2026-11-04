# Project State (`STATE.md`)

- **Current Milestone:** `M1-2` (`F-02` Command Palette `Ctrl+K` with fuzzy search over name, address, tags, and `user@host:port` quick connect) — COMPLETED
- **Next Milestone:** `M1-3` (`F-04`, `F-05`, `F-22` — Keychain, SSH Agent / Pageant integration, and `~/.ssh/config` import)
- **Stage:** `2-flagship`

## What Works
- **`M0` Foundation (`M0-0`, `S2`, `S1`, `S3`)**: Completed (`076ffc0`).
- **`M1-1` (`F-01` — Hosts & Groups with Inheritance + Visual Theme State)**: Completed (`684800c`).
- **`M1-2` (`F-02` — Command Palette `Ctrl+K` & Quick Connect)**:
  - Implemented `core.ParseQuickConnectTarget` (`user@host:port`, `user@host`, `host:port`, `ssh -p <port> user@host`) and `core.SearchHostsFuzzy` (ranked subsequence & token fuzzy matching across host Label, Address, Tags, and EffectiveUser) in [`backend/core/quickconnect.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/quickconnect.go) with unit tests in [`backend/core/quickconnect_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/quickconnect_test.go).
  - Bound `SearchCommandPalette(query string)` on `App` ([`app.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/app.go)).
  - Added global `Ctrl+K` Command Palette modal in [`frontend/src/App.tsx`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/src/App.tsx) with Vitest coverage in [`frontend/src/App.test.tsx`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/src/App.test.tsx).

## In Progress
- None (`M1-2` gate closing with `wails build`).

## Next
- **`M1-3` (`F-04`, `F-05`, `F-22`)**: Keychain (Ed25519/RSA key generation, OpenSSH & PuTTY `.ppk` import, copy public key), SSH Agent / Pageant integration, and `~/.ssh/config` import.
- **`M1-4` (`F-08`, `F-09`, `F-10`, `F-23`)**: Multi-session Tabs, Split Panes (horizontal/vertical), Host-colored Tab Groups, and Local PTY Terminals (PowerShell / cmd / WSL / bash).
