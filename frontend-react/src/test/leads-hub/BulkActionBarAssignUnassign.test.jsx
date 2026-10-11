import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActionBar } from '../../features/leads-hub/components/BulkActionBar';

vi.mock('../../services/api', () => ({
  SalesJourneyService: { list: vi.fn(() => Promise.resolve([])) },
  CallListsService: { list: vi.fn(() => Promise.resolve({ call_lists: [] })) },
}));

function makeListStub(overrides = {}) {
  return {
    selected: new Set(['l1', 'l2']),
    total: 2,
    clearSelection: vi.fn(),
    sdrs: [{ id: 'sdr-1', name: 'Jane Doe', active_leads: 1, max_active: 5 }],
    bulkAssign: vi.fn(() => Promise.resolve({ message: 'Assigned 2 lead(s).' })),
    bulkUnassign: vi.fn(() => Promise.resolve({ message: 'Unassigned 2 lead(s).' })),
    bulkDelete: vi.fn(),
    selectAllMatching: vi.fn(),
    selectingAllMatching: false,
    ...overrides,
  };
}

// Bug report (2026-09-22): clicking "Unassign" on a large selection gave no
// visible feedback for the duration of the request — button stayed enabled
// and unchanged, easy to double-click. Same gap existed on "Assign".
describe('BulkActionBar — Assign/Unassign busy state', () => {
  it('disables Unassign and shows progress text while the request is in flight, then a completion toast', async () => {
    let resolveUnassign;
    const bulkUnassign = vi.fn(() => new Promise((resolve) => { resolveUnassign = resolve; }));
    const onToast = vi.fn();
    const user = userEvent.setup();
    render(<BulkActionBar list={makeListStub({ bulkUnassign })} onToast={onToast} canDelete={false} canEnrollJourney={false} />);

    const unassignBtn = screen.getByRole('button', { name: 'Unassign' });
    await user.click(unassignBtn);

    expect(await screen.findByRole('button', { name: 'Unassigning…' })).toBeDisabled();

    resolveUnassign({ message: 'Unassigned 2 lead(s).' });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Unassigned 2 lead(s).'));
    expect(await screen.findByRole('button', { name: 'Unassign' })).toBeEnabled();
  });

  it('disables Assign and shows progress text while the request is in flight', async () => {
    let resolveAssign;
    const bulkAssign = vi.fn(() => new Promise((resolve) => { resolveAssign = resolve; }));
    const onToast = vi.fn();
    const user = userEvent.setup();
    render(<BulkActionBar list={makeListStub({ bulkAssign })} onToast={onToast} canDelete={false} canEnrollJourney={false} />);

    await user.click(screen.getByRole('button', { name: 'Assign to' }));
    await user.click(await screen.findByText(/Jane Doe/));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByRole('button', { name: 'Assigning…' })).toBeDisabled();

    resolveAssign({ message: 'Assigned 2 lead(s).' });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Assigned 2 lead(s).'));
  });
});
