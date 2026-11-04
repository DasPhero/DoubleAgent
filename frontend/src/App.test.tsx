import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('M0 & M1-1 Application Shell, Dark-Red Locked vs Teal Unlocked Theme, and Hosts/Groups (F-01, F-03)', () => {
  it('starts in theme-locked (Dark Crimson), switches to theme-unlocked (Teal) on unlock, and manages Groups and Hosts with inheritance (F-01)', () => {
    render(<App />);
    const main = screen.getByLabelText('DoubleAgent Workspace');
    expect(main).toHaveClass('theme-locked');
    expect(screen.getByText('Vault Locked')).toBeInTheDocument();

    // Open initial vault setup modal and initialize passwordless
    fireEvent.click(screen.getByRole('button', { name: /Set Up Vault/i }));
    fireEvent.click(screen.getByRole('button', { name: /Skip Password for Now/i }));

    // Theme must switch to unlocked (Teal)
    expect(main).toHaveClass('theme-unlocked');
    expect(screen.getByText('Vault Unlocked (No PW)')).toBeInTheDocument();

    // Create a Group with Port 2222 and Username deploy (F-01)
    fireEvent.click(screen.getByRole('button', { name: /\+ Group/i }));
    fireEvent.change(screen.getByLabelText('Group Name'), { target: { value: 'Production' } });
    fireEvent.change(screen.getByLabelText('Default Group Port'), { target: { value: '2222' } });
    fireEvent.change(screen.getByLabelText('Default Group Username'), {
      target: { value: 'deploy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Group/i }));

    expect(screen.getByText(/Production/)).toBeInTheDocument();

    // Create a Host in that group inheriting Port 2222 and Username deploy (F-01)
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'Bastion 01' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), {
      target: { value: '10.10.0.5' },
    });
    const groupSelect = screen.getByLabelText('Host Group') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: groupSelect.options[1].value } });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    expect(screen.getByText('Bastion 01')).toBeInTheDocument();
    expect(screen.getByText('deploy@10.10.0.5:2222')).toBeInTheDocument();
  });

  it('opens Command Palette via Ctrl+K, performs fuzzy search over Name/Address/Tags, and supports user@host:port Quick Connect (F-02)', () => {
    render(<App />);

    // Unlock vault first
    fireEvent.click(screen.getByRole('button', { name: /Set Up Vault/i }));
    fireEvent.click(screen.getByRole('button', { name: /Skip Password for Now/i }));

    // Add a host with tags
    fireEvent.click(screen.getByRole('button', { name: /\+ Host/i }));
    fireEvent.change(screen.getByLabelText('Host Label'), { target: { value: 'prod-web-01' } });
    fireEvent.change(screen.getByLabelText('Host IP or Hostname'), {
      target: { value: '10.99.1.50' },
    });
    fireEvent.change(screen.getByLabelText('Host Tags'), {
      target: { value: 'nginx, frontend' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Host/i }));

    // Press Ctrl+K to open Command Palette (F-02)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument();

    const paletteInput = screen.getByLabelText('Command Palette Input');

    // Fuzzy search by subsequence in Name ("pw01" -> "prod-web-01")
    fireEvent.change(paletteInput, { target: { value: 'pw01' } });
    expect(screen.getByText('#nginx')).toBeInTheDocument();

    // Search by Tag ("frontend")
    fireEvent.change(paletteInput, { target: { value: 'frontend' } });
    expect(screen.getByText('#frontend')).toBeInTheDocument();

    // Type user@host:port Quick Connect target
    fireEvent.change(paletteInput, { target: { value: 'admin@192.168.50.10:2222' } });
    const qcButton = screen.getByRole('button', {
      name: /Quick Connect admin@192.168.50.10:2222/i,
    });
    expect(qcButton).toBeInTheDocument();

    // Trigger Quick Connect
    fireEvent.click(qcButton);
    expect(screen.queryByRole('dialog', { name: 'Command Palette' })).not.toBeInTheDocument();
    expect((screen.getByLabelText('Host Address') as HTMLInputElement).value).toBe('192.168.50.10');
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('2222');
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('admin');
  });
});
