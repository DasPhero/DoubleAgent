# Project State (`STATE.md`)

- **Current Milestone:** `M1-3` (`F-04` Keychain, `F-05` Agent/Pageant Integration, `F-22` `ssh_config` Import, and Secure Session Password Injection) — COMPLETED
- **Next Milestone:** `M1-4` (`F-08`, `F-09`, `F-10`, `F-23` — Multi-session Tabs, Split Panes, Host-colored Tab Groups, and Local PTY Terminals)
- **Stage:** `2-flagship`

## What Works
- **`M0` Foundation (`M0-0`, `S2`, `S1`, `S3`)**: Completed (`076ffc0`).
- **`M1-1` (`F-01` — Hosts & Groups with Inheritance + Visual Theme State)**: Completed (`684800c`).
- **`M1-2` (`F-02` — Command Palette `Ctrl+K` & Quick Connect)**: Completed (`a98ac3d`).
- **`M1-3` (`F-04`, `F-05`, `F-22` + Password Injection)**:
  - **`F-04` Keychain**: Implemented `ssh.GenerateKeyPair` (`ed25519`, `rsa`) and `ssh.ImportPrivateKey` (OpenSSH PEM + PuTTY `.ppk` v2/v3 parser) in [`backend/ssh/keychain.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/ssh/keychain.go) with unit tests in [`backend/ssh/keychain_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/ssh/keychain_test.go).
  - **`F-05` Agent Integration**: Implemented Windows OpenSSH Agent (`\\.\pipe\openssh-ssh-agent`) and Pageant (`WM_COPYDATA` shared memory) signers in [`backend/ssh/agent_windows.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/ssh/agent_windows.go) and Unix `SSH_AUTH_SOCK` in [`backend/ssh/agent_other.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/ssh/agent_other.go), tested in [`backend/ssh/transport_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/ssh/transport_test.go) (`TestM1_3_AgentAuthenticationWithoutKeyInVault_F05`).
  - **`F-22` `ssh_config` Import**: Implemented `core.ParseSSHConfig` in [`backend/core/sshconfig.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/sshconfig.go) and tested in [`backend/core/sshconfig_test.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/backend/core/sshconfig_test.go) (`TestM1_3_ParseSSHConfigAndReportUnknown_F22`).
  - **Password Injection**: Bound `App.InjectSessionPassword(sessionID string)` in [`app.go`](file:///c:/Users/NikoS/OneDrive/Desktop/DoubleAgent3/app.go) and added the **Inject Password** button in the active terminal toolbar.

## In Progress
- None (`M1-3` gate closing with `wails build`).

## Next
- **`M1-4` (`F-08`, `F-09`, `F-10`, `F-23`)**: Multi-session Tabs, Split Panes (horizontal/vertical), Host-colored Tab Groups, and Local PTY Terminals (PowerShell / cmd / WSL / bash).
