import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EvidenceVaultModal, computeCvssV31, COMMON_MITRE_TECHNIQUES } from './EvidenceVaultModal';

describe('CVSS v3.1 Calculator & MITRE ATT&CK (F-18)', () => {
  it('correctly calculates CVSS v3.1 base score for unauthenticated critical network RCE', () => {
    // Standard Critical Network Exploit (e.g. Log4Shell / Remote Code Execution)
    const result = computeCvssV31({
      av: 'N',
      ac: 'L',
      pr: 'N',
      ui: 'N',
      s: 'U',
      c: 'H',
      i: 'H',
      a: 'H',
    });

    expect(result.score).toBe(9.8);
    expect(result.severity).toBe('critical');
    expect(result.vector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
  });

  it('correctly calculates CVSS v3.1 for local privilege escalation (Unquoted Service Path)', () => {
    // Local, Low Privileges, Scope Unchanged, High Confidentiality/Integrity/Availability
    const result = computeCvssV31({
      av: 'L',
      ac: 'L',
      pr: 'L',
      ui: 'N',
      s: 'U',
      c: 'H',
      i: 'H',
      a: 'H',
    });

    expect(result.score).toBe(7.8);
    expect(result.severity).toBe('high');
    expect(result.vector).toBe('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H');
  });

  it('correctly calculates CVSS v3.1 with Scope Changed (Sudo NOPASSWD / Container Breakout)', () => {
    // Scope Changed increases score multiplier
    const result = computeCvssV31({
      av: 'L',
      ac: 'L',
      pr: 'L',
      ui: 'N',
      s: 'C',
      c: 'H',
      i: 'H',
      a: 'H',
    });

    expect(result.score).toBe(8.8);
    expect(result.severity).toBe('high');
    expect(result.vector).toBe('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H');
  });

  it('provides comprehensive standard MITRE ATT&CK techniques presets', () => {
    expect(COMMON_MITRE_TECHNIQUES).toContain('T1003.001 - OS Credential Dumping: LSASS Memory');
    expect(COMMON_MITRE_TECHNIQUES).toContain('T1021.006 - Remote Services: Windows Remote Management (WinRM)');
    expect(COMMON_MITRE_TECHNIQUES).toContain('T1558.003 - Steal or Forge Kerberos Tickets: Kerberoasting');
    expect(COMMON_MITRE_TECHNIQUES).toContain('T1574.009 - Hijack Execution Flow: Path Interception by Unquoted Path');
  });
});

describe('Evidence-Vault Per-Host Markdown & HTML Reporting (F-30)', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { go?: unknown }).go;
  });

  it('compiles Markdown and sandboxed HTML5 reports with SHA-256 and supports per-host batch export', async () => {
    const generateMock = vi.fn(async (req: { format: string; splitByHost?: boolean; outputDir?: string }) => {
      if (req.splitByHost) {
        return {
          format: req.format,
          fileName: 'manifest.sha256',
          content: '',
          contentSha256: 'deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb',
          findingsCount: 1,
          evidenceCount: 1,
          hostCount: 1,
          internalExcluded: 0,
          writtenFiles: [
            {
              hostId: 'h-dc',
              hostLabel: 'DC01',
              fileName: 'ACME-DC01-10.10.20.10.html',
              filePath: 'C:/tmp/reports/ACME-DC01-10.10.20.10.html',
              sha256: 'aaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
              bytes: 4096,
            },
          ],
        };
      }
      if (req.format === 'html') {
        return {
          format: 'html',
          fileName: 'ACME.html',
          content: '<!DOCTYPE html><html><body><h1>DC01 Report</h1></body></html>',
          contentSha256: 'bbbb1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
          findingsCount: 1,
          evidenceCount: 1,
          hostCount: 1,
          internalExcluded: 1,
        };
      }
      return {
        format: 'markdown',
        fileName: 'ACME.md',
        content: '# DoubleAgent Assessment Report\n\n## DC01\n',
        contentSha256: 'cccc1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
        findingsCount: 1,
        evidenceCount: 1,
        hostCount: 1,
        internalExcluded: 1,
      };
    });

    const selectDirMock = vi.fn(async () => 'C:/tmp/reports');

    (window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          ListEngagements: async () => [{ id: 'eng-1', name: 'ACME', scope: '10.10.0.0/16', timeframe: '2026-11' }],
          GetActiveEngagement: async () => ({ id: 'eng-1', name: 'ACME', scope: '10.10.0.0/16', timeframe: '2026-11' }),
          ListFindings: async () => [],
          GetFindingTemplates: async () => [],
          ListEvidence: async () => [],
          GetEvidenceCategories: async () => [],
          GetEvidenceTemplates: async () => [],
          GenerateEvidenceReport: generateMock,
          SelectDirectoryDialog: selectDirMock,
        },
      },
    };

    render(
      <EvidenceVaultModal
        isOpen
        onClose={() => {}}
        hosts={[{ id: 'h-dc', label: 'DC01', address: '10.10.20.10' }]}
        activeHostId="h-dc"
      />
    );

    fireEvent.click(screen.getByText('Assessment Report'));

    await waitFor(() => {
      expect(generateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: 'h-dc',
          format: 'markdown',
        })
      );
    });
    expect(screen.getByText(/SHA-256: cccc111122223333/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('HTML5 (.html)'));
    await waitFor(() => {
      const iframe = screen.getByTitle('Assessment Report HTML Preview');
      expect(iframe).toHaveAttribute('sandbox', '');
      expect(iframe.getAttribute('srcDoc') || iframe.getAttribute('srcdoc')).toContain('DC01 Report');
    });

    fireEvent.click(screen.getByText('Export 1 File Per Host'));
    await waitFor(() => {
      expect(selectDirMock).toHaveBeenCalled();
      expect(generateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          splitByHost: true,
          outputDir: 'C:/tmp/reports',
        })
      );
      expect(screen.getByText('ACME-DC01-10.10.20.10.html')).toBeInTheDocument();
    });
  });
});

