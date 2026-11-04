import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('M0 Application Shell, Quick Connect, and Vault Lock UI', () => {
  it('renders locked vault status on startup, opens the Unlock Vault dialog (F-03), and shows SSH quick-connect controls (F-01, F-07)', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'DoubleAgent' })).toBeInTheDocument();
    expect(screen.getByText('Vault Locked')).toBeInTheDocument();
    expect(screen.getByLabelText('Host Address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect SSH/i })).toBeInTheDocument();

    const unlockBtn = screen.getByRole('button', { name: /Unlock Vault/i });
    fireEvent.click(unlockBtn);
    expect(screen.getByRole('dialog', { name: /Unlock Vault/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Master Password')).toBeInTheDocument();
  });
});
