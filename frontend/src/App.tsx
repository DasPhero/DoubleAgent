import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalView } from './components/TerminalView';

export interface HostKeyPromptInfo {
  hostPattern: string;
  port: number;
  keyType: string;
  fingerprint: string;
}

interface TerminalDataPayload {
  sessionId: string;
  data: string;
}

interface WailsAppBindings {
  UnlockVault: (masterPassword: string) => Promise<void>;
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
  const [showUnlockModal, setShowUnlockModal] = useState<boolean>(false);
  const [masterPassword, setMasterPassword] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [port, setPort] = useState<string>('22');
  const [username, setUsername] = useState<string>('root');
  const [password, setPassword] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Ready (M0 complete: S1/S2/S3). Unlock the vault or enter SSH host details above to connect.'
  );
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptInfo | null>(null);

  const writersRef = useRef<Map<string, (chunk: string) => void>>(new Map());

  const registerWriter = useCallback((id: string, writeFn: (chunk: string) => void) => {
    writersRef.current.set(id, writeFn);
  }, []);

  useEffect(() => {
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
    });

    return () => {
      offData();
      offPrompt();
      offExit();
      offVaultLock();
    };
  }, []);

  const handleVaultUnlock = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const api = getWailsBindings();
    if (!api) {
      setVaultLocked(false);
      setShowUnlockModal(false);
      setMasterPassword('');
      return;
    }
    try {
      await api.UnlockVault(masterPassword);
      setVaultLocked(false);
      setShowUnlockModal(false);
      setMasterPassword('');
      setStatusMessage('Vault unlocked (Argon2id + XChaCha20-Poly1305).');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Vault unlock failed: ${msg}`);
    }
  };

  const handleVaultLock = async (): Promise<void> => {
    const api = getWailsBindings();
    if (api) {
      await api.LockVault();
    }
    setVaultLocked(true);
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
          <span className="status-badge">{vaultLocked ? 'Vault Locked' : 'Vault Unlocked'}</span>
          {vaultLocked ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowUnlockModal(true)}
            >
              Unlock Vault
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void handleVaultLock()}
            >
              Lock Vault
            </button>
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

      {showUnlockModal && (
        <div className="modal-backdrop" role="dialog" aria-label="Unlock Vault">
          <form className="modal-card" onSubmit={(e) => void handleVaultUnlock(e)}>
            <h2>Unlock Encrypted Vault (F-03)</h2>
            <p>Enter your master password to derive the Argon2id + XChaCha20-Poly1305 key.</p>
            <input
              aria-label="Master Password"
              type="password"
              placeholder="Master Password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              required
              autoFocus
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowUnlockModal(false);
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
