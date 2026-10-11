import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JourneyList } from '../../features/sales-journey/JourneyList';
import { SalesJourneyService } from '../../services/api';

// ReplyRateChart wraps chart.js, which jsdom doesn't provide a real canvas
// for — same convention as AiResultChart.test.jsx. Render a stub that
// exposes the ranked data so tests can assert ordering without a canvas.
vi.mock('../../features/sales-journey/ReplyRateChart', () => ({
  ReplyRateChart: ({ ranked }) => (
    <div data-testid="reply-rate-chart">{ranked.map((r) => r.name).join(',')}</div>
  ),
}));

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    list: vi.fn(),
    create: vi.fn(),
    getStats: vi.fn(),
    getStatsBulk: vi.fn(),
    archive: vi.fn(),
  },
  PodsService: {
    getAll: vi.fn(() => Promise.resolve([])),
  },
}));

const journeys = [
  // owner_name/is_mine/can_edit mirror what GET /api/journeys actually
  // returns since v12.2 — the list gates Edit/Delete on can_edit.
  { id: 'j1', name: 'Onboarding Drip', status: 'draft', owner_id: 'u1', owner_name: 'Me', is_mine: true, can_edit: true },
  { id: 'j2', name: 'Re-engagement', status: 'active', owner_id: 'u1', owner_name: 'Me', is_mine: true, can_edit: true },
  { id: 'j3', name: 'Win-back', status: 'archived', owner_id: 'u1', owner_name: 'Me', is_mine: true, can_edit: true },
];

describe('JourneyList — filter, pagination, delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SalesJourneyService.list.mockResolvedValue(journeys);
    SalesJourneyService.getStats.mockResolvedValue({ active: 0 });
    SalesJourneyService.getStatsBulk.mockResolvedValue({ journeys: {} });
    SalesJourneyService.archive.mockResolvedValue({ id: 'j1', status: 'archived', enrollments_exited: 0 });
  });

  it('filters by name search', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.type(screen.getByPlaceholderText('Search cadences by name…'), 'engage');
    expect(screen.queryByText('Onboarding Drip')).not.toBeInTheDocument();
    expect(screen.getByText('Re-engagement')).toBeInTheDocument();
  });

  it('hides archived cadences by default — they are frequently one-off QA/test artifacts', async () => {
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));
    expect(screen.queryByText('Win-back')).not.toBeInTheDocument();
  });

  it('shows archived cadences once the Archived status filter is explicitly selected', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getByRole('button', { name: 'Filter by status' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archived' }));
    expect(screen.getByText('Win-back')).toBeInTheDocument();
    expect(screen.queryByText('Onboarding Drip')).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getByRole('button', { name: 'Filter by status' }));
    await user.click(screen.getByRole('menuitem', { name: 'Active' }));
    expect(screen.queryByText('Onboarding Drip')).not.toBeInTheDocument();
    expect(screen.getByText('Re-engagement')).toBeInTheDocument();
  });

  it('paginates when there are more than 10 cadences', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `j${i}`, name: `Cadence ${i}`, status: 'draft', owner_id: 'u1',
      owner_name: 'Me', is_mine: true, can_edit: true,
    }));
    SalesJourneyService.list.mockResolvedValue(many);
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Cadence 0'));

    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.queryByText('Cadence 10')).not.toBeInTheDocument();
  });

  it('deletes a single cadence after confirming, warning about active enrollments', async () => {
    SalesJourneyService.getStats.mockResolvedValue({ active: 3 });
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getAllByTitle('Delete cadence')[0]);
    await waitFor(() => screen.getByText(/currently enrolled will be exited/));
    expect(screen.getByText(/3 lead\(s\)/)).toBeInTheDocument();

    await user.click(screen.getByText('Delete'));
    await waitFor(() => expect(SalesJourneyService.archive).toHaveBeenCalledWith('j1', 3));
  });

  it('bulk-deletes selected cadences', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getByLabelText('Select Onboarding Drip'));
    await user.click(screen.getByLabelText('Select Re-engagement'));
    await user.click(screen.getByText('Delete 2 selected'));

    await waitFor(() => screen.getByText('Delete 2 cadences?'));
    await user.click(screen.getByText('Delete'));

    await waitFor(() => expect(SalesJourneyService.archive).toHaveBeenCalledTimes(2));
  });

  it('drops a selection once its cadence is filtered out, so bulk delete cannot silently include it', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getByLabelText('Select Onboarding Drip'));
    expect(screen.getByText('Delete 1 selected')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search cadences by name…'), 'win');
    await waitFor(() => expect(screen.queryByText('Delete 1 selected')).not.toBeInTheDocument());
  });

  it('reflects partial bulk-delete failure — refreshes the list and keeps only the failed cadence selected for retry', async () => {
    SalesJourneyService.archive.mockImplementation((id) =>
      id === 'j2' ? Promise.reject(new Error('boom')) : Promise.resolve({ id, status: 'archived', enrollments_exited: 0 })
    );
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getByLabelText('Select Onboarding Drip'));
    await user.click(screen.getByLabelText('Select Re-engagement'));
    await user.click(screen.getByText('Delete 2 selected'));
    await waitFor(() => screen.getByText('Delete 2 cadences?'));
    await user.click(screen.getByText('Delete'));

    await waitFor(() => expect(SalesJourneyService.archive).toHaveBeenCalledTimes(2));
    // Both attempted, list refreshed regardless of the partial failure —
    // not left showing stale pre-delete state.
    expect(SalesJourneyService.list).toHaveBeenCalledTimes(2); // initial load + post-delete reload
    await waitFor(() => screen.getByText(/Failed to delete 1 cadence/));
    expect(screen.getByText('Delete 1 selected')).toBeInTheDocument();
  });
});

describe('JourneyList — shared controls (every role)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SalesJourneyService.list.mockResolvedValue(journeys);
    SalesJourneyService.getStats.mockResolvedValue({ active: 1, completed: 2, failed: 0, exited_early: 0, paused: 0 });
    SalesJourneyService.getStatsBulk.mockResolvedValue({
      journeys: {
        j1: { active: 1, completed: 0, failed: 0, exited_early: 0, paused: 0 },
        j2: { active: 1, completed: 0, failed: 0, exited_early: 0, paused: 0 },
        j3: { active: 0, completed: 1, failed: 0, exited_early: 0, paused: 0 },
      },
    });
  });

  it('a rep sees delete and bulk delete on cadences they own — ownership (can_edit), not role, decides', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<JourneyList onOpen={onOpen} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    expect(screen.getByText('New Cadence')).toBeInTheDocument();
    expect(screen.queryAllByTitle('Delete cadence').length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText('Select Onboarding Drip'));
    expect(screen.getByText('Delete 1 selected')).toBeInTheDocument();

    await user.click(screen.getByText('Onboarding Drip'));
    expect(onOpen).toHaveBeenCalledWith('j1', 'Onboarding Drip');
  });

  it('shows Duplicate — copying creates a new draft, it never edits the source', async () => {
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));
    expect(screen.getAllByTitle('Duplicate cadence').length).toBeGreaterThan(0);
  });

  it('still shows the cross-cadence performance summary — transparency data, not a mutating control', async () => {
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    expect(await screen.findByText('Performance snapshot')).toBeInTheDocument();
    // v13.0.6: one bulk call replaced the old per-journey getStats N+1.
    // Archived (j3) is excluded from the snapshot — see the archived-cadence
    // clutter fix below.
    await waitFor(() => expect(SalesJourneyService.getStatsBulk).toHaveBeenCalledWith(['j1', 'j2']));
  });

  it('excludes archived cadences from the performance snapshot (QA/test-run clutter)', async () => {
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await waitFor(() => expect(SalesJourneyService.getStatsBulk).toHaveBeenCalled());
    expect(SalesJourneyService.getStatsBulk).toHaveBeenCalledWith(expect.not.arrayContaining(['j3']));
  });

  it('ranks cadences by reply rate and omits ones with zero sends', async () => {
    SalesJourneyService.getStatsBulk.mockResolvedValue({
      journeys: {
        j1: { active: 1, completed: 0, failed: 0, exited_early: 0, paused: 0,
              engagement: { sent: 10, opened: 5, clicked: 2, replied: 1, open_rate: 0.5, click_rate: 0.2, reply_rate: 0.1 } },
        j2: { active: 1, completed: 0, failed: 0, exited_early: 0, paused: 0,
              engagement: { sent: 10, opened: 8, clicked: 4, replied: 4, open_rate: 0.8, click_rate: 0.4, reply_rate: 0.4 } },
        j3: { active: 0, completed: 1, failed: 0, exited_early: 0, paused: 0,
              engagement: { sent: 0, opened: 0, clicked: 0, replied: 0, open_rate: 0, click_rate: 0, reply_rate: 0 } },
      },
    });
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    const chart = await screen.findByTestId('reply-rate-chart');
    const rankedNames = chart.textContent.split(',');
    // Re-engagement (40% reply) ranks above Onboarding Drip (10% reply);
    // Win-back (0 sends) is excluded from the ranking entirely.
    expect(rankedNames.indexOf('Re-engagement')).toBeLessThan(rankedNames.indexOf('Onboarding Drip'));
    expect(rankedNames).not.toContain('Win-back');
  });
});

// ── v12.2: cadence ownership in the list ───────────────────────────────────
describe('JourneyList — ownership', () => {
  const OTHERS = {
    id: 'j9', name: 'Ravi Outreach', status: 'active', owner_id: 'u2',
    owner_name: 'Ravi Kumar', is_mine: false, can_edit: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    SalesJourneyService.getStats.mockResolvedValue({ active: 0 });
    SalesJourneyService.getStatsBulk.mockResolvedValue({ journeys: {} });
  });

  it("attributes someone else's cadence and hides its delete button", async () => {
    SalesJourneyService.list.mockResolvedValue([OTHERS]);
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Ravi Outreach')).toBeInTheDocument());

    expect(screen.getByText('Owned by Ravi Kumar')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete cadence')).not.toBeInTheDocument();
  });

  it("won't let a non-owned cadence be selected into a bulk delete", async () => {
    SalesJourneyService.list.mockResolvedValue([OTHERS]);
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Ravi Outreach')).toBeInTheDocument());

    // Every archive call would 403, so the checkbox must not offer it.
    expect(screen.getByLabelText('Select Ravi Outreach')).toBeDisabled();
  });

  it('does not attribute or restrict your own cadence', async () => {
    SalesJourneyService.list.mockResolvedValue([
      { id: 'j1', name: 'Mine', status: 'draft', owner_id: 'u1', owner_name: 'Me', is_mine: true, can_edit: true },
    ]);
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mine')).toBeInTheDocument());

    expect(screen.queryByText(/Owned by/)).not.toBeInTheDocument();
    expect(screen.getByTitle('Delete cadence')).toBeInTheDocument();
  });

  it('"My cadences only" hides other owners\' cadences', async () => {
    SalesJourneyService.list.mockResolvedValue([
      { id: 'j1', name: 'Mine', status: 'draft', owner_id: 'u1', owner_name: 'Me', is_mine: true, can_edit: true },
      OTHERS,
    ]);
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mine')).toBeInTheDocument());
    expect(screen.getByText('Ravi Outreach')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('My cadences only'));

    expect(screen.getByText('Mine')).toBeInTheDocument();
    expect(screen.queryByText('Ravi Outreach')).not.toBeInTheDocument();
  });

  it('warns that a cadence is live before deleting it', async () => {
    SalesJourneyService.list.mockResolvedValue([
      { id: 'j2', name: 'Live One', status: 'active', owner_id: 'u1', owner_name: 'Me', is_mine: true, can_edit: true },
    ]);
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Live One')).toBeInTheDocument());

    await userEvent.click(screen.getByTitle('Delete cadence'));
    await waitFor(() => expect(screen.getByText(/This cadence is Active/i)).toBeInTheDocument());
    expect(screen.getByText(/can still enrol new leads/i)).toBeInTheDocument();
  });

  it('does not show the live warning for a draft', async () => {
    SalesJourneyService.list.mockResolvedValue([
      { id: 'j3', name: 'Draft One', status: 'draft', owner_id: 'u1', owner_name: 'Me', is_mine: true, can_edit: true },
    ]);
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Draft One')).toBeInTheDocument());

    await userEvent.click(screen.getByTitle('Delete cadence'));
    await waitFor(() => expect(screen.getByText('Delete this cadence?')).toBeInTheDocument());
    expect(screen.queryByText(/is Active/i)).not.toBeInTheDocument();
  });
});
