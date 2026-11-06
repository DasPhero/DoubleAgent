# Project State (`STATE.md`)

- **Current Milestone:** `M1-4` Part 5 (`F-10` — Terminal Working Directory & Root Shell) — COMPLETED
- **Next Milestone:** `M1-4` Part 6 (`F-12` — SFTP File Transfer & File Tree Browser)
- **Stage:** `2-flagship`

## What Works
- **`M0` Foundation (`M0-0`, `S2`, `S1`, `S3`)**: Completed (`076ffc0`).
- **`M1-1` (`F-01` — Hosts & Groups with Inheritance + Visual Theme State)**: Completed (`684800c`).
- **`M1-2` (`F-02` — Command Palette `Ctrl+K` & Quick Connect)**: Completed (`a98ac3d`).
- **`M1-3` (`F-04`, `F-05`, `F-22` + Password Injection)**: Completed (`77b6d0e`, `e4ece51`).
- **`M1-4` Part 1 (`F-08` — Multi-Session Tabs, Split Panes, Terminal Pooling & Global Settings)**: Completed (`fe7b9c5`).
- **`M1-4` Part 2 (`F-09` — Tab Groups by Host & Top Bar Menu System)**: Completed (`5fd8b79`).
- **`M1-4` Part 3 (`F-11` — In-Terminal Search & Highlighting)**: Completed (`c0f9942`).
- **`M1-4` Part 4 (`F-23` — Local Terminals, ConPTY & Hardware Serial / UART Console)**: Completed (`33683e2`).
  - **Native Headless Windows ConPTY (`backend/pty/pty_windows.go`)**:
    - Implemented native Windows Pseudo Console (`CreatePseudoConsole`) attached via `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`.
    - Eliminated blank external `conhost.exe` foreground window popups on Windows.
    - Full bidirectional VT streaming, interactive prompt emission, dynamic console resizing (`ResizePseudoConsole`), and safe teardown.
- **`M1-4` Part 5 (`F-10` — New Terminal: Working Directory & Root Shell)**:
  - **Host & Group Default Directory (`InitialDir`)**:
    - Added `InitialDir` to `HostRecord`, `GroupDefaults`, and `ResolvedHost` in `backend/core/hosts.go`.
    - Implemented inheritance resolution: hosts inherit group default directory unless explicitly overridden per-host.
    - Added `InitialDir` input field in Add/Edit Host and Group forms.
    - Added visual `📂 {h.initialDir}` badge in sidebar host lists.
  - **Live Working Directory Detection (OSC 7)**:
    - Registered OSC 7 handler in xterm.js via `term.parser.registerOscHandler(7, ...)` parsing `\x1b]7;file://hostname/path\x07` sequences from modern shells (PowerShell, Bash, Zsh, Fish).
    - Caching and propagating detected directory (`cwd`) dynamically across tabs and split panes.
    - Added visual directory pill (`📂 /path/to/dir`) in the split pane header.
  - **Terminal Spawning Options (`OpenTerminalWithOptions`)**:
    - Extended `SshTransport` and `backend/ssh/transport.go` with `OpenShellWithOptions` supporting `initialDir` (`sh -c 'cd <dir> && exec $SHELL -l'`) and `asRoot` (`sudo -s -H sh -c ...`).
    - Extended `backend/pty` with `StartShellWithOptions` on Windows (native ConPTY with working directory and root flag) and Unix (`sudo -i`).
    - Added backend binding `OpenTerminalWithOptions(targetSessionID string, opts core.TerminalSpawnOptions)` supporting:
      1. **Default Directory (`🏠 Default Dir`)**: Spawns a new tab/pane positioned in the host's configured default directory or user home.
      2. **Current Directory (`📂 Current Dir`)**: Spawns a new tab/pane positioned in the exact CWD detected from the active terminal.
      3. **Elevated Root Shell (`⚡ Root in Dir`)**: Spawns a root shell (`sudo -s` or elevated) positioned in the active terminal's CWD with red-accented tab indicator.
  - **UI Integration**:
    - Three quick-access buttons in the active tab toolbar: `🏠 Default Dir`, `📂 Current Dir`, `⚡ Root in Dir`.
    - Three menu items in **Tools ▾**: `New in Default Directory`, `New in Current Directory (CWD)`, and `New Root Shell in Current Directory`, accessible at all times.
    - **Empty State Quick-Start Workspace**: Interactive quick-start grid when no tabs are open to immediately launch PowerShell, Command Prompt, WSL Linux, choose folders, or open remote/serial connections.
    - **Smooth Top Bar Dropdown Menus**: Fixed sub-pixel gap and cursor transition hover closing bugs.
  - Unit and integration tests in `backend/core`, `backend/pty`, `backend/ssh`, `app_test.go`, and `frontend/src/App.test.tsx`.
  - Standalone binary verified with `wails build`.

## In Progress
- None (`F-10` completed and verified).

## Next
- **`F-12` (SFTP File Transfer & File Tree Browser)**.
