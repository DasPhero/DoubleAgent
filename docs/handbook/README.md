# DoubleAgent — User Handbook

Welcome to the DoubleAgent user handbook.

## Overview

DoubleAgent is a cross-platform (Windows and Linux) native SSH client featuring an encrypted local vault, tabbed and split-pane terminals, SFTP file transfers, port forwarding, TOTP generation, and per-host notes.

## Current Capabilities (`M0`, `M1-1`, `M1-2`, & `M1-3`)

- **Standalone Native App (`M0-0`)**: Launches directly as a single executable on Windows (`DoubleAgent.exe`) and Linux without external runtime dependencies.
- **Visual Security State (Dark Crimson Locked ↔ Dark Teal Unlocked)**:
  - When the **Vault is Locked**, the entire application displays a **Dark Crimson / Red** theme so you can see at a glance that secrets are locked.
  - As soon as you unlock the Vault, the UI transitions to the **Dark Slate + Teal** glass theme.
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
