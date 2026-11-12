import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ShellStabilizeModal, ShellStabilizeRequest } from './ShellStabilizeModal';

describe('F-34 Shell Stabilization & PTY Upgrade', () => {
  it('defaults to direct mode for Raw TCP reverse shells and submits python3 PTY upgrade', async () => {
    let submittedReq: ShellStabilizeRequest | undefined;
    const onStabilize = vi.fn().mockImplementation(async (req: ShellStabilizeRequest) => {
      submittedReq = req;
    });
    const onClose = vi.fn();

    render(
      <ShellStabilizeModal
        isOpen={true}
        sessionId="rawtcp-1"
        sessionTitle="RevShell :4444"
        isRawTcp={true}
        initialCols={140}
        initialRows={42}
        onStabilize={onStabilize}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('dialog', { name: /Shell Stabilization & PTY Upgrade \(F-34\)/i })).toBeInTheDocument();
    expect(screen.getByText(/140×42/)).toBeInTheDocument();

    const modeSelect = screen.getByLabelText(/Session Topology Mode/i) as HTMLSelectElement;
    expect(modeSelect.value).toBe('direct');

    // Preview shows python3 pty spawn and stty rows 42 cols 140
    expect(screen.getByText(/python3 -c 'import pty; pty\.spawn\("\/bin\/bash"\)'/)).toBeInTheDocument();
    expect(screen.getByText(/stty rows 42 cols 140/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Stabilize Shell Now/i }));

    await waitFor(() => {
      expect(onStabilize).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalled();
    });

    expect(submittedReq).toEqual({
      sessionId: 'rawtcp-1',
      method: 'python3',
      mode: 'direct',
      shellPath: '/bin/bash',
      term: 'xterm-256color',
      cols: 140,
      rows: 42,
      lhost: '10.10.14.1',
      lport: 4444,
    });
  });

  it('defaults to nested_nc mode for SSH sessions and previews Ctrl+Z + stty raw -echo; fg', async () => {
    const onStabilize = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <ShellStabilizeModal
        isOpen={true}
        sessionId="ssh-kali-1"
        sessionTitle="kali@10.10.10.5"
        isRawTcp={false}
        initialCols={120}
        initialRows={32}
        onStabilize={onStabilize}
        onClose={onClose}
      />
    );

    const modeSelect = screen.getByLabelText(/Session Topology Mode/i) as HTMLSelectElement;
    expect(modeSelect.value).toBe('nested_nc');
    expect(screen.getByText('stty raw -echo; fg')).toBeInTheDocument();

    // Switch to Windows ConPtyShell
    const methodSelect = screen.getByLabelText(/PTY Spawn Method/i) as HTMLSelectElement;
    fireEvent.change(methodSelect, { target: { value: 'conptyshell' } });

    expect(screen.getByText(/Invoke-ConPtyShell 10\.10\.14\.1 4444 -Rows 32 -Cols 120/)).toBeInTheDocument();
  });
});
