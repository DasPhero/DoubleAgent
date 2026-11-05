# Project State (`STATE.md`)

- **Current Milestone:** `M1-4` Part 1 (`F-08` — Multi-Session Tabs & Split Panes) — COMPLETED
- **Next Milestone:** `M1-4` Part 2 (`F-09` Broadcast / Multi-Execution, `F-10` Host Color Coding, `F-23` Local PTY Shell)
- **Stage:** `2-flagship`

## What Works
- **`M0` Foundation (`M0-0`, `S2`, `S1`, `S3`)**: Completed (`076ffc0`).
- **`M1-1` (`F-01` — Hosts & Groups with Inheritance + Visual Theme State)**: Completed (`684800c`).
- **`M1-2` (`F-02` — Command Palette `Ctrl+K` & Quick Connect)**: Completed (`a98ac3d`).
- **`M1-3` (`F-04`, `F-05`, `F-22` + Password Injection)**: Completed (`77b6d0e`, `e4ece51`).
- **`M1-4` Part 1 (`F-08` — Multi-Session Tabs & Split Panes)**:
  - Implemented workspace tab/pane domain models and reordering/cycling helpers in [`backend/core/workspace.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/workspace.go) + [`backend/core/workspace_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/workspace_test.go) (`TestM1_4_ReorderTabsAndKeyboardCycle_F08`).
  - Bound `App.DuplicateSession(sessionID string, size core.TerminalSize) (string, error)` in [`app.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/app.go) so splitting a pane opens a fresh shell on the same host without exposing credentials to the frontend.
  - Added multi-tab bar with drag-and-drop tab reordering, horizontal/vertical split panes (`Split ⬌` / `Split ⬍`), and keyboard focus cycling (`Alt+ArrowLeft`/`Alt+ArrowRight` for tabs, `Alt+ArrowUp`/`Alt+ArrowDown` for split panes) in [`frontend/src/App.tsx`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/src/App.tsx), verified by Vitest in [`frontend/src/App.test.tsx`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/src/App.test.tsx).

## In Progress
- None (`F-08` gate closing with `wails build`).

## Next
- **`F-09` (Broadcast / Multi-Execution)**, **`F-10` (Host-Colored Tabs & Badges)**, or **`F-23` (Local Shell / ConPTY & Unix PTY)**.
