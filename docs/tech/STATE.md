# Project State (`STATE.md`)

- **Current Milestone:** `M1-4` Part 1 (`F-08` — Multi-Session Tabs & Split Panes) — COMPLETED
- **Next Milestone:** `M1-4` Part 2 (`F-09` Broadcast / Multi-Execution, `F-10` Host Color Coding, `F-23` Local PTY Shell)
- **Stage:** `2-flagship`

## What Works
- **`M0` Foundation (`M0-0`, `S2`, `S1`, `S3`)**: Completed (`076ffc0`).
- **`M1-1` (`F-01` — Hosts & Groups with Inheritance + Visual Theme State)**: Completed (`684800c`).
- **`M1-2` (`F-02` — Command Palette `Ctrl+K` & Quick Connect)**: Completed (`a98ac3d`).
- **`M1-3` (`F-04`, `F-05`, `F-22` + Password Injection)**: Completed (`77b6d0e`, `e4ece51`).
- **`M1-4` Part 1 (`F-08` — Multi-Session Tabs, Split Panes, Terminal Pooling & Global Settings)**:
  - Implemented workspace tab/pane domain models and tree helpers in [`backend/core/workspace.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/workspace.go) + [`backend/core/workspace_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/workspace_test.go) (`TestM1_4_MixedNestedSplitPanesAndRemoval_F08`).
  - Bound `App.DuplicateSession(sessionID string, size core.TerminalSize) (string, error)` in [`app.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/app.go) so splitting an active pane opens a fresh shell on the same host directly in Go.
  - Multi-tab bar with drag-and-drop tab reordering, independent session exits that never wipe unaffected tabs, arbitrary mixed nested horizontal/vertical splits (e.g. 2 stacked on the left, 1 full-height on the right), and individual split pane close buttons (`×`).
  - **Persistent `TerminalPool`**: Decoupled xterm lifecycle from React DOM tree restructuring during horizontal/vertical splitting and tab switching. Buffer data, command outputs, and scrollback are 100% retained and immediately re-rendered via `fitAddon.fit()` and `term.refresh()`. Terminals are only disposed upon explicit session exit/disconnect via `disposeTerminal()`.
  - **Isolated Terminal Scrolling**: Enforced `overflow: hidden !important` and `overscroll-behavior: none !important` on root containers and `overscroll-behavior: contain !important` on `.xterm-viewport` to completely eliminate scroll chaining to the application shell.
  - **Pane Font Zooming**: Keyboard shortcuts `Ctrl + +`, `Ctrl + -`, `Ctrl + 0`, `Ctrl + MouseWheel`, and header `+`/`-` buttons with dynamic font size badges.
  - **Global Settings Modal (`Ctrl+,`)**: Configurable color themes (Teal, Dracula, One Dark, Nord, Monokai Pro, Crimson), font family, font size, line height, cursor style/blink, and scrollback with instant live preview and local storage persistence. Tested in [`frontend/src/App.test.tsx`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/frontend/src/App.test.tsx). Standalone binary verified with `wails build`.

## In Progress
- None (`F-08` gate closing with `wails build`).

## Next
- **`F-09` (Broadcast / Multi-Execution)**, **`F-10` (Host-Colored Tabs & Badges)**, or **`F-23` (Local Shell / ConPTY & Unix PTY)**.
