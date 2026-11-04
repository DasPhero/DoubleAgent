import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('M0-0 Walking Skeleton UI', () => {
  it('renders the English-only application shell with locked vault status (F-03)', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'DoubleAgent' })).toBeInTheDocument();
    expect(screen.getByText('Vault Locked')).toBeInTheDocument();
    expect(screen.getByText(/Walking skeleton ready \(M0-0\)/i)).toBeInTheDocument();
  });
});

