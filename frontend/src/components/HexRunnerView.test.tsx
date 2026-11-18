import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HexRunnerView } from './HexRunnerView';

describe('HexRunnerView (F-43)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('previews raw hex bytes, runs local binary without PTY, finds cyclic offset, and bridges to API tester & Raw TCP', async () => {
    const previewMock = vi.fn(async (expr: string) => ({
      byteCount: expr ? 24 : 0,
      hexCompact: '41'.repeat(16) + '0001feffefbeadde',
      hexDump: '00000000: 41 41 41 41 41 41 41 41  |AAAAAAAA|',
      base64: 'QUFB',
    }));
    const execLocalMock = vi.fn(async () => ({
      executionId: 'hex-1',
      targetType: 'local',
      inputByteCount: 24,
      inputHexPreview: '00000000: 41 41 ...',
      exitCode: 0,
      durationMs: 14,
      stdoutHexDump: '00000000: ca fe ba be  |....|',
      stdoutASCII: '\\xca\\xfe\\xba\\xbe',
      stdoutBase64: 'yv66vg==',
      stdoutBytes: 4,
      stderrHexDump: '',
      stderrASCII: '',
      stderrBytes: 0,
      truncated: false,
    }));
    const offsetMock = vi.fn(async () => 44);
    const sendTcpHexMock = vi.fn(async () => 24);
    const onSendToApiTester = vi.fn();

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          PreviewHexPayload: previewMock,
          ExecuteHexLocal: execLocalMock,
          FindCyclicOffset: offsetMock,
          SendRawTcpHex: sendTcpHexMock,
        },
      },
    };

    render(
      <HexRunnerView
        activeEngagementId="eng-1"
        activeEngagementName="Acme"
        sshSessions={[{ id: 'ssh-1', label: 'root@10.0.0.5' }]}
        rawTcpSessions={[{ id: 'tcp-1', label: '10.0.0.5:4444' }]}
        onSendToApiTester={onSendToApiTester}
      />
    );

    fireEvent.change(screen.getByLabelText('Target Executable'), {
      target: { value: './vuln_bin' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Execute Raw Binary/i }));

    await waitFor(() => {
      expect(execLocalMock).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Execution Output').textContent).toContain('ca fe ba be');
    });

    // Switch output tab to Escaped ASCII
    fireEvent.click(screen.getByRole('button', { name: /Stdout ASCII/i }));
    expect(screen.getByLabelText('Execution Output').textContent).toContain('\\xca\\xfe\\xba\\xbe');

    // Cyclic offset finder
    fireEvent.click(screen.getByRole('button', { name: /Find Offset/i }));
    await waitFor(() => {
      expect(screen.getByText(/Exact cyclic offset: 44/i)).toBeInTheDocument();
    });

    // Bridge to Raw TCP & HTTP API Tester
    fireEvent.click(screen.getByRole('button', { name: /Send to Raw TCP/i }));
    await waitFor(() => {
      expect(sendTcpHexMock).toHaveBeenCalledWith('tcp-1', expect.any(String));
    });

    fireEvent.click(screen.getByRole('button', { name: /Send to API \(hex\)/i }));
    expect(onSendToApiTester).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Hex: vuln_bin',
        body: expect.stringContaining('41*16'),
      })
    );
  });
});
