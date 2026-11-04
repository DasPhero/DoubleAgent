# DoubleAgent — User Handbook

Welcome to the DoubleAgent user handbook.

## Overview

DoubleAgent is a cross-platform (Windows and Linux) native SSH client featuring an encrypted local vault, tabbed and split-pane terminals, SFTP file transfers, port forwarding, TOTP generation, and per-host notes.

## Current Capabilities (`M0` Complete: `M0-0`, `S2`, `S1`, `S3`)

- **Standalone Native App (`M0-0`)**: Launches directly as a single executable on Windows (`DoubleAgent.exe`) and Linux without external runtime dependencies.
- **Encrypted Vault (`S3` — `F-03`)**:
  - DoubleAgent always starts with the **Vault Locked**.
  - Click **Unlock Vault** in the top header and enter your **Master Password**. On first use, DoubleAgent initializes a new encrypted vault file (`doubleagent.vault`) protected with **Argon2id** key derivation and **XChaCha20-Poly1305** authenticated encryption.
  - Click **Lock Vault** at any time to wipe the encryption key from memory immediately, or let the automatic inactivity timer lock the vault after 15 minutes.
- **Quick Connect & Interactive Terminal (`S1` — `F-01`, `F-06`, `F-07`, `F-11`)**:
  - Enter **Host / IP**, **Port**, **Username**, and **Password** in the top Quick Connect bar and click **Connect SSH**.
  - On first connection to a host, DoubleAgent displays the **Verify Unknown Host Key (`F-06`)** modal with the key algorithm and `SHA256:...` fingerprint.
  - Once connected, an interactive **xterm.js** terminal session opens with 256-color / Truecolor support, automatic window resize (`FitAddon`), and a 10,000-line scrollback buffer.
- **SSH Transport & Host-Key Security (`S2` — `F-01`, `F-04`, `F-06`, `F-07`, `F-20`)**:
  - Supports password authentication, Ed25519 and RSA private keys (with optional passphrase), and keyboard-interactive 2FA prompts.
  - Blocks connections immediately if a previously trusted server changes its host key (`core.ErrHostKeyMismatch`).
  - Strips untrusted `OSC 52` clipboard-write escape sequences from remote terminal output.
