import React, { useMemo, useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Node,
  Edge,
  Position,
  Handle,
  MarkerType,
  useNodesState,
  useEdgesState,
  NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { CyberIcon } from './CyberIcon';
import { ForwardTunnelStatus, ForwardRule } from '../types/forward';
import { NotePage } from '../types/note';
import {
  TopologyNodeData,
  TopologyFilterMode,
  TopologyLayoutMode,
  TopologyStats,
  TopologyHostItem,
  TopologyGroupItem,
} from '../types/networkMap';
import type { ProxyProfileSummary } from '../types/proxy';

function isTunnelMatchingHost(
  tun: ForwardTunnelStatus,
  hostId: string,
  hostAddress: string,
  forwardRules?: ForwardRule[]
): boolean {
  if (tun.hostId && tun.hostId === hostId) return true;
  if (tun.ruleId && forwardRules) {
    const matchedRule = forwardRules.find((r) => r.id === tun.ruleId);
    if (matchedRule && matchedRule.hostId === hostId) return true;
  }
  if (tun.targetHost && tun.targetHost === hostAddress) return true;
  return false;
}

// ---------------------------------------------------------
// Helper: Format Bytes and Route Descriptions
// ---------------------------------------------------------
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatTunnelRoute(tun: ForwardTunnelStatus, hostLabel: string): string {
  if (tun.type === 'L') {
    return `Client:${tun.bindPort} ──▶ ${hostLabel}:${tun.targetPort || 'dyn'} (-L Local)`;
  }
  if (tun.type === 'R') {
    return `${hostLabel}:${tun.bindPort} ──▶ Client:${tun.targetPort || 'dyn'} (-R Remote)`;
  }
  return `Client:${tun.bindPort} ──▶ ${hostLabel} (-D SOCKS5)`;
}

export function formatRuleRoute(rule: ForwardRule, hostLabel: string): string {
  if (rule.type === 'L') {
    return `Client:${rule.bindPort} ⇢ ${hostLabel}:${rule.targetPort || 'dyn'} (-L)`;
  }
  if (rule.type === 'R') {
    return `${hostLabel}:${rule.bindPort} ⇢ Client:${rule.targetPort || 'dyn'} (-R)`;
  }
  return `Client:${rule.bindPort} ⇢ ${hostLabel} (-D SOCKS5)`;
}

// ---------------------------------------------------------
// Custom React Flow Node: Host Node Card
// ---------------------------------------------------------
export const HostNodeComponent: React.FC<NodeProps<TopologyNodeData>> = ({
  data,
  selected,
}) => {
  const isSessionActive = data.status === 'active';
  const isTunnelActive = data.status === 'tunnel';
  const hostId = data.hostId;

  return (
    <div
      className={`topology-host-card ${selected ? 'selected' : ''} ${isSessionActive ? 'is-session-active' : ''} ${isTunnelActive ? 'is-tunnel-active' : ''}`}
      style={{
        borderColor: data.color || data.groupColor || undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="topo-handle topo-handle-target"
      />

      <div className="topo-node-header">
        <div className="topo-node-title-group">
          <span
            className="topo-color-strip"
            style={{ backgroundColor: data.color || data.groupColor || '#2dd4bf' }}
          />
          <strong className="topo-node-label" title={data.label}>
            {data.label}
          </strong>
        </div>
        <div className="topo-node-status-badge">
          {isSessionActive ? (
            <span className="topo-status-pill active-pill" title="Live Terminal Session Connected">
              <span className="topo-pulse-dot" /> ACTIVE
            </span>
          ) : isTunnelActive ? (
            <span className="topo-status-pill tunnel-pill" title="Active Port Forwarding Tunnel">
              TUNNEL
            </span>
          ) : (
            <span className="topo-status-pill standby-pill">STANDBY</span>
          )}
        </div>
      </div>

      <div className="topo-node-body">
        <div className="topo-address-line" title={`${data.username || 'root'}@${data.address}:${data.port || 22}`}>
          <code>
            {data.username ? `${data.username}@` : ''}
            {data.address || '0.0.0.0'}:{data.port || 22}
          </code>
        </div>

        <div className="topo-meta-row">
          {data.groupName && (
            <span
              className="topo-group-pill"
              style={{
                borderColor: data.groupColor || 'rgba(45, 212, 191, 0.4)',
                color: data.groupColor || '#2dd4bf',
              }}
            >
              {data.groupName}
            </span>
          )}
          {data.jumpHops && data.jumpHops.length > 0 && (
            <span className="topo-jump-pill" title={`Via ${data.jumpHops.length} Jump Hop(s)`}>
              ⛓ {data.jumpHops.length} Hops
            </span>
          )}
          {data.activeTunnelsCount && data.activeTunnelsCount > 0 ? (
            <span className="topo-tunnel-pill" title={`${data.activeTunnelsCount} Active Tunnel(s)`}>
              ⇄ {data.activeTunnelsCount} Tunnels
            </span>
          ) : null}
        </div>

        {data.tags && data.tags.length > 0 && (
          <div className="topo-tags-row">
            {data.tags.map((tag) => (
              <span key={tag} className="topo-tag-chip">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Cyberpunk HUD Tunnel Strip directly on Host Card */}
        {data.hostTunnels && data.hostTunnels.length > 0 && (
          <div className="topo-node-tunnels-box active">
            <div className="topo-tunnels-box-header">
              <span className="topo-corner-bracket">///</span>
              <span className="topo-tunnels-box-title">ACTIVE TUNNELS ({data.hostTunnels.length})</span>
            </div>
            {data.hostTunnels.slice(0, 3).map((tun) => (
              <div key={tun.id} className="topo-tunnel-route-chip active">
                <span className="chip-mode">-{tun.type}</span>
                <div className="chip-endpoints">
                  <span className="ep-local">Client:{tun.bindPort}</span>
                  <span className="ep-arrow">▶</span>
                  <span className="ep-remote">{data.label}:{tun.targetPort || 'dyn'}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data.hostRules && data.hostRules.length > 0 && (!data.hostTunnels || data.hostTunnels.length === 0) && (
          <div className="topo-node-tunnels-box standby">
            <div className="topo-tunnels-box-header">
              <span className="topo-corner-bracket">///</span>
              <span className="topo-tunnels-box-title">CONFIGURED ({data.hostRules.length})</span>
            </div>
            {data.hostRules.slice(0, 2).map((rule) => (
              <div key={rule.id} className="topo-tunnel-route-chip standby">
                <span className="chip-mode standby">-{rule.type}</span>
                <div className="chip-endpoints">
                  <span className="ep-local">{rule.type === 'R' ? data.label : 'Client'}:{rule.bindPort}</span>
                  <span className="ep-arrow">⇢</span>
                  <span className="ep-remote">{rule.type === 'R' ? 'Client' : data.label}:{rule.targetPort || 'dyn'}</span>
                </div>
                {hostId && data.onStartTunnel && (
                  <button
                    type="button"
                    className="topo-tunnel-start-btn"
                    title="Start tunnel (connects automatically if offline)"
                    onClick={(e) => {
                      e.stopPropagation();
                      data.onStartTunnel?.(hostId, rule.id);
                    }}
                  >
                    ▶ START
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="topo-node-actions">
        {hostId && (
          <>
            <button
              type="button"
              className="topo-btn topo-btn-primary"
              title="Connect SSH terminal"
              onClick={(e) => {
                e.stopPropagation();
                data.onConnect?.(hostId);
              }}
            >
              <CyberIcon name="bolt" size={11} /> Connect
            </button>
            <button
              type="button"
              className="topo-btn topo-btn-secondary"
              title="Split Connect alongside current pane"
              onClick={(e) => {
                e.stopPropagation();
                data.onSplitConnect?.(hostId);
              }}
            >
              <CyberIcon name="split-h" size={11} />
            </button>
            <button
              type="button"
              className="topo-btn topo-btn-secondary"
              title="Open SFTP File Browser"
              onClick={(e) => {
                e.stopPropagation();
                data.onOpenSftp?.(hostId, data.label);
              }}
            >
              <CyberIcon name="folder" size={11} />
            </button>
            <button
              type="button"
              className="topo-btn topo-btn-secondary"
              title="Open Host Documentation Notes"
              onClick={(e) => {
                e.stopPropagation();
                data.onOpenNotes?.(hostId);
              }}
            >
              <CyberIcon name="note" size={11} />
            </button>
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="topo-handle topo-handle-source"
      />
    </div>
  );
};

// ---------------------------------------------------------
// Custom React Flow Node: Client Node (Local Machine)
// ---------------------------------------------------------
export const ClientNodeComponent: React.FC<NodeProps<TopologyNodeData>> = ({
  data,
  selected,
}) => {
  return (
    <div className={`topology-client-card ${selected ? 'selected' : ''}`}>
      <div className="client-node-header">
        <span className="client-node-icon">
          <CyberIcon name="terminal" size={16} />
        </span>
        <div className="client-node-info">
          <strong className="client-node-title">{data.label}</strong>
          <span className="client-node-address">{data.address || '127.0.0.1 (Local)'}</span>
        </div>
      </div>
      <div className="client-node-tag">LOCAL WORKSTATION</div>
      <Handle
        type="source"
        position={Position.Right}
        className="topo-handle topo-handle-source"
      />
    </div>
  );
};

// ---------------------------------------------------------
// Helper: Extract Subnet CIDR from IP
// ---------------------------------------------------------
function extractSubnetCidr(address?: string): string {
  if (!address) return 'Default Network';
  const ipv4Match = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    return `${ipv4Match[1]}.${ipv4Match[2]}.${ipv4Match[3]}.0/24`;
  }
  return 'Cloud & Hostname Subnet';
}

// Node types registry for ReactFlow
const nodeTypes = {
  hostNode: HostNodeComponent,
  clientNode: ClientNodeComponent,
};

// ---------------------------------------------------------
// Main NetworkMapView Component
// ---------------------------------------------------------
export interface NetworkMapViewProps {
  hosts: TopologyHostItem[];
  groups: TopologyGroupItem[];
  notes?: NotePage[];
  proxyProfiles?: ProxyProfileSummary[];
  activeSessionHostIds?: string[];
  activeTunnels?: ForwardTunnelStatus[];
  forwardRules?: ForwardRule[];
  onConnectHost?: (hostId: string) => void;
  onSplitConnectHost?: (hostId: string) => void;
  onOpenSftp?: (hostId: string, hostLabel: string) => void;
  onOpenNotes?: (hostId: string) => void;
  onStartTunnel?: (hostId: string, ruleId: string) => void;
  onStopTunnel?: (tunnelId: string) => void;
  onOpenForwardingManager?: (preselectedHostId?: string) => void;
  onClose?: () => void;
  isDocked?: boolean;
}

// Module-level stable fallback arrays to prevent React dependency invalidation loops
const EMPTY_NOTES: NotePage[] = [];
const EMPTY_PROXY_PROFILES: ProxyProfileSummary[] = [];
const EMPTY_STRINGS: string[] = [];
const EMPTY_TUNNELS: ForwardTunnelStatus[] = [];
const EMPTY_RULES: ForwardRule[] = [];

export function getEffectiveJumpHopsForHost(
  h: TopologyHostItem,
  proxyProfiles?: ProxyProfileSummary[]
): string[] {
  if (h.jumpChain && h.jumpChain.length > 0) {
    return h.jumpChain;
  }
  if (h.proxyProfileId && proxyProfiles) {
    const profile = proxyProfiles.find((p) => p.id === h.proxyProfileId);
    if (profile) {
      if (profile.type === 'jump' && profile.jumpHostIds && profile.jumpHostIds.length > 0) {
        return profile.jumpHostIds;
      }
      if (profile.type === 'socks5' && profile.socksAddress) {
        return [`SOCKS5: ${profile.socksAddress}`];
      }
      if (profile.type === 'command' && profile.command) {
        return [`ProxyCmd: ${profile.command}`];
      }
    }
  }
  return EMPTY_STRINGS;
}

export const NetworkMapView: React.FC<NetworkMapViewProps> = ({
  hosts,
  groups,
  notes = EMPTY_NOTES,
  proxyProfiles = EMPTY_PROXY_PROFILES,
  activeSessionHostIds = EMPTY_STRINGS,
  activeTunnels = EMPTY_TUNNELS,
  forwardRules = EMPTY_RULES,
  onConnectHost,
  onSplitConnectHost,
  onOpenSftp,
  onOpenNotes,
  onStartTunnel,
  onStopTunnel,
  onOpenForwardingManager,
  onClose,
  isDocked = false,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<TopologyFilterMode>('all');
  const [layoutMode, setLayoutMode] = useState<TopologyLayoutMode>('hierarchical');
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);

  // Filter hosts based on search and mode
  const filteredHosts = useMemo(() => {
    return hosts.filter((h) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        h.label.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        (h.effectiveUser || '').toLowerCase().includes(q) ||
        (h.tags || []).some((t: string) => t.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      const isSessionActive = activeSessionHostIds.includes(h.id);
      const isTunnelActive = activeTunnels.some((t) =>
        isTunnelMatchingHost(t, h.id, h.address, forwardRules)
      );
      const effectiveHops = getEffectiveJumpHopsForHost(h, proxyProfiles);
      const hasJumpChain = effectiveHops.length > 0;

      if (filterMode === 'active') return isSessionActive;
      if (filterMode === 'tunnels') return isTunnelActive;
      if (filterMode === 'jumps') {
        if (hasJumpChain) return true;
        // Also include any bastion host that is used as a jump hop by another host
        return hosts.some((other) => {
          const otherHops = getEffectiveJumpHopsForHost(other, proxyProfiles);
          return otherHops.includes(h.id) || otherHops.includes(h.address) || otherHops.includes(h.label);
        });
      }
      return true;
    });
  }, [hosts, searchQuery, filterMode, activeSessionHostIds, activeTunnels, forwardRules, proxyProfiles]);

  // Compute telemetry statistics
  const stats: TopologyStats = useMemo(() => {
    const subnets = new Set<string>();
    let jumpCount = 0;
    for (const h of hosts) {
      subnets.add(extractSubnetCidr(h.address));
      if (getEffectiveJumpHopsForHost(h, proxyProfiles).length > 0) {
        jumpCount += 1;
      }
    }
    return {
      totalHosts: hosts.length,
      totalSubnets: subnets.size,
      activeSessions: activeSessionHostIds.length,
      activeTunnels: activeTunnels.length,
      jumpChains: jumpCount,
    };
  }, [hosts, activeSessionHostIds, activeTunnels, proxyProfiles]);

  // Generate React Flow Nodes and Edges based on selected layout
  const { generatedNodes, generatedEdges } = useMemo(() => {
    const nodes: Node<TopologyNodeData>[] = [];
    const edges: Edge[] = [];

    // 1. Root Client Node (DoubleAgent Workstation)
    const clientNodeY = Math.max(220, (filteredHosts.length * 150) / 2);
    nodes.push({
      id: 'client-node',
      type: 'clientNode',
      position: { x: 50, y: clientNodeY },
      data: {
        id: 'client-node',
        label: 'DoubleAgent Client',
        nodeType: 'client',
        address: '127.0.0.1 (Localhost)',
        status: 'active',
      },
    });

    // 2. Identify Jump / Bastion hosts vs End-hosts
    const bastionIds = new Set<string>();
    for (const h of filteredHosts) {
      const hops = getEffectiveJumpHopsForHost(h, proxyProfiles);
      for (const hop of hops) {
        bastionIds.add(hop);
      }
    }

    // 3. Subnet / Group Clusters mapping
    const subnetClusters = new Map<string, TopologyHostItem[]>();
    for (const h of filteredHosts) {
      const group = groups.find((g) => g.id === h.groupId);
      const clusterKey =
        layoutMode === 'subnets'
          ? extractSubnetCidr(h.address)
          : group?.name || 'Default Group';
      const list = subnetClusters.get(clusterKey) || [];
      list.push(h);
      subnetClusters.set(clusterKey, list);
    }

    // 4. Position Nodes according to Layout Mode
    if (layoutMode === 'hierarchical') {
      // Tier 1: Bastion / Jump hosts
      const bastions = filteredHosts.filter((h) => bastionIds.has(h.id) || bastionIds.has(h.address) || bastionIds.has(h.label));
      const targets = filteredHosts.filter((h) => !bastionIds.has(h.id) && !bastionIds.has(h.address) && !bastionIds.has(h.label));

      let bastionY = 80;
      for (const h of bastions) {
        const group = groups.find((g) => g.id === h.groupId);
        const isSessionActive = activeSessionHostIds.includes(h.id);
        const matchingHostTunnels = activeTunnels.filter((t) =>
          isTunnelMatchingHost(t, h.id, h.address, forwardRules)
        );
        const matchingHostRules = (forwardRules || []).filter((r) => r.hostId === h.id);
        const isTunnelActive = matchingHostTunnels.length > 0;

        nodes.push({
          id: h.id,
          type: 'hostNode',
          position: { x: 420, y: bastionY },
          data: {
            id: h.id,
            hostId: h.id,
            label: h.label,
            nodeType: 'host',
            address: h.address,
            port: h.effectivePort || 22,
            username: h.effectiveUser || 'root',
            groupName: group?.name,
            groupColor: group?.color,
            color: h.color,
            tags: h.tags,
            status: isSessionActive ? 'active' : isTunnelActive ? 'tunnel' : 'configured',
            activeSessionsCount: isSessionActive ? 1 : 0,
            activeTunnelsCount: matchingHostTunnels.length,
            hostTunnels: matchingHostTunnels,
            hostRules: matchingHostRules,
            jumpHops: getEffectiveJumpHopsForHost(h, proxyProfiles),
            notesCount: notes.filter((n) => n.hostId === h.id).length,
            onConnect: onConnectHost,
            onSplitConnect: onSplitConnectHost,
            onOpenSftp,
            onOpenNotes,
            onStartTunnel,
            onStopTunnel,
          },
        });
        bastionY += 190;
      }

      // Check for any external hops in bastionIds not matched by any saved host
      for (const hop of Array.from(bastionIds)) {
        const isSavedHost = hosts.some((c) => c.id === hop || c.address === hop || c.label === hop);
        if (!isSavedHost) {
          nodes.push({
            id: `proxy-node-${hop}`,
            type: 'hostNode',
            position: { x: 420, y: bastionY },
            data: {
              id: `proxy-node-${hop}`,
              hostId: `proxy-node-${hop}`,
              label: hop.startsWith('SOCKS5:') ? hop : `⛓ Bastion: ${hop}`,
              nodeType: 'host',
              address: hop,
              port: 22,
              username: 'proxy',
              status: 'configured',
              tags: ['proxy-jump'],
              color: '#f59e0b',
            },
          });
          bastionY += 190;
        }
      }

      // Tier 2: Target / End Hosts
      let targetY = 60;
      for (const h of targets) {
        const group = groups.find((g) => g.id === h.groupId);
        const isSessionActive = activeSessionHostIds.includes(h.id);
        const matchingHostTunnels = activeTunnels.filter((t) =>
          isTunnelMatchingHost(t, h.id, h.address, forwardRules)
        );
        const matchingHostRules = (forwardRules || []).filter((r) => r.hostId === h.id);
        const isTunnelActive = matchingHostTunnels.length > 0;

        nodes.push({
          id: h.id,
          type: 'hostNode',
          position: { x: 820, y: targetY },
          data: {
            id: h.id,
            hostId: h.id,
            label: h.label,
            nodeType: 'host',
            address: h.address,
            port: h.effectivePort || 22,
            username: h.effectiveUser || 'root',
            groupName: group?.name,
            groupColor: group?.color,
            color: h.color,
            tags: h.tags,
            status: isSessionActive ? 'active' : isTunnelActive ? 'tunnel' : 'configured',
            activeSessionsCount: isSessionActive ? 1 : 0,
            activeTunnelsCount: matchingHostTunnels.length,
            hostTunnels: matchingHostTunnels,
            hostRules: matchingHostRules,
            jumpHops: getEffectiveJumpHopsForHost(h, proxyProfiles),
            notesCount: notes.filter((n) => n.hostId === h.id).length,
            onConnect: onConnectHost,
            onSplitConnect: onSplitConnectHost,
            onOpenSftp,
            onOpenNotes,
            onStartTunnel,
            onStopTunnel,
          },
        });
        targetY += 190;
      }
    } else if (layoutMode === 'subnets') {
      // Subnet Cluster layout: columns per subnet
      let clusterX = 400;
      for (const [, clusterHosts] of subnetClusters.entries()) {
        let nodeY = 80;
        for (const h of clusterHosts) {
          const group = groups.find((g) => g.id === h.groupId);
          const isSessionActive = activeSessionHostIds.includes(h.id);
          const matchingHostTunnels = activeTunnels.filter((t) =>
            isTunnelMatchingHost(t, h.id, h.address, forwardRules)
          );
          const matchingHostRules = (forwardRules || []).filter((r) => r.hostId === h.id);
          const isTunnelActive = matchingHostTunnels.length > 0;

          nodes.push({
            id: h.id,
            type: 'hostNode',
            position: { x: clusterX, y: nodeY },
            data: {
              id: h.id,
              hostId: h.id,
              label: h.label,
              nodeType: 'host',
              address: h.address,
              port: h.effectivePort || 22,
              username: h.effectiveUser || 'root',
              groupName: group?.name,
              groupColor: group?.color,
              color: h.color,
              tags: h.tags,
              status: isSessionActive ? 'active' : isTunnelActive ? 'tunnel' : 'configured',
              activeSessionsCount: isSessionActive ? 1 : 0,
              activeTunnelsCount: matchingHostTunnels.length,
              hostTunnels: matchingHostTunnels,
              hostRules: matchingHostRules,
              jumpHops: getEffectiveJumpHopsForHost(h, proxyProfiles),
              notesCount: notes.filter((n) => n.hostId === h.id).length,
              onConnect: onConnectHost,
              onSplitConnect: onSplitConnectHost,
              onOpenSftp,
              onOpenNotes,
              onStartTunnel,
              onStopTunnel,
            },
          });
          nodeY += 190;
        }
        clusterX += 380;
      }
    } else {
      // Compact Grid layout
      const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(filteredHosts.length))));
      filteredHosts.forEach((h, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const group = groups.find((g) => g.id === h.groupId);
        const isSessionActive = activeSessionHostIds.includes(h.id);
        const matchingHostTunnels = activeTunnels.filter((t) =>
          isTunnelMatchingHost(t, h.id, h.address, forwardRules)
        );
        const matchingHostRules = (forwardRules || []).filter((r) => r.hostId === h.id);
        const isTunnelActive = matchingHostTunnels.length > 0;

        nodes.push({
          id: h.id,
          type: 'hostNode',
          position: { x: 380 + col * 360, y: 80 + row * 190 },
          data: {
            id: h.id,
            hostId: h.id,
            label: h.label,
            nodeType: 'host',
            address: h.address,
            port: h.effectivePort || 22,
            username: h.effectiveUser || 'root',
            groupName: group?.name,
            groupColor: group?.color,
            color: h.color,
            tags: h.tags,
            status: isSessionActive ? 'active' : isTunnelActive ? 'tunnel' : 'configured',
            activeSessionsCount: isSessionActive ? 1 : 0,
            activeTunnelsCount: matchingHostTunnels.length,
            hostTunnels: matchingHostTunnels,
            hostRules: matchingHostRules,
            jumpHops: getEffectiveJumpHopsForHost(h, proxyProfiles),
            notesCount: notes.filter((n) => n.hostId === h.id).length,
            onConnect: onConnectHost,
            onSplitConnect: onSplitConnectHost,
            onOpenSftp,
            onOpenNotes,
            onStartTunnel,
            onStopTunnel,
          },
        });
      });
    }

    // 5. Connect Edges (Direct SSH, Jump Chains, and Active Tunnels)
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const h of filteredHosts) {
      if (!nodeIds.has(h.id)) continue;
      const hops = getEffectiveJumpHopsForHost(h, proxyProfiles);
      if (hops && hops.length > 0) {
        // Multi-hop Jump Chain edges
        let prevNodeId = 'client-node';
        hops.forEach((hop: string, hopIdx: number) => {
          const hopHost = hosts.find((cand) => cand.id === hop || cand.address === hop || cand.label === hop);
          const hopNodeId = hopHost ? hopHost.id : `proxy-node-${hop}`;
          if (nodeIds.has(prevNodeId) && nodeIds.has(hopNodeId)) {
            edges.push({
              id: `jump-edge-${prevNodeId}-${hopNodeId}-${h.id}`,
              source: prevNodeId,
              target: hopNodeId,
              animated: true,
              label: `Hop #${hopIdx + 1}`,
              style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6,4' },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
            });
            prevNodeId = hopNodeId;
          }
        });
        // Final link to target host
        if (nodeIds.has(prevNodeId) && nodeIds.has(h.id)) {
          edges.push({
            id: `jump-target-${prevNodeId}-${h.id}`,
            source: prevNodeId,
            target: h.id,
            animated: true,
            label: 'Target',
            style: { stroke: '#f59e0b', strokeWidth: 2.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
          });
        }
      } else {
        // Standard Direct SSH edge from Client
        if (nodeIds.has('client-node') && nodeIds.has(h.id)) {
          const isSessionActive = activeSessionHostIds.includes(h.id);
          edges.push({
            id: `edge-client-${h.id}`,
            source: 'client-node',
            target: h.id,
            animated: isSessionActive,
            style: {
              stroke: isSessionActive ? '#2dd4bf' : 'rgba(45, 212, 191, 0.45)',
              strokeWidth: isSessionActive ? 2.5 : 1.5,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isSessionActive ? '#2dd4bf' : 'rgba(45, 212, 191, 0.45)',
            },
          });
        }
      }

      // Check for Active Port Forwarding Tunnels
      const hostTunnels = activeTunnels.filter((t) =>
        isTunnelMatchingHost(t, h.id, h.address, forwardRules)
      );
      hostTunnels.forEach((tun) => {
        edges.push({
          id: `tunnel-edge-${h.id}-${tun.id}`,
          source: 'client-node',
          target: h.id,
          animated: true,
          label: formatTunnelRoute(tun, h.label),
          labelStyle: {
            fill: '#ffffff',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: '11px',
            letterSpacing: '0.03em',
          },
          labelBgStyle: {
            fill: '#080d1a',
            fillOpacity: 0.96,
            stroke: '#ec4899',
            strokeWidth: 1.5,
          },
          labelBgPadding: [10, 6],
          labelBgBorderRadius: 6,
          style: { stroke: '#ec4899', strokeWidth: 2.5, strokeDasharray: '4,4' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#ec4899' },
        });
      });

      // Check for Configured Standby Forward Rules
      const standbyRules = (forwardRules || []).filter(
        (r) => r.hostId === h.id && !activeTunnels.some((t) => t.ruleId === r.id)
      );
      standbyRules.forEach((rule) => {
        edges.push({
          id: `standby-edge-${h.id}-${rule.id}`,
          source: 'client-node',
          target: h.id,
          animated: false,
          label: `${formatRuleRoute(rule, h.label)} [STANDBY]`,
          labelStyle: {
            fill: '#5eead4',
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            fontSize: '10px',
            letterSpacing: '0.03em',
          },
          labelBgStyle: {
            fill: '#051119',
            fillOpacity: 0.92,
            stroke: 'rgba(20, 184, 166, 0.45)',
            strokeWidth: 1,
          },
          labelBgPadding: [8, 4],
          labelBgBorderRadius: 5,
          style: { stroke: 'rgba(20, 184, 166, 0.35)', strokeWidth: 1.5, strokeDasharray: '4,6' },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(20, 184, 166, 0.5)' },
        });
      });
    }

    return { generatedNodes: nodes, generatedEdges: edges };
  }, [
    filteredHosts,
    hosts,
    groups,
    notes,
    activeSessionHostIds,
    activeTunnels,
    forwardRules,
    layoutMode,
    onConnectHost,
    onSplitConnectHost,
    onOpenSftp,
    onOpenNotes,
    onStartTunnel,
    onStopTunnel,
    proxyProfiles,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(generatedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(generatedEdges);

  // Sync state whenever generated nodes/edges change
  useEffect(() => {
    setNodes(generatedNodes);
    setEdges(generatedEdges);
  }, [generatedNodes, generatedEdges, setNodes, setEdges]);

  // Handle node click to inspect details
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'hostNode') {
      setSelectedHostId(node.id);
    } else {
      setSelectedHostId(null);
    }
  }, []);

  const selectedHost = useMemo(() => {
    if (!selectedHostId) return null;
    return hosts.find((h) => h.id === selectedHostId) || null;
  }, [selectedHostId, hosts]);

  const selectedHostGroup = useMemo(() => {
    if (!selectedHost) return null;
    return groups.find((g) => g.id === selectedHost.groupId) || null;
  }, [selectedHost, groups]);

  const selectedHostTunnels = useMemo(() => {
    if (!selectedHost) return [];
    return activeTunnels.filter((t) =>
      isTunnelMatchingHost(t, selectedHost.id, selectedHost.address, forwardRules)
    );
  }, [selectedHost, activeTunnels, forwardRules]);

  const selectedHostRules = useMemo(() => {
    if (!selectedHost || !forwardRules) return [];
    return forwardRules.filter((r) => r.hostId === selectedHost.id);
  }, [selectedHost, forwardRules]);

  const selectedHostNotes = useMemo(() => {
    if (!selectedHost) return [];
    return notes.filter((n) => n.hostId === selectedHost.id);
  }, [selectedHost, notes]);

  return (
    <div
      className={`network-map-view ${isDocked ? 'is-docked' : ''}`}
      role="region"
      aria-label="Network Topology Map"
    >
      {/* Top HUD Control Deck */}
      <header className="network-map-toolbar">
        <div className="network-map-title-group">
          <CyberIcon name="network" size={16} />
          <strong className="network-map-title">Network Topology Map</strong>
          <span className="network-map-f-id">F-37</span>
        </div>

        {/* Search & Mode Toggles */}
        <div className="network-map-controls">
          <div className="network-map-search-wrapper">
            <CyberIcon name="search" size={12} />
            <input
              type="text"
              aria-label="Search Network Nodes"
              placeholder="Filter hosts, IPs, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                title="Clear Search"
                onClick={() => setSearchQuery('')}
              >
                ×
              </button>
            )}
          </div>

          <div className="network-map-filter-group" role="group" aria-label="Filter Mode">
            <button
              type="button"
              className={`topo-mode-btn ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              All ({hosts.length})
            </button>
            <button
              type="button"
              className={`topo-mode-btn ${filterMode === 'active' ? 'active' : ''}`}
              onClick={() => setFilterMode('active')}
            >
              🟢 Active ({stats.activeSessions})
            </button>
            <button
              type="button"
              className={`topo-mode-btn ${filterMode === 'tunnels' ? 'active' : ''}`}
              onClick={() => setFilterMode('tunnels')}
            >
              ⇄ Tunnels ({stats.activeTunnels})
            </button>
            <button
              type="button"
              className={`topo-mode-btn ${filterMode === 'jumps' ? 'active' : ''}`}
              onClick={() => setFilterMode('jumps')}
            >
              ⛓ Jumps ({stats.jumpChains})
            </button>
          </div>

          <div className="network-map-layout-group">
            <label htmlFor="topo-layout-select" className="sr-only">Layout Mode</label>
            <select
              id="topo-layout-select"
              aria-label="Layout Mode"
              className="topo-layout-select"
              value={layoutMode}
              onChange={(e) => setLayoutMode(e.target.value as TopologyLayoutMode)}
            >
              <option value="hierarchical">Hierarchical (Left-to-Right)</option>
              <option value="subnets">Subnet Clusters</option>
              <option value="grid">Grid Array</option>
            </select>
          </div>
        </div>

        {/* Telemetry Counter Badges */}
        <div className="network-map-stats">
          <span className="topo-stat-pill" title="Total Configured Hosts">
            <strong>{stats.totalHosts}</strong> Hosts
          </span>
          <span className="topo-stat-pill" title="Distinct Subnets">
            <strong>{stats.totalSubnets}</strong> Subnets
          </span>
          {onClose && (
            <button
              type="button"
              className="topo-close-btn"
              aria-label="Close Network Map"
              title="Close Network Map"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
      </header>

      {/* Main Flow Canvas */}
      <div className="network-map-canvas-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color="rgba(45, 212, 191, 0.15)"
          />
          <Controls className="network-map-flow-controls" showInteractive={false} />
          <MiniMap
            className="network-map-minimap"
            nodeColor={(n) => {
              if (n.type === 'clientNode') return '#14b8a6';
              const d = n.data as TopologyNodeData;
              if (d.status === 'active') return '#10b981';
              if (d.status === 'tunnel') return '#ec4899';
              return '#64748b';
            }}
            maskColor="rgba(4, 8, 15, 0.75)"
          />
        </ReactFlow>

        {/* Node Detail / Steuerpult Inspector Drawer */}
        {selectedHost && (
          <aside
            className="network-map-inspector"
            role="complementary"
            aria-label={`Host Details for ${selectedHost.label}`}
          >
            <div className="inspector-header">
              <div className="inspector-title-row">
                <CyberIcon name="terminal" size={16} />
                <h3 className="inspector-title">{selectedHost.label}</h3>
              </div>
              <button
                type="button"
                className="inspector-close-btn"
                aria-label="Close Inspector"
                title="Close Inspector"
                onClick={() => setSelectedHostId(null)}
              >
                ×
              </button>
            </div>

            <div className="inspector-body">
              <div className="inspector-field">
                <span className="inspector-label">Address</span>
                <strong className="inspector-val">
                  {selectedHost.effectiveUser || 'root'}@{selectedHost.address}:{selectedHost.effectivePort || 22}
                </strong>
              </div>

              {selectedHostGroup && (
                <div className="inspector-field">
                  <span className="inspector-label">Host Group</span>
                  <strong className="inspector-val" style={{ color: selectedHostGroup.color || '#2dd4bf' }}>
                    {selectedHostGroup.name}
                  </strong>
                </div>
              )}

              <div className="inspector-field">
                <span className="inspector-label">Subnet CIDR</span>
                <code className="inspector-val">{extractSubnetCidr(selectedHost.address)}</code>
              </div>

              {(() => {
                const hops = getEffectiveJumpHopsForHost(selectedHost, proxyProfiles);
                const profile = selectedHost.proxyProfileId && proxyProfiles ? proxyProfiles.find((p) => p.id === selectedHost.proxyProfileId) : null;
                if (hops.length === 0 && !profile) return null;
                return (
                  <div className="inspector-field">
                    <span className="inspector-label">
                      {profile ? `Proxy Profile: ${profile.name} (${profile.type})` : 'ProxyJump Chain'}
                    </span>
                    <div className="inspector-jump-chain">
                      {hops.map((hop: string, i: number) => {
                        const hopHost = hosts.find((c) => c.id === hop || c.address === hop || c.label === hop);
                        return (
                          <span key={`${hop}-${i}`} className="inspector-jump-badge">
                            Hop {i + 1}: {hopHost ? `${hopHost.label} (${hopHost.address})` : hop}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Cyberpunk HUD Tunnel Routing Matrix */}
              <div className="inspector-field inspector-tunnel-matrix-field">
                <div className="inspector-matrix-header">
                  <div className="matrix-header-title">
                    <span className="hud-corner-bracket">///</span>
                    <span className="inspector-label">TUNNEL ROUTING MATRIX</span>
                  </div>
                  {onOpenForwardingManager && (
                    <button
                      type="button"
                      className="inspector-new-tunnel-link"
                      title="Configure new port forwarding rule for this host"
                      onClick={() => onOpenForwardingManager(selectedHost.id)}
                    >
                      + NEW TUNNEL
                    </button>
                  )}
                </div>

                {/* 1. Active Tunnels */}
                {selectedHostTunnels.length > 0 && (
                  <div className="inspector-tunnels-group">
                    <div className="inspector-group-title">
                      <span className="hud-dot live" /> ACTIVE TUNNELS ({selectedHostTunnels.length})
                    </div>
                    {selectedHostTunnels.map((t) => (
                      <div key={t.id} className="inspector-tunnel-card active">
                        <div className="tunnel-card-header">
                          <span className="tunnel-card-badge active">
                            -{t.type} {t.type === 'L' ? 'LOCAL FORWARD' : t.type === 'R' ? 'REMOTE FORWARD' : 'DYNAMIC SOCKS5'}
                          </span>
                          <span className="tunnel-live-indicator">● LIVE</span>
                        </div>

                        {/* Explicit Routing Diagram */}
                        <div className="tunnel-routing-diagram">
                          <div className="diagram-endpoint source">
                            <span className="endpoint-title">{t.type === 'R' ? 'REMOTE LISTENER' : 'LOCAL LISTENER'}</span>
                            <strong className="endpoint-host">{t.type === 'R' ? selectedHost.label : 'Client (Localhost)'}</strong>
                            <code className="endpoint-addr">
                              {t.type === 'R' ? selectedHost.address : (t.bindAddress || '127.0.0.1')}:{t.bindPort}
                            </code>
                          </div>

                          <div className="diagram-flow">
                            <span className="flow-arrow">──────▶</span>
                            <span className="flow-mode">SSH TUNNEL</span>
                          </div>

                          <div className="diagram-endpoint target">
                            <span className="endpoint-title">{t.type === 'R' ? 'LOCAL TARGET' : 'REMOTE TARGET'}</span>
                            <strong className="endpoint-host">{t.type === 'R' ? 'Client Workstation' : selectedHost.label}</strong>
                            <code className="endpoint-addr">
                              {t.type === 'R' ? (t.targetHost || 'localhost') : (t.targetHost || selectedHost.address)}:{t.targetPort || 'dyn'}
                            </code>
                          </div>
                        </div>

                        {/* Telemetry bar */}
                        <div className="tunnel-telemetry-bar">
                          <span className="telemetry-item">Conns: <strong>{t.activeConns}</strong></span>
                          <span className="telemetry-item">In: <strong>{formatBytes(t.bytesIn)}</strong></span>
                          <span className="telemetry-item">Out: <strong>{formatBytes(t.bytesOut)}</strong></span>
                        </div>

                        {/* Action button */}
                        {onStopTunnel && (
                          <div className="tunnel-card-actions">
                            <button
                              type="button"
                              className="hud-btn-danger"
                              onClick={() => onStopTunnel(t.id)}
                            >
                              ■ STOP TUNNEL
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. Configured Forward Rules (Available to Start) */}
                {selectedHostRules.length > 0 && (
                  <div className="inspector-tunnels-group">
                    <div className="inspector-group-title">
                      <span className="hud-dot standby" /> CONFIGURED RULES ({selectedHostRules.length})
                    </div>
                    {selectedHostRules.map((r) => {
                      const isActive = selectedHostTunnels.some((t) => t.ruleId === r.id);
                      if (isActive) return null; // already shown in active section
                      return (
                        <div key={r.id} className="inspector-tunnel-card standby">
                          <div className="tunnel-card-header">
                            <span className="tunnel-card-badge standby">
                              -{r.type} {r.label || (r.type === 'L' ? 'Local Forward' : r.type === 'R' ? 'Remote Forward' : 'Dynamic SOCKS5')}
                            </span>
                            <span className="tunnel-standby-indicator">○ STANDBY</span>
                          </div>

                          {/* Explicit Routing Diagram */}
                          <div className="tunnel-routing-diagram standby">
                            <div className="diagram-endpoint source">
                              <span className="endpoint-title">{r.type === 'R' ? 'REMOTE LISTENER' : 'LOCAL LISTENER'}</span>
                              <strong className="endpoint-host">{r.type === 'R' ? selectedHost.label : 'Client (Localhost)'}</strong>
                              <code className="endpoint-addr">
                                {r.type === 'R' ? selectedHost.address : (r.bindAddress || '127.0.0.1')}:{r.bindPort}
                              </code>
                            </div>

                            <div className="diagram-flow">
                              <span className="flow-arrow">⇢ ⇢ ⇢</span>
                              <span className="flow-mode">STANDBY</span>
                            </div>

                            <div className="diagram-endpoint target">
                              <span className="endpoint-title">{r.type === 'R' ? 'LOCAL TARGET' : 'REMOTE TARGET'}</span>
                              <strong className="endpoint-host">{r.type === 'R' ? 'Client Workstation' : selectedHost.label}</strong>
                              <code className="endpoint-addr">
                                {r.type === 'R' ? (r.targetHost || 'localhost') : (r.targetHost || selectedHost.address)}:{r.targetPort || 'dyn'}
                              </code>
                            </div>
                          </div>

                          {/* Action button */}
                          <div className="tunnel-card-actions">
                            <button
                              type="button"
                              className="hud-btn-primary"
                              title="Start tunnel (connects automatically if offline)"
                              onClick={() => onStartTunnel?.(selectedHost.id, r.id)}
                            >
                              ▶ START TUNNEL
                            </button>
                            <span className="action-hint">Auto-connects to {selectedHost.label} if offline</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedHostTunnels.length === 0 && selectedHostRules.length === 0 && (
                  <div className="inspector-empty-tunnels">
                    <p>No port tunnels configured for {selectedHost.label}.</p>
                    {onOpenForwardingManager && (
                      <button
                        type="button"
                        className="hud-btn-outline"
                        onClick={() => onOpenForwardingManager(selectedHost.id)}
                      >
                        + Create Port Forwarding Rule
                      </button>
                    )}
                  </div>
                )}
              </div>

              {selectedHostNotes.length > 0 && (
                <div className="inspector-field">
                  <span className="inspector-label">Associated Notes ({selectedHostNotes.length})</span>
                  <ul className="inspector-notes-list">
                    {selectedHostNotes.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          className="inspector-note-link"
                          onClick={() => onOpenNotes?.(selectedHost.id)}
                        >
                          📄 {n.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="inspector-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => onConnectHost?.(selectedHost.id)}
              >
                <CyberIcon name="bolt" size={13} /> Connect SSH
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onSplitConnectHost?.(selectedHost.id)}
              >
                <CyberIcon name="split-h" size={13} /> Split Connect
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onOpenSftp?.(selectedHost.id, selectedHost.label)}
              >
                <CyberIcon name="folder" size={13} /> SFTP Browser
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onOpenNotes?.(selectedHost.id)}
              >
                <CyberIcon name="note" size={13} /> Host Notes
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Visual Legend */}
      <footer className="network-map-legend">
        <div className="legend-item">
          <span className="legend-line direct-line" /> Direct SSH Connection
        </div>
        <div className="legend-item">
          <span className="legend-line jump-line" /> Multi-Hop Jump Chain
        </div>
        <div className="legend-item">
          <span className="legend-line tunnel-line" /> Active Forward Tunnel
        </div>
        <div className="legend-item">
          <span className="legend-dot active-dot" /> Live Session Active
        </div>
        <div className="legend-item">
          <span className="legend-dot tunnel-dot" /> Port Tunnel Active
        </div>
      </footer>
    </div>
  );
};
