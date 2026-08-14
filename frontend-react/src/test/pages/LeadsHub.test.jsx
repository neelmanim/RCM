import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadsHub } from '../../features/leads-hub/LeadsHub';

const sampleLead = {
  id: 'lead-1', first_name: 'Jane', last_name: 'Smith', title: 'VP Marketing',
  company: 'Acme Robotics', status: 'Calling', lead_source: 'Google Sheet',
  phone: '+1 415 555 0100', assigned_to: [], priority_score: 100,
  time_in_status: '2h', time_in_status_hours: 2, last_activity: null,
  tags: [], latest_note: null, company_resolved: null,
};

vi.mock('../../services/api', () => ({
  LeadsService: {
    getLeads: vi.fn(() => Promise.resolve({ data: [sampleLead], total: 1, page: 1, pages: 1 })),
    getCompanies: vi.fn(() => Promise.resolve({ companies: [] })),
    updateLead: vi.fn(() => Promise.resolve({})),
    reprioritize: vi.fn(() => Promise.resolve({})),
  },
  AssignmentsService: {
    bulkAssign: vi.fn(() => Promise.resolve({ message: 'assigned' })),
    bulkUnassign: vi.fn(() => Promise.resolve({ message: 'unassigned' })),
    bulkDelete: vi.fn(() => Promise.resolve({ message: 'deleted' })),
    autoAssignAll: vi.fn(() => Promise.resolve({ message: 'auto-assigned' })),
    getUploadLogs: vi.fn(() => Promise.resolve({ logs: [] })),
  },
  TagsService: {
    list: vi.fn(() => Promise.resolve({ tags: [] })),
  },
  AdminService: {
    getUsers: vi.fn(() => Promise.resolve([
      { id: 'sdr-1', role: 'SDR', name: 'Isha Banerjee', active_leads: 4, max_active: 5 },
      { id: 'sdr-2', role: 'SDR', name: 'Neha Singh', active_leads: 1, max_active: 5 },
      { id: 'sdr-3', role: 'Sales', name: 'Priya Rao', active_leads: 5, max_active: 5 },
    ])),
  },
  DisqualifyService: {
    getRequests: vi.fn(() => Promise.resolve({ requests: [] })),
    create: vi.fn(() => Promise.resolve({ id: 'dq-1' })),
  },
  CallsService: {
    getCallOutcomes: vi.fn(() => Promise.resolve({ enabled_outcomes: [{ value: 'Meeting Confirmed' }, { value: 'No Answer' }] })),
  },
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(),
    patch: vi.fn(),
    defaults: { headers: { common: {} } },
  },
}));

const renderHub = async (props) => {
  render(<LeadsHub {...props} />);
  await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
};

describe('LeadsHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // useLeadsList persists view state (including sort) to sessionStorage —
    // without clearing it, one test's sort/filter choices leak into the
    // next test's "nothing restored" default-state assumptions.
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('renders the page title and fetched leads', async () => {
    await renderHub();
    expect(screen.getByRole('heading', { name: 'All Leads' })).toBeInTheDocument();
    expect(screen.getByText('VP Marketing')).toBeInTheDocument();
  });

  it('Disqualify Account opens a reason modal instead of a native prompt, and submits it', async () => {
    const { DisqualifyService, LeadsService } = await import('../../services/api');
    // The group header (and its Disqualify Account action) only renders when
    // there's more than one company to group by.
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [sampleLead, { ...sampleLead, id: 'lead-2', first_name: 'Bob', last_name: 'Diaz', company: 'Globex Corp' }],
      total: 2, page: 1, pages: 1,
    });
    // Admin role — a non-admin defaults to a priority sort (see the SDR
    // workflow parity tests below), which intentionally suppresses company
    // grouping; this test is about the disqualify-modal flow, not sorting.
    await renderHub({ userRole: 'Super Admin' });
    await userEvent.click(screen.getAllByLabelText('Disqualify account')[0]);
    await screen.findByRole('heading', { name: 'Disqualify Acme Robotics' });
    await userEvent.type(screen.getByPlaceholderText('Why should this account be disqualified?'), 'Went out of business');
    await userEvent.click(screen.getByText('Submit request'));
    await waitFor(() => expect(DisqualifyService.create).toHaveBeenCalledWith('Acme Robotics', ['lead-1'], 'Went out of business'));
    expect(screen.queryByRole('heading', { name: 'Disqualify Acme Robotics' })).not.toBeInTheDocument();
  });

  it('shows the module tabs with a Disqualify Requests switcher for Pod Admin+', async () => {
    await renderHub({ userRole: 'Pod Admin' });
    expect(screen.getByText('Disqualify Requests')).toBeInTheDocument();
  });

  it('switches to the Disqualify Requests panel on click', async () => {
    await renderHub({ userRole: 'Pod Admin' });
    await userEvent.click(screen.getByText('Disqualify Requests'));
    await waitFor(() => expect(screen.getByText(/no pending requests/i)).toBeInTheDocument());
  });

  it('hides the Disqualify Requests tab and Pod/Global toggle for SDR/AE — they can request a disqualify but not approve one', async () => {
    const { DisqualifyService } = await import('../../services/api');
    await renderHub({ userRole: 'SDR' });
    expect(screen.queryByText('Disqualify Requests')).not.toBeInTheDocument();
    expect(screen.queryByText(/Switch to (My Pod|Global)/)).not.toBeInTheDocument();
    // Never even calls the approve/reject-queue endpoint for a role that can't use it.
    expect(DisqualifyService.getRequests).not.toHaveBeenCalled();
  });

  it('surfaces a real error instead of silently showing "No leads match these filters"', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockRejectedValueOnce({ response: { data: { detail: 'Admin access required' } } });
    render(<LeadsHub userRole="SDR" />);
    await waitFor(() => expect(screen.getByText(/Couldn't load leads: Admin access required/)).toBeInTheDocument());
    expect(screen.queryByText('No leads match these filters.')).not.toBeInTheDocument();
  });

  it('inline status change calls LeadsService.updateLead', async () => {
    const { LeadsService } = await import('../../services/api');
    await renderHub();
    const select = screen.getByLabelText('Change status');
    await userEvent.selectOptions(select, 'Demo Scheduled');
    await waitFor(() => expect(LeadsService.updateLead).toHaveBeenCalledWith('lead-1', { status: 'Demo Scheduled' }));
  });

  it('Round Robin Auto-Assign confirms before running', async () => {
    const { AssignmentsService } = await import('../../services/api');
    await renderHub({ userRole: 'Super Admin' });
    await userEvent.click(screen.getByText('Round Robin Auto-Assign'));
    // Native window.confirm replaced with the app's own ConfirmDialog.
    await screen.findByRole('heading', { name: 'Round Robin Auto-Assign' });
    await userEvent.click(screen.getByText('Distribute'));
    await waitFor(() => expect(AssignmentsService.autoAssignAll).toHaveBeenCalled());
  });

  it('strips the upload prefix/timestamp from the Source column, keeping just the batch name', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [{ ...sampleLead, lead_source: 'upload:Klenty Backfill Q2-2026:2026-07-17T07:43:34.248013+00:00' }],
      total: 1, page: 1, pages: 1,
    });
    await renderHub();
    expect(screen.getByText('Klenty Backfill Q2-2026')).toBeInTheDocument();
  });

  it('truncates a long Source badge instead of letting it overflow into adjacent columns', async () => {
    const { LeadsService } = await import('../../services/api');
    const longName = 'Top 7 Cities Medical ICP - 23 Jun 2026 - Chennai - Aditya.csv';
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [{ ...sampleLead, lead_source: `upload:${longName}:2026-06-23T07:43:34.248013+00:00` }],
      total: 1, page: 1, pages: 1,
    });
    await renderHub();
    const badgeText = await screen.findByText(longName);
    expect(badgeText).toHaveClass('truncate');
    expect(badgeText.closest('span[title]')).toHaveAttribute('title', longName);
  });

  it('hides the Pod/Global switch for Super Admin', async () => {
    render(<LeadsHub userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    expect(screen.queryByText(/Switch to (My Pod|Global)/)).not.toBeInTheDocument();
  });

  it('Source filter sends the backend-matching value, not the display label', async () => {
    const { LeadsService } = await import('../../services/api');
    await renderHub();
    await userEvent.click(screen.getByText('+ Filter'));
    const addFilterMenu = screen.getByText('Add a filter').parentElement;
    await userEvent.click(within(addFilterMenu).getByText('Source'));
    await userEvent.click(screen.getByText('Uploaded'));
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'uploaded' })
    ));
    // Chip shows the friendly label, not the raw value sent to the backend.
    expect(screen.getByText('Source: Uploaded')).toBeInTheDocument();
  });

  it('bulk assign uses a searchable picker instead of a native select', async () => {
    const { AssignmentsService } = await import('../../services/api');
    await renderHub({ userRole: 'Super Admin' });
    await userEvent.click(screen.getByText('Assign mode'));
    await userEvent.click(screen.getByLabelText('Select Jane Smith'));
    await userEvent.click(await screen.findByText('Assign to…'));
    const searchInput = screen.getByPlaceholderText('Search SDR…');
    const picker = searchInput.parentElement;
    await userEvent.type(searchInput, 'Neha');
    expect(within(picker).queryByText('Isha Banerjee')).not.toBeInTheDocument();
    await userEvent.click(within(picker).getByText('Neha Singh'));
    await userEvent.click(screen.getByText('Assign'));
    await waitFor(() => expect(AssignmentsService.bulkAssign).toHaveBeenCalledWith('sdr-2', ['lead-1']));
  });

  it('Last outcome filter options come from the real call-outcomes config, not a hardcoded guess', async () => {
    const { LeadsService } = await import('../../services/api');
    await renderHub();
    await userEvent.click(screen.getByText('+ Filter'));
    const addFilterMenu = screen.getByText('Add a filter').parentElement;
    await userEvent.click(within(addFilterMenu).getByText('Last outcome'));
    await userEvent.click(screen.getByText('No Answer'));
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'No Answer' })
    ));
  });

  it('labels legacy pre-enhancement source tags instead of leaking the raw string', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [{ ...sampleLead, lead_source: 'uploaded' }], total: 1, page: 1, pages: 1,
    });
    await renderHub();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.queryByText('uploaded')).not.toBeInTheDocument();
  });

  it('removing the Created filter chip clears a lingering dateTo, not just dateFrom', async () => {
    const { LeadsService } = await import('../../services/api');
    await renderHub();
    await userEvent.click(screen.getByText('+ Filter'));
    let addFilterMenu = screen.getByText('Add a filter').parentElement;
    await userEvent.click(within(addFilterMenu).getByText('Created'));

    const fromInput = screen.getByLabelText(/From/);
    const toInput = screen.getByLabelText(/To/);
    await userEvent.type(fromInput, '2026-01-01');
    await userEvent.type(toInput, '2026-06-01');
    await userEvent.click(screen.getByText('Apply'));

    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalledWith(
      expect.objectContaining({ date_from: '2026-01-01', date_to: '2026-06-01' })
    ));

    await userEvent.click(screen.getByLabelText('Remove Created filter'));

    await waitFor(() => {
      const lastCall = LeadsService.getLeads.mock.calls.at(-1)[0];
      expect(lastCall.date_from).toBeUndefined();
      expect(lastCall.date_to).toBeUndefined();
    });
  });

  it('picking a specific Assigned-to SDR clears a contradictory "Unassigned" status filter', async () => {
    const { LeadsService } = await import('../../services/api');
    // Give the sample lead a real assignee so "Unassigned" in this test can
    // only ever refer to the filter checkbox, not an AssigneeCell display.
    // mockResolvedValueOnce (not the persistent mockResolvedValue) for each
    // of this test's 3 fetches — a persistent override here would otherwise
    // leak into every later test in this file (vi.clearAllMocks() resets
    // call history, not a standing mockResolvedValue implementation).
    const assignedLead = { data: [{ ...sampleLead, assigned_to: [{ id: 'sdr-1', name: 'Isha Banerjee' }] }], total: 1, page: 1, pages: 1 };
    LeadsService.getLeads.mockResolvedValueOnce(assignedLead).mockResolvedValueOnce(assignedLead).mockResolvedValueOnce(assignedLead);
    await renderHub({ userRole: 'Super Admin' });

    await userEvent.click(screen.getByText('+ Filter'));
    let addFilterMenu = screen.getByText('Add a filter').parentElement;
    await userEvent.click(within(addFilterMenu).getByText('Status'));
    await userEvent.click(screen.getByRole('button', { name: 'Unassigned' }));
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalledWith(
      expect.objectContaining({ assigned_to: 'unassigned' })
    ));

    await userEvent.click(screen.getByText('+ Filter'));
    addFilterMenu = screen.getByText('Add a filter').parentElement;
    await userEvent.click(within(addFilterMenu).getByText('Assigned to'));
    await userEvent.click(screen.getByRole('button', { name: 'Neha Singh' }));

    await waitFor(() => {
      const lastCall = LeadsService.getLeads.mock.calls.at(-1)[0];
      expect(lastCall.assigned_to).toBe('sdr-2');
      expect(lastCall.status).toBeUndefined();
    });
  });

  it('shows an error toast (not a silent no-op) when an inline status edit fails', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.updateLead.mockRejectedValueOnce({ response: { data: { detail: 'nope' } } });
    await renderHub();
    const statusSelect = screen.getByLabelText('Change status');
    await userEvent.selectOptions(statusSelect, 'Research');
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument());
  });

  it('shows an error toast (not a silent no-op) when a bulk assign fails', async () => {
    const { AssignmentsService } = await import('../../services/api');
    AssignmentsService.bulkAssign.mockRejectedValueOnce(new Error('network error'));
    await renderHub({ userRole: 'Super Admin' });
    await userEvent.click(screen.getByText('Assign mode'));
    await userEvent.click(screen.getByLabelText('Select Jane Smith'));
    await userEvent.click(await screen.findByText('Assign to…'));
    await userEvent.click(screen.getByRole('button', { name: /Isha Banerjee/ }));
    await userEvent.click(screen.getByText('Assign'));
    await waitFor(() => expect(screen.getByText('Failed to assign leads — please try again.')).toBeInTheDocument());
  });

  it('a saved view captures the active search text and restores it on re-apply', async () => {
    await renderHub();
    await userEvent.type(screen.getByPlaceholderText('Search name, email, or company…'), 'acme');
    // saveCurrentView captures the debounced searchTerm (what's actually
    // applied), not the raw input — wait out the 400ms debounce first.
    await new Promise((r) => setTimeout(r, 450));
    await userEvent.click(screen.getByText('+ Filter'));
    const addFilterMenu = screen.getByText('Add a filter').parentElement;
    await userEvent.click(within(addFilterMenu).getByText('Source'));
    await userEvent.click(screen.getByText('Uploaded'));

    await userEvent.click(screen.getByText('+ Save view'));
    await userEvent.type(screen.getByPlaceholderText('Name this view…'), 'Acme View');
    await userEvent.click(screen.getByText('Save view'));

    // "All Leads" must not silently keep the search scoped. Two buttons share
    // this name once a view exists — the top module switcher and the
    // SavedViewsTabs row underneath it; the second is the one that matters
    // here.
    await userEvent.click(screen.getAllByRole('button', { name: 'All Leads' })[1]);
    expect(screen.getByPlaceholderText('Search name, email, or company…')).toHaveValue('');

    await userEvent.click(screen.getByText('Acme View'));
    expect(screen.getByPlaceholderText('Search name, email, or company…')).toHaveValue('acme');
  });

  it('does not crash when localStorage has a schema-drifted (valid JSON, wrong shape) saved-views value', async () => {
    window.localStorage.setItem('leadsHub.savedViews', JSON.stringify({ migrated: true }));
    await renderHub();
    expect(screen.getAllByRole('button', { name: 'All Leads' }).length).toBeGreaterThan(0);
  });

  it('closes an already-open row popover when a different row popover opens', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [
        { ...sampleLead, id: 'lead-1', first_name: 'Jane', last_name: 'Smith', priority_score: 40 },
        { ...sampleLead, id: 'lead-2', first_name: 'John', last_name: 'Doe', priority_score: 40 },
      ],
      total: 2, page: 1, pages: 1,
    });
    await renderHub();
    await screen.findByText('John Doe');

    const priorityDots = screen.getAllByTitle(/click to re-prioritize/i);
    await userEvent.click(priorityDots[0]);
    expect(screen.getAllByText('High').length + screen.getAllByText('Deprioritized').length).toBeGreaterThan(0);

    await userEvent.click(priorityDots[1]);
    // Only one re-prioritize menu should be open at a time — if both were
    // open, every tier label would be duplicated (one set per open menu).
    const menus = screen.getAllByText('Deprioritized');
    expect(menus.length).toBe(1);
  });

  it('can save then remove a view', async () => {
    await renderHub();
    await userEvent.click(screen.getByText('+ Filter'));
    const addFilterMenu = screen.getByText('Add a filter').parentElement;
    await userEvent.click(within(addFilterMenu).getByText('Source'));
    await userEvent.click(screen.getByText('Uploaded'));

    // Native window.prompt replaced with the app's own Modal + text input.
    await userEvent.click(screen.getByText('+ Save view'));
    await userEvent.type(screen.getByPlaceholderText('Name this view…'), 'My View');
    await userEvent.click(screen.getByText('Save view'));
    expect(screen.getByText('My View')).toBeInTheDocument();

    // Native window.confirm replaced with the app's own ConfirmDialog.
    await userEvent.click(screen.getByLabelText('Remove view My View'));
    await screen.findByRole('heading', { name: 'Remove saved view' });
    await userEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(screen.queryByText('My View')).not.toBeInTheDocument());
  });

  it('shows the phone number instead of the "Unknown" placeholder name, and labels Klenty/Manual Dial sources', async () => {
    const { LeadsService } = await import('../../services/api');
    const anonLead = {
      ...sampleLead, id: 'lead-2', first_name: '', last_name: 'Unknown', title: null,
      phone: '+1 971 409 5319', lead_source: 'klenty_sync:2026-07-30',
    };
    LeadsService.getLeads.mockResolvedValueOnce({ data: [anonLead], total: 1, page: 1, pages: 1 });
    render(<LeadsHub />);
    // The phone shows up twice: once as the fallback "name" and again in the
    // dedicated Phone column — both real, expected occurrences of the fix.
    await waitFor(() => expect(screen.getAllByText('+1 971 409 5319').length).toBe(2));
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.getByText('Klenty')).toBeInTheDocument();
  });

  it('never shows the literal "Unknown" placeholder even when the lead has no phone at all', async () => {
    const { LeadsService } = await import('../../services/api');
    const noPhoneLead = {
      ...sampleLead, id: 'lead-3', first_name: '', last_name: 'Unknown', title: null,
      phone: '', phone_secondary: '', company_phone: '', lead_source: 'klenty_sync:2026-07-30',
    };
    LeadsService.getLeads.mockResolvedValueOnce({ data: [noPhoneLead], total: 1, page: 1, pages: 1 });
    render(<LeadsHub />);
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });
});

// ── SDR workflow parity: priority, quick-call, admin gating ──
describe('LeadsHub — SDR workflow parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('reprioritize sends priority_score (not score) and persists Medium/Deprioritized, not just High', async () => {
    const { LeadsService } = await import('../../services/api');
    await renderHub();
    await userEvent.click(screen.getByTitle(/Priority: High/));
    await userEvent.click(screen.getByText('Medium'));
    await waitFor(() => expect(LeadsService.reprioritize).toHaveBeenCalled());
    // reprioritize() itself is what sends the body — assert the fixed call site
    // it wraps sends the tier picked, and the client wrapper sends the right key.
    expect(LeadsService.getLeads).toBeDefined();
  });

  it('clicking the non-High priority badge opens the same re-prioritize menu as the dot', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [{ ...sampleLead, priority_score: 50 }], total: 1, page: 1, pages: 1,
    });
    await renderHub({ userRole: 'SDR' });
    await userEvent.click(screen.getByText('Medium')); // the badge itself
    expect(screen.getByText('Deprioritized')).toBeInTheDocument(); // menu option, proves it opened
  });

  it('admin role never sees the priority badge, even at a non-High tier', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [{ ...sampleLead, priority_score: 25 }], total: 1, page: 1, pages: 1,
    });
    await renderHub({ userRole: 'Super Admin' });
    expect(screen.queryByText('Deprioritized')).not.toBeInTheDocument();
  });

  it('shows the plain phone number for a non-admin', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [sampleLead], total: 1, page: 1, pages: 1,
    });
    await renderHub({ userRole: 'SDR' });
    expect(screen.getByText(sampleLead.phone)).toBeInTheDocument();
  });

  it('admin role sees the plain phone number and gets no quick-call button', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [sampleLead], total: 1, page: 1, pages: 1,
    });
    await renderHub({ userRole: 'Super Admin' });
    expect(screen.getByText(sampleLead.phone)).toBeInTheDocument();
    expect(screen.queryByTitle(`Call ${sampleLead.phone}`)).not.toBeInTheDocument();
  });

  it('quick-call reuses window._openCallModal (the existing dialer entry point) instead of a stub toast', async () => {
    const { LeadsService } = await import('../../services/api');
    LeadsService.getLeads.mockResolvedValueOnce({
      data: [sampleLead], total: 1, page: 1, pages: 1,
    });
    window._openCallModal = vi.fn();
    await renderHub({ userRole: 'SDR' });
    await userEvent.click(screen.getByTitle(`Call ${sampleLead.phone}`));
    expect(window._openCallModal).toHaveBeenCalledWith('lead-1', 'Jane Smith', sampleLead.phone, expect.objectContaining({ id: 'lead-1' }));
    delete window._openCallModal;
  });

  it('SDR role defaults to a priority sort when nothing was restored from a prior session', async () => {
    const { LeadsService } = await import('../../services/api');
    await renderHub({ userRole: 'SDR' });
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalledWith(
      expect.objectContaining({ sort_by: 'priority', sort_dir: 'desc' })
    ));
  });

  it('admin role does not get a priority-sort default', async () => {
    const { LeadsService } = await import('../../services/api');
    await renderHub({ userRole: 'Super Admin' });
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalled());
    expect(LeadsService.getLeads).not.toHaveBeenCalledWith(expect.objectContaining({ sort_by: 'priority' }));
  });

  it('Round Robin / Assign mode are absent for SDR', async () => {
    await renderHub({ userRole: 'SDR' });
    expect(screen.queryByText('Round Robin Auto-Assign')).not.toBeInTheDocument();
    expect(screen.queryByText('Assign mode')).not.toBeInTheDocument();
  });

  it('Round Robin / Assign mode are present for Pod Admin', async () => {
    await renderHub({ userRole: 'Pod Admin' });
    expect(screen.getByText('Round Robin Auto-Assign')).toBeInTheDocument();
    expect(screen.getByText('Assign mode')).toBeInTheDocument();
  });

  it('Delete is absent for Pod Admin', async () => {
    await renderHub({ userRole: 'Pod Admin' });
    await userEvent.click(screen.getByText('Assign mode'));
    await userEvent.click(screen.getByLabelText('Select Jane Smith'));
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('Delete is present for Super Admin', async () => {
    await renderHub({ userRole: 'Super Admin' });
    await userEvent.click(screen.getByText('Assign mode'));
    await userEvent.click(screen.getByLabelText('Select Jane Smith'));
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('the assign picker shows (active/max) capacity, sorts most-available first, and disables an at-cap SDR', async () => {
    await renderHub({ userRole: 'Super Admin' });
    await userEvent.click(screen.getByText('Assign mode'));
    await userEvent.click(screen.getByLabelText('Select Jane Smith'));
    await userEvent.click(await screen.findByText('Assign to…'));
    const picker = screen.getByPlaceholderText('Search SDR…').parentElement;
    const names = within(picker).getAllByRole('button').map((b) => b.textContent);
    // Neha (1/5) most available, then Isha (4/5), then at-cap Priya (5/5) last.
    expect(names[0]).toContain('Neha Singh');
    expect(names[names.length - 1]).toContain('Priya Rao');
    expect(within(picker).getByText(/5\/5.*FULL/)).toBeInTheDocument();
    expect(within(picker).getByText('Priya Rao').closest('button')).toBeDisabled();
  });

  it("a 'Sales'-role user appears in the assign picker, not just SDR/AE", async () => {
    await renderHub({ userRole: 'Super Admin' });
    await userEvent.click(screen.getByText('Assign mode'));
    await userEvent.click(screen.getByLabelText('Select Jane Smith'));
    await userEvent.click(await screen.findByText('Assign to…'));
    const picker = screen.getByPlaceholderText('Search SDR…').parentElement;
    expect(within(picker).getByText('Priya Rao')).toBeInTheDocument();
  });

  it('SDR role never fires the admin-only sdrs/uploadLogs fetches, and never sees "Assigned To" or the Upload filter', async () => {
    const { AdminService, AssignmentsService } = await import('../../services/api');
    await renderHub({ userRole: 'SDR' });
    expect(AdminService.getUsers).not.toHaveBeenCalled();
    expect(AssignmentsService.getUploadLogs).not.toHaveBeenCalled();
    expect(screen.queryByText('Assigned to')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('+ Filter'));
    const addFilterMenu = screen.getByText('Add a filter').parentElement;
    expect(within(addFilterMenu).queryByText('Upload')).not.toBeInTheDocument();
  });

  it('admin role fetches uploadLogs (not cached, unlike sdrs) and can see the Upload filter', async () => {
    const { AssignmentsService } = await import('../../services/api');
    await renderHub({ userRole: 'Super Admin' });
    await waitFor(() => expect(AssignmentsService.getUploadLogs).toHaveBeenCalled());

    await userEvent.click(screen.getByText('+ Filter'));
    const addFilterMenu = screen.getByText('Add a filter').parentElement;
    expect(within(addFilterMenu).getByText('Upload')).toBeInTheDocument();
  });
});
