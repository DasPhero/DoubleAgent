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

interface GroupDefaults {
  port?: number;
  username?: string;
  identityId?: string;
  keepaliveSecs?: number;
}

interface GroupRecord {
  id: string;
  name: string;
  parentId?: string;
  defaultSettings: GroupDefaults;
}

interface HostSummary {
  id: string;
  label: string;
  address: string;
  effectivePort: number;
  effectiveUser: string;
  keepaliveSecs: number;
  groupId: string;
  identityId: string;
  tags: string[];
  color: string;
  favorite: boolean;
}

interface IdentitySummary {
  id: string;
  label: string;
  username: string;
  authMethod: string;
}

interface VaultSummary {
  groups: GroupRecord[];
  hosts: HostSummary[];
  identities: IdentitySummary[];
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
  GetVaultSummary: () => Promise<VaultSummary>;
  SaveGroup: (group: GroupRecord) => Promise<void>;
  DeleteGroup: (groupId: string) => Promise<void>;
  SaveIdentity: (identity: {
    id: string;
    label: string;
    username: string;
    authMethod: string;
    password?: string;
  }) => Promise<void>;
  SaveHost: (host: {
    id: string;
    label: string;
    address: string;
    port: number;
    groupId: string;
    identityId: string;
    tags: string[];
    favorite: boolean;
  }) => Promise<void>;
  DeleteHost: (hostId: string) => Promise<void>;
  ConnectSavedHost: (hostId: string, size: { cols: number; rows: number }) => Promise<string>;
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
  const [helloPending, setHelloPending] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string>('');

  const [showVaultModal, setShowVaultModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showAddHostModal, setShowAddHostModal] = useState<boolean>(false);
  const [showAddGroupModal, setShowAddGroupModal] = useState<boolean>(false);

  const [masterPassword, setMasterPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');

  // Vault Hosts & Groups state (F-01)
  const [vaultSummary, setVaultSummary] = useState<VaultSummary>({
    groups: [],
    hosts: [],
    identities: [],
  });
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Add Group form state
  const [grpName, setGrpName] = useState<string>('');
  const [grpParentId, setGrpParentId] = useState<string>('');
  const [grpPort, setGrpPort] = useState<string>('22');
  const [grpUser, setGrpUser] = useState<string>('root');
  const [grpKeepalive, setGrpKeepalive] = useState<string>('30');

  // Add Host form state
  const [hostLabel, setHostLabel] = useState<string>('');
  const [hostAddr, setHostAddr] = useState<string>('');
  const [hostPort, setHostPort] = useState<string>('0'); // 0 = inherit from group
  const [hostGroupId, setHostGroupId] = useState<string>('');
  const [hostUser, setHostUser] = useState<string>('');
  const [hostPass, setHostPass] = useState<string>('');
  const [hostTags, setHostTags] = useState<string>('');

  const [address, setAddress] = useState<string>('');
  const [port, setPort] = useState<string>('22');
  const [username, setUsername] = useState<string>('root');
  const [password, setPassword] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Vault is locked (Dark Crimson Theme). Unlock your vault to switch to Teal and access saved hosts.'
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
      if (!st.vaultLocked) {
        const summary = await api.GetVaultSummary();
        setVaultSummary(summary);
      } else {
        setVaultSummary({ groups: [], hosts: [], identities: [] });
      }
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

  const handleOpenVaultButton = (): void => {
    setModalError('');
    setShowVaultModal(true);
  };

  const handleInitializeVault = async (omitPassword: boolean): Promise<void> => {
    setModalError('');
    const pw = omitPassword ? '' : masterPassword;
    if (!omitPassword && !pw) {
      setModalError('Please enter a Master Password or choose "Skip Password for Now".');
      return;
    }
    if (!omitPassword && pw !== confirmPassword) {
      setModalError('Master password and confirmation do not match.');
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
      setModalError(`Vault setup failed: ${msg}`);
    }
  };

  const handleInitializeWithHello = async (): Promise<void> => {
    setModalError('');
    const api = getWailsBindings();
    if (!api) {
      setVaultInitialized(true);
      setVaultLocked(false);
      setQuickUnlockReady(true);
      setShowVaultModal(false);
      return;
    }
    setHelloPending(true);
    try {
      await api.InitializeVaultWithHello();
      await refreshVaultState();
      setShowVaultModal(false);
      setStatusMessage('Vault created & protected with Windows Hello / Security Key + DPAPI.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setModalError(`Windows Hello setup failed: ${msg}`);
    } finally {
      setHelloPending(false);
    }
  };

  const handleVaultUnlock = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setModalError('');
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
      setStatusMessage('Vault unlocked (Teal Theme Active).');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setModalError(`Unlock failed: ${msg}`);
    }
  };

  const handleQuickUnlockHello = async (): Promise<void> => {
    setModalError('');
    const api = getWailsBindings();
    if (!api) {
      setVaultLocked(false);
      setShowVaultModal(false);
      return;
    }
    setHelloPending(true);
    try {
      await api.UnlockVaultWithHello();
      await refreshVaultState();
      setShowVaultModal(false);
      setStatusMessage('Vault unlocked via Windows Hello / Security Key.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setModalError(msg);
    } finally {
      setHelloPending(false);
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
      setStatusMessage('Windows Hello / Security Key Quick Unlock enabled.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setModalError(`Could not enable Quick Unlock: ${msg}`);
    }
  };

  const handleChangePassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setModalError('');
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
      setModalError(`Password update failed: ${msg}`);
    }
  };

  const handleResetVault = async (): Promise<void> => {
    setModalError('');
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
    setStatusMessage('Vault locked (Dark Crimson Theme Active).');
  };

  const handleSaveGroup = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const newGroup: GroupRecord = {
      id: `grp-${Date.now()}`,
      name: grpName.trim(),
      parentId: grpParentId || undefined,
      defaultSettings: {
        port: Number(grpPort) || 22,
        username: grpUser.trim() || 'root',
        keepaliveSecs: Number(grpKeepalive) || 30,
      },
    };
    const api = getWailsBindings();
    if (api) {
      await api.SaveGroup(newGroup);
      await refreshVaultState();
    } else {
      setVaultSummary((prev) => ({ ...prev, groups: [...prev.groups, newGroup] }));
    }
    setGrpName('');
    setShowAddGroupModal(false);
  };

  const handleSaveHost = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const idSuffix = Date.now();
    let identityId = '';
    const api = getWailsBindings();

    if (hostUser.trim() || hostPass) {
      identityId = `id-${idSuffix}`;
      if (api) {
        await api.SaveIdentity({
          id: identityId,
          label: `${hostLabel.trim()} Identity`,
          username: hostUser.trim() || 'root',
          authMethod: 'password',
          password: hostPass,
        });
      }
    }

    const parsedPort = Number(hostPort) || 0;
    const tagList = hostTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (api) {
      await api.SaveHost({
        id: `host-${idSuffix}`,
        label: hostLabel.trim(),
        address: hostAddr.trim(),
        port: parsedPort,
        groupId: hostGroupId,
        identityId,
        tags: tagList,
        favorite: false,
      });
      await refreshVaultState();
    } else {
      // Preview mode fallback resolve
      const grp = vaultSummary.groups.find((g) => g.id === hostGroupId);
      const effPort = parsedPort > 0 ? parsedPort : grp?.defaultSettings.port || 22;
      const effUser = hostUser.trim() || grp?.defaultSettings.username || 'root';
      setVaultSummary((prev) => ({
        ...prev,
        hosts: [
          ...prev.hosts,
          {
            id: `host-${idSuffix}`,
            label: hostLabel.trim(),
            address: hostAddr.trim(),
            effectivePort: effPort,
            effectiveUser: effUser,
            keepaliveSecs: grp?.defaultSettings.keepaliveSecs || 30,
            groupId: hostGroupId,
            identityId,
            tags: tagList,
            color: '',
            favorite: false,
          },
        ],
      }));
    }

    setHostLabel('');
    setHostAddr('');
    setHostPort('0');
    setHostUser('');
    setHostPass('');
    setHostTags('');
    setShowAddHostModal(false);
  };

  const handleConnectSavedHost = async (host: HostSummary): Promise<void> => {
    const api = getWailsBindings();
    if (!api) {
      setStatusMessage(`Connecting to ${host.effectiveUser}@${host.address}:${host.effectivePort}...`);
      return;
    }
    setStatusMessage(`Connecting to ${host.label} (${host.effectiveUser}@${host.address}:${host.effectivePort})...`);
    try {
      const id = await api.ConnectSavedHost(host.id, { cols: 120, rows: 34 });
      setSessionId(id);
      setStatusMessage(`Connected to ${host.label}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Connection failed: ${msg}`);
    }
  };

  const handleDeleteHost = async (hostId: string): Promise<void> => {
    const api = getWailsBindings();
    if (api) {
      await api.DeleteHost(hostId);
      await refreshVaultState();
    } else {
      setVaultSummary((prev) => ({
        ...prev,
        hosts: prev.hosts.filter((h) => h.id !== hostId),
      }));
    }
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

  const filteredHosts = vaultSummary.hosts.filter((h) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      return true;
    }
    return (
      h.label.toLowerCase().includes(q) ||
      h.address.toLowerCase().includes(q) ||
      h.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <main
      className={`app-shell ${vaultLocked ? 'theme-locked' : 'theme-unlocked'}`}
      aria-label="DoubleAgent Workspace"
    >
      <header className="app-header">
        <div className="brand-group">
          <h1>DoubleAgent</h1>
          <span className={`status-badge ${vaultLocked ? 'locked' : 'unlocked'}`}>
            {vaultLocked ? 'Vault Locked' : passwordless ? 'Vault Unlocked (No PW)' : 'Vault Unlocked'}
          </span>
          {vaultLocked ? (
            <button type="button" className="btn-primary" onClick={handleOpenVaultButton}>
              {vaultInitialized ? 'Unlock Vault' : 'Set Up Vault'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setModalError('');
                  setShowSettingsModal(true);
                }}
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

      <div className="workspace-body">
        <aside className="hosts-sidebar" aria-label="Hosts and Groups Sidebar">
          <div className="sidebar-header">
            <h2>Hosts &amp; Groups</h2>
            {!vaultLocked && (
              <div className="sidebar-actions">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setShowAddGroupModal(true)}
                >
                  + Group
                </button>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => setShowAddHostModal(true)}
                >
                  + Host
                </button>
              </div>
            )}
          </div>

          {vaultLocked ? (
            <div className="sidebar-locked-notice">
              <p>Vault is locked. Unlock to view encrypted hosts, groups, and credentials.</p>
            </div>
          ) : (
            <>
              <input
                className="sidebar-search"
                aria-label="Filter Hosts"
                placeholder="Search hosts, IP, tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="sidebar-list">
                {vaultSummary.groups.map((grp) => {
                  const groupHosts = filteredHosts.filter((h) => h.groupId === grp.id);
                  return (
                    <div key={grp.id} className="group-block">
                      <div className="group-title">
                        <span>📁 {grp.name}</span>
                        <small>
                          ({grp.defaultSettings.username || 'root'}:
                          {grp.defaultSettings.port || 22})
                        </small>
                      </div>
                      {groupHosts.map((h) => (
                        <div key={h.id} className="host-card">
                          <div className="host-info">
                            <strong>{h.label}</strong>
                            <span>
                              {h.effectiveUser}@{h.address}:{h.effectivePort}
                            </span>
                          </div>
                          <div className="host-card-actions">
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              onClick={() => void handleConnectSavedHost(h)}
                            >
                              Connect
                            </button>
                            <button
                              type="button"
                              className="btn-danger btn-sm"
                              onClick={() => void handleDeleteHost(h.id)}
                              aria-label={`Delete ${h.label}`}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {filteredHosts
                  .filter((h) => !h.groupId)
                  .map((h) => (
                    <div key={h.id} className="host-card">
                      <div className="host-info">
                        <strong>{h.label}</strong>
                        <span>
                          {h.effectiveUser}@{h.address}:{h.effectivePort}
                        </span>
                      </div>
                      <div className="host-card-actions">
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => void handleConnectSavedHost(h)}
                        >
                          Connect
                        </button>
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => void handleDeleteHost(h.id)}
                          aria-label={`Delete ${h.label}`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </aside>

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
      </div>

      {showAddGroupModal && (
        <div className="modal-backdrop" role="dialog" aria-label="New Host Group">
          <form className="modal-card" onSubmit={(e) => void handleSaveGroup(e)}>
            <h2>New Host Group (F-01)</h2>
            <p>Hosts in this group inherit its default Port, Username, and Keepalive.</p>
            <input
              aria-label="Group Name"
              placeholder="Group Name (e.g. Production)"
              value={grpName}
              onChange={(e) => setGrpName(e.target.value)}
              required
              autoFocus
            />
            <select
              aria-label="Parent Group"
              value={grpParentId}
              onChange={(e) => setGrpParentId(e.target.value)}
            >
              <option value="">No Parent Group (Root)</option>
              {vaultSummary.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Default Group Port"
              placeholder="Default Port (22)"
              value={grpPort}
              onChange={(e) => setGrpPort(e.target.value)}
            />
            <input
              aria-label="Default Group Username"
              placeholder="Default Username (root)"
              value={grpUser}
              onChange={(e) => setGrpUser(e.target.value)}
            />
            <input
              aria-label="Default Keepalive Seconds"
              placeholder="Keepalive Seconds (30)"
              value={grpKeepalive}
              onChange={(e) => setGrpKeepalive(e.target.value)}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowAddGroupModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save Group
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddHostModal && (
        <div className="modal-backdrop" role="dialog" aria-label="New Host">
          <form className="modal-card" onSubmit={(e) => void handleSaveHost(e)}>
            <h2>New SSH Host (F-01)</h2>
            <p>Leave Port at 0 or Username empty to inherit from the selected Group.</p>
            <input
              aria-label="Host Label"
              placeholder="Label (e.g. Bastion EU)"
              value={hostLabel}
              onChange={(e) => setHostLabel(e.target.value)}
              required
              autoFocus
            />
            <input
              aria-label="Host IP or Hostname"
              placeholder="Address / IP (e.g. 10.10.1.50)"
              value={hostAddr}
              onChange={(e) => setHostAddr(e.target.value)}
              required
            />
            <select
              aria-label="Host Group"
              value={hostGroupId}
              onChange={(e) => setHostGroupId(e.target.value)}
            >
              <option value="">Ungrouped</option>
              {vaultSummary.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} (Default {g.defaultSettings.username || 'root'}:
                  {g.defaultSettings.port || 22})
                </option>
              ))}
            </select>
            <input
              aria-label="Host Port Override"
              placeholder="Port (0 = inherit from group)"
              value={hostPort}
              onChange={(e) => setHostPort(e.target.value)}
            />
            <input
              aria-label="Host Username Override"
              placeholder="Username (leave empty to inherit from group)"
              value={hostUser}
              onChange={(e) => setHostUser(e.target.value)}
            />
            <input
              aria-label="Host Password"
              type="password"
              placeholder="Password (stored encrypted in Vault)"
              value={hostPass}
              onChange={(e) => setHostPass(e.target.value)}
            />
            <input
              aria-label="Host Tags"
              placeholder="Tags (comma-separated, e.g. prod, linux)"
              value={hostTags}
              onChange={(e) => setHostTags(e.target.value)}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowAddHostModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save Host
              </button>
            </div>
          </form>
        </div>
      )}

      {showVaultModal && !vaultInitialized && (
        <div className="modal-backdrop" role="dialog" aria-label="Initialize Vault">
          <div className="modal-card">
            <h2>Initialize Encrypted Vault (F-03)</h2>
            <p>
              Choose how you want to protect your local SSH vault (you can change this anytime in{' '}
              <strong>Vault Security</strong>):
            </p>
            <input
              aria-label="Master Password"
              type="password"
              placeholder="New Master Password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              disabled={helloPending}
              autoFocus
            />
            <input
              aria-label="Confirm Master Password"
              type="password"
              placeholder="Confirm Master Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={helloPending}
            />
            {helloPending && (
              <div className="info-banner">
                Waiting for Windows Hello / Security Key confirmation window...
              </div>
            )}
            {modalError && <div className="error-banner">{modalError}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={helloPending}
                onClick={() => setShowVaultModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={helloPending}
                onClick={() => void handleInitializeVault(true)}
              >
                Skip Password for Now
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={helloPending}
                onClick={() => void handleInitializeWithHello()}
              >
                {helloPending ? 'Verifying Hello...' : 'Use Windows Hello / Key'}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={helloPending}
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
            <p>
              Unlock with <strong>Windows Hello / Security Key</strong> (PIN, Fingerprint, YubiKey) or{' '}
              {passwordless ? 'click Unlock below:' : 'enter your Master Password below:'}
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={helloPending}
              onClick={() => void handleQuickUnlockHello()}
            >
              {helloPending
                ? 'Waiting for Windows Hello / Security Key...'
                : 'Unlock with Windows Hello / Security Key'}
            </button>
            {!passwordless && (
              <input
                aria-label="Master Password"
                type="password"
                placeholder="Or enter Master Password"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                disabled={helloPending}
              />
            )}
            {helloPending && (
              <div className="info-banner">
                Please complete the Windows Security prompt (check your taskbar if not focused).
              </div>
            )}
            {modalError && <div className="error-banner">{modalError}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-danger"
                disabled={helloPending}
                onClick={() => void handleResetVault()}
                title="Archives the current vault and starts fresh if you forgot the password"
              >
                Reset Vault
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={helloPending}
                onClick={() => {
                  setShowVaultModal(false);
                  setMasterPassword('');
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn-secondary" disabled={helloPending}>
                {passwordless ? 'Unlock (No Password)' : 'Unlock with Password'}
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
                placeholder="Current Master Password (optional if unlocked via Hello)"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
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
                Windows Hello / DPAPI Key:{' '}
                <strong>{quickUnlockReady ? 'Active & Saved' : 'Not Armed'}</strong>
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleEnableQuickUnlock()}
              >
                Sync Windows Hello / Key
              </button>
            </div>
            {modalError && <div className="error-banner">{modalError}</div>}
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
    </main>
  );
}
