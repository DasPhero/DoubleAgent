# Project State (`STATE.md`)

- **Current Milestone:** `M1-4` Part 4 (`F-23` — Local Terminals & Hardware Serial / UART Console) — COMPLETED
- **Next Milestone:** `M1-4` Part 5 (`F-10` Terminal Working Directory / Root Shell)
- **Stage:** `2-flagship`

## What Works
- **`M0` Foundation (`M0-0`, `S2`, `S1`, `S3`)**: Completed (`076ffc0`).
- **`M1-1` (`F-01` — Hosts & Groups with Inheritance + Visual Theme State)**: Completed (`684800c`).
- **`M1-2` (`F-02` — Command Palette `Ctrl+K` & Quick Connect)**: Completed (`a98ac3d`).
- **`M1-3` (`F-04`, `F-05`, `F-22` + Password Injection)**: Completed (`77b6d0e`, `e4ece51`).
- **`M1-4` Part 1 (`F-08` — Multi-Session Tabs, Split Panes, Terminal Pooling & Global Settings)**: Completed (`fe7b9c5`).
- **`M1-4` Part 2 (`F-09` — Tab Groups by Host & Top Bar Menu System)**: Completed (`5fd8b79`).
- **`M1-4` Part 3 (`F-11` — In-Terminal Search & Highlighting)**: Completed (`c0f9942`).
- **`M1-4` Part 4 (`F-23` — Local Terminals & Hardware Serial / UART Console)**:
  - Fixed split pane title stacking (no more recursive `(H-Split #2) (H-Split #7) (V-Split #12)` concatenation) and eliminated terminal DOM re-attachment churn.
  - Implemented pending terminal data chunk buffers to eliminate blank/empty terminal race conditions upon split or new session creation.
  - Local shell execution engine in `backend/pty` with full interactive streaming for PowerShell (`powershell.exe`), Command Prompt (`cmd.exe`), and WSL (`wsl.exe`).
  - Pure Go Windows COM port enumeration (`HARDWARE\DEVICEMAP\SERIALCOMM`) and hardware driver in `backend/serial` using Windows DCB, `COMMTIMEOUTS`, `EscapeCommFunction`, and `SetCommBreak`.
  - Configurable Baud rates (9,600 to 2,000,000), Data Bits (5-8), Parity, Stop Bits, Flow Control, Line Endings, and Local Echo.
  - **Serial Auto-Detect**: Added `AutoDetectSerial` probing port accessibility and analyzing ASCII response / framing stability to auto-configure optimal baud rates.
  - **Saleae-style Signal & Logic Analyzer**: Real-time digital waveform visualizer with UART 8N1 bit synthesis, decoded character bubbles (`'A' 0x41`), timing grid, pause/live, zoom, and channel toggles (RX, TX, DTR, RTS).
  - **Collapsible Sidebar**: Collapsible via header button `◀` / `▶` and shortcut `Ctrl+B`.
  - **Top Bar Hoverable Dropdowns**: Layered comfortably in front of the sidebar with high z-index and smooth hover transitions.
  - **Immediate Startup Unlocked**: Starts unlocked out of the box in Teal theme with auto-initialized/unlocked passwordless vault.
  - Unit & integration tests in `backend/pty`, `backend/serial`, and `frontend/src/App.test.tsx`.
  - Standalone binary verified with `wails build`.

## In Progress
- None (`F-23` completed and verified).

## Next
- **`F-10` (New Terminal: Working Directory / Root)**.
