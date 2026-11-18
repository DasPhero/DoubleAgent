import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ApiTesterView } from './ApiTesterView';

describe('ApiTesterView — API Tester, Repeater, Diff, Replay & AI Chat Mode (F-42)', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { go?: unknown }).go;
  });

  it('executes HTTP repeater requests, decodes JWT in inspector, saves evidence, and runs throttled replay', async () => {
    const execMock = vi.fn(async () => ({
      requestId: 'req-1',
      statusCode: 200,
      status: '200 OK',
      proto: 'HTTP/1.1',
      headers: { 'Content-Type': ['application/json'] },
      rawHeaders: 'Content-Type: application/json',
      body: '{"ok":true,"role":"admin"}',
      sizeBytes: 26,
      routeUsed: 'SSH -D Tunnel (127.0.0.1:1080)',
      timing: { dialMs: 4, tlsMs: 12, ttfbMs: 18, totalMs: 22 },
      tls: {
        version: 'TLS 1.3',
        cipherSuite: 'TLS_AES_128_GCM_SHA256',
        subject: 'CN=api.internal',
        issuer: 'CN=Internal CA',
        dnsNames: ['api.internal'],
        notAfter: '2027-01-01T00:00:00Z',
        verified: false,
      },
    }));
    const inspectMock = vi.fn(async () => ({
      input: 'eyJ.eyJ.sig',
      format: 'jwt',
      decoded: '// HEADER\n{\n  "alg": "HS256"\n}\n\n// CLAIMS\n{\n  "sub": "tester"\n}',
      jwtAlg: 'HS256',
      jwtExpired: false,
    }));
    const replayMock = vi.fn(async () => ({
      executionId: 'rep-1',
      total: 2,
      completed: 2,
      lockoutWarning: 'Engagement lockout guard (F-40): 2 payloads reaches threshold 2.',
      results: [
        { index: 0, payload: '1', statusCode: 403, status: '403 Forbidden', sizeBytes: 9, totalMs: 10 },
        { index: 1, payload: '42', statusCode: 200, status: '200 OK', sizeBytes: 120, totalMs: 14 },
      ],
    }));
    const saveEvidenceMock = vi.fn(async () => {});

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          ListApiRequests: vi.fn(async () => []),
          ListApiEnvironments: vi.fn(async () => []),
          ListApiRoutes: vi.fn(async () => [
            { id: '', label: 'Direct (No Proxy)', kind: 'direct', active: true },
            { id: 'tunnel:tun-1', label: 'SSH -D Tunnel (127.0.0.1:1080)', kind: 'tunnel-socks5', active: true },
          ]),
          ListCredentials: vi.fn(async () => []),
          ExecuteApiRequest: execMock,
          InspectApiPayload: inspectMock,
          ExecuteApiParameterReplay: replayMock,
        },
      },
    };

    render(
      <ApiTesterView
        activeEngagementId="eng-1"
        activeEngagementName="Acme Internal"
        identities={[]}
        onSaveToEvidence={saveEvidenceMock}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Outbound Route or Pivot')).toHaveTextContent(/SSH -D Tunnel/i);
    });

    fireEvent.change(screen.getByLabelText('Request URL'), {
      target: { value: 'https://api.internal/v1/whoami' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(execMock).toHaveBeenCalled();
      expect(screen.getByText(/"role": "admin"/i)).toBeInTheDocument();
    });

    // Save Evidence capture
    fireEvent.click(screen.getByRole('button', { name: /Save Evidence/i }));
    await waitFor(() => {
      expect(saveEvidenceMock).toHaveBeenCalledTimes(1);
    });

    // Inspector JWT decode
    fireEvent.click(screen.getByRole('button', { name: /^inspector$/i }));
    fireEvent.change(screen.getByLabelText('Inspector Input'), { target: { value: 'eyJ.eyJ.sig' } });
    fireEvent.click(screen.getByRole('button', { name: /Decode \/ Inspect/i }));
    await waitFor(() => {
      expect(screen.getByText(/JWT alg=HS256/i)).toBeInTheDocument();
    });

    // Parameter Replay mode
    fireEvent.click(screen.getByRole('tab', { name: /Param Replay/i }));
    fireEvent.change(screen.getByLabelText('Replay Payloads'), { target: { value: '1\n42' } });
    fireEvent.click(screen.getByRole('button', { name: /Run Throttled Replay/i }));
    await waitFor(() => {
      expect(replayMock).toHaveBeenCalled();
      expect(screen.getByText(/2 payloads reaches threshold 2/i)).toBeInTheDocument();
      expect(screen.getByText('403 Forbidden')).toBeInTheDocument();
    });
  });

  it('imports cURL and supports streaming AI Chat Mode with Open in HTTP Repeater', async () => {
    const parseCurlMock = vi.fn(async () => ({
      id: '',
      name: 'POST /login',
      method: 'POST',
      url: 'https://target.local/login',
      auth: { type: 'none' },
      bodyType: 'json',
      body: '{"u":"admin"}',
      followRedirects: true,
      useCookieJar: true,
    }));

    const aiChatMock = vi.fn(async () => ({
      streamId: 's-1',
      reply: 'Analysis complete: **endpoint exposed**.',
      model: 'llama3.1',
      rawRequestJson: '{\n  "model": "llama3.1"\n}',
      statusCode: 200,
      durationMs: 42,
    }));

    (window as unknown as { go: unknown }).go = {
      main: {
        App: {
          ListApiRequests: vi.fn(async () => []),
          ListApiEnvironments: vi.fn(async () => []),
          ListApiRoutes: vi.fn(async () => [{ id: '', label: 'Direct (No Proxy)', kind: 'direct', active: true }]),
          ListCredentials: vi.fn(async () => []),
          ParseApiCurl: parseCurlMock,
          ExecuteApiAiChat: aiChatMock,
        },
      },
    };

    render(
      <ApiTesterView
        activeEngagementId="eng-1"
        activeEngagementName="Acme"
        identities={[]}
      />
    );

    // cURL import
    fireEvent.click(screen.getByRole('button', { name: /Import cURL \/ OpenAPI/i }));
    fireEvent.change(screen.getByLabelText('Import Content'), {
      target: { value: "curl -X POST https://target.local/login -d '{\"u\":\"admin\"}'" },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Import$/i }));
    await waitFor(() => {
      expect(parseCurlMock).toHaveBeenCalled();
      expect((screen.getByLabelText('Request URL') as HTMLInputElement).value).toBe('https://target.local/login');
    });

    // AI Chat Mode
    fireEvent.click(screen.getByRole('tab', { name: /AI Chat Mode/i }));
    fireEvent.change(screen.getByLabelText('AI Prompt Input'), {
      target: { value: 'Check system prompt exposure' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send Prompt/i }));

    await waitFor(() => {
      expect(aiChatMock).toHaveBeenCalled();
      expect(screen.getByText(/Analysis complete:/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Open in HTTP Repeater/i }));
    expect(screen.getByRole('tab', { name: /HTTP Repeater/i })).toHaveAttribute('aria-selected', 'true');

    // Verify F-42 hex binary body mode is selectable
    fireEvent.click(screen.getByRole('button', { name: /^body$/i }));
    const bodyTypeSelect = screen.getByLabelText('Body Type') as HTMLSelectElement;
    fireEvent.change(bodyTypeSelect, { target: { value: 'hex' } });
    expect(bodyTypeSelect.value).toBe('hex');
    expect(screen.getByText(/Exact binary bytes sent/i)).toBeInTheDocument();
  });
});
