import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../components/ui/Badge';

describe('Badge', () => {
  it('resolves a real call-outcome string to its corrected variant', () => {
    render(<Badge>Call Back Later</Badge>);
    expect(screen.getByText('Call Back Later')).toHaveClass('bg-amber-100', 'text-amber-700');
  });

  it('falls back to default for a call-outcome string that no longer exists', () => {
    render(<Badge>Callback Requested</Badge>);
    expect(screen.getByText('Callback Requested')).toHaveClass('bg-slate-100', 'text-slate-600');
  });
});
