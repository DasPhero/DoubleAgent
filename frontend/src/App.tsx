import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppGlobalSettings,
  DEFAULT_SETTINGS,
  TerminalView,
  applySettingsToAllTerminals,
  changeTerminalFontSize,
  clearTerminalSearch,
  disposeTerminal,
  getSessionCwd,
  resetTerminalFontSize,
  searchTerminalNext,
  searchTerminalPrevious,
  setSessionCwd,
} from './components/TerminalView';
import { SignalAnalyzerView } from './components/SignalAnalyzerView';

const SETTINGS_STORAGE_KEY = 'doubleagent_global_settings_v1';

function loadSettingsFromStorage(): AppGlobalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // ignore local storage errors
  }
  return DEFAULT_SETTINGS;
}

function saveSettingsToStorage(settings: AppGlobalSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

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
  keyId?: string;
}

interface SshKeySummary {
  id: string;
  label: string;
  type: string;
  publicKey: string;
  fingerprint: string;
}

interface SSHConfigHostEntry {
  hostAlias: string;
  hostName: string;
  user: string;
  port: number;
  identityFile: string;
  proxyJump: string[];
}

interface SSHConfigParseResult {
  entries: SSHConfigHostEntry[];
  warnings: string[];
}

interface VaultSummary {
  groups: GroupRecord[];
  hosts: HostSummary[];
  identities: IdentitySummary[];
  keys?: SshKeySummary[];
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

export type SplitDirection = 'none' | 'horizontal' | 'vertical';

export type WorkspaceNode =
  | {
      type: 'pane';
      id: string;
      sessionId: string;
      hostId?: string;
      title: string;
      cwd?: string;
    }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      children: WorkspaceNode[];
    };

export interface PaneItem {
  id: string;
  sessionId: string;
  hostId?: string;
  title: string;
  cwd?: string;
}

export interface TabItem {
  id: string;
  title: string;
  hostId?: string;
  color?: string;
  rootNode: WorkspaceNode;
  activePaneId: string;
}

export const HOST_PALETTE = [
  '#0ea5e9', // Sky blue
  '#10b981', // Emerald green
  '#f59e0b', // Amber yellow
  '#f43f5e', // Rose red
  '#8b5cf6', // Violet purple
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#eab308', // Yellow
  '#6366f1', // Indigo
];

export function getEffectiveHostColor(
  hostId?: string,
  explicitColor?: string,
  label?: string
): string {
  if (explicitColor && explicitColor.trim()) {
    return explicitColor.trim();
  }
  const key = hostId || label || 'host-default';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return HOST_PALETTE[Math.abs(hash) % HOST_PALETTE.length];
}

export function collectPanes(node: WorkspaceNode | null): PaneItem[] {
  if (!node) {
    return [];
  }
  if (node.type === 'pane') {
    return [
      {
        id: node.id,
        sessionId: node.sessionId,
        hostId: node.hostId,
        title: node.title,
        cwd: node.cwd,
      },
    ];
  }
  return node.children.flatMap(collectPanes);
}

export function findPane(node: WorkspaceNode | null, paneId: string): PaneItem | null {
  if (!node) {
    return null;
  }
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }
  for (const child of node.children) {
    const found = findPane(child, paneId);
    if (found) {
      return found;
    }
  }
  return null;
}

export function splitPaneInTree(
  root: WorkspaceNode,
  targetPaneId: string,
  newPane: WorkspaceNode,
  direction: 'horizontal' | 'vertical'
): WorkspaceNode {
  if (root.type === 'pane') {
    if (root.id === targetPaneId) {
      return {
        type: 'split',
        id: `split-${newPane.id}`,
        direction,
        children: [root, newPane],
      };
    }
    return root;
  }

  const newChildren: WorkspaceNode[] = [];
  for (const child of root.children) {
    if (child.type === 'pane' && child.id === targetPaneId) {
      if (root.direction === direction) {
        newChildren.push(child, newPane);
      } else {
        newChildren.push({
          type: 'split',
          id: `split-${newPane.id}`,
          direction,
          children: [child, newPane],
        });
      }
    } else {
      newChildren.push(splitPaneInTree(child, targetPaneId, newPane, direction));
    }
  }
  return { ...root, children: newChildren };
}

export function removePaneFromTree(
  root: WorkspaceNode,
  targetPaneId: string
): WorkspaceNode | null {
  if (root.type === 'pane') {
    return root.id === targetPaneId ? null : root;
  }
  const remaining: WorkspaceNode[] = [];
  for (const child of root.children) {
    const updated = removePaneFromTree(child, targetPaneId);
    if (updated !== null) {
      remaining.push(updated);
    }
  }
  if (remaining.length === 0) {
    return null;
  }
  if (remaining.length === 1) {
    return remaining[0];
  }
  return { ...root, children: remaining };
}

function reorderTabsLocal(tabs: TabItem[], fromId: string, toId: string): TabItem[] {
  if (fromId === toId) {
    return tabs;
  }
  const fromIdx = tabs.findIndex((t) => t.id === fromId);
  const toIdx = tabs.findIndex((t) => t.id === toId);
  if (fromIdx === -1 || toIdx === -1) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

function cycleIndexLocal(current: number, length: number, delta: number): number {
  if (length <= 0) {
    return 0;
  }
  return (((current + delta) % length) + length) % length;
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
  sessionID?: string;
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
    keyId?: string;
  }) => Promise<void>;
  SaveHost: (host: {
    id: string;
    label: string;
    address: string;
    port: number;
    groupId: string;
    identityId: string;
    tags: string[];
    color?: string;
    favorite: boolean;
  }) => Promise<void>;
  DeleteHost: (hostId: string) => Promise<void>;
  GenerateSSHKey?: (label: string, keyType: string, passphrase: string) => Promise<SshKeySummary>;
  ImportSSHKey?: (label: string, rawPrivateKey: string, passphrase: string) => Promise<SshKeySummary>;
  DeleteSSHKey?: (keyId: string) => Promise<void>;
  ImportSSHConfig?: (configContent: string) => Promise<SSHConfigParseResult>;
  InjectSessionPassword?: (sessionId: string) => Promise<void>;
  DuplicateSession?: (sessionId: string, size: { cols: number; rows: number }) => Promise<string>;
  OpenTerminalWithOptions?: (
    targetSessionId: string,
    opts: {
      mode: string;
      workingDir: string;
      splitDir: string;
      size: { cols: number; rows: number };
    }
  ) => Promise<string>;
  ConnectSavedHost: (hostId: string, size: { cols: number; rows: number }) => Promise<string>;
  ConnectSSH: (req: {
    address: string;
    port: number;
    username: string;
    password: string;
    privateKey: string;
    passphrase: string;
    useAgent?: boolean;
    size: { cols: number; rows: number };
  }) => Promise<string>;
  ResolveHostKeyPrompt: (host: string, port: number, trust: boolean) => Promise<void>;
  WriteTerminal: (sessionId: string, data: string) => Promise<void>;
  ResizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>;
  DisconnectSession: (sessionId: string) => Promise<void>;
  OpenLocalTerminal?: (shellType: string, size: { cols: number; rows: number }) => Promise<string>;
  ListSerialPorts?: () => Promise<SerialPortInfo[]>;
  ConnectSerial?: (cfg: SerialConfig) => Promise<string>;
  SetSerialDTR?: (sessionId: string, state: boolean) => Promise<void>;
  SetSerialRTS?: (sessionId: string, state: boolean) => Promise<void>;
  SendSerialBreak?: (sessionId: string) => Promise<void>;
  AutoDetectSerial?: (port: string) => Promise<SerialAutoDetectResult>;
}

export interface SerialAutoDetectResult {
  port: string;
  baudRate: number;
  confidence: string;
  detected: boolean;
  message: string;
}

export interface SerialConfig {
  port: string;
  baudRate: number;
  dataBits: number;
  parity: 'none' | 'odd' | 'even' | 'mark' | 'space';
  stopBits: '1' | '1.5' | '2';
  flowControl: 'none' | 'hardware' | 'software';
  dtr: boolean;
  rts: boolean;
  localEcho: boolean;
  lineEnding: string;
}

export interface SerialPortInfo {
  port: string;
  description: string;
  manufacturer?: string;
  hardwareId?: string;
  deviceType?: string;
  isUsb?: boolean;
  isConnected?: boolean;
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

export function App({ initialLocked = false }: { initialLocked?: boolean } = {}): React.JSX.Element {
  const [vaultLocked, setVaultLocked] = useState<boolean>(initialLocked);
  const [vaultInitialized, setVaultInitialized] = useState<boolean>(!initialLocked);
  const [passwordless, setPasswordless] = useState<boolean>(!initialLocked);
  const [quickUnlockReady, setQuickUnlockReady] = useState<boolean>(false);
  const [helloPending, setHelloPending] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string>('');

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [serialDetecting, setSerialDetecting] = useState<boolean>(false);
  const [serialDetectResult, setSerialDetectResult] = useState<SerialAutoDetectResult | null>(null);
  const [activeSignalAnalyzers, setActiveSignalAnalyzers] = useState<Set<string>>(new Set());
  const lastRxDataRef = useRef<Map<string, string>>(new Map());
  const lastTxDataRef = useRef<Map<string, string>>(new Map());
  const [, setRxDataTicks] = useState<number>(0);
  const menuCloseTimerRef = useRef<number | null>(null);

  const handleMenuEnter = (menu: 'vault' | 'tools' | 'view'): void => {
    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
    setActiveDropdownMenu(menu);
  };

  const handleMenuMove = (): void => {
    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
  };

  const handleMenuLeave = (): void => {
    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current);
    }
    menuCloseTimerRef.current = window.setTimeout(() => {
      setActiveDropdownMenu(null);
      menuCloseTimerRef.current = null;
    }, 300);
  };

  const [showVaultModal, setShowVaultModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showAddHostModal, setShowAddHostModal] = useState<boolean>(false);
  const [showAddGroupModal, setShowAddGroupModal] = useState<boolean>(false);
  const [showKeychainModal, setShowKeychainModal] = useState<boolean>(false);
  const [showSSHConfigModal, setShowSSHConfigModal] = useState<boolean>(false);
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

  // Vault Hosts, Groups & Keys state (F-01, F-04)
  const [vaultSummary, setVaultSummary] = useState<VaultSummary>({
    groups: [],
    hosts: [],
    identities: [],
    keys: [],
  });
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Keychain form state (F-04)
  const [keyLabel, setKeyLabel] = useState<string>('');
  const [keyType, setKeyType] = useState<string>('ed25519');
  const [keyPassphrase, setKeyPassphrase] = useState<string>('');
  const [importKeyRaw, setImportKeyRaw] = useState<string>('');

  // ssh_config Import state (F-22)
  const [sshConfigText, setSshConfigText] = useState<string>('');
  const [sshConfigResult, setSshConfigResult] = useState<SSHConfigParseResult | null>(null);

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
  const [hostAuthMethod, setHostAuthMethod] = useState<string>('password');
  const [hostKeyId, setHostKeyId] = useState<string>('');
  const [hostPass, setHostPass] = useState<string>('');
  const [hostTags, setHostTags] = useState<string>('');
  const [hostColor, setHostColor] = useState<string>('');

  const [address, setAddress] = useState<string>('');
  const [port, setPort] = useState<string>('22');
  const [username, setUsername] = useState<string>('root');
  const [password, setPassword] = useState<string>('');
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    initialLocked
      ? 'Vault is locked (Dark Crimson Theme). Unlock your vault to switch to Teal and access saved hosts.'
      : 'Vault is unlocked (Teal Theme).'
  );
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptInfo | null>(null);

  // Top Bar Dropdowns & Tab Groups state (F-09)
  const [activeDropdownMenu, setActiveDropdownMenu] = useState<'vault' | 'tools' | 'view' | null>(
    null
  );
  const [groupTabsByHost, setGroupTabsByHost] = useState<boolean>(false);
  const [collapsedHostGroups, setCollapsedHostGroups] = useState<Set<string>>(new Set());

  const toggleHostGroupCollapse = (groupKey: string): void => {
    setCollapsedHostGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  // Serial / UART and Local Terminal State (F-23)
  const [showSerialModal, setShowSerialModal] = useState<boolean>(false);
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [serialLoading, setSerialLoading] = useState<boolean>(false);
  const [showSerialAdvanced, setShowSerialAdvanced] = useState<boolean>(false);
  const [serialConfig, setSerialConfig] = useState<SerialConfig>({
    port: 'COM1',
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: '1',
    flowControl: 'none',
    dtr: true,
    rts: true,
    localEcho: false,
    lineEnding: 'crlf',
  });
  const [serialPinStates, setSerialPinStates] = useState<
    Map<string, { dtr: boolean; rts: boolean }>
  >(new Map());

  // Global Settings state
  const [globalSettings, setGlobalSettings] = useState<AppGlobalSettings>(() =>
    loadSettingsFromStorage()
  );
  const [showGlobalSettingsModal, setShowGlobalSettingsModal] = useState<boolean>(false);
  const [paneFontSizes, setPaneFontSizes] = useState<Map<string, number>>(new Map());

  // Terminal Search state (F-11)
  const [searchOpenPanes, setSearchOpenPanes] = useState<Set<string>>(new Set());
  const [paneSearchStates, setPaneSearchStates] = useState<
    Map<
      string,
      {
        query: string;
        caseSensitive: boolean;
        wholeWord: boolean;
        regex: boolean;
        resultFound: boolean | null;
      }
    >
  >(new Map());

  const togglePaneSearch = useCallback((sid: string): void => {
    setSearchOpenPanes((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) {
        next.delete(sid);
        clearTerminalSearch(sid);
        focusersRef.current.get(sid)?.();
      } else {
        next.add(sid);
      }
      return next;
    });
  }, []);

  const closePaneSearch = useCallback((sid: string): void => {
    setSearchOpenPanes((prev) => {
      const next = new Set(prev);
      next.delete(sid);
      return next;
    });
    clearTerminalSearch(sid);
    focusersRef.current.get(sid)?.();
  }, []);

  const updatePaneSearchState = useCallback(
    (
      sid: string,
      partial: Partial<{
        query: string;
        caseSensitive: boolean;
        wholeWord: boolean;
        regex: boolean;
        resultFound: boolean | null;
      }>
    ): void => {
      setPaneSearchStates((prev) => {
        const next = new Map(prev);
        const curr = next.get(sid) || {
          query: '',
          caseSensitive: false,
          wholeWord: false,
          regex: false,
          resultFound: null,
        };
        next.set(sid, { ...curr, ...partial });
        return next;
      });
    },
    []
  );

  const executePaneSearch = useCallback(
    (
      sid: string,
      direction: 'next' | 'prev',
      stateOverride?: Partial<{
        query: string;
        caseSensitive: boolean;
        wholeWord: boolean;
        regex: boolean;
        resultFound: boolean | null;
      }>
    ): void => {
      const curr = {
        ...(paneSearchStates.get(sid) || {
          query: '',
          caseSensitive: false,
          wholeWord: false,
          regex: false,
          resultFound: null,
        }),
        ...stateOverride,
      };
      if (!curr.query) {
        clearTerminalSearch(sid);
        updatePaneSearchState(sid, { resultFound: null });
        return;
      }
      const fn = direction === 'next' ? searchTerminalNext : searchTerminalPrevious;
      const found = fn(sid, curr.query, {
        caseSensitive: curr.caseSensitive,
        wholeWord: curr.wholeWord,
        regex: curr.regex,
        incremental: true,
      });
      updatePaneSearchState(sid, { resultFound: found });
    },
    [paneSearchStates, updatePaneSearchState]
  );

  const handleUpdateSettings = (partial: Partial<AppGlobalSettings>): void => {
    setGlobalSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettingsToStorage(next);
      applySettingsToAllTerminals(next);
      return next;
    });
  };

  const handleResetSettings = (): void => {
    setGlobalSettings(DEFAULT_SETTINGS);
    saveSettingsToStorage(DEFAULT_SETTINGS);
    applySettingsToAllTerminals(DEFAULT_SETTINGS);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || null;
  const activeTabPanes = activeTab ? collectPanes(activeTab.rootNode) : [];
  const activePane =
    activeTabPanes.find((p) => p.id === activeTab?.activePaneId) || activeTabPanes[0] || null;
  const sessionId = activePane?.sessionId || null;

  const writersRef = useRef<Map<string, (chunk: string) => void>>(new Map());
  const pendingDataBuffers = useRef<Map<string, string[]>>(new Map());
  const focusersRef = useRef<Map<string, () => void>>(new Map());
  const tabCounterRef = useRef<number>(0);

  const openSessionTab = useCallback(
    (newSessionId: string, title: string, hostId?: string, explicitColor?: string): void => {
      tabCounterRef.current += 1;
      const seq = tabCounterRef.current;
      const tabId = `tab-${seq}`;
      const paneId = `pane-${seq}-1`;
      const color = getEffectiveHostColor(hostId, explicitColor, title);
      const newTab: TabItem = {
        id: tabId,
        title,
        hostId,
        color,
        rootNode: {
          type: 'pane',
          id: paneId,
          sessionId: newSessionId,
          hostId,
          title,
        },
        activePaneId: paneId,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
    },
    []
  );

  const registerWriter = useCallback((id: string, writeFn: (chunk: string) => void) => {
    writersRef.current.set(id, writeFn);
    const buffered = pendingDataBuffers.current.get(id);
    if (buffered && buffered.length > 0) {
      for (const chunk of buffered) {
        writeFn(chunk);
      }
      pendingDataBuffers.current.delete(id);
    }
  }, []);

  const registerFocuser = useCallback((id: string, focusFn: () => void) => {
    focusersRef.current.set(id, focusFn);
  }, []);

  const refreshVaultState = useCallback(async (): Promise<void> => {
    const api = getWailsBindings();
    if (!api) {
      return;
    }
    try {
      const st = await api.HealthCheck();
      if (st.vaultLocked && (st.passwordless || !st.vaultInitialized)) {
        try {
          if (!st.vaultInitialized) {
            await api.InitializeVault('');
          } else {
            await api.UnlockVault('');
          }
          const updatedSt = await api.HealthCheck();
          setVaultLocked(updatedSt.vaultLocked);
          setVaultInitialized(updatedSt.vaultInitialized);
          setPasswordless(updatedSt.passwordless);
          setQuickUnlockReady(updatedSt.quickUnlockReady);
          if (!updatedSt.vaultLocked) {
            const summary = await api.GetVaultSummary();
            setVaultSummary(summary);
          }
          return;
        } catch {
          // ignore auto-unlock errors
        }
      }
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
      const sid = payload.sessionId || payload.sessionID || '';
      if (sid) {
        lastRxDataRef.current.set(sid, payload.data);
        setRxDataTicks((prev) => prev + 1);
      }
      const writer = writersRef.current.get(sid);
      if (writer) {
        writer(payload.data);
      } else if (sid) {
        // Buffer incoming data so prompts or login banners arriving before TerminalView mounts are never lost
        const buf = pendingDataBuffers.current.get(sid) || [];
        buf.push(payload.data);
        pendingDataBuffers.current.set(sid, buf);
      }
    });

    const offPrompt = rt.EventsOn('ssh:hostkey-prompt', (raw: unknown) => {
      const info = raw as HostKeyPromptInfo;
      setHostKeyPrompt(info);
    });

    const offExit = rt.EventsOn('terminal:exit', (raw: unknown) => {
      let exitedId = '';
      if (typeof raw === 'string') {
        exitedId = raw;
      } else if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        exitedId = (obj.sessionId || obj.sessionID || '') as string;
      }
      if (!exitedId) {
        return;
      }
      writersRef.current.delete(exitedId);
      pendingDataBuffers.current.delete(exitedId);
      focusersRef.current.delete(exitedId);
      disposeTerminal(exitedId);
      setPaneFontSizes((prev) => {
        const next = new Map(prev);
        next.delete(exitedId);
        return next;
      });
      setTabs((prev) => {
        const nextTabs: TabItem[] = [];
        for (const t of prev) {
          const panes = collectPanes(t.rootNode);
          const matchingPane = panes.find((p) => p.sessionId === exitedId);
          if (!matchingPane) {
            nextTabs.push(t);
            continue;
          }
          const newRoot = removePaneFromTree(t.rootNode, matchingPane.id);
          if (newRoot) {
            const remainingPanes = collectPanes(newRoot);
            const nextActiveId = remainingPanes.some((p) => p.id === t.activePaneId)
              ? t.activePaneId
              : remainingPanes[0]?.id || '';
            nextTabs.push({
              ...t,
              rootNode: newRoot,
              activePaneId: nextActiveId,
            });
          }
        }
        return nextTabs;
      });
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setShowGlobalSettingsModal((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (activePane) {
          e.preventDefault();
          togglePaneSearch(activePane.sessionId);
        }
      } else if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowGlobalSettingsModal(false);
        setActiveDropdownMenu(null);
        if (searchOpenPanes.size > 0) {
          for (const sid of searchOpenPanes) {
            clearTerminalSearch(sid);
          }
          setSearchOpenPanes(new Set());
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0')
      ) {
        if (activePane) {
          e.preventDefault();
          if (e.key === '=' || e.key === '+') {
            const next = changeTerminalFontSize(activePane.sessionId, +1);
            setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, next)));
          } else if (e.key === '-' || e.key === '_') {
            const next = changeTerminalFontSize(activePane.sessionId, -1);
            setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, next)));
          } else if (e.key === '0') {
            resetTerminalFontSize(activePane.sessionId, globalSettings.fontSize);
            setPaneFontSizes((prev) =>
              new Map(prev.set(activePane.sessionId, globalSettings.fontSize))
            );
          }
        }
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        setTabs((currentTabs) => {
          if (currentTabs.length === 0) {
            return currentTabs;
          }
          setActiveTabId((currId) => {
            const idx = currentTabs.findIndex((t) => t.id === currId);
            const nextIdx = cycleIndexLocal(idx === -1 ? 0 : idx, currentTabs.length, delta);
            const nextTab = currentTabs[nextIdx];
            const panes = collectPanes(nextTab.rootNode);
            const pane =
              panes.find((p) => p.id === nextTab.activePaneId) || panes[0];
            if (pane) {
              setTimeout(() => focusersRef.current.get(pane.sessionId)?.(), 50);
            }
            return nextTab.id;
          });
          return currentTabs;
        });
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setTabs((currentTabs) =>
          currentTabs.map((t) => {
            if (t.id !== activeTabId) {
              return t;
            }
            const panes = collectPanes(t.rootNode);
            if (panes.length <= 1) {
              return t;
            }
            const idx = panes.findIndex((p) => p.id === t.activePaneId);
            const nextIdx = cycleIndexLocal(idx === -1 ? 0 : idx, panes.length, delta);
            const nextPane = panes[nextIdx];
            if (nextPane) {
              setTimeout(() => focusersRef.current.get(nextPane.sessionId)?.(), 50);
            }
            return { ...t, activePaneId: nextPane.id };
          })
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTabId, activePane, globalSettings.fontSize, togglePaneSearch, searchOpenPanes]);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.nav-menu-container')) {
        setActiveDropdownMenu(null);
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
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
      const matchedHost = vaultSummary.hosts.find(
        (h) => h.address.toLowerCase() === qc.address.toLowerCase()
      );
      openSessionTab(id, qc.display, matchedHost?.id, matchedHost?.color);
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

    if (hostUser.trim() || hostPass || hostAuthMethod !== 'password') {
      identityId = `id-${idSuffix}`;
      if (api) {
        await api.SaveIdentity({
          id: identityId,
          label: `${hostLabel.trim()} Identity`,
          username: hostUser.trim() || 'root',
          authMethod: hostAuthMethod,
          password: hostPass,
          keyId: hostAuthMethod === 'key' ? hostKeyId : undefined,
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
        color: hostColor,
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
            color: hostColor,
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
    setHostColor('');
    setShowAddHostModal(false);
  };

  const handleConnectSavedHost = async (host: HostSummary): Promise<void> => {
    const api = getWailsBindings();
    if (!api) {
      const previewId = `sess-preview-${host.id}-${Date.now()}`;
      openSessionTab(previewId, host.label, host.id, host.color);
      setStatusMessage(`Connected to ${host.label}`);
      return;
    }
    setStatusMessage(`Connecting to ${host.label} (${host.effectiveUser}@${host.address}:${host.effectivePort})...`);
    try {
      const id = await api.ConnectSavedHost(host.id, { cols: 120, rows: 34 });
      openSessionTab(id, host.label, host.id, host.color);
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
      const matchedHost = vaultSummary.hosts.find(
        (h) => h.address.toLowerCase() === address.trim().toLowerCase()
      );
      openSessionTab(id, `${username}@${address}:${port}`, matchedHost?.id, matchedHost?.color);
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
    lastTxDataRef.current.set(id, data);
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

  const handleFontSizeChange = useCallback((szId: string, sz: number): void => {
    setPaneFontSizes((prev) => new Map(prev.set(szId, sz)));
  }, []);

  const handleGenerateKey = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setModalError('');
    const label = keyLabel.trim() || `${keyType}-key`;
    const api = getWailsBindings();
    if (api?.GenerateSSHKey) {
      try {
        await api.GenerateSSHKey(label, keyType, keyPassphrase);
        await refreshVaultState();
        setKeyLabel('');
        setKeyPassphrase('');
        setStatusMessage(`Generated ${keyType.toUpperCase()} keypair "${label}" in Vault.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setModalError(`Key generation failed: ${msg}`);
      }
      return;
    }
    const mockKey: SshKeySummary = {
      id: `key-${Date.now()}`,
      label,
      type: keyType,
      publicKey: `ssh-${keyType} AAAAC3NzaC1lZDI1NTE5AAAAIMockKeyData ${label}`,
      fingerprint: 'SHA256:MockFingerprintKeychainF04',
    };
    setVaultSummary((prev) => ({
      ...prev,
      keys: [...(prev.keys || []), mockKey],
    }));
    setKeyLabel('');
    setKeyPassphrase('');
  };

  const handleImportKey = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setModalError('');
    const label = keyLabel.trim() || 'imported-key';
    const api = getWailsBindings();
    if (api?.ImportSSHKey) {
      try {
        await api.ImportSSHKey(label, importKeyRaw, keyPassphrase);
        await refreshVaultState();
        setKeyLabel('');
        setImportKeyRaw('');
        setKeyPassphrase('');
        setStatusMessage(`Imported SSH key "${label}" into Vault.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setModalError(`Key import failed: ${msg}`);
      }
      return;
    }
    const isPPK = importKeyRaw.includes('PuTTY-User-Key-File-');
    const mockKey: SshKeySummary = {
      id: `key-${Date.now()}`,
      label,
      type: isPPK ? 'ed25519 (ppk)' : 'ed25519',
      publicKey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIImportedKey ${label}`,
      fingerprint: 'SHA256:ImportedKeyFingerprintF04',
    };
    setVaultSummary((prev) => ({
      ...prev,
      keys: [...(prev.keys || []), mockKey],
    }));
    setKeyLabel('');
    setImportKeyRaw('');
    setKeyPassphrase('');
  };

  const handleCopyPublicKey = async (pubKey: string, label: string): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pubKey);
      }
    } catch {
      // Fallback if clipboard API restricted in test environment
    }
    setStatusMessage(`Copied public key for "${label}" to clipboard.`);
  };

  const handleImportSSHConfig = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setModalError('');
    const api = getWailsBindings();
    if (api?.ImportSSHConfig) {
      try {
        const res = await api.ImportSSHConfig(sshConfigText);
        setSshConfigResult(res);
        await refreshVaultState();
        setStatusMessage(`Imported ${res.entries.length} host(s) from ssh_config.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setModalError(`ssh_config import failed: ${msg}`);
      }
      return;
    }
    // Local parser fallback for preview / Vitest (F-22)
    const lines = sshConfigText.split('\n');
    const entries: SSHConfigHostEntry[] = [];
    const warnings: string[] = [];
    let curr: SSHConfigHostEntry | null = null;
    lines.forEach((raw, idx) => {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) return;
      const parts = line.split(/\s+/);
      const k = parts[0].toLowerCase();
      const v = parts.slice(1).join(' ');
      if (k === 'host') {
        if (curr && !curr.hostAlias.includes('*')) entries.push(curr);
        curr = {
          hostAlias: v,
          hostName: v,
          user: 'root',
          port: 22,
          identityFile: '',
          proxyJump: [],
        };
      } else if (curr) {
        if (k === 'hostname') curr.hostName = v;
        else if (k === 'user') curr.user = v;
        else if (k === 'port') curr.port = Number(v) || 22;
        else if (k === 'identityfile') curr.identityFile = v;
        else if (k === 'proxyjump') curr.proxyJump = v.split(',').map((s) => s.trim());
        else warnings.push(`Line ${idx + 1}: unsupported directive "${parts[0]}"`);
      }
    });
    if (curr && !(curr as SSHConfigHostEntry).hostAlias.includes('*')) {
      entries.push(curr);
    }
    setSshConfigResult({ entries, warnings });
    setVaultSummary((prev) => ({
      ...prev,
      hosts: [
        ...prev.hosts,
        ...entries.map((en, i) => ({
          id: `host-cfg-${Date.now()}-${i}`,
          label: en.hostAlias,
          address: en.hostName,
          effectivePort: en.port,
          effectiveUser: en.user,
          keepaliveSecs: 30,
          groupId: '',
          identityId: '',
          tags: ['ssh_config'],
          color: '',
          favorite: false,
        })),
      ],
    }));
  };

  const handleInjectPassword = async (): Promise<void> => {
    if (!sessionId) {
      return;
    }
    const api = getWailsBindings();
    if (!api?.InjectSessionPassword) {
      setStatusMessage('Password injected into active terminal session (no newline).');
      focusersRef.current.get(sessionId)?.();
      return;
    }
    try {
      await api.InjectSessionPassword(sessionId);
      setStatusMessage('Password injected into active terminal session (no newline).');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Password injection failed: ${msg}`);
    } finally {
      focusersRef.current.get(sessionId)?.();
    }
  };

  const handleOpenLocalTerminal = async (shellType: string): Promise<void> => {
    const api = getWailsBindings();
    let sid = `local-${shellType}-${Date.now()}`;
    if (api?.OpenLocalTerminal) {
      try {
        sid = await api.OpenLocalTerminal(shellType, { cols: 120, rows: 34 });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Failed to launch ${shellType}: ${msg}`);
        return;
      }
    }
    const title =
      shellType === 'cmd'
        ? 'Local (CMD)'
        : shellType === 'wsl'
          ? 'Local (WSL)'
          : 'Local (PowerShell)';
    openSessionTab(sid, title, undefined, '#10b981');
    setStatusMessage(`Started ${title} session.`);
  };

  const handleRefreshSerialPorts = async (): Promise<void> => {
    setSerialLoading(true);
    const api = getWailsBindings();
    if (api?.ListSerialPorts) {
      try {
        const ports = await api.ListSerialPorts();
        setSerialPorts(ports);
        if (ports.length > 0) {
          const active = ports.find((p) => p.isConnected);
          if (!ports.some((p) => p.port === serialConfig.port)) {
            setSerialConfig((prev) => ({ ...prev, port: active ? active.port : ports[0].port }));
          }
        }
      } catch {
        // ignore
      }
    }
    setSerialLoading(false);
  };

  const handleAutoDetectSerial = async (): Promise<void> => {
    setSerialDetecting(true);
    setSerialDetectResult(null);
    const api = getWailsBindings();
    if (api?.AutoDetectSerial) {
      try {
        const res = await api.AutoDetectSerial(serialConfig.port);
        setSerialDetectResult(res);
        if (res.detected || res.port) {
          setSerialConfig((prev) => ({
            ...prev,
            port: res.port,
            baudRate: res.baudRate,
          }));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setModalError(`Auto detect failed: ${msg}`);
      }
    } else {
      const detectedPort = serialConfig.port || (serialPorts[0]?.port ?? 'COM1');
      setSerialConfig((prev) => ({ ...prev, port: detectedPort, baudRate: 115200 }));
      setSerialDetectResult({
        port: detectedPort,
        baudRate: 115200,
        confidence: 'Standard (Port verified ready)',
        detected: true,
        message: `Auto-detected ${detectedPort} at standard 115200 baud.`,
      });
    }
    setSerialDetecting(false);
  };

  const handleOpenSerialModal = async (): Promise<void> => {
    setModalError('');
    setShowSerialModal(true);
    await handleRefreshSerialPorts();
  };

  const handleConnectSerial = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setModalError('');
    const api = getWailsBindings();
    let sid = `serial-${serialConfig.port}-${Date.now()}`;
    if (api?.ConnectSerial) {
      try {
        sid = await api.ConnectSerial(serialConfig);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setModalError(`Failed to connect to ${serialConfig.port}: ${msg}`);
        return;
      }
    }
    const title = `Serial (${serialConfig.port} @ ${serialConfig.baudRate})`;
    openSessionTab(sid, title, undefined, '#f59e0b');
    setSerialPinStates((prev) =>
      new Map(prev).set(sid, { dtr: serialConfig.dtr, rts: serialConfig.rts })
    );
    setShowSerialModal(false);
    setStatusMessage(`Connected to ${serialConfig.port} at ${serialConfig.baudRate} baud.`);
  };

  const handleToggleDTR = async (sid: string): Promise<void> => {
    const current = serialPinStates.get(sid) || { dtr: true, rts: true };
    const nextState = !current.dtr;
    const api = getWailsBindings();
    if (api?.SetSerialDTR) {
      try {
        await api.SetSerialDTR(sid, nextState);
      } catch {
        // ignore
      }
    }
    setSerialPinStates((prev) =>
      new Map(prev).set(sid, { ...current, dtr: nextState })
    );
  };

  const handleToggleRTS = async (sid: string): Promise<void> => {
    const current = serialPinStates.get(sid) || { dtr: true, rts: true };
    const nextState = !current.rts;
    const api = getWailsBindings();
    if (api?.SetSerialRTS) {
      try {
        await api.SetSerialRTS(sid, nextState);
      } catch {
        // ignore
      }
    }
    setSerialPinStates((prev) =>
      new Map(prev).set(sid, { ...current, rts: nextState })
    );
  };

  const handleSendSerialBreak = async (sid: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.SendSerialBreak) {
      try {
        await api.SendSerialBreak(sid);
        setStatusMessage(`Sent break signal on ${sid}.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Break failed: ${msg}`);
      }
    } else {
      setStatusMessage(`Sent break signal on ${sid}.`);
    }
  };

  const handleSplitPane = async (direction: 'horizontal' | 'vertical'): Promise<void> => {
    if (!activeTab || !activePane) {
      return;
    }
    const api = getWailsBindings();
    let newSessionId = `sess-split-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    if (api?.DuplicateSession) {
      try {
        newSessionId = await api.DuplicateSession(activePane.sessionId, { cols: 120, rows: 34 });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Split pane connection failed: ${msg}`);
        return;
      }
    }
    tabCounterRef.current += 1;
    const newPaneId = `pane-${tabCounterRef.current}`;
    const currentPanes = collectPanes(activeTab.rootNode);
    const baseTitle =
      activeTab.title
        .replace(/\s*\([^)]*Split[^)]*\)/gi, '')
        .trim() || activeTab.title;
    const splitLabel = direction === 'horizontal' ? 'H' : 'V';
    const newPane: WorkspaceNode = {
      type: 'pane',
      id: newPaneId,
      sessionId: newSessionId,
      hostId: activeTab.hostId,
      title: `${baseTitle} (${splitLabel}-Split #${currentPanes.length + 1})`,
    };
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) {
          return t;
        }
        const updatedRoot = splitPaneInTree(t.rootNode, activePane.id, newPane, direction);
        return {
          ...t,
          rootNode: updatedRoot,
          activePaneId: newPaneId,
        };
      })
    );
    setStatusMessage(
      `Split ${direction} created (${currentPanes.length + 1} panes in ${activeTab.title}).`
    );
    setTimeout(() => focusersRef.current.get(newSessionId)?.(), 50);
  };

  const handleOpenTerminalDirectory = async (
    mode: 'default' | 'current' | 'root',
    splitDir: 'none' | 'horizontal' | 'vertical' = 'none'
  ): Promise<void> => {
    if (!activeTab || !activePane) {
      return;
    }
    const api = getWailsBindings();
    const currentCwd = getSessionCwd(activePane.sessionId) || activePane.cwd || '';
    const targetDir = mode === 'default' ? '' : currentCwd;

    let newSessionId = `sess-${mode}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    if (api?.OpenTerminalWithOptions) {
      try {
        newSessionId = await api.OpenTerminalWithOptions(activePane.sessionId, {
          mode,
          workingDir: targetDir,
          splitDir,
          size: { cols: 120, rows: 34 },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Failed to open terminal (${mode}): ${msg}`);
        return;
      }
    } else if (api?.DuplicateSession) {
      try {
        newSessionId = await api.DuplicateSession(activePane.sessionId, { cols: 120, rows: 34 });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Duplicate session failed: ${msg}`);
        return;
      }
    }

    const baseTitle =
      activeTab.title
        .replace(/\s*\([^)]*Split[^)]*\)/gi, '')
        .replace(/\s*\([^)]*Dir[^)]*\)/gi, '')
        .replace(/\s*\([^)]*Root[^)]*\)/gi, '')
        .replace(/\s*\[[^\]]*\]/gi, '')
        .trim() || activeTab.title;

    let dirLabel = '';
    if (targetDir) {
      const parts = targetDir.split(/[/\\]/).filter(Boolean);
      dirLabel = parts.length > 0 ? parts[parts.length - 1] : targetDir;
    }

    const titleSuffix =
      mode === 'root'
        ? ` (Root${dirLabel ? `: ${dirLabel}` : ''})`
        : mode === 'current'
          ? ` [${dirLabel || 'CWD'}]`
          : ' (Default Dir)';

    if (splitDir === 'horizontal' || splitDir === 'vertical') {
      tabCounterRef.current += 1;
      const newPaneId = `pane-${tabCounterRef.current}`;
      const currentPanes = collectPanes(activeTab.rootNode);
      const splitLabel = splitDir === 'horizontal' ? 'H' : 'V';
      const newPane: WorkspaceNode = {
        type: 'pane',
        id: newPaneId,
        sessionId: newSessionId,
        hostId: activeTab.hostId,
        title: `${baseTitle} (${splitLabel}-Split #${currentPanes.length + 1})${titleSuffix}`,
        cwd: targetDir,
      };
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTab.id) {
            return t;
          }
          const updatedRoot = splitPaneInTree(t.rootNode, activePane.id, newPane, splitDir);
          return {
            ...t,
            rootNode: updatedRoot,
            activePaneId: newPaneId,
          };
        })
      );
      setStatusMessage(`Opened ${mode} terminal in split pane.`);
      setTimeout(() => focusersRef.current.get(newSessionId)?.(), 50);
    } else {
      openSessionTab(
        newSessionId,
        `${baseTitle}${titleSuffix}`,
        activeTab.hostId,
        mode === 'root' ? '#ef4444' : activeTab.color
      );
      setStatusMessage(
        mode === 'root'
          ? `Opened root terminal in current directory (${targetDir || '/'}).`
          : mode === 'current'
            ? `Opened terminal in current directory (${targetDir || '~'}).`
            : 'Opened terminal in default directory.'
      );
    }
  };

  const handleClosePane = async (tabId: string, paneId: string): Promise<void> => {
    const targetTab = tabs.find((t) => t.id === tabId);
    if (!targetTab) {
      return;
    }
    const targetPane = findPane(targetTab.rootNode, paneId);
    if (targetPane) {
      writersRef.current.delete(targetPane.sessionId);
      pendingDataBuffers.current.delete(targetPane.sessionId);
      focusersRef.current.delete(targetPane.sessionId);
      disposeTerminal(targetPane.sessionId);
      setPaneFontSizes((prev) => {
        const next = new Map(prev);
        next.delete(targetPane.sessionId);
        return next;
      });
      const api = getWailsBindings();
      if (api) {
        void api.DisconnectSession(targetPane.sessionId);
      }
    }
    setTabs((prev) => {
      const nextTabs: TabItem[] = [];
      for (const t of prev) {
        if (t.id !== tabId) {
          nextTabs.push(t);
          continue;
        }
        const newRoot = removePaneFromTree(t.rootNode, paneId);
        if (newRoot) {
          const remainingPanes = collectPanes(newRoot);
          const nextActiveId = remainingPanes.some((p) => p.id === t.activePaneId)
            ? t.activePaneId
            : remainingPanes[0]?.id || '';
          nextTabs.push({
            ...t,
            rootNode: newRoot,
            activePaneId: nextActiveId,
          });
        }
      }
      return nextTabs;
    });
    if (activeTabId === tabId) {
      const newRoot = removePaneFromTree(targetTab.rootNode, paneId);
      if (!newRoot) {
        const remainingTabs = tabs.filter((t) => t.id !== tabId);
        setActiveTabId(remainingTabs[0]?.id || null);
      }
    }
  };

  const handleCyclePaneFocus = (): void => {
    if (!activeTab) {
      return;
    }
    const panes = collectPanes(activeTab.rootNode);
    if (panes.length <= 1) {
      return;
    }
    const idx = panes.findIndex((p) => p.id === activeTab.activePaneId);
    const nextIdx = cycleIndexLocal(idx === -1 ? 0 : idx, panes.length, 1);
    const nextPane = panes[nextIdx];
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, activePaneId: nextPane.id } : t))
    );
    focusersRef.current.get(nextPane.sessionId)?.();
  };

  const handleCloseTab = async (tabId: string): Promise<void> => {
    const target = tabs.find((t) => t.id === tabId);
    if (!target) {
      return;
    }
    const targetPanes = collectPanes(target.rootNode);
    const api = getWailsBindings();
    for (const p of targetPanes) {
      writersRef.current.delete(p.sessionId);
      pendingDataBuffers.current.delete(p.sessionId);
      focusersRef.current.delete(p.sessionId);
      disposeTerminal(p.sessionId);
      setPaneFontSizes((prev) => {
        const next = new Map(prev);
        next.delete(p.sessionId);
        return next;
      });
      if (api) {
        void api.DisconnectSession(p.sessionId);
      }
    }
    const remaining = tabs.filter((t) => t.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[0]?.id || null);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    if (!activeTab || !activePane) {
      return;
    }
    await handleClosePane(activeTab.id, activePane.id);
    setStatusMessage('Disconnected.');
  };

  const renderWorkspaceNode = (
    node: WorkspaceNode,
    tab: TabItem,
    totalPanes: number
  ): React.JSX.Element => {
    if (node.type === 'pane') {
      const isPaneActive = node.id === tab.activePaneId;
      const currentSize = paneFontSizes.get(node.sessionId) || globalSettings.fontSize;
      return (
        <div
          key={node.id}
          className={`split-pane ${isPaneActive ? 'active' : ''}`}
          aria-label={`Pane ${node.title}`}
          onClick={() => {
            setTabs((prev) =>
              prev.map((t) => (t.id === tab.id ? { ...t, activePaneId: node.id } : t))
            );
            focusersRef.current.get(node.sessionId)?.();
          }}
        >
          <div className="split-pane-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, overflow: 'hidden' }}>
              <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {node.title}
              </span>
              {(node.cwd || getSessionCwd(node.sessionId)) && (
                <span
                  className="pane-cwd-pill"
                  title={`Current working directory: ${node.cwd || getSessionCwd(node.sessionId)}`}
                >
                  📂 {node.cwd || getSessionCwd(node.sessionId)}
                </span>
              )}
            </div>
            <div className="pane-header-actions">
              {node.sessionId.startsWith('serial-') && (
                <div className="serial-pin-controls">
                  <button
                    type="button"
                    className={`serial-pin-btn ${(serialPinStates.get(node.sessionId)?.dtr ?? true) ? 'active' : ''}`}
                    title="Toggle DTR (Data Terminal Ready)"
                    aria-label={`Toggle DTR for ${node.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleToggleDTR(node.sessionId);
                    }}
                  >
                    DTR
                  </button>
                  <button
                    type="button"
                    className={`serial-pin-btn ${(serialPinStates.get(node.sessionId)?.rts ?? true) ? 'active' : ''}`}
                    title="Toggle RTS (Request To Send)"
                    aria-label={`Toggle RTS for ${node.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleToggleRTS(node.sessionId);
                    }}
                  >
                    RTS
                  </button>
                  <button
                    type="button"
                    className="serial-break-btn"
                    title="Send hardware Break signal"
                    aria-label={`Send Break for ${node.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleSendSerialBreak(node.sessionId);
                    }}
                  >
                    ⚡ Break
                  </button>
                  <button
                    type="button"
                    className={`pane-signal-btn ${activeSignalAnalyzers.has(node.sessionId) ? 'active' : ''}`}
                    title="Toggle Saleae-style Signal & Logic Analyzer"
                    aria-label={`Toggle Signal Analyzer for ${node.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveSignalAnalyzers((prev) => {
                        const next = new Set(prev);
                        if (next.has(node.sessionId)) {
                          next.delete(node.sessionId);
                        } else {
                          next.add(node.sessionId);
                        }
                        return next;
                      });
                    }}
                  >
                    📈 Logic Analyzer
                  </button>
                </div>
              )}
              <div className="pane-zoom-group">
                <button
                  type="button"
                  className="pane-zoom-btn"
                  aria-label={`Zoom out ${node.title}`}
                  title="Zoom out (Ctrl -)"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = changeTerminalFontSize(node.sessionId, -1);
                    setPaneFontSizes((prev) => new Map(prev.set(node.sessionId, next)));
                  }}
                >
                  -
                </button>
                <span className="pane-font-badge" title="Font size (Ctrl + / -)">
                  {currentSize}px
                </span>
                <button
                  type="button"
                  className="pane-zoom-btn"
                  aria-label={`Zoom in ${node.title}`}
                  title="Zoom in (Ctrl +)"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = changeTerminalFontSize(node.sessionId, +1);
                    setPaneFontSizes((prev) => new Map(prev.set(node.sessionId, next)));
                  }}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className={`pane-search-btn ${searchOpenPanes.has(node.sessionId) ? 'active' : ''}`}
                aria-label={`Find in ${node.title}`}
                title="Find in terminal (Ctrl+F)"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePaneSearch(node.sessionId);
                }}
              >
                🔍 Find
              </button>
              {isPaneActive ? (
                <span className="pane-active-indicator">● Active</span>
              ) : (
                <span className="pane-inactive-hint">Click to focus</span>
              )}
              {totalPanes > 1 && (
                <button
                  type="button"
                  className="pane-close-btn"
                  aria-label={`Close Pane ${node.title}`}
                  title="Close Split Pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleClosePane(tab.id, node.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {searchOpenPanes.has(node.sessionId) &&
            (() => {
              const searchState = paneSearchStates.get(node.sessionId) || {
                query: '',
                caseSensitive: false,
                wholeWord: false,
                regex: false,
                resultFound: null,
              };
              return (
                <div
                  className="terminal-search-overlay"
                  role="search"
                  aria-label={`Search Bar ${node.title}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="search-input-wrapper">
                    <input
                      aria-label="Search Terminal"
                      placeholder="Find in terminal..."
                      autoFocus
                      value={searchState.query}
                      onChange={(e) => {
                        const q = e.target.value;
                        updatePaneSearchState(node.sessionId, { query: q });
                        executePaneSearch(node.sessionId, 'next', { query: q });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          executePaneSearch(node.sessionId, e.shiftKey ? 'prev' : 'next');
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          closePaneSearch(node.sessionId);
                        }
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    className="search-nav-btn"
                    aria-label="Previous Match"
                    title="Previous Match (Shift+Enter)"
                    onClick={() => executePaneSearch(node.sessionId, 'prev')}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="search-nav-btn"
                    aria-label="Next Match"
                    title="Next Match (Enter)"
                    onClick={() => executePaneSearch(node.sessionId, 'next')}
                  >
                    ▼
                  </button>

                  <button
                    type="button"
                    className={`search-opt-btn ${searchState.caseSensitive ? 'active' : ''}`}
                    aria-label="Match Case"
                    title="Match Case (Case Sensitive)"
                    onClick={() => {
                      const nextVal = !searchState.caseSensitive;
                      updatePaneSearchState(node.sessionId, { caseSensitive: nextVal });
                      executePaneSearch(node.sessionId, 'next', { caseSensitive: nextVal });
                    }}
                  >
                    Aa
                  </button>

                  <button
                    type="button"
                    className={`search-opt-btn ${searchState.wholeWord ? 'active' : ''}`}
                    aria-label="Match Whole Word"
                    title="Match Whole Word"
                    onClick={() => {
                      const nextVal = !searchState.wholeWord;
                      updatePaneSearchState(node.sessionId, { wholeWord: nextVal });
                      executePaneSearch(node.sessionId, 'next', { wholeWord: nextVal });
                    }}
                  >
                    \b
                  </button>

                  <button
                    type="button"
                    className={`search-opt-btn ${searchState.regex ? 'active' : ''}`}
                    aria-label="Use Regular Expression"
                    title="Use Regular Expression"
                    onClick={() => {
                      const nextVal = !searchState.regex;
                      updatePaneSearchState(node.sessionId, { regex: nextVal });
                      executePaneSearch(node.sessionId, 'next', { regex: nextVal });
                    }}
                  >
                    .*
                  </button>

                  {searchState.query && (
                    <span className="search-result-badge">
                      {searchState.resultFound === true
                        ? 'Found'
                        : searchState.resultFound === false
                          ? 'No match'
                          : ''}
                    </span>
                  )}

                  <button
                    type="button"
                    className="search-close-btn"
                    aria-label="Close Search"
                    title="Close Search (Escape)"
                    onClick={() => closePaneSearch(node.sessionId)}
                  >
                    ×
                  </button>
                </div>
              );
            })()}

          <TerminalView
            sessionId={node.sessionId}
            onInput={handleTerminalInput}
            onResize={handleTerminalResize}
            registerWriter={registerWriter}
            registerFocuser={registerFocuser}
            settings={globalSettings}
            onFontSizeChange={handleFontSizeChange}
            onToggleSearch={togglePaneSearch}
            onCwdChange={(sid, cwd) => {
              setSessionCwd(sid, cwd);
              setTabs((prev) =>
                prev.map((t) => {
                  if (t.id !== tab.id) {
                    return t;
                  }
                  const updateNodeCwd = (n: WorkspaceNode): WorkspaceNode => {
                    if (n.type === 'pane') {
                      if (n.sessionId === sid) {
                        return { ...n, cwd };
                      }
                      return n;
                    }
                    return { ...n, children: n.children.map(updateNodeCwd) };
                  };
                  return { ...t, rootNode: updateNodeCwd(t.rootNode) };
                })
              );
            }}
          />

          {node.sessionId.startsWith('serial-') && activeSignalAnalyzers.has(node.sessionId) && (
            <SignalAnalyzerView
              sessionId={node.sessionId}
              port={serialConfig.port}
              baudRate={serialConfig.baudRate}
              dtr={serialPinStates.get(node.sessionId)?.dtr ?? true}
              rts={serialPinStates.get(node.sessionId)?.rts ?? true}
              rxDataFeed={lastRxDataRef.current.get(node.sessionId)}
              txDataFeed={lastTxDataRef.current.get(node.sessionId)}
              onClose={() => {
                setActiveSignalAnalyzers((prev) => {
                  const next = new Set(prev);
                  next.delete(node.sessionId);
                  return next;
                });
              }}
            />
          )}
        </div>
      );
    }

    return (
      <div
        key={node.id}
        className={`split-container split-${node.direction}`}
        aria-label={`Split Container ${node.direction}`}
      >
        {node.children.map((child) => renderWorkspaceNode(child, tab, totalPanes))}
      </div>
    );
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
      className={`app-shell ${vaultLocked ? 'theme-locked' : `theme-unlocked theme-${globalSettings.colorTheme}`}`}
      aria-label="DoubleAgent Workspace"
    >
      <header className="app-header">
        <div className="brand-group">
          <h1>DoubleAgent</h1>
          <span className={`status-badge ${vaultLocked ? 'locked' : 'unlocked'}`}>
            {vaultLocked ? 'Vault Locked' : passwordless ? 'Vault Unlocked (No PW)' : 'Vault Unlocked'}
          </span>
          {vaultLocked && (
            <button type="button" className="btn-primary" onClick={handleOpenVaultButton}>
              {vaultInitialized ? 'Unlock Vault' : 'Set Up Vault'}
            </button>
          )}

          <nav className="nav-menu-bar" aria-label="Application Menu">
            {/* Vault Dropdown */}
            <div
              className="nav-menu-container"
              onMouseEnter={() => handleMenuEnter('vault')}
              onMouseMove={handleMenuMove}
              onMouseLeave={handleMenuLeave}
            >
              <button
                type="button"
                className={`nav-menu-trigger ${activeDropdownMenu === 'vault' ? 'active' : ''}`}
                aria-haspopup="true"
                aria-expanded={activeDropdownMenu === 'vault'}
                onClick={() =>
                  setActiveDropdownMenu((prev) => (prev === 'vault' ? null : 'vault'))
                }
              >
                <span>Vault</span>
                <span style={{ fontSize: '0.65rem' }}>▾</span>
              </button>
              {activeDropdownMenu === 'vault' && (
                <div
                  className="nav-dropdown-menu"
                  role="menu"
                  aria-label="Vault Menu"
                >
                  {vaultLocked ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        handleOpenVaultButton();
                      }}
                    >
                      <span>{vaultInitialized ? 'Unlock Vault' : 'Set Up Vault'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        void handleVaultLock();
                      }}
                    >
                      <span>Lock Vault</span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      setModalError('');
                      setShowSettingsModal(true);
                    }}
                  >
                    <span>Vault Security &amp; Hello (F-03)</span>
                  </button>
                  <div className="nav-dropdown-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      void handleResetVault();
                    }}
                  >
                    <span>Reset Vault</span>
                  </button>
                </div>
              )}
            </div>

            {/* Tools Dropdown */}
            <div
              className="nav-menu-container"
              onMouseEnter={() => handleMenuEnter('tools')}
              onMouseMove={handleMenuMove}
              onMouseLeave={handleMenuLeave}
            >
              <button
                type="button"
                className={`nav-menu-trigger ${activeDropdownMenu === 'tools' ? 'active' : ''}`}
                aria-haspopup="true"
                aria-expanded={activeDropdownMenu === 'tools'}
                onClick={() =>
                  setActiveDropdownMenu((prev) => (prev === 'tools' ? null : 'tools'))
                }
              >
                <span>Tools</span>
                <span style={{ fontSize: '0.65rem' }}>▾</span>
              </button>
              {activeDropdownMenu === 'tools' && (
                <div
                  className="nav-dropdown-menu"
                  role="menu"
                  aria-label="Tools Menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      setPaletteQuery('');
                      setShowCommandPalette(true);
                    }}
                  >
                    <span>Command Palette</span>
                    <span className="nav-dropdown-shortcut">Ctrl+K</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      setModalError('');
                      setShowKeychainModal(true);
                    }}
                  >
                    <span>Keychain</span>
                    <span className="nav-dropdown-shortcut">F-04</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      setModalError('');
                      setSshConfigResult(null);
                      setShowSSHConfigModal(true);
                    }}
                  >
                    <span>Import ssh_config</span>
                    <span className="nav-dropdown-shortcut">F-22</span>
                  </button>
                  <div className="nav-dropdown-divider" />
                  <div className="nav-dropdown-header">Local Terminals (F-23)</div>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      void handleOpenLocalTerminal('powershell');
                    }}
                  >
                    <span>Local Shell (PowerShell)</span>
                    <span className="nav-dropdown-shortcut">⚡ pwsh</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      void handleOpenLocalTerminal('cmd');
                    }}
                  >
                    <span>Local Shell (Command Prompt)</span>
                    <span className="nav-dropdown-shortcut">cmd</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      void handleOpenLocalTerminal('wsl');
                    }}
                  >
                    <span>Local Shell (WSL Linux)</span>
                    <span className="nav-dropdown-shortcut">🐧 wsl</span>
                  </button>
                  <div className="nav-dropdown-divider" />
                  <div className="nav-dropdown-header">Hardware Serial (F-23)</div>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      void handleOpenSerialModal();
                    }}
                  >
                    <span>Serial / UART Console (COM)</span>
                    <span className="nav-dropdown-shortcut">🔌 COM</span>
                  </button>
                  {activePane && (
                    <>
                      <div className="nav-dropdown-divider" />
                      <div className="nav-dropdown-header">New Terminal by Directory (F-10)</div>
                      <button
                        type="button"
                        role="menuitem"
                        className="nav-dropdown-item"
                        onClick={() => {
                          setActiveDropdownMenu(null);
                          void handleOpenTerminalDirectory('default');
                        }}
                      >
                        <span>New in Default Directory</span>
                        <span className="nav-dropdown-shortcut">🏠</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="nav-dropdown-item"
                        onClick={() => {
                          setActiveDropdownMenu(null);
                          void handleOpenTerminalDirectory('current');
                        }}
                      >
                        <span>New in Current Directory (CWD)</span>
                        <span className="nav-dropdown-shortcut">📂</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="nav-dropdown-item"
                        onClick={() => {
                          setActiveDropdownMenu(null);
                          void handleOpenTerminalDirectory('root');
                        }}
                      >
                        <span>New Root Shell in Current Directory</span>
                        <span className="nav-dropdown-shortcut">⚡ root</span>
                      </button>
                      <div className="nav-dropdown-divider" />
                      <button
                        type="button"
                        role="menuitem"
                        className="nav-dropdown-item"
                        onClick={() => {
                          setActiveDropdownMenu(null);
                          void handleInjectPassword();
                        }}
                      >
                        <span>Inject Password</span>
                        <span className="nav-dropdown-shortcut">🔑</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* View Dropdown */}
            <div
              className="nav-menu-container"
              onMouseEnter={() => handleMenuEnter('view')}
              onMouseMove={handleMenuMove}
              onMouseLeave={handleMenuLeave}
            >
              <button
                type="button"
                className={`nav-menu-trigger ${activeDropdownMenu === 'view' ? 'active' : ''}`}
                aria-haspopup="true"
                aria-expanded={activeDropdownMenu === 'view'}
                onClick={() =>
                  setActiveDropdownMenu((prev) => (prev === 'view' ? null : 'view'))
                }
              >
                <span>View</span>
                <span style={{ fontSize: '0.65rem' }}>▾</span>
              </button>
              {activeDropdownMenu === 'view' && (
                <div
                  className="nav-dropdown-menu"
                  role="menu"
                  aria-label="View Menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      setSidebarCollapsed((prev) => !prev);
                    }}
                  >
                    <span>{sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}</span>
                    <span className="nav-dropdown-shortcut">Ctrl+B</span>
                  </button>
                  <div className="nav-dropdown-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    disabled={!activePane}
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      void handleSplitPane('horizontal');
                    }}
                  >
                    <span>Split Horizontal</span>
                    <span className="nav-dropdown-shortcut">⬌</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    disabled={!activePane}
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      void handleSplitPane('vertical');
                    }}
                  >
                    <span>Split Vertical</span>
                    <span className="nav-dropdown-shortcut">⬍</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    disabled={!activePane}
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      if (activePane) {
                        togglePaneSearch(activePane.sessionId);
                      }
                    }}
                  >
                    <span>Find in Terminal</span>
                    <span className="nav-dropdown-shortcut">Ctrl+F</span>
                  </button>
                  <div className="nav-dropdown-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      setGroupTabsByHost((prev) => !prev);
                    }}
                  >
                    <span>Group Tabs by Host</span>
                    <span className="nav-dropdown-shortcut">
                      {groupTabsByHost ? '✓ Active' : 'Off'}
                    </span>
                  </button>
                  <div className="nav-dropdown-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    disabled={!activePane}
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      if (activePane) {
                        const next = changeTerminalFontSize(activePane.sessionId, +1);
                        setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, next)));
                      }
                    }}
                  >
                    <span>Zoom In Pane</span>
                    <span className="nav-dropdown-shortcut">Ctrl +</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    disabled={!activePane}
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      if (activePane) {
                        const next = changeTerminalFontSize(activePane.sessionId, -1);
                        setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, next)));
                      }
                    }}
                  >
                    <span>Zoom Out Pane</span>
                    <span className="nav-dropdown-shortcut">Ctrl -</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    disabled={!activePane}
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      if (activePane) {
                        resetTerminalFontSize(activePane.sessionId, globalSettings.fontSize);
                        setPaneFontSizes((prev) =>
                          new Map(prev.set(activePane.sessionId, globalSettings.fontSize))
                        );
                      }
                    }}
                  >
                    <span>Reset Pane Zoom</span>
                    <span className="nav-dropdown-shortcut">Ctrl 0</span>
                  </button>
                </div>
              )}
            </div>

            {/* Global Settings */}
            <button
              type="button"
              className="nav-menu-trigger"
              onClick={() => setShowGlobalSettingsModal(true)}
              title="Global Settings (Ctrl+,)"
              aria-label="Settings ⚙"
            >
              <span>Settings ⚙</span>
            </button>
          </nav>
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
        <aside
          className={`hosts-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
          aria-label="Hosts and Groups Sidebar"
        >
          {sidebarCollapsed ? (
            <div className="sidebar-collapsed-content">
              <button
                type="button"
                className="sidebar-expand-btn"
                onClick={() => setSidebarCollapsed(false)}
                title="Expand Sidebar (Ctrl+B)"
                aria-label="Expand Sidebar"
              >
                <span>▶</span>
                <span className="sidebar-vertical-title">Hosts &amp; Groups</span>
              </button>
            </div>
          ) : (
            <>
              {!vaultLocked && (
                <nav className="sidebar-menu-grid" aria-label="Workspace Modules">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setModalError('');
                      setShowKeychainModal(true);
                    }}
                  >
                    Keychain (F-04)
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setModalError('');
                      setSshConfigResult(null);
                      setShowSSHConfigModal(true);
                    }}
                  >
                    Import ssh_config
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setModalError('');
                      setShowSettingsModal(true);
                    }}
                  >
                    Vault Security
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setShowGlobalSettingsModal(true)}
                    title="Global Settings (Ctrl+,)"
                  >
                    Global Settings
                  </button>
                </nav>
              )}
              <div className="sidebar-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <h2>Hosts &amp; Groups</h2>
                  <button
                    type="button"
                    className="sidebar-toggle-btn"
                    onClick={() => setSidebarCollapsed(true)}
                    title="Collapse Sidebar (Ctrl+B)"
                    aria-label="Collapse Sidebar"
                  >
                    ◀
                  </button>
                </div>
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span
                                className="host-color-dot"
                                style={{
                                  backgroundColor: getEffectiveHostColor(h.id, h.color, h.label),
                                }}
                                title={`Host Color: ${getEffectiveHostColor(h.id, h.color, h.label)}`}
                              />
                              <strong>{h.label}</strong>
                            </div>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span
                            className="host-color-dot"
                            style={{
                              backgroundColor: getEffectiveHostColor(h.id, h.color, h.label),
                            }}
                            title={`Host Color: ${getEffectiveHostColor(h.id, h.color, h.label)}`}
                          />
                          <strong>{h.label}</strong>
                        </div>
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
        </>
      )}
    </aside>

        {tabs.length > 0 && activeTab && activePane ? (
          <section className="terminal-workspace" aria-label="Active Terminal Session">
            <div className="tabs-bar" role="tablist" aria-label="Session Tabs">
              {groupTabsByHost
                ? (() => {
                    const groupsMap = new Map<
                      string,
                      { key: string; label: string; color: string; tabs: TabItem[] }
                    >();
                    for (const t of tabs) {
                      const key = t.hostId || t.title;
                      const existing = groupsMap.get(key);
                      if (existing) {
                        existing.tabs.push(t);
                      } else {
                        groupsMap.set(key, {
                          key,
                          label: t.title.replace(/\s*\(.*\)$/, ''),
                          color: t.color || getEffectiveHostColor(t.hostId, undefined, t.title),
                          tabs: [t],
                        });
                      }
                    }

                    return Array.from(groupsMap.values()).map((grp) => {
                      const isCollapsed = collapsedHostGroups.has(grp.key);
                      const hasActive = grp.tabs.some((t) => t.id === activeTab.id);
                      return (
                        <div
                          key={grp.key}
                          className="tab-group-container"
                          aria-label={`Host Group ${grp.label}`}
                        >
                          <button
                            type="button"
                            className="tab-group-header"
                            onClick={() => toggleHostGroupCollapse(grp.key)}
                            title={`Toggle collapse for host group ${grp.label}`}
                            aria-label={`Toggle Group ${grp.label}`}
                          >
                            <span
                              className="host-color-dot"
                              style={{ backgroundColor: grp.color }}
                            />
                            <span>{grp.label}</span>
                            <span className="tab-group-badge">{grp.tabs.length}</span>
                            <span className={`tab-group-chevron ${isCollapsed ? 'collapsed' : ''}`}>
                              ▾
                            </span>
                          </button>

                          {(!isCollapsed || hasActive) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              {(isCollapsed
                                ? grp.tabs.filter((t) => t.id === activeTab.id)
                                : grp.tabs
                              ).map((tab) => {
                                const isActive = tab.id === activeTab.id;
                                const tabPanes = collectPanes(tab.rootNode);
                                const tabColor =
                                  tab.color ||
                                  getEffectiveHostColor(tab.hostId, undefined, tab.title);
                                return (
                                  <div
                                    key={tab.id}
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-label={`Tab ${tab.title}`}
                                    draggable
                                    className={`tab-pill ${isActive ? 'active' : ''}`}
                                    style={{ borderTop: `3px solid ${tabColor}` }}
                                    onDragStart={() => setDraggedTabId(tab.id)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => {
                                      if (draggedTabId && draggedTabId !== tab.id) {
                                        setTabs((prev) =>
                                          reorderTabsLocal(prev, draggedTabId, tab.id)
                                        );
                                      }
                                      setDraggedTabId(null);
                                    }}
                                    onClick={() => {
                                      setActiveTabId(tab.id);
                                      const pane =
                                        tabPanes.find((p) => p.id === tab.activePaneId) ||
                                        tabPanes[0];
                                      if (pane) {
                                        setTimeout(
                                          () => focusersRef.current.get(pane.sessionId)?.(),
                                          50
                                        );
                                      }
                                    }}
                                  >
                                    <span
                                      className="tab-dot"
                                      style={{
                                        backgroundColor: tabColor,
                                        boxShadow: `0 0 6px ${tabColor}`,
                                      }}
                                    />
                                    <span>{tab.title}</span>
                                    {tabPanes.length > 1 && <small>({tabPanes.length})</small>}
                                    <button
                                      type="button"
                                      className="tab-close-btn"
                                      aria-label={`Close Tab ${tab.title}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleCloseTab(tab.id);
                                      }}
                                    >
                                      ×
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()
                : tabs.map((tab) => {
                    const isActive = tab.id === activeTab.id;
                    const tabPanes = collectPanes(tab.rootNode);
                    const tabColor =
                      tab.color || getEffectiveHostColor(tab.hostId, undefined, tab.title);
                    return (
                      <div
                        key={tab.id}
                        role="tab"
                        aria-selected={isActive}
                        aria-label={`Tab ${tab.title}`}
                        draggable
                        className={`tab-pill ${isActive ? 'active' : ''}`}
                        style={{ borderTop: `3px solid ${tabColor}` }}
                        onDragStart={() => setDraggedTabId(tab.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedTabId && draggedTabId !== tab.id) {
                            setTabs((prev) => reorderTabsLocal(prev, draggedTabId, tab.id));
                          }
                          setDraggedTabId(null);
                        }}
                        onClick={() => {
                          setActiveTabId(tab.id);
                          const pane =
                            tabPanes.find((p) => p.id === tab.activePaneId) || tabPanes[0];
                          if (pane) {
                            setTimeout(() => focusersRef.current.get(pane.sessionId)?.(), 50);
                          }
                        }}
                      >
                        <span
                          className="tab-dot"
                          style={{
                            backgroundColor: tabColor,
                            boxShadow: `0 0 6px ${tabColor}`,
                          }}
                        />
                        <span>{tab.title}</span>
                        {tabPanes.length > 1 && <small>({tabPanes.length})</small>}
                        <button
                          type="button"
                          className="tab-close-btn"
                          aria-label={`Close Tab ${tab.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCloseTab(tab.id);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
              <div className="tabs-bar-controls">
                <button
                  type="button"
                  className={`tab-toggle-btn ${groupTabsByHost ? 'active' : ''}`}
                  title={groupTabsByHost ? 'Switch to ungrouped flat tabs' : 'Group tabs by host (F-09)'}
                  aria-label={groupTabsByHost ? 'Ungroup Tabs' : 'Group by Host'}
                  onClick={() => setGroupTabsByHost((prev) => !prev)}
                >
                  <span>{groupTabsByHost ? '⊟ Ungroup' : '⊞ Group by Host'}</span>
                </button>
              </div>
            </div>

            <div className="terminal-toolbar">
              <span>
                Active Session: <strong>{statusMessage}</strong>
              </span>
              <div className="terminal-toolbar-actions">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-label="Split Horizontal"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleSplitPane('horizontal')}
                  title="Split active pane horizontally (side-by-side)"
                >
                  Split ⬌
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-label="Split Vertical"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleSplitPane('vertical')}
                  title="Split active pane vertically (stacked)"
                >
                  Split ⬍
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-label="New Terminal Default Directory"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleOpenTerminalDirectory('default')}
                  title="Open new terminal in default working directory (F-10)"
                >
                  🏠 Default Dir
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-label="New Terminal Current Directory"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleOpenTerminalDirectory('current')}
                  title="Open new terminal in current working directory (F-10)"
                >
                  📂 Current Dir
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-label="New Terminal Root in Current Directory"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleOpenTerminalDirectory('root')}
                  title="Open new root / elevated terminal in current working directory (F-10)"
                >
                  ⚡ Root in Dir
                </button>
                {activeTabPanes.length > 1 && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    aria-label="Next Pane"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCyclePaneFocus}
                    title="Cycle keyboard focus to the next split pane (Alt+ArrowDown)"
                  >
                    Next Pane ⇥
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleInjectPassword()}
                  title="Injects the stored password directly from the Go Vault into the terminal without pressing Enter"
                >
                  Inject Password
                </button>
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => void handleDisconnect()}
                >
                  Disconnect
                </button>
              </div>
            </div>

            <div className="workspace-tabs-content" aria-label="Terminal Split Grid">
              {tabs.map((tab) => {
                const isCurrentTab = tab.id === activeTab.id;
                const tabPanes = collectPanes(tab.rootNode);
                return (
                  <div
                    key={tab.id}
                    className="tab-content-panel"
                    style={{ display: isCurrentTab ? 'flex' : 'none' }}
                    aria-hidden={!isCurrentTab}
                  >
                    {renderWorkspaceNode(tab.rootNode, tab, tabPanes.length)}
                  </div>
                );
              })}
            </div>
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
            <select
              aria-label="Host Auth Method"
              value={hostAuthMethod}
              onChange={(e) => setHostAuthMethod(e.target.value)}
            >
              <option value="password">Password (Vault Encrypted)</option>
              <option value="key">SSH Key from Keychain (F-04)</option>
              <option value="agent">Windows OpenSSH Agent / Pageant (F-05)</option>
            </select>
            {hostAuthMethod === 'password' && (
              <input
                aria-label="Host Password"
                type="password"
                placeholder="Password (stored encrypted in Vault)"
                value={hostPass}
                onChange={(e) => setHostPass(e.target.value)}
              />
            )}
            {hostAuthMethod === 'key' && (
              <select
                aria-label="Host SSH Key"
                value={hostKeyId}
                onChange={(e) => setHostKeyId(e.target.value)}
              >
                <option value="">Select Key from Keychain...</option>
                {(vaultSummary.keys || []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label} ({k.type} · {k.fingerprint})
                  </option>
                ))}
              </select>
            )}
            <input
              aria-label="Host Tags"
              placeholder="Tags (comma-separated, e.g. prod, linux)"
              value={hostTags}
              onChange={(e) => setHostTags(e.target.value)}
            />
            <div>
              <label
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.2rem',
                  display: 'block',
                }}
              >
                Host Color Tag (F-09)
              </label>
              <div className="color-picker-row" aria-label="Host Color Swatches">
                <button
                  type="button"
                  className={`color-swatch-btn color-swatch-auto ${!hostColor ? 'selected' : ''}`}
                  title="Auto (deterministic color based on host name)"
                  aria-label="Color Auto"
                  onClick={() => setHostColor('')}
                />
                {HOST_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-swatch-btn ${hostColor === c ? 'selected' : ''}`}
                    style={{ backgroundColor: c }}
                    title={c}
                    aria-label={`Color ${c}`}
                    onClick={() => setHostColor(c)}
                  />
                ))}
              </div>
            </div>
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

      {showKeychainModal && (
        <div className="modal-backdrop" role="dialog" aria-label="SSH Keychain">
          <div className="modal-card palette-card">
            <h2>SSH Keychain (F-04)</h2>
            <p>
              Generate <strong>Ed25519</strong> / <strong>RSA</strong> keys or import{' '}
              <strong>OpenSSH</strong> and <strong>PuTTY .ppk</strong> private keys into the encrypted Vault.
            </p>

            <form onSubmit={(e) => void handleGenerateKey(e)} className="sidebar-list">
              <input
                aria-label="Key Label"
                placeholder="Key Label (e.g. Work Laptop Ed25519)"
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                required
              />
              <select
                aria-label="Key Algorithm"
                value={keyType}
                onChange={(e) => setKeyType(e.target.value)}
              >
                <option value="ed25519">Ed25519 (Recommended)</option>
                <option value="rsa">RSA-3072</option>
              </select>
              <input
                aria-label="Key Passphrase"
                type="password"
                placeholder="Optional Key Passphrase"
                value={keyPassphrase}
                onChange={(e) => setKeyPassphrase(e.target.value)}
              />
              <textarea
                aria-label="Import Private Key Content"
                placeholder="Or paste OpenSSH PEM / PuTTY .ppk private key here to import..."
                value={importKeyRaw}
                onChange={(e) => setImportKeyRaw(e.target.value)}
              />
              <div className="modal-actions">
                {importKeyRaw.trim() ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={(e) => void handleImportKey(e)}
                  >
                    Import Key (.ppk / OpenSSH)
                  </button>
                ) : (
                  <button type="submit" className="btn-primary">
                    Generate Keypair
                  </button>
                )}
              </div>
            </form>

            {modalError && <div className="error-banner">{modalError}</div>}

            <div className="palette-results" aria-label="Saved SSH Keys">
              {(vaultSummary.keys || []).length === 0 ? (
                <p>No SSH keys stored in Vault yet.</p>
              ) : (
                (vaultSummary.keys || []).map((k) => (
                  <div key={k.id} className="host-card">
                    <div className="host-info">
                      <strong>
                        {k.label} ({k.type})
                      </strong>
                      <span>{k.fingerprint}</span>
                    </div>
                    <div className="host-card-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => void handleCopyPublicKey(k.publicKey, k.label)}
                      >
                        Copy Public Key
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowKeychainModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showSSHConfigModal && (
        <div className="modal-backdrop" role="dialog" aria-label="Import SSH Config">
          <form className="modal-card palette-card" onSubmit={(e) => void handleImportSSHConfig(e)}>
            <h2>Import OpenSSH Config (F-22)</h2>
            <p>
              Paste your <code>~/.ssh/config</code> below. Imports <strong>Host</strong>,{' '}
              <strong>HostName</strong>, <strong>User</strong>, <strong>Port</strong>,{' '}
              <strong>IdentityFile</strong>, and <strong>ProxyJump</strong>, and reports unsupported
              directives.
            </p>
            <textarea
              aria-label="SSH Config Content"
              placeholder="Host bastion&#10;  HostName 203.0.113.10&#10;  User ops&#10;  Port 2222"
              value={sshConfigText}
              onChange={(e) => setSshConfigText(e.target.value)}
              required
            />
            {sshConfigResult && (
              <div className="info-banner" aria-label="SSH Config Import Summary">
                <p>
                  Imported <strong>{sshConfigResult.entries.length}</strong> host(s).
                </p>
                {sshConfigResult.warnings.length > 0 && (
                  <ul aria-label="SSH Config Warnings">
                    {sshConfigResult.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {modalError && <div className="error-banner">{modalError}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowSSHConfigModal(false)}
              >
                Close
              </button>
              <button type="submit" className="btn-primary">
                Parse &amp; Import Config
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

      {showGlobalSettingsModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="Global Settings"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowGlobalSettingsModal(false);
            }
          }}
        >
          <div className="modal-card settings-card">
            <h2>Global Settings (F-08)</h2>
            <p>Customize terminal appearance, default font parameters, and color themes.</p>

            <div className="settings-grid">
              <section className="settings-section">
                <h3>Color Theme</h3>
                <div className="theme-options-grid">
                  {(
                    [
                      { id: 'teal', label: 'Teal (Cyber)', swatch: '#2dd4bf' },
                      { id: 'dracula', label: 'Dracula', swatch: '#bd93f9' },
                      { id: 'one-dark', label: 'One Dark', swatch: '#61afef' },
                      { id: 'nord', label: 'Nord', swatch: '#88c0d0' },
                      { id: 'monokai', label: 'Monokai Pro', swatch: '#ffd866' },
                      { id: 'crimson', label: 'Crimson', swatch: '#f43f5e' },
                    ] as const
                  ).map((th) => (
                    <button
                      key={th.id}
                      type="button"
                      className={`theme-card-btn ${globalSettings.colorTheme === th.id ? 'active' : ''}`}
                      onClick={() => handleUpdateSettings({ colorTheme: th.id })}
                    >
                      <span className="theme-swatch" style={{ backgroundColor: th.swatch }} />
                      <span>{th.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-section">
                <h3>Terminal Font &amp; Layout</h3>
                <div className="settings-field-row">
                  <label htmlFor="setting-font-family">Font Family</label>
                  <select
                    id="setting-font-family"
                    aria-label="Font Family"
                    value={globalSettings.fontFamily}
                    onChange={(e) => handleUpdateSettings({ fontFamily: e.target.value })}
                  >
                    <option value="'Cascadia Code', 'JetBrains Mono', Consolas, monospace">
                      Cascadia Code (Recommended)
                    </option>
                    <option value="'JetBrains Mono', Consolas, monospace">JetBrains Mono</option>
                    <option value="'Fira Code', Consolas, monospace">Fira Code</option>
                    <option value="Consolas, 'Courier New', monospace">Consolas</option>
                    <option value="'Source Code Pro', Consolas, monospace">Source Code Pro</option>
                    <option value="monospace">System Monospace</option>
                  </select>
                </div>

                <div className="settings-field-row">
                  <label htmlFor="setting-font-size">Default Font Size</label>
                  <input
                    id="setting-font-size"
                    aria-label="Default Font Size"
                    type="number"
                    min={9}
                    max={32}
                    value={globalSettings.fontSize}
                    onChange={(e) =>
                      handleUpdateSettings({ fontSize: Number(e.target.value) || 14 })
                    }
                  />
                </div>

                <div className="settings-field-row">
                  <label htmlFor="setting-line-height">Line Height</label>
                  <select
                    id="setting-line-height"
                    aria-label="Line Height"
                    value={globalSettings.lineHeight}
                    onChange={(e) =>
                      handleUpdateSettings({ lineHeight: Number(e.target.value) || 1.2 })
                    }
                  >
                    <option value="1.0">1.0 (Compact)</option>
                    <option value="1.1">1.1 (Standard)</option>
                    <option value="1.2">1.2 (Comfortable - Default)</option>
                    <option value="1.3">1.3 (Spacious)</option>
                    <option value="1.4">1.4 (Loose)</option>
                  </select>
                </div>

                <div className="settings-field-row">
                  <label htmlFor="setting-cursor-style">Cursor Style</label>
                  <select
                    id="setting-cursor-style"
                    aria-label="Cursor Style"
                    value={globalSettings.cursorStyle}
                    onChange={(e) =>
                      handleUpdateSettings({
                        cursorStyle: e.target.value as 'block' | 'underline' | 'bar',
                      })
                    }
                  >
                    <option value="block">Block</option>
                    <option value="underline">Underline</option>
                    <option value="bar">Bar</option>
                  </select>
                </div>

                <div className="settings-field-row">
                  <label htmlFor="setting-cursor-blink">Cursor Blink</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      id="setting-cursor-blink"
                      aria-label="Cursor Blink"
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={globalSettings.cursorBlink}
                      onChange={(e) => handleUpdateSettings({ cursorBlink: e.target.checked })}
                    />
                    <span>Blink cursor when active</span>
                  </label>
                </div>

                <div className="settings-field-row">
                  <label htmlFor="setting-scrollback">Scrollback Lines</label>
                  <select
                    id="setting-scrollback"
                    aria-label="Scrollback Lines"
                    value={globalSettings.scrollback}
                    onChange={(e) =>
                      handleUpdateSettings({ scrollback: Number(e.target.value) || 10000 })
                    }
                  >
                    <option value="5000">5,000 lines</option>
                    <option value="10000">10,000 lines (Default)</option>
                    <option value="20000">20,000 lines</option>
                    <option value="50000">50,000 lines</option>
                  </select>
                </div>
              </section>

              <section className="settings-section">
                <h3>Keyboard Shortcuts</h3>
                <table className="shortcuts-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Shortcut</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Global Settings</td>
                      <td><code>Ctrl + ,</code></td>
                    </tr>
                    <tr>
                      <td>Command Palette</td>
                      <td><code>Ctrl + K</code></td>
                    </tr>
                    <tr>
                      <td>Zoom In / Out Pane Font</td>
                      <td><code>Ctrl + +</code> / <code>Ctrl + -</code> or <code>Ctrl + Wheel</code></td>
                    </tr>
                    <tr>
                      <td>Reset Pane Font Size</td>
                      <td><code>Ctrl + 0</code></td>
                    </tr>
                    <tr>
                      <td>Cycle Active Tabs</td>
                      <td><code>Alt + ←</code> / <code>Alt + →</code></td>
                    </tr>
                    <tr>
                      <td>Cycle Active Panes</td>
                      <td><code>Alt + ↑</code> / <code>Alt + ↓</code></td>
                    </tr>
                    <tr>
                      <td>New Session Tab</td>
                      <td><code>Alt + N</code></td>
                    </tr>
                    <tr>
                      <td>Close Active Pane / Tab</td>
                      <td><code>Alt + W</code></td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleResetSettings}
                title="Restore default settings"
              >
                Reset to Defaults
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowGlobalSettingsModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {showSerialModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="Serial Connection"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSerialModal(false);
            }
          }}
        >
          <div className="modal-card">
            <h2>Serial / UART Console Connection (F-23)</h2>
            <form onSubmit={(e) => void handleConnectSerial(e)}>
              {modalError && <p className="status-banner error">{modalError}</p>}

              <label htmlFor="serial-port-select">
                Port / Device
                <div className="serial-port-row">
                  {serialPorts.length > 0 ? (
                    <select
                      id="serial-port-select"
                      aria-label="Serial Port Select"
                      value={serialConfig.port}
                      onChange={(e) =>
                        setSerialConfig((prev) => ({ ...prev, port: e.target.value }))
                      }
                    >
                      {serialPorts.some((p) => p.isConnected) && (
                        <optgroup label="🟢 Connected & Active Hardware">
                          {serialPorts
                            .filter((p) => p.isConnected)
                            .map((p) => (
                              <option key={p.port} value={p.port}>
                                {p.port} — {p.description} {p.isUsb ? '(USB 🟢)' : '(Active 🟢)'}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {serialPorts.some((p) => !p.isConnected) && (
                        <optgroup label="⚪ Available / Offline Ports">
                          {serialPorts
                            .filter((p) => !p.isConnected)
                            .map((p) => (
                              <option key={p.port} value={p.port}>
                                {p.port} — {p.description || 'Serial Port'} (Offline)
                              </option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                  ) : (
                    <input
                      id="serial-port-select"
                      aria-label="Serial Port Name"
                      type="text"
                      placeholder="e.g. COM1 or /dev/ttyUSB0"
                      value={serialConfig.port}
                      onChange={(e) =>
                        setSerialConfig((prev) => ({ ...prev, port: e.target.value }))
                      }
                      required
                    />
                  )}
                  <button
                    type="button"
                    className="serial-refresh-btn"
                    onClick={() => void handleRefreshSerialPorts()}
                    title="Refresh detected serial ports"
                    disabled={serialLoading}
                  >
                    {serialLoading ? '...' : '🔄 Refresh'}
                  </button>
                </div>

                {(() => {
                  const selectedPortInfo = serialPorts.find((p) => p.port === serialConfig.port);
                  if (selectedPortInfo) {
                    return (
                      <div className="serial-hardware-card">
                        <div className="serial-hw-header">
                          <span
                            className={`serial-hw-badge ${
                              selectedPortInfo.isConnected ? 'connected' : 'offline'
                            }`}
                          >
                            {selectedPortInfo.isConnected
                              ? '● Connected & Active'
                              : '○ Offline / No Device'}
                          </span>
                          <span className="serial-hw-type">
                            {selectedPortInfo.deviceType || 'Serial Port'}
                          </span>
                        </div>
                        <div className="serial-hw-body">
                          <div className="serial-hw-row">
                            <span className="serial-hw-label">Hardware:</span>
                            <span className="serial-hw-val">{selectedPortInfo.description}</span>
                          </div>
                          {selectedPortInfo.manufacturer && (
                            <div className="serial-hw-row">
                              <span className="serial-hw-label">Vendor:</span>
                              <span className="serial-hw-val">
                                {selectedPortInfo.manufacturer}
                              </span>
                            </div>
                          )}
                          {selectedPortInfo.hardwareId && (
                            <div className="serial-hw-row">
                              <span className="serial-hw-label">Hardware ID:</span>
                              <span className="serial-hw-val font-mono">
                                {selectedPortInfo.hardwareId}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  if (serialPorts.length === 0) {
                    return (
                      <div className="serial-no-ports-banner">
                        ℹ No active hardware detected. Connect your USB-UART adapter (FTDI, CP210x, CH340), Arduino, ESP32, or Raspberry Pi Pico, and click <strong>🔄 Refresh</strong>.
                      </div>
                    );
                  }
                  return null;
                })()}

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="serial-autodetect-btn"
                    onClick={() => void handleAutoDetectSerial()}
                    title="Probe and auto-detect COM port and baud rate"
                    disabled={serialDetecting}
                  >
                    {serialDetecting ? 'Probing...' : '⚡ Auto Detect Port & Baud'}
                  </button>
                  {serialDetectResult && (
                    <span className="serial-autodetect-badge">
                      {serialDetectResult.message} ({serialDetectResult.confidence})
                    </span>
                  )}
                </div>
              </label>

              <div className="form-grid-2col">
                <label htmlFor="serial-baud-rate">
                  Baud Rate
                  <select
                    id="serial-baud-rate"
                    aria-label="Baud Rate"
                    value={serialConfig.baudRate}
                    onChange={(e) =>
                      setSerialConfig((prev) => ({
                        ...prev,
                        baudRate: Number(e.target.value) || 115200,
                      }))
                    }
                  >
                    {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 2000000].map(
                      (b) => (
                        <option key={b} value={b}>
                          {b} baud
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label htmlFor="serial-line-ending">
                  Line Ending
                  <select
                    id="serial-line-ending"
                    aria-label="Line Ending"
                    value={serialConfig.lineEnding}
                    onChange={(e) =>
                      setSerialConfig((prev) => ({ ...prev, lineEnding: e.target.value }))
                    }
                  >
                    <option value="crlf">CRLF (\r\n)</option>
                    <option value="lf">LF (\n)</option>
                    <option value="cr">CR (\r)</option>
                  </select>
                </label>
              </div>

              <button
                type="button"
                className="advanced-toggle-btn"
                onClick={() => setShowSerialAdvanced((prev) => !prev)}
              >
                <span>{showSerialAdvanced ? '▼' : '►'}</span>
                <span>Advanced Parameters (Data Bits, Parity, Stop Bits, Flow Control)</span>
              </button>

              {showSerialAdvanced && (
                <div className="advanced-serial-panel">
                  <div className="form-grid-3col">
                    <label htmlFor="serial-data-bits">
                      Data Bits
                      <select
                        id="serial-data-bits"
                        aria-label="Data Bits"
                        value={serialConfig.dataBits}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({
                            ...prev,
                            dataBits: Number(e.target.value) || 8,
                          }))
                        }
                      >
                        <option value={8}>8 bits (standard)</option>
                        <option value={7}>7 bits</option>
                        <option value={6}>6 bits</option>
                        <option value={5}>5 bits</option>
                      </select>
                    </label>

                    <label htmlFor="serial-parity">
                      Parity
                      <select
                        id="serial-parity"
                        aria-label="Parity"
                        value={serialConfig.parity}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({
                            ...prev,
                            parity: e.target.value as SerialConfig['parity'],
                          }))
                        }
                      >
                        <option value="none">None (N)</option>
                        <option value="odd">Odd (O)</option>
                        <option value="even">Even (E)</option>
                        <option value="mark">Mark (M)</option>
                        <option value="space">Space (S)</option>
                      </select>
                    </label>

                    <label htmlFor="serial-stop-bits">
                      Stop Bits
                      <select
                        id="serial-stop-bits"
                        aria-label="Stop Bits"
                        value={serialConfig.stopBits}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({
                            ...prev,
                            stopBits: e.target.value as SerialConfig['stopBits'],
                          }))
                        }
                      >
                        <option value="1">1 stop bit</option>
                        <option value="1.5">1.5 stop bits</option>
                        <option value="2">2 stop bits</option>
                      </select>
                    </label>
                  </div>

                  <label htmlFor="serial-flow-control">
                    Flow Control
                    <select
                      id="serial-flow-control"
                      aria-label="Flow Control"
                      value={serialConfig.flowControl}
                      onChange={(e) =>
                        setSerialConfig((prev) => ({
                          ...prev,
                          flowControl: e.target.value as SerialConfig['flowControl'],
                        }))
                      }
                    >
                      <option value="none">None</option>
                      <option value="hardware">Hardware (RTS / CTS)</option>
                      <option value="software">Software (XON / XOFF)</option>
                    </select>
                  </label>

                  <div className="checkbox-row">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={serialConfig.dtr}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({ ...prev, dtr: e.target.checked }))
                        }
                      />
                      Initial DTR ON
                    </label>

                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={serialConfig.rts}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({ ...prev, rts: e.target.checked }))
                        }
                      />
                      Initial RTS ON
                    </label>

                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={serialConfig.localEcho}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({ ...prev, localEcho: e.target.checked }))
                        }
                      />
                      Local Echo
                    </label>
                  </div>
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: '0.8rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowSerialModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Connect Serial
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
