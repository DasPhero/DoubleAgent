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
});
