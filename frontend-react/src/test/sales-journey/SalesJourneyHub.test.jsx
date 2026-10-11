import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesJourneyHub } from '../../features/sales-journey/SalesJourneyHub';
import { useJourneyStore } from '../../features/sales-journey/store/useJourneyStore';
import { SalesJourneyService } from '../../services/api';

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    list: vi.fn(() => Promise.resolve([
      { id: 'j1', name: 'Onboarding', status: 'draft', owner_id: 'u1' },
      { id: 'j2', name: 'Re-engagement', status: 'active', owner_id: 'u1' },
    ])),
    get: vi.fn((id) => Promise.resolve({
      id, name: id === 'j1' ? 'Onboarding' : 'Re-engagement', version_id: 'v1',
      graph_definition: { nodes: [], edges: [] }, updated_at: '2026-08-01T00:00:00Z',
    })),
    create: vi.fn(() => Promise.resolve({ id: 'j3', name: 'New Journey', draft_version_id: 'v3' })),
    saveDraft: vi.fn(() => Promise.resolve({ version_id: 'v1', saved_at: '2026-08-01T01:00:00Z' })),
    updateSettings: vi.fn(() => Promise.resolve({ id: 'j1', pod_id: null })),
    getStats: vi.fn(() => Promise.resolve({ active: 0, completed: 0, failed: 0, exited_early: 0, paused: 0 })),
    getStatsBulk: vi.fn(() => Promise.resolve({ journeys: {} })),
  },
  PodsService: {
    getAll: vi.fn(() => Promise.resolve([])),
  },
}));

beforeEach(() => {
  useJourneyStore.setState({
    journeyId: null, versionId: null, lastSavedAt: null,
    nodes: [], edges: [], selectedNodeId: null, dirty: false,
  });
});

describe('SalesJourneyHub', () => {
  it('lists existing journeys', async () => {
    render(<SalesJourneyHub />);
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());
    expect(screen.getByText('Re-engagement')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('opens the builder when a journey is clicked, loading its graph', async () => {
    const user = userEvent.setup();
    render(<SalesJourneyHub />);
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());

    await user.click(screen.getByText('Onboarding'));

    await waitFor(() => expect(screen.getByRole('button', { name: /Trigger/ })).toBeInTheDocument()); // toolbar button
    expect(useJourneyStore.getState().journeyId).toBe('j1');
    expect(useJourneyStore.getState().versionId).toBe('v1');
  });

  it('opens straight into the builder when given an openJourneyId (deep link)', async () => {
    render(<SalesJourneyHub openJourneyId="j2" />);
    await waitFor(() => expect(useJourneyStore.getState().journeyId).toBe('j2'));
    expect(screen.getByRole('button', { name: /Trigger/ })).toBeInTheDocument();
    expect(screen.queryByText('Onboarding')).not.toBeInTheDocument(); // list never shown
  });

  it('going back from the builder returns to the list', async () => {
    const user = userEvent.setup();
    render(<SalesJourneyHub />);
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());
    await user.click(screen.getByText('Onboarding'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Trigger/ })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '' })); // back arrow (no accessible name set)
    await waitFor(() => expect(screen.getByText('New Cadence')).toBeInTheDocument());
  });

  it('creating a new journey opens it directly in the builder', async () => {
    const user = userEvent.setup();
    render(<SalesJourneyHub />);
    await waitFor(() => expect(screen.getByText('New Cadence')).toBeInTheDocument());

    await user.click(screen.getByText('New Cadence'));
    await user.type(screen.getByLabelText('Cadence name'), 'My New Sequence');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(useJourneyStore.getState().journeyId).toBe('j3'));
  });

  it('a rep opening a cadence they own gets the full editable builder — ownership, not role, decides', async () => {
    const user = userEvent.setup();
    SalesJourneyService.get.mockResolvedValueOnce({
      id: 'j1', name: 'Onboarding', version_id: 'v1', graph_definition: { nodes: [], edges: [] },
      updated_at: '2026-08-01T00:00:00Z', can_edit: true, is_mine: true, owner_name: 'Me',
    });
    render(<SalesJourneyHub isAdmin={false} />);
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());
    expect(screen.getByText('New Cadence')).toBeInTheDocument();

    await user.click(screen.getByText('Onboarding'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Trigger$/ })).toBeInTheDocument());
    expect(screen.queryByText(/^Read-only/)).not.toBeInTheDocument();
  });

  it("opens someone else's cadence read-only, naming its owner", async () => {
    const user = userEvent.setup();
    SalesJourneyService.get.mockResolvedValueOnce({
      id: 'j1', name: 'Onboarding', version_id: 'v1', graph_definition: { nodes: [], edges: [] },
      updated_at: '2026-08-01T00:00:00Z', can_edit: false, is_mine: false, owner_name: 'Ravi Kumar',
    });
    render(<SalesJourneyHub isAdmin={false} />);
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());

    await user.click(screen.getByText('Onboarding'));
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Trigger$/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('shows the rep cadence tour for a non-admin', async () => {
    window.localStorage.removeItem('alternate:cadence-rep-tour-seen-v2');
    render(<SalesJourneyHub isAdmin={false} />);
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: /cadence guided tour/i })).toBeInTheDocument();
  });

  it('does not mount the rep cadence tour for an admin', async () => {
    window.localStorage.removeItem('alternate:cadence-rep-tour-seen-v2');
    render(<SalesJourneyHub />);
    await waitFor(() => expect(screen.getByText('Onboarding')).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: /cadence guided tour/i })).not.toBeInTheDocument();
  });
});
