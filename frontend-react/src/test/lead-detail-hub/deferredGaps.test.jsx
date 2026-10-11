import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelatedOpportunity } from '../../features/lead-detail-hub/rail/RelatedOpportunity';
import { LeadSummary } from '../../features/lead-detail-hub/components/LeadSummary';
import { QuickActions } from '../../features/lead-detail-hub/rail/QuickActions';

// RCA 2026-09-29: four Lead Detail Hub gaps vs the legacy page.

describe('RelatedOpportunity — Won/Lost notes + change outcome', () => {
  it('sends the typed notes with the outcome', async () => {
    const onSetOutcome = vi.fn();
    render(<RelatedOpportunity opportunities={[{ name: 'Acme Opportunity' }]} canSetOutcome onSetOutcome={onSetOutcome} />);
    await userEvent.type(screen.getByLabelText('Outcome notes'), '  $12k ARR  ');
    await userEvent.click(screen.getByText('Won'));
    expect(onSetOutcome).toHaveBeenCalledWith('Won', '$12k ARR');
  });

  it('lets an admin change an outcome that is already set', async () => {
    const onSetOutcome = vi.fn();
    render(<RelatedOpportunity opportunities={[{ name: 'Acme', status: 'Won' }]} canSetOutcome onSetOutcome={onSetOutcome} />);
    expect(screen.queryByText('Lost')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/Change outcome/));
    await userEvent.click(screen.getByText('Lost'));
    expect(onSetOutcome).toHaveBeenCalledWith('Lost', '');
  });
});

describe('LeadSummary — call attempts label', () => {
  it('says the count is across all reps', () => {
    render(<LeadSummary lead={{ id: 'l1', call_attempt_count: 7, max_call_attempts: 5 }} />);
    expect(screen.getByText('Call attempts (all reps)')).toBeInTheDocument();
    expect(screen.getByText('7 / 5')).toBeInTheDocument();
  });
});

describe('LeadSummary — every cadence enrollment with its reason', () => {
  it('shows all enrollments, exit reasons and pending detail', () => {
    render(<LeadSummary lead={{ id: 'l1' }} journey={[
      { enrollment_id: 'e1', journey_name: 'Q4 Outreach', status: 'active', current_node_label: 'Email 2',
        pending_status: { reason: 'cooldown_blocked' } },
      { enrollment_id: 'e2', journey_name: 'Old Cadence', status: 'exited_early', exited_reason: 'exceeded_max_node_passes' },
    ]} />);
    expect(screen.getByText('Q4 Outreach')).toBeInTheDocument();
    expect(screen.getByText('Old Cadence')).toBeInTheDocument();
    expect(screen.getByText('Current step: Email 2')).toBeInTheDocument();
    expect(screen.getByText(/another cadence recently contacted this lead/)).toBeInTheDocument();
    expect(screen.getByText(/Exceeded max steps — likely a loop/)).toBeInTheDocument();
    expect(screen.getByText('Exited')).toBeInTheDocument();
  });

  it('a failed step shows the actual error, not just "Send failed"', () => {
    render(<LeadSummary lead={{ id: 'l1' }} journey={[
      { enrollment_id: 'e3', journey_name: 'Demo', status: 'failed', exited_reason: 'send_failed',
        last_error: 'No connected mailbox for neelmani@x.com' },
    ]} />);
    expect(screen.getByText('Reason: Send failed')).toBeInTheDocument();
    expect(screen.getByText('No connected mailbox for neelmani@x.com')).toBeVisible();
  });
});

describe('LeadSummary — v13.7.0 cadence card', () => {
  it('says plainly when the cadence is waiting for the rep’s approval', () => {
    render(<LeadSummary lead={{ id: 'l1' }} journey={[
      { enrollment_id: 'e1', journey_name: 'Demo', status: 'active', current_node_label: 'Email',
        pending_status: { reason: 'awaiting_email_approval' } },
    ]} />);
    expect(screen.getByText('Waiting for approval — email draft is in My Tasks')).toBeInTheDocument();
    expect(screen.queryByText(/scheduled time/)).not.toBeInTheDocument();
  });

  it('removing asks in the app, not with a browser popup', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<LeadSummary lead={{ id: 'l1' }} journey={[
      { enrollment_id: 'e1', journey_name: 'Demo', status: 'active', current_node_label: 'Email' },
    ]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove from cadence' }));
    expect(screen.getByText('Remove from cadence?')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('QuickActions — Change Stage picker', () => {
  const open = async () => userEvent.click(screen.getByRole('button', { name: 'Change lead stage' }));
  const options = () => screen.getAllByRole('menuitem').map((m) => m.textContent);

  it('offers an SDR only same-stage or next-stage forward moves', async () => {
    render(<QuickActions canModify currentStatus="Calling" canSkipStages={false} />);
    await open();
    const opts = options();
    expect(opts).toContain('Meeting Scheduled');
    expect(opts).not.toContain('Demo Done');     // would skip a stage
    expect(opts).not.toContain('Research');      // backward
    expect(opts).not.toContain('Disqualified');  // has its own reason flow
  });

  it('offers an admin any stage except Disqualified', async () => {
    render(<QuickActions canModify currentStatus="Calling" canSkipStages />);
    await open();
    const opts = options();
    expect(opts).toContain('Demo Done');
    expect(opts).toContain('Research');
    expect(opts).not.toContain('Disqualified');
  });
});
