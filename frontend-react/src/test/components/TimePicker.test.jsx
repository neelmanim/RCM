import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimePicker } from '../../components/ui/TimePicker';

// Drop-in replacement for a native <input type="time"> — value/onChange stay
// 'HH:MM' (24h, zero-padded) strings so every call site swaps with no
// re-parsing.

describe('TimePicker', () => {
  // Each half's trigger accessible name is the static "Send time — hour"/
  // "— minute" label (Select's own aria-label convention), not the current
  // value — assert the live value via visible textContent instead.
  it('shows the current hour and minute on their respective triggers', () => {
    render(<TimePicker value="09:05" onChange={vi.fn()} ariaLabel="Send time" />);
    expect(screen.getByRole('button', { name: 'Send time — hour' })).toHaveTextContent('09');
    expect(screen.getByRole('button', { name: 'Send time — minute' })).toHaveTextContent('05');
  });

  it('changing the hour keeps the existing minute', async () => {
    const onChange = vi.fn();
    render(<TimePicker value="09:05" onChange={onChange} ariaLabel="Send time" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send time — hour' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '14' }));
    expect(onChange).toHaveBeenCalledWith('14:05');
  });

  it('changing the minute keeps the existing hour', async () => {
    const onChange = vi.fn();
    render(<TimePicker value="09:05" onChange={onChange} ariaLabel="Send time" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send time — minute' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '30' }));
    expect(onChange).toHaveBeenCalledWith('09:30');
  });

  it('defaults to 00:00 when given no value', () => {
    render(<TimePicker value="" onChange={vi.fn()} ariaLabel="Send time" />);
    expect(screen.getByRole('button', { name: 'Send time — hour' })).toHaveTextContent('00');
    expect(screen.getByRole('button', { name: 'Send time — minute' })).toHaveTextContent('00');
  });
});
