import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastHost } from '../../components/ui/Toast';

function fireToast(detail) {
  window.dispatchEvent(new CustomEvent('alternate:toast', { detail }));
}

// v11.5.8: NavHub now mounts ToastHost globally so vanilla-JS code (app.js)
// can trigger a React toast via this event, instead of the legacy inline-
// styled showToast() utility — this is the cross-boundary contract that
// wiring depends on, so it's worth its own test independent of any one
// feature that happens to dispatch the event.
describe('ToastHost', () => {
  it('renders a toast from a alternate:toast CustomEvent', () => {
    render(<ToastHost />);
    act(() => fireToast({ message: "Showing Vikram Joshi's leads", type: 'info' }));
    expect(screen.getByText("Showing Vikram Joshi's leads")).toBeInTheDocument();
  });

  it('ignores an event with no message', () => {
    render(<ToastHost />);
    act(() => fireToast({ type: 'info' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('defaults to the error theme when no type is given, same as legacy showToast()', () => {
    render(<ToastHost />);
    act(() => fireToast({ message: 'Something broke' }));
    expect(screen.getByText('Something broke').closest('[role="status"]')).toHaveClass('bg-red-50');
  });

  it('auto-dismisses after the given duration', () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => fireToast({ message: 'Bye soon', type: 'info', duration: 1000 }));
    expect(screen.getByText('Bye soon')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText('Bye soon')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('supports multiple simultaneous toasts', () => {
    render(<ToastHost />);
    act(() => { fireToast({ message: 'First', type: 'info' }); fireToast({ message: 'Second', type: 'success' }); });
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});
