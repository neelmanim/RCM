import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PipelineHub } from '../../features/pipeline-hub/PipelineHub';
import { AEPipelineService, CallsService, CsmPortalService, AdminService } from '../../services/api';

// 2026-09-16: Super-Admin-only merge of AE Pipeline + CSM Portal into one
// nav item with a tab for each. Reuses the real <AEPipelineHub>/
// <CsmPortalHub> components directly, so both islands' services need
// mocking here exactly as their own test files do.
vi.mock('../../services/api', () => ({
  AEPipelineService: {
    list: vi.fn(), get: vi.fn(), logCall: vi.fn(), closeDeal: vi.fn(),
    updateOpportunity: vi.fn(), getStageOptions: vi.fn(), getCloseFieldOptions: vi.fn(),
  },
  CallsService: { getCallOutcomes: vi.fn() },
  CsmPortalService: {
    getPortfolio: vi.fn(), getDigest: vi.fn(), getAccount: vi.fn(), getStageOptions: vi.fn(),
    getCloseFieldOptions: vi.fn(), bulkAssign: vi.fn(),
  },
  AdminService: { getUsers: vi.fn() },
}));

vi.mock('../../services/auth', () => ({ getCurrentUser: vi.fn(() => ({ sub: 'sa-1', role: 'Super Admin' })) }));

describe('PipelineHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AEPipelineService.list.mockResolvedValue([]);
    AEPipelineService.getStageOptions.mockResolvedValue([]);
    AEPipelineService.getCloseFieldOptions.mockResolvedValue({ standard_product_names: [], lost_reasons: [] });
    CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [] });
    CsmPortalService.getPortfolio.mockResolvedValue({ count: 0, accounts: [] });
    CsmPortalService.getDigest.mockResolvedValue({ estimated_minutes_saved: 0, estimate_label: '' });
    CsmPortalService.getStageOptions.mockResolvedValue([]);
    CsmPortalService.getCloseFieldOptions.mockResolvedValue({ standard_product_names: [], lost_reasons: [] });
    AdminService.getUsers.mockResolvedValue([]);
  });

  it('defaults to the AE Pipeline tab and renders both tab buttons — a real merge, not a duplicate nav', async () => {
    render(<PipelineHub userRole="Super Admin" />);
    expect(screen.getByRole('button', { name: /AE Pipeline/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /CSM Portal/ })).toBeInTheDocument();
    await waitFor(() => expect(AEPipelineService.list).toHaveBeenCalled());
    expect(CsmPortalService.getPortfolio).not.toHaveBeenCalled();
  });

  it('switches to the CSM Portal tab, with admin-scoped copy', async () => {
    render(<PipelineHub userRole="Super Admin" />);
    await userEvent.click(screen.getByRole('button', { name: /CSM Portal/ }));
    await waitFor(() => expect(CsmPortalService.getPortfolio).toHaveBeenCalled());
    expect(screen.getByText(/Every customer account across the org/)).toBeInTheDocument();
  });

  it('opens straight on the CSM Portal tab when given an initialAccountId (global search deep-link)', async () => {
    CsmPortalService.getAccount.mockResolvedValue({
      account: { name: 'Wayne Analytics', industry: 'Tech', assigned_csm_name: 'Demo CSM' },
      opportunities: [], closing_brief: null, closing_brief_reason: null,
      opportunity_calls: [], activities: [],
      health: { score: 60, displayed_tier: 'At Risk', tier: 'At Risk', factors: {}, partial: true, partial_label: '' },
    });
    render(<PipelineHub userRole="Super Admin" initialAccountId="a1" />);
    await waitFor(() => expect(CsmPortalService.getAccount).toHaveBeenCalledWith('a1'));
    expect(await screen.findByText('Wayne Analytics')).toBeInTheDocument();
    expect(AEPipelineService.list).not.toHaveBeenCalled();
  });
});
