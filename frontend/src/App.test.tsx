import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('M0-0 & S1 Application Shell and Quick Connect UI', () => {
  it('renders the English-only application shell with locked vault status (F-03) and SSH quick-connect controls (S1, F-01, F-07)', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'DoubleAgent' })).toBeInTheDocument();
    expect(screen.getByText('Vault Locked')).toBeInTheDocument();
    expect(screen.getByLabelText('Host Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Port')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect SSH/i })).toBeInTheDocument();
  });
});
