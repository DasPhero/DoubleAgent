export type ProxyProfileType = 'jump' | 'command' | 'socks5';

export interface ProxyProfile {
  id: string;
  name: string;
  type: ProxyProfileType;
  jumpHostIds?: string[];
  command?: string;
  socksAddress?: string;
  socksUsername?: string;
  socksPassword?: string;
}

export interface ProxyProfileSummary {
  id: string;
  name: string;
  type: ProxyProfileType;
  jumpHostIds?: string[];
  command?: string;
  socksAddress?: string;
  socksUsername?: string;
  hasPassword?: boolean;
}

export type ProxychainsChainType = 'strict_chain' | 'dynamic_chain' | 'random_chain' | 'round_robin_chain';

export interface ProxychainsProxyEntry {
  type: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  comment?: string;
}

export interface ProxychainsExportOptions {
  chainType: ProxychainsChainType;
  proxyDNS: boolean;
  quietMode: boolean;
  tcpReadTimeout: number;
  tcpConnectTimeout: number;
  proxies: ProxychainsProxyEntry[];
}

