# Project State (`STATE.md`)

- **Current Milestone:** `M1-1` (`F-01` Hosts & Groups CRUD with group inheritance in the encrypted Vault) — COMPLETED
- **Next Milestone:** `M1-2` (`F-02` Command Palette `Ctrl+K` with fuzzy search over name, address, tags, and `user@host:port` quick connect)
- **Stage:** `2-flagship`

## What Works
- **`M0` Foundation (`M0-0`, `S2`, `S1`, `S3`)**: Completed (`b633b75`).
- **`M1-1` (`F-01` — Hosts & Groups with Inheritance + Visual Theme State)**:
  - Implemented `core.ResolveEffectiveHost` and `core.BuildVaultSummary` in [`backend/core/hosts.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/hosts.go) with unit tests in [`backend/core/hosts_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/hosts_test.go).
  - Bound `GetVaultSummary`, `SaveGroup`, `DeleteGroup`, `SaveIdentity`, `SaveHost`, `DeleteHost`, and `ConnectSavedHost` on `App` (`app.go`), keeping all secret passwords/keys inside Go (`Golden Rule 2`).
  - Added Left Sidebar for Groups & Hosts in [`frontend/src/App.tsx`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/src/App.tsx) with search/tag filtering and one-click connect.
  - Added `.theme-locked` (Dark Crimson / Red when Vault is locked) and `.theme-unlocked` (Dark Slate + Teal when Vault is unlocked) in [`frontend/src/styles.css`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/src/styles.css).

## In Progress
- None (`M1-1` gate closed).

## Next
- **`M1-2` (`F-02`)**: Command Palette (`Ctrl+K`) with fuzzy search over host name, address, tags, and direct `user@host:port` quick connect.
- **`M1-3` (`F-04`, `F-05`, `F-22`)**: Keychain (Ed25519/RSA key generation, OpenSSH & PuTTY `.ppk` import, copy public key), SSH Agent / Pageant integration, and `~/.ssh/config` import.
