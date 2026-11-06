# Project State (`STATE.md`)

- **Current Milestone:** `M1-4` Part 6 (`F-12` — SFTP File Transfer & File Tree Browser) — COMPLETED
- **Next Milestone:** `M1-4` Part 7 (`F-13` — Port Forwarding: Local `-L`, Remote `-R`, Dynamic SOCKS5 `-D`)
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
- **`M1-4` Part 5 (`F-10` — New Terminal: Working Directory & Root Shell)**: Completed.
- **`M1-4` Part 6 (`F-12` — SFTP File Transfer & File Tree Browser)**:
  - **Backend SFTP Engine (`backend/ssh/sftp.go`)**:
    - Wrapped `github.com/pkg/sftp` behind strict `core.SftpClient` boundary in `backend/core/interfaces.go`.
    - Zero leaks: `backend/core` never imports `github.com/pkg/sftp`.
    - Implemented `List`, `Stat`, `Mkdir`, `Remove`, `Rename`, `Upload`, and `Download` with progress metering and context cancellation.
    - Extended `SshTransport` with `OpenSftp(ctx, sessionID)`.
    - Added in-memory SFTP server unit tests using `net.Pipe()` (`TestSFTP_ListAndStat_F12`, `TestSFTP_UploadDownloadProgress_F12`, `TestSFTP_MkdirAndRemove_F12`).
  - **Application Service Bindings (`app.go`)**:
    - Bound methods: `ListLocalDir`, `ListRemoteDir`, `StartSftpUpload`, `StartSftpDownload`, `CancelTransfer`, `CreateRemoteDir`, `DeleteRemoteItem`, `GetActiveTransfers`.
    - Background goroutine transfer queue emitting `sftp:progress` Wails events with speed calculations (bytes/sec) and completion/cancellation statuses.
    - Added comprehensive unit tests in `app_test.go` (`TestApp_SftpOperations_F12`).
  - **Frontend Two-Column Browser (`frontend/src/components/SftpBrowserView.tsx`)**:
    - Side-by-side local (left) and remote (right) file listings.
    - Path navigation bar with breadcrumbs/editable input, parent folder navigation (`⬆ Up`), and refresh (`↻`).
    - Sortable table columns: Name (directories first), Size, Last Modified timestamp, UNIX permissions.
    - HTML5 Drag-and-Drop:
      - Drag from Local to Remote panel -> background upload.
      - Drag from Remote to Local panel -> background download.
      - Visual drop target highlights.
    - Modal workflows for New Remote Folder (`📁+`) and Delete Remote Item (`🗑`).
    - Bottom Transfer Queue drawer with progress bars, live transfer speed, status badges, and transfer cancellation (`✕`).
  - **UI Integration**:
    - One-click `SFTP` button on saved host cards in the sidebar.
    - One-click `📁 SFTP` button on active terminal pane headers.
    - `SFTP File Browser (F-12)` entry in top menu **Tools ▾**.
    - Unit tests in `frontend/src/App.test.tsx`.
    - Standalone binary verified with `wails build`.

## In Progress
- None (`F-12` completed and verified).

## Next
- **`F-13` (Port Forwarding: Local `-L`, Remote `-R`, Dynamic SOCKS5 `-D`)**.
