# DoubleAgent — User Handbook

Welcome to the DoubleAgent user handbook.

## Overview

DoubleAgent is a cross-platform (Windows and Linux) native SSH client featuring an encrypted local vault, tabbed and split-pane terminals, SFTP file transfers, port forwarding, TOTP generation, and per-host notes.

## Current Capabilities (`M0-0` & `S2`)

- **Standalone Native App (`M0-0`)**: Launches directly as a single executable on Windows (`DoubleAgent.exe`) and Linux without external runtime dependencies.
- **SSH Transport & Host-Key Security (`S2` — `F-01`, `F-04`, `F-06`, `F-07`, `F-20`)**:
  - Supports password authentication, Ed25519 and RSA private keys (with optional passphrase), and keyboard-interactive 2FA prompts.
  - **Strict Known Hosts (`F-06`)**: Displays `SHA256` fingerprints on first connection (Trust on First Use). If a previously trusted server changes its host key, DoubleAgent blocks the connection immediately to protect against Man-in-the-Middle (MITM) attacks.
  - **Modern Cryptography**: Uses Curve25519 / ECDH key exchanges and AEAD ciphers (`ChaCha20-Poly1305`, `AES-GCM`) by default.
