import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortfolioTab } from '../../features/csm-portal/PortfolioTab';
import { CsmPortalService, AdminService } from '../../services/api';

vi.mock('../../services/api', () => ({
  CsmPortalService: { getPortfolio: vi.fn(), bulkAssign: vi.fn() },
  AdminService: { getUsers: vi.fn() },
}));

const ACCOUNTS = [
  {
    id: 'a1', name: 'Wayne Analytics', assigned_csm_name: 'Demo CSM',
    open_opportunity: { amount: 50000, close_date: '2026-10-01' },
    health: { displayed_tier: 'Healthy', score: 88 },
  },
  {
    id: 'a2', name: 'Globex Logistics', assigned_csm_name: null,
    open_opportunity: null,
    health: { displayed_tier: 'Critical', score: 20 },
  },
];

describe('PortfolioTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AdminService.getUsers.mockResolvedValue([
      { id: 'csm1', name: 'Demo CSM', email: 'demo.csm@x.com', role: 'CSM' },
      { id: 'ae1', name: 'Demo AE', email: 'demo.ae@x.com', role: 'AE' },
    ]);
  });

  it('renders every account with its renewal and health tier', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    render(<PortfolioTab isAdmin={false} onOpenAccount={() => {}} />);

    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.getByText('Globex Logistics')).toBeInTheDocument();
    expect(screen.getByText('$50,000')).toBeInTheDocument();
    // "Healthy"/"Critical" now also appear in the health-tier donut legend.
    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    // No open opportunity -> dashes, not a crash.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('opens the account on row click', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    const onOpenAccount = vi.fn();
    render(<PortfolioTab isAdmin={false} onOpenAccount={onOpenAccount} />);

    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    expect(onOpenAccount).toHaveBeenCalledWith('a1');
  });

  it('shows the admin empty-state copy when there are no accounts', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: [] });
    render(<PortfolioTab isAdmin onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('No accounts yet')).toBeInTheDocument());
  });

  it('shows the CSM empty-state copy when there are no accounts', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: [] });
    render(<PortfolioTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('No accounts assigned to you yet')).toBeInTheDocument());
  });

  it('shows an error message instead of a blank screen on load failure', async () => {
    CsmPortalService.getPortfolio.mockRejectedValue(new Error('network down'));
    render(<PortfolioTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Failed to load the portfolio.')).toBeInTheDocument());
  });

  it('does not show row checkboxes or the bulk-assign bar for a non-admin', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    render(<PortfolioTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the CSM filter but not row checkboxes for a Pod Admin (isAdmin but not canBulkAssign)', async () => {
    // Mirrors CsmPortalHub's wiring: isAdmin includes Pod Admin (shares the
    // filter), canBulkAssign doesn't (bulk_assign_accounts is Super-Admin-only).
    AdminService.getUsers.mockResolvedValue([
      { id: 'csm1', name: 'Demo CSM', email: 'demo.csm@x.com', role: 'CSM' },
      { id: 'csm2', name: 'Other CSM', email: 'other.csm@x.com', role: 'CSM' },
    ]);
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    render(<PortfolioTab isAdmin canBulkAssign={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Filter by CSM' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('selecting a row does not also open the account (checkbox click is scoped)', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    const onOpenAccount = vi.fn();
    render(<PortfolioTab isAdmin onOpenAccount={onOpenAccount} />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Wayne Analytics' }));
    expect(onOpenAccount).not.toHaveBeenCalled();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('bulk-assigns the selected accounts to a CSM and clears the selection', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    CsmPortalService.bulkAssign.mockResolvedValue({ updated: 2, notified: 2 });
    render(<PortfolioTab isAdmin onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Wayne Analytics' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Globex Logistics' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Assign to CSM' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Demo CSM' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(CsmPortalService.bulkAssign).toHaveBeenCalledWith(['a1', 'a2'], 'csm1'));
    await waitFor(() => expect(screen.getByText('Assigned 2 account(s).')).toBeInTheDocument());
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('only offers CSM-role users in the assignee picker', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    render(<PortfolioTab isAdmin onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Wayne Analytics' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign to CSM' }));
    expect(screen.getByRole('menuitem', { name: 'Demo CSM' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Demo AE' })).not.toBeInTheDocument();
  });

  it('shows the portfolio health donut with a per-tier count', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    render(<PortfolioTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Portfolio health')).toBeInTheDocument());
    expect(screen.getByText('2 account(s) total')).toBeInTheDocument();
  });

  it('filters by search and health tier', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: ACCOUNTS });
    render(<PortfolioTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Search accounts'), 'Globex');
    expect(screen.queryByText('Wayne Analytics')).not.toBeInTheDocument();
    expect(screen.getByText('Globex Logistics')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search accounts'));

    await userEvent.click(screen.getByRole('button', { name: 'Filter by health tier' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Healthy' }));
    expect(screen.getByText('Wayne Analytics')).toBeInTheDocument();
    expect(screen.queryByText('Globex Logistics')).not.toBeInTheDocument();
  });

  it('paginates beyond PER_PAGE accounts', async () => {
    const many = Array.from({ length: 17 }, (_, i) => ({
      id: `a${i}`, name: `Account ${i}`, assigned_csm_name: 'Demo CSM',
      open_opportunity: null, health: { displayed_tier: 'Healthy', score: 80 },
    }));
    CsmPortalService.getPortfolio.mockResolvedValue({ accounts: many });
    render(<PortfolioTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Account 0')).toBeInTheDocument());
    expect(screen.queryByText('Account 16')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('Account 16')).toBeInTheDocument();
    expect(screen.queryByText('Account 0')).not.toBeInTheDocument();
  });
});
