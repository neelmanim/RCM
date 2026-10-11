import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '../../features/leads-hub/components/FilterBar';

vi.mock('../../services/api', () => ({ CallListsService: { list: vi.fn(), create: vi.fn() } }));

const stub = (over = {}) => ({
  filters: { status: [], tag: [], source: '', company: '', assignedTo: '', outcome: '', uploadLogId: '', dateFrom: '', dateTo: '' },
  setFilter: vi.fn(), toggleMultiFilter: vi.fn(), clearFilter: vi.fn(), activeFilterKeys: ['tag'], addFilterKey: vi.fn(),
  removeFilterKey: vi.fn(), clearAllFilters: vi.fn(), searchInput: '', setSearchInput: vi.fn(), tags: [], refreshTags: vi.fn(),
  sdrs: [], companies: [], uploadLogs: [], outcomes: [], isAdmin: false, total: 0, saveFilterAsCallList: vi.fn(), ...over,
});

describe('FilterBar — Tag filter', () => {
  it('says "No tags yet." instead of an empty box when there are no tags', async () => {
    render(<FilterBar list={stub()} onToast={vi.fn()} />);
    await userEvent.click(screen.getByText('Tag'));
    expect(await screen.findByText('No tags yet.')).toBeInTheDocument();
  });

  it('re-fetches tags when the filter opens, so a tag created after page load shows up', async () => {
    const refreshTags = vi.fn();
    render(<FilterBar list={stub({ refreshTags })} onToast={vi.fn()} />);
    expect(refreshTags).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Tag'));
    await waitFor(() => expect(refreshTags).toHaveBeenCalled());
  });

  it('lists tags and toggles one (works for a non-admin)', async () => {
    const toggleMultiFilter = vi.fn();
    render(<FilterBar list={stub({ tags: [{ id: 't1', name: 'India Healthcare Distribution Sep 2026' }], toggleMultiFilter })} onToast={vi.fn()} />);
    await userEvent.click(screen.getByText('Tag'));
    await userEvent.click(await screen.findByText('India Healthcare Distribution Sep 2026'));
    expect(toggleMultiFilter).toHaveBeenCalledWith('tag', 'India Healthcare Distribution Sep 2026');
  });
});
