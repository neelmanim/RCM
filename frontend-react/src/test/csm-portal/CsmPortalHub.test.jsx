import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CsmPortalHub } from '../../features/csm-portal/CsmPortalHub';
import { CsmPortalService, AdminService, CallsService } from '../../services/api';

// Shell-level test: tab switching, admin-vs-CSM copy, and the drill-into/
// back-out-of Account 360 round trip. Each tab's own data/empty-state
// behavior is covered by its own test file.
vi.mock('../../services/api', () => ({
  CsmPortalService: {
    getPortfolio: vi.fn(), getDigest: vi.fn(), getAccount: vi.fn(), getStageOptions: vi.fn(),
    getCloseFieldOptions: vi.fn(), bulkAssign: vi.fn(), logOpportunityCall: vi.fn(),
  },
  AdminService: { getUsers: vi.fn() },
  CallsService: { getCallOutcomes: vi.fn() },
}));

describe('CsmPortalHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CsmPortalService.getPortfolio.mockResolvedValue({ count: 0, accounts: [] });
    CsmPortalService.getDigest.mockResolvedValue({ estimated_minutes_saved: 0, estimate_label: '' });
    CsmPortalService.getStageOptions.mockResolvedValue([]);
    CsmPortalService.getCloseFieldOptions.mockResolvedValue({ standard_product_names: [], lost_reasons: [] });
    AdminService.getUsers.mockResolvedValue([]);
    CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [] });
  });

  it('starts on the Inbox tab with CSM-scoped copy', async () => {
    render(<CsmPortalHub userRole="CSM" />);
    expect(screen.getByText(/Your account portfolio/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No accounts assigned to you yet')).toBeInTheDocument());
  });

  it('shows admin-scoped copy for a Super Admin', async () => {
    render(<CsmPortalHub userRole="Super Admin" />);
    expect(screen.getByText(/Every customer account across the org/)).toBeInTheDocument();
  });

  it('switches tabs without losing the CSM Portal header', async () => {
    render(<CsmPortalHub userRole="CSM" />);
    await userEvent.click(screen.getByRole('button', { name: /Digest/ }));
    await waitFor(() => expect(CsmPortalService.getDigest).toHaveBeenCalled());
    expect(screen.getByText('CSM Portal')).toBeInTheDocument();
  });

  it('opens Account 360 from a tab and returns to the tab shell on Back', async () => {
    CsmPortalService.getPortfolio.mockResolvedValue({
      count: 1,
      accounts: [{ id: 'a1', name: 'Wayne Analytics', assigned_csm_name: 'Demo CSM', open_opportunity: null, health: { displayed_tier: 'Critical', score: 20 } }],
    });
    CsmPortalService.getAccount.mockResolvedValue({
      account: { name: 'Wayne Analytics', industry: 'Tech', assigned_csm_name: 'Demo CSM' },
      opportunities: [], closing_brief: null, closing_brief_reason: null,
      opportunity_calls: [], activities: [],
      health: { score: 20, displayed_tier: 'Critical', tier: 'Critical', factors: { commercial: 10, relationship: 30 }, partial: true, partial_label: 'based on Relationship + Commercial' },
    });

    render(<CsmPortalHub userRole="CSM" />);
    await userEvent.click(screen.getByRole('button', { name: /Portfolio/ }));
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Wayne Analytics'));
    await waitFor(() => expect(CsmPortalService.getAccount).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(screen.getByText('Health score')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Digest/ })).toBeInTheDocument());
  });

  it('deep-links straight to an account via initialAccountId (global search Accounts group)', async () => {
    CsmPortalService.getAccount.mockResolvedValue({
      account: { name: 'Globex Logistics', industry: 'Shipping', assigned_csm_name: 'Demo CSM' },
      opportunities: [], closing_brief: null, closing_brief_reason: null,
      opportunity_calls: [], activities: [],
      health: { score: 60, displayed_tier: 'At Risk', tier: 'At Risk', factors: {}, partial: true, partial_label: '' },
    });

    render(<CsmPortalHub userRole="CSM" initialAccountId="a2" />);
    await waitFor(() => expect(CsmPortalService.getAccount).toHaveBeenCalledWith('a2'));
    expect(await screen.findByText('Globex Logistics')).toBeInTheDocument();

    // Back must not immediately reopen it — same initialAccountId value.
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Digest/ })).toBeInTheDocument());
    expect(screen.queryByText('Globex Logistics')).not.toBeInTheDocument();
  });

  // 2026-09-16: CSM Portal's 4 sections are now flat top-level nav items for
  // a CSM (NavSidebar.jsx's csm-inbox/csm-portfolio/csm-playbooks/
  // csm-digest routes) — the `section` prop pins the active section and
  // hides the internal tab strip, since the CSM's own sidebar is now the
  // section switcher. Only the Super-Admin-only PipelineHub still mounts
  // this with no `section`, keeping the tab strip for browsing all 4.
  describe('flat mode (section prop — a CSM\'s own nav items)', () => {
    it('hides the internal tab strip and shows only the pinned section', async () => {
      render(<CsmPortalHub userRole="CSM" section="portfolio" />);
      await waitFor(() => expect(CsmPortalService.getPortfolio).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: /Inbox/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Digest/ })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Portfolio' })).toBeInTheDocument();
    });

    it('shows a per-section greeting instead of the generic "CSM Portal" copy', async () => {
      render(<CsmPortalHub userRole="CSM" section="inbox" />);
      expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
      expect(screen.queryByText('CSM Portal')).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByText('No accounts assigned to you yet')).toBeInTheDocument());
    });

    // Every other role gets a personal "Good morning, {name}" greeting on
    // Dashboard, their own landing page — CSM had none at all on Inbox
    // (their equivalent landing page) until this was added, 2026-09-16.
    it('greets a CSM by first name on Inbox, their landing page', async () => {
      render(<CsmPortalHub userRole="CSM" section="inbox" userName="Jane Doe" />);
      expect(await screen.findByText(/Jane 👋/)).toBeInTheDocument();
    });

    it('does not greet on other sections — Inbox is the landing page, not every page', async () => {
      render(<CsmPortalHub userRole="CSM" section="portfolio" userName="Jane Doe" />);
      await waitFor(() => expect(CsmPortalService.getPortfolio).toHaveBeenCalled());
      expect(screen.queryByText(/Jane 👋/)).not.toBeInTheDocument();
    });

    it('follows a new `section` prop when re-mounted from a different flat nav item', async () => {
      const { rerender } = render(<CsmPortalHub userRole="CSM" section="inbox" />);
      expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();

      rerender(<CsmPortalHub userRole="CSM" section="playbooks" />);
      expect(screen.getByRole('heading', { name: 'Playbooks' })).toBeInTheDocument();
    });
  });
});
