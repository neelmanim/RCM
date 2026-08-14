import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentCallCard } from '../../features/power-dialer-hub/components/CurrentCallCard';
import { DialerService, LeadsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  DialerService: { getStatus: vi.fn() },
  LeadsService: { addNote: vi.fn() },
}));

const lead = { id: 'l1', first_name: 'Jane', last_name: 'Doe', company: 'Acme', phone: '+919876543210', status: 'Lead Assigned' };

describe('CurrentCallCard', () => {
  beforeEach(() => {
    window._openCallModal = vi.fn();
    DialerService.getStatus.mockResolvedValue({ active: false, provider: 'none' });
    LeadsService.addNote.mockResolvedValue({});
  });

  it('shows "Call" (not "Call Next") before an outcome is resolved, and dials via the global call flow', async () => {
    const user = userEvent.setup();
    render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.getByRole('button', { name: /log manually/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Call Next/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /log manually/ }));
    expect(window._openCallModal).toHaveBeenCalledWith('l1', 'Jane Doe', '+919876543210', lead);
  });

  it('labels the button by active dialer provider — Aircall, RCM, or a manual-log fallback', async () => {
    DialerService.getStatus.mockResolvedValue({ active: true, provider: 'aircall', has_credentials: true });
    render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Call via Aircall/ })).toBeInTheDocument());
  });

  it('swaps to "Call Next" once the current lead\'s outcome is resolved, and never dials on that click', async () => {
    const user = userEvent.setup();
    const onCallNext = vi.fn();
    render(<CurrentCallCard lead={lead} callNextEnabled={true} onCallNext={onCallNext} onSkip={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /log manually/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Call Next/ }));

    expect(onCallNext).toHaveBeenCalledTimes(1);
    expect(window._openCallModal).not.toHaveBeenCalled(); // advancing must never itself place a call
  });

  it('disables Call when the lead has no phone number on file', () => {
    render(<CurrentCallCard lead={{ ...lead, phone: null }} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole('button', { name: /log manually/ })).toBeDisabled();
    expect(screen.getByText(/No phone number on file/)).toBeInTheDocument();
  });

  it('Skip is always enabled, regardless of callNextEnabled', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={onSkip} />);

    const skipBtn = screen.getByRole('button', { name: /Skip/ });
    expect(skipBtn).not.toBeDisabled();
    await user.click(skipBtn);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('skip-with-reason select fires onSkip with the chosen reason, without needing the main button', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={onSkip} />);

    await user.selectOptions(screen.getByLabelText('Skip with a reason'), 'Wrong number');
    expect(onSkip).toHaveBeenCalledWith('Wrong number');
  });

  it('renders nothing when there is no current lead', () => {
    const { container } = render(<CurrentCallCard lead={null} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('"C" key dials when waiting, and advances via Call Next once resolved', async () => {
    const user = userEvent.setup();
    const onCallNext = vi.fn();
    const { rerender } = render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={onCallNext} onSkip={vi.fn()} />);
    await user.keyboard('c');
    expect(window._openCallModal).toHaveBeenCalledWith('l1', 'Jane Doe', '+919876543210', lead);

    rerender(<CurrentCallCard lead={lead} callNextEnabled={true} onCallNext={onCallNext} onSkip={vi.fn()} />);
    await user.keyboard('c');
    expect(onCallNext).toHaveBeenCalledTimes(1);
  });

  it('"S" key skips, but not while focus is inside the skip-reason select', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={onSkip} />);

    await user.keyboard('s');
    expect(onSkip).toHaveBeenCalledTimes(1);

    onSkip.mockClear();
    screen.getByLabelText('Skip with a reason').focus();
    await user.keyboard('s');
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('docks the shared #call-log-modal inline while mounted, and restores it on unmount', () => {
    const modal = document.createElement('div');
    modal.id = 'call-log-modal';
    document.body.appendChild(modal);
    const marker = document.createElement('span'); // proves the modal returns to its EXACT original spot
    document.body.appendChild(marker);

    const { unmount } = render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
    expect(modal.classList.contains('power-dialer-docked')).toBe(true);
    expect(modal.closest('[data-tour="call-dock"]')).not.toBeNull();

    unmount();
    expect(modal.classList.contains('power-dialer-docked')).toBe(false);
    expect(modal.nextSibling).toBe(marker);

    document.body.removeChild(modal);
    document.body.removeChild(marker);
  });

  describe('lead-context strip', () => {
    it('shows whichever of location/employees/source exist, and skips the rest', () => {
      render(<CurrentCallCard
        lead={{ ...lead, city: 'San Francisco', state: 'CA', employee_count: 512, lead_source: 'salesforce' }}
        callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()}
      />);
      expect(screen.getByText('San Francisco, CA')).toBeInTheDocument();
      expect(screen.getByText('512 employees')).toBeInTheDocument();
      expect(screen.getByText('Salesforce')).toBeInTheDocument();
    });

    it('prefers the bucketed research_company_size over the raw headcount', () => {
      render(<CurrentCallCard
        lead={{ ...lead, employee_count: 512, research_company_size: '500-1000' }}
        callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()}
      />);
      expect(screen.getByText('500-1000')).toBeInTheDocument();
      expect(screen.queryByText('512 employees')).not.toBeInTheDocument();
    });

    it('maps raw lead_source values to a display label instead of printing them as-is', () => {
      render(<CurrentCallCard
        lead={{ ...lead, lead_source: 'upload:march_leads.csv:1699999999' }}
        callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()}
      />);
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
      expect(screen.queryByText(/march_leads\.csv/)).not.toBeInTheDocument();
    });

    it('renders nothing for the strip when none of location/employees/source are set', () => {
      render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
      expect(screen.queryByText('•')).not.toBeInTheDocument();
    });

    it('always shows Last contact / Last outcome, falling back to "—"', () => {
      render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
      expect(screen.getByText(/Last contact: —/)).toBeInTheDocument();
      expect(screen.getByText(/Last outcome: —/)).toBeInTheDocument();
    });
  });

  describe('Add Note', () => {
    it('opens the composer, saves via LeadsService, and closes on success', async () => {
      const user = userEvent.setup();
      render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /Add Note/ }));
      const textarea = screen.getByPlaceholderText('Add a note…');
      await user.type(textarea, 'Called, asked to follow up next week');
      await user.click(screen.getByRole('button', { name: /Save Note/ }));

      await waitFor(() => expect(LeadsService.addNote).toHaveBeenCalledWith('l1', 'Called, asked to follow up next week'));
      await waitFor(() => expect(screen.queryByPlaceholderText('Add a note…')).not.toBeInTheDocument());
    });

    it('shows an error and keeps the draft if saving fails', async () => {
      LeadsService.addNote.mockRejectedValue(new Error('network'));
      const user = userEvent.setup();
      render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /Add Note/ }));
      await user.type(screen.getByPlaceholderText('Add a note…'), 'draft text');
      await user.click(screen.getByRole('button', { name: /Save Note/ }));

      await waitFor(() => expect(screen.getByText(/Failed to save note/)).toBeInTheDocument());
      expect(screen.getByPlaceholderText('Add a note…')).toHaveValue('draft text'); // not lost
    });

    it('disables Save for an empty/whitespace-only note', async () => {
      const user = userEvent.setup();
      render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /Add Note/ }));
      expect(screen.getByRole('button', { name: /Save Note/ })).toBeDisabled();
      await user.type(screen.getByPlaceholderText('Add a note…'), '   ');
      expect(screen.getByRole('button', { name: /Save Note/ })).toBeDisabled();
    });

    it('resets the composer when the current lead changes', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /Add Note/ }));
      await user.type(screen.getByPlaceholderText('Add a note…'), 'unsaved draft');

      rerender(<CurrentCallCard lead={{ ...lead, id: 'l2' }} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
      expect(screen.queryByPlaceholderText('Add a note…')).not.toBeInTheDocument();
    });
  });

  it('"View in CRM" calls onLeadClick with the lead id, and is hidden without one', async () => {
    const user = userEvent.setup();
    const onLeadClick = vi.fn();
    const { rerender } = render(
      <CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} onLeadClick={onLeadClick} />
    );
    await user.click(screen.getByRole('button', { name: /View in CRM/ }));
    expect(onLeadClick).toHaveBeenCalledWith('l1');

    rerender(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /View in CRM/ })).not.toBeInTheDocument();
  });

  it('"N" opens the note composer, "O" calls onLeadClick — both ignored while a field has focus', async () => {
    const user = userEvent.setup();
    const onLeadClick = vi.fn();
    render(<CurrentCallCard lead={lead} callNextEnabled={false} onCallNext={vi.fn()} onSkip={vi.fn()} onLeadClick={onLeadClick} />);

    await user.keyboard('o');
    expect(onLeadClick).toHaveBeenCalledWith('l1');

    await user.keyboard('n');
    expect(screen.getByPlaceholderText('Add a note…')).toBeInTheDocument();

    onLeadClick.mockClear();
    await user.type(screen.getByPlaceholderText('Add a note…'), 'o'); // typing "o" inside the note must not navigate away
    expect(onLeadClick).not.toHaveBeenCalled();
  });
});
