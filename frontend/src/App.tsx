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
import { SftpBrowserView } from './components/SftpBrowserView';
import { PortForwardingView } from './components/PortForwardingView';
import { SettingsView } from './components/SettingsView';
import { ProxyProfilesView } from './components/ProxyProfilesView';
import { ProxychainsExportModal } from './components/ProxychainsExportModal';
import { FileItem, TransferTask } from './types/sftp';
import { ForwardRule, ForwardTunnelStatus } from './types/forward';
import { ProxyProfile, ProxyProfileSummary, ProxychainsExportOptions } from './types/proxy';
import { Snippet, SnippetContext } from './types/snippet';
import { SnippetsManagerModal } from './components/SnippetsManagerModal';
import { SnippetRunModal } from './components/SnippetRunModal';
import { TotpSummary, TotpRecord, TotpCodeResponse } from './types/totp';
import { TotpManagerModal } from './components/TotpManagerModal';
import { NotePage, NotePageSummary, NoteSearchResult } from './types/note';
import { NotesView } from './components/NotesView';
import { HostNotesDrawer } from './components/HostNotesDrawer';
import { SessionLogRecord, SessionLogStatus } from './types/sessionLog';
import { SessionLogsModal } from './components/SessionLogsModal';
import { BroadcastScope, BroadcastState } from './types/broadcast';
import { CyberIcon } from './components/CyberIcon';
import {
  CustomShortcutItem,
  SYSTEM_SHORTCUTS,
  ShortcutActionId,
  matchesShortcut,
} from './types/shortcuts';
import appLogo from './assets/DoubleAgent_App_Logo.png';
import brandLogoText from './assets/DoubleAgent_Logo_complete_with_text.png';

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
  initialDir?: string;
  keepaliveSecs?: number;
  proxyProfileId?: string;
  sessionLogging?: boolean;
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
  initialDir?: string;
  keepaliveSecs: number;
  groupId: string;
  identityId: string;
  tags: string[];
  color: string;
  favorite: boolean;
  proxyProfileId?: string;
  proxyCommand?: string;
  jumpChain?: string[];
  sessionLogging?: boolean;
}

interface IdentitySummary {
  id: string;
  label: string;
  username: string;
  authMethod: string;
  keyId?: string;
  totpId?: string;
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
  proxyProfiles?: ProxyProfileSummary[];
  snippets?: Snippet[];
  totpRecords?: TotpSummary[];
  notes?: NotePageSummary[];
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

export type DockablePaneType = 'terminal' | 'notes' | 'totp' | 'sftp' | 'snippets';

export type DropZonePosition = 'left' | 'right' | 'top' | 'bottom' | 'center';

export type WorkspaceDragPayload =
  | { type: 'pane'; tabId: string; paneId: string; title: string }
  | { type: 'tab'; tabId: string; title: string }
  | { type: 'host'; hostId: string; label: string }
  | {
      type: 'tool';
      toolType:
        | 'notes'
        | 'totp'
        | 'sftp'
        | 'snippets'
        | 'local-powershell'
        | 'local-cmd'
        | 'local-bash';
      hostId?: string;
      title: string;
    };

export type WorkspaceNode =
  | {
      type: 'pane';
      id: string;
      sessionId: string;
      hostId?: string;
      title: string;
      cwd?: string;
      paneType?: DockablePaneType;
      notesHostId?: string;
      sftpSessionId?: string;
    }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      children: WorkspaceNode[];
      ratios?: number[];
    };

export interface PaneItem {
  id: string;
  sessionId: string;
  hostId?: string;
  title: string;
  cwd?: string;
  paneType?: DockablePaneType;
  notesHostId?: string;
  sftpSessionId?: string;
}

export interface TabItem {
  id: string;
  title: string;
  hostId?: string;
  color?: string;
  rootNode: WorkspaceNode;
  activePaneId: string;
  tabType?: 'terminal' | 'sftp' | 'settings' | 'notes';
  sftpSessionId?: string;
  notesHostId?: string;
  notesInitialNoteId?: string | null;
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
        paneType: node.paneType,
        notesHostId: node.notesHostId,
        sftpSessionId: node.sftpSessionId,
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

export function findPaneNode(
  node: WorkspaceNode | null,
  paneId: string
): Extract<WorkspaceNode, { type: 'pane' }> | null {
  if (!node) {
    return null;
  }
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }
  for (const child of node.children) {
    const found = findPaneNode(child, paneId);
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
        ratios: [50, 50],
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
          ratios: [50, 50],
        });
      }
    } else {
      newChildren.push(splitPaneInTree(child, targetPaneId, newPane, direction));
    }
  }
  const equalRatios = newChildren.map(() => 100 / newChildren.length);
  return { ...root, children: newChildren, ratios: equalRatios };
}

export function dockNodeInTree(
  root: WorkspaceNode,
  targetPaneId: string,
  nodeToInsert: WorkspaceNode,
  zone: Exclude<DropZonePosition, 'center'>
): WorkspaceNode {
  const direction: 'horizontal' | 'vertical' =
    zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
  const insertBefore = zone === 'left' || zone === 'top';

  if (root.type === 'pane') {
    if (root.id === targetPaneId) {
      return {
        type: 'split',
        id: `split-${nodeToInsert.id}-${Date.now()}`,
        direction,
        children: insertBefore ? [nodeToInsert, root] : [root, nodeToInsert],
        ratios: [50, 50],
      };
    }
    return root;
  }

  const newChildren: WorkspaceNode[] = [];
  let insertedDirectly = false;
  for (const child of root.children) {
    if (child.type === 'pane' && child.id === targetPaneId && root.direction === direction) {
      if (insertBefore) {
        newChildren.push(nodeToInsert, child);
      } else {
        newChildren.push(child, nodeToInsert);
      }
      insertedDirectly = true;
    } else if (child.type === 'pane' && child.id === targetPaneId) {
      newChildren.push({
        type: 'split',
        id: `split-${nodeToInsert.id}-${Date.now()}`,
        direction,
        children: insertBefore ? [nodeToInsert, child] : [child, nodeToInsert],
        ratios: [50, 50],
      });
    } else {
      newChildren.push(dockNodeInTree(child, targetPaneId, nodeToInsert, zone));
    }
  }

  const equalRatios = newChildren.map(() => 100 / newChildren.length);
  return {
    ...root,
    children: newChildren,
    ratios: insertedDirectly
      ? equalRatios
      : root.ratios && root.ratios.length === newChildren.length
        ? root.ratios
        : equalRatios,
  };
}

export function swapPanesInTree(
  root: WorkspaceNode,
  paneIdA: string,
  paneIdB: string
): WorkspaceNode {
  if (paneIdA === paneIdB) return root;
  const paneA = findPaneNode(root, paneIdA);
  const paneB = findPaneNode(root, paneIdB);
  if (!paneA || !paneB) return root;

  const replaceRec = (node: WorkspaceNode): WorkspaceNode => {
    if (node.type === 'pane') {
      if (node.id === paneIdA) return { ...paneB };
      if (node.id === paneIdB) return { ...paneA };
      return node;
    }
    return {
      ...node,
      children: node.children.map(replaceRec),
    };
  };
  return replaceRec(root);
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
  const equalRatios = remaining.map(() => 100 / remaining.length);
  return { ...root, children: remaining, ratios: equalRatios };
}

export function movePaneInTree(
  root: WorkspaceNode,
  sourcePaneId: string,
  targetPaneId: string,
  zone: DropZonePosition
): WorkspaceNode {
  if (sourcePaneId === targetPaneId) return root;
  if (zone === 'center') {
    return swapPanesInTree(root, sourcePaneId, targetPaneId);
  }
  const sourceNode = findPaneNode(root, sourcePaneId);
  if (!sourceNode) return root;
  const withoutSource = removePaneFromTree(root, sourcePaneId);
  if (!withoutSource) return root;
  return dockNodeInTree(withoutSource, targetPaneId, sourceNode, zone);
}

export function updateSplitRatiosInTree(
  root: WorkspaceNode,
  splitId: string,
  newRatios: number[]
): WorkspaceNode {
  if (root.type === 'pane') return root;
  if (root.id === splitId) {
    return { ...root, ratios: newRatios };
  }
  return {
    ...root,
    children: root.children.map((c) => updateSplitRatiosInTree(c, splitId, newRatios)),
  };
}

export function equalizeAllSplitsInTree(root: WorkspaceNode): WorkspaceNode {
  if (root.type === 'pane') return root;
  const equalRatios = root.children.map(() => 100 / root.children.length);
  return {
    ...root,
    ratios: equalRatios,
    children: root.children.map(equalizeAllSplitsInTree),
  };
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
    initialDir?: string;
    tags: string[];
    color?: string;
    favorite: boolean;
    proxyProfileId?: string;
    proxyCommand?: string;
    jumpChain?: string[];
    sessionLogging?: boolean;
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
  ListLocalDir?: (path: string) => Promise<FileItem[]>;
  ListRemoteDir?: (sessionId: string, path: string) => Promise<FileItem[]>;
  StartSftpUpload?: (sessionId: string, localPath: string, remotePath: string) => Promise<string>;
  StartSftpDownload?: (sessionId: string, remotePath: string, localPath: string) => Promise<string>;
  CancelTransfer?: (taskId: string) => Promise<void>;
  CreateRemoteDir?: (sessionId: string, path: string) => Promise<void>;
  DeleteRemoteItem?: (sessionId: string, path: string) => Promise<void>;
  GetActiveTransfers?: () => Promise<TransferTask[]>;
  SaveForwardRule?: (rule: ForwardRule) => Promise<void>;
  DeleteForwardRule?: (ruleId: string) => Promise<void>;
  ListForwardRules?: () => Promise<ForwardRule[]>;
  StartForwardTunnel?: (sessionId: string, ruleId: string) => Promise<string>;
  StopForwardTunnel?: (tunnelId: string) => Promise<void>;
  GetActiveTunnels?: () => Promise<ForwardTunnelStatus[]>;
  SaveProxyProfile?: (profile: ProxyProfile) => Promise<void>;
  DeleteProxyProfile?: (profileId: string) => Promise<void>;
  ListProxyProfiles?: () => Promise<ProxyProfileSummary[]>;
  GetDefaultProxychainsOptions?: () => Promise<ProxychainsExportOptions>;
  GenerateProxychainsConfig?: (opts: ProxychainsExportOptions) => Promise<string>;
  ExportProxychainsConfig?: () => Promise<string>;
  SaveProxychainsFile?: (content: string, targetPath: string) => Promise<void>;
  SaveSnippet?: (snippet: Snippet) => Promise<void>;
  DeleteSnippet?: (snippetId: string) => Promise<void>;
  ListSnippets?: () => Promise<Snippet[]>;
  GetSnippetContext?: (sessionId: string) => Promise<SnippetContext>;
  ResolveSnippetTemplate?: (snippetId: string, sessionId: string, userValues: Record<string, string>) => Promise<string>;
  ExecuteSnippet?: (sessionId: string, snippetId: string, userValues: Record<string, string>) => Promise<void>;
  SaveTotpRecord?: (record: TotpRecord) => Promise<void>;
  DeleteTotpRecord?: (totpId: string) => Promise<void>;
  ListTotpRecords?: () => Promise<TotpSummary[]>;
  GetTotpCode?: (totpId: string) => Promise<TotpCodeResponse>;
  GetAllTotpCodes?: () => Promise<TotpCodeResponse[]>;
  ParseOTPAuthURI?: (uri: string) => Promise<TotpRecord>;
  InjectTotpCode?: (sessionId: string, totpId: string) => Promise<void>;
  SaveNote?: (note: NotePage) => Promise<NotePage>;
  DeleteNote?: (noteId: string) => Promise<void>;
  ListNotes?: (hostId: string) => Promise<NotePage[]>;
  GetNote?: (noteId: string) => Promise<NotePage>;
  SearchNotes?: (query: string) => Promise<NoteSearchResult[]>;
  StartSessionLogging?: (sessionId: string) => Promise<SessionLogStatus>;
  StopSessionLogging?: (sessionId: string) => Promise<SessionLogStatus>;
  GetSessionLogStatus?: (sessionId: string) => Promise<SessionLogStatus>;
  ListSessionLogs?: () => Promise<SessionLogRecord[]>;
  ReadSessionLog?: (logId: string) => Promise<string>;
  DeleteSessionLog?: (logId: string) => Promise<void>;
  ExportSessionLog?: (logId: string, targetPath: string) => Promise<void>;
  BroadcastInput?: (sessionIDs: string[], data: string) => Promise<void>;
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
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('doubleagent_sidebar_width');
        const parsed = saved ? parseInt(saved, 10) : 280;
        return Number.isFinite(parsed) && parsed >= 180 && parsed <= 650 ? parsed : 280;
      }
    } catch {
      // ignore in environments without localStorage
    }
    return 280;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState<boolean>(false);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.min(650, Math.max(180, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const delta = upEvent.clientX - startX;
      const finalWidth = Math.min(650, Math.max(180, startWidth + delta));
      setSidebarWidth(finalWidth);
      setIsResizingSidebar(false);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('doubleagent_sidebar_width', finalWidth.toString());
        }
      } catch {
        // ignore
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);
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
    }, 400);
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
    proxyProfiles: [],
    snippets: [],
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
  const [grpInitialDir, setGrpInitialDir] = useState<string>('');
  const [grpProxyProfileId, setGrpProxyProfileId] = useState<string>('');
  const [grpSessionLogging, setGrpSessionLogging] = useState<boolean>(false);

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
  const [hostInitialDir, setHostInitialDir] = useState<string>('');
  const [hostProxyProfileId, setHostProxyProfileId] = useState<string>('');
  const [hostProxyCommand, setHostProxyCommand] = useState<string>('');
  const [hostProxyJump, setHostProxyJump] = useState<string>('');
  const [hostSessionLogging, setHostSessionLogging] = useState<boolean>(false);

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
  const [settingsActiveTab, setSettingsActiveTab] = useState<'appearance' | 'security' | 'shortcuts' | 'about'>('appearance');
  const [paneFontSizes, setPaneFontSizes] = useState<Map<string, number>>(new Map());
  const [leaderArmed, setLeaderArmed] = useState<boolean>(false);
  const leaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickConnectInputRef = useRef<HTMLInputElement>(null);

  // Port Forwarding & Tunnels State (F-13)
  const [showPortForwardingModal, setShowPortForwardingModal] = useState<boolean>(false);
  const [forwardRules, setForwardRules] = useState<ForwardRule[]>([]);
  const [activeTunnels, setActiveTunnels] = useState<ForwardTunnelStatus[]>([]);

  // Proxy Profiles & Proxychains Export State (F-14)
  const [showProxyProfilesModal, setShowProxyProfilesModal] = useState<boolean>(false);
  const [showProxychainsExportModal, setShowProxychainsExportModal] = useState<boolean>(false);
  const [proxychainsOptions, setProxychainsOptions] = useState<ProxychainsExportOptions | undefined>(undefined);

  // Snippets State (F-15)
  const [showSnippetsModal, setShowSnippetsModal] = useState<boolean>(false);
  const [runModalSnippet, setRunModalSnippet] = useState<Snippet | null>(null);
  const [runModalContext, setRunModalContext] = useState<SnippetContext | null>(null);
  const [snippetActiveSessionId, setSnippetActiveSessionId] = useState<string>('');
  const [snippetPrefillBody, setSnippetPrefillBody] = useState<string>('');

  // TOTP Authenticator Generator State (F-20)
  const [showTotpModal, setShowTotpModal] = useState<boolean>(false);

  // Host Notes & Markdown Documentation State (F-17)
  const [notes, setNotes] = useState<NotePage[]>([]);
  const [showNotesModal, setShowNotesModal] = useState<boolean>(false);
  const [notesModalHostId, setNotesModalHostId] = useState<string | undefined>(undefined);
  const [notesModalInitialNoteId, setNotesModalInitialNoteId] = useState<string | null>(null);
  const [openNotesDrawerHostId, setOpenNotesDrawerHostId] = useState<string | null>(null);

  // Session Logging State (F-21)
  const [showSessionLogsModal, setShowSessionLogsModal] = useState<boolean>(false);
  const [sessionLogs, setSessionLogs] = useState<SessionLogRecord[]>([]);
  const [activeLogSessions, setActiveLogSessions] = useState<Set<string>>(new Set());
  const localLogTranscriptsRef = useRef<Map<string, string>>(new Map());

  // Broadcast / Multi-Execution Input State (F-26)
  const [broadcastState, setBroadcastState] = useState<BroadcastState>({
    enabled: false,
    scope: 'tab',
    customSessionIds: [],
  });

  // Workspace Drag-and-Drop, Split Resizing & View Builder State
  const [workspaceDragItem, setWorkspaceDragItem] = useState<WorkspaceDragPayload | null>(null);
  const workspaceDragRef = useRef<WorkspaceDragPayload | null>(null);
  const [dropTargetIndicator, setDropTargetIndicator] = useState<{
    paneId: string;
    zone: DropZonePosition;
  } | null>(null);
  const [activeSplitResize, setActiveSplitResize] = useState<{
    tabId: string;
    splitId: string;
    direction: 'horizontal' | 'vertical';
    index: number;
    startPos: number;
    containerSize: number;
    initialRatios: number[];
  } | null>(null);
  const [showAddToViewMenu, setShowAddToViewMenu] = useState<boolean>(false);
  const [addToViewZone, setAddToViewZone] = useState<Exclude<DropZonePosition, 'center'>>('right');
  const [quickConnectExpanded, setQuickConnectExpanded] = useState<boolean>(false);

  const startWorkspaceDrag = useCallback((payload: WorkspaceDragPayload | null): void => {
    workspaceDragRef.current = payload;
    setWorkspaceDragItem(payload);
    if (!payload) {
      setDropTargetIndicator(null);
    }
  }, []);

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

  const openSftpTab = useCallback(
    (sshSessionId: string, title: string, hostId?: string): void => {
      tabCounterRef.current += 1;
      const seq = tabCounterRef.current;
      const tabId = `sftp-tab-${seq}`;
      const paneId = `sftp-pane-${seq}-1`;
      const color = getEffectiveHostColor(hostId, undefined, title);
      const newTab: TabItem = {
        id: tabId,
        title: `SFTP: ${title}`,
        hostId,
        color,
        tabType: 'sftp',
        sftpSessionId: sshSessionId,
        rootNode: {
          type: 'pane',
          id: paneId,
          sessionId: `sftp-${sshSessionId}`,
          hostId,
          title: `SFTP: ${title}`,
        },
        activePaneId: paneId,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
    },
    []
  );

  const openSettingsTab = useCallback(
    (subTab: 'appearance' | 'security' | 'shortcuts' | 'about' = 'appearance'): void => {
      setSettingsActiveTab(subTab);
      setTabs((prev) => {
        const existingTab = prev.find((t) => t.tabType === 'settings');
        if (existingTab) {
          setActiveTabId(existingTab.id);
          return prev;
        }
        tabCounterRef.current += 1;
        const seq = tabCounterRef.current;
        const tabId = `settings-tab-${seq}`;
        const paneId = `settings-pane-${seq}-1`;
        const newTab: TabItem = {
          id: tabId,
          title: 'Settings ⚙',
          color: '#2dd4bf',
          tabType: 'settings',
          rootNode: {
            type: 'pane',
            id: paneId,
            sessionId: `settings-${seq}`,
            title: 'Settings ⚙',
          },
          activePaneId: paneId,
        };
        setActiveTabId(tabId);
        return [...prev, newTab];
      });
    },
    []
  );

  const openNotesTab = useCallback(
    (hostId?: string, noteId?: string | null): void => {
      setTabs((prev) => {
        const existingTab = prev.find((t) => t.tabType === 'notes');
        if (existingTab) {
          existingTab.notesHostId = hostId;
          existingTab.notesInitialNoteId = noteId;
          setActiveTabId(existingTab.id);
          return [...prev];
        }
        tabCounterRef.current += 1;
        const seq = tabCounterRef.current;
        const tabId = `notes-tab-${seq}`;
        const paneId = `notes-pane-${seq}-1`;
        const newTab: TabItem = {
          id: tabId,
          title: 'Notes 📝',
          color: '#38bdf8',
          tabType: 'notes',
          notesHostId: hostId,
          notesInitialNoteId: noteId,
          rootNode: {
            type: 'pane',
            id: paneId,
            sessionId: `notes-${seq}`,
            title: 'Notes 📝',
          },
          activePaneId: paneId,
        };
        setActiveTabId(tabId);
        return [...prev, newTab];
      });
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
            if (api.ListNotes) {
              const allNotes = await api.ListNotes('all');
              setNotes(allNotes || []);
            }
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
        if (api.ListNotes) {
          const allNotes = await api.ListNotes('all');
          setNotes(allNotes || []);
        }
        if (api.ListForwardRules) {
          const rules = await api.ListForwardRules();
          setForwardRules(rules || []);
        }
        if (api.GetActiveTunnels) {
          const tunnels = await api.GetActiveTunnels();
          setActiveTunnels(tunnels || []);
        }
      } else {
        setVaultSummary({ groups: [], hosts: [], identities: [] });
        setNotes([]);
        setShowNotesModal(false);
        setOpenNotesDrawerHostId(null);
        setForwardRules([]);
        setActiveTunnels([]);
      }
    } catch {
      // Ignore during initial mount if bindings not ready
    }
  }, []);

  const refreshForwardState = useCallback(async (): Promise<void> => {
    const api = getWailsBindings();
    if (!api) return;
    try {
      if (api.ListForwardRules) {
        const rules = await api.ListForwardRules();
        setForwardRules(rules || []);
      }
      if (api.GetActiveTunnels) {
        const tunnels = await api.GetActiveTunnels();
        setActiveTunnels(tunnels || []);
      }
    } catch {
      // ignore
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

    const offForward = rt.EventsOn('forward:tunnels-updated', (raw: unknown) => {
      if (Array.isArray(raw)) {
        setActiveTunnels(raw as ForwardTunnelStatus[]);
      } else {
        void refreshForwardState();
      }
    });

    return () => {
      offData();
      offPrompt();
      offExit();
      offVaultLock();
      offForward();
    };
  }, [refreshVaultState, refreshForwardState]);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.nav-menu-container')) {
        setActiveDropdownMenu(null);
      }
      if (!target?.closest('.add-to-view-wrapper')) {
        setShowAddToViewMenu(false);
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

  const handleChangePasswordDirect = async (currPw: string, nextPw: string): Promise<void> => {
    setModalError('');
    const api = getWailsBindings();
    if (!api) {
      setPasswordless(nextPw === '');
      setStatusMessage('Password updated in preview mode.');
      return;
    }
    try {
      await api.ChangeVaultPassword(passwordless ? '' : currPw, nextPw);
      await refreshVaultState();
      setStatusMessage(
        nextPw === ''
          ? 'Master password removed (vault is now in passwordless mode).'
          : 'Master password updated and vault re-encrypted.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setModalError(`Password update failed: ${msg}`);
      throw err;
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
        initialDir: grpInitialDir.trim() || undefined,
        keepaliveSecs: Number(grpKeepalive) || 30,
        proxyProfileId: grpProxyProfileId || undefined,
        sessionLogging: grpSessionLogging ? true : undefined,
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
    setGrpInitialDir('');
    setGrpProxyProfileId('');
    setGrpSessionLogging(false);
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
    const jumpChainList = hostProxyJump
      ? hostProxyJump
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    if (api) {
      await api.SaveHost({
        id: `host-${idSuffix}`,
        label: hostLabel.trim(),
        address: hostAddr.trim(),
        port: parsedPort,
        groupId: hostGroupId,
        identityId,
        initialDir: hostInitialDir.trim() || undefined,
        tags: tagList,
        color: hostColor,
        favorite: false,
        proxyProfileId: hostProxyProfileId || undefined,
        proxyCommand: hostProxyCommand.trim() || undefined,
        jumpChain: jumpChainList,
        sessionLogging: hostSessionLogging ? true : undefined,
      });
      await refreshVaultState();
    } else {
      // Preview mode fallback resolve
      const grp = vaultSummary.groups.find((g) => g.id === hostGroupId);
      const effPort = parsedPort > 0 ? parsedPort : grp?.defaultSettings.port || 22;
      const effUser = hostUser.trim() || grp?.defaultSettings.username || 'root';
      const effInitialDir = hostInitialDir.trim() || grp?.defaultSettings.initialDir || '';
      const effSessionLogging = hostSessionLogging || Boolean(grp?.defaultSettings.sessionLogging);
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
            initialDir: effInitialDir,
            keepaliveSecs: grp?.defaultSettings.keepaliveSecs || 30,
            groupId: hostGroupId,
            identityId,
            tags: tagList,
            color: hostColor,
            favorite: false,
            proxyProfileId: hostProxyProfileId || undefined,
            proxyCommand: hostProxyCommand.trim() || undefined,
            jumpChain: jumpChainList,
            sessionLogging: effSessionLogging,
          },
        ],
      }));
    }

    setHostLabel('');
    setHostAddr('');
    setHostPort('0');
    setHostGroupId('');
    setHostUser('');
    setHostPass('');
    setHostTags('');
    setHostColor('');
    setHostInitialDir('');
    setHostProxyProfileId('');
    setHostProxyCommand('');
    setHostProxyJump('');
    setHostSessionLogging(false);
    setShowAddHostModal(false);
  };

  const refreshSessionLogs = useCallback(async (): Promise<void> => {
    const api = getWailsBindings();
    if (api?.ListSessionLogs) {
      try {
        const list = await api.ListSessionLogs();
        setSessionLogs(list || []);
      } catch {
        // ignore
      }
    }
  }, []);

  const handleToggleSessionLog = async (
    targetSessionId: string,
    label?: string,
    hostId?: string
  ): Promise<void> => {
    const api = getWailsBindings();
    const isCurrentlyRecording = activeLogSessions.has(targetSessionId);

    if (isCurrentlyRecording) {
      if (api?.StopSessionLogging) {
        try {
          await api.StopSessionLogging(targetSessionId);
          await refreshSessionLogs();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatusMessage(`Stop session logging failed: ${msg}`);
          return;
        }
      } else {
        const endedAt = new Date().toISOString();
        setSessionLogs((prev) =>
          prev.map((rec) =>
            rec.sessionId === targetSessionId && rec.active
              ? { ...rec, active: false, endedAt }
              : rec
          )
        );
      }
      setActiveLogSessions((prev) => {
        const next = new Set(prev);
        next.delete(targetSessionId);
        return next;
      });
      setStatusMessage(`⏹ Session logging stopped for ${label || targetSessionId}.`);
    } else {
      if (api?.StartSessionLogging) {
        try {
          await api.StartSessionLogging(targetSessionId);
          await refreshSessionLogs();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatusMessage(`Start session logging failed: ${msg}`);
          return;
        }
      } else {
        const logId = `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const startedAt = new Date().toISOString();
        const tsFormatted = startedAt.replace('T', ' ').slice(0, 23);
        const transcript =
          `# DoubleAgent Session Transcript\n` +
          `# Host: ${label || targetSessionId}\n` +
          `# Session ID: ${targetSessionId}\n` +
          `# Started: ${startedAt}\n` +
          `# Security Policy: Password Echo & Sensitive Prompts Redacted\n` +
          `# ------------------------------------------------------------\n` +
          `[${tsFormatted}] ${label || targetSessionId}:~$ session recording active\n` +
          `[${tsFormatted}] [sudo] password for user: [PASSWORD ECHO SUPPRESSED]\n`;
        localLogTranscriptsRef.current.set(logId, transcript);
        const rec: SessionLogRecord = {
          id: logId,
          sessionId: targetSessionId,
          hostId: hostId || '',
          hostLabel: label || targetSessionId,
          filePath: `logs/${logId}.log`,
          startedAt,
          byteCount: transcript.length,
          lineCount: transcript.split('\n').filter(Boolean).length,
          active: true,
        };
        setSessionLogs((prev) => [rec, ...prev]);
      }
      setActiveLogSessions((prev) => {
        const next = new Set(prev);
        next.add(targetSessionId);
        return next;
      });
      setStatusMessage(`⏺ Recording session transcript for ${label || targetSessionId}.`);
    }
  };

  const handleReadSessionLog = async (logId: string): Promise<string> => {
    const api = getWailsBindings();
    if (api?.ReadSessionLog) {
      return await api.ReadSessionLog(logId);
    }
    return localLogTranscriptsRef.current.get(logId) || '';
  };

  const handleDeleteSessionLog = async (logId: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.DeleteSessionLog) {
      await api.DeleteSessionLog(logId);
      await refreshSessionLogs();
    } else {
      localLogTranscriptsRef.current.delete(logId);
      setSessionLogs((prev) => prev.filter((r) => r.id !== logId));
    }
    setStatusMessage('Deleted session log transcript.');
  };

  const handleExportSessionLog = async (logId: string, targetPath: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.ExportSessionLog) {
      await api.ExportSessionLog(logId, targetPath);
    }
    setStatusMessage(`Exported session log to ${targetPath}.`);
  };

  const handleConnectSavedHost = async (host: HostSummary): Promise<void> => {
    const api = getWailsBindings();
    if (!api) {
      const previewId = `sess-preview-${host.id}-${Date.now()}`;
      openSessionTab(previewId, host.label, host.id, host.color);
      if (host.sessionLogging) {
        void handleToggleSessionLog(previewId, host.label, host.id);
      }
      setStatusMessage(`Connected to ${host.label}`);
      return;
    }
    setStatusMessage(`Connecting to ${host.label} (${host.effectiveUser}@${host.address}:${host.effectivePort})...`);
    try {
      const id = await api.ConnectSavedHost(host.id, { cols: 120, rows: 34 });
      openSessionTab(id, host.label, host.id, host.color);
      if (host.sessionLogging) {
        setActiveLogSessions((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        void refreshSessionLogs();
      }
      setStatusMessage(`Connected to ${host.label}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Connection failed: ${msg}`);
    }
  };

  const handleOpenHostSftp = async (host: HostSummary): Promise<void> => {
    const existingTab = tabs.find((t) => t.hostId === host.id);
    const existingSessionId = existingTab
      ? collectPanes(existingTab.rootNode).find(
          (p) => !p.sessionId.startsWith('serial-') && !p.sessionId.startsWith('local-')
        )?.sessionId
      : undefined;

    if (existingSessionId) {
      openSftpTab(existingSessionId, host.label, host.id);
      return;
    }

    const api = getWailsBindings();
    if (!api) {
      const previewId = `sess-preview-${host.id}-${Date.now()}`;
      openSftpTab(previewId, host.label, host.id);
      return;
    }

    setStatusMessage(`Connecting to ${host.label} for SFTP...`);
    try {
      const id = await api.ConnectSavedHost(host.id, { cols: 80, rows: 24 });
      openSftpTab(id, host.label, host.id);
      setStatusMessage(`SFTP opened for ${host.label}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`SFTP connection failed: ${msg}`);
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

  const handleSaveForwardRule = async (rule: ForwardRule): Promise<void> => {
    const api = getWailsBindings();
    if (api?.SaveForwardRule) {
      try {
        await api.SaveForwardRule(rule);
        await refreshForwardState();
        setStatusMessage(`Saved port forwarding rule "${rule.label || rule.type}".`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Save forward rule failed: ${msg}`);
      }
    } else {
      setForwardRules((prev) => {
        const idx = prev.findIndex((r) => r.id === rule.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = rule;
          return next;
        }
        return [...prev, rule];
      });
    }
  };

  const handleDeleteForwardRule = async (ruleId: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.DeleteForwardRule) {
      try {
        await api.DeleteForwardRule(ruleId);
        await refreshForwardState();
        setStatusMessage('Deleted port forwarding rule.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Delete forward rule failed: ${msg}`);
      }
    } else {
      setForwardRules((prev) => prev.filter((r) => r.id !== ruleId));
    }
  };

  const handleStartForwardTunnel = async (sessionIdToUse: string, ruleId: string): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.StartForwardTunnel) {
      setStatusMessage('Wails backend not available to start tunnel.');
      return;
    }
    try {
      const tunnelId = await api.StartForwardTunnel(sessionIdToUse, ruleId);
      await refreshForwardState();
      setStatusMessage(`Started tunnel ${tunnelId}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Start tunnel failed: ${msg}`);
    }
  };

  const handleStartTunnelWithHost = async (hostId: string, ruleId: string): Promise<void> => {
    const host = vaultSummary.hosts.find((h) => h.id === hostId);
    const api = getWailsBindings();
    if (!api?.ConnectSavedHost || !api?.StartForwardTunnel) {
      setStatusMessage('Wails backend not available to connect and start tunnel.');
      return;
    }
    setStatusMessage(`Connecting to ${host ? host.label : hostId} in background...`);
    try {
      const sessionId = await api.ConnectSavedHost(hostId, { cols: 80, rows: 24 });
      if (host) {
        openSessionTab(sessionId, host.label, host.id, host.color);
      }
      await api.StartForwardTunnel(sessionId, ruleId);
      await refreshForwardState();
      setStatusMessage(`Started tunnel on ${host ? host.label : hostId} (connected in background).`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Failed to connect & start tunnel: ${msg}`);
      throw err;
    }
  };

  const handleStopForwardTunnel = async (tunnelId: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.StopForwardTunnel) {
      try {
        await api.StopForwardTunnel(tunnelId);
        await refreshForwardState();
        setStatusMessage('Stopped tunnel.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Stop tunnel failed: ${msg}`);
      }
    } else {
      setActiveTunnels((prev) => prev.filter((t) => t.id !== tunnelId));
    }
  };

  const handleSaveProxyProfile = async (profile: ProxyProfile): Promise<void> => {
    const api = getWailsBindings();
    if (api?.SaveProxyProfile) {
      try {
        await api.SaveProxyProfile(profile);
        await refreshVaultState();
        setStatusMessage(`Saved proxy profile "${profile.name}".`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Save proxy profile failed: ${msg}`);
      }
    } else {
      setVaultSummary((prev) => {
        const existing = prev.proxyProfiles || [];
        const idx = existing.findIndex((p) => p.id === profile.id);
        const summary: ProxyProfileSummary = {
          id: profile.id,
          name: profile.name,
          type: profile.type,
          jumpHostIds: profile.jumpHostIds,
          command: profile.command,
          socksAddress: profile.socksAddress,
          socksUsername: profile.socksUsername,
          hasPassword: !!profile.socksPassword,
        };
        let next: ProxyProfileSummary[];
        if (idx >= 0) {
          next = [...existing];
          next[idx] = summary;
        } else {
          next = [...existing, summary];
        }
        return { ...prev, proxyProfiles: next };
      });
      setStatusMessage(`Saved proxy profile "${profile.name}" (local).`);
    }
  };

  const handleDeleteProxyProfile = async (profileId: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.DeleteProxyProfile) {
      try {
        await api.DeleteProxyProfile(profileId);
        await refreshVaultState();
        setStatusMessage('Deleted proxy profile.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Delete proxy profile failed: ${msg}`);
      }
    } else {
      setVaultSummary((prev) => ({
        ...prev,
        proxyProfiles: (prev.proxyProfiles || []).filter((p) => p.id !== profileId),
      }));
      setStatusMessage('Deleted proxy profile (local).');
    }
  };

  const handleOpenProxychainsExport = async (): Promise<void> => {
    const api = getWailsBindings();
    if (api?.GetDefaultProxychainsOptions) {
      try {
        const opts = await api.GetDefaultProxychainsOptions();
        setProxychainsOptions(opts);
      } catch {
        setProxychainsOptions(undefined);
      }
    }
    setShowProxychainsExportModal(true);
  };

  const handleGenerateProxychainsConfig = async (opts: ProxychainsExportOptions): Promise<string> => {
    const api = getWailsBindings();
    if (api?.GenerateProxychainsConfig) {
      return await api.GenerateProxychainsConfig(opts);
    }
    const proto = opts.proxies[0]?.type || 'socks5';
    const host = opts.proxies[0]?.host || '127.0.0.1';
    const port = opts.proxies[0]?.port || 1080;
    return `# proxychains.conf - generated by DoubleAgent SSH Client\n${opts.chainType}\n${opts.proxyDNS ? 'proxy_dns\n' : ''}tcp_read_time_out ${opts.tcpReadTimeout}\ntcp_connect_time_out ${opts.tcpConnectTimeout}\n\n[ProxyList]\n${proto}    ${host}    ${port}\n`;
  };

  const handleSaveProxychainsFile = async (content: string, targetPath: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.SaveProxychainsFile) {
      await api.SaveProxychainsFile(content, targetPath);
    }
  };

  const handleSaveSnippet = async (snippet: Snippet): Promise<void> => {
    const api = getWailsBindings();
    if (api?.SaveSnippet) {
      try {
        await api.SaveSnippet(snippet);
        await refreshVaultState();
        setStatusMessage(`Saved snippet "${snippet.name}".`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Save snippet failed: ${msg}`);
      }
    } else {
      setVaultSummary((prev) => {
        const id = snippet.id || `snippet-${Date.now()}`;
        const updated = { ...snippet, id };
        const exists = (prev.snippets || []).some((s) => s.id === id);
        const list = exists
          ? (prev.snippets || []).map((s) => (s.id === id ? updated : s))
          : [...(prev.snippets || []), updated];
        return { ...prev, snippets: list };
      });
      setStatusMessage(`Saved snippet "${snippet.name}".`);
    }
  };

  const handleDeleteSnippet = async (snippetId: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.DeleteSnippet) {
      try {
        await api.DeleteSnippet(snippetId);
        await refreshVaultState();
        setStatusMessage('Snippet deleted.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Delete snippet failed: ${msg}`);
      }
    } else {
      setVaultSummary((prev) => ({
        ...prev,
        snippets: (prev.snippets || []).filter((s) => s.id !== snippetId),
      }));
      setStatusMessage('Snippet deleted.');
    }
  };

  const handleSaveNote = async (note: NotePage): Promise<void> => {
    const api = getWailsBindings();
    if (api?.SaveNote) {
      try {
        await api.SaveNote(note);
        await refreshVaultState();
        setStatusMessage(`Saved ${note.isFolder ? 'folder' : 'note'} "${note.title}".`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Save note failed: ${msg}`);
      }
    } else {
      setNotes((prev) => {
        const id = note.id || `note-${Date.now()}`;
        const now = new Date().toISOString();
        const updated: NotePage = {
          ...note,
          id,
          createdAt: note.createdAt || now,
          updatedAt: now,
        };
        const exists = prev.some((n) => n.id === id);
        return exists ? prev.map((n) => (n.id === id ? updated : n)) : [...prev, updated];
      });
      setStatusMessage(`Saved ${note.isFolder ? 'folder' : 'note'} "${note.title}".`);
    }
  };

  const handleDeleteNote = async (noteId: string): Promise<void> => {
    const api = getWailsBindings();
    if (api?.DeleteNote) {
      try {
        await api.DeleteNote(noteId);
        await refreshVaultState();
        setStatusMessage('Note deleted.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Delete note failed: ${msg}`);
      }
    } else {
      setNotes((prev) => {
        const toDelete = new Set<string>([noteId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const n of prev) {
            if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
              toDelete.add(n.id);
              changed = true;
            }
          }
        }
        return prev.filter((n) => !toDelete.has(n.id));
      });
      setStatusMessage('Note deleted.');
    }
  };

  const handleTriggerSnippet = useCallback(
    async (snippet: Snippet, targetSessionId?: string): Promise<void> => {
      const sessId = targetSessionId || sessionId;

      if (!sessId) {
        setStatusMessage('No active terminal session to run snippet in.');
        return;
      }

      setSnippetActiveSessionId(sessId);

      let ctx: SnippetContext = {
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toTimeString().slice(0, 8),
        workingDir: getSessionCwd(sessId) || '~',
      };

      const api = getWailsBindings();
      if (api?.GetSnippetContext) {
        try {
          const backendCtx = await api.GetSnippetContext(sessId);
          ctx = { ...ctx, ...backendCtx };
          if (!ctx.workingDir) {
            ctx.workingDir = getSessionCwd(sessId) || '~';
          }
        } catch {
          // fallback
        }
      }

      const hasVars = (snippet.variables && snippet.variables.length > 0) || /\{\{([^{}]+)\}\}/.test(snippet.body);

      if (snippet.confirmBeforeRun || hasVars) {
        setRunModalSnippet(snippet);
        setRunModalContext(ctx);
      } else {
        try {
          if (api?.ExecuteSnippet) {
            await api.ExecuteSnippet(sessId, snippet.id, {});
          } else {
            await api?.WriteTerminal?.(sessId, snippet.body + '\n');
          }
          setStatusMessage(`⚡ Sent snippet "${snippet.name}" to terminal.`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatusMessage(`Execute snippet failed: ${msg}`);
        }
      }
    },
    [sessionId]
  );

  const handleExecuteSnippetFromModal = async (userValues: Record<string, string>): Promise<void> => {
    if (!runModalSnippet || !snippetActiveSessionId) return;
    const api = getWailsBindings();
    if (api?.ExecuteSnippet) {
      await api.ExecuteSnippet(snippetActiveSessionId, runModalSnippet.id, userValues);
    } else {
      let previewCmd = runModalSnippet.body;
      for (const [k, v] of Object.entries(userValues)) {
        previewCmd = previewCmd.replace(new RegExp(`\\{\\{${k}[^}]*\\}\\}`, 'g'), v);
      }
      await api?.WriteTerminal?.(snippetActiveSessionId, previewCmd + '\n');
    }
    setStatusMessage(`⚡ Executed snippet "${runModalSnippet.name}".`);
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

  const getBroadcastTargetSessionIds = useCallback((): string[] => {
    if (!broadcastState.enabled) return [];
    if (broadcastState.scope === 'tab') {
      if (!activeTab) return [];
      const panes = collectPanes(activeTab.rootNode);
      return panes
        .filter((p) => !p.paneType || p.paneType === 'terminal')
        .map((p) => p.sessionId);
    }
    if (broadcastState.scope === 'all') {
      const allPanes: string[] = [];
      tabs.forEach((t) => {
        if (t.tabType === 'terminal' || !t.tabType) {
          const panes = collectPanes(t.rootNode);
          panes.forEach((p) => {
            if (!p.paneType || p.paneType === 'terminal') {
              allPanes.push(p.sessionId);
            }
          });
        }
      });
      return allPanes;
    }
    if (broadcastState.scope === 'custom') {
      return broadcastState.customSessionIds;
    }
    return [];
  }, [broadcastState, activeTab, tabs]);

  const handleToggleBroadcast = useCallback((scope?: BroadcastScope): void => {
    setBroadcastState((prev) => {
      const newEnabled = !prev.enabled || (scope !== undefined && scope !== prev.scope);
      const newScope = scope || prev.scope;
      setStatusMessage(
        newEnabled
          ? `Broadcast Input ACTIVE (${newScope === 'tab' ? 'Current Tab' : newScope === 'all' ? 'All Terminals' : 'Custom Selection'}). Keystrokes are sent to all participating sessions.`
          : 'Broadcast Input disarmed.'
      );
      let custom = prev.customSessionIds;
      if (newEnabled && newScope === 'custom' && custom.length === 0 && activePane) {
        custom = [activePane.sessionId];
      }
      return {
        enabled: newEnabled,
        scope: newScope,
        customSessionIds: custom,
      };
    });
  }, [activePane]);

  const handleToggleSessionBroadcast = useCallback((sid: string): void => {
    setBroadcastState((prev) => {
      let currentSelection: string[] = [];
      if (prev.scope === 'custom') {
        currentSelection = prev.customSessionIds;
      } else if (prev.enabled) {
        currentSelection = getBroadcastTargetSessionIds();
      }

      const isSelected = currentSelection.includes(sid);
      const updated = isSelected
        ? currentSelection.filter((id) => id !== sid)
        : [...currentSelection, sid];

      const newEnabled = updated.length > 0;
      setStatusMessage(
        newEnabled
          ? `Broadcast Input custom selection updated (${updated.length} sessions).`
          : 'Broadcast Input disarmed.'
      );
      return {
        enabled: newEnabled,
        scope: 'custom',
        customSessionIds: updated,
      };
    });
  }, [getBroadcastTargetSessionIds]);

  const handleTerminalInput = useCallback(
    (id: string, data: string): void => {
      lastTxDataRef.current.set(id, data);
      const api = getWailsBindings();
      if (!api) return;

      const broadcastTargets = getBroadcastTargetSessionIds();
      if (broadcastState.enabled && broadcastTargets.includes(id) && broadcastTargets.length > 1) {
        // Multi-execution broadcast across all target sessions
        broadcastTargets.forEach((targetId) => {
          lastTxDataRef.current.set(targetId, data);
        });
        const anyApi = api as unknown as { BroadcastInput?: (sids: string[], d: string) => Promise<void> };
        if (typeof anyApi.BroadcastInput === 'function') {
          void anyApi.BroadcastInput(broadcastTargets, data);
        } else {
          broadcastTargets.forEach((targetId) => {
            void api.WriteTerminal(targetId, data);
          });
        }
      } else {
        void api.WriteTerminal(id, data);
      }
    },
    [broadcastState.enabled, getBroadcastTargetSessionIds]
  );

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

  const handleInjectTotp = async (totpId = ''): Promise<void> => {
    if (!sessionId) {
      setStatusMessage('No active terminal session to inject 2FA code into.');
      return;
    }
    const api = getWailsBindings();
    if (!api?.InjectTotpCode) {
      setStatusMessage('TOTP 2FA code injected into active terminal session (mock mode).');
      focusersRef.current.get(sessionId)?.();
      return;
    }
    try {
      await api.InjectTotpCode(sessionId, totpId);
      setStatusMessage('TOTP 2FA code injected into active terminal prompt.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`2FA injection: ${msg}`);
      // Open TOTP manager modal so user can choose or configure an authenticator
      setShowTotpModal(true);
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

  const handlePinNotesSplit = (targetHostId?: string): void => {
    if (!activeTab || !activePane) {
      return;
    }
    const hostId = targetHostId || activePane.hostId || activeTab.hostId;
    const hostObj = vaultSummary.hosts.find((h) => h.id === hostId);
    const hostLabel = hostObj?.label || hostObj?.address || 'Host Notes';

    tabCounterRef.current += 1;
    const newPaneId = `pane-notes-${tabCounterRef.current}`;
    const newPane: WorkspaceNode = {
      type: 'pane',
      id: newPaneId,
      sessionId: `notes-sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      hostId,
      title: `Notes: ${hostLabel}`,
      paneType: 'notes',
      notesHostId: hostId,
    };

    setOpenNotesDrawerHostId(null);
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) {
          return t;
        }
        const updatedRoot = splitPaneInTree(t.rootNode, activePane.id, newPane, 'horizontal');
        return {
          ...t,
          rootNode: updatedRoot,
          activePaneId: newPaneId,
        };
      })
    );
    setStatusMessage(`Pinned notes as horizontal split view for ${hostLabel}.`);
  };

  const handleOpenTerminalDirectory = async (
    mode: 'default' | 'current' | 'root',
    splitDir: 'none' | 'horizontal' | 'vertical' = 'none'
  ): Promise<void> => {
    if (!activeTab || !activePane) {
      const api = getWailsBindings();
      let targetDir = '';
      if (mode === 'current') {
        const inputDir = window.prompt('Enter folder path to open terminal in (e.g. C:\\Projects or /var/www):', '');
        if (inputDir === null) {
          return;
        }
        targetDir = inputDir.trim();
      }
      if (api?.OpenTerminalWithOptions) {
        try {
          const newSessionId = await api.OpenTerminalWithOptions('', {
            mode,
            workingDir: targetDir,
            splitDir: 'none',
            size: { cols: 120, rows: 34 },
          });
          const title =
            mode === 'root'
              ? `Local Shell (Admin)${targetDir ? ` [${targetDir}]` : ''}`
              : targetDir
                ? `Local Shell [${targetDir}]`
                : 'Local Shell';
          openSessionTab(newSessionId, title, undefined);
          setStatusMessage(`Opened ${title}.`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatusMessage(`Failed to open terminal (${mode}): ${msg}`);
        }
      } else {
        void handleOpenLocalTerminal('powershell');
      }
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
      const isTerminalPane = !targetPane.paneType || targetPane.paneType === 'terminal';
      writersRef.current.delete(targetPane.sessionId);
      pendingDataBuffers.current.delete(targetPane.sessionId);
      focusersRef.current.delete(targetPane.sessionId);
      if (isTerminalPane) {
        disposeTerminal(targetPane.sessionId);
      }
      setPaneFontSizes((prev) => {
        const next = new Map(prev);
        next.delete(targetPane.sessionId);
        return next;
      });
      const api = getWailsBindings();
      if (api && isTerminalPane) {
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
      const isTerminalPane = !p.paneType || p.paneType === 'terminal';
      writersRef.current.delete(p.sessionId);
      pendingDataBuffers.current.delete(p.sessionId);
      focusersRef.current.delete(p.sessionId);
      if (isTerminalPane) {
        disposeTerminal(p.sessionId);
      }
      setPaneFontSizes((prev) => {
        const next = new Map(prev);
        next.delete(p.sessionId);
        return next;
      });
      if (api && isTerminalPane) {
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

  const handleSplitResizeStart = (
    e: React.MouseEvent,
    tabId: string,
    splitId: string,
    direction: 'horizontal' | 'vertical',
    index: number,
    initialRatios: number[]
  ): void => {
    e.preventDefault();
    e.stopPropagation();
    const parentEl = (e.currentTarget as HTMLElement).parentElement;
    const rect = parentEl?.getBoundingClientRect();
    const containerSize =
      direction === 'horizontal'
        ? rect && rect.width > 0
          ? rect.width
          : 800
        : rect && rect.height > 0
          ? rect.height
          : 500;
    const startPos = direction === 'horizontal' ? e.clientX : e.clientY;
    setActiveSplitResize({
      tabId,
      splitId,
      direction,
      index,
      startPos,
      containerSize,
      initialRatios,
    });

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const currentPos = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
      const deltaPx = currentPos - startPos;
      const deltaPct = (deltaPx / Math.max(containerSize, 100)) * 100;
      const nextRatios = [...initialRatios];
      const totalPair = nextRatios[index] + nextRatios[index + 1];
      const minPct = Math.min(12, totalPair * 0.25);
      const updatedA = Math.min(totalPair - minPct, Math.max(minPct, nextRatios[index] + deltaPct));
      const updatedB = totalPair - updatedA;
      nextRatios[index] = Number(updatedA.toFixed(2));
      nextRatios[index + 1] = Number(updatedB.toFixed(2));

      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, rootNode: updateSplitRatiosInTree(t.rootNode, splitId, nextRatios) }
            : t
        )
      );
    };

    const handleMouseUp = (): void => {
      setActiveSplitResize(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.dispatchEvent(new Event('resize'));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResetSplitRatios = (tabId: string, splitId: string, childCount: number): void => {
    const equal = Array.from({ length: childCount }, () => 100 / childCount);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, rootNode: updateSplitRatiosInTree(t.rootNode, splitId, equal) }
          : t
      )
    );
    setStatusMessage('Reset split pane sizes to equal proportions.');
    window.dispatchEvent(new Event('resize'));
  };

  const handleEqualizeAllSplits = (): void => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, rootNode: equalizeAllSplitsInTree(t.rootNode) } : t
      )
    );
    setShowAddToViewMenu(false);
    setStatusMessage('Equalized all split pane sizes in current view.');
    window.dispatchEvent(new Event('resize'));
  };

  const handleConnectHostIntoSplit = async (
    host: HostSummary,
    zone: Exclude<DropZonePosition, 'center'> = 'right',
    targetPaneIdOverride?: string
  ): Promise<void> => {
    if (
      !activeTab ||
      !activePane ||
      activeTab.tabType === 'notes' ||
      activeTab.tabType === 'settings' ||
      activeTab.tabType === 'sftp'
    ) {
      await handleConnectSavedHost(host);
      return;
    }

    const targetPaneId = targetPaneIdOverride || activePane.id;
    const api = getWailsBindings();
    let sessionIdToUse = `sess-split-host-${host.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    if (api?.ConnectSavedHost) {
      setStatusMessage(
        `Connecting to ${host.label} (${host.effectiveUser}@${host.address}:${host.effectivePort}) into split view...`
      );
      try {
        sessionIdToUse = await api.ConnectSavedHost(host.id, { cols: 100, rows: 34 });
        if (host.sessionLogging) {
          setActiveLogSessions((prev) => {
            const next = new Set(prev);
            next.add(sessionIdToUse);
            return next;
          });
          void refreshSessionLogs();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Split connection failed: ${msg}`);
        return;
      }
    } else if (host.sessionLogging) {
      void handleToggleSessionLog(sessionIdToUse, host.label, host.id);
    }

    tabCounterRef.current += 1;
    const newPaneId = `pane-host-${tabCounterRef.current}`;
    const newPane: WorkspaceNode = {
      type: 'pane',
      id: newPaneId,
      sessionId: sessionIdToUse,
      hostId: host.id,
      title: host.label,
      paneType: 'terminal',
    };

    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        const updatedRoot = dockNodeInTree(t.rootNode, targetPaneId, newPane, zone);
        return {
          ...t,
          rootNode: updatedRoot,
          activePaneId: newPaneId,
        };
      })
    );
    setShowAddToViewMenu(false);
    setStatusMessage(`Connected ${host.label} side-by-side (${zone}) in current view.`);
    setTimeout(() => focusersRef.current.get(sessionIdToUse)?.(), 50);
  };

  const handleDockToolIntoSplit = async (
    toolType:
      | 'notes'
      | 'totp'
      | 'sftp'
      | 'snippets'
      | 'local-powershell'
      | 'local-cmd'
      | 'local-bash',
    zone: Exclude<DropZonePosition, 'center'> = 'right',
    targetPaneIdOverride?: string,
    explicitHostId?: string
  ): Promise<void> => {
    if (
      toolType === 'local-powershell' ||
      toolType === 'local-cmd' ||
      toolType === 'local-bash'
    ) {
      const shellType = toolType.replace('local-', '');
      if (
        !activeTab ||
        !activePane ||
        activeTab.tabType === 'notes' ||
        activeTab.tabType === 'settings' ||
        activeTab.tabType === 'sftp'
      ) {
        await handleOpenLocalTerminal(shellType);
        return;
      }
      const api = getWailsBindings();
      let sid = `local-${shellType}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      if (api?.OpenLocalTerminal) {
        try {
          sid = await api.OpenLocalTerminal(shellType, { cols: 100, rows: 30 });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatusMessage(`Local terminal failed: ${msg}`);
          return;
        }
      }
      const labelMap: Record<string, string> = {
        powershell: 'Local (PowerShell)',
        cmd: 'Local (CMD)',
        bash: 'Local (Bash)',
      };
      tabCounterRef.current += 1;
      const newPaneId = `pane-local-${tabCounterRef.current}`;
      const newPane: WorkspaceNode = {
        type: 'pane',
        id: newPaneId,
        sessionId: sid,
        title: labelMap[shellType] || `Local (${shellType})`,
        paneType: 'terminal',
      };
      const targetId = targetPaneIdOverride || activePane.id;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? {
                ...t,
                rootNode: dockNodeInTree(t.rootNode, targetId, newPane, zone),
                activePaneId: newPaneId,
              }
            : t
        )
      );
      setShowAddToViewMenu(false);
      setStatusMessage(`Docked ${newPane.title} (${zone}) in current view.`);
      setTimeout(() => focusersRef.current.get(sid)?.(), 50);
      return;
    }

    const hostId = explicitHostId || activePane?.hostId || activeTab?.hostId;
    const hostObj = vaultSummary.hosts.find((h) => h.id === hostId);
    const hostLabel = hostObj?.label || hostObj?.address || (hostId ? 'Host' : 'Workspace');

    tabCounterRef.current += 1;
    let newPane: WorkspaceNode;
    if (toolType === 'notes') {
      const newPaneId = `pane-notes-${tabCounterRef.current}`;
      newPane = {
        type: 'pane',
        id: newPaneId,
        sessionId: `notes-sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        hostId,
        title: `Notes: ${hostLabel}`,
        paneType: 'notes',
        notesHostId: hostId,
      };
      setOpenNotesDrawerHostId(null);
    } else if (toolType === 'totp') {
      const newPaneId = `pane-totp-${tabCounterRef.current}`;
      newPane = {
        type: 'pane',
        id: newPaneId,
        sessionId: `totp-sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        hostId,
        title: '2FA / TOTP Authenticator',
        paneType: 'totp',
      };
      setShowTotpModal(false);
    } else if (toolType === 'snippets') {
      const newPaneId = `pane-snippets-${tabCounterRef.current}`;
      newPane = {
        type: 'pane',
        id: newPaneId,
        sessionId: `snippets-sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        hostId,
        title: 'Command Snippets',
        paneType: 'snippets',
      };
      setShowSnippetsModal(false);
    } else {
      const newPaneId = `pane-sftp-${tabCounterRef.current}`;
      const sftpSid =
        activePane && (!activePane.paneType || activePane.paneType === 'terminal')
          ? activePane.sessionId
          : `sftp-preview-${Date.now()}`;
      newPane = {
        type: 'pane',
        id: newPaneId,
        sessionId: `sftp-pane-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        sftpSessionId: sftpSid,
        hostId,
        title: `SFTP: ${hostLabel}`,
        paneType: 'sftp',
      };
    }

    if (
      !activeTab ||
      !activePane ||
      activeTab.tabType === 'notes' ||
      activeTab.tabType === 'settings' ||
      activeTab.tabType === 'sftp'
    ) {
      tabCounterRef.current += 1;
      const newTabId = `tab-view-${tabCounterRef.current}`;
      const newTab: TabItem = {
        id: newTabId,
        title: newPane.title,
        hostId,
        color: '#14b8a6',
        rootNode: newPane,
        activePaneId: newPane.id,
        tabType: 'terminal',
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTabId);
      setShowAddToViewMenu(false);
      setStatusMessage(`Opened ${newPane.title} in workspace view.`);
      return;
    }

    const targetId = targetPaneIdOverride || activePane.id;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? {
              ...t,
              rootNode: dockNodeInTree(t.rootNode, targetId, newPane, zone),
              activePaneId: newPane.id,
            }
          : t
      )
    );
    setShowAddToViewMenu(false);
    setStatusMessage(`Docked ${newPane.title} (${zone}) in current view.`);
  };

  const handleUndockPaneToTab = (tabId: string, paneId: string): void => {
    const sourceTab = tabs.find((t) => t.id === tabId);
    if (!sourceTab) return;
    const panes = collectPanes(sourceTab.rootNode);
    if (panes.length <= 1) return;
    const paneNode = findPaneNode(sourceTab.rootNode, paneId);
    if (!paneNode) return;

    const updatedSourceRoot = removePaneFromTree(sourceTab.rootNode, paneId);
    if (!updatedSourceRoot) return;

    tabCounterRef.current += 1;
    const newTabId = `tab-undock-${tabCounterRef.current}`;
    const newTab: TabItem = {
      id: newTabId,
      title: paneNode.title,
      hostId: paneNode.hostId,
      color: getEffectiveHostColor(paneNode.hostId, undefined, paneNode.title),
      rootNode: paneNode,
      activePaneId: paneNode.id,
      tabType: 'terminal',
    };

    setTabs((prev) => {
      const next: TabItem[] = [];
      for (const t of prev) {
        if (t.id === tabId) {
          const rem = collectPanes(updatedSourceRoot);
          next.push({
            ...t,
            rootNode: updatedSourceRoot,
            activePaneId: rem.some((p) => p.id === t.activePaneId)
              ? t.activePaneId
              : rem[0]?.id || '',
          });
        } else {
          next.push(t);
        }
      }
      next.push(newTab);
      return next;
    });
    setActiveTabId(newTabId);
    setStatusMessage(`Undocked "${paneNode.title}" into its own tab.`);
  };

  const handleMergeTabIntoSplit = (
    sourceTabId: string,
    targetTabId: string,
    targetPaneId: string,
    zone: Exclude<DropZonePosition, 'center'>
  ): void => {
    if (sourceTabId === targetTabId) return;
    const sourceTab = tabs.find((t) => t.id === sourceTabId);
    const targetTab = tabs.find((t) => t.id === targetTabId);
    if (!sourceTab || !targetTab) return;

    const sourcePanes = collectPanes(sourceTab.rootNode);
    const firstSourcePaneId = sourcePanes[0]?.id || targetTab.activePaneId;

    setTabs((prev) => {
      const next: TabItem[] = [];
      for (const t of prev) {
        if (t.id === sourceTabId) {
          continue;
        }
        if (t.id === targetTabId) {
          const mergedRoot = dockNodeInTree(t.rootNode, targetPaneId, sourceTab.rootNode, zone);
          next.push({
            ...t,
            rootNode: mergedRoot,
            activePaneId: firstSourcePaneId,
          });
        } else {
          next.push(t);
        }
      }
      return next;
    });
    setActiveTabId(targetTabId);
    setStatusMessage(`Merged tab "${sourceTab.title}" (${zone}) into "${targetTab.title}".`);
  };

  const getDropZoneFromEvent = (
    e: React.DragEvent,
    isSameTabPane: boolean
  ): DropZonePosition => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const distLeft = relX;
      const distRight = 1 - relX;
      const distTop = relY;
      const distBottom = 1 - relY;
      const minEdge = Math.min(distLeft, distRight, distTop, distBottom);
      if (minEdge < 0.28) {
        if (minEdge === distLeft) return 'left';
        if (minEdge === distRight) return 'right';
        if (minEdge === distTop) return 'top';
        return 'bottom';
      }
      return isSameTabPane ? 'center' : 'right';
    }
    return isSameTabPane ? 'center' : 'right';
  };

  const handleExecuteDropOnPane = (
    tab: TabItem,
    targetPaneId: string,
    explicitZone?: DropZonePosition
  ): void => {
    const dragPayload = workspaceDragRef.current || workspaceDragItem;
    if (!dragPayload) return;

    const isSameTabPane = dragPayload.type === 'pane' && dragPayload.tabId === tab.id;
    const zone: DropZonePosition =
      explicitZone ||
      (dropTargetIndicator?.paneId === targetPaneId ? dropTargetIndicator.zone : undefined) ||
      (isSameTabPane ? 'center' : 'right');

    startWorkspaceDrag(null);

    if (dragPayload.type === 'pane') {
      if (dragPayload.tabId === tab.id) {
        if (dragPayload.paneId === targetPaneId) return;
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  rootNode: movePaneInTree(t.rootNode, dragPayload.paneId, targetPaneId, zone),
                  activePaneId: dragPayload.paneId,
                }
              : t
          )
        );
        setStatusMessage(
          zone === 'center'
            ? `Swapped "${dragPayload.title}" with target pane.`
            : `Moved "${dragPayload.title}" to ${zone} split.`
        );
      } else {
        const sourceTab = tabs.find((t) => t.id === dragPayload.tabId);
        const sourceNode = sourceTab ? findPaneNode(sourceTab.rootNode, dragPayload.paneId) : null;
        if (!sourceTab || !sourceNode) return;
        const effectiveZone: Exclude<DropZonePosition, 'center'> =
          zone === 'center' ? 'right' : zone;
        setTabs((prev) => {
          const next: TabItem[] = [];
          for (const t of prev) {
            if (t.id === sourceTab.id) {
              const remRoot = removePaneFromTree(t.rootNode, dragPayload.paneId);
              if (remRoot) {
                const remPanes = collectPanes(remRoot);
                next.push({
                  ...t,
                  rootNode: remRoot,
                  activePaneId: remPanes[0]?.id || '',
                });
              }
            } else if (t.id === tab.id) {
              next.push({
                ...t,
                rootNode: dockNodeInTree(t.rootNode, targetPaneId, sourceNode, effectiveZone),
                activePaneId: sourceNode.id,
              });
            } else {
              next.push(t);
            }
          }
          return next;
        });
        setActiveTabId(tab.id);
        setStatusMessage(`Docked "${dragPayload.title}" (${effectiveZone}) into current view.`);
      }
      return;
    }

    if (dragPayload.type === 'tab') {
      const effectiveZone: Exclude<DropZonePosition, 'center'> =
        zone === 'center' ? 'right' : zone;
      handleMergeTabIntoSplit(dragPayload.tabId, tab.id, targetPaneId, effectiveZone);
      return;
    }

    if (dragPayload.type === 'host') {
      const hostObj = vaultSummary.hosts.find((h) => h.id === dragPayload.hostId);
      if (hostObj) {
        const effectiveZone: Exclude<DropZonePosition, 'center'> =
          zone === 'center' ? 'right' : zone;
        void handleConnectHostIntoSplit(hostObj, effectiveZone, targetPaneId);
      }
      return;
    }

    if (dragPayload.type === 'tool') {
      const effectiveZone: Exclude<DropZonePosition, 'center'> =
        zone === 'center' ? 'right' : zone;
      void handleDockToolIntoSplit(
        dragPayload.toolType,
        effectiveZone,
        targetPaneId,
        dragPayload.hostId
      );
    }
  };

  const renderPaneDropOverlay = (
    tab: TabItem,
    node: Extract<WorkspaceNode, { type: 'pane' }>
  ): React.JSX.Element | null => {
    const activeDrag = workspaceDragItem || workspaceDragRef.current;
    if (!activeDrag) return null;
    if (activeDrag.type === 'pane' && activeDrag.paneId === node.id) return null;

    const isSameTabPane = activeDrag.type === 'pane' && activeDrag.tabId === tab.id;
    const activeZone =
      dropTargetIndicator?.paneId === node.id ? dropTargetIndicator.zone : null;

    const zoneButtons: { zone: DropZonePosition; label: string; icon: string }[] = [
      { zone: 'top', label: `Dock Top on ${node.title}`, icon: '⬒ Top' },
      { zone: 'left', label: `Dock Left on ${node.title}`, icon: '◧ Left' },
      {
        zone: 'center',
        label: isSameTabPane ? `Swap with ${node.title}` : `Dock Center on ${node.title}`,
        icon: isSameTabPane ? '⇄ Swap' : '⊕ Dock',
      },
      { zone: 'right', label: `Dock Right on ${node.title}`, icon: '◨ Right' },
      { zone: 'bottom', label: `Dock Bottom on ${node.title}`, icon: '⬓ Bottom' },
    ];

    return (
      <div className="pane-drop-overlay" aria-label={`Drop Zones for ${node.title}`}>
        {activeZone && (
          <div className={`pane-snap-highlight snap-${activeZone}`}>
            <span className="pane-snap-badge">
              {activeZone === 'center' && isSameTabPane
                ? `⇄ Swap with ${node.title}`
                : `Snap ${activeZone.toUpperCase()} — ${activeDrag.type === 'host' ? activeDrag.label : activeDrag.title}`}
            </span>
          </div>
        )}
        <div className="pane-snap-compass">
          {zoneButtons.map((zb) => (
            <button
              key={zb.zone}
              type="button"
              className={`snap-compass-btn compass-${zb.zone} ${activeZone === zb.zone ? 'active' : ''}`}
              aria-label={zb.label}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dropTargetIndicator?.paneId !== node.id || dropTargetIndicator?.zone !== zb.zone) {
                  setDropTargetIndicator({ paneId: node.id, zone: zb.zone });
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleExecuteDropOnPane(tab, node.id, zb.zone);
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleExecuteDropOnPane(tab, node.id, zb.zone);
              }}
            >
              {zb.icon}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderWorkspaceNode = (
    node: WorkspaceNode,
    tab: TabItem,
    totalPanes: number
  ): React.JSX.Element => {
    if (node.type === 'pane') {
      const isPaneActive = node.id === tab.activePaneId;
      const isDragSource =
        workspaceDragItem?.type === 'pane' && workspaceDragItem.paneId === node.id;

      const commonPaneDragEvents = {
        onDragOver: (e: React.DragEvent) => {
          const dragPayload = workspaceDragRef.current || workspaceDragItem;
          if (!dragPayload) return;
          if (dragPayload.type === 'pane' && dragPayload.paneId === node.id) return;
          e.preventDefault();
          e.stopPropagation();
          const isSameTab = dragPayload.type === 'pane' && dragPayload.tabId === tab.id;
          const detectedZone = getDropZoneFromEvent(e, isSameTab);
          if (
            dropTargetIndicator?.paneId !== node.id ||
            dropTargetIndicator?.zone !== detectedZone
          ) {
            setDropTargetIndicator({ paneId: node.id, zone: detectedZone });
          }
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          handleExecuteDropOnPane(tab, node.id);
        },
      };

      if (node.paneType === 'notes') {
        const targetHostId = node.notesHostId || node.hostId || '';
        return (
          <div
            key={node.id}
            className={`split-pane split-notes-pane ${isPaneActive ? 'active' : ''} ${isDragSource ? 'is-dragging-pane' : ''}`}
            aria-label={`Notes Pane ${node.title}`}
            {...commonPaneDragEvents}
            onClick={() => {
              setTabs((prev) =>
                prev.map((t) => (t.id === tab.id ? { ...t, activePaneId: node.id } : t))
              );
            }}
          >
            <HostNotesDrawer
              isOpen={true}
              isPinned={true}
              hostId={targetHostId}
              notes={notes}
              hosts={vaultSummary.hosts.map((h) => ({
                id: h.id,
                label: h.label,
                address: h.address,
              }))}
              onSaveNote={handleSaveNote}
              onDeleteNote={handleDeleteNote}
              onClose={() => void handleClosePane(tab.id, node.id)}
              onOpenFullNotes={() => openNotesTab(targetHostId || undefined)}
              onHeaderDragStart={(e) => {
                e.stopPropagation();
                startWorkspaceDrag({
                  type: 'pane',
                  tabId: tab.id,
                  paneId: node.id,
                  title: node.title,
                });
              }}
              onHeaderDragEnd={() => startWorkspaceDrag(null)}
            />
            {renderPaneDropOverlay(tab, node)}
          </div>
        );
      }

      if (node.paneType === 'totp' || node.paneType === 'snippets' || node.paneType === 'sftp') {
        return (
          <div
            key={node.id}
            className={`split-pane split-widget-pane ${isPaneActive ? 'active' : ''} ${isDragSource ? 'is-dragging-pane' : ''}`}
            aria-label={`Pane ${node.title}`}
            {...commonPaneDragEvents}
            onClick={() => {
              setTabs((prev) =>
                prev.map((t) => (t.id === tab.id ? { ...t, activePaneId: node.id } : t))
              );
            }}
          >
            <div
              className="split-pane-header"
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                startWorkspaceDrag({
                  type: 'pane',
                  tabId: tab.id,
                  paneId: node.id,
                  title: node.title,
                });
              }}
              onDragEnd={() => startWorkspaceDrag(null)}
              title="Drag header to rearrange or dock pane"
            >
              <div className="pane-header-left">
                <span className="pane-drag-handle" aria-hidden="true">
                  <CyberIcon name="grip" size={12} />
                </span>
                <span className="pane-widget-icon">
                  <CyberIcon
                    name={
                      node.paneType === 'totp'
                        ? 'totp'
                        : node.paneType === 'snippets'
                          ? 'bolt'
                          : 'folder'
                    }
                    size={13}
                  />
                </span>
                <span className="pane-title-text" title={node.title}>
                  {node.title}
                </span>
              </div>
              <div className="pane-header-actions">
                {isPaneActive ? (
                  <span className="pane-active-indicator">● ACTIVE</span>
                ) : (
                  <span className="pane-inactive-hint">FOCUS</span>
                )}
                {totalPanes > 1 && (
                  <button
                    type="button"
                    className="pane-undock-btn"
                    aria-label={`Undock Pane ${node.title}`}
                    title="Undock pane into its own standalone tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUndockPaneToTab(tab.id, node.id);
                    }}
                  >
                    <CyberIcon name="undock" size={12} />
                  </button>
                )}
                <button
                  type="button"
                  className="pane-close-btn"
                  aria-label={`Close Pane ${node.title}`}
                  title="Close Docked Pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleClosePane(tab.id, node.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="docked-widget-body">
              {node.paneType === 'totp' ? (
                <TotpManagerModal
                  isOpen={true}
                  isDocked={true}
                  hosts={vaultSummary.hosts.map((h) => ({
                    id: h.id,
                    label: h.label,
                    address: `${h.effectiveUser}@${h.address}:${h.effectivePort}`,
                  }))}
                  activeSessionId={sessionId}
                  onInjectCode={handleInjectTotp}
                  onRefreshVault={refreshVaultState}
                  onClose={() => void handleClosePane(tab.id, node.id)}
                />
              ) : node.paneType === 'snippets' ? (
                <SnippetsManagerModal
                  isDocked={true}
                  snippets={vaultSummary.snippets || []}
                  onSaveSnippet={handleSaveSnippet}
                  onDeleteSnippet={handleDeleteSnippet}
                  onRunSnippet={(snip) => {
                    const targetTermPane =
                      collectPanes(tab.rootNode).find(
                        (p) => !p.paneType || p.paneType === 'terminal'
                      ) || activePane;
                    void handleTriggerSnippet(snip, targetTermPane?.sessionId || '');
                  }}
                  onClose={() => void handleClosePane(tab.id, node.id)}
                />
              ) : (
                <SftpBrowserView
                  sessionId={
                    node.sftpSessionId ||
                    collectPanes(tab.rootNode).find(
                      (p) => !p.paneType || p.paneType === 'terminal'
                    )?.sessionId ||
                    node.sessionId
                  }
                  hostLabel={node.title.replace('SFTP: ', '')}
                  api={{
                    listLocalDir: (p) =>
                      getWailsBindings()?.ListLocalDir?.(p) ?? Promise.resolve([]),
                    listRemoteDir: (sid, p) =>
                      getWailsBindings()?.ListRemoteDir?.(sid, p) ?? Promise.resolve([]),
                    startSftpUpload: (sid, l, r) =>
                      getWailsBindings()?.StartSftpUpload?.(sid, l, r) ?? Promise.resolve(''),
                    startSftpDownload: (sid, r, l) =>
                      getWailsBindings()?.StartSftpDownload?.(sid, r, l) ?? Promise.resolve(''),
                    createRemoteDir: (sid, p) =>
                      getWailsBindings()?.CreateRemoteDir?.(sid, p) ?? Promise.resolve(),
                    deleteRemoteItem: (sid, p) =>
                      getWailsBindings()?.DeleteRemoteItem?.(sid, p) ?? Promise.resolve(),
                    cancelTransfer: (tid) =>
                      getWailsBindings()?.CancelTransfer?.(tid) ?? Promise.resolve(),
                    getActiveTransfers: () =>
                      getWailsBindings()?.GetActiveTransfers?.() ?? Promise.resolve([]),
                  }}
                  eventsOn={getWailsRuntime()?.EventsOn}
                  onClose={() => void handleClosePane(tab.id, node.id)}
                />
              )}
            </div>
            {renderPaneDropOverlay(tab, node)}
          </div>
        );
      }

      const currentSize = paneFontSizes.get(node.sessionId) || globalSettings.fontSize;
      const isBroadcastingThis = getBroadcastTargetSessionIds().includes(node.sessionId);
      return (
        <div
          key={node.id}
          className={`split-pane ${isPaneActive ? 'active' : ''} ${isBroadcastingThis ? 'is-broadcasting' : ''} ${isDragSource ? 'is-dragging-pane' : ''}`}
          aria-label={`Pane ${node.title}`}
          {...commonPaneDragEvents}
          onClick={() => {
            setTabs((prev) =>
              prev.map((t) => (t.id === tab.id ? { ...t, activePaneId: node.id } : t))
            );
            focusersRef.current.get(node.sessionId)?.();
          }}
        >
          <div
            className="split-pane-header"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              startWorkspaceDrag({
                type: 'pane',
                tabId: tab.id,
                paneId: node.id,
                title: node.title,
              });
            }}
            onDragEnd={() => startWorkspaceDrag(null)}
            title="Drag header to rearrange, swap, or snap split panes"
          >
            <div className="pane-header-left">
              <span className="pane-drag-handle" aria-hidden="true">
                <CyberIcon name="grip" size={12} />
              </span>
              <span
                className={`pane-focus-dot ${isPaneActive ? 'active' : ''}`}
                title={isPaneActive ? 'Active Pane' : 'Click to focus'}
              />
              {isBroadcastingThis && (
                <span className="pane-broadcast-badge" title="Broadcast Input ACTIVE on this pane">
                  🔴 BROADCAST
                </span>
              )}
              <span className="pane-title-text" title={node.title}>
                {node.title}
              </span>
              {(node.cwd || getSessionCwd(node.sessionId)) && (
                <span
                  className="pane-cwd-pill"
                  title={`Current working directory: ${node.cwd || getSessionCwd(node.sessionId)}`}
                >
                  <CyberIcon name="folder" size={10} /> {node.cwd || getSessionCwd(node.sessionId)}
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
                    <CyberIcon name="bolt" size={11} /> BRK
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
                    <CyberIcon name="wave" size={11} />
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
                className={`pane-hud-btn ${searchOpenPanes.has(node.sessionId) ? 'active' : ''}`}
                aria-label={`Find in ${node.title}`}
                title="Find in terminal (Ctrl+F)"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePaneSearch(node.sessionId);
                }}
              >
                <CyberIcon name="search" size={12} />
              </button>
              {!node.sessionId.startsWith('local-') && !node.sessionId.startsWith('serial-') && (
                <button
                  type="button"
                  className="pane-hud-btn"
                  aria-label={`Open SFTP for ${node.title}`}
                  title="Open SFTP File Browser"
                  onClick={(e) => {
                    e.stopPropagation();
                    openSftpTab(node.sessionId, node.title, node.hostId);
                  }}
                >
                  <CyberIcon name="folder" size={12} />
                </button>
              )}
              <button
                type="button"
                className="pane-hud-btn"
                aria-label={`Run Snippet in ${node.title}`}
                title="Run command snippet in this terminal"
                onClick={(e) => {
                  e.stopPropagation();
                  setSnippetActiveSessionId(node.sessionId);
                  setShowSnippetsModal(true);
                }}
              >
                <CyberIcon name="bolt" size={12} />
              </button>
              <button
                type="button"
                className={`pane-hud-btn pane-rec-btn ${activeLogSessions.has(node.sessionId) ? 'recording' : ''}`}
                aria-label={`Toggle Session Logging for ${node.title}`}
                title="Toggle Timestamped Session Logging"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleToggleSessionLog(node.sessionId, node.title, node.hostId);
                }}
              >
                <CyberIcon name="record" size={10} />
                <span className="sr-only">
                  {activeLogSessions.has(node.sessionId) ? '⏺ REC' : '⚪ Log'}
                </span>
                {activeLogSessions.has(node.sessionId) && (
                  <span className="hud-micro-tag">REC</span>
                )}
              </button>
              <button
                type="button"
                className={`pane-hud-btn pane-broadcast-btn ${isBroadcastingThis ? 'active' : ''}`}
                aria-label={`Toggle Broadcast for ${node.title}`}
                title={
                  isBroadcastingThis
                    ? 'Terminal is receiving broadcast input. Click to toggle.'
                    : 'Click to add terminal to broadcast group.'
                }
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleSessionBroadcast(node.sessionId);
                }}
              >
                <CyberIcon name="broadcast" size={12} />
                <span className="sr-only">{isBroadcastingThis ? '📡 ACTIVE' : '📡 Cast'}</span>
                {isBroadcastingThis && <span className="hud-micro-tag">CAST</span>}
              </button>
              {node.hostId && (
                <div className="pane-notes-group">
                  <button
                    type="button"
                    className={`pane-hud-btn ${openNotesDrawerHostId === node.hostId ? 'active' : ''}`}
                    aria-label={`Toggle Host Notes for ${node.title}`}
                    title="Toggle Host Notes Drawer"
                    onClick={(e) => {
                      e.stopPropagation();
                      const hid = node.hostId ?? '';
                      setOpenNotesDrawerHostId((prev) => (prev === hid ? null : hid));
                    }}
                  >
                    <CyberIcon name="note" size={12} />
                  </button>
                  <button
                    type="button"
                    className="pane-hud-btn"
                    aria-label={`Pin Notes Split for ${node.title}`}
                    title="Pin notes as horizontal split view alongside terminal"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePinNotesSplit(node.hostId);
                    }}
                  >
                    <CyberIcon name="pin" size={11} />
                  </button>
                </div>
              )}
              {totalPanes > 1 && (
                <>
                  <button
                    type="button"
                    className="pane-undock-btn"
                    aria-label={`Undock Pane ${node.title}`}
                    title="Undock pane into its own standalone tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUndockPaneToTab(tab.id, node.id);
                    }}
                  >
                    <CyberIcon name="undock" size={12} />
                  </button>
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
                </>
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
          {renderPaneDropOverlay(tab, node)}
        </div>
      );
    }

    const childCount = node.children.length;
    const ratios =
      node.ratios && node.ratios.length === childCount
        ? node.ratios
        : node.children.map(() => 100 / childCount);

    return (
      <div
        key={node.id}
        data-split-id={node.id}
        className={`split-container split-${node.direction}`}
        aria-label={`Split Container ${node.direction}`}
      >
        {node.children.map((child, idx) => (
          <React.Fragment key={child.id}>
            <div
              className="split-child-slot"
              style={{
                flex: `${ratios[idx]} 1 0%`,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                overflow: 'hidden',
              }}
            >
              {renderWorkspaceNode(child, tab, totalPanes)}
            </div>
            {idx < childCount - 1 && (
              <div
                className={`split-resizer-bar split-resizer-${node.direction} ${
                  activeSplitResize?.splitId === node.id && activeSplitResize?.index === idx
                    ? 'resizing'
                    : ''
                }`}
                role="separator"
                aria-orientation={node.direction === 'horizontal' ? 'vertical' : 'horizontal'}
                aria-label={`Resize Split ${node.direction} ${idx + 1}`}
                title="Drag to resize panes (Double-click to equalize)"
                onMouseDown={(e) =>
                  handleSplitResizeStart(e, tab.id, node.id, node.direction, idx, ratios)
                }
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleResetSplitRatios(tab.id, node.id, childCount);
                }}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const executeShortcutAction = (actionId: ShortcutActionId): void => {
    switch (actionId) {
      case 'command_palette':
        setShowCommandPalette((prev) => !prev);
        break;
      case 'global_settings':
        setShowGlobalSettingsModal((prev) => !prev);
        break;
      case 'toggle_sidebar':
        setSidebarCollapsed((prev) => !prev);
        break;
      case 'new_tab':
        quickConnectInputRef.current?.focus();
        break;
      case 'close_pane':
        if (activeTab && activePane) {
          void handleClosePane(activeTab.id, activePane.id);
        }
        break;
      case 'split_horizontal':
        if (activeTab && activePane) {
          void handleSplitPane('horizontal');
        }
        break;
      case 'split_vertical':
        if (activeTab && activePane) {
          void handleSplitPane('vertical');
        }
        break;
      case 'cycle_tabs_prev':
      case 'cycle_tabs_next': {
        const delta = actionId === 'cycle_tabs_next' ? 1 : -1;
        setTabs((currentTabs) => {
          if (currentTabs.length === 0) return currentTabs;
          setActiveTabId((currId) => {
            const idx = currentTabs.findIndex((t) => t.id === currId);
            const nextIdx = cycleIndexLocal(idx === -1 ? 0 : idx, currentTabs.length, delta);
            const nextTab = currentTabs[nextIdx];
            const panes = collectPanes(nextTab.rootNode);
            const pane = panes.find((p) => p.id === nextTab.activePaneId) || panes[0];
            if (pane) {
              setTimeout(() => focusersRef.current.get(pane.sessionId)?.(), 50);
            }
            return nextTab.id;
          });
          return currentTabs;
        });
        break;
      }
      case 'cycle_panes_prev':
      case 'cycle_panes_next': {
        const delta = actionId === 'cycle_panes_next' ? 1 : -1;
        setTabs((currentTabs) =>
          currentTabs.map((t) => {
            if (t.id !== activeTabId) return t;
            const panes = collectPanes(t.rootNode);
            if (panes.length <= 1) return t;
            const idx = panes.findIndex((p) => p.id === t.activePaneId);
            const nextIdx = cycleIndexLocal(idx === -1 ? 0 : idx, panes.length, delta);
            const nextPane = panes[nextIdx];
            if (nextPane) {
              setTimeout(() => focusersRef.current.get(nextPane.sessionId)?.(), 50);
            }
            return { ...t, activePaneId: nextPane.id };
          })
        );
        break;
      }
      case 'find_in_terminal':
        if (activePane) {
          togglePaneSearch(activePane.sessionId);
        }
        break;
      case 'font_zoom_in':
        if (activePane) {
          const next = changeTerminalFontSize(activePane.sessionId, +1);
          setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, next)));
        }
        break;
      case 'font_zoom_out':
        if (activePane) {
          const next = changeTerminalFontSize(activePane.sessionId, -1);
          setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, next)));
        }
        break;
      case 'font_zoom_reset':
        if (activePane) {
          resetTerminalFontSize(activePane.sessionId, globalSettings.fontSize);
          setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, globalSettings.fontSize)));
        }
        break;
      case 'quick_connect':
        quickConnectInputRef.current?.focus();
        break;
      case 'open_default_dir':
        void handleOpenTerminalDirectory('default');
        break;
      case 'open_current_dir':
        void handleOpenTerminalDirectory('current');
        break;
      case 'open_root_shell':
        void handleOpenTerminalDirectory('root');
        break;
      case 'disconnect_active':
        void handleDisconnect();
        break;
      case 'inject_password':
        void handleInjectPassword();
        break;
      case 'inject_totp':
        void handleInjectTotp();
        break;
      case 'open_snippets':
        setShowSnippetsModal(true);
        break;
      case 'open_totp':
        setShowTotpModal(true);
        break;
      case 'open_tunnels':
        setShowPortForwardingModal(true);
        break;
      case 'open_proxy_profiles':
        setShowProxyProfilesModal(true);
        break;
      case 'open_sftp':
        if (activePane) {
          openSftpTab(activePane.sessionId, activePane.title, activeTab?.hostId);
        }
        break;
      case 'open_keychain':
        setShowKeychainModal(true);
        break;
      case 'lock_vault':
        void handleVaultLock();
        break;
      case 'toggle_broadcast':
        handleToggleBroadcast();
        break;
    }
  };

  const executeShortcutActionRef = useRef<(actionId: ShortcutActionId) => void>(() => {});
  executeShortcutActionRef.current = executeShortcutAction;

  const executeCustomShortcut = (sc: CustomShortcutItem): void => {
    if (sc.snippetId && activePane) {
      const snip = (vaultSummary.snippets || []).find((s) => s.id === sc.snippetId);
      if (snip) {
        void handleTriggerSnippet(snip, activePane.sessionId);
        return;
      }
    }
    const match = SYSTEM_SHORTCUTS.find((d) => d.label === sc.action);
    if (match) {
      executeShortcutAction(match.actionId);
    }
  };

  const executeCustomShortcutRef = useRef<(sc: CustomShortcutItem) => void>(() => {});
  executeCustomShortcutRef.current = executeCustomShortcut;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // 1. Escape key cancels overlays and disarms leader mode / broadcast mode
      if (e.key === 'Escape') {
        if (broadcastState.enabled) {
          handleToggleBroadcast();
          return;
        }
        setLeaderArmed(false);
        if (leaderTimerRef.current) {
          clearTimeout(leaderTimerRef.current);
          leaderTimerRef.current = null;
        }
        setShowCommandPalette(false);
        setShowGlobalSettingsModal(false);
        setActiveDropdownMenu(null);
        if (searchOpenPanes.size > 0) {
          for (const sid of searchOpenPanes) {
            clearTerminalSearch(sid);
          }
          setSearchOpenPanes(new Set());
        }
        return;
      }

      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      // 2. Leader Key Mode (if enabled)
      if (globalSettings.leaderKeyEnabled) {
        const leaderKey = globalSettings.leaderKey || 'Ctrl+B';
        const isLeaderPressed = matchesShortcut(e, leaderKey);

        if (isLeaderPressed) {
          e.preventDefault();
          e.stopPropagation();
          if (leaderArmed) {
            // Second press of leader key: disarm and write raw leader key character to terminal session
            setLeaderArmed(false);
            if (leaderTimerRef.current) {
              clearTimeout(leaderTimerRef.current);
              leaderTimerRef.current = null;
            }
            if (activePane) {
              const rawChar = leaderKey.includes('A') ? '\x01' : leaderKey.includes('Space') ? '\x00' : '\x02';
              const api = getWailsBindings();
              void api?.WriteTerminal?.(activePane.sessionId, rawChar);
            }
          } else {
            // First press: arm leader key mode!
            setLeaderArmed(true);
            if (leaderTimerRef.current) {
              clearTimeout(leaderTimerRef.current);
            }
            leaderTimerRef.current = setTimeout(() => {
              setLeaderArmed(false);
              leaderTimerRef.current = null;
            }, globalSettings.leaderTimeoutMs || 2000);
          }
          return;
        }

        if (leaderArmed) {
          e.preventDefault();
          e.stopPropagation();
          setLeaderArmed(false);
          if (leaderTimerRef.current) {
            clearTimeout(leaderTimerRef.current);
            leaderTimerRef.current = null;
          }

          const keyLower = e.key.toLowerCase();
          const matchedDef = SYSTEM_SHORTCUTS.find(
            (d) => d.leaderKey && (d.leaderKey.toLowerCase() === keyLower || d.leaderKey === e.key)
          );
          if (matchedDef) {
            executeShortcutActionRef.current(matchedDef.actionId);
          }
          return;
        }
      }

      // 3. Normal / Direct Shortcut Matching
      // When inside an input element, only trigger combinations with Ctrl / Alt / Meta
      if (isInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
        return;
      }

      const bindings = globalSettings.keybindings || {};
      for (const def of SYSTEM_SHORTCUTS) {
        const configuredKey = bindings[def.actionId] || def.defaultKey;
        if (matchesShortcut(e, configuredKey)) {
          e.preventDefault();
          e.stopPropagation();
          executeShortcutActionRef.current(def.actionId);
          return;
        }
      }

      // 4. Custom Shortcuts Matching
      const customList = globalSettings.customShortcuts || [];
      for (const sc of customList) {
        if (matchesShortcut(e, sc.keyCombo)) {
          e.preventDefault();
          e.stopPropagation();
          executeCustomShortcutRef.current(sc);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    globalSettings.leaderKeyEnabled,
    globalSettings.leaderKey,
    globalSettings.leaderTimeoutMs,
    globalSettings.keybindings,
    globalSettings.customShortcuts,
    leaderArmed,
    activePane,
    searchOpenPanes,
    broadcastState.enabled,
    handleToggleBroadcast,
  ]);

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
          <img
            src={appLogo}
            alt="DoubleAgent Logo"
            className="brand-logo-img"
            onClick={() => {
              setSettingsActiveTab('about');
              setShowGlobalSettingsModal(true);
            }}
            title="DoubleAgent SSH Client (Click for About info)"
            style={{ cursor: 'pointer' }}
          />
          <h1>DoubleAgent</h1>
          <span className={`status-badge ${vaultLocked ? 'locked' : 'unlocked'}`}>
            {vaultLocked ? 'Vault Locked' : passwordless ? 'Vault Unlocked (No PW)' : 'Vault Unlocked'}
          </span>
          {leaderArmed && (
            <span
              className="leader-status-pill"
              title="Leader Key Mode armed. Next keystroke will trigger command or press leader key again to send raw key to terminal."
            >
              ⌨️ LEADER ({globalSettings.leaderKey || 'Ctrl+B'})
            </span>
          )}
          {broadcastState.enabled && (
            <div
              className="broadcast-status-pill"
              role="status"
              aria-label="Broadcast Input Mode Active"
              title="Broadcast Input ACTIVE: keystrokes will be sent to all participating terminals. Click to disarm."
            >
              <span className="broadcast-pulse-dot" />
              <span className="broadcast-banner-label">
                📡 BROADCAST ({getBroadcastTargetSessionIds().length} sessions)
              </span>
              <button
                type="button"
                className="broadcast-disarm-btn"
                onClick={() => handleToggleBroadcast()}
                title="Disarm Broadcast Mode (Esc / Alt+B)"
                aria-label="Disarm Broadcast Mode"
              >
                ✕ Disarm
              </button>
            </div>
          )}
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
                  onMouseEnter={() => handleMenuEnter('vault')}
                  onMouseMove={handleMenuMove}
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
                      openSettingsTab('security');
                    }}
                  >
                    <span>Vault Security &amp; Hello</span>
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
                  <div className="nav-dropdown-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      setSettingsActiveTab('about');
                      setShowGlobalSettingsModal(true);
                    }}
                  >
                    <span>ℹ About DoubleAgent</span>
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
                  className="nav-dropdown-menu tools-dropdown-menu"
                  role="menu"
                  aria-label="Tools Menu"
                  onMouseEnter={() => handleMenuEnter('tools')}
                  onMouseMove={handleMenuMove}
                >
                  {/* Column 1: Terminals & Consoles */}
                  <div className="tools-dropdown-col">
                    <div className="tools-col-title">
                      <span>⚡ Terminals &amp; Consoles</span>
                    </div>

                    <div className="tools-sub-header">Local &amp; Directory Shells</div>
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

                    <div className="tools-sub-header">Hardware &amp; Session Actions</div>
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
                        <button
                          type="button"
                          role="menuitem"
                          className="nav-dropdown-item"
                          onClick={() => {
                            setActiveDropdownMenu(null);
                            void handleInjectTotp();
                          }}
                        >
                          <span>Inject 2FA Code</span>
                          <span className="nav-dropdown-shortcut">🔐 2FA</span>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Column 2: Tools & Utilities */}
                  <div className="tools-dropdown-col">
                    <div className="tools-col-title">
                      <span>🛠️ Tools &amp; Utilities</span>
                    </div>

                    <div className="tools-sub-header">Security &amp; Credentials</div>
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
                        setShowTotpModal(true);
                      }}
                    >
                      <span>TOTP Authenticator Generator</span>
                      <span className="nav-dropdown-shortcut">🔐 2FA</span>
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
                      <span className="nav-dropdown-shortcut">🔑</span>
                    </button>

                    <div className="tools-sub-header">Automation &amp; Networking</div>
                    <button
                      type="button"
                      role="menuitem"
                      className={`nav-dropdown-item ${broadcastState.enabled ? 'active' : ''}`}
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        handleToggleBroadcast();
                      }}
                    >
                      <span>{broadcastState.enabled ? '🔴 Disarm Broadcast Mode' : '📡 Broadcast Input Mode'}</span>
                      <span className="nav-dropdown-shortcut">Alt+B</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        setNotesModalHostId(activeTab?.hostId);
                        setNotesModalInitialNoteId(null);
                        setShowNotesModal(true);
                      }}
                    >
                      <span>Host Notes &amp; Docs</span>
                      <span className="nav-dropdown-shortcut">📝</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        void refreshSessionLogs();
                        setShowSessionLogsModal(true);
                      }}
                    >
                      <span>Session Logs &amp; Recordings</span>
                      <span className="nav-dropdown-shortcut">⏺</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        setShowSnippetsModal(true);
                      }}
                    >
                      <span>Command Snippets &amp; Variables</span>
                      <span className="nav-dropdown-shortcut">⚡ Snippets</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        setShowPortForwardingModal(true);
                      }}
                    >
                      <span>Port Forwarding (-L, -R, -D)</span>
                      <span className="nav-dropdown-shortcut">
                        {activeTunnels.length > 0 ? `⚡ ${activeTunnels.length} active` : '⇄ Tunnels'}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        setShowProxyProfilesModal(true);
                      }}
                    >
                      <span>Proxy Profiles (Jump, SOCKS5, Command)</span>
                      <span className="nav-dropdown-shortcut">🛡️ Profiles</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      disabled={!sessionId || sessionId.startsWith('local-') || sessionId.startsWith('serial-')}
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        if (sessionId && !sessionId.startsWith('local-') && !sessionId.startsWith('serial-')) {
                          openSftpTab(sessionId, activeTab?.title || 'SFTP', activeTab?.hostId);
                        }
                      }}
                    >
                      <span>SFTP File Browser</span>
                      <span className="nav-dropdown-shortcut">📁 SFTP</span>
                    </button>

                    <div className="tools-sub-header">Config Import &amp; Export</div>
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
                      <span className="nav-dropdown-shortcut">⚙️</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setActiveDropdownMenu(null);
                        void handleOpenProxychainsExport();
                      }}
                    >
                      <span>Export proxychains.conf</span>
                      <span className="nav-dropdown-shortcut">⛓️ Export</span>
                    </button>
                  </div>
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
                  onMouseEnter={() => handleMenuEnter('view')}
                  onMouseMove={handleMenuMove}
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

            {/* Port Forwarding / Tunnels Pill Button */}
            <button
              type="button"
              className={`nav-menu-trigger ${activeTunnels.length > 0 ? 'active' : ''}`}
              onClick={() => setShowPortForwardingModal(true)}
              title="Port Forwarding & Tunnels"
              aria-label="Port Forwarding"
              style={
                activeTunnels.length > 0
                  ? {
                      color: 'var(--color-primary-green, #10b981)',
                      borderColor: 'rgba(16, 185, 129, 0.4)',
                    }
                  : undefined
              }
            >
              <span>{activeTunnels.length > 0 ? `⚡ ${activeTunnels.length} Tunnels` : 'Tunnels ⇄'}</span>
            </button>

            {/* Global Settings */}
            <button
              type="button"
              className="nav-menu-trigger"
              onClick={() => {
                setSettingsActiveTab('appearance');
                setShowGlobalSettingsModal(true);
              }}
              title="Global Settings (Ctrl+,)"
              aria-label="Settings ⚙"
            >
              <span>Settings ⚙</span>
            </button>
          </nav>
        </div>

        <form
          className={`quick-connect-bar cyber-quick-connect ${quickConnectExpanded ? 'is-expanded' : ''}`}
          onSubmit={(e) => void handleConnect(e)}
        >
          <span className="quick-connect-prefix" title="Direct SSH Quick Connect">
            <CyberIcon name="terminal" size={13} />
            <span>SSH</span>
          </span>
          <input
            ref={quickConnectInputRef}
            className="qc-user-input"
            aria-label="Username"
            placeholder="user"
            value={username}
            onFocus={() => setQuickConnectExpanded(true)}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <span className="qc-sep">@</span>
          <input
            className="qc-host-input"
            aria-label="Host Address"
            placeholder="host / IP (or user@host:port)"
            value={address}
            onFocus={() => setQuickConnectExpanded(true)}
            onChange={(e) => {
              const val = e.target.value;
              const match = val.match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?$/);
              if (match) {
                setUsername(match[1]);
                setAddress(match[2]);
                if (match[3]) setPort(match[3]);
              } else {
                setAddress(val);
              }
            }}
            required
          />
          <span className="qc-sep">:</span>
          <input
            aria-label="Port"
            className="port-input qc-port-input"
            placeholder="22"
            value={port}
            onFocus={() => setQuickConnectExpanded(true)}
            onChange={(e) => setPort(e.target.value)}
            required
          />
          <input
            className="qc-pass-input"
            aria-label="Password"
            type="password"
            placeholder="Password (opt)"
            value={password}
            onFocus={() => setQuickConnectExpanded(true)}
            onChange={(e) => setPassword(e.target.value)}
          />
          {sessionId ? (
            <button type="button" className="btn-danger btn-sm qc-submit-btn" onClick={() => void handleDisconnect()}>
              Disconnect
            </button>
          ) : (
            <button type="submit" className="btn-primary btn-sm qc-submit-btn">
              Connect SSH
            </button>
          )}
        </form>
      </header>

      <div className="workspace-body">
        <aside
          className={`hosts-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${
            sidebarWidth < 280 ? 'narrow' : ''
          } ${sidebarWidth < 220 ? 'compact' : ''}`}
          style={{ width: sidebarCollapsed ? undefined : `${sidebarWidth}px` }}
          aria-label="Hosts and Groups Sidebar"
        >
          {sidebarCollapsed ? (
            <div className="sidebar-collapsed-content">
              <img
                src={appLogo}
                alt="DoubleAgent"
                className="sidebar-collapsed-logo"
                onClick={() => setSidebarCollapsed(false)}
                title="DoubleAgent (Click to expand sidebar)"
              />
              <button
                type="button"
                className="sidebar-expand-btn"
                onClick={() => setSidebarCollapsed(false)}
                title="Expand Sidebar (Ctrl+B)"
                aria-label="Expand Sidebar"
              >
                <CyberIcon name="chevron-right" size={14} />
                <span className="sidebar-vertical-title">Hosts &amp; Groups</span>
              </button>
            </div>
          ) : (
            <>
              {!vaultLocked && (
                <nav className="sidebar-quick-toolbar" aria-label="Quick Actions">
                  <button
                    type="button"
                    className="sidebar-quick-btn"
                    title="Open SSH Keychain"
                    aria-label="SSH Keychain"
                    onClick={() => {
                      setModalError('');
                      setShowKeychainModal(true);
                    }}
                  >
                    <span className="sidebar-quick-icon">
                      <CyberIcon name="key" size={13} />
                    </span>
                    <span className="sidebar-quick-text">Keys</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-quick-btn"
                    title="Import ssh_config"
                    aria-label="Import ssh_config"
                    onClick={() => {
                      setModalError('');
                      setSshConfigResult(null);
                      setShowSSHConfigModal(true);
                    }}
                  >
                    <span className="sidebar-quick-icon">
                      <CyberIcon name="gear" size={13} />
                    </span>
                    <span className="sidebar-quick-text">Config</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-quick-btn"
                    title="Vault Security & Windows Hello"
                    aria-label="Vault Security"
                    onClick={() => {
                      setModalError('');
                      openSettingsTab('security');
                    }}
                  >
                    <span className="sidebar-quick-icon">
                      <CyberIcon name="shield" size={13} />
                    </span>
                    <span className="sidebar-quick-text">Vault</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-quick-btn"
                    title="Host Notes & Documentation (Click to open or drag onto terminal view to dock)"
                    aria-label="Host Notes & Documentation"
                    draggable
                    onDragStart={() =>
                      startWorkspaceDrag({
                        type: 'tool',
                        toolType: 'notes',
                        hostId: activePane?.hostId || activeTab?.hostId,
                        title: 'Host Notes',
                      })
                    }
                    onDragEnd={() => startWorkspaceDrag(null)}
                    onClick={() => openNotesTab()}
                  >
                    <span className="sidebar-quick-icon">
                      <CyberIcon name="note" size={13} />
                    </span>
                    <span className="sidebar-quick-text">Notes</span>
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
                    <CyberIcon name="chevron-left" size={13} />
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
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                              <CyberIcon name="folder" size={12} /> {grp.name}
                            </span>
                            <small>
                              ({grp.defaultSettings.username || 'root'}:
                              {grp.defaultSettings.port || 22})
                            </small>
                          </div>
                          {groupHosts.map((h) => (
                            <div
                              key={h.id}
                              className="host-card rack-blade-card"
                              draggable
                              onDoubleClick={() => void handleConnectSavedHost(h)}
                              onDragStart={() =>
                                startWorkspaceDrag({
                                  type: 'host',
                                  hostId: h.id,
                                  label: h.label,
                                })
                              }
                              onDragEnd={() => startWorkspaceDrag(null)}
                              title={`Double-click to connect · Drag ${h.label} onto any terminal pane to split`}
                            >
                              <div className="host-info">
                                <div className="host-title-row">
                                  <span
                                    className="host-color-dot"
                                    style={{
                                      backgroundColor: getEffectiveHostColor(h.id, h.color, h.label),
                                    }}
                                    title={`Host Color: ${getEffectiveHostColor(h.id, h.color, h.label)}`}
                                  />
                                  <strong>{h.label}</strong>
                                </div>
                                <span className="host-address-line">
                                  {h.effectiveUser}@{h.address}:{h.effectivePort}
                                </span>
                                {h.initialDir && (
                                  <span className="host-dir-line" title={`Default Directory: ${h.initialDir}`}>
                                    <CyberIcon name="folder" size={10} /> {h.initialDir}
                                  </span>
                                )}
                              </div>
                              <div className="host-card-actions rack-blade-actions">
                                <button
                                  type="button"
                                  className="rack-action-btn rack-connect-btn"
                                  title={`Connect to ${h.label}`}
                                  onClick={() => void handleConnectSavedHost(h)}
                                >
                                  <CyberIcon name="play" size={10} />
                                  <span className="rack-connect-label">Connect</span>
                                </button>
                                <button
                                  type="button"
                                  className="rack-action-btn"
                                  title={`Open ${h.label} side-by-side in current workspace view`}
                                  aria-label={`Split Connect ${h.label}`}
                                  onClick={() => void handleConnectHostIntoSplit(h, 'right')}
                                >
                                  <CyberIcon name="split-h" size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="rack-action-btn"
                                  title={`Open SFTP file browser for ${h.label}`}
                                  aria-label={`SFTP for ${h.label}`}
                                  onClick={() => void handleOpenHostSftp(h)}
                                >
                                  <CyberIcon name="folder" size={12} />
                                  <span className="sr-only">SFTP</span>
                                </button>
                                <button
                                  type="button"
                                  className="rack-action-btn"
                                  title={`Open Notes & Docs for ${h.label}`}
                                  aria-label={`Notes for ${h.label}`}
                                  onClick={() => openNotesTab(h.id)}
                                >
                                  <CyberIcon name="note" size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="rack-action-btn rack-delete-btn"
                                  onClick={() => void handleDeleteHost(h.id)}
                                  aria-label={`Delete ${h.label}`}
                                  title={`Delete ${h.label}`}
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
                        <div
                          key={h.id}
                          className="host-card rack-blade-card"
                          draggable
                          onDoubleClick={() => void handleConnectSavedHost(h)}
                          onDragStart={() =>
                            startWorkspaceDrag({
                              type: 'host',
                              hostId: h.id,
                              label: h.label,
                            })
                          }
                          onDragEnd={() => startWorkspaceDrag(null)}
                          title={`Double-click to connect · Drag ${h.label} onto any terminal pane to split`}
                        >
                          <div className="host-info">
                            <div className="host-title-row">
                              <span
                                className="host-color-dot"
                                style={{
                                  backgroundColor: getEffectiveHostColor(h.id, h.color, h.label),
                                }}
                                title={`Host Color: ${getEffectiveHostColor(h.id, h.color, h.label)}`}
                              />
                              <strong>{h.label}</strong>
                            </div>
                            <span className="host-address-line">
                              {h.effectiveUser}@{h.address}:{h.effectivePort}
                            </span>
                            {h.initialDir && (
                              <span className="host-dir-line" title={`Default Directory: ${h.initialDir}`}>
                                <CyberIcon name="folder" size={10} /> {h.initialDir}
                              </span>
                            )}
                          </div>
                          <div className="host-card-actions rack-blade-actions">
                            <button
                              type="button"
                              className="rack-action-btn rack-connect-btn"
                              title={`Connect to ${h.label}`}
                              onClick={() => void handleConnectSavedHost(h)}
                            >
                              <CyberIcon name="play" size={10} />
                              <span className="rack-connect-label">Connect</span>
                            </button>
                            <button
                              type="button"
                              className="rack-action-btn"
                              title={`Open ${h.label} side-by-side in current workspace view`}
                              aria-label={`Split Connect ${h.label}`}
                              onClick={() => void handleConnectHostIntoSplit(h, 'right')}
                            >
                              <CyberIcon name="split-h" size={12} />
                            </button>
                            <button
                              type="button"
                              className="rack-action-btn"
                              title={`Open SFTP file browser for ${h.label}`}
                              aria-label={`SFTP for ${h.label}`}
                              onClick={() => void handleOpenHostSftp(h)}
                            >
                              <CyberIcon name="folder" size={12} />
                              <span className="sr-only">SFTP</span>
                            </button>
                            <button
                              type="button"
                              className="rack-action-btn"
                              title={`Open Notes & Docs for ${h.label}`}
                              aria-label={`Notes for ${h.label}`}
                              onClick={() => openNotesTab(h.id)}
                            >
                              <CyberIcon name="note" size={12} />
                            </button>
                            <button
                              type="button"
                              className="rack-action-btn rack-delete-btn"
                              onClick={() => void handleDeleteHost(h.id)}
                              aria-label={`Delete ${h.label}`}
                              title={`Delete ${h.label}`}
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

    {!sidebarCollapsed && (
      <div
        className={`sidebar-resizer ${isResizingSidebar ? 'resizing' : ''}`}
        onMouseDown={handleSidebarResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize sidebar"
      />
    )}

        {tabs.length > 0 && activeTab && activePane ? (
          <section className="terminal-workspace" aria-label="Active Terminal Session">
            <div
              className="tabs-bar"
              role="tablist"
              aria-label="Session Tabs"
              onDragOver={(e) => {
                if (workspaceDragRef.current?.type === 'pane' || workspaceDragItem?.type === 'pane') {
                  e.preventDefault();
                }
              }}
              onDrop={(e) => {
                const payload = workspaceDragRef.current || workspaceDragItem;
                if (payload?.type === 'pane') {
                  e.preventDefault();
                  startWorkspaceDrag(null);
                  handleUndockPaneToTab(payload.tabId, payload.paneId);
                }
              }}
            >
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
                                    onDragStart={() => {
                                      setDraggedTabId(tab.id);
                                      startWorkspaceDrag({
                                        type: 'tab',
                                        tabId: tab.id,
                                        title: tab.title,
                                      });
                                    }}
                                    onDragEnd={() => {
                                      setDraggedTabId(null);
                                      startWorkspaceDrag(null);
                                    }}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                      e.stopPropagation();
                                      if (draggedTabId && draggedTabId !== tab.id) {
                                        setTabs((prev) =>
                                          reorderTabsLocal(prev, draggedTabId, tab.id)
                                        );
                                      }
                                      setDraggedTabId(null);
                                      startWorkspaceDrag(null);
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
                        onDragStart={() => {
                          setDraggedTabId(tab.id);
                          startWorkspaceDrag({
                            type: 'tab',
                            tabId: tab.id,
                            title: tab.title,
                          });
                        }}
                        onDragEnd={() => {
                          setDraggedTabId(null);
                          startWorkspaceDrag(null);
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.stopPropagation();
                          if (draggedTabId && draggedTabId !== tab.id) {
                            setTabs((prev) => reorderTabsLocal(prev, draggedTabId, tab.id));
                          }
                          setDraggedTabId(null);
                          startWorkspaceDrag(null);
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
                  title={groupTabsByHost ? 'Switch to ungrouped flat tabs' : 'Group tabs by host'}
                  aria-label={groupTabsByHost ? 'Ungroup Tabs' : 'Group by Host'}
                  onClick={() => setGroupTabsByHost((prev) => !prev)}
                >
                  <span>{groupTabsByHost ? '⊟ Ungroup' : '⊞ Group by Host'}</span>
                </button>
              </div>
            </div>

            {activeTab.tabType !== 'notes' && activeTab.tabType !== 'settings' && activeTab.tabType !== 'sftp' && (
              <div className="terminal-toolbar hud-command-strip">
                <div className="hud-telemetry-readout" title={statusMessage}>
                  <span className="hud-telemetry-dot" />
                  <span className="hud-telemetry-label">HUD</span>
                  <strong className="hud-telemetry-msg">
                    {activePane.title}
                    {activeTabPanes.length > 1 ? ` · ${activeTabPanes.length} PANES` : ''}
                  </strong>
                </div>

                <div className="terminal-toolbar-actions hud-segmented-deck">
                  {/* GROUP 1: Split & Workspace View Builder */}
                  <div className="hud-btn-group">
                    <button
                      type="button"
                      className="hud-seg-btn"
                      aria-label="Split Horizontal"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleSplitPane('horizontal')}
                      title="Split active pane horizontally (side-by-side)"
                    >
                      <CyberIcon name="split-h" size={13} />
                      <span>Split H</span>
                    </button>
                    <button
                      type="button"
                      className="hud-seg-btn"
                      aria-label="Split Vertical"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleSplitPane('vertical')}
                      title="Split active pane vertically (stacked)"
                    >
                      <CyberIcon name="split-v" size={13} />
                      <span>Split V</span>
                    </button>

                    <div className="add-to-view-wrapper" style={{ position: 'relative', display: 'inline-flex' }}>
                      <button
                        type="button"
                        className={`hud-seg-btn ${showAddToViewMenu ? 'active' : ''}`}
                        aria-label="Add to View"
                        aria-expanded={showAddToViewMenu}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowAddToViewMenu((prev) => !prev)}
                        title="Open another host connection, local shell, Notes, TOTP, SFTP, or Snippets side-by-side in this view"
                      >
                        <CyberIcon name="grid" size={13} />
                        <span>+ View</span>
                        <CyberIcon name="chevron-down" size={11} />
                      </button>
                      {showAddToViewMenu && (
                        <div
                          className="add-to-view-popover cyber-glass-popover"
                          role="menu"
                          aria-label="Add to Workspace View Menu"
                        >
                          <div className="add-to-view-section-title">Dock Position</div>
                          <div className="add-to-view-zone-selector">
                            {(
                              [
                                { zone: 'right', label: '◨ Right' },
                                { zone: 'bottom', label: '⬓ Bottom' },
                                { zone: 'left', label: '◧ Left' },
                                { zone: 'top', label: '⬒ Top' },
                              ] as const
                            ).map((item) => (
                              <button
                                key={item.zone}
                                type="button"
                                className={`zone-pill-btn ${addToViewZone === item.zone ? 'active' : ''}`}
                                onClick={() => setAddToViewZone(item.zone)}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>

                          <div className="add-to-view-section-title">
                            Connect Host into Split ({addToViewZone})
                          </div>
                          {vaultSummary.hosts.length === 0 ? (
                            <div className="add-to-view-empty">No saved hosts in vault yet.</div>
                          ) : (
                            <div className="add-to-view-hosts-list">
                              {vaultSummary.hosts.map((h) => (
                                <button
                                  key={h.id}
                                  type="button"
                                  role="menuitem"
                                  className="add-to-view-item"
                                  onClick={() => void handleConnectHostIntoSplit(h, addToViewZone)}
                                >
                                  <span
                                    className="host-color-dot"
                                    style={{
                                      backgroundColor: getEffectiveHostColor(h.id, h.color, h.label),
                                    }}
                                  />
                                  <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>
                                    {h.label}
                                  </span>
                                  <small style={{ color: 'var(--text-muted)' }}>
                                    {h.effectiveUser}@{h.address}
                                  </small>
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="add-to-view-section-title">
                            Dock Tools &amp; Widgets (Click or Drag)
                          </div>
                          <div className="add-to-view-tools-grid">
                            <button
                              type="button"
                              role="menuitem"
                              className="add-to-view-tool-btn"
                              draggable
                              onDragStart={() =>
                                startWorkspaceDrag({
                                  type: 'tool',
                                  toolType: 'notes',
                                  hostId: activePane?.hostId || activeTab?.hostId,
                                  title: 'Host Notes',
                                })
                              }
                              onDragEnd={() => startWorkspaceDrag(null)}
                              onClick={() => void handleDockToolIntoSplit('notes', addToViewZone)}
                            >
                              <CyberIcon name="note" size={12} /> Notes Drawer
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="add-to-view-tool-btn"
                              draggable
                              onDragStart={() =>
                                startWorkspaceDrag({
                                  type: 'tool',
                                  toolType: 'totp',
                                  title: '2FA / TOTP',
                                })
                              }
                              onDragEnd={() => startWorkspaceDrag(null)}
                              onClick={() => void handleDockToolIntoSplit('totp', addToViewZone)}
                            >
                              <CyberIcon name="totp" size={12} /> 2FA / TOTP
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="add-to-view-tool-btn"
                              draggable
                              onDragStart={() =>
                                startWorkspaceDrag({
                                  type: 'tool',
                                  toolType: 'sftp',
                                  hostId: activePane?.hostId || activeTab?.hostId,
                                  title: 'SFTP Browser',
                                })
                              }
                              onDragEnd={() => startWorkspaceDrag(null)}
                              onClick={() => void handleDockToolIntoSplit('sftp', addToViewZone)}
                            >
                              <CyberIcon name="folder" size={12} /> SFTP Browser
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="add-to-view-tool-btn"
                              draggable
                              onDragStart={() =>
                                startWorkspaceDrag({
                                  type: 'tool',
                                  toolType: 'snippets',
                                  title: 'Command Snippets',
                                })
                              }
                              onDragEnd={() => startWorkspaceDrag(null)}
                              onClick={() => void handleDockToolIntoSplit('snippets', addToViewZone)}
                            >
                              <CyberIcon name="bolt" size={12} /> Snippets
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="add-to-view-tool-btn"
                              onClick={() =>
                                void handleDockToolIntoSplit('local-powershell', addToViewZone)
                              }
                            >
                              <CyberIcon name="terminal" size={12} /> Local PowerShell
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="add-to-view-tool-btn"
                              onClick={() =>
                                void handleDockToolIntoSplit('local-bash', addToViewZone)
                              }
                            >
                              <CyberIcon name="terminal" size={12} /> Local Bash / WSL
                            </button>
                          </div>

                          {activeTabPanes.length > 1 && (
                            <>
                              <div className="add-to-view-section-title">Workspace Layout</div>
                              <button
                                type="button"
                                role="menuitem"
                                className="add-to-view-item"
                                onClick={handleEqualizeAllSplits}
                              >
                                <CyberIcon name="grid" size={12} />
                                <span>Equalize All Split Proportions</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {activeTabPanes.length > 1 && (
                      <button
                        type="button"
                        className="hud-seg-btn"
                        aria-label="Next Pane"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleCyclePaneFocus}
                        title="Cycle keyboard focus to the next split pane (Alt+ArrowDown)"
                      >
                        <CyberIcon name="next-pane" size={13} />
                      </button>
                    )}
                  </div>

                  {/* GROUP 2: Directory & Root Shell Spawner */}
                  <div className="hud-btn-group">
                    <button
                      type="button"
                      className="hud-seg-btn"
                      aria-label="New Terminal Default Directory"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleOpenTerminalDirectory('default')}
                      title="Open new terminal in default working directory"
                    >
                      <CyberIcon name="home" size={12} />
                      <span>~ Dir</span>
                    </button>
                    <button
                      type="button"
                      className="hud-seg-btn"
                      aria-label="New Terminal Current Directory"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleOpenTerminalDirectory('current')}
                      title="Open new terminal in current working directory (CWD)"
                    >
                      <CyberIcon name="folder" size={12} />
                      <span>CWD</span>
                    </button>
                    <button
                      type="button"
                      className="hud-seg-btn"
                      aria-label="New Terminal Root in Current Directory"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleOpenTerminalDirectory('root')}
                      title="Open new root / elevated terminal in current working directory"
                    >
                      <CyberIcon name="bolt" size={12} />
                      <span>Root</span>
                    </button>
                  </div>

                  {/* GROUP 3: Security Ops, Injection & Broadcast */}
                  <div className="hud-btn-group">
                    <button
                      type="button"
                      className={`hud-seg-btn ${broadcastState.enabled ? 'is-danger-active' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleToggleBroadcast(broadcastState.enabled ? undefined : 'tab')}
                      title="Toggle Broadcast Input (Alt+B). Simultaneously sends typed keystrokes to multiple terminals."
                      aria-label="Toggle Broadcast Input"
                    >
                      <CyberIcon name="broadcast" size={12} />
                      <span>
                        {broadcastState.enabled
                          ? `CAST (${getBroadcastTargetSessionIds().length})`
                          : 'Broadcast'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="hud-seg-btn"
                      aria-label="Inject Password"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleInjectPassword()}
                      title="Injects the stored password directly from the Go Vault into the terminal without pressing Enter"
                    >
                      <CyberIcon name="key" size={12} />
                      <span>Pass</span>
                    </button>
                    <button
                      type="button"
                      className="hud-seg-btn"
                      aria-label="🔐 2FA / TOTP"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleInjectTotp()}
                      title="Injects the TOTP 2FA code directly from the Go Vault into the terminal prompt"
                    >
                      <CyberIcon name="totp" size={12} />
                      <span>2FA</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn-danger btn-sm hud-disconnect-btn"
                    onClick={() => void handleDisconnect()}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}

            <div className="workspace-tabs-content" aria-label="Terminal Split Grid">
              {tabs.map((tab) => {
                const isCurrentTab = tab.id === activeTab.id;
                const tabPanes = collectPanes(tab.rootNode);
                return (
                  <div
                    key={tab.id}
                    className="tab-content-panel"
                    style={{ display: isCurrentTab ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}
                    aria-hidden={!isCurrentTab}
                  >
                    {tab.tabType === 'sftp' ? (
                      <SftpBrowserView
                        sessionId={tab.sftpSessionId || (tab.rootNode.type === 'pane' ? tab.rootNode.sessionId.replace('sftp-', '') : '')}
                        hostLabel={tab.title.replace('SFTP: ', '')}
                        api={{
                          listLocalDir: (p) => getWailsBindings()?.ListLocalDir?.(p) ?? Promise.resolve([]),
                          listRemoteDir: (sid, p) => getWailsBindings()?.ListRemoteDir?.(sid, p) ?? Promise.resolve([]),
                          startSftpUpload: (sid, l, r) => getWailsBindings()?.StartSftpUpload?.(sid, l, r) ?? Promise.resolve(''),
                          startSftpDownload: (sid, r, l) => getWailsBindings()?.StartSftpDownload?.(sid, r, l) ?? Promise.resolve(''),
                          createRemoteDir: (sid, p) => getWailsBindings()?.CreateRemoteDir?.(sid, p) ?? Promise.resolve(),
                          deleteRemoteItem: (sid, p) => getWailsBindings()?.DeleteRemoteItem?.(sid, p) ?? Promise.resolve(),
                          cancelTransfer: (tid) => getWailsBindings()?.CancelTransfer?.(tid) ?? Promise.resolve(),
                          getActiveTransfers: () => getWailsBindings()?.GetActiveTransfers?.() ?? Promise.resolve([]),
                        }}
                        eventsOn={getWailsRuntime()?.EventsOn}
                        onClose={() => void handleCloseTab(tab.id)}
                      />
                    ) : tab.tabType === 'settings' ? (
                      <SettingsView
                        activeTab={settingsActiveTab}
                        onTabChange={setSettingsActiveTab}
                        globalSettings={globalSettings}
                        onUpdateSettings={handleUpdateSettings}
                        onResetSettings={handleResetSettings}
                        vaultLocked={vaultLocked}
                        passwordless={passwordless}
                        helloPending={helloPending}
                        quickUnlockReady={quickUnlockReady}
                        modalError={modalError}
                        onEnableQuickUnlock={handleEnableQuickUnlock}
                        onChangePassword={handleChangePasswordDirect}
                        onResetVault={handleResetVault}
                        availableSnippets={vaultSummary.snippets || []}
                        isModal={false}
                      />
                    ) : tab.tabType === 'notes' ? (
                      <NotesView
                        notes={notes}
                        hosts={vaultSummary.hosts.map((h) => ({
                          id: h.id,
                          label: h.label,
                          address: h.address,
                        }))}
                        activeHostId={tab.notesHostId}
                        initialNoteId={tab.notesInitialNoteId}
                        onSaveNote={handleSaveNote}
                        onDeleteNote={handleDeleteNote}
                        onClose={() => void handleCloseTab(tab.id)}
                      />
                    ) : (
                      renderWorkspaceNode(tab.rootNode, tab, tabPanes.length)
                    )}
                  </div>
                );
              })}
              {openNotesDrawerHostId && (
                <HostNotesDrawer
                  isOpen={Boolean(openNotesDrawerHostId)}
                  hostId={openNotesDrawerHostId}
                  notes={notes}
                  hosts={vaultSummary.hosts.map((h) => ({
                    id: h.id,
                    label: h.label,
                    address: h.address,
                  }))}
                  onSaveNote={handleSaveNote}
                  onDeleteNote={handleDeleteNote}
                  onClose={() => setOpenNotesDrawerHostId(null)}
                  onPinSplit={() => handlePinNotesSplit(openNotesDrawerHostId)}
                  onOpenFullNotes={() => {
                    const hostIdToOpen = openNotesDrawerHostId;
                    setOpenNotesDrawerHostId(null);
                    openNotesTab(hostIdToOpen || undefined);
                  }}
                  onHeaderDragStart={() =>
                    startWorkspaceDrag({
                      type: 'tool',
                      toolType: 'notes',
                      hostId: openNotesDrawerHostId,
                      title: 'Host Notes',
                    })
                  }
                  onHeaderDragEnd={() => startWorkspaceDrag(null)}
                />
              )}
            </div>
          </section>
        ) : (
          <section className="empty-state" aria-label="Terminal Workspace Quick Start">
            <div className="empty-state-card">
              <div className="empty-state-header">
                <img src={brandLogoText} alt="DoubleAgent" className="empty-state-brand-img" />
                <h2>DoubleAgent Terminal Workspace</h2>
                <p>{statusMessage}</p>
              </div>

              <div className="empty-state-grid">
                <div className="empty-state-section">
                  <h3>
                    <CyberIcon name="terminal" size={14} /> Local Shells
                  </h3>
                  <div className="empty-state-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void handleOpenLocalTerminal('powershell')}
                    >
                      <CyberIcon name="bolt" size={13} />
                      <span>PowerShell</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void handleOpenLocalTerminal('cmd')}
                    >
                      <CyberIcon name="terminal" size={13} />
                      <span>Command Prompt</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void handleOpenLocalTerminal('wsl')}
                    >
                      <CyberIcon name="terminal" size={13} />
                      <span>WSL Linux</span>
                    </button>
                  </div>
                </div>

                <div className="empty-state-section">
                  <h3>
                    <CyberIcon name="folder" size={14} /> Terminal Directory Spawning
                  </h3>
                  <div className="empty-state-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void handleOpenTerminalDirectory('default')}
                      title="Open local terminal in default working directory"
                    >
                      <CyberIcon name="home" size={13} />
                      <span>Default Directory</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void handleOpenTerminalDirectory('current')}
                      title="Open terminal in chosen folder"
                    >
                      <CyberIcon name="folder" size={13} />
                      <span>Choose Folder...</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void handleOpenTerminalDirectory('root')}
                      title="Open elevated root / admin shell"
                    >
                      <CyberIcon name="bolt" size={13} />
                      <span>Root / Admin</span>
                    </button>
                  </div>
                </div>

                <div className="empty-state-section">
                  <h3>
                    <CyberIcon name="serial" size={14} /> Remote &amp; Serial
                  </h3>
                  <div className="empty-state-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowCommandPalette(true)}
                    >
                      <CyberIcon name="search" size={13} />
                      <span>Quick Connect / Hosts (Ctrl+K)</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void handleOpenSerialModal()}
                    >
                      <CyberIcon name="serial" size={13} />
                      <span>Hardware Serial / COM</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowAddHostModal(true)}
                    >
                      <CyberIcon name="plus" size={13} />
                      <span>New SSH Host</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Sci-Fi HUD Bottom Telemetry Bar */}
      <footer className="cyber-hud-statusbar" aria-label="System Telemetry Footer">
        <div className="hud-status-left">
          <span className={`hud-status-pill ${vaultLocked ? 'locked' : 'unlocked'}`}>
            <CyberIcon name={vaultLocked ? 'lock' : 'unlock'} size={11} />
            <span>{vaultLocked ? 'VAULT LOCKED' : 'VAULT ARMED'}</span>
          </span>
          {activePane ? (
            <span className="hud-status-segment">
              <span className="hud-status-key">TARGET:</span>
              <strong className="hud-status-val">{activePane.title}</strong>
            </span>
          ) : (
            <span className="hud-status-segment">
              <span className="hud-status-key">MODE:</span>
              <span className="hud-status-val">STANDBY</span>
            </span>
          )}
          {activeTabPanes.length > 1 && (
            <span className="hud-status-segment">
              <span className="hud-status-key">GRID:</span>
              <span className="hud-status-val">{activeTabPanes.length} PANES</span>
            </span>
          )}
          {broadcastState.enabled && (
            <span className="hud-status-pill danger">
              <CyberIcon name="broadcast" size={11} />
              <span>BROADCAST ({getBroadcastTargetSessionIds().length})</span>
            </span>
          )}
          {activeLogSessions.size > 0 && (
            <span className="hud-status-pill rec">
              <CyberIcon name="record" size={10} />
              <span>REC ({activeLogSessions.size})</span>
            </span>
          )}
          {activeTunnels.length > 0 && (
            <span className="hud-status-pill ok">
              <CyberIcon name="tunnel" size={11} />
              <span>TUNNELS ({activeTunnels.length})</span>
            </span>
          )}
        </div>
        <div className="hud-status-right">
          <span className="hud-status-msg-inline">{statusMessage}</span>
          <span className="hud-status-shortcut">Ctrl+K Palette</span>
        </div>
      </footer>

      {showCommandPalette && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="Command Palette"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCommandPalette(false);
            }
          }}
        >
          <div className="modal-card palette-card">
            <h2>Command Palette &amp; Quick Connect</h2>
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

              {!vaultLocked &&
                paletteQuery.trim().length > 0 &&
                (() => {
                  const q = paletteQuery.trim().toLowerCase();
                  const matchedNotes = notes.filter(
                    (n) =>
                      n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
                  );
                  if (matchedNotes.length === 0) return null;
                  return (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        paddingTop: '0.5rem',
                        borderTop: '1px solid var(--border-color)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: 'var(--text-muted)',
                          marginBottom: '0.4rem',
                        }}
                      >
                        📝 Notes &amp; Documentation
                      </div>
                      {matchedNotes.map((n) => {
                        const hostObj = vaultSummary.hosts.find((h) => h.id === n.hostId);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            className="palette-item"
                            onClick={() => {
                              setShowCommandPalette(false);
                              setPaletteQuery('');
                              setNotesModalHostId(n.hostId || undefined);
                              setNotesModalInitialNoteId(n.id);
                              setShowNotesModal(true);
                            }}
                          >
                            <div className="palette-item-main">
                              <strong>
                                {n.isFolder ? '📁 ' : '📄 '}
                                {n.title}
                              </strong>
                              <span>
                                {hostObj
                                  ? `Host: ${hostObj.label} (${hostObj.address})`
                                  : 'Global Note'}
                              </span>
                            </div>
                            <div className="palette-tags">
                              <span className="kbd-badge">Open Note ↵</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="New Host Group"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddGroupModal(false);
            }
          }}
        >
          <form className="modal-card" onSubmit={(e) => void handleSaveGroup(e)}>
            <h2>New Host Group</h2>
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
            <input
              aria-label="Default Group Initial Directory"
              placeholder="Default Initial Directory (e.g. /var/www, optional)"
              value={grpInitialDir}
              onChange={(e) => setGrpInitialDir(e.target.value)}
            />
            <select
              aria-label="Default Group Proxy Profile"
              value={grpProxyProfileId}
              onChange={(e) => setGrpProxyProfileId(e.target.value)}
            >
              <option value="">No Default Proxy (Direct Connection)</option>
              {(vaultSummary.proxyProfiles || []).map((p) => (
                <option key={p.id} value={p.id}>
                  Proxy: {p.name} ({p.type})
                </option>
              ))}
            </select>
            <label className="checkbox-label" style={{ marginTop: '0.25rem' }}>
              <input
                type="checkbox"
                aria-label="Default Group Session Logging"
                checked={grpSessionLogging}
                onChange={(e) => setGrpSessionLogging(e.target.checked)}
              />
              Enable Session Logging by default
            </label>
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="New Host"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddHostModal(false);
            }
          }}
        >
          <form className="modal-card" onSubmit={(e) => void handleSaveHost(e)}>
            <h2>New SSH Host</h2>
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
              <option value="key">SSH Key from Keychain</option>
              <option value="agent">Windows OpenSSH Agent / Pageant</option>
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
            <input
              aria-label="Host Initial Directory"
              placeholder="Initial Directory (e.g. /var/www or C:\Projects, optional)"
              value={hostInitialDir}
              onChange={(e) => setHostInitialDir(e.target.value)}
            />
            <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-bright)', marginBottom: '6px', display: 'block' }}>
                Proxy &amp; Bastion Settings
              </label>
              <select
                aria-label="Host Proxy Profile"
                value={hostProxyProfileId}
                onChange={(e) => setHostProxyProfileId(e.target.value)}
                style={{ width: '100%', marginBottom: '8px' }}
              >
                <option value="">Direct Connection (or Inherit Group Proxy)</option>
                {(vaultSummary.proxyProfiles || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    Use Proxy Profile: {p.name} ({p.type})
                  </option>
                ))}
              </select>
              {!hostProxyProfileId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    aria-label="Host Custom ProxyJump"
                    placeholder="Custom ProxyJump (e.g. bastion.corp.net:2222)"
                    value={hostProxyJump}
                    onChange={(e) => setHostProxyJump(e.target.value)}
                  />
                  <input
                    aria-label="Host Custom ProxyCommand"
                    placeholder="Custom ProxyCommand (e.g. ssh -W %h:%p bastion)"
                    value={hostProxyCommand}
                    onChange={(e) => setHostProxyCommand(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div>
              <label
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.2rem',
                  display: 'block',
                }}
              >
                Host Color Tag
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
            <label className="checkbox-label" style={{ marginTop: '0.35rem' }}>
              <input
                type="checkbox"
                aria-label="Enable Host Session Logging"
                checked={hostSessionLogging}
                onChange={(e) => setHostSessionLogging(e.target.checked)}
              />
              Enable Session Logging for this Host
            </label>
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="SSH Keychain"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowKeychainModal(false);
            }
          }}
        >
          <div className="modal-card palette-card">
            <h2>SSH Keychain</h2>
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="Import SSH Config"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSSHConfigModal(false);
            }
          }}
        >
          <form className="modal-card palette-card" onSubmit={(e) => void handleImportSSHConfig(e)}>
            <h2>Import OpenSSH Config</h2>
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="Initialize Vault"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowVaultModal(false);
            }
          }}
        >
          <div className="modal-card">
            <div className="modal-brand-hero">
              <img src={brandLogoText} alt="DoubleAgent" className="modal-vault-brand-img" />
            </div>
            <h2>Initialize Encrypted Vault</h2>
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="Unlock Vault"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowVaultModal(false);
              setMasterPassword('');
            }
          }}
        >
          <form className="modal-card" onSubmit={(e) => void handleVaultUnlock(e)}>
            <div className="modal-brand-hero">
              <img src={appLogo} alt="DoubleAgent" className="modal-vault-icon-img" />
            </div>
            <h2>Unlock Encrypted Vault</h2>
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="Vault Security Settings"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSettingsModal(false);
            }
          }}
        >
          <form className="modal-card" onSubmit={(e) => void handleChangePassword(e)}>
            <h2>Vault Security &amp; Windows Hello</h2>
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
          <SettingsView
            activeTab={settingsActiveTab}
            onTabChange={setSettingsActiveTab}
            globalSettings={globalSettings}
            onUpdateSettings={handleUpdateSettings}
            onResetSettings={handleResetSettings}
            vaultLocked={vaultLocked}
            passwordless={passwordless}
            helloPending={helloPending}
            quickUnlockReady={quickUnlockReady}
            modalError={modalError}
            onEnableQuickUnlock={handleEnableQuickUnlock}
            onChangePassword={handleChangePasswordDirect}
            onResetVault={handleResetVault}
            availableSnippets={vaultSummary.snippets || []}
            onOpenAsTab={() => {
              setShowGlobalSettingsModal(false);
              openSettingsTab(settingsActiveTab);
            }}
            onClose={() => setShowGlobalSettingsModal(false)}
            isModal={true}
          />
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
            <h2>Serial / UART Console Connection</h2>
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
      {showPortForwardingModal && (
        <PortForwardingView
          rules={forwardRules}
          activeTunnels={activeTunnels}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: `${h.effectiveUser}@${h.address}:${h.effectivePort}`,
          }))}
          activeSessions={(() => {
            const sessions: { sessionId: string; hostId?: string; title: string }[] = [];
            for (const t of tabs) {
              const panes = collectPanes(t.rootNode);
              for (const p of panes) {
                if (
                  p.sessionId &&
                  !p.sessionId.startsWith('local-') &&
                  !p.sessionId.startsWith('serial-') &&
                  !p.sessionId.startsWith('sftp-')
                ) {
                  if (!sessions.some((s) => s.sessionId === p.sessionId)) {
                    sessions.push({
                      sessionId: p.sessionId,
                      hostId: p.hostId || t.hostId,
                      title: p.title || t.title,
                    });
                  }
                }
              }
            }
            return sessions;
          })()}
          onSaveRule={handleSaveForwardRule}
          onDeleteRule={handleDeleteForwardRule}
          onStartTunnel={handleStartForwardTunnel}
          onStartTunnelWithHost={handleStartTunnelWithHost}
          onStopTunnel={handleStopForwardTunnel}
          onOpenProxychainsExport={handleOpenProxychainsExport}
          onClose={() => setShowPortForwardingModal(false)}
        />
      )}

      {showProxyProfilesModal && (
        <ProxyProfilesView
          profiles={vaultSummary.proxyProfiles || []}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
            port: h.effectivePort,
          }))}
          onSaveProfile={handleSaveProxyProfile}
          onDeleteProfile={handleDeleteProxyProfile}
          onOpenProxychainsExport={handleOpenProxychainsExport}
          onClose={() => setShowProxyProfilesModal(false)}
        />
      )}

      {showProxychainsExportModal && (
        <ProxychainsExportModal
          initialOptions={proxychainsOptions}
          onGenerateConfig={handleGenerateProxychainsConfig}
          onSaveToFile={handleSaveProxychainsFile}
          onClose={() => setShowProxychainsExportModal(false)}
        />
      )}

      {showSnippetsModal && (
        <SnippetsManagerModal
          snippets={vaultSummary.snippets || []}
          onSaveSnippet={handleSaveSnippet}
          onDeleteSnippet={handleDeleteSnippet}
          onRunSnippet={(snip) => void handleTriggerSnippet(snip, snippetActiveSessionId)}
          initialPrefillBody={snippetPrefillBody}
          onDockToView={() => void handleDockToolIntoSplit('snippets', 'right')}
          onClose={() => {
            setShowSnippetsModal(false);
            setSnippetPrefillBody('');
          }}
        />
      )}

      {runModalSnippet && runModalContext && (
        <SnippetRunModal
          snippet={runModalSnippet}
          context={runModalContext}
          onExecute={handleExecuteSnippetFromModal}
          onClose={() => {
            setRunModalSnippet(null);
            setRunModalContext(null);
          }}
        />
      )}

      {showTotpModal && (
        <TotpManagerModal
          isOpen={showTotpModal}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: `${h.effectiveUser}@${h.address}:${h.effectivePort}`,
          }))}
          activeSessionId={sessionId}
          onInjectCode={handleInjectTotp}
          onRefreshVault={refreshVaultState}
          onDockToView={() => void handleDockToolIntoSplit('totp', 'right')}
          onClose={() => setShowTotpModal(false)}
        />
      )}

      {showNotesModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-label="Host Notes & Documentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowNotesModal(false);
            }
          }}
        >
          <div className="modal-card notes-modal-card">
            <NotesView
              notes={notes}
              hosts={vaultSummary.hosts.map((h) => ({
                id: h.id,
                label: h.label,
                address: h.address,
              }))}
              activeHostId={notesModalHostId}
              initialNoteId={notesModalInitialNoteId}
              onSaveNote={handleSaveNote}
              onDeleteNote={handleDeleteNote}
              onOpenAsTab={() => {
                const hid = notesModalHostId;
                const nid = notesModalInitialNoteId;
                setShowNotesModal(false);
                openNotesTab(hid, nid);
              }}
              onClose={() => setShowNotesModal(false)}
            />
          </div>
        </div>
      )}

      {showSessionLogsModal && (
        <SessionLogsModal
          logs={sessionLogs}
          onRefreshLogs={refreshSessionLogs}
          onReadLog={handleReadSessionLog}
          onDeleteLog={handleDeleteSessionLog}
          onExportLog={handleExportSessionLog}
          onStopActiveLog={async (sid) => {
            await handleToggleSessionLog(sid);
          }}
          onClose={() => setShowSessionLogsModal(false)}
        />
      )}

      {hostKeyPrompt && (
        <div
          className="modal-backdrop host-key-modal-backdrop"
          style={{ zIndex: 100050 }}
          role="dialog"
          aria-label="Verify SSH Host Key"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              void handleHostKeyDecision(false);
            }
          }}
        >
          <div
            className="modal-card host-key-card"
            style={{
              zIndex: 100051,
              border: '2px solid var(--accent-bright)',
              boxShadow: '0 0 32px rgba(45, 212, 191, 0.5)',
            }}
          >
            <h2>Verify Unknown Host Key</h2>
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
