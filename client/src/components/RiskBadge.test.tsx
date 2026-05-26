import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskBadge } from './RiskBadge';

describe('RiskBadge', () => {
  it('renders "Not analyzed" when no level is set', () => {
    render(<RiskBadge level={null} />);
    expect(screen.getByText('Not analyzed')).toBeInTheDocument();
  });

  it('renders the level label with its severity styling', () => {
    render(<RiskBadge level="Critical" />);
    const badge = screen.getByText('Critical');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-red-50');
  });
});
