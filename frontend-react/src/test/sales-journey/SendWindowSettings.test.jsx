import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SendWindowSettings } from '../../features/sales-journey/SendWindowSettings';

const updateSettings = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    updateSettings: (...args) => updateSettings(...args),
  },
}));

beforeEach(() => {
  updateSettings.mockClear();
});

describe('SendWindowSettings', () => {
  it('shows "Anytime" when nothing is configured', () => {
    render(<SendWindowSettings journeyId="j1" journey={{}} onSaved={() => {}} />);
    expect(screen.getByText('Anytime')).toBeInTheDocument();
  });

  it('shows a summary of an existing window', () => {
    render(<SendWindowSettings journeyId="j1" journey={{
      send_tz: 'UTC', send_window_start_hour: 9, send_window_end_hour: 18, send_days: '0,1,2,3,4',
    }} onSaved={() => {}} />);
    expect(screen.getByText('09:00–18:00, Mon/Tue/Wed/Thu/Fri')).toBeInTheDocument();
  });

  it('saves a new business-hours window', async () => {
    updateSettings.mockResolvedValue({
      send_tz: 'UTC', send_window_start_hour: 9, send_window_end_hour: 17, send_days: null,
    });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<SendWindowSettings journeyId="j1" journey={{}} onSaved={onSaved} />);

    await user.click(screen.getByText('Anytime'));
    await user.click(screen.getByLabelText('Restrict to business hours'));
    await user.click(screen.getByText('Save'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith('j1', {
      send_tz: 'UTC', send_window_start_hour: 9, send_window_end_hour: 18, send_days: null,
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('rejects an end hour before the start hour without calling the API', async () => {
    const user = userEvent.setup();
    render(<SendWindowSettings journeyId="j1" journey={{
      send_tz: 'UTC', send_window_start_hour: 9, send_window_end_hour: 18,
    }} onSaved={() => {}} />);

    await user.click(screen.getByText('09:00–18:00'));
    const selects = screen.getAllByRole('combobox');
    // Timezone is a custom listbox now (not a native <select>), so the only
    // comboboxes left are: selects[0] = start hour, selects[1] = end hour.
    await user.selectOptions(selects[1], '5');
    await user.click(screen.getByText('Save'));

    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('clears the window when both checkboxes are unchecked', async () => {
    updateSettings.mockResolvedValue({ send_tz: null, send_window_start_hour: null, send_window_end_hour: null, send_days: null });
    const user = userEvent.setup();
    render(<SendWindowSettings journeyId="j1" journey={{
      send_tz: 'UTC', send_window_start_hour: 9, send_window_end_hour: 18,
    }} onSaved={() => {}} />);

    await user.click(screen.getByText('09:00–18:00'));
    await user.click(screen.getByLabelText('Restrict to business hours'));
    await user.click(screen.getByText('Save'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith('j1', {
      send_tz: null, send_window_start_hour: null, send_window_end_hour: null, send_days: null,
    }));
  });
});

describe('SendWindowSettings — Timezone custom listbox', () => {
  // Replaced the native <select> — a native dropdown's OS-level popup
  // (checkmarks, hover highlight) isn't something page CSS can touch,
  // which is what made the 17-zone list look inconsistent with the rest
  // of this modal (reported 2026-08-13).

  it('opens the listbox, picks a zone, and closes it', async () => {
    const user = userEvent.setup();
    render(<SendWindowSettings journeyId="j1" journey={{
      send_tz: 'UTC', send_window_start_hour: 9, send_window_end_hour: 18,
    }} onSaved={() => {}} />);

    await user.click(screen.getByText('09:00–18:00'));
    await user.click(screen.getByRole('button', { name: /UTC/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Asia/Kolkata' }));
    expect(screen.getByRole('button', { name: /Asia\/Kolkata/ })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape closes only the listbox, not the whole modal', async () => {
    const user = userEvent.setup();
    render(<SendWindowSettings journeyId="j1" journey={{
      send_tz: 'UTC', send_window_start_hour: 9, send_window_end_hour: 18,
    }} onSaved={() => {}} />);

    await user.click(screen.getByText('09:00–18:00'));
    await user.click(screen.getByRole('button', { name: /UTC/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // The modal itself is still open — "Save" is still visible.
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('clicking outside the listbox closes it without changing the value', async () => {
    const user = userEvent.setup();
    render(<SendWindowSettings journeyId="j1" journey={{
      send_tz: 'UTC', send_window_start_hour: 9, send_window_end_hour: 18,
    }} onSaved={() => {}} />);

    await user.click(screen.getByText('09:00–18:00'));
    await user.click(screen.getByRole('button', { name: /UTC/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.click(screen.getByText('Send Window'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /UTC/ })).toBeInTheDocument();
  });

  it('is disabled until a window is being configured', async () => {
    const user = userEvent.setup();
    render(<SendWindowSettings journeyId="j1" journey={{}} onSaved={() => {}} />);

    await user.click(screen.getByText('Anytime'));
    const tzButton = screen.getByRole('button', { name: /UTC/ });
    expect(tzButton).toBeDisabled();

    await user.click(tzButton);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
