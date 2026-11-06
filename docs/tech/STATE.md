# Project State (`STATE.md`)

- **Current Milestone:** `M1-4` Part 8 (`F-14` — Proxy Profiles: ProxyJump, ProxyCommand, and proxychains Export) — COMPLETED
- **Next Milestone:** `M1-4` Part 9 (`F-15` — Snippets with variables like `{{VAR}}` and prompt before execution)
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
- **`M1-4` Part 7 (`F-13` — Port Forwarding: Local `-L`, Remote `-R`, Dynamic SOCKS5 `-D`)**: Completed.
- **`M1-4` Part 8 (`F-14` — Proxy Profiles: ProxyJump, ProxyCommand, and proxychains Export)**:
  - **Core Domain & Data Types (`backend/core/interfaces.go` & `backend/core/hosts.go`)**:
    - Defined `ProxyProfileType` (`"jump"`, `"command"`, `"socks5"`), `ProxyProfile`, and `ProxyProfileSummary` (masks `SocksPassword` with `HasPassword` boolean).
    - Extended `HostRecord`, `GroupDefaults`, and `ResolvedHost` with `ProxyProfileID string`, `ProxyCommand string`, and `JumpChain []string`.
    - Extended `VaultPayload` with `ProxyProfiles []ProxyProfile`.
    - Extended `VaultSummary` with `ProxyProfiles []ProxyProfileSummary`.
    - Extended `ConnectRequest` with `ProxyProfileID`, `ProxyJump`, and `ProxyCommand`.
    - Extended `SshSessionConfig` with `JumpChain []SshSessionConfig`, `ProxyCommand string`, `SocksProxy string`, and `SocksAuth *SocksAuth`.
    - Group inheritance and host overrides for proxy settings implemented in `ResolveEffectiveHost()`.
    - Secure summary masking in `BuildVaultSummary()` preventing proxy passwords from ever leaking to frontend.
  - **OpenSSH ssh_config Parser (`backend/core/sshconfig.go`)**:
    - Added `ProxyCommand` extraction and global defaults inheritance (`case "proxycommand":`).
  - **Proxychains Configuration Generator (`backend/core/proxychains.go`)**:
    - RFC-compliant generator supporting `strict_chain`, `dynamic_chain`, `random_chain`, `round_robin_chain`, `proxy_dns`, `quiet_mode`, read/connect timeouts, and formatted proxies table.
    - Automatic extraction of active/saved `-D` dynamic SOCKS5 forward rules and SOCKS5 proxy profiles via `BuildDefaultProxychainsOptions()`.
    - Comprehensive unit tests in `backend/core/proxychains_test.go` (`TestProxychainsExport_F14`).
  - **SSH Transport Proxy Dialing Engine (`backend/ssh/`)**:
    - Created `backend/ssh/proc_windows.go` and `backend/ssh/proc_other.go` implementing `setProcAttr(cmd *exec.Cmd)` with `CREATE_NO_WINDOW` (`0x08000000`) on Windows to ensure headless execution without console flash.
    - Created `backend/ssh/proxy.go` with:
      - `processConn`: implements `net.Conn` wrapping Stdin/Stdout of spawned ProxyCommand processes with clean process termination on close.
      - `dialProxyCommand`: expands `%h`, `%p`, `%%` substitutions and executes the command locally.
      - `dialSocks5`: uses `golang.org/x/net/proxy` with optional username/password auth.
      - `dialProxyJump`: iterates sequentially through intermediate bastion hops, handshaking SSH on each hop, and dials final target over the last bastion client.
    - Updated `backend/ssh/transport.go` (`activeSession` tracks `jumpClients []*ssh.Client` and `closers []io.Closer`; `Connect()` branches through proxy dialers; `Disconnect()` cleans up all intermediate hops).
    - Unit tests in `backend/ssh/proxy_test.go` (`TestProxyCommand_F14`, `TestProxySocks5_F14`, `TestProxyJump_ChainValidation_F14`).
  - **Application Service Bindings (`app.go` & `app_test.go`)**:
    - Bound methods: `SaveProxyProfile`, `DeleteProxyProfile`, `ListProxyProfiles`, `GetDefaultProxychainsOptions`, `GenerateProxychainsConfig`, `ExportProxychainsConfig`, `SaveProxychainsFile`.
    - Updated `ConnectSavedHost` and `ConnectSSH` to resolve jump hops (saved host IDs and `[user@]host[:port]` specs) and apply proxy configurations.
    - Preserves existing proxy passwords when editing profiles without re-entering credentials.
    - Comprehensive backend unit tests in `app_test.go` (`TestApp_ProxyProfiles_F14`).
  - **Frontend UI & Diagnostics (`frontend/src/`)**:
    - Created `frontend/src/types/proxy.ts` with TypeScript interfaces for profiles and proxychains.
    - Created `frontend/src/components/ProxychainsExportModal.tsx`: interactive configuration exporter with chain mode selector, timeout controls, DNS leak prevention toggle, hop editor, real-time preview, copy-to-clipboard, download `.conf` file, and save to disk.
    - Created `frontend/src/components/ProxyProfilesView.tsx`: management modal for Proxy Profiles with Jump Chain hop reordering, ProxyCommand helpers, and SOCKS5 forms with masked password indicators.
    - Updated `PortForwardingView.tsx`: added `Export proxychains.conf` action button in header.
    - Updated `App.tsx`:
      - Added `Proxy Profiles` and `Export proxychains.conf` to top navigation `Tools ▾` dropdown menu.
      - Added "Proxy & Bastion Settings (F-14)" section in New SSH Host modal.
      - Added "Default Group Proxy Profile" in New Host Group modal.
      - Bound all proxy profile and proxychains handlers.
    - Unit tests in `frontend/src/App.test.tsx` (`manages Proxy Profiles (ProxyJump, ProxyCommand, SOCKS5) and exports proxychains.conf (F-14)`).
  - Standalone binary verified with `wails build`.
- **UX Polish & Settings Unification**:
  - **Background Host Connection for Forward Tunnels**: When starting a forward tunnel without an active SSH session, DoubleAgent automatically connects to the rule's associated host in the background via `ConnectSavedHost` and initializes the tunnel.
  - **Modal Backdrop Click-to-Close**: Clicking the dark background overlay (`e.target === e.currentTarget`) dismisses all modals and dialogs.
  - **Unified Settings Tab System (`SettingsView`)**: Consolidated Global Settings into a tabbed interface (Appearance & Terminal, Vault & Security, Keyboard Shortcuts) accessible both as a modal and as a dedicated persistent workspace tab.

## In Progress
- None.

## Next (TODO List)
- **`F-15`: Snippets with Variables**:
  - Store reusable command snippets in the encrypted vault with categorization and tags.
  - Support template variables like `{{HOST}}`, `{{PORT}}`, `{{INTERFACE}}`, `{{CUSTOM}}`.
  - Interactive parameter query modal/popup before sending the command to active terminal sessions.
  - Quick-execute snippets from terminal toolbar and Command Palette (`Ctrl+K`).
- **Creating Custom Shortcuts (Custom Keybindings & Action Shortcuts Manager)**:
  - Allow users to create, customize, and persist keybindings for any DoubleAgent action (e.g. Quick Connect, Open Terminal in Directory, Split Panes, Port Forwarding, Snippet Execution).
  - Configurable prefix/leader key (e.g. `Ctrl+B` or `Ctrl+A`) to eliminate shortcut collisions with terminal CLI applications (e.g. `nano`, `vim`, `htop`).
  - Shortcut conflict detector and one-click reset to factory defaults.
