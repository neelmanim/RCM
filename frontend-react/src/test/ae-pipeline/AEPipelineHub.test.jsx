import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AEPipelineHub } from '../../features/ae-pipeline/AEPipelineHub';
import { AEPipelineService, CallsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  AEPipelineService: {
    list: vi.fn(), get: vi.fn(), logCall: vi.fn(), closeDeal: vi.fn(),
    updateOpportunity: vi.fn(), getStageOptions: vi.fn(), getCloseFieldOptions: vi.fn(),
  },
  CallsService: { getCallOutcomes: vi.fn() },
}));

// The drawer's write forms are gated on "is this my deal?", so the component
// now needs an identity. ME_ID matches OPP_DETAIL.owner_user_id below.
const ME_ID = 'ae-me';
vi.mock('../../services/auth', () => ({ getCurrentUser: vi.fn(() => ({ sub: 'ae-me', role: 'AE' })) }));

const OPP_ROW = { id: 'o1', account_name: 'Wayne Analytics', amount: 120000, stage_name: 'Negotiation', is_closed: false, close_date: '2026-10-01', sf_push_status: null, owner_user_id: ME_ID };
const OPP_DETAIL = {
  id: 'o1', name: 'Wayne — Renewal', account: { name: 'Wayne Analytics' }, amount: 120000,
  close_date: '2026-10-01', stage_name: 'Negotiation', is_closed: false, is_won: false,
  owner_user_id: ME_ID, owner_name: 'Me Myself',
  sf_push_status: null, sf_push_error: null, closing_brief: null, calls: [],
};

function setup(overrides = {}) {
  AEPipelineService.list.mockResolvedValue([OPP_ROW]);
  AEPipelineService.get.mockResolvedValue({ ...OPP_DETAIL, ...overrides });
  AEPipelineService.getStageOptions.mockResolvedValue([{ value: 'Negotiation', label: 'Negotiation' }, { value: 'Closed Won', label: 'Closed Won' }]);
  AEPipelineService.getCloseFieldOptions.mockResolvedValue({
    standard_product_names: [{ value: 'SMS Pack - Regal', label: 'SMS Pack - Regal' }],
    lost_reasons: [{ value: 'Budget', label: 'Budget' }],
  });
  CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [{ value: 'Interested' }, { value: 'Not interested' }] });
  render(<AEPipelineHub />);
}

describe('AEPipelineHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe default so tests that don't go through setup() (and don't set
    // this themselves) don't crash calling .then() on an unmocked resolve.
    AEPipelineService.getCloseFieldOptions.mockResolvedValue({ standard_product_names: [], lost_reasons: [] });
  });

  it('renders the opportunity table', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.getByText('$120,000')).toBeInTheDocument();
    expect(screen.getByText('Negotiation')).toBeInTheDocument();
  });

  it('shows the owning AE, and says so when nobody owns the deal', async () => {
    // Admins reach every AE's deals through this same table
    // (_scoped_opportunity_query), so an unlabelled row is genuinely
    // ambiguous for them — owner_user_id alone is a UUID.
    AEPipelineService.list.mockResolvedValue([
      { ...OPP_ROW, id: 'o1', owner_name: 'Rohan Pillai' },
      { ...OPP_ROW, id: 'o2', account_name: 'Globex', owner_name: null },
    ]);
    AEPipelineService.getStageOptions.mockResolvedValue([]);
    CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [] });
    render(<AEPipelineHub />);

    await waitFor(() => expect(screen.getByText('Rohan Pillai')).toBeInTheDocument());
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('counts won / lost / still-open deals in the performance donut', async () => {
    AEPipelineService.list.mockResolvedValue([
      { ...OPP_ROW, id: 'w1', is_closed: true, is_won: true, amount: 10 },
      { ...OPP_ROW, id: 'w2', is_closed: true, is_won: true, amount: 20 },
      { ...OPP_ROW, id: 'l1', is_closed: true, is_won: false, amount: 40 },
      { ...OPP_ROW, id: 'p1', is_closed: false, is_won: false, amount: 5000 },
    ]);
    AEPipelineService.getStageOptions.mockResolvedValue([]);
    CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [] });
    render(<AEPipelineHub />);

    await waitFor(() => expect(screen.getByText('Deal performance')).toBeInTheDocument());
    // Legend renders "<count> (<share>%)" per segment: 2 won, 1 lost, 1 open of 4.
    expect(screen.getByText('2 (50%)')).toBeInTheDocument();
    expect(screen.getAllByText('1 (25%)')).toHaveLength(2);
    // Only the still-open amount is summed — closed deals aren't pipeline.
    expect(screen.getByText(/\$5,000 still open across 1 deal/)).toBeInTheDocument();
  });

  it('hides every write form on another AE\'s deal and says why', async () => {
    // Mirrors ae_pipeline_routes._require_write_access. Without this the
    // buttons render and the click comes back a bare 403.
    setup({ owner_user_id: 'someone-else', owner_name: 'Rohan Pillai' });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await waitFor(() => expect(screen.getByText(/Read-only/)).toBeInTheDocument());

    expect(screen.getByText(/belongs to Rohan Pillai/)).toBeInTheDocument();
    expect(screen.queryByText('Update deal')).not.toBeInTheDocument();
    expect(screen.queryByText('Close deal')).not.toBeInTheDocument();
    expect(screen.queryByText('Log a call')).not.toBeInTheDocument();
    // Read context stays — that's the whole point of admin oversight.
    expect(screen.getByText('Call history')).toBeInTheDocument();
  });

  it('keeps the write forms on an unowned deal (departed rep)', async () => {
    setup({ owner_user_id: null, owner_name: null });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await screen.findByText('Close deal');
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no opportunities', async () => {
    AEPipelineService.list.mockResolvedValue([]);
    render(<AEPipelineHub />);
    await waitFor(() => expect(screen.getByText('No Opportunities yet')).toBeInTheDocument());
  });

  it('opens the drawer on row click and loads the detail', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await waitFor(() => expect(AEPipelineService.get).toHaveBeenCalledWith('o1'));
    await waitFor(() => expect(screen.getByText('Wayne — Renewal')).toBeInTheDocument());
  });

  it('flags a failed Salesforce push', async () => {
    setup({ sf_push_status: 'failed', sf_push_error: 'Salesforce is down' });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await waitFor(() => expect(screen.getByText('Not synced to Salesforce')).toBeInTheDocument());
  });

  it('logs a call against the opportunity', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await screen.findByText('Log a call');
    AEPipelineService.logCall.mockResolvedValue({});

    const outcomeTrigger = screen.getByRole('button', { name: 'Call outcome' });
    await userEvent.click(outcomeTrigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Interested' }));
    await userEvent.type(screen.getByPlaceholderText('Notes (optional)'), 'Went well.');
    await userEvent.click(screen.getByRole('button', { name: /Log call/ }));

    await waitFor(() => expect(AEPipelineService.logCall).toHaveBeenCalledWith('o1', 'Interested', 'Went well.'));
  });

  it('disables Log call until an outcome is picked', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await screen.findByText('Log a call');
    expect(screen.getByRole('button', { name: /Log call/ })).toBeDisabled();
  });

  it('updates the deal stage and close date', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await screen.findByText('Update deal');
    AEPipelineService.updateOpportunity.mockResolvedValue({});

    const stageTrigger = screen.getByRole('button', { name: 'Stage' });
    expect(stageTrigger).toHaveTextContent('Negotiation');
    await userEvent.click(stageTrigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Closed Won' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(AEPipelineService.updateOpportunity).toHaveBeenCalledWith('o1', {
      stageName: 'Closed Won', closeDate: '2026-10-01',
    }));
  });

  it('requires a close date to close a deal, then closes it Won with a handover brief', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await screen.findByText('Close deal');
    AEPipelineService.closeDeal.mockResolvedValue({});

    // No close_date set yet -> submit is blocked with an inline error, not a silent no-op.
    await userEvent.click(screen.getByRole('button', { name: /Close as Lost/ }));
    expect(await screen.findByText('Close date is required.')).toBeInTheDocument();
    expect(AEPipelineService.closeDeal).not.toHaveBeenCalled();

    // Both "Update deal" and "Close deal" have their own DatePicker sharing
    // the same aria-label ("Close date") — the second one on the page is
    // this card's own.
    const closeDateTriggers = screen.getAllByRole('button', { name: 'Close date' });
    await userEvent.click(closeDateTriggers[closeDateTriggers.length - 1]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /10th,/ }).length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByRole('button', { name: /10th,/ })[0]);

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.type(screen.getByLabelText('Champion name'), 'Lucius Fox');
    await userEvent.type(screen.getByLabelText('Champion role'), 'VP Ops');
    await userEvent.type(screen.getByLabelText('Champion contact'), 'lucius@wayne.com');
    // "Promises made"/"Handover notes" are plain <label>+<textarea> pairs
    // (no htmlFor), and both are `required` once Won is on — jsdom enforces
    // native required-field validation on submit, so leaving them blank
    // silently blocks the form. Log-a-call's own "Notes (optional)"
    // textarea is index 0; these two are 1 and 2.
    const textareas = document.querySelectorAll('textarea');
    await userEvent.type(textareas[1], 'Dedicated onboarding call within first week.');
    await userEvent.type(textareas[2], 'Champion is enthusiastic, wants a QBR in 90 days.');
    await userEvent.click(screen.getByRole('button', { name: /Close as Won/ }));

    await waitFor(() => expect(AEPipelineService.closeDeal).toHaveBeenCalledWith('o1', expect.objectContaining({
      won: true, champion_name: 'Lucius Fox', champion_role: 'VP Ops', champion_contact: 'lucius@wayne.com',
    })));
    const payload = AEPipelineService.closeDeal.mock.calls[0][1];
    expect(payload.close_date).toMatch(/-10$/);
  });

  it('requires standard product + invoice number to close a Salesforce-synced deal', async () => {
    setup({ sf_opportunity_id: '006ZZZ1' });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await screen.findByText('Required for Salesforce to accept this close');
    AEPipelineService.closeDeal.mockResolvedValue({});

    const closeDateTriggers = screen.getAllByRole('button', { name: 'Close date' });
    await userEvent.click(closeDateTriggers[closeDateTriggers.length - 1]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /10th,/ }).length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByRole('button', { name: /10th,/ })[0]);

    // Blocked without the SF fields, even for a Lost close (no handover brief involved).
    await userEvent.click(screen.getByRole('button', { name: /Close as Lost/ }));
    expect(await screen.findByText(/Standard product\(s\), invoice number, and lost reason are required/)).toBeInTheDocument();
    expect(AEPipelineService.closeDeal).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('SMS Pack - Regal'));
    await userEvent.type(screen.getByLabelText('Invoice number'), 'INV-2002');
    await userEvent.click(screen.getByRole('button', { name: /Close as Lost/ }));
    expect(await screen.findByText(/lost reason are required/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lost reason' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Budget' }));
    await userEvent.click(screen.getByRole('button', { name: /Close as Lost/ }));

    await waitFor(() => expect(AEPipelineService.closeDeal).toHaveBeenCalledWith('o1', expect.objectContaining({
      standard_product_names: ['SMS Pack - Regal'], invoice_number: 'INV-2002', lost_reason: 'Budget',
    })));
  });

  it('reveals the handover brief fields only once Won is toggled on', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await screen.findByText('Close deal');

    expect(screen.queryByText('Handover brief — for the CSM')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('Handover brief — for the CSM')).toBeInTheDocument();
  });

  it('shows the closing brief when one exists, locked or not', async () => {
    setup({ closing_brief: { champion_name: 'Lucius Fox', champion_role: 'VP Ops', promises_made: 'QBR', handover_notes: 'Great fit', locked: true } });
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await waitFor(() => expect(screen.getByText('Closing brief')).toBeInTheDocument());
    expect(screen.getByText('Locked by CSM')).toBeInTheDocument();
    expect(screen.getByText(/Lucius Fox/)).toBeInTheDocument();
  });

  it('shows an error state instead of a blank drawer on load failure', async () => {
    AEPipelineService.list.mockResolvedValue([OPP_ROW]);
    AEPipelineService.get.mockRejectedValue({ response: { data: { detail: 'Not your opportunity.' } } });
    AEPipelineService.getStageOptions.mockResolvedValue([]);
    CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [] });
    render(<AEPipelineHub />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Wayne Analytics'));
    await waitFor(() => expect(screen.getByText('Not your opportunity.')).toBeInTheDocument());
  });

  it('filters by search, stage, and AE', async () => {
    AEPipelineService.list.mockResolvedValue([
      { ...OPP_ROW, id: 'w1', account_name: 'Wayne Analytics', owner_name: 'Rohan Pillai', is_closed: true, is_won: true },
      { ...OPP_ROW, id: 'g1', account_name: 'Globex', owner_name: 'Priya Shah', is_closed: false, is_won: false },
    ]);
    AEPipelineService.getStageOptions.mockResolvedValue([]);
    CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [] });
    render(<AEPipelineHub />);
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.getByText('Globex')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search opportunities'), 'Globex');
    expect(screen.queryByText('Wayne Analytics')).not.toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search opportunities'));

    await userEvent.click(screen.getByRole('button', { name: 'Filter by stage' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Closed Won' }));
    expect(screen.getByText('Wayne Analytics')).toBeInTheDocument();
    expect(screen.queryByText('Globex')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Filter by stage' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'All stages' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filter by AE' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Priya Shah' }));
    expect(screen.queryByText('Wayne Analytics')).not.toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });

  it('paginates beyond PER_PAGE opportunities', async () => {
    const many = Array.from({ length: 17 }, (_, i) => ({ ...OPP_ROW, id: `o${i}`, account_name: `Account ${i}` }));
    AEPipelineService.list.mockResolvedValue(many);
    AEPipelineService.getStageOptions.mockResolvedValue([]);
    CallsService.getCallOutcomes.mockResolvedValue({ enabled_outcomes: [] });
    render(<AEPipelineHub />);
    await waitFor(() => expect(screen.getByText('Account 0')).toBeInTheDocument());
    expect(screen.queryByText('Account 16')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('Account 16')).toBeInTheDocument();
    expect(screen.queryByText('Account 0')).not.toBeInTheDocument();
  });
});
