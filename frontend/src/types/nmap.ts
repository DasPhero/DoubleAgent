export type NmapScanKind = 'alive_check' | 'port_scan' | 'mixed';

export interface ParsedNmapPort {
  port: number;
  protocol: string;
  state: string;
  reason: string;
  service: string;
  product?: string;
  version?: string;
  extraInfo?: string;
  osType?: string;
  cpes?: string[];
  scripts?: Record<string, string>;
}

export interface ParsedNmapHost {
  ipv4: string;
  ipv6: string;
  mac: string;
  macVendor: string;
  hostnames: string[];
  primaryName: string;
  state: string;
  reason: string;
  osName: string;
  osAccuracy: string;
  openPorts: ParsedNmapPort[];
  filteredPorts: ParsedNmapPort[];
  closedCount: number;
  filteredCount: number;
  isAliveOnly: boolean;
}

export interface NmapScanResult {
  scanner: string;
  args: string;
  version: string;
  startStr: string;
  summary: string;
  elapsedSecs: string;
  scanKind: NmapScanKind;
  totalHosts: number;
  upHostsCount: number;
  downHostsCount: number;
  totalOpenPorts: number;
  hosts: ParsedNmapHost[];
}

export interface NmapImportOptions {
  engagementId?: string;
  groupId?: string;
  createHostRecords: boolean;
  createPortNotes: boolean;
  createSummaryNotes: boolean;
  createPortFindings: boolean;
  onlyUpHosts: boolean;
  tagPrefix?: string;
}

export interface NmapImportRequest {
  xmlContent: string;
  options: NmapImportOptions;
}

export interface NmapImportSummary {
  createdHosts: number;
  updatedHosts: number;
  createdNotes: number;
  createdPortNotes: number;
  createdPortFindings: number;
  hostIds: string[];
  scanKind: string;
  message: string;
}
