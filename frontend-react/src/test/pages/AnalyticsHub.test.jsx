import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalyticsHub } from '../../pages/Analytics/AnalyticsHub';

// AnalyticsHub is unmounted/remounted by the Vanilla shell on every tab
// switch (app.js's loadView), so this only exercises AnalyticsHub's own
// sessionStorage read/write — not DashboardTab's internal filter widgets.
vi.mock('../../pages/Analytics/DashboardTab', () => ({
  DashboardTab: ({ filters, onFiltersChange }) => (
    <div>
      <span data-testid="received-filters">{JSON.stringify(filters)}</span>
      <button onClick={() => onFiltersChange({ pod_id: 'p1', preset: '30d' })}>apply</button>
    </div>
  ),
}));
vi.mock('../../pages/Analytics/AskAiTab', () => ({ AskAiTab: () => null }));
vi.mock('../../pages/Analytics/vnext/AnalyticsHubVNext', () => ({
  AnalyticsHubVNext: ({ onBackToClassic }) => (
    <div>
      <span data-testid="vnext-mounted">vnext</span>
      <button onClick={onBackToClassic}>back to classic</button>
    </div>
  ),
}));

describe('AnalyticsHub — filter persistence across tab switches', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('writes applied filters to sessionStorage so they survive a remount', async () => {
    render(<AnalyticsHub token="t" userRole="Super Admin" />);
    await userEvent.click(screen.getByText('apply'));
    expect(JSON.parse(sessionStorage.getItem('analytics_hub_filters'))).toEqual({ pod_id: 'p1', preset: '30d' });
  });

  it('re-hydrates filters already in sessionStorage on mount, instead of starting empty', () => {
    sessionStorage.setItem('analytics_hub_filters', JSON.stringify({ pod_id: 'p9', preset: '7d' }));
    render(<AnalyticsHub token="t" userRole="Super Admin" />);
    expect(screen.getByTestId('received-filters').textContent).toBe(JSON.stringify({ pod_id: 'p9', preset: '7d' }));
  });
});

// Phase 1 (Analytics Transformation) — parallel vNext toggle. The existing
// Analytics Hub must remain the default and fully functional; vNext is an
// opt-in, role-gated entry point with a return path (docs §4/§5/§12).
describe('AnalyticsHub — vNext toggle (Phase 1 parallel beta)', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('shows the "Try the new Analytics Hub" link for Super Admin', () => {
    render(<AnalyticsHub token="t" userRole="Super Admin" />);
    expect(screen.getByText('Try the new Analytics Hub')).toBeInTheDocument();
  });

  it.each(['Admin', 'Pod Admin', 'AE', 'SDR'])('hides the vNext link for %s (restricted during development)', (role) => {
    render(<AnalyticsHub token="t" userRole={role} />);
    expect(screen.queryByText('Try the new Analytics Hub')).not.toBeInTheDocument();
  });

  it('switches to vNext on click, and back to the classic dashboard tab via its return link', async () => {
    render(<AnalyticsHub token="t" userRole="Super Admin" />);
    await userEvent.click(screen.getByText('Try the new Analytics Hub'));
    expect(screen.getByTestId('vnext-mounted')).toBeInTheDocument();
    // The classic tab bar must not be present while vNext is active — this
    // is a full swap, not an overlay, so no stale/duplicate controls.
    expect(screen.queryByText('Try the new Analytics Hub')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('back to classic'));
    expect(screen.queryByTestId('vnext-mounted')).not.toBeInTheDocument();
    expect(screen.getByText('Try the new Analytics Hub')).toBeInTheDocument();
  });

  it('never mounts vNext for a role that cannot reach the link (no route/URL bypass)', () => {
    render(<AnalyticsHub token="t" userRole="SDR" />);
    expect(screen.queryByTestId('vnext-mounted')).not.toBeInTheDocument();
  });
});
