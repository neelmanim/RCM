import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlaybooksTab } from '../../features/csm-portal/PlaybooksTab';
import { CsmPortalService } from '../../services/api';

vi.mock('../../services/api', () => ({
  CsmPortalService: { getPortfolio: vi.fn() },
}));

const NOW = new Date('2026-09-15T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const daysFromNow = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

const HANDOVER_READY = {
  id: 'a1', name: 'Wayne Analytics', closing_brief_locked: false,
  last_touch_at: daysAgo(1), open_opportunity: null,
  health: { displayed_tier: 'Healthy', score: 80 },
};
const RENEWAL_SOON = {
  id: 'a2', name: 'Globex Logistics', closing_brief_locked: true,
  last_touch_at: daysAgo(1), open_opportunity: { close_date: daysFromNow(10) },
  health: { displayed_tier: 'At Risk', score: 50 },
};
const SILENT = {
  id: 'a3', name: 'Initech Systems', closing_brief_locked: true,
  last_touch_at: daysAgo(45), open_opportunity: null,
  health: { displayed_tier: 'Critical', score: 30 },
};
const QUIET_HEALTHY = {
  id: 'a4', name: 'Stark Renewables', closing_brief_locked: true,
  last_touch_at: daysAgo(1), open_opportunity: null,
  health: { displayed_tier: 'Healthy', score: 92 },
};

describe('PlaybooksTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('sorts accounts into the right playbook cards', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: [HANDOVER_READY, RENEWAL_SOON, SILENT, QUIET_HEALTHY] });
    render(<PlaybooksTab isAdmin={false} onOpenAccount={() => {}} />);

    await waitFor(() => expect(screen.getByText('Zero-Form Handover')).toBeInTheDocument());
    expect(screen.getByText('Wayne Analytics')).toBeInTheDocument();   // handover-ready
    expect(screen.getByText('Globex Logistics')).toBeInTheDocument(); // renewal soon
    expect(screen.getByText('Initech Systems')).toBeInTheDocument();  // silent
    // Stark Renewables matches none of the 3 automatic playbooks.
    expect(screen.queryByText('Stark Renewables')).not.toBeInTheDocument();
  });

  it('labels Champion Departure as manual-only with no queue', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: [HANDOVER_READY] });
    render(<PlaybooksTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Champion Departure')).toBeInTheDocument());
    expect(screen.getByText('No queue — this playbook has no automatic trigger.')).toBeInTheDocument();
  });

  it('opens the account when a match is clicked', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: [HANDOVER_READY] });
    const onOpenAccount = vi.fn();
    render(<PlaybooksTab isAdmin={false} onOpenAccount={onOpenAccount} />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    expect(onOpenAccount).toHaveBeenCalledWith('a1');
  });

  it('shows a distinct "nothing to action" message when no account matches any playbook', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: [QUIET_HEALTHY] });
    render(<PlaybooksTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Nothing to action right now')).toBeInTheDocument());
  });

  it('shows the empty-portfolio copy when there are no accounts at all', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: [] });
    render(<PlaybooksTab isAdmin onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('No accounts yet')).toBeInTheDocument());
  });
});
