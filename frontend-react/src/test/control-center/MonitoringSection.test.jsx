import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonitoringSection } from '../../features/control-center/sections/MonitoringSection';
import { AdminService } from '../../services/api';

vi.mock('../../services/api', () => ({
  AdminService: {
    getAuditLogs: vi.fn(),
    getSfLogs: vi.fn(),
    getSfLogDetail: vi.fn(),
    exportSfLogsCsv: vi.fn(),
    getLoginLogs: vi.fn(),
    getFeedback: vi.fn(),
    patchFeedbackStatus: vi.fn(),
    getErrorLogs: vi.fn(),
    getPerfSummary: vi.fn(),
    getClaudeLogs: vi.fn(),
  },
}));

const emptyAudit = { data: [], total: 0, page: 1, per_page: 20, pages: 1 };
const emptySf = { logs: [], total: 0, page: 1, per_page: 20, total_pages: 1 };
const emptyLogins = { data: [], total: 0, page: 1, per_page: 20, pages: 1 };
const emptyFeedback = { data: [], total: 0, page: 1, per_page: 20, pages: 1 };
const emptyErrorLogs = { items: [], total: 0, page: 1, pages: 1 };

describe('MonitoringSection', () => {
  beforeEach(() => {
    window.__CRM_CAPS__ = { export: true };          // this user may export (the shell publishes it from /api/me/capabilities)
    vi.clearAllMocks();
    AdminService.getAuditLogs.mockResolvedValue(emptyAudit);
    AdminService.getSfLogs.mockResolvedValue(emptySf);
    AdminService.getLoginLogs.mockResolvedValue(emptyLogins);
    AdminService.getFeedback.mockResolvedValue(emptyFeedback);
    AdminService.getErrorLogs.mockResolvedValue(emptyErrorLogs);
    AdminService.exportSfLogsCsv.mockResolvedValue();
  });

  it('defaults to the Audit Log tab and shows its empty state', async () => {
    render(<MonitoringSection />);
    await waitFor(() => expect(AdminService.getAuditLogs).toHaveBeenCalled());
    expect(screen.getByText('No activity found')).toBeInTheDocument();
    expect(AdminService.getSfLogs).not.toHaveBeenCalled();
  });

  it('renders an audit log row with its columns', async () => {
    AdminService.getAuditLogs.mockResolvedValue({
      ...emptyAudit,
      data: [{
        id: 1, lead_name: 'Monica Singh', company: 'Shapoorji',
        from_status: 'Calling', to_status: 'Meeting Scheduled',
        changed_by: 'aditya@t.com', changed_at: new Date().toISOString(),
      }],
      total: 1,
    });
    render(<MonitoringSection />);
    await waitFor(() => expect(screen.getByText('Monica Singh')).toBeInTheDocument());
    expect(screen.getByText('Shapoorji')).toBeInTheDocument();
    expect(screen.getByText('Calling')).toBeInTheDocument();
    expect(screen.getByText('Meeting Scheduled')).toBeInTheDocument();
    expect(screen.getByText('aditya@t.com')).toBeInTheDocument();
  });

  it('switches to the Salesforce Sync Log tab and loads it', async () => {
    render(<MonitoringSection />);
    await waitFor(() => expect(AdminService.getAuditLogs).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /Salesforce Sync Log/ }));
    await waitFor(() => expect(AdminService.getSfLogs).toHaveBeenCalled());
    expect(screen.getByText('No integration logs found')).toBeInTheDocument();
  });

  it('renders an SF log row and opens its detail modal on click', async () => {
    AdminService.getSfLogs.mockResolvedValue({
      ...emptySf,
      logs: [{
        id: 'log-1', timestamp: new Date().toISOString(), operation_type: 'upsert', status: 'success',
        first_name: 'Monica', last_name: 'Singh', email: 'monica@t.com', record_identifier: '003abc',
      }],
      total: 1,
    });
    AdminService.getSfLogDetail.mockResolvedValue({
      id: 'log-1', timestamp: new Date().toISOString(), operation_type: 'upsert', status: 'success',
      sf_object: 'Lead', source_system: 'CRM', record_identifier: '003abc',
      first_name: 'Monica', last_name: 'Singh', email: 'monica@t.com',
      fields_updated: ['Status', 'Email'], error_message: null,
    });

    render(<MonitoringSection />);
    await userEvent.click(screen.getByRole('button', { name: /Salesforce Sync Log/ }));
    await waitFor(() => expect(screen.getByText('Monica Singh')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Monica Singh'));
    await waitFor(() => expect(AdminService.getSfLogDetail).toHaveBeenCalledWith('log-1'));
    expect(await screen.findByText('Log Details')).toBeInTheDocument();
    expect(screen.getByText('Lead')).toBeInTheDocument();
  });

  it('computes the SF log summary stats row from the current page of logs', async () => {
    AdminService.getSfLogs.mockResolvedValue({
      ...emptySf,
      logs: [
        { id: '1', timestamp: new Date().toISOString(), operation_type: 'upsert', status: 'success', first_name: 'A', last_name: 'B' },
        { id: '2', timestamp: new Date().toISOString(), operation_type: 'update', status: 'failed', first_name: 'C', last_name: 'D' },
        { id: '3', timestamp: new Date().toISOString(), operation_type: 'create', status: 'success', first_name: 'E', last_name: 'F' },
      ],
      total: 30,
    });
    render(<MonitoringSection />);
    await userEvent.click(screen.getByRole('button', { name: /Salesforce Sync Log/ }));
    await waitFor(() => expect(screen.getByText('30')).toBeInTheDocument()); // Total Logs

    // "This Page" = 3 logs, Success = 2, Failed = 1 (computed client-side from
    // the current page, matching sf_logs.js:170-193 — total (30) comes from
    // the server response, the other 3 are derived from `logs`).
    expect(screen.getByText('Total Logs').previousSibling).toHaveTextContent('30');
    expect(screen.getByText('This Page').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('Success').previousSibling).toHaveTextContent('2');
    expect(screen.getByText('Failed').previousSibling).toHaveTextContent('1');
  });

  it('toggles auto-refresh on the Salesforce Sync Log tab and polls every 30s', async () => {
    render(<MonitoringSection />);
    await userEvent.click(screen.getByRole('button', { name: /Salesforce Sync Log/ }));
    await waitFor(() => expect(AdminService.getSfLogs).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    try {
      // The checkbox is implicitly labeled by its wrapping <label>text</label>.
      fireEvent.click(screen.getByLabelText('Auto-refresh (30s)'));
      await vi.advanceTimersByTimeAsync(30000);
      await vi.waitFor(() => expect(AdminService.getSfLogs).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(30000);
      await vi.waitFor(() => expect(AdminService.getSfLogs).toHaveBeenCalledTimes(3));
    } finally {
      vi.useRealTimers();
    }
  });

  it('exports the SF sync log as CSV with the current filters', async () => {
    const user = userEvent.setup();
    render(<MonitoringSection />);
    await user.click(screen.getByRole('button', { name: /Salesforce Sync Log/ }));
    await waitFor(() => expect(AdminService.getSfLogs).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(AdminService.exportSfLogsCsv).toHaveBeenCalledTimes(1));
    const [params] = AdminService.exportSfLogsCsv.mock.calls[0];
    expect(params).toMatchObject({ status: '', operation_type: '', sf_object: '' });
  });

  it('shows an error state when the audit feed request fails', async () => {
    AdminService.getAuditLogs.mockRejectedValue(new Error('network down'));
    render(<MonitoringSection />);
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  });

  it('switches to Login History and renders a row', async () => {
    AdminService.getLoginLogs.mockResolvedValue({
      ...emptyLogins,
      data: [{ id: 1, name: 'Aditya Kumar', email: 'aditya@t.com', role: 'SDR', login_at: new Date().toISOString(), logout_at: null, ip_address: '10.0.0.1' }],
      total: 1,
    });
    render(<MonitoringSection />);
    await userEvent.click(screen.getByRole('button', { name: /Login History/ }));
    await waitFor(() => expect(screen.getByText('Aditya Kumar')).toBeInTheDocument());
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('switches to Feedback, renders a row, and patches status on change', async () => {
    AdminService.getFeedback.mockResolvedValue({
      ...emptyFeedback,
      data: [{ id: 'fb-1', type: 'bug', user_name: 'Monica Singh', message: 'Broken filter', status: 'new', created_at: new Date().toISOString() }],
      total: 1,
    });
    AdminService.patchFeedbackStatus.mockResolvedValue({});
    render(<MonitoringSection />);
    await userEvent.click(screen.getByRole('button', { name: /^Feedback/ }));
    await waitFor(() => expect(screen.getByText('Broken filter')).toBeInTheDocument());

    await userEvent.click(screen.getByText('new'));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Resolved/ }));
    await waitFor(() => expect(AdminService.patchFeedbackStatus).toHaveBeenCalledWith('fb-1', 'resolved'));
  });

  it('switches to Error Logs and renders a card', async () => {
    AdminService.getErrorLogs.mockResolvedValue({
      ...emptyErrorLogs,
      items: [{ id: 'e1', severity: 'critical', category: 'api', title: 'Sync failed', created_at: new Date().toISOString(), resolved: false }],
      total: 1,
    });
    render(<MonitoringSection />);
    await userEvent.click(screen.getByRole('button', { name: /Error Logs/ }));
    await waitFor(() => expect(screen.getByText('Sync failed')).toBeInTheDocument());
  });

  it('hides Perf Health for a non-Super-Admin role', async () => {
    render(<MonitoringSection userRole="Admin" />);
    await waitFor(() => expect(AdminService.getAuditLogs).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Perf Health/ })).not.toBeInTheDocument();
  });

  it('shows Perf Health for a Super Admin and loads the snapshot', async () => {
    AdminService.getPerfSummary.mockResolvedValue({
      snapshot_at: new Date().toISOString(), total_requests: 100, data_source: 'db',
      rail_distribution: { OK: 90, ACCEPTABLE: 5, SLOW: 3, CRITICAL: 2 },
      slowest_endpoints: [], index_health: { healthy: true, total_present: 5, total_expected: 5 },
      messenger_health: { healthy: true, errors_today: 0, last_502_at: null },
    });
    render(<MonitoringSection userRole="Super Admin" />);
    await userEvent.click(screen.getByRole('button', { name: /Perf Health/ }));
    await waitFor(() => expect(AdminService.getPerfSummary).toHaveBeenCalledWith({ hours: 24 }));
    expect(await screen.findByText(/Performance Health/)).toBeInTheDocument();
  });

  it('shows Claude Logs only to a Super Admin, with who did what', async () => {
    AdminService.getClaudeLogs.mockResolvedValue({
      data: [
        { id: '1', user: 'Dev Kapoor', email: 'dev@x.com', action: 'CLAUDE_CONNECTOR_READ', tool: 'get_lead', arguments: { lead_id: 'L1' }, ok: true, at: new Date().toISOString() },
        { id: '2', user: 'Dev Kapoor', email: 'dev@x.com', action: 'CLAUDE_CONNECTOR_WRITE', tool: 'add_note', arguments: {}, ok: false, at: new Date().toISOString() },
        { id: '3', user: 'Dev Kapoor', email: 'dev@x.com', action: 'PERSONAL_API_KEY_CREATED', key_name: 'My Claude', ok: true, at: new Date().toISOString() },
      ],
      total: 3, page: 1, per_page: 20, pages: 1,
    });
    const { unmount } = render(<MonitoringSection userRole="Admin" />);
    await waitFor(() => expect(AdminService.getAuditLogs).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Claude Logs/ })).not.toBeInTheDocument();
    unmount();

    render(<MonitoringSection userRole="Super Admin" />);
    await userEvent.click(screen.getByRole('button', { name: /Claude Logs/ }));
    expect(await screen.findByText('get_lead (lead_id: L1)')).toBeInTheDocument();
    expect(screen.getByText('Looked up')).toBeInTheDocument();
    expect(screen.getByText('Refused')).toBeInTheDocument();
    expect(screen.getByText('Key created')).toBeInTheDocument();
    expect(screen.getByText('My Claude')).toBeInTheDocument();
  });
});
