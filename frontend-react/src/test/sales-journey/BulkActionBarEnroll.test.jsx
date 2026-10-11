import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActionBar } from '../../features/leads-hub/components/BulkActionBar';

const list = vi.fn(() => Promise.resolve([{ id: 'j1', name: 'Onboarding', status: 'active' }]));
const enroll = vi.fn(() => Promise.resolve({ enrolled: 2, requested: 2, skipped: [] }));
const checkEnrollmentMailboxes = vi.fn(() => Promise.resolve({ warnings: [] }));

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    list: (...args) => list(...args),
    enroll: (...args) => enroll(...args),
    checkEnrollmentMailboxes: (...args) => checkEnrollmentMailboxes(...args),
  },
  CallListsService: { list: vi.fn().mockResolvedValue({ call_lists: [] }) },
}));

function makeListStub(selectedIds) {
  return {
    selected: new Set(selectedIds),
    total: selectedIds.length,
    clearSelection: vi.fn(),
    sdrs: [],
    bulkAssign: vi.fn(),
    bulkUnassign: vi.fn(),
    bulkDelete: vi.fn(),
    selectAllMatching: vi.fn(),
    selectingAllMatching: false,
  };
}

beforeEach(() => {
  list.mockClear();
  enroll.mockClear();
  checkEnrollmentMailboxes.mockClear();
  checkEnrollmentMailboxes.mockResolvedValue({ warnings: [] });
});

describe('BulkActionBar — Enroll in Cadence', () => {
  it('lists active journeys when opened, and enrolls the selected leads on confirm', async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<BulkActionBar list={makeListStub(['l1', 'l2'])} onToast={onToast} canDelete={false} canEnrollJourney />);

    await user.click(screen.getByText('Enroll in Cadence'));
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());

    await user.click(screen.getByText('Onboarding'));
    expect(screen.getByText('Enroll 2 lead(s) into "Onboarding"?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Enroll' }));

    await waitFor(() => expect(enroll).toHaveBeenCalledWith('j1', ['l1', 'l2']));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining('Enrolled 2/2')));
  });

  it('blocks enrolling more than 200 leads with a clear message instead of calling the API', async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    const manyIds = Array.from({ length: 201 }, (_, i) => `l${i}`);
    render(<BulkActionBar list={makeListStub(manyIds)} onToast={onToast} canDelete={false} canEnrollJourney />);

    await user.click(screen.getByText('Enroll in Cadence'));
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());
    await user.click(screen.getByText('Onboarding'));

    expect(enroll).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('up to 200'));
  });

  it('warns, non-blockingly, when a lead\'s sender has a broken mailbox', async () => {
    checkEnrollmentMailboxes.mockResolvedValue({
      warnings: [{ lead_id: 'l1', sender_name: 'Ansh', mailbox_status: 'error', falls_back_to: null }],
    });
    const user = userEvent.setup();
    render(<BulkActionBar list={makeListStub(['l1', 'l2'])} onToast={vi.fn()} canDelete={false} canEnrollJourney />);

    await user.click(screen.getByText('Enroll in Cadence'));
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());
    await user.click(screen.getByText('Onboarding'));

    await waitFor(() => expect(checkEnrollmentMailboxes).toHaveBeenCalledWith('j1', ['l1', 'l2']));
    expect(await screen.findByText(/Ansh's mailbox isn't connected/)).toBeInTheDocument();
    // Still enrollable — the warning doesn't block the confirm button.
    await user.click(screen.getByRole('button', { name: 'Enroll' }));
    await waitFor(() => expect(enroll).toHaveBeenCalled());
  });

  it('hides "Enroll in Cadence" entirely when canEnrollJourney is false (below Pod Admin)', () => {
    render(<BulkActionBar list={makeListStub(['l1'])} onToast={vi.fn()} canDelete={false} canEnrollJourney={false} />);
    expect(screen.queryByText('Enroll in Cadence')).not.toBeInTheDocument();
  });
});

describe('BulkActionBar — Enroll in Cadence, re-enrollment blocked', () => {
  it('a single blocked lead toasts the reason from the server, not a generic "already in"', async () => {
    enroll.mockResolvedValueOnce({ enrolled: 0, requested: 1, skipped: [
      { lead_id: 'l1', reason: 'reenrollment_not_allowed', detail: 'this lead already went through this cadence on 01 Oct 2026, and re-enrollment is off for it' },
    ] });
    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<BulkActionBar list={makeListStub(['l1'])} onToast={onToast} canDelete={false} canEnrollJourney />);
    await user.click(screen.getByText('Enroll in Cadence'));
    await user.click(await screen.findByText('Onboarding'));
    await user.click(screen.getByRole('button', { name: 'Enroll' }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining('re-enrollment is off for it')));
  });
});
