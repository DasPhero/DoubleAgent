import { ForwardTunnelStatus, ForwardRule } from './forward';

export type TopologyNodeType = 'client' | 'host' | 'subnet';
export type TopologyNodeStatus = 'active' | 'tunnel' | 'configured';
export type TopologyEdgeType = 'direct' | 'jump' | 'tunnel';
export type TopologyFilterMode = 'all' | 'active' | 'tunnels' | 'jumps';
export type TopologyLayoutMode = 'hierarchical' | 'subnets' | 'grid';

export interface TopologyNodeData {
  id: string;
  label: string;
  nodeType: TopologyNodeType;
  hostId?: string;
  address?: string;
  port?: number;
  username?: string;
  groupName?: string;
  groupColor?: string;
  color?: string;
  tags?: string[];
  status: TopologyNodeStatus;
  activeSessionsCount?: number;
  activeTunnelsCount?: number;
  hostTunnels?: ForwardTunnelStatus[];
  hostRules?: ForwardRule[];
  jumpHops?: string[];
  notesCount?: number;
  onConnect?: (hostId: string) => void;
  onSplitConnect?: (hostId: string) => void;
  onOpenSftp?: (hostId: string, label: string) => void;
  onOpenNotes?: (hostId: string) => void;
  onStartTunnel?: (hostId: string, ruleId: string) => void;
  onStopTunnel?: (tunnelId: string) => void;
}

export interface TopologyEdgeData {
  edgeType: TopologyEdgeType;
  label?: string;
  jumpHopIndex?: number;
  tunnelInfo?: string;
}

export interface TopologyFilterOptions {
  searchQuery: string;
  filterMode: TopologyFilterMode;
  layoutMode: TopologyLayoutMode;
  selectedGroupId?: string;
}

export interface TopologyStats {
  totalHosts: number;
  totalSubnets: number;
  activeSessions: number;
  activeTunnels: number;
  jumpChains: number;
}

export interface TopologyHostItem {
  id: string;
  label: string;
  address: string;
  effectivePort: number;
  effectiveUser: string;
  groupId?: string;
  tags?: string[];
  color?: string;
  jumpChain?: string[];
  proxyProfileId?: string;
}

export interface TopologyGroupItem {
  id: string;
  name: string;
  color?: string;
}
