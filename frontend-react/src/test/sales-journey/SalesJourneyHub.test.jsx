import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesJourneyHub } from '../../features/sales-journey/SalesJourneyHub';
import { useJourneyStore } from '../../features/sales-journey/store/useJourneyStore';

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
});
