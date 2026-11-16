import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouteHealthModal } from './RouteHealthModal';
import type { RouteHealthReport } from '../types/routeHealth';

describe('RouteHealthModal (F-38)', () => {
  const passiveReport: RouteHealthReport = {
    reportId: 'rhc-1',
    checkedAt: '2026-11-15T20:00:00Z',
    checkMode: 'local_only',
    throttleMs: 400,
    timeoutMs: 1500,
    totalRoutes: 2,
    healthyRoutes: 1,
    degradedRoutes: 1,
    downRoutes: 0,
    probesExecuted: 2,
    probesSucceeded: 2,
    durationMs: 25,
    opsecWarnings: [
      'Passive local inspection mode: zero probe packets sent to remote targets.',
    ],
    entries: [
      {
        id: 'rt-ligolo',
        sourceType: 'pivot',
        name: 'AD Corp Ligolo Pivot',
        kind: 'ligolo-ng',
        bindEndpoint: '127.0.0.1:11601',
        subnets: ['10.10.20.0/24'],
        status: 'healthy',
        runtimeState: 'running',
        ligoloAgents: ['Agent joined: CORP\\WEB01'],
        lastCheck: '2026-11-15T20:00:00Z',
        probes: [
          {
            target: '127.0.0.1:11601',
            status: 'healthy',
            reachable: true,
            latencyMs: 2,
            detail: 'Pivot listener active (TCP connect OK (2ms))',
            checkedAt: '2026-11-15T20:00:00Z',
          },
        ],
      },
      {
        id: 'rt-wait',
        sourceType: 'pivot',
        name: 'DMZ Standby Proxy',
        kind: 'ligolo-ng',
        bindEndpoint: '127.0.0.1:11602',
        status: 'degraded',
        runtimeState: 'running',
        lastCheck: '2026-11-15T20:00:00Z',
      },
    ],
  };

  const throttledReport: RouteHealthReport = {
    ...passiveReport,
    reportId: 'rhc-2',
    checkMode: 'throttled_tcp',
    socksProxyAddr: '127.0.0.1:1080',
    totalRoutes: 1,
    healthyRoutes: 1,
    degradedRoutes: 0,
    probesExecuted: 2,
    probesSucceeded: 1,
    entries: [
      {
        id: 'custom-probes',
        sourceType: 'custom',
        name: 'Custom Target Reachability Probes',
        kind: 'socks5-tcp',
        bindEndpoint: 'socks5://127.0.0.1:1080',
        status: 'degraded',
        runtimeState: 'active',
        lastCheck: '2026-11-15T20:01:00Z',
        probes: [
          {
            target: '10.10.20.10:445',
            viaProxy: 'socks5://127.0.0.1:1080',
            status: 'healthy',
            reachable: true,
            latencyMs: 14,
            detail: 'SOCKS5 CONNECT OK (14ms)',
            checkedAt: '2026-11-15T20:01:00Z',
          },
          {
            target: '10.10.20.10:3389',
            viaProxy: 'socks5://127.0.0.1:1080',
            status: 'refused',
            reachable: false,
            latencyMs: 8,
            detail: 'SOCKS5 reply error code 0x05 (connection refused)',
            checkedAt: '2026-11-15T20:01:00Z',
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs passive inspection on demand and renders Ligolo session diagnostics without auto-polling (F-38)', async () => {
    const runHealthCheck = vi.fn().mockResolvedValue(passiveReport);

    render(
      <RouteHealthModal
        onClose={vi.fn()}
        activeEngagementId="eng-1"
        activeEngagementName="Acme Corp"
        socksCandidates={[{ label: 'SSH -D Jump', addr: '127.0.0.1:1080' }]}
        runHealthCheck={runHealthCheck}
      />
    );

    // Must not auto-run on mount (OPSEC requirement: never background-scan)
    expect(runHealthCheck).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Run Health Check/i }));

    await waitFor(() => {
      expect(runHealthCheck).toHaveBeenCalledTimes(1);
    });

    expect(runHealthCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        checkMode: 'local_only',
        engagementId: 'eng-1',
      })
    );

    expect(screen.getByText('AD Corp Ligolo Pivot')).toBeInTheDocument();
    expect(screen.getByText('Agent joined: CORP\\WEB01')).toBeInTheDocument();
    expect(screen.getByText('DMZ Standby Proxy')).toBeInTheDocument();
  });

  it('enforces explicit confirmation for throttled TCP target probes and displays SOCKS5 results (F-38)', async () => {
    const runHealthCheck = vi.fn().mockResolvedValue(throttledReport);

    render(
      <RouteHealthModal
        onClose={vi.fn()}
        socksCandidates={[{ label: 'Chisel SOCKS5', addr: '127.0.0.1:1080' }]}
        runHealthCheck={runHealthCheck}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Throttled TCP Connect/i }));

    const targetBox = screen.getByLabelText('Target Probe Endpoints');
    fireEvent.change(targetBox, { target: { value: '10.10.20.10:445\n10.10.20.10:3389' } });

    // Trigger without checking confirmation -> blocked client-side before dialing
    fireEvent.click(screen.getByRole('button', { name: /Run Health Check/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Confirm on-demand active target probes/i);
    expect(runHealthCheck).not.toHaveBeenCalled();

    // Confirm and run throttled probes
    fireEvent.click(screen.getByRole('checkbox', { name: /Authorize on-demand throttled probe traffic/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run Health Check/i }));

    await waitFor(() => {
      expect(runHealthCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          checkMode: 'throttled_tcp',
          socksProxyAddr: '127.0.0.1:1080',
          customTargets: ['10.10.20.10:445', '10.10.20.10:3389'],
          confirmActiveTraffic: true,
        })
      );
    });

    expect(screen.getByText('10.10.20.10:445')).toBeInTheDocument();
    expect(screen.getByText('SOCKS5 CONNECT OK (14ms)')).toBeInTheDocument();
    expect(screen.getByText('10.10.20.10:3389')).toBeInTheDocument();
  });

  it('displays live Shell Listeners and File Servers in the unified Ops Dashboard with Stop action without auto-probing', async () => {
    const runHealthCheck = vi.fn().mockResolvedValue(passiveReport);
    const onStopEndpoint = vi.fn().mockResolvedValue(undefined);

    render(
      <RouteHealthModal
        onClose={vi.fn()}
        runHealthCheck={runHealthCheck}
        onStopEndpoint={onStopEndpoint}
        activeDashboardItems={[
          {
            id: 'lst-4444',
            sourceType: 'shell-listener',
            name: 'Reverse Shell :4444',
            kind: 'rawtcp (reverse)',
            endpoint: '0.0.0.0:4444',
            status: 'listening',
            metaSummary: 'Catches: 1',
          },
          {
            id: 'srv-8000',
            sourceType: 'transfer-server',
            name: 'HTTP Staging :8000',
            kind: 'builtin',
            endpoint: '0.0.0.0:8000',
            status: 'running',
            metaSummary: 'Served: 3 · Uploads: 0',
          },
        ]}
      />
    );

    expect(runHealthCheck).not.toHaveBeenCalled();
    expect(screen.getByText('Reverse Shell :4444')).toBeInTheDocument();
    expect(screen.getByText('HTTP Staging :8000')).toBeInTheDocument();

    const stopButtons = screen.getAllByRole('button', { name: 'Stop' });
    fireEvent.click(stopButtons[0]);
    await waitFor(() => expect(onStopEndpoint).toHaveBeenCalledWith('shell-listener', 'lst-4444'));
  });
});
