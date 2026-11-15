import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WinrmManagerModal } from './WinrmManagerModal';
import type { WinrmProfileSummary, WinrmSessionInfo } from '../types/winrm';

describe('WinrmManagerModal (F-41)', () => {
  const sampleProfile: WinrmProfileSummary = {
    id: 'winrm-dc01',
    engagementId: 'eng-1',
    name: 'DC01 Evil-WinRM',
    host: '10.10.20.10',
    port: 5986,
    useTls: true,
    insecureSkipVerify: true,
    authType: 'pth',
    domain: 'CORP',
    username: 'Administrator',
    hasPassword: false,
    hasNtHash: true,
    createdAt: '2026-11-15T20:00:00Z',
  };

  const sampleSession: WinrmSessionInfo = {
    sessionId: 'winrm-sess-1',
    profileId: 'winrm-dc01',
    name: 'DC01 Evil-WinRM',
    host: '10.10.20.10',
    port: 5986,
    useTls: true,
    authType: 'pth',
    domain: 'CORP',
    username: 'Administrator',
    shellId: 'SH-WINRM-99',
    currentDir: 'C:\\Users\\Administrator',
    status: 'connected',
    backendMode: 'native-wsman',
    connectedAt: '2026-11-15T20:01:00Z',
    commandCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads saved profiles, switches 5985/5986 on TLS toggle, and shows HTTP+Basic OPSEC alert', async () => {
    render(
      <WinrmManagerModal
        isOpen
        onClose={vi.fn()}
        activeEngagementId="eng-1"
        activeEngagementName="Corp Red Team"
        listProfiles={vi.fn().mockResolvedValue([sampleProfile])}
        saveProfile={vi.fn().mockResolvedValue(undefined)}
        deleteProfile={vi.fn().mockResolvedValue(undefined)}
        detectTools={vi.fn().mockResolvedValue([
          { tool: 'evil-winrm', found: false },
          { tool: 'pwsh', found: true, path: 'pwsh.exe' },
        ])}
        buildCliCommand={vi.fn().mockResolvedValue('evil-winrm -i 10.10.20.10 -P 5986 -S -u CORP\\Administrator -H <NT_HASH>')}
        connectSession={vi.fn().mockResolvedValue(sampleSession)}
        listActiveSessions={vi.fn().mockResolvedValue([])}
        executeCommand={vi.fn()}
        uploadFile={vi.fn()}
        downloadFile={vi.fn()}
        disconnectSession={vi.fn()}
        onSessionConnected={vi.fn()}
      />
    );

    expect(await screen.findByText('DC01 Evil-WinRM')).toBeTruthy();
    expect(screen.getByText('[SECRET STORED]')).toBeTruthy();
    expect(screen.getByText('pwsh: READY')).toBeTruthy();

    // Selecting Basic auth while HTTP 5985 is active raises critical OPSEC alert
    fireEvent.click(screen.getByText('Basic'));
    expect(screen.getByText(/CRITICAL OPSEC: Basic auth over HTTP/i)).toBeTruthy();

    // Toggling HTTPS flips port 5985 -> 5986 and clears HTTP warning
    const tlsCheckbox = screen.getByLabelText('Use HTTPS (TLS 5986)') as HTMLInputElement;
    fireEvent.click(tlsCheckbox);
    expect((screen.getByLabelText('WinRM Port') as HTMLInputElement).value).toBe('5986');
    expect(screen.queryByText(/CRITICAL OPSEC: Basic auth over HTTP/i)).toBeNull();
  });

  it('connects session, executes PowerShell, and transfers files with SHA-256 confirmation', async () => {
    const connectSession = vi.fn().mockResolvedValue(sampleSession);
    const listActiveSessions = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([sampleSession]);
    const executeCommand = vi.fn().mockResolvedValue({
      sessionId: 'winrm-sess-1',
      shellId: 'SH-WINRM-99',
      command: 'whoami /all',
      stdout: 'corp\\administrator\n',
      stderr: '',
      exitCode: 0,
      durationMs: 42,
    });
    const uploadFile = vi.fn().mockResolvedValue({
      sessionId: 'winrm-sess-1',
      direction: 'upload',
      localPath: 'C:\\tools\\linpeas.ps1',
      remotePath: 'C:\\Windows\\Temp\\lp.ps1',
      bytes: 2048,
      sha256: 'deadbeef1234',
      durationMs: 110,
    });
    const onSessionConnected = vi.fn();

    render(
      <WinrmManagerModal
        isOpen
        onClose={vi.fn()}
        listProfiles={vi.fn().mockResolvedValue([sampleProfile])}
        saveProfile={vi.fn().mockResolvedValue(undefined)}
        deleteProfile={vi.fn().mockResolvedValue(undefined)}
        detectTools={vi.fn().mockResolvedValue([])}
        buildCliCommand={vi.fn().mockResolvedValue('evil-winrm')}
        connectSession={connectSession}
        listActiveSessions={listActiveSessions}
        executeCommand={executeCommand}
        uploadFile={uploadFile}
        downloadFile={vi.fn()}
        disconnectSession={vi.fn()}
        onSessionConnected={onSessionConnected}
      />
    );

    await screen.findByText('DC01 Evil-WinRM');
    fireEvent.click(screen.getByTitle('Connect WinRM Shell'));

    await waitFor(() => expect(connectSession).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'winrm-dc01' })));
    expect(onSessionConnected).toHaveBeenCalledWith(sampleSession);

    await screen.findByText(/ShellId: SH-WINRM-99/i);

    fireEvent.click(screen.getByRole('button', { name: /Execute/i }));
    await waitFor(() => expect(executeCommand).toHaveBeenCalledWith('winrm-sess-1', 'whoami /all'));
    expect(await screen.findByText(/corp\\administrator/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Upload Local Path'), { target: { value: 'C:\\tools\\linpeas.ps1' } });
    fireEvent.change(screen.getByLabelText('Upload Remote Path'), { target: { value: 'C:\\Windows\\Temp\\lp.ps1' } });
    fireEvent.click(screen.getByRole('button', { name: /Upload File/i }));

    await waitFor(() =>
      expect(uploadFile).toHaveBeenCalledWith('winrm-sess-1', 'C:\\tools\\linpeas.ps1', 'C:\\Windows\\Temp\\lp.ps1')
    );
    expect(await screen.findByText('deadbeef1234')).toBeTruthy();
  });
});
