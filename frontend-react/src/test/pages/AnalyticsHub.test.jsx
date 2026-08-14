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
