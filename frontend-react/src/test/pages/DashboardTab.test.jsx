import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardTab } from '../../pages/Analytics/DashboardTab';

const trendSeries = [
  { period: '2026-06-29', calls: 10, meetings: 3, disqualified: 1, emails: 2 },
  { period: '2026-07-06', calls: 12, meetings: 4, disqualified: 2, emails: 3 },
];

vi.mock('../../services/api', () => ({
  AnalyticsService: {
    getFilters: vi.fn(() => Promise.resolve({ pods: [{ id: 'p1', name: 'US Team' }], sdrs: [], batches: [] })),
    getFunnel: vi.fn(() => Promise.resolve({ leads_assigned: 0, calls: {}, emails: {}, meetings: {} })),
    getSdrTable: vi.fn(() => Promise.resolve({ sdrs: [] })),
    getTrend: vi.fn(() => Promise.resolve({ granularity: 'weekly', series: trendSeries })),
    getBatchSummary: vi.fn(() => Promise.resolve({ batches: [] })),
    getErrorLogSummary: vi.fn(() => Promise.resolve(null)),
    getAiRecommendation: vi.fn(() => Promise.resolve({ recommendation: '' })),
    downloadCsv: vi.fn(),
  },
  SmartAnalyticsService: {
    getPinnedReports: vi.fn(() => Promise.resolve([])),
    runReport: vi.fn(() => Promise.resolve(null)),
    pinReport: vi.fn(() => Promise.resolve(null)),
    query: vi.fn(() => Promise.resolve(null)),
  },
  default: { get: vi.fn(), post: vi.fn(), defaults: { headers: { common: {} } } },
}));

// RCA 2026-07-27: window.Chart lives on window (loaded via CDN in prod), so
// TrendChart's `if (!window.Chart) return;` guard means no chart is created
// in jsdom unless we stub it. This mock captures the real `datasets` array
// TrendChart builds so we can assert on `.hidden` directly, exactly what a
// real Chart.js instance would receive.
class MockChart {
  constructor(_ctx, config) {
    this.data = config.data;
    this.options = config.options;
    MockChart.lastInstance = this;
  }
  destroy() {}
  update() {}
}

// Landing state (RCA 2026-08-25): nothing fetches until the user applies at
// least one filter — every test below must drive that Apply once before
// asserting on fetched data.
async function applyFilters(user) {
  await user.click(screen.getByRole('button', { name: '7D' }));
  await user.click(screen.getByRole('button', { name: /apply filters/i }));
}

describe('DashboardTab — landing state (no auto-load)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches nothing and shows a centered prompt until the user applies filters', async () => {
    const { AnalyticsService } = await import('../../services/api');
    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);

    expect(screen.getByText(/choose filters to see your data/i)).toBeInTheDocument();
    expect(AnalyticsService.getFunnel).not.toHaveBeenCalled();
    expect(AnalyticsService.getSdrTable).not.toHaveBeenCalled();
    expect(AnalyticsService.getTrend).not.toHaveBeenCalled();
  });

  it('replaces the prompt with the dashboard once Apply Filters is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);

    await applyFilters(user);

    await waitFor(() => expect(screen.queryByText(/choose filters to see your data/i)).not.toBeInTheDocument());
    expect(screen.getByText(/📍 Last 7 Days/)).toBeInTheDocument();
  });
});

describe('DashboardTab — Activity Trend metric toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockChart.lastInstance = null;
    window.Chart = MockChart;
  });

  it('clicking a metric chip hides that dataset, not the opposite', async () => {
    const user = userEvent.setup();
    render(
      <DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />
    );
    await applyFilters(user);

    await waitFor(() => expect(MockChart.lastInstance).not.toBeNull());

    const meetingsIdx = MockChart.lastInstance.data.datasets.findIndex(
      d => d.label === 'Meetings'
    );
    expect(meetingsIdx).toBeGreaterThanOrEqual(0);
    // Meetings starts toggled ON — must render visible (not hidden).
    expect(MockChart.lastInstance.data.datasets[meetingsIdx].hidden).toBe(false);

    // RCA 2026-07-27: `!!next[key] === false ? false : true` was inverted —
    // clicking a chip to turn a metric OFF was setting hidden=false (still
    // visible) and clicking to turn it back ON was setting hidden=true
    // (disappearing). Confirmed by truth table before fixing.
    await user.click(screen.getByRole('button', { name: /meetings/i }));
    expect(MockChart.lastInstance.data.datasets[meetingsIdx].hidden).toBe(true);

    await user.click(screen.getByRole('button', { name: /meetings/i }));
    expect(MockChart.lastInstance.data.datasets[meetingsIdx].hidden).toBe(false);
  });
});

describe('DashboardTab — filters require explicit Apply, not autosubmit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('changing POD does not re-fetch until Apply Filters is clicked', async () => {
    const { AnalyticsService } = await import('../../services/api');
    const user = userEvent.setup();
    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);

    // Nothing fetches on mount — the landing state waits for a first Apply.
    expect(AnalyticsService.getFunnel).not.toHaveBeenCalled();
    await applyFilters(user);
    await waitFor(() => expect(AnalyticsService.getFunnel).toHaveBeenCalledTimes(1));
    const callsBeforeApply = AnalyticsService.getFunnel.mock.calls.length;

    await user.click(await screen.findByRole('button', { name: 'All Pods' }));
    await user.click(await screen.findByRole('option', { name: 'US Team' }));

    // Selecting a pod alone must NOT trigger a new fetch (RCA 2026-08-03:
    // this used to fire immediately with whatever partial filter state
    // existed at that instant).
    await new Promise(r => setTimeout(r, 50));
    expect(AnalyticsService.getFunnel).toHaveBeenCalledTimes(callsBeforeApply);

    await user.click(screen.getByRole('button', { name: /apply filters/i }));
    await waitFor(() =>
      expect(AnalyticsService.getFunnel).toHaveBeenCalledTimes(callsBeforeApply + 1)
    );
    expect(AnalyticsService.getFunnel).toHaveBeenLastCalledWith(
      expect.objectContaining({ pod_id: 'p1' })
    );
  });

  it('Apply Filters button is disabled until a draft change is made', async () => {
    const user = userEvent.setup();
    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);

    const applyBtn = await screen.findByRole('button', { name: /apply filters/i });
    expect(applyBtn).toBeDisabled();

    await user.click(await screen.findByRole('button', { name: 'All Pods' }));
    await user.click(await screen.findByRole('option', { name: 'US Team' }));
    expect(applyBtn).toBeEnabled();
  });

  it('breadcrumb reflects applied filters, not unapplied draft edits', async () => {
    const user = userEvent.setup();
    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);

    // Landing state: no breadcrumb at all until the first Apply.
    expect(screen.queryByText(/📍/)).not.toBeInTheDocument();

    await applyFilters(user);
    await waitFor(() => expect(screen.getByText(/📍 Last 7 Days/)).toBeInTheDocument());

    await user.click(await screen.findByRole('button', { name: 'All Pods' }));
    await user.click(await screen.findByRole('option', { name: 'US Team' }));

    // Draft changed, but not re-applied yet — breadcrumb must still reflect the last Apply.
    expect(screen.getByText(/📍 Last 7 Days/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /apply filters/i }));
    await waitFor(() => expect(screen.getByText(/📍 US Team/)).toBeInTheDocument());
  });
});

describe('DashboardTab — Pipeline Funnel unit consistency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Calling bar shows unique leads called, not raw call attempts', async () => {
    // Live-verified 2026-08-06: a lead dialed 3 times in one day showed
    // "Calling: 3" in the funnel — every other bar in the strip (Assigned,
    // Meeting, Disqualified) counts leads, not events, so this read as
    // "3 leads reached Calling" when only 1 actually did.
    const { AnalyticsService } = await import('../../services/api');
    AnalyticsService.getFunnel.mockResolvedValue({
      leads_assigned: 0,
      emails: {},
      calls: { made: 3, unique_leads_called: 1, avg_calls_per_lead: 3 },
      meetings: {},
      disqualified: 0,
    });

    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);
    await applyFilters(userEvent.setup());

    const callingLabel = await screen.findByText('Calling');
    const stageColumn = callingLabel.closest('div');
    expect(stageColumn).toHaveTextContent('1');
    expect(stageColumn).not.toHaveTextContent('3');
  });
});

describe('DashboardTab — SDR Performance table columns', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows accounts called instead of leads assigned, and drops the Conversations column', async () => {
    const { AnalyticsService } = await import('../../services/api');
    AnalyticsService.getSdrTable.mockResolvedValue({
      sdrs: [
        { user_id: 'u1', sdr_name: 'Aditya Sharma', leads_assigned: 616, calls_made: 2412, calls_connected: 372, conversations: 87, accounts_called: 210, accounts_connected: 60, account_connect_rate: 28.6, connect_rate: 15.4, emails_sent: 0, meetings: 25 },
      ],
    });

    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);
    await applyFilters(userEvent.setup());

    // "Aditya Sharma" also appears as an <option> in the trend chart's SDR
    // filter dropdown — disambiguate to the table row itself (a <p>).
    await waitFor(() => {
      expect(screen.getAllByText('Aditya Sharma').some(el => el.tagName === 'P')).toBe(true);
    });
    expect(screen.getByText('Accounts Called')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.queryByText('Conversations')).not.toBeInTheDocument();
    expect(screen.queryByText('87')).not.toBeInTheDocument();
    expect(screen.queryByText('616')).not.toBeInTheDocument();
  });

  it('shows 0 accounts called rather than blank when there are none', async () => {
    const { AnalyticsService } = await import('../../services/api');
    AnalyticsService.getSdrTable.mockResolvedValue({
      sdrs: [
        { user_id: 'u1', sdr_name: 'No Accounts SDR', leads_assigned: 5, calls_made: 3, calls_connected: 0, accounts_called: 0, accounts_connected: 0, account_connect_rate: null, connect_rate: null, emails_sent: 0, meetings: 0 },
      ],
    });

    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);
    await applyFilters(userEvent.setup());

    let nameEl;
    await waitFor(() => {
      nameEl = screen.getAllByText('No Accounts SDR').find(el => el.tagName === 'P');
      expect(nameEl).toBeTruthy();
    });
    expect(nameEl.closest('tr')).toHaveTextContent('0');
  });
});

describe('DashboardTab — SDR Performance panel scroll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives the SDR table its own bounded, scrollable height instead of growing the whole card unbounded', async () => {
    // Reported live: a pod with many SDRs (or a broad search match) grew the
    // whole card past the viewport with no reliable way to reach the rows
    // below — the table shared a CSS grid row with the fixed-height Activity
    // Trend chart and had no vertical overflow handling of its own.
    const { AnalyticsService } = await import('../../services/api');
    const manySdrs = Array.from({ length: 30 }, (_, i) => ({
      user_id: `u${i}`, sdr_name: `SDR ${i}`, leads_assigned: 10, calls_made: 5,
      conversations: 1, connect_rate: 20, emails_sent: 0, meetings: 0,
    }));
    AnalyticsService.getSdrTable.mockResolvedValue({ sdrs: manySdrs });

    render(<DashboardTab token="t" userRole="Super Admin" filters={{}} onFiltersChange={() => {}} />);
    await applyFilters(userEvent.setup());

    await waitFor(() => expect(screen.getAllByText(/SDR \d+/).length).toBeGreaterThan(0));
    const table = screen.getByRole('columnheader', { name: 'SDR' }).closest('table');
    const scrollWrapper = table.parentElement;
    expect(scrollWrapper.className).toMatch(/max-h-\[320px\]/);
    expect(scrollWrapper.className).toMatch(/overflow-y-auto/);
  });
});
