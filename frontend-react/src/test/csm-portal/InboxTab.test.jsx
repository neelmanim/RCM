import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboxTab } from '../../features/csm-portal/InboxTab';
import { CsmPortalService, AdminService } from '../../services/api';

vi.mock('../../services/api', () => ({
  CsmPortalService: { getPortfolio: vi.fn(), getDigest: vi.fn() },
  AdminService: { getUsers: vi.fn() },
}));

const AT_RISK = { id: 'a1', name: 'Umbrella Health', assigned_csm_id: 'csm1', assigned_csm_name: 'Demo CSM', open_opportunity: null, health: { displayed_tier: 'Critical', score: 17.5 } };
const AT_RISK_OTHER_CSM = { id: 'a3', name: 'Wayne Ind', assigned_csm_id: 'csm2', assigned_csm_name: 'Other CSM', open_opportunity: null, health: { displayed_tier: 'At Risk', score: 35 } };
const HEALTHY = { id: 'a2', name: 'Stark Renewables', assigned_csm_id: 'csm1', assigned_csm_name: 'Demo CSM', open_opportunity: { amount: 45000, close_date: '2027-01-15' }, health: { displayed_tier: 'Healthy', score: 90 } };
const DIGEST = { estimated_minutes_saved: 45, estimate_label: 'Estimated — 3 playbook execution(s) this week × 15 assumed minutes each' };

describe('InboxTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AdminService.getUsers.mockResolvedValue([
      { id: 'csm1', name: 'Demo CSM', email: 'demo.csm@x.com', role: 'CSM' },
      { id: 'csm2', name: 'Other CSM', email: 'other.csm@x.com', role: 'CSM' },
    ]);
  });

  it('shows only the non-Healthy accounts, plus the time-saved banner', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ count: 2, accounts: [AT_RISK, HEALTHY] });
    CsmPortalService.getDigest.mockResolvedValue(DIGEST);
    render(<InboxTab isAdmin={false} onOpenAccount={() => {}} />);

    await waitFor(() => expect(screen.getByText('Umbrella Health')).toBeInTheDocument());
    expect(screen.queryByText('Stark Renewables')).not.toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
    expect(CsmPortalService.getPortfolio).toHaveBeenCalledWith({ sort: 'at_risk' });
  });

  it('opens an account on row click', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ count: 1, accounts: [AT_RISK] });
    CsmPortalService.getDigest.mockResolvedValue(DIGEST);
    const onOpenAccount = vi.fn();
    render(<InboxTab isAdmin={false} onOpenAccount={onOpenAccount} />);

    await waitFor(() => expect(screen.getByText('Umbrella Health')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Umbrella Health'));
    expect(onOpenAccount).toHaveBeenCalledWith('a1');
  });

  it('shows a distinct "nothing at risk" message when every account is Healthy', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ count: 1, accounts: [HEALTHY] });
    CsmPortalService.getDigest.mockResolvedValue(DIGEST);
    render(<InboxTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Nothing at risk right now')).toBeInTheDocument());
  });

  it('shows the empty-portfolio copy when the CSM has no accounts at all', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({ count: 0, accounts: [] });
    CsmPortalService.getDigest.mockResolvedValue(DIGEST);
    render(<InboxTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('No accounts assigned to you yet')).toBeInTheDocument());
  });

  it('shows an error message on load failure', async () => {
    CsmPortalService.getPortfolio.mockRejectedValue(new Error('down'));
    CsmPortalService.getDigest.mockResolvedValue(DIGEST);
    render(<InboxTab isAdmin={false} onOpenAccount={() => {}} />);
    await waitFor(() => expect(screen.getByText('Failed to load the inbox.')).toBeInTheDocument());
  });

  describe('CSM filter (admin only)', () => {
    it('hides the filter for a non-admin CSM viewing only their own accounts', async () => {
      CsmPortalService.getPortfolio.mockResolvedValue({ count: 1, accounts: [AT_RISK] });
      CsmPortalService.getDigest.mockResolvedValue(DIGEST);
      render(<InboxTab isAdmin={false} onOpenAccount={() => {}} />);
      await waitFor(() => expect(screen.getByText('Umbrella Health')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Filter by CSM' })).not.toBeInTheDocument();
    });

    it('narrows the list to the selected CSM', async () => {
      CsmPortalService.getPortfolio.mockResolvedValue({ count: 2, accounts: [AT_RISK, AT_RISK_OTHER_CSM] });
      CsmPortalService.getDigest.mockResolvedValue(DIGEST);
      render(<InboxTab isAdmin onOpenAccount={() => {}} />);
      await waitFor(() => expect(screen.getByText('Umbrella Health')).toBeInTheDocument());
      expect(screen.getByText('Wayne Ind')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Filter by CSM' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Other CSM' }));

      expect(screen.queryByText('Umbrella Health')).not.toBeInTheDocument();
      expect(screen.getByText('Wayne Ind')).toBeInTheDocument();
    });

    it('shows a per-CSM empty message when the selected CSM has nothing at risk', async () => {
      CsmPortalService.getPortfolio.mockResolvedValue({ count: 1, accounts: [AT_RISK] });
      CsmPortalService.getDigest.mockResolvedValue(DIGEST);
      render(<InboxTab isAdmin onOpenAccount={() => {}} />);
      await waitFor(() => expect(screen.getByText('Umbrella Health')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: 'Filter by CSM' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Other CSM' }));

      expect(await screen.findByText('Nothing at risk for this CSM')).toBeInTheDocument();
    });
  });
});
