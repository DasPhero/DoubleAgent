# Future Feature Plan: `F-46` — Ephemeral Remote Companion Agent over SSH

> **Status:** Planned / Backlog (not yet implemented).  
> **Motivation:** Allow running the DoubleAgent GUI on Windows (where Vault, Notes, Evidence, and Reports stay local) while seamlessly executing network-local operations (Listeners, File Staging, Pivots, LHOST discovery) on a headless Linux/Kali SSH host.

---

## 1. Core Architecture (Zero-Port Ephemeral SSH Worker)

- **Headless pure-Go binary (`cmd/doubleagent-agent/main.go`):**
  - Cross-compiled directly from Windows or Linux with `CGO_ENABLED=0` (no GTK/WebKit/Docker/WSL needed):
    - `build/bin/doubleagent-agent-linux-amd64`
    - `build/bin/doubleagent-agent-linux-arm64`
  - Zero external runtime dependencies on the remote Linux/Kali host.
- **Auto-Deploy via existing SSH / SFTP session:**
  1. Probe `uname -s`, `uname -m`, and `$HOME` via `ExecRaw` (reject non-Linux hosts cleanly).
  2. Compute local SHA-256 of `doubleagent-agent-linux-<arch>` and compare against `~/.doubleagent/doubleagent-agent` on the remote host.
  3. If missing or hash differs, upload via existing `SftpClient.Upload` to `~/.doubleagent/doubleagent-agent.tmp`, run `chmod 700` and atomic `mv -f`.
- **Encrypted Zero-Port Control Channel:**
  - Launch `exec "$HOME/.doubleagent/doubleagent-agent"` over a dedicated non-PTY SSH exec stream (`SshStreamStarter.ExecStream`).
  - Exchange framed **NDJSON-RPC** (`req` / `res` / `evt`) over SSH `stdin`/`stdout`.
  - **Zero open control ports, zero extra tokens/certs.**
  - **Ephemeral lifecycle:** when the SSH channel closes, the user detaches, or DoubleAgent shuts down, `stdin` hits EOF and the agent cleanly closes all active listeners, caught sockets, staging servers, and pivot processes before exiting.

---

## 2. Security Boundary Invariants (Must Hold)

- **Never transfer secrets or client data to the remote host:** `.vault`, SSH keys, credentials, Notes, Evidence Vault, Reports, and `templates/*.json` remain strictly on the local workstation.
- Only the static agent binary (and explicitly staged transfer files) are placed under `~/.doubleagent/` with `0700` permissions.
- All remote execution remains explicitly user-triggered from the UI (no autonomous scanning, no target-side implant/C2 behavior).

---

## 3. Complete Implementation Checklist (Everything Needed)

### Phase A — Transport, Core Protocol & Headless Agent
- [ ] **Spec update:** Add `F-46` to `docs/SPEC.md` and `docs/DoubleAgent — Pentest-Modul (Spec).md`.
- [ ] **`backend/core/remote_agent.go`:** Define `RemoteAgentInfo`, `AgentRPCMessage`, and optional `SshStreamStarter` interface (`ExecStream`).
- [ ] **`backend/ssh/transport.go`:** Implement non-PTY `ExecStream(ctx, sessionID, command)` returning `stdin`, `stdout`, `stderr`, `wait`, `closeFn`.
- [ ] **`backend/remoteagent/server.go` & `cmd/doubleagent-agent/main.go`:**
  - NDJSON-RPC server loop reusing `backend/core`, `backend/rawtcp`, `backend/transfer`, and `backend/pivot`.
  - Graceful `shutdownAll()` on `stdin` EOF / `SIGINT` / `SIGTERM`.
- [ ] **`backend/remoteagent/client.go`:**
  - `NewClientFromStreams`, `Call`, `Ping`, `Close`, `FindLocalAgentBinary`, and `DeployAndAttach` (SHA-256 check + SFTP upload + `chmod 700` + `ExecStream` + `Ping` handshake).
- [ ] **Tests (`backend/remoteagent/client_test.go`):** Offline full RPC lifecycle tests over `io.Pipe()` (zero network dependency).

### Phase B — Full Feature Parity When Context = `Remote Agent`
- [ ] **Remote Network Interfaces (`GetLocalNetworkIPs`):** Return Kali's live interfaces (`tun0`, `eth0`, etc.) so Payload Generator (`F-33`), File Transfer (`F-31`), and Pivot one-liners (`F-24`) auto-populate Kali's real `LHOST`.
- [ ] **Remote Listeners (`F-32`):**
  - Delegate `StartManagedListener`, `StopManagedListener`, `ListActiveManagedListeners` to the active remote agent.
  - Stream `listener:incoming`, `session:data` (base64), and `session:closed` events back to `app.go` → emit `listener:incoming` / `raw-tcp:incoming` / `terminal:data` / `terminal:exit` so caught reverse shells on Kali open as live interactive tabs on Windows (with full `WriteTerminal`, `DisconnectSession`, and `Stabilize F-34` support).
- [ ] **Remote File Transfer Staging (`F-31`):**
  - Delegate `StartFileTransferServer`, `StopFileTransferServer`, `ListFileTransferServers`, and `ListHostedTransferFiles` (defaulting remote staging dir to `~/.doubleagent/staging`).
  - **Remote File Hashing (`HashHostedTransferFile`):** Add `fileserver_hash_file` RPC so SHA-256/MD5 checksums work for files staged on Kali.
  - **1-Click Push Local → Remote Staging:** Add a button/RPC (via SFTP) to push local Windows tools directly into Kali's `~/.doubleagent/staging` folder.
- [ ] **Remote Pivoting Engine (`F-24`):**
  - Add RPC methods (`pivot_detect_binaries`, `pivot_start`, `pivot_stop`, `pivot_list`, `pivot_stdin`) so `ligolo-ng`, `chisel`, and `sshuttle` can launch and stream logs directly on Kali where `tun0` and Linux TUN interfaces exist.
- [ ] **Optional Remote Outbound Sockets & HTTP/WS (`F-31`, `F-42`, `F-44`):**
  - Optional RPC for dialing Raw TCP (`ConnectRawTcp`) directly from Kali.
  - Optional route entry `agent:<sessionId>` in `ListApiRoutes` (or keep using SSH `-D` SOCKS5).

### Phase C — Frontend UI, Build Pipeline & Documentation
- [ ] **Frontend (`frontend/src/types/remoteAgent.ts`, `frontend/src/components/ExecContextControl.tsx`, `frontend/src/App.tsx`):**
  - Top-bar Execution Context dropdown (`Exec: Local ▾` ↔ `Agent: <hostname> (<vpn-ip>) ▾`).
  - 1-click **Attach Agent → `<Active SSH Session>`**, switch between attached agents, and **Detach**.
  - On context switch: auto-refresh `LHOST` IPs, active listeners, active file servers, and active pivots.
  - Unit tests (`ExecContextControl.test.tsx`).
- [ ] **Build Pipeline (`scripts/build-all.ps1`, `scripts/build-all.sh`, `.github/workflows/ci.yml`):**
  - Cross-compile `doubleagent-agent-linux-amd64` and `doubleagent-agent-linux-arm64` into `build/bin/` alongside `DoubleAgent.exe` / `DoubleAgent-linux-amd64`.
- [ ] **Documentation:** Update `docs/handbook/README.md` and `docs/tech/STATE.md`.
