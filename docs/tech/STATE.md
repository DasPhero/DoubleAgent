# Project State (`STATE.md`)

- **Current Milestone:** `M1-4` Part 7 (`F-13` — Port Forwarding: Local `-L`, Remote `-R`, Dynamic SOCKS5 `-D`) — COMPLETED
- **Next Milestone:** `M1-4` Part 8 (`F-14` — Proxy Profiles: ProxyJump, ProxyCommand, and proxychains Export)
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
- **`M1-4` Part 6 (`F-12` — SFTP File Transfer & File Tree Browser)**: Completed (`be3a7e6`).
- **`M1-4` Part 7 (`F-13` — Port Forwarding: Local `-L`, Remote `-R`, Dynamic SOCKS5 `-D`)**:
  - **Core Interfaces (`backend/core/interfaces.go`)**:
    - Defined `ForwardRuleType` (`"L"`, `"R"`, `"D"`), `ForwardRule`, `ForwardTunnelStatus`, and `ForwardTunnel` interface.
    - Extended `core.VaultPayload` with `ForwardRules []ForwardRule`.
    - Extended `core.SshTransport` with `StartForwardLocal`, `StartForwardRemote`, `StartForwardDynamic`.
    - Strict boundary: `backend/core` never imports `golang.org/x/crypto/ssh` or non-standard packages.
  - **Backend Forwarding Engine (`backend/ssh/forward.go`)**:
    - Local Forwarding (`-L`): `net.Listen` on local address/port and dials remote target host/port via SSH transport client.
    - Remote Reverse Forwarding (`-R`): `sshClient.Listen` on remote address/port and dials local target host/port via `net.Dial`.
    - Dynamic SOCKS5 Proxy (`-D`): RFC 1928 compliant SOCKS5 protocol handler supporting `NO AUTH` (0x00), `CONNECT` (0x01) command, IPv4 (0x01), Domain Name (0x03), and IPv6 (0x04) destination addresses, tunneling traffic transparently via SSH client dialer.
    - Bidirectional connection copying with thread-safe atomic byte counters (`bytesIn`, `bytesOut`) and active connection tracking.
    - Comprehensive unit tests with in-memory `net.Pipe()` pairs (`backend/ssh/forward_test.go`).
  - **Application Service Bindings (`app.go`)**:
    - Bound methods: `SaveForwardRule`, `DeleteForwardRule`, `ListForwardRules`, `StartForwardTunnel`, `StopForwardTunnel`, `GetActiveTunnels`.
    - Automated lifecycle: `autoStartForwardRules` auto-initiates configured rules on `ConnectSavedHost`.
    - Active tunnel cleanup on session disconnect and app shutdown.
    - Backend tests: `app_test.go` (`TestApp_PortForwarding_F13`).
  - **Frontend UI & Visual Diagnostics (`frontend/src/components/PortForwardingView.tsx`)**:
    - Rule configuration form supporting `-L`, `-R`, and `-D` with validation for port ranges (1–65535).
    - Color-coded badges: `-L` (Green), `-R` (Purple), `-D` (Amber).
    - Real-time status indicators (`ACTIVE` with glowing green badge / `INACTIVE`).
    - Bidirectional byte counters (`In`, `Out`) and active connection counters.
    - Mapping diagram preview (`bind ➔ target`).
    - Dedicated management modal triggered via top navigation bar button (`⚡ N Tunnels` / `Tunnels ⇄`) and **Tools ▾ -> Port Forwarding (-L, -R, -D)**.
    - Comprehensive unit tests in `frontend/src/App.test.tsx`.
    - Standalone binary verified with `wails build`.
- **UX Polish & Settings Unification**:
  - **Background Host Connection for Forward Tunnels**: When starting a forward tunnel without an active SSH session, DoubleAgent automatically connects to the rule's associated host in the background via `ConnectSavedHost` and initializes the tunnel.
  - **Modal Backdrop Click-to-Close**: Clicking the dark background overlay (`e.target === e.currentTarget`) dismisses all modals and dialogs (Port Forwarding, Command Palette, New Host, New Group, Keychain, Import Config, Vault Setup/Unlock, Settings, Host Key Prompt, Serial).
  - **Unified Settings Tab System (`SettingsView`)**: Consolidated Global Settings into a tabbed interface (Appearance & Terminal, Vault & Security, Keyboard Shortcuts) accessible both as a modal and as a dedicated persistent workspace tab.

## In Progress
- None.

## Next (TODO List)
- **Creating Custom Shortcuts (Custom Keybindings & Action Shortcuts Manager)**:
  - Allow users to create, customize, and persist keybindings for any DoubleAgent action (e.g. Quick Connect, Open Terminal in Directory, Split Panes, Port Forwarding, Snippet Execution).
  - Configurable prefix/leader key (e.g. `Ctrl+B` or `Ctrl+A`) to eliminate shortcut collisions with terminal CLI applications (e.g. `nano`, `vim`, `htop`).
  - Shortcut conflict detector and one-click reset to factory defaults.
- **`F-14` (Proxy Profiles: ProxyJump, ProxyCommand, and proxychains Export)**.
