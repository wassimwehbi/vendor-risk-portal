import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusChip, ValidationChip } from './StatusChip';

describe('StatusChip', () => {
  it('shows the human label for a status', () => {
    render(<StatusChip status="analyzed" />);
    expect(screen.getByText('Analyzed')).toBeInTheDocument();
  });
});

describe('ValidationChip', () => {
  it('renders the approved (validated) state', () => {
    render(<ValidationChip status="approved" />);
    expect(screen.getByText(/Validated/)).toBeInTheDocument();
  });

  it('renders the pending state', () => {
    render(<ValidationChip status="pending" />);
    expect(screen.getByText(/Pending validation/)).toBeInTheDocument();
  });
});
