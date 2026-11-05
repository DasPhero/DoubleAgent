# Project State (`STATE.md`)

- **Current Milestone:** `M1-4` Part 2 (`F-09` — Tab Groups by Host & Top Bar Menu System) — COMPLETED
- **Next Milestone:** `M1-4` Part 3 (`F-10` Terminal Working Directory / Root Shell, `F-11` Search & Find in Terminal, `F-23` Local PTY Shell)
- **Stage:** `2-flagship`

## What Works
- **`M0` Foundation (`M0-0`, `S2`, `S1`, `S3`)**: Completed (`076ffc0`).
- **`M1-1` (`F-01` — Hosts & Groups with Inheritance + Visual Theme State)**: Completed (`684800c`).
- **`M1-2` (`F-02` — Command Palette `Ctrl+K` & Quick Connect)**: Completed (`a98ac3d`).
- **`M1-3` (`F-04`, `F-05`, `F-22` + Password Injection)**: Completed (`77b6d0e`, `e4ece51`).
- **`M1-4` Part 1 (`F-08` — Multi-Session Tabs, Split Panes, Terminal Pooling & Global Settings)**: Completed (`fe7b9c5`).
- **`M1-4` Part 2 (`F-09` — Tab Groups by Host & Top Bar Menu System)**:
  - Top Bar reorganized into structured dropdown menus (**Vault ▾**, **Tools ▾**, **View ▾**, **Settings ⚙**) reducing icon clutter, with keyboard shortcuts (`Ctrl+K`, `Ctrl+,`) and escape/outside-click dismissal.
  - **Host Color Coding (`F-09`)**: Color swatches picker in Add Host dialog (`#0ea5e9`, `#10b981`, `#f59e0b`, `#f43f5e`, `#8b5cf6`, `#06b6d4`, `#ec4899`, `#6366f1`, `#64748b` or deterministic Auto), visible in sidebar host list and across all active session tabs.
  - **Host Tab Groups (`F-09`)**: `HostTabGroup` domain models and `GroupTabsByHost` grouping helper in [`backend/core/workspace.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/workspace.go) with unit tests in [`backend/core/workspace_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/workspace_test.go) (`TestM1_4_GroupTabsByHost_F09`).
  - Frontend interactive Tab Bar with **`⊞ Group by Host`** / **`⊟ Ungroup`** toggle, collapsible/expandable host clusters with session count badges (`2`), and color accent borders. Tested in [`frontend/src/App.test.tsx`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/src/App.test.tsx).
  - Standalone binary verified with `wails build`.

## In Progress
- None (`F-09` completed and verified).

## Next
- **`F-10` (New Terminal: Directory / Root)**, **`F-11` (Terminal Search with Regex & Highlights)**, or **`F-23` (Local Shell via ConPTY / PTY)**.
