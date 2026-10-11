import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CadenceRulesSettings } from '../../features/sales-journey/CadenceRulesSettings';

const updateSettings = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: { updateSettings: (...args) => updateSettings(...args) },
}));

const JOURNEY = { id: 'j1', stop_on_reply: false, stop_on_meeting: false, send_as: null, vertical: null };

beforeEach(() => updateSettings.mockReset());

describe('CadenceRulesSettings — vertical', () => {
  it('saves a vertical tag, trimmed', async () => {
    updateSettings.mockResolvedValue({ ...JOURNEY, vertical: 'Sales/BD' });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<CadenceRulesSettings journeyId="j1" journey={JOURNEY} onSaved={onSaved} />);

    await user.click(screen.getByText('Rules'));
    await user.type(screen.getByLabelText('Vertical'), '  Sales/BD  ');
    await user.click(screen.getByText('Save'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith('j1', expect.objectContaining({ vertical: 'Sales/BD' })));
    expect(onSaved).toHaveBeenCalled();
  });

  it('loads an existing vertical into the field when reopened', async () => {
    const user = userEvent.setup();
    render(<CadenceRulesSettings journeyId="j1" journey={{ ...JOURNEY, vertical: 'Patient Ops' }} onSaved={vi.fn()} />);
    await user.click(screen.getByText('Rules'));
    expect(screen.getByLabelText('Vertical')).toHaveValue('Patient Ops');
  });
});

describe('CadenceRulesSettings — re-enrollment', () => {
  it('a legacy cadence (flag missing) shows re-enrollment as allowed', async () => {
    const user = userEvent.setup();
    render(<CadenceRulesSettings journeyId="j1" journey={JOURNEY} onSaved={vi.fn()} />);
    await user.click(screen.getByText('Rules'));
    expect(screen.getByLabelText('Allow re-enrollment')).toBeChecked();
  });

  it('turning it off saves allow_reenroll false and clears the wait', async () => {
    updateSettings.mockResolvedValue({ ...JOURNEY, allow_reenroll: false });
    const user = userEvent.setup();
    render(<CadenceRulesSettings journeyId="j1" journey={{ ...JOURNEY, allow_reenroll: true, reenroll_cooloff_days: 14 }} onSaved={vi.fn()} />);
    await user.click(screen.getByText('Rules'));
    await user.click(screen.getByLabelText('Allow re-enrollment'));
    await user.click(screen.getByText('Save'));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith('j1',
      expect.objectContaining({ allow_reenroll: false, reenroll_cooloff_days: null })));
  });

  it('allowed with a wait saves the number of days', async () => {
    updateSettings.mockResolvedValue(JOURNEY);
    const user = userEvent.setup();
    render(<CadenceRulesSettings journeyId="j1" journey={{ ...JOURNEY, allow_reenroll: true, reenroll_cooloff_days: 14 }} onSaved={vi.fn()} />);
    await user.click(screen.getByText('Rules'));
    expect(screen.getByLabelText('Re-enrollment wait days')).toHaveValue(14);
    await user.click(screen.getByText('Save'));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith('j1',
      expect.objectContaining({ allow_reenroll: true, reenroll_cooloff_days: 14 })));
  });
});
