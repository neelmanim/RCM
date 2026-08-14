import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';

function Boom() {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(<ErrorBoundary><div>All good</div></ErrorBoundary>);
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders the default fallback instead of crashing the whole page when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('renders a custom fallback when provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary fallback={<div>Custom fallback</div>}><Boom /></ErrorBoundary>);
    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    spy.mockRestore();
  });
});
