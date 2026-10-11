import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactCard } from '../../features/lead-detail-hub/components/ContactCard';
import { LeadsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  LeadsService: { updateLead: vi.fn().mockResolvedValue({}) },
}));

const LEAD = {
  id: 'lead-1',
  phone: '+14155551234',
  phone_secondary: '+14155555678',
  company_phone: '+442071234567',
  email: 'lead@example.com',
  company: 'Acme',
  title: 'VP Sales',
};

describe('ContactCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows Company Phone — previously missing entirely (RCA 2026-09-28)', () => {
    render(<ContactCard lead={LEAD} canModify={true} onCall={vi.fn()} />);
    expect(screen.getByText('+442071234567')).toBeInTheDocument();
  });

  it('offers a Call button for all three phone fields when canModify', () => {
    const onCall = vi.fn();
    render(<ContactCard lead={LEAD} canModify={true} onCall={onCall} />);
    const callButtons = screen.getAllByText('Call');
    expect(callButtons).toHaveLength(3);
  });

  it('calling the Call button for company phone passes the right number', async () => {
    const onCall = vi.fn();
    render(<ContactCard lead={LEAD} canModify={true} onCall={onCall} />);
    const callButtons = screen.getAllByText('Call');
    await userEvent.click(callButtons[2]); // phone, phone_secondary, company_phone in that order
    expect(onCall).toHaveBeenCalledWith('+442071234567');
  });

  it('lets an already-populated phone number be re-edited (RCA 2026-09-28: pencil only showed when empty)', async () => {
    render(<ContactCard lead={LEAD} canModify={true} onCall={vi.fn()} />);
    const phoneRow = screen.getByText('+14155551234').closest('span').parentElement;
    const pencil = phoneRow.querySelector('button');
    await userEvent.click(pencil);

    const input = screen.getByDisplayValue('+14155551234');
    await userEvent.clear(input);
    await userEvent.type(input, '+19998887777{Enter}');

    expect(LeadsService.updateLead).toHaveBeenCalledWith('lead-1', { phone: '+19998887777' });
  });

  it('flags the phone with a Wrong number badge only when phone_invalid_at is set', () => {
    const { rerender } = render(<ContactCard lead={LEAD} canModify={true} onCall={vi.fn()} />);
    expect(screen.queryByText('Wrong number')).not.toBeInTheDocument();
    rerender(<ContactCard lead={{ ...LEAD, phone_invalid_at: '2026-10-07 09:00:00+00:00' }} canModify={true} onCall={vi.fn()} />);
    expect(screen.getByText('Wrong number')).toBeInTheDocument();
  });

  it('a non-modifying viewer sees no Call button', () => {
    render(<ContactCard lead={LEAD} canModify={false} onCall={vi.fn()} />);
    expect(screen.queryByText('Call')).not.toBeInTheDocument();
  });
});
