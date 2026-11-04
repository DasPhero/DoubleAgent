import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalView } from './components/TerminalView';

export interface HostKeyPromptInfo {
  hostPattern: string;
  port: number;
  keyType: string;
  fingerprint: string;
}

interface AppStatusPayload {
  name: string;
  version: string;
  milestone: string;
  vaultLocked: boolean;
  vaultInitialized: boolean;
  passwordless: boolean;
  quickUnlockReady: boolean;
}

interface TerminalDataPayload {
  sessionId: string;
  data: string;
}

interface WailsAppBindings {
  HealthCheck: () => Promise<AppStatusPayload>;
  InitializeVault: (masterPassword: string) => Promise<void>;
  InitializeVaultWithHello: () => Promise<void>;
  UnlockVault: (masterPassword: string) => Promise<void>;
  ChangeVaultPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  EnableQuickUnlock: () => Promise<void>;
  UnlockVaultWithHello: () => Promise<void>;
  ResetVault: () => Promise<void>;
  LockVault: () => Promise<void>;
  ConnectSSH: (req: {
    address: string;
    port: number;
    username: string;
    password: string;
    privateKey: string;
    passphrase: string;
    size: { cols: number; rows: number };
  }) => Promise<string>;
  ResolveHostKeyPrompt: (host: string, port: number, trust: boolean) => Promise<void>;
  WriteTerminal: (sessionId: string, data: string) => Promise<void>;
  ResizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>;
  DisconnectSession: (sessionId: string) => Promise<void>;
}

interface WailsRuntime {
  EventsOn: (eventName: string, callback: (data: unknown) => void) => () => void;
}

function getWailsBindings(): WailsAppBindings | undefined {
  const win = window as unknown as {
    go?: { main?: { App?: WailsAppBindings } };
  };
  return win.go?.main?.App;
}

function getWailsRuntime(): WailsRuntime | undefined {
  const win = window as unknown as {
    runtime?: WailsRuntime;
  };
  return win.runtime;
}

export function App(): React.JSX.Element {
  const [vaultLocked, setVaultLocked] = useState<boolean>(true);
  const [vaultInitialized, setVaultInitialized] = useState<boolean>(false);
  const [passwordless, setPasswordless] = useState<boolean>(false);
  const [quickUnlockReady, setQuickUnlockReady] = useState<boolean>(false);

  const [showVaultModal, setShowVaultModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [masterPassword, setMasterPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');

  const [address, setAddress] = useState<string>('');
  const [port, setPort] = useState<string>('22');
  const [username, setUsername] = useState<string>('root');
  const [password, setPassword] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Ready (M0 complete: S1/S2/S3). Set up or unlock your vault, or connect to an SSH host above.'
  );
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptInfo | null>(null);

  const writersRef = useRef<Map<string, (chunk: string) => void>>(new Map());

  const registerWriter = useCallback((id: string, writeFn: (chunk: string) => void) => {
    writersRef.current.set(id, writeFn);
  }, []);

  const refreshVaultState = useCallback(async (): Promise<void> => {
    const api = getWailsBindings();
    if (!api) {
      return;
    }
    try {
      const st = await api.HealthCheck();
      setVaultLocked(st.vaultLocked);
      setVaultInitialized(st.vaultInitialized);
      setPasswordless(st.passwordless);
      setQuickUnlockReady(st.quickUnlockReady);
    } catch {
      // Ignore during initial mount if bindings not ready
    }
  }, []);

  useEffect(() => {
    void refreshVaultState();
    const rt = getWailsRuntime();
    if (!rt) {
      return;
    }

    const offData = rt.EventsOn('terminal:data', (raw: unknown) => {
      const payload = raw as TerminalDataPayload;
      const writer = writersRef.current.get(payload.sessionId);
      if (writer) {
        writer(payload.data);
      }
    });

    const offPrompt = rt.EventsOn('ssh:hostkey-prompt', (raw: unknown) => {
      const info = raw as HostKeyPromptInfo;
      setHostKeyPrompt(info);
    });

    const offExit = rt.EventsOn('terminal:exit', () => {
      setSessionId(null);
      setStatusMessage('SSH session disconnected.');
    });

    const offVaultLock = rt.EventsOn('vault:locked', (raw: unknown) => {
      setVaultLocked(Boolean(raw));
      void refreshVaultState();
    });

    return () => {
      offData();
      offPrompt();
      offExit();
      offVaultLock();
    };
  }, [refreshVaultState]);

  const handleInitializeVault = async (omitPassword: boolean): Promise<void> => {
    const pw = omitPassword ? '' : masterPassword;
    if (!omitPassword && pw !== confirmPassword) {
      setStatusMessage('Master password and confirmation do not match.');
      return;
    }
    const api = getWailsBindings();
    if (!api) {
      setVaultInitialized(true);
      setVaultLocked(false);
      setPasswordless(omitPassword);
      setShowVaultModal(false);
      setMasterPassword('');
      setConfirmPassword('');
      return;
    }
    try {
      await api.InitializeVault(pw);
      await refreshVaultState();
      setShowVaultModal(false);
      setMasterPassword('');
      setConfirmPassword('');
      setStatusMessage(
        omitPassword
          ? 'Vault initialized without a password. You can set a Master Password anytime in Vault Security.'
          : 'Vault initialized & encrypted (Argon2id + XChaCha20-Poly1305).'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Vault setup failed: ${msg}`);
    }
  };

  const handleInitializeWithHello = async (): Promise<void> => {
    const api = getWailsBindings();
    if (!api) {
      setVaultInitialized(true);
      setVaultLocked(false);
      setQuickUnlockReady(true);
      setShowVaultModal(false);
      return;
    }
    try {
      await api.InitializeVaultWithHello();
      await refreshVaultState();
      setShowVaultModal(false);
      setStatusMessage('Vault created & protected with Windows Hello / Security Key + DPAPI.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Windows Hello setup failed: ${msg}`);
    }
  };

  const handleVaultUnlock = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const api = getWailsBindings();
    if (!api) {
      setVaultLocked(false);
      setShowVaultModal(false);
      setMasterPassword('');
      return;
    }
    try {
      await api.UnlockVault(passwordless ? '' : masterPassword);
      await refreshVaultState();
      setShowVaultModal(false);
      setMasterPassword('');
      setStatusMessage('Vault unlocked (Argon2id + XChaCha20-Poly1305).');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Vault unlock failed: ${msg}`);
    }
  };

  const handleQuickUnlockHello = async (): Promise<void> => {
    const api = getWailsBindings();
    if (!api) {
      return;
    }
    try {
      await api.UnlockVaultWithHello();
      await refreshVaultState();
      setShowVaultModal(false);
      setStatusMessage('Vault unlocked via Windows Hello / Security Key.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Windows Hello / Security Key unlock failed: ${msg}`);
    }
  };

  const handleEnableQuickUnlock = async (): Promise<void> => {
    const api = getWailsBindings();
    if (!api) {
      setQuickUnlockReady(true);
      return;
    }
    try {
      await api.EnableQuickUnlock();
      await refreshVaultState();
      setStatusMessage('Windows Hello / Security Key Quick Unlock enabled for this session.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Could not enable Quick Unlock: ${msg}`);
    }
  };

  const handleChangePassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const api = getWailsBindings();
    if (!api) {
      setPasswordless(newPassword === '');
      setShowSettingsModal(false);
      setCurrentPassword('');
      setNewPassword('');
      return;
    }
    try {
      await api.ChangeVaultPassword(passwordless ? '' : currentPassword, newPassword);
      await refreshVaultState();
      setShowSettingsModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setStatusMessage(
        newPassword === ''
          ? 'Master password removed (vault is now in passwordless mode).'
          : 'Master password updated and vault re-encrypted.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Password update failed: ${msg}`);
    }
  };

  const handleResetVault = async (): Promise<void> => {
    const api = getWailsBindings();
    if (api) {
      await api.ResetVault();
      await refreshVaultState();
    } else {
      setVaultInitialized(false);
      setVaultLocked(true);
    }
    setShowVaultModal(false);
    setShowSettingsModal(false);
    setMasterPassword('');
    setStatusMessage('Vault reset (previous vault archived as .reset.bak). Ready for fresh setup.');
  };

  const handleVaultLock = async (): Promise<void> => {
    const api = getWailsBindings();
    if (api) {
      await api.LockVault();
      await refreshVaultState();
    } else {
      setVaultLocked(true);
    }
    setStatusMessage('Vault locked.');
  };

  const handleConnect = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const api = getWailsBindings();
    if (!api) {
      setStatusMessage('Wails backend not attached in browser preview mode.');
      return;
    }
    setStatusMessage(`Connecting to ${username}@${address}:${port}...`);
    try {
      const id = await api.ConnectSSH({
        address: address.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        password,
        privateKey: '',
        passphrase: '',
        size: { cols: 120, rows: 34 },
      });
      setSessionId(id);
      setPassword('');
      setStatusMessage(`Connected (${username}@${address}:${port})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Connection failed: ${msg}`);
    }
  };

  const handleHostKeyDecision = async (trust: boolean): Promise<void> => {
    if (!hostKeyPrompt) {
      return;
    }
    const api = getWailsBindings();
    const current = hostKeyPrompt;
    setHostKeyPrompt(null);
    if (api) {
      await api.ResolveHostKeyPrompt(current.hostPattern, current.port, trust);
    }
  };

  const handleTerminalInput = useCallback((id: string, data: string): void => {
    const api = getWailsBindings();
    if (api) {
      void api.WriteTerminal(id, data);
    }
  }, []);

  const handleTerminalResize = useCallback((id: string, cols: number, rows: number): void => {
    const api = getWailsBindings();
    if (api) {
      void api.ResizeTerminal(id, cols, rows);
    }
  }, []);

  const handleDisconnect = async (): Promise<void> => {
    if (!sessionId) {
      return;
    }
    const api = getWailsBindings();
    if (api) {
      await api.DisconnectSession(sessionId);
    }
    setSessionId(null);
    setStatusMessage('Disconnected.');
  };

  return (
    <main className="app-shell" aria-label="DoubleAgent Workspace">
      <header className="app-header">
        <div className="brand-group">
          <h1>DoubleAgent</h1>
          <span className={`status-badge ${vaultLocked ? 'locked' : 'unlocked'}`}>
            {vaultLocked ? 'Vault Locked' : passwordless ? 'Vault Unlocked (No PW)' : 'Vault Unlocked'}
          </span>
          {vaultLocked ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowVaultModal(true)}
            >
              {vaultInitialized ? 'Unlock Vault' : 'Set Up Vault'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowSettingsModal(true)}
              >
                Vault Security
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleVaultLock()}
              >
                Lock Vault
              </button>
            </>
          )}
        </div>

        <form className="quick-connect-bar" onSubmit={(e) => void handleConnect(e)}>
          <input
            aria-label="Host Address"
            placeholder="Host / IP (e.g. 192.168.1.10)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
          <input
            aria-label="Port"
            className="port-input"
            placeholder="22"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            required
          />
          <input
            aria-label="Username"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            aria-label="Password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {sessionId ? (
            <button type="button" className="btn-danger" onClick={() => void handleDisconnect()}>
              Disconnect
            </button>
          ) : (
            <button type="submit" className="btn-primary">
              Connect SSH
            </button>
          )}
        </form>
      </header>

      {showVaultModal && !vaultInitialized && (
        <div className="modal-backdrop" role="dialog" aria-label="Initialize Vault">
          <div className="modal-card">
            <h2>Initialize Encrypted Vault (F-03)</h2>
            <p>
              Set a Master Password for Argon2id + XChaCha20-Poly1305 encryption, or start without a
              password and set one later in <strong>Vault Security</strong>.
            </p>
            <input
              aria-label="Master Password"
              type="password"
              placeholder="New Master Password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              autoFocus
            />
            <input
              aria-label="Confirm Master Password"
              type="password"
              placeholder="Confirm Master Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowVaultModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleInitializeVault(true)}
              >
                Skip Password for Now
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleInitializeWithHello()}
              >
                Use Windows Hello / Key
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleInitializeVault(false)}
              >
                Create Vault
              </button>
            </div>
          </div>
        </div>
      )}

      {showVaultModal && vaultInitialized && (
        <div className="modal-backdrop" role="dialog" aria-label="Unlock Vault">
          <form className="modal-card" onSubmit={(e) => void handleVaultUnlock(e)}>
            <h2>Unlock Encrypted Vault (F-03)</h2>
            {passwordless ? (
              <p>This vault is currently in passwordless mode. Click Unlock to open it.</p>
            ) : (
              <>
                <p>Enter your Master Password or unlock directly with Windows Hello / Security Key.</p>
                <input
                  aria-label="Master Password"
                  type="password"
                  placeholder="Master Password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  required
                  autoFocus
                />
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-danger"
                onClick={() => void handleResetVault()}
                title="Archives the current vault and starts fresh if you forgot the password"
              >
                Reset Vault
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleQuickUnlockHello()}
              >
                Windows Hello / Key
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowVaultModal(false);
                  setMasterPassword('');
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Unlock
              </button>
            </div>
          </form>
        </div>
      )}

      {showSettingsModal && (
        <div className="modal-backdrop" role="dialog" aria-label="Vault Security Settings">
          <form className="modal-card" onSubmit={(e) => void handleChangePassword(e)}>
            <h2>Vault Security &amp; Windows Hello (F-03)</h2>
            <p>
              {passwordless
                ? 'Your vault currently has no Master Password. Set one below to protect it.'
                : 'Change your Master Password (leave New Password empty to switch to passwordless mode).'}
            </p>
            {!passwordless && (
              <input
                aria-label="Current Master Password"
                type="password"
                placeholder="Current Master Password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            )}
            <input
              aria-label="New Master Password"
              type="password"
              placeholder="New Master Password (or leave empty for passwordless)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <div className="quick-unlock-box">
              <span>
                Windows Hello / FIDO2 Quick Unlock:{' '}
                <strong>{quickUnlockReady ? 'Enabled' : 'Not Armed'}</strong>
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleEnableQuickUnlock()}
              >
                Enable Windows Hello / Key
              </button>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-danger"
                onClick={() => void handleResetVault()}
              >
                Reset Vault
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowSettingsModal(false)}
              >
                Close
              </button>
              <button type="submit" className="btn-primary">
                Save Password
              </button>
            </div>
          </form>
        </div>
      )}

      {hostKeyPrompt && (
        <div className="modal-backdrop" role="dialog" aria-label="Verify SSH Host Key">
          <div className="modal-card">
            <h2>Verify Unknown Host Key (F-06)</h2>
            <p>
              Host: <strong>{hostKeyPrompt.hostPattern}:{hostKeyPrompt.port}</strong>
            </p>
            <p>
              Algorithm: <code>{hostKeyPrompt.keyType}</code>
            </p>
            <p>
              Fingerprint: <code>{hostKeyPrompt.fingerprint}</code>
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-danger"
                onClick={() => void handleHostKeyDecision(false)}
              >
                Reject &amp; Abort
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleHostKeyDecision(true)}
              >
                Trust Host Key
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionId ? (
        <section className="terminal-workspace" aria-label="Active Terminal Session">
          <TerminalView
            sessionId={sessionId}
            onInput={handleTerminalInput}
            onResize={handleTerminalResize}
            registerWriter={registerWriter}
          />
        </section>
      ) : (
        <section className="empty-state">
          <p>{statusMessage}</p>
        </section>
      )}
    </main>
  );
}
