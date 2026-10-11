import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadDetailHub } from '../../features/lead-detail-hub/LeadDetailHub';

const baseLead = {
  id: 'lead-1', first_name: 'Kyle', last_name: 'Skoog', company: '100% Chiropractic',
  title: 'VP, Growth', phone: '+16019470694', email: 'kyle@example.com',
  status: 'Calling', lead_source: 'klenty_sync:2026-08-01', do_not_contact: false,
  lead_pod_ids: [], call_attempt_count: 1, max_call_attempts: 5, max_attempts_reached: false,
  assigned_to_name: 'Vanshika Koli', call_count: 1,
};

vi.mock('../../services/api', () => ({
  LeadsService: {
    getLead: vi.fn(() => Promise.resolve(baseLead)),
    getCallsForLead: vi.fn(() => Promise.resolve({ calls: [], has_more: false, total_count: 0 })),
    getTasks: vi.fn(() => Promise.resolve([])),
    getNotes: vi.fn(() => Promise.resolve([])),
    getJourney: vi.fn(() => Promise.resolve([])),
    getStatusHistory: vi.fn(() => Promise.resolve([])),
    getFieldHistory: vi.fn(() => Promise.resolve([])),
    triggerAiResearch: vi.fn(() => Promise.resolve({})),
    addTask: vi.fn(() => Promise.resolve({})),
    patchTask: vi.fn(() => Promise.resolve({})),
    deleteTask: vi.fn(() => Promise.resolve({})),
    addNote: vi.fn(() => Promise.resolve({})),
    deleteNote: vi.fn(() => Promise.resolve({})),
    setOutcome: vi.fn(() => Promise.resolve({})),
    updateLead: vi.fn(() => Promise.resolve({})),
    markPhoneInvalid: vi.fn(() => Promise.resolve({ ok: true })),
  },
  EmailService: {
    getEmailsForLead: vi.fn(() => Promise.resolve({ emails: [], total: 0 })),
  },
  AdminService: {
    getUsers: vi.fn(() => Promise.resolve([
      { id: 'u1', name: 'Priya SDR', role: 'SDR' },
      { id: 'u2', name: 'Rahul AE', role: 'AE' },
    ])),
  },
  AssignmentsService: {
    bulkAssign: vi.fn(() => Promise.resolve({})),
    bulkUnassign: vi.fn(() => Promise.resolve({})),
    bulkDelete: vi.fn(() => Promise.resolve({})),
  },
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } },
}));

describe('LeadDetailHub', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the lead header once data loads', async () => {
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());
    expect(screen.getAllByText(/100% Chiropractic/).length).toBeGreaterThan(0);
  });

  it('shows a "Switch to classic view" link when onSwitchToClassic is provided, and calls it on click', async () => {
    const onSwitchToClassic = vi.fn();
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" onSwitchToClassic={onSwitchToClassic} />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    const link = screen.getByText('Switch to classic view');
    await user.click(link);
    expect(onSwitchToClassic).toHaveBeenCalled();
  });

  it('has no "Switch to classic view" link when onSwitchToClassic is not provided', async () => {
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());
    expect(screen.queryByText('Switch to classic view')).not.toBeInTheDocument();
  });

  it('recommends calling the lead when there is no answered call yet', async () => {
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Call Kyle')).toBeInTheDocument());
  });

  it('a failed sub-section fetch does not blank the rest of the page', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getStatusHistory.mockRejectedValueOnce(new Error('boom'));
    LeadsService.getFieldHistory.mockRejectedValueOnce(new Error('boom'));

    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());
    // Header and Next Best Action still render fine even though history failed.
    expect(screen.getByText('Call Kyle')).toBeInTheDocument();
  });

  it('shows the classic Klenty label ("Klenty"), not "Manual Log", for a Klenty-sourced call', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getCallsForLead.mockResolvedValueOnce({
      calls: [{ id: 'c1', provider: 'klenty', outcome: 'Interested', called_at: '2026-08-13T01:17:00Z', user_name: 'Vanshika' }],
      has_more: false,
      total_count: 1,
    });

    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Klenty')).toBeInTheDocument());
    expect(screen.queryByText('Manual Log')).not.toBeInTheDocument();
  });

  it('lets a Super Admin change the lead assignment from the header', async () => {
    const { AssignmentsService } = await import('../../services/api');
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    const trigger = await screen.findByRole('button', { name: 'Change lead assignment' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
    await user.click(screen.getByRole('option', { name: 'Priya SDR' }));

    expect(AssignmentsService.bulkUnassign).toHaveBeenCalledWith(['lead-1']);
    expect(AssignmentsService.bulkAssign).toHaveBeenCalledWith('u1', ['lead-1']);
  });

  it('shows plain read-only assignment text (no dropdown) for a non-admin SDR', async () => {
    render(<LeadDetailHub leadId="lead-1" userRole="SDR" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Change lead assignment' })).not.toBeInTheDocument();
    expect(screen.getByText(/Assigned to Vanshika Koli/)).toBeInTheDocument();
  });

  // RCA 2026-08-26: Delete used a bare window.confirm() and Mark Opted Out
  // had no confirmation at all — both now route through the same native
  // ConfirmDialog the rest of the app uses (LeadsHub, BulkActionBar), so a
  // mis-click doesn't mutate anything until the user confirms in-page.
  it('requires confirming in a modal before deleting the lead', async () => {
    const { AssignmentsService } = await import('../../services/api');
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    await user.click(screen.getByText('Delete Lead'));
    expect(AssignmentsService.bulkDelete).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Delete Kyle Skoog\?/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(AssignmentsService.bulkDelete).toHaveBeenCalledWith(['lead-1']));
  });

  it('requires confirming in a modal before marking a lead opted out', async () => {
    const { LeadsService } = await import('../../services/api');
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    await user.click(screen.getAllByText('Mark Opted Out')[0]);
    expect(LeadsService.updateLead).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Mark Kyle Skoog as opted out\?/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Mark Opted Out' }));

    await waitFor(() => expect(LeadsService.updateLead).toHaveBeenCalledWith('lead-1', { do_not_contact: true }));
  });

  it('marks the number wrong only after confirming, then refetches the lead (AE report: nowhere to mark a wrong number)', async () => {
    const { LeadsService } = await import('../../services/api');
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());
    const fetchesBefore = LeadsService.getLead.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /Wrong number/ }));
    expect(LeadsService.markPhoneInvalid).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Mark this number as wrong?')).toBeInTheDocument();
    expect(within(dialog).getByText(/the lead stays active for email/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Mark wrong number' }));

    await waitFor(() => expect(LeadsService.markPhoneInvalid).toHaveBeenCalledWith('lead-1'));
    await waitFor(() => expect(LeadsService.getLead.mock.calls.length).toBeGreaterThan(fetchesBefore));
  });

  it('shows the Wrong number badge and no Wrong number action once the phone is flagged', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLead.mockResolvedValue({ ...baseLead, phone_invalid_at: '2026-10-07 09:00:00+00:00' });
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /Wrong number/ })).not.toBeInTheDocument();
    expect(screen.getByText('Wrong number')).toBeInTheDocument();
    LeadsService.getLead.mockImplementation(() => Promise.resolve(baseLead));
  });

  // RCA 2026-08-26: isAssignAdmin/canDelete/canSetOutcome used to be gated
  // on role alone (isAdmin) — a Pod Admin viewing a lead OUTSIDE their own
  // pod (canModify=false) could still reassign or delete it from here, even
  // though every other action on the page already respected the pod
  // boundary. Now gated on isAdmin && canModify, same as everything else.
  it('hides the reassignment control and Delete Lead button from a Pod Admin viewing a lead outside their pod', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLead.mockResolvedValueOnce({ ...baseLead, lead_pod_ids: ['other-pod-id'] });

    render(<LeadDetailHub leadId="lead-1" userRole="Pod Admin" userPodId="my-pod-id" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Change lead assignment' })).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Lead')).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only — assigned to another pod/)).toBeInTheDocument();
  });

  it('says "no access" (not a generic error) when the backend returns 404', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLead.mockRejectedValueOnce({ response: { status: 404 } });
    render(<LeadDetailHub leadId="lead-x" userRole="SDR" />);
    expect(await screen.findByText("This lead doesn't exist, or you don't have access to it.")).toBeInTheDocument();
  });

  // The in-place EmailHub reads status + the lead's emails via fetch().
  function stubEmailFetch(emails = []) {
    localStorage.setItem('crm_token', 't');
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(String(url).includes('/email/status')
        ? { nylas_configured: true, connected: true, email: 'me@x.com' }
        : { emails, total: emails.length }),
    })));
  }

  it('opens the in-place email hub in compose mode when Send Email is clicked (no classic switch)', async () => {
    stubEmailFetch();
    const onSwitchToClassic = vi.fn();
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" onSwitchToClassic={onSwitchToClassic} />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    await user.click(screen.getByText('Send Email'));

    expect(await screen.findByPlaceholderText('Subject')).toBeInTheDocument();
    expect(onSwitchToClassic).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('clicking an email in the Emails card opens that conversation in place', async () => {
    const { EmailService } = await import('../../services/api');
    const emails = [
      { id: 'e1', direction: 'outbound', subject: 'Intro', body_preview: 'Hello Kyle', nylas_thread_id: 't1', timestamp: '2026-09-01T10:00:00Z' },
      { id: 'e2', direction: 'outbound', subject: 'Pricing', body_preview: 'Here is pricing', nylas_thread_id: 't2', timestamp: '2026-09-02T10:00:00Z' },
    ];
    EmailService.getEmailsForLead.mockResolvedValueOnce({ emails, total: 2 });
    stubEmailFetch(emails);
    const onSwitchToClassic = vi.fn();
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" onSwitchToClassic={onSwitchToClassic} />);

    // Scoped to the Emails card specifically — "Intro" now also appears in
    // the activity timeline below, since email activity feeds into it too
    // (Instantly.ai sync reuses the same lead_email_activity feed).
    const emailsCard = (await screen.findByRole('heading', { name: 'Emails' })).closest('.bg-white');
    await user.click(await within(emailsCard).findByText('Intro'));

    // Clicked (older) thread is open: its body shows in the sidebar AND the
    // conversation pane; the newer thread's body only in the sidebar.
    await waitFor(() => expect(screen.getAllByText('Hello Kyle').length).toBeGreaterThan(1));
    expect(screen.getAllByText('Here is pricing')).toHaveLength(1);
    expect(onSwitchToClassic).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // RCA 2026-09-03: Quick Actions' old "Update Stage" button just replayed
  // NextBestAction's own CTA and the stage pips have never been clickable
  // (SalesStage.jsx, deliberately) — so a lead sitting anywhere the fixed
  // 2-outcome CTA didn't cover (e.g. Meeting Scheduled) had no way to move
  // to an arbitrary status at all. "Change Stage" now offers every status.
  it('lets a Super Admin move a lead to any stage from Quick Actions\' "Change Stage" picker', async () => {
    const { LeadsService } = await import('../../services/api');
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    const trigger = await screen.findByRole('button', { name: 'Change lead stage' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Meeting Scheduled' }));

    await waitFor(() => expect(LeadsService.updateLead).toHaveBeenCalledWith('lead-1', { status: 'Meeting Scheduled' }));
  });

  it('does not offer the lead\'s current status in the "Change Stage" picker', async () => {
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />); // baseLead.status === 'Calling'
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    await user.click(await screen.findByRole('button', { name: 'Change lead stage' }));
    expect(screen.queryByRole('menuitem', { name: 'Calling' })).not.toBeInTheDocument();
  });

  // RCA 2026-09-28: legacy's header has a Message button (bridges to the
  // Alternate Messenger widget via window._openMessagingWidget/_canMessageLeads,
  // set up by frontend/js/app.js — the always-loaded outer shell); the
  // React page never called either global, so an SDR with SMS/WhatsApp
  // access had no way to text a lead without switching back to classic.
  // RCA 2026-09-29: legacy confirm()s before overwriting research; React
  // regenerated immediately on click.
  it('asks for confirmation before Regenerate overwrites existing research', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLead.mockResolvedValueOnce({
      ...baseLead, research_company: 'a', research_contact: 'b', research_hypothesis: 'c', research_personalization: 'd',
    });
    const user = userEvent.setup();
    render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Regenerate/ }));
    const dialog = screen.getByRole('dialog', { name: 'Regenerate research' });
    expect(LeadsService.triggerAiResearch).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(LeadsService.triggerAiResearch).toHaveBeenCalledWith('lead-1', true));
  });

  describe('Message (Alternate Messenger widget bridge)', () => {
    afterEach(() => {
      delete window._canMessageLeads;
      delete window._openMessagingWidget;
    });

    it('is hidden when the account has no messaging channel enabled', async () => {
      window._canMessageLeads = () => false;
      render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
      await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());
      expect(screen.queryByText('Message')).not.toBeInTheDocument();
    });

    it('opens the Alternate Messenger widget for this lead when clicked', async () => {
      window._canMessageLeads = () => true;
      window._openMessagingWidget = vi.fn();
      const user = userEvent.setup();
      render(<LeadDetailHub leadId="lead-1" userRole="Super Admin" />);
      await waitFor(() => expect(screen.getByText('Kyle Skoog')).toBeInTheDocument());

      await user.click(screen.getByText('Message'));

      expect(window._openMessagingWidget).toHaveBeenCalledWith(
        'lead-1', 'Kyle Skoog', '+16019470694', expect.objectContaining({ id: 'lead-1' })
      );
    });
  });
});
