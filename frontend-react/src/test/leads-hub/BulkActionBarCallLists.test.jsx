import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActionBar } from '../../features/leads-hub/components/BulkActionBar';

const listCallLists = vi.fn(() => Promise.resolve({
  call_lists: [{ id: 'cl-1', name: 'Q3 Follow-ups', lead_count: 5 }],
}));
const createCallList = vi.fn((name) => Promise.resolve({ id: 'cl-new', name }));
const addLeads = vi.fn(() => Promise.resolve({ added: 2, already_present: 0 }));

vi.mock('../../services/api', () => ({
  SalesJourneyService: { list: vi.fn(() => Promise.resolve([])) },
  CallListsService: {
    list: (...args) => listCallLists(...args),
    create: (...args) => createCallList(...args),
    addLeads: (...args) => addLeads(...args),
  },
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
  listCallLists.mockClear();
  createCallList.mockClear();
  addLeads.mockClear();
});

describe('BulkActionBar — Add to Call List', () => {
  it('has no role gate, unlike Enroll in Cadence — visible even when canEnrollJourney is false', () => {
    render(<BulkActionBar list={makeListStub(['l1'])} onToast={vi.fn()} canDelete={false} canEnrollJourney={false} />);
    expect(screen.getByText('Add to Call List')).toBeInTheDocument();
  });

  it('lists existing Call Lists when opened, and bulk-adds the selected leads on pick', async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<BulkActionBar list={makeListStub(['l1', 'l2'])} onToast={onToast} canDelete={false} canEnrollJourney={false} />);

    await user.click(screen.getByText('Add to Call List'));
    await waitFor(() => expect(screen.getByText('Q3 Follow-ups')).toBeInTheDocument());

    await user.click(screen.getByText('Q3 Follow-ups'));
    await waitFor(() => expect(addLeads).toHaveBeenCalledWith('cl-1', ['l1', 'l2']));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining('Added 2')));
  });

  it('creates a new Call List inline and adds the selection to it', async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<BulkActionBar list={makeListStub(['l1'])} onToast={onToast} canDelete={false} canEnrollJourney={false} />);

    await user.click(screen.getByText('Add to Call List'));
    await waitFor(() => expect(screen.getByPlaceholderText('New list name…')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('New list name…'), 'Hot Leads');
    await user.click(screen.getByText('Create'));

    await waitFor(() => expect(createCallList).toHaveBeenCalledWith('Hot Leads'));
    await waitFor(() => expect(addLeads).toHaveBeenCalledWith('cl-new', ['l1']));
  });

  it('reports how many leads were already in the list, not just how many were added', async () => {
    addLeads.mockResolvedValueOnce({ added: 1, already_present: 1 });
    const user = userEvent.setup();
    const onToast = vi.fn();
    render(<BulkActionBar list={makeListStub(['l1', 'l2'])} onToast={onToast} canDelete={false} canEnrollJourney={false} />);

    await user.click(screen.getByText('Add to Call List'));
    await waitFor(() => expect(screen.getByText('Q3 Follow-ups')).toBeInTheDocument());
    await user.click(screen.getByText('Q3 Follow-ups'));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining('already in the list')));
  });
});
