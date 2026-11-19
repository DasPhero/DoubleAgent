import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecContextControl } from './ExecContextControl';
import { RemoteDirPickerModal } from './RemoteDirPickerModal';

describe('ExecContextControl (F-46)', () => {
  it('shows Exec: Local by default and allows attaching to an active SSH session', () => {
    const attachMock = vi.fn();
    render(
      <ExecContextControl
        context={{ mode: 'local', attachedAgents: [] }}
        sshSessions={[{ sessionId: 'ssh-1', label: 'kali@192.168.1.50' }]}
        busySessionId={null}
        onAttachAgent={attachMock}
        onSelectContext={vi.fn()}
        onDetachAgent={vi.fn()}
        onOpenRemoteShell={vi.fn()}
        onBrowseRemoteDirs={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Execution Context' });
    expect(trigger).toHaveTextContent('Exec: Local');

    fireEvent.click(trigger);
    const attachBtn = screen.getByRole('menuitem', { name: /Attach Agent → kali@192\.168\.1\.50/i });
    fireEvent.click(attachBtn);
    expect(attachMock).toHaveBeenCalledWith('ssh-1', 'kali@192.168.1.50');
  });

  it('displays active remote agent badge, remote actions, and supports switching/detaching', () => {
    const selectMock = vi.fn();
    const detachMock = vi.fn();
    const shellMock = vi.fn();
    const browseMock = vi.fn();

    render(
      <ExecContextControl
        context={{
          mode: 'agent',
          activeSessionId: 'ssh-1',
          activeAgent: {
            sessionId: 'ssh-1',
            label: 'kali@192.168.1.50',
            hostname: 'kali',
            os: 'linux',
            arch: 'amd64',
            homeDir: '/home/kali',
            defaultShell: '/usr/bin/zsh',
            stagingDir: '/home/kali/.doubleagent/staging',
            primaryIp: '10.10.14.8',
            connectedAt: '2026-11-19T14:00:00Z',
            active: true,
          },
          attachedAgents: [
            {
              sessionId: 'ssh-1',
              label: 'kali@192.168.1.50',
              hostname: 'kali',
              os: 'linux',
              arch: 'amd64',
              homeDir: '/home/kali',
              defaultShell: '/usr/bin/zsh',
              stagingDir: '/home/kali/.doubleagent/staging',
              primaryIp: '10.10.14.8',
              connectedAt: '2026-11-19T14:00:00Z',
              active: true,
            },
          ],
        }}
        sshSessions={[{ sessionId: 'ssh-1', label: 'kali@192.168.1.50' }]}
        busySessionId={null}
        onAttachAgent={vi.fn()}
        onSelectContext={selectMock}
        onDetachAgent={detachMock}
        onOpenRemoteShell={shellMock}
        onBrowseRemoteDirs={browseMock}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Execution Context' });
    expect(trigger).toHaveTextContent('Agent: kali (10.10.14.8)');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Open Remote Shell/i }));
    expect(shellMock).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Browse Remote Directories/i }));
    expect(browseMock).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Local Workstation/i }));
    expect(selectMock).toHaveBeenCalledWith('');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Detach kali' }));
    expect(detachMock).toHaveBeenCalledWith('ssh-1');
  });

  it('RemoteDirPickerModal navigates directories without resetting on parent re-renders (F-46)', async () => {
    const listDir = vi.fn(async (dirPath: string) => {
      if (dirPath === '/home/ares') {
        return {
          path: '/home/ares',
          parent: '/home',
          entries: [
            { name: 'Desktop', relPath: 'Desktop', fullPath: '/home/ares/Desktop', size: 0, isDir: true, modTime: '' },
          ],
        };
      }
      return {
        path: '/home/ares/Desktop',
        parent: '/home/ares',
        entries: [],
      };
    });

    const { rerender } = render(
      <RemoteDirPickerModal
        isOpen={true}
        agentLabel="ares"
        initialPath="/home/ares"
        onListDir={listDir}
        onMkdir={vi.fn(async () => {})}
        onSelectDir={vi.fn()}
        onOpenShellInDir={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Desktop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Desktop'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('/home/ares/Desktop')).toBeInTheDocument();
    });

    // Simulate parent re-render passing a brand-new inline onListDir closure
    rerender(
      <RemoteDirPickerModal
        isOpen={true}
        agentLabel="ares"
        initialPath="/home/ares"
        onListDir={async (p) => listDir(p)}
        onMkdir={vi.fn(async () => {})}
        onSelectDir={vi.fn()}
        onOpenShellInDir={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue('/home/ares/Desktop')).toBeInTheDocument();
    expect(listDir).toHaveBeenCalledTimes(2);
  });
});
