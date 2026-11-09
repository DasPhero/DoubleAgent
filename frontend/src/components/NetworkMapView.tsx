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
  activeSessionHostIds?: string[];
  activeTunnels?: ForwardTunnelStatus[];
  forwardRules?: ForwardRule[];
  onConnectHost?: (hostId: string) => void;
  onSplitConnectHost?: (hostId: string) => void;
  onOpenSftp?: (hostId: string, hostLabel: string) => void;
  onOpenNotes?: (hostId: string) => void;
  onClose?: () => void;
  isDocked?: boolean;
}

export const NetworkMapView: React.FC<NetworkMapViewProps> = ({
  hosts,
  groups,
  notes = [],
  activeSessionHostIds = [],
  activeTunnels = [],
  forwardRules = [],
  onConnectHost,
  onSplitConnectHost,
  onOpenSftp,
  onOpenNotes,
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
      const hasJumpChain = Boolean(h.jumpChain && h.jumpChain.length > 0);

      if (filterMode === 'active') return isSessionActive;
      if (filterMode === 'tunnels') return isTunnelActive;
      if (filterMode === 'jumps') return hasJumpChain;
      return true;
    });
  }, [hosts, searchQuery, filterMode, activeSessionHostIds, activeTunnels, forwardRules]);

  // Compute telemetry statistics
  const stats: TopologyStats = useMemo(() => {
    const subnets = new Set<string>();
    let jumpCount = 0;
    for (const h of hosts) {
      subnets.add(extractSubnetCidr(h.address));
      if (h.jumpChain && h.jumpChain.length > 0) {
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
  }, [hosts, activeSessionHostIds, activeTunnels]);

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
      if (h.jumpChain) {
        for (const hop of h.jumpChain) {
          bastionIds.add(hop);
        }
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
      const bastions = filteredHosts.filter((h) => bastionIds.has(h.id) || bastionIds.has(h.address));
      const targets = filteredHosts.filter((h) => !bastionIds.has(h.id) && !bastionIds.has(h.address));

      let bastionY = 80;
      for (const h of bastions) {
        const group = groups.find((g) => g.id === h.groupId);
        const isSessionActive = activeSessionHostIds.includes(h.id);
        const isTunnelActive = activeTunnels.some((t) =>
          isTunnelMatchingHost(t, h.id, h.address, forwardRules)
        );

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
            activeTunnelsCount: activeTunnels.filter((t) =>
              isTunnelMatchingHost(t, h.id, h.address, forwardRules)
            ).length,
            jumpHops: h.jumpChain,
            notesCount: notes.filter((n) => n.hostId === h.id).length,
            onConnect: onConnectHost,
            onSplitConnect: onSplitConnectHost,
            onOpenSftp,
            onOpenNotes,
          },
        });
        bastionY += 190;
      }

      // Tier 2: Target / End Hosts
      let targetY = 60;
      for (const h of targets) {
        const group = groups.find((g) => g.id === h.groupId);
        const isSessionActive = activeSessionHostIds.includes(h.id);
        const isTunnelActive = activeTunnels.some((t) =>
          isTunnelMatchingHost(t, h.id, h.address, forwardRules)
        );

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
            activeTunnelsCount: activeTunnels.filter((t) =>
              isTunnelMatchingHost(t, h.id, h.address, forwardRules)
            ).length,
            jumpHops: h.jumpChain,
            notesCount: notes.filter((n) => n.hostId === h.id).length,
            onConnect: onConnectHost,
            onSplitConnect: onSplitConnectHost,
            onOpenSftp,
            onOpenNotes,
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
          const isTunnelActive = activeTunnels.some((t) =>
            isTunnelMatchingHost(t, h.id, h.address, forwardRules)
          );

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
              activeTunnelsCount: activeTunnels.filter((t) =>
                isTunnelMatchingHost(t, h.id, h.address, forwardRules)
              ).length,
              jumpHops: h.jumpChain,
              notesCount: notes.filter((n) => n.hostId === h.id).length,
              onConnect: onConnectHost,
              onSplitConnect: onSplitConnectHost,
              onOpenSftp,
              onOpenNotes,
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
        const isTunnelActive = activeTunnels.some((t) =>
          isTunnelMatchingHost(t, h.id, h.address, forwardRules)
        );

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
            activeTunnelsCount: activeTunnels.filter((t) =>
              isTunnelMatchingHost(t, h.id, h.address, forwardRules)
            ).length,
            jumpHops: h.jumpChain,
            notesCount: notes.filter((n) => n.hostId === h.id).length,
            onConnect: onConnectHost,
            onSplitConnect: onSplitConnectHost,
            onOpenSftp,
            onOpenNotes,
          },
        });
      });
    }

    // 5. Connect Edges (Direct SSH, Jump Chains, and Active Tunnels)
    for (const h of filteredHosts) {
      if (h.jumpChain && h.jumpChain.length > 0) {
        // Multi-hop Jump Chain edges
        let prevNodeId = 'client-node';
        h.jumpChain.forEach((hop: string, hopIdx: number) => {
          const hopHost = hosts.find((cand) => cand.id === hop || cand.address === hop);
          const hopNodeId = hopHost ? hopHost.id : hop;
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
        });
        // Final link to target host
        edges.push({
          id: `jump-target-${prevNodeId}-${h.id}`,
          source: prevNodeId,
          target: h.id,
          animated: true,
          label: 'Target',
          style: { stroke: '#f59e0b', strokeWidth: 2.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
        });
      } else {
        // Standard Direct SSH edge from Client
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
          label: `-${tun.type} ${tun.bindPort}⇄${tun.targetPort || 'dyn'}`,
          style: { stroke: '#ec4899', strokeWidth: 2.5, strokeDasharray: '4,4' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#ec4899' },
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

              {selectedHost.jumpChain && selectedHost.jumpChain.length > 0 && (
                <div className="inspector-field">
                  <span className="inspector-label">ProxyJump Chain</span>
                  <div className="inspector-jump-chain">
                    {selectedHost.jumpChain.map((hop: string, i: number) => (
                      <span key={hop} className="inspector-jump-badge">
                        Hop {i + 1}: {hop}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedHostTunnels.length > 0 && (
                <div className="inspector-field">
                  <span className="inspector-label">Active Port Tunnels</span>
                  <div className="inspector-tunnels-list">
                    {selectedHostTunnels.map((t) => (
                      <div key={t.id} className="inspector-tunnel-row">
                        <span className="tunnel-mode-pill">-{t.type}</span>
                        <span>
                          {t.bindAddress}:{t.bindPort} &rarr; {t.targetHost || 'localhost'}:{t.targetPort || 'dyn'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedHostRules.length > 0 && (
                <div className="inspector-field">
                  <span className="inspector-label">Configured Forward Rules ({selectedHostRules.length})</span>
                  <div className="inspector-tunnels-list">
                    {selectedHostRules.map((r) => (
                      <div key={r.id} className="inspector-tunnel-row">
                        <span className="tunnel-mode-pill">-{r.type}</span>
                        <span>
                          {r.label ? `${r.label}: ` : ''}{r.bindAddress || '127.0.0.1'}:{r.bindPort} &rarr; {r.targetHost || 'localhost'}:{r.targetPort || 'dyn'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
