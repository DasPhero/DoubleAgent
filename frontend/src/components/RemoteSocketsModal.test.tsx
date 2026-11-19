import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RemoteSocketsModal } from './RemoteSocketsModal';

describe('RemoteSocketsModal (F-45)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('scans remote sockets on demand, filters loopback services, and launches 1-click -L tunnel + API tester', async () => {
    const discoverMock = vi.fn(async () => ({
      sessionId: 'ssh-1',
      platform: 'linux',
      commandUsed: 'ss -tulnp',
      entries: [
        {
          proto: 'tcp',
          state: 'LISTEN',
          localAddress: '127.0.0.1',
          localPort: 11434,
          process: 'ollama',
          pid: '101',
          isLoopback: true,
        },
        {
          proto: 'tcp',
          state: 'LISTEN',
          localAddress: '0.0.0.0',
          localPort: 22,
          process: 'sshd',
          pid: '1',
          isLoopback: false,
        },
      ],
    }));

    const quickFwdMock = vi.fn(async () => ({
      tunnelId: 'tun-1',
      ruleId: 'quick-1',
      localAddr: '127.0.0.1',
      localPort: 19434,
      targetHost: '127.0.0.1',
      targetPort: 11434,
      savedRule: false,
    }));

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          DiscoverRemoteSockets: discoverMock,
          QuickStartLocalForward: quickFwdMock,
        },
      },
    };

    const onClose = vi.fn();
    const onOpenApiUrl = vi.fn();

    render(
      <RemoteSocketsModal
        isOpen
        onClose={onClose}
        sshSessions={[{ id: 'ssh-1', label: 'kali@10.10.10.5' }]}
        defaultSessionId="ssh-1"
        activeEngagementId="eng-1"
        onOpenApiUrl={onOpenApiUrl}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Scan Listening Sockets/i }));

    await waitFor(() => {
      expect(discoverMock).toHaveBeenCalledWith('ssh-1');
      expect(screen.getByText('127.0.0.1:11434')).toBeInTheDocument();
      expect(screen.getByText('0.0.0.0:22')).toBeInTheDocument();
    });

    // Toggle loopback only filter
    fireEvent.click(screen.getByLabelText(/Loopback only/i));
    expect(screen.getByText('127.0.0.1:11434')).toBeInTheDocument();
    expect(screen.queryByText('0.0.0.0:22')).not.toBeInTheDocument();

    // Launch -L + Open in API Tester
    fireEvent.change(screen.getByLabelText('Local Port for 127.0.0.1:11434'), {
      target: { value: '19434' },
    });
    fireEvent.click(screen.getByRole('button', { name: /\+ API Tester/i }));

    await waitFor(() => {
      expect(quickFwdMock).toHaveBeenCalledWith(
        'ssh-1',
        '127.0.0.1',
        11434,
        19434,
        false,
        'eng-1',
        'ollama (127.0.0.1:11434)'
      );
      expect(onOpenApiUrl).toHaveBeenCalledWith('http://127.0.0.1:19434', 'ollama');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
