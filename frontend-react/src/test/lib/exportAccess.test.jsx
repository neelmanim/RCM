import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { useCanExport } from '../../lib/useCanExport';
import { DailyDigestHub } from '../../features/daily-digest/DailyDigestHub';
import { DailyDigestService, FunnelService, PodsService, SavedViewsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  DailyDigestService: { get: vi.fn(), leads: vi.fn(), exportXlsx: vi.fn() },
  PodsService: { getAll: vi.fn() },
  FunnelService: { get: vi.fn(), exportXlsx: vi.fn() },
  DigestDrillService: { breakdown: vi.fn(() => Promise.resolve({ error: 'off in this test' })), accounts: vi.fn(), calls: vi.fn(), getIcp: vi.fn(), setIcp: vi.fn() },
  SavedViewsService: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));

const Probe = () => <span>{useCanExport() ? 'can' : 'cannot'}</span>;

describe('export access in the UI', () => {
  beforeEach(() => { delete window.__CRM_CAPS__; });
  afterEach(() => { delete window.__CRM_CAPS__; });

  it('fails closed until the shell has answered, then follows the live capability', async () => {
    render(<Probe />);
    expect(screen.getByText('cannot')).toBeInTheDocument();                        // nothing published yet
    act(() => { window.__CRM_CAPS__ = { export: true }; window.dispatchEvent(new CustomEvent('alternate:caps')); });
    expect(screen.getByText('can')).toBeInTheDocument();
    act(() => { window.__CRM_CAPS__ = { export: false }; window.dispatchEvent(new CustomEvent('alternate:caps')); });
    expect(screen.getByText('cannot')).toBeInTheDocument();
  });

  it('anything but an explicit true is "no"', () => {
    window.__CRM_CAPS__ = { export: 'yes' };
    render(<Probe />);
    expect(screen.getByText('cannot')).toBeInTheDocument();
  });

  it('Daily Digest shows no Export buttons to someone who may not export, and both when they may', async () => {
    DailyDigestService.get.mockResolvedValue({ digest_date: '2026-09-07', comparison_date: '2026-08-31', timezone: 'UTC', from: '2026-09-07', to: '2026-09-07', days: 1, kpi: {}, catalog: [], campaigns: [], attention: [], lead_summary: {}, sdr_snapshot: [], pipeline_flow: [], status_snapshot: {} });
    DailyDigestService.leads.mockResolvedValue({ items: [], total: 0, pages: 1 });
    PodsService.getAll.mockResolvedValue([]);
    SavedViewsService.list.mockResolvedValue([]);
    FunnelService.get.mockResolvedValue({ rows: [], total: {}, campaigns: [] });
    const { unmount } = render(<DailyDigestHub />);
    await waitFor(() => expect(DailyDigestService.get).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Funnel')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument();
    unmount();

    window.__CRM_CAPS__ = { export: true };
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Export/ }).length).toBe(3));   // digest + funnel + drill-down
  });
});
