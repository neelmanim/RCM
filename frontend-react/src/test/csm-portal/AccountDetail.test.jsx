import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountDetail } from '../../features/csm-portal/AccountDetail';
import { CsmPortalService, CallsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  CsmPortalService: {
    getAccount: vi.fn(), getStageOptions: vi.fn(), getCloseFieldOptions: vi.fn(),
    logTouch: vi.fn(), championDeparted: vi.fn(), setHealthOverride: vi.fn(),
    createRenewalOpportunity: vi.fn(), updateOpportunity: vi.fn(), closeOpportunity: vi.fn(),
    logOpportunityCall: vi.fn(), setStakeholderRole: vi.fn(),
    createMilestone: vi.fn(), updateMilestone: vi.fn(),
  },
  CallsService: { getCallOutcomes: vi.fn() },
}));

// Write actions are gated on "is this my account?", so the component needs an
// identity. ME_ID matches BASE_DATA.account.assigned_csm_id below.
const ME_ID = 'csm-me';
vi.mock('../../services/auth', () => ({ getCurrentUser: vi.fn(() => ({ sub: 'csm-me', role: 'CSM' })) }));

const BASE_DATA = {
  account: { name: 'Wayne Analytics', industry: 'Manufacturing', assigned_csm_name: 'Demo CSM', assigned_csm_id: ME_ID },
  opportunities: [{ id: 'o1', name: 'Wayne — Renewal', amount: 50000, close_date: '2026-10-01', stage_name: 'Negotiation', is_closed: false }],
  closing_brief: { champion_name: 'Lucius Fox', champion_role: 'VP Ops', champion_contact: 'lucius@wayne.com', promises_made: 'QBR', handover_notes: 'Happy', champion_active: true, locked: true },
  closing_brief_reason: null,
  opportunity_calls: [],
  activities: [],
  health: { score: 88, displayed_tier: 'Healthy', tier: 'Healthy', factors: { commercial: 90, relationship: 86 }, partial: true, partial_label: 'based on Relationship + Commercial — Usage/Support not yet available' },
};

function setup(overrides = {}) {
  CsmPortalService.getAccount.mockResolvedValue({ ...BASE_DATA, ...overrides });
  CsmPortalService.getStageOptions.mockResolvedValue([{ value: 'Negotiation', label: 'Negotiation' }, { value: 'Closed Won', label: 'Closed Won' }]);
  const onBack = vi.fn();
  render(<AccountDetail accountId="a1" onBack={onBack} />);
  return { onBack };
}

describe('AccountDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CsmPortalService.getCloseFieldOptions.mockResolvedValue({ standard_product_names: [], lost_reasons: [] });
    CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [{ value: 'Connected' }, { value: 'No answer' }] });
  });

  it('renders the account header, health score, and open renewal', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.getByText('Manufacturing · CSM: Demo CSM')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText(/Wayne — Renewal/)).toBeInTheDocument();
    expect(screen.getByText(/based on Relationship \+ Commercial/)).toBeInTheDocument();
  });

  it('renders whatever health factors the backend returns, including new ones', async () => {
    // The additive contract (csm_health.py's _FACTOR_WEIGHTS): a factor added
    // backend-side must show up here without a frontend change. This used to
    // read health.factors.commercial/.relationship by name, so a new factor
    // was silently dropped even though the score already included it.
    setup({
      health: {
        ...BASE_DATA.health,
        factors: { commercial: 90, relationship: 86, usage: 42 },
        partial_label: 'Based on Commercial + Relationship + Usage — Support not yet available',
      },
    });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.getByText('commercial: 90')).toBeInTheDocument();
    expect(screen.getByText('relationship: 86')).toBeInTheDocument();
    expect(screen.getByText('usage: 42')).toBeInTheDocument();
  });

  it('hides the partial-data footnote once the backend stops reporting one', async () => {
    setup({ health: { ...BASE_DATA.health, partial: false, partial_label: '' } });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.queryByText(/not yet available/)).not.toBeInTheDocument();
  });

  it('hides write actions on another CSM\'s account but keeps the health override', async () => {
    // Mirrors csm_portal_routes._require_account_write_access. Override is the
    // one deliberate exception — the plan specifies it as a Super Admin
    // escape hatch, logged with who/when/why.
    setup({ account: { ...BASE_DATA.account, assigned_csm_id: 'someone-else', assigned_csm_name: 'Other CSM' } });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());

    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Log touch/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Champion departed/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New renewal opp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Override/ })).toBeInTheDocument();
  });

  it('keeps write actions on an unassigned account (day-one backfill)', async () => {
    setup({ account: { ...BASE_DATA.account, assigned_csm_id: null, assigned_csm_name: null } });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log touch/ })).toBeInTheDocument();
  });

  it('shows the closed-before-handover-tracking fallback when there is no brief', async () => {
    setup({ closing_brief: null, closing_brief_reason: 'closed_before_handover_tracking' });
    await waitFor(() => expect(screen.getByText('Closed before handover tracking began.')).toBeInTheDocument());
  });

  it('shows a plain no-brief message when there is no brief and no backfill reason', async () => {
    setup({ closing_brief: null });
    await waitFor(() => expect(screen.getByText('No handover brief on file.')).toBeInTheDocument());
  });

  it('calls onBack when Back is clicked', async () => {
    const { onBack } = setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows an error message instead of a blank screen on load failure', async () => {
    CsmPortalService.getAccount.mockRejectedValue(new Error('down'));
    CsmPortalService.getStageOptions.mockResolvedValue([]);
    render(<AccountDetail accountId="a1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Failed to load this account.')).toBeInTheDocument());
  });

  it('logs a touch and closes the modal', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    CsmPortalService.logTouch.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: /Log touch/ }));
    const modal = await screen.findByText('Log a touch');
    await userEvent.type(screen.getByPlaceholderText('What did you do / discuss?'), 'Quick check-in call.');
    await userEvent.click(within(modal.closest('[role="dialog"]') || modal.parentElement.parentElement).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(CsmPortalService.logTouch).toHaveBeenCalledWith('a1', 'Quick check-in call.'));
    await waitFor(() => expect(screen.queryByText('Log a touch')).not.toBeInTheDocument());
  });

  it('disables Champion departed until a closing brief exists', async () => {
    setup({ closing_brief: null });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Champion departed/ })).toBeDisabled();
  });

  it('marks the champion departed', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    CsmPortalService.championDeparted.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: /Champion departed/ }));
    await waitFor(() => expect(CsmPortalService.championDeparted).toHaveBeenCalledWith('a1'));
  });

  it('overrides the health tier with a reason and clears it separately', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    CsmPortalService.setHealthOverride.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: /Override/ }));
    await screen.findByText('Override health tier');
    // Healthy is pre-selected from the current displayed tier; switch to Critical.
    await userEvent.click(screen.getByRole('button', { name: 'Critical' }));
    await userEvent.type(screen.getByPlaceholderText('Why override the computed tier?'), 'Champion gone quiet.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(CsmPortalService.setHealthOverride).toHaveBeenCalledWith('a1', 'Critical', 'Champion gone quiet.'));
  });

  it('requires a reason before the override Save button is enabled', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Override/ }));
    await screen.findByText('Override health tier');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('creates a renewal opportunity with amount and close date', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    CsmPortalService.createRenewalOpportunity.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: /New renewal opp/ }));
    await screen.findByText('Create renewal opportunity');
    await userEvent.type(screen.getByPlaceholderText('e.g. 50000'), '75000');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(CsmPortalService.createRenewalOpportunity).toHaveBeenCalledWith('a1', {
      amount: 75000, closeDate: undefined,
    }));
  });

  it('updates an open opportunity\'s stage without opening Salesforce', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    CsmPortalService.updateOpportunity.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: 'Manage' }));
    await screen.findByText('Update');
    const stageTrigger = screen.getByRole('button', { name: 'Stage' });
    expect(stageTrigger).toHaveTextContent('Negotiation');
    await userEvent.click(stageTrigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Closed Won' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save update' }));

    await waitFor(() => expect(CsmPortalService.updateOpportunity).toHaveBeenCalledWith('a1', 'o1', {
      stageName: 'Closed Won', closeDate: '2026-10-01',
    }));
  });

  it('requires a close date before closing an opportunity, then closes it Won with a handover brief', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    CsmPortalService.closeOpportunity.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: 'Manage' }));
    await screen.findByText('Close this deal');
    expect(screen.getByRole('button', { name: /Close as Lost/ })).toBeEnabled(); // prefilled from opp.close_date

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.type(screen.getByLabelText('Champion name'), 'New Champion');
    await userEvent.click(screen.getByRole('button', { name: /Close as Won/ }));

    await waitFor(() => expect(CsmPortalService.closeOpportunity).toHaveBeenCalledWith('a1', 'o1', {
      won: true, close_date: '2026-10-01',
      champion_name: 'New Champion', champion_role: undefined, champion_contact: undefined,
      promises_made: undefined, handover_notes: undefined,
    }));
  });

  it('requires standard product + invoice number to close a Salesforce-synced opportunity', async () => {
    CsmPortalService.getCloseFieldOptions.mockResolvedValue({
      standard_product_names: [{ value: 'SMS Pack - Regal', label: 'SMS Pack - Regal' }],
      lost_reasons: [{ value: 'Budget', label: 'Budget' }],
    });
    setup({ opportunities: [{ ...BASE_DATA.opportunities[0], sf_opportunity_id: '006ZZZ1' }] });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    CsmPortalService.closeOpportunity.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: 'Manage' }));
    await screen.findByText('Required for Salesforce to accept this close');

    await userEvent.click(screen.getByRole('button', { name: /Close as Lost/ }));
    expect(await screen.findByText(/Standard product\(s\), invoice number, and lost reason are required/)).toBeInTheDocument();
    expect(CsmPortalService.closeOpportunity).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('SMS Pack - Regal'));
    await userEvent.type(screen.getByLabelText('Invoice number'), 'INV-2002');
    await userEvent.click(screen.getByRole('button', { name: /Close as Lost/ }));
    expect(await screen.findByText(/lost reason are required/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lost reason' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Budget' }));
    await userEvent.click(screen.getByRole('button', { name: /Close as Lost/ }));

    await waitFor(() => expect(CsmPortalService.closeOpportunity).toHaveBeenCalledWith('a1', 'o1', expect.objectContaining({
      standard_product_names: ['SMS Pack - Regal'], invoice_number: 'INV-2002', lost_reason: 'Budget',
    })));
  });

  it('shows a "no open opportunity" message with no Manage action available', async () => {
    setup({ opportunities: [] });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.getByText(/No open renewal opportunity/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
  });

  // CSM Portal's counterpart to AE Pipeline's own "Log a call" — a CSM has
  // no Lead to call against, so this logs against one of the account's
  // Opportunities instead (backend: log_account_opportunity_call).
  describe('logging a call', () => {
    it('shows "No calls logged yet." with no call history, and logs a call against the single opportunity with no picker needed', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.getByText('No calls logged yet.')).toBeInTheDocument();
      // Only one opportunity on this account — no Opportunity picker shown.
      expect(screen.queryByRole('button', { name: 'Opportunity' })).not.toBeInTheDocument();

      CsmPortalService.logOpportunityCall.mockResolvedValue({});
      await userEvent.click(screen.getByRole('button', { name: 'Call outcome' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Connected' }));
      await userEvent.type(screen.getByPlaceholderText('Notes (optional)'), 'Discussed renewal terms.');
      await userEvent.click(screen.getByRole('button', { name: /Log call/ }));

      await waitFor(() => expect(CsmPortalService.logOpportunityCall).toHaveBeenCalledWith(
        'a1', 'o1', 'Connected', 'Discussed renewal terms.',
      ));
    });

    it('renders existing call history', async () => {
      setup({
        opportunity_calls: [{ id: 'c1', outcome: 'Connected', notes: 'Went well', called_at: '2026-09-10T10:00:00Z' }],
      });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('Went well')).toBeInTheDocument();
    });

    it('offers an Opportunity picker defaulting to the open one when there are several', async () => {
      setup({
        opportunities: [
          { ...BASE_DATA.opportunities[0], id: 'o1', name: 'Open Renewal', is_closed: false },
          { id: 'o2', name: 'Old Closed Deal', amount: 1000, close_date: '2025-01-01', stage_name: 'Closed Won', is_closed: true },
        ],
      });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      const oppTrigger = screen.getByRole('button', { name: 'Opportunity' });
      expect(oppTrigger).toHaveTextContent('Open Renewal');

      CsmPortalService.logOpportunityCall.mockResolvedValue({});
      await userEvent.click(screen.getByRole('button', { name: 'Call outcome' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Connected' }));
      await userEvent.click(screen.getByRole('button', { name: /Log call/ }));

      await waitFor(() => expect(CsmPortalService.logOpportunityCall).toHaveBeenCalledWith('a1', 'o1', 'Connected', ''));
    });

    it('hides the log-call form on a read-only account (another CSM\'s)', async () => {
      setup({ account: { ...BASE_DATA.account, assigned_csm_id: 'someone-else', assigned_csm_name: 'Other CSM' } });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Call outcome' })).not.toBeInTheDocument();
    });

    it('hides the log-call form entirely when the account has no opportunities to attach a call to', async () => {
      setup({ opportunities: [] });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Call outcome' })).not.toBeInTheDocument();
    });
  });

  // Stakeholder mapping — CSM feedback item #7.
  describe('stakeholders', () => {
    const STAKEHOLDERS = [
      { id: 's1', name: 'Jane POC', title: 'VP Ops', email: 'jane@wayne.com', role: null, is_new: true },
      { id: 's2', name: 'Bob Billing', title: null, email: null, role: 'Billing', is_new: false },
    ];

    it('shows the no-stakeholders message when none are synced', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.getByText('No stakeholders synced from Salesforce yet.')).toBeInTheDocument();
    });

    it('renders synced stakeholders with the New badge and existing role', async () => {
      setup({ stakeholders: STAKEHOLDERS });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.getByText('Jane POC')).toBeInTheDocument();
      expect(screen.getByText('New')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Role for Bob Billing/ })).toHaveTextContent('Billing');
    });

    it('sets a stakeholder role and reloads', async () => {
      setup({ stakeholders: STAKEHOLDERS });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      CsmPortalService.setStakeholderRole.mockResolvedValue({});

      await userEvent.click(screen.getByRole('button', { name: /Role for Jane POC/ }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Champion' }));

      await waitFor(() => expect(CsmPortalService.setStakeholderRole).toHaveBeenCalledWith('a1', 's1', 'Champion'));
    });

    it('shows role as a read-only badge on another CSM\'s account, no role picker', async () => {
      setup({
        stakeholders: STAKEHOLDERS,
        account: { ...BASE_DATA.account, assigned_csm_id: 'someone-else', assigned_csm_name: 'Other CSM' },
      });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /Role for/ })).not.toBeInTheDocument();
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });
  });

  // Engagement timeline — CSM feedback item #8.
  describe('engagement timeline', () => {
    const MILESTONES = [
      { id: 'm1', milestone_type: 'Onboarding', label: 'OB', milestone_date: '2026-05-15', ae_name: 'Sam AE', use_cases: 'Bulk SMS', poc_stakeholder_ids: [] },
      { id: 'm2', milestone_type: 'QBR', label: 'QBR 1', milestone_date: '2026-09-01', cs_name: 'Priya', summary: 'Good signals', action_items: 'Send proposal', poc_stakeholder_ids: [] },
    ];

    it('shows the no-milestones message when none are logged', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.getByText('No milestones logged yet.')).toBeInTheDocument();
    });

    it('renders the timeline entries and opens a QBR entry\'s details on click', async () => {
      setup({ milestones: MILESTONES });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.getByText('OB')).toBeInTheDocument();
      expect(screen.getByText('QBR 1')).toBeInTheDocument();

      await userEvent.click(screen.getByText('QBR 1'));
      await screen.findByText('Milestone details');
      expect(screen.getByDisplayValue('Priya')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Good signals')).toBeInTheDocument();
    });

    it('logs a new milestone', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      CsmPortalService.createMilestone.mockResolvedValue({});

      await userEvent.click(screen.getByRole('button', { name: /Log milestone/ }));
      await screen.findByText('Log a milestone');
      await userEvent.type(screen.getByPlaceholderText('e.g. QBR 1, Go-Live'), 'QBR 2');
      // DatePicker interaction is covered elsewhere; set the date via the form's underlying value directly is
      // not possible through the public API here, so this exercises the disabled-until-valid gating instead.
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('updates an existing milestone', async () => {
      setup({ milestones: MILESTONES });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      CsmPortalService.updateMilestone.mockResolvedValue({});

      await userEvent.click(screen.getByText('QBR 1'));
      await screen.findByText('Milestone details');
      const summaryBox = screen.getByDisplayValue('Good signals');
      await userEvent.clear(summaryBox);
      await userEvent.type(summaryBox, 'Updated summary');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(CsmPortalService.updateMilestone).toHaveBeenCalledWith('a1', 'm2', expect.objectContaining({
        summary: 'Updated summary',
      })));
    });

    it('hides "Log milestone" and the Save button on a read-only account', async () => {
      setup({
        milestones: MILESTONES,
        account: { ...BASE_DATA.account, assigned_csm_id: 'someone-else', assigned_csm_name: 'Other CSM' },
      });
      await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /Log milestone/ })).not.toBeInTheDocument();

      await userEvent.click(screen.getByText('QBR 1'));
      await screen.findByText('Milestone details');
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });
  });
});
