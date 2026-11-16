import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NmapImportModal } from './NmapImportModal';
import { NmapScanResult, NmapImportSummary } from '../types/nmap';

const mockScanResult: NmapScanResult = {
  scanner: 'nmap',
  args: 'nmap -sV -p 22,80 10.10.10.5',
  version: '7.94',
  startStr: 'Mon Nov 13 10:00:00 2026',
  summary: '1 host up',
  elapsedSecs: '5.0',
  scanKind: 'port_scan',
  totalHosts: 1,
  upHostsCount: 1,
  downHostsCount: 0,
  totalOpenPorts: 2,
  hosts: [
    {
      ipv4: '10.10.10.5',
      ipv6: '',
      mac: '',
      macVendor: '',
      hostnames: ['ares.target.htb'],
      primaryName: 'ares.target.htb',
      state: 'up',
      reason: 'syn-ack',
      osName: 'Linux 5.4',
      osAccuracy: '100',
      openPorts: [
        {
          port: 22,
          protocol: 'tcp',
          state: 'open',
          reason: 'syn-ack',
          service: 'ssh',
          product: 'OpenSSH',
          version: '8.2p1',
        },
        {
          port: 80,
          protocol: 'tcp',
          state: 'open',
          reason: 'syn-ack',
          service: 'http',
          product: 'Apache httpd',
          version: '2.4.41',
        },
      ],
      filteredPorts: [],
      closedCount: 998,
      filteredCount: 0,
      isAliveOnly: false,
    },
  ],
};

const mockImportSummary: NmapImportSummary = {
  createdHosts: 1,
  updatedHosts: 0,
  createdNotes: 3,
  createdPortNotes: 2,
  createdPortFindings: 2,
  hostIds: ['host-nmap-1'],
  scanKind: 'port_scan',
  message: 'Nmap import completed successfully.',
};

describe('NmapImportModal (F-39)', () => {
  it('renders modal, parses XML, and displays port scan telemetry', async () => {
    const onScanXML = vi.fn().mockResolvedValue(mockScanResult);
    const onImportXML = vi.fn().mockResolvedValue(mockImportSummary);
    const onClose = vi.fn();

    render(
      <NmapImportModal
        isOpen={true}
        engagements={[{ id: 'eng-1', name: 'Alpha Red Team' }]}
        groups={[{ id: 'grp-1', name: 'DMZ' }]}
        activeEngagementId="eng-1"
        onScanXML={onScanXML}
        onImportXML={onImportXML}
        onClose={onClose}
      />
    );

    expect(screen.getByText(/NMAP XML RECON INGEST/i)).toBeDefined();

    // Open textarea and trigger scan
    const details = screen.getByText(/Paste Raw XML Directly/i);
    fireEvent.click(details);

    const textarea = screen.getByPlaceholderText(/<nmaprun/i);
    fireEvent.change(textarea, { target: { value: '<nmaprun args="nmap -sV 10.10.10.5"></nmaprun>' } });

    const parseBtn = screen.getByRole('button', { name: /Parse & Preview XML/i });
    fireEvent.click(parseBtn);

    await waitFor(() => {
      expect(onScanXML).toHaveBeenCalledWith('<nmaprun args="nmap -sV 10.10.10.5"></nmaprun>');
    });

    // Check parsed telemetry
    await waitFor(() => {
      expect(screen.getByText(/FULL PORT & SERVICE SCAN/i)).toBeDefined();
      expect(screen.getByText(/ares\.target\.htb/i)).toBeDefined();
      expect(screen.getByText(/22\/tcp/i)).toBeDefined();
      expect(screen.getByText(/80\/tcp/i)).toBeDefined();
    });

    // Execute import
    const importBtn = screen.getByRole('button', { name: /Import Into Encrypted Vault/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(onImportXML).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            engagementId: 'eng-1',
            createHostRecords: true,
            createPortNotes: true,
            createSummaryNotes: true,
            createPortFindings: true,
            onlyUpHosts: true,
          }),
        })
      );
    });

    // Check success summary
    await waitFor(() => {
      expect(screen.getByText(/Ingest Completed Successfully/i)).toBeDefined();
      expect(screen.getByText(/Created Hosts/i)).toBeDefined();
      expect(screen.getByText(/Port Subpages/i)).toBeDefined();
    });
  });

  it('renders alive check scan kind correctly', async () => {
    const aliveScanResult: NmapScanResult = {
      ...mockScanResult,
      scanKind: 'alive_check',
      totalOpenPorts: 0,
      hosts: [
        {
          ...mockScanResult.hosts[0],
          openPorts: [],
          isAliveOnly: true,
          reason: 'arp-response',
        },
      ],
    };

    const onScanXML = vi.fn().mockResolvedValue(aliveScanResult);
    const onImportXML = vi.fn();
    const onClose = vi.fn();

    render(
      <NmapImportModal
        isOpen={true}
        engagements={[]}
        groups={[]}
        onScanXML={onScanXML}
        onImportXML={onImportXML}
        onClose={onClose}
      />
    );

    const details = screen.getByText(/Paste Raw XML Directly/i);
    fireEvent.click(details);

    const textarea = screen.getByPlaceholderText(/<nmaprun/i);
    fireEvent.change(textarea, { target: { value: '<nmaprun args="nmap -sn 192.168.1.0/24"></nmaprun>' } });

    const parseBtn = screen.getByRole('button', { name: /Parse & Preview XML/i });
    fireEvent.click(parseBtn);

    await waitFor(() => {
      expect(screen.getByText(/ALIVE CHECK \/\/ HOST DISCOVERY/i)).toBeDefined();
      expect(screen.getByText(/No open ports discovered/i)).toBeDefined();
    });
  });
});
