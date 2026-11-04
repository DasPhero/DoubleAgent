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

interface QuickConnectTarget {
  user: string;
  address: string;
  port: number;
  display: string;
}

interface HostSearchResult {
  host: HostSummary;
  score: number;
  matchedFields: string[];
}

interface CommandPaletteResponse {
  query: string;
  hostResults: HostSearchResult[];
  quickConnect?: QuickConnectTarget;
}

function parseQuickConnectLocal(raw: string): QuickConnectTarget | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const token = trimmed.replace(/^ssh\s+/i, '').trim();
  const hasExplicit = token.includes('@') || token.includes(':');
  if (!hasExplicit || token.includes(' ')) {
    return undefined;
  }
  let user = 'root';
  let hostPort = token;
  const atIdx = token.indexOf('@');
  if (atIdx !== -1) {
    user = token.slice(0, atIdx).trim();
    hostPort = token.slice(atIdx + 1).trim();
    if (!user || !hostPort) {
      return undefined;
    }
  }
  let address = hostPort;
  let port = 22;
  const colonIdx = hostPort.lastIndexOf(':');
  if (colonIdx !== -1) {
    address = hostPort.slice(0, colonIdx).trim();
    const p = Number(hostPort.slice(colonIdx + 1).trim());
    if (!address || !Number.isInteger(p) || p < 1 || p > 65535) {
      return undefined;
    }
    port = p;
  }
  return {
    user,
    address,
    port,
    display: `${user}@${address}:${port}`,
  };
}

function fuzzyScoreLocal(candidate: string, needle: string, weight: number): number {
  if (!candidate || !needle) {
    return 0;
  }
  if (candidate === needle) {
    return weight * 3;
  }
  if (candidate.startsWith(needle)) {
    return weight * 2;
  }
  const subIdx = candidate.indexOf(needle);
  if (subIdx !== -1) {
    return weight + Math.max(0, 20 - subIdx);
  }
  // Subsequence fuzzy match
  if (needle.length < 2 || needle.length > candidate.length) {
    return 0;
  }
  let nIdx = 0;
  for (let i = 0; i < candidate.length && nIdx < needle.length; i++) {
    if (candidate[i] === needle[nIdx]) {
      nIdx++;
    }
  }
  return nIdx === needle.length ? Math.floor(weight / 2) : 0;
}

function searchHostsFuzzyLocal(hosts: HostSummary[], query: string): HostSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return hosts.map((host) => ({ host, score: 1, matchedFields: [] }));
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const out: HostSearchResult[] = [];
  for (const host of hosts) {
    let total = 0;
    let allMatched = true;
    const matchedFields: string[] = [];
    for (const tok of tokens) {
      let tokScore = 0;
      const nameScore = fuzzyScoreLocal(host.label.toLowerCase(), tok, 120);
      if (nameScore > 0) {
        tokScore += nameScore;
        matchedFields.push('name');
      }
      const addrScore = fuzzyScoreLocal(host.address.toLowerCase(), tok, 100);
      if (addrScore > 0) {
        tokScore += addrScore;
        matchedFields.push('address');
      }
      for (const tag of host.tags) {
        const tagScore = fuzzyScoreLocal(tag.toLowerCase(), tok, 90);
        if (tagScore > 0) {
          tokScore += tagScore;
          matchedFields.push(`tag:${tag}`);
        }
      }
      if (tokScore === 0) {
        allMatched = false;
        break;
      }
      total += tokScore;
    }
    if (allMatched && total > 0) {
      out.push({ host, score: total, matchedFields });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.host.label.localeCompare(b.host.label));
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
  SearchCommandPalette?: (query: string) => Promise<CommandPaletteResponse>;
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
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [paletteQuery, setPaletteQuery] = useState<string>('');
  const [palettePassword, setPalettePassword] = useState<string>('');
  const [paletteResponse, setPaletteResponse] = useState<CommandPaletteResponse>({
    query: '',
    hostResults: [],
  });

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShowCommandPalette(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!showCommandPalette) {
      return;
    }
    const api = getWailsBindings();
    if (api?.SearchCommandPalette && !vaultLocked) {
      void api
        .SearchCommandPalette(paletteQuery)
        .then((res) => setPaletteResponse(res))
        .catch(() => {
          setPaletteResponse({
            query: paletteQuery,
            hostResults: searchHostsFuzzyLocal(vaultSummary.hosts, paletteQuery),
            quickConnect: parseQuickConnectLocal(paletteQuery),
          });
        });
    } else {
      setPaletteResponse({
        query: paletteQuery,
        hostResults: searchHostsFuzzyLocal(vaultSummary.hosts, paletteQuery),
        quickConnect: parseQuickConnectLocal(paletteQuery),
      });
    }
  }, [showCommandPalette, paletteQuery, vaultSummary.hosts, vaultLocked]);

  const handleQuickConnectFromPalette = async (qc: QuickConnectTarget): Promise<void> => {
    setAddress(qc.address);
    setPort(String(qc.port));
    setUsername(qc.user);
    setShowCommandPalette(false);
    setPaletteQuery('');
    const api = getWailsBindings();
    if (!api) {
      setStatusMessage(`Quick Connect ready for ${qc.display}`);
      return;
    }
    setStatusMessage(`Connecting to ${qc.display}...`);
    try {
      const id = await api.ConnectSSH({
        address: qc.address,
        port: qc.port,
        username: qc.user,
        password: palettePassword,
        privateKey: '',
        passphrase: '',
        size: { cols: 120, rows: 34 },
      });
      setSessionId(id);
      setPalettePassword('');
      setStatusMessage(`Connected (${qc.display})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Connection failed: ${msg}`);
    }
  };

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
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setPaletteQuery('');
              setShowCommandPalette(true);
            }}
          >
            Command Palette (Ctrl+K)
          </button>
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

      {showCommandPalette && (
        <div className="modal-backdrop" role="dialog" aria-label="Command Palette">
          <div className="modal-card palette-card">
            <h2>Command Palette &amp; Quick Connect (F-02)</h2>
            <p>
              Fuzzy search saved hosts by <strong>Name</strong>, <strong>Address</strong>, or{' '}
              <strong>Tags</strong>, or type <code>user@host:port</code> to connect directly.
            </p>
            <input
              aria-label="Command Palette Input"
              placeholder="Search hosts, tags, or type user@host:port..."
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (paletteResponse.quickConnect) {
                    void handleQuickConnectFromPalette(paletteResponse.quickConnect);
                  } else if (paletteResponse.hostResults.length > 0) {
                    const topHost = paletteResponse.hostResults[0].host;
                    setShowCommandPalette(false);
                    setPaletteQuery('');
                    void handleConnectSavedHost(topHost);
                  }
                }
              }}
              autoFocus
            />

            {paletteResponse.quickConnect && (
              <div className="quick-unlock-box">
                <div className="palette-item-main">
                  <strong>Quick Connect: {paletteResponse.quickConnect.display}</strong>
                  <span>Direct SSH connection (Enter or click Connect)</span>
                </div>
                <input
                  aria-label="Quick Connect Password"
                  type="password"
                  placeholder="Password (optional)"
                  value={palettePassword}
                  onChange={(e) => setPalettePassword(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => {
                    if (paletteResponse.quickConnect) {
                      void handleQuickConnectFromPalette(paletteResponse.quickConnect);
                    }
                  }}
                >
                  Quick Connect {paletteResponse.quickConnect.display}
                </button>
              </div>
            )}

            <div className="palette-results" aria-label="Command Palette Results">
              {vaultLocked ? (
                <div className="info-banner">
                  Vault is currently locked. Unlock the vault to search saved hosts, or type{' '}
                  <code>user@host:port</code> above for direct Quick Connect.
                </div>
              ) : paletteResponse.hostResults.length === 0 ? (
                <p>No saved hosts match &ldquo;{paletteQuery}&rdquo;.</p>
              ) : (
                paletteResponse.hostResults.map((item) => (
                  <button
                    key={item.host.id}
                    type="button"
                    className="palette-item"
                    onClick={() => {
                      setShowCommandPalette(false);
                      setPaletteQuery('');
                      void handleConnectSavedHost(item.host);
                    }}
                  >
                    <div className="palette-item-main">
                      <strong>{item.host.label}</strong>
                      <span>
                        {item.host.effectiveUser}@{item.host.address}:{item.host.effectivePort}
                      </span>
                    </div>
                    <div className="palette-tags">
                      {item.host.tags.map((tag) => (
                        <span key={tag} className="tag-pill">
                          #{tag}
                        </span>
                      ))}
                      <span className="kbd-badge">Connect ↵</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCommandPalette(false)}
              >
                Close (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

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
