import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '../../features/leads-hub/components/FilterBar';

const listCallLists = vi.fn(() => Promise.resolve({
  call_lists: [{ id: 'cl-1', name: 'Q3 Follow-ups', lead_count: 5 }],
}));
const createCallList = vi.fn((name) => Promise.resolve({ id: 'cl-new', name }));

vi.mock('../../services/api', () => ({
  CallListsService: {
    list: (...args) => listCallLists(...args),
    create: (...args) => createCallList(...args),
  },
}));

function makeListStub({ activeFilterKeys = [], total = 0, saveFilterAsCallList } = {}) {
  return {
    filters: { status: [], tag: [], source: '', company: '', assignedTo: '', outcome: '', uploadLogId: '', dateFrom: '', dateTo: '' },
    setFilter: vi.fn(),
    toggleMultiFilter: vi.fn(),
    clearFilter: vi.fn(),
    activeFilterKeys,
    addFilterKey: vi.fn(),
    removeFilterKey: vi.fn(),
    clearAllFilters: vi.fn(),
    searchInput: '',
    setSearchInput: vi.fn(),
    tags: [],
    sdrs: [],
    companies: [],
    uploadLogs: [],
    outcomes: [],
    isAdmin: true,
    total,
    saveFilterAsCallList: saveFilterAsCallList || vi.fn(() => Promise.resolve({ added: total, already_present: 0 })),
  };
}

beforeEach(() => {
  listCallLists.mockClear();
  createCallList.mockClear();
});

describe('FilterBar — Save current filter as a Call List', () => {
  it('is hidden when no filter is active — avoids an accidental whole-org snapshot', () => {
    render(<FilterBar list={makeListStub({ activeFilterKeys: [] })} onToast={vi.fn()} />);
    expect(screen.queryByText('Save as Call List')).not.toBeInTheDocument();
  });

  it('shows once a filter is active', () => {
    render(<FilterBar list={makeListStub({ activeFilterKeys: ['status'] })} onToast={vi.fn()} />);
    expect(screen.getByText('Save as Call List')).toBeInTheDocument();
  });

  it('confirms with the exact resolved count before saving, then calls saveFilterAsCallList', async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    const saveFilterAsCallList = vi.fn(() => Promise.resolve({ added: 42, already_present: 0 }));
    render(<FilterBar list={makeListStub({ activeFilterKeys: ['status'], total: 42, saveFilterAsCallList })} onToast={onToast} />);

    await user.click(screen.getByText('Save as Call List'));
    await waitFor(() => expect(screen.getByText('Q3 Follow-ups')).toBeInTheDocument());
    await user.click(screen.getByText('Q3 Follow-ups'));

    // Confirmation shows the exact count before anything is saved.
    expect(screen.getByText(/This will add 42 lead\(s\)/)).toBeInTheDocument();
    expect(saveFilterAsCallList).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add leads' }));
    await waitFor(() => expect(saveFilterAsCallList).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cl-1' })
    ));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringContaining('Added 42')));
  });

  it('can create a new Call List inline and save the filtered set into it', async () => {
    const user = userEvent.setup();
    const saveFilterAsCallList = vi.fn(() => Promise.resolve({ added: 7, already_present: 0 }));
    render(<FilterBar list={makeListStub({ activeFilterKeys: ['status'], total: 7, saveFilterAsCallList })} onToast={vi.fn()} />);

    await user.click(screen.getByText('Save as Call List'));
    await waitFor(() => expect(screen.getByPlaceholderText('New list name…')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('New list name…'), 'Cold Batch');
    await user.click(screen.getByText('Create'));

    await waitFor(() => expect(createCallList).toHaveBeenCalledWith('Cold Batch'));
    await user.click(screen.getByRole('button', { name: 'Add leads' }));
    await waitFor(() => expect(saveFilterAsCallList).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cl-new' })
    ));
  });
});
