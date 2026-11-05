# DoubleAgent — User Handbook

Welcome to the DoubleAgent user handbook.

## Overview

DoubleAgent is a cross-platform (Windows and Linux) native SSH client featuring an encrypted local vault, tabbed and split-pane terminals, SFTP file transfers, port forwarding, TOTP generation, and per-host notes.

## Current Capabilities (`M0`, `M1-1`, `M1-2`, `M1-3`, & `F-08`)

- **Standalone Native App (`M0-0`)**: Launches directly as a single executable on Windows (`DoubleAgent.exe`) and Linux without external runtime dependencies.
- **Top Bar Menu Navigation & Workspace Organization**:
  - The top bar is organized into a clean application menu bar:
    - **Vault ▾**: Quick access to lock/unlock, Vault Security & Windows Hello (`F-03`), and emergency Vault Reset.
    - **Tools ▾**: Direct triggers for Command Palette (`Ctrl+K`), Keychain (`F-04`), Import `ssh_config` (`F-22`), and one-click session password injection.
    - **View ▾**: Split pane horizontal/vertical triggers, toggle host-grouped tabs (`F-09`), and pane font zooming (`Ctrl +` / `Ctrl -` / `Ctrl 0`).
    - **Settings ⚙**: Instant access to Global Settings (`Ctrl+,`).
- **Host Color Coding & Tab Groups (`F-09`)**:
  - **Host Color Tags**: Pick from 9 curated palette colors (Emerald, Sky, Amber, Rose, Violet, Cyan, Indigo, Pink, Slate) or use automatic deterministic colors in the Add Host dialog.
  - Colors are clearly displayed as color indicator dots in the sidebar host list and as accent top-borders on open tabs.
  - **Expandable / Collapsible Tab Groups**:
    - Click **`⊞ Group by Host`** in the tab bar (or View menu) to cluster all sessions connected to the same host under a color-coded host header pill.
    - Shows host session count badge (e.g. `2`).
    - Click the group header chevron (`▾`/`▸`) to collapse all sessions of that host to save space, or expand to display all tabs side-by-side.
    - Click **`⊟ Ungroup`** at any time to return to the standard flat tab view with drag-and-drop ordering.
- **Global Settings & Theme Customization (`F-08`)**:
  - Open the **Global Settings** modal anytime by pressing **`Ctrl+,`** or clicking **Settings ⚙** in the top navigation bar or sidebar.
  - **Color Themes**: Choose between **Teal (Cyber Teal Default)**, **Dracula**, **One Dark**, **Nord**, **Monokai Pro**, and **Crimson**. The entire app window, borders, active focus indicators, and terminal color palette instantly switch in real-time.
  - **Terminal Font & Cursor Configuration**: Configure default font family (Cascadia Code, JetBrains Mono, Fira Code, Consolas, Source Code Pro), default font size (9–32px), line height (1.0–1.4), cursor style (Block, Underline, Bar), cursor blinking, and scrollback depth (up to 50,000 lines). All settings persist across sessions in local storage.
  - **Keyboard Shortcuts Reference**: View all active workspace shortcuts in one clear table.
- **Visual Security State (Dark Crimson Locked ↔ Theme Unlocked)**:
  - When the **Vault is Locked**, the entire application displays a **Dark Crimson / Red** theme so you can see at a glance that secrets are locked.
  - As soon as you unlock the Vault, the UI transitions to your selected theme (Teal by default).
- **Multi-Session Tabs & Arbitrary Mixed Split Panes (`F-08`)**:
  - Connecting to multiple hosts (or multiple times to the same host) opens each session in its own **Tab** in the top tab bar.
  - **Preserved Terminal Logs Across Splits & Tab Switches**: Utilizing a persistent `TerminalPool`, all running session logs, command outputs, active screen buffers, and scrollback are 100% preserved when splitting panes horizontally/vertically or switching tabs.
  - **Isolated Terminal Scrolling**: Scrolling inside a terminal pane never bubbles up or causes the DoubleAgent window/workspace to scroll (`overscroll-behavior: contain` + overflow locking).
  - **Per-Pane Font Zoom Controls**:
    - Zoom terminal text in any pane via the **`+`** and **`-`** buttons in the pane header, or press **`Ctrl +`** / **`Ctrl -`** (or **`Ctrl + MouseWheel`**).
    - Press **`Ctrl + 0`** to quickly reset the pane's font size to the global default. Current font size is displayed dynamically in each pane header (e.g. `14px`).
  - **Drag-and-Drop Reordering**: Drag any tab pill left or right to reorder your open sessions.
  - **Mixed Nested Splitting**:
    - Click **Split ⬌** (`Split Horizontal`) or **Split ⬍** (`Split Vertical`) to divide any active pane.
    - Supports arbitrary nested combinations (e.g. splitting horizontally and then splitting the left pane vertically creates two stacked panes on the left alongside a full-height pane on the right).
  - **Close Individual Panes**: Every pane in a split grid has its own **`×`** close button in its header, allowing individual panes to be closed independently. When all panes in a tab are closed, the tab automatically closes.
  - **Keyboard Focus Navigation**:
    - Press **`Alt+ArrowLeft`** / **`Alt+ArrowRight`** to navigate between open **Tabs**.
    - Press **`Alt+ArrowUp`** / **`Alt+ArrowDown`** (or click **Next Pane ⇥**) to cycle keyboard focus between **Split Panes** without sending raw terminal escape characters (`A`, `B`, `C`, `D`).
- **SSH Keychain (`M1-3` — `F-04`)**:
  - Click **Keychain (`F-04`)** in the top bar when the Vault is unlocked:
    - Generate new **Ed25519** or **RSA-3072** SSH keypairs directly inside the encrypted Vault (with an optional passphrase).
    - Import existing **OpenSSH PEM** or **PuTTY `.ppk`** (`v2` and `v3`) private keys.
    - Click **Copy Public Key** on any saved key to copy its `authorized_keys` line to the clipboard.
- **SSH Agent & Pageant Integration (`M1-3` — `F-05`)**:
  - When adding a Host, choose **Windows OpenSSH Agent / Pageant (`F-05`)** as the authentication method to authenticate via your OS SSH agent (`\\.\pipe\openssh-ssh-agent`, Pageant shared memory, or Unix `SSH_AUTH_SOCK`) without storing the private key inside the Vault.
- **OpenSSH `ssh_config` Import (`M1-3` — `F-22`)**:
  - Click **Import `ssh_config`** in the top bar and paste your `~/.ssh/config`.
  - Automatically imports `Host`, `HostName`, `User`, `Port`, `IdentityFile`, and `ProxyJump`, and displays clear warnings for any unsupported directives.
- **One-Click Password Injection into Active Terminal Sessions**:
  - While connected to an SSH terminal session, click **Inject Password** in the terminal toolbar to have the Go backend write the stored password directly into the remote PTY (`stdin`) for `sudo` / `su` prompts without ever exposing the password to the frontend.
- **Command Palette & Quick Connect (`M1-2` — `F-02`)**:
  - Press **`Ctrl+K`** (or click **Command Palette (`Ctrl+K`)** in the top bar) from anywhere in the workspace.
  - **Fuzzy Search**: Type fragments or subsequences of a host's **Name** (e.g. `pw01` for `prod-web-01`), **IP/Hostname**, or **Tags** (e.g. `nginx`) and press `Enter` (or click the result) to connect immediately.
  - **Direct `user@host:port` Quick Connect**: Type `user@host:port`, `user@host`, `host:port`, or `ssh -p 2222 user@host` into the Command Palette to connect to an ad-hoc SSH target directly.
- **Hosts & Groups Management with Inheritance (`M1-1` — `F-01`)**:
  - Once unlocked, use the left **Hosts & Groups** sidebar:
    - Click **+ Group** to create hierarchical folders with default **Port**, **Username**, and **Keepalive** settings.
    - Click **+ Host** to save an SSH host inside the encrypted Vault. Leave Port (`0`) or Username empty to inherit them automatically from the assigned Group, or specify values on the Host to override the Group defaults (`F-01`).
    - Filter saved hosts by name, IP, or tags in the sidebar search box and click **Connect** to open a session immediately.
- **Encrypted Vault, Passwordless Option, Reset & Windows Hello (`S3` — `F-03`)**:
  - DoubleAgent always starts with the **Vault Locked**.
  - On first launch, click **Set Up Vault**:
    - Enter and confirm a **Master Password** and click **Create Vault** to protect `doubleagent.vault` with **Argon2id + XChaCha20-Poly1305**, **OR**
    - Click **Skip Password for Now** to start in passwordless mode and set a Master Password at any time later.
  - Once unlocked, click **Vault Security** in the top bar to:
    - Set or change your **Master Password** (preserving all saved hosts and keys).
    - Click **Enable Windows Hello / Key** to arm native Windows Hello / FIDO2 security-key quick unlock for the current session after an auto-lock.
    - Click **Reset Vault** if you ever forget your Master Password (archives the old vault to `doubleagent.vault.reset.<timestamp>.bak` and starts fresh).
  - Click **Lock Vault** at any time to wipe the encryption key from memory immediately, or let the automatic inactivity timer lock the vault after 15 minutes.
- **Quick Connect & Interactive Terminal (`S1` — `F-01`, `F-06`, `F-07`, `F-11`)**:
  - Enter **Host / IP**, **Port**, **Username**, and **Password** in the top Quick Connect bar and click **Connect SSH**.
  - On first connection to a host, DoubleAgent displays the **Verify Unknown Host Key (`F-06`)** modal with the key algorithm and `SHA256:...` fingerprint.
  - Once connected, an interactive **xterm.js** terminal session opens with 256-color / Truecolor support, automatic window resize (`FitAddon`), and a 10,000-line scrollback buffer.
- **SSH Transport & Host-Key Security (`S2` — `F-01`, `F-04`, `F-06`, `F-07`, `F-20`)**:
  - Supports password authentication, Ed25519 and RSA private keys (with optional passphrase), and keyboard-interactive 2FA prompts.
  - Blocks connections immediately if a previously trusted server changes its host key (`core.ErrHostKeyMismatch`).
  - Strips untrusted `OSC 52` clipboard-write escape sequences from remote terminal output.
