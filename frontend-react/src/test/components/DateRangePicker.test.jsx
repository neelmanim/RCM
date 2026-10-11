import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateRangePicker } from '../../components/ui/DateRangePicker';

describe('DateRangePicker limits', () => {
  it('days after maxDate cannot be picked, earlier ones can', async () => {
    render(<DateRangePicker from="2026-10-02" to="2026-10-05" onChange={() => {}} maxDate={new Date(2026, 9, 8)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Date range' }));
    expect(await screen.findByRole('button', { name: /October 8th, 2026/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /October 9th, 2026/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /October 20th, 2026/ })).toBeDisabled();
  });
  it('without a limit every day is open', async () => {
    render(<DateRangePicker from="2026-10-02" to="2026-10-05" onChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Date range' }));
    expect(await screen.findByRole('button', { name: /October 20th, 2026/ })).toBeEnabled();
  });
});
