import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '../../components/ui/DatePicker';

// Drop-in replacement for a native <input type="date"> — value/onChange stay
// 'yyyy-mm-dd' strings so every call site swaps with no re-parsing.

describe('DatePicker', () => {
  it('shows a placeholder when no value is set, and picks a date on click', async () => {
    const onChange = vi.fn();
    render(<DatePicker value="" onChange={onChange} placeholder="Due date" ariaLabel="Due date" />);

    expect(screen.getByRole('button', { name: 'Due date' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Due date' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /10th,/ }).length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByRole('button', { name: /10th,/ })[0]);

    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/-10$/));
  });

  it('shows the formatted current value on the trigger', () => {
    render(<DatePicker value="2026-09-15" onChange={vi.fn()} ariaLabel="Due date" />);
    expect(screen.getByRole('button', { name: 'Due date' })).toHaveTextContent('Sep 15, 2026');
  });

  it('disables dates outside min/max', async () => {
    render(<DatePicker value="" onChange={vi.fn()} ariaLabel="Select date" min="2026-09-01" max="2026-09-05" />);
    await userEvent.click(screen.getByRole('button', { name: 'Select date' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /10th,/ }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('button', { name: /10th,/ })[0]).toBeDisabled();
  });
});
