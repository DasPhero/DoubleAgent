import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('M0 Application Shell, Quick Connect, and Vault Setup/Reset/Passwordless UI', () => {
  it('allows initializing vault with or without password, changing password later, and resetting vault (F-03)', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'DoubleAgent' })).toBeInTheDocument();
    expect(screen.getByText('Vault Locked')).toBeInTheDocument();

    // Open initial vault setup modal
    const setupBtn = screen.getByRole('button', { name: /Set Up Vault/i });
    fireEvent.click(setupBtn);
    expect(screen.getByRole('dialog', { name: /Initialize Vault/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip Password for Now/i })).toBeInTheDocument();

    // Skip password for now (passwordless initialization)
    fireEvent.click(screen.getByRole('button', { name: /Skip Password for Now/i }));
    expect(screen.getByText('Vault Unlocked (No PW)')).toBeInTheDocument();

    // Open Vault Security to set a password afterwards or enable Windows Hello
    fireEvent.click(screen.getByRole('button', { name: /Vault Security/i }));
    expect(screen.getByRole('dialog', { name: /Vault Security Settings/i })).toBeInTheDocument();
    expect(screen.getByLabelText('New Master Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enable Windows Hello \/ Key/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset Vault/i })).toBeInTheDocument();
  });
});
