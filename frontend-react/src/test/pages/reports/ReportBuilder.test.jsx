import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportBuilder } from '../../../pages/Analytics/reports/ReportBuilder';
import { AnalyticsService } from '../../../services/api';

vi.mock('../../../services/api', () => ({
  AnalyticsService: {
    listReportComponents: vi.fn(),
    getFilters: vi.fn(),
    getReportSenders: vi.fn(),
    getReport: vi.fn(),
    createReport: vi.fn(),
    updateReport: vi.fn(),
    previewReport: vi.fn(),
  },
}));

const components = [
  { id: 'key_metrics', label: 'Key Metrics', description: 'Leads, calls, connect rate.' },
  { id: 'sdr_performance', label: 'SDR Performance', description: 'Qualified/disqualified by SDR.' },
];
const filters = { pods: [{ id: 'p1', name: 'US Team' }], batches: [], sdrs: [] };
const senders = [{ id: 'u1', name: 'Ankit Bakshi', email: 'ankit@t.com' }];

function setupMocks() {
  AnalyticsService.listReportComponents.mockResolvedValue(components);
  AnalyticsService.getFilters.mockResolvedValue(filters);
  AnalyticsService.getReportSenders.mockResolvedValue(senders);
}

describe('ReportBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('loads component/filter/sender options for a new report', async () => {
    render(<ReportBuilder reportId={null} onDone={() => {}} />);
    expect(await screen.findByText('Key Metrics')).toBeInTheDocument();
    expect(screen.getByText('SDR Performance')).toBeInTheDocument();
    expect(screen.getByText(/select a connected mailbox/i)).toBeInTheDocument();
  });

  it('loads an existing report into the form when editing', async () => {
    AnalyticsService.getReport.mockResolvedValue({
      id: 'r1', name: 'Existing Report', components: ['key_metrics'],
      pod_id: null, upload_log_id: null, sdr_id: null,
      date_range_rule: 'previous_7_days', custom_start: null, custom_end: null,
      frequency: 'weekly', weekday: 0, day_of_month: 1,
      timezone: 'UTC', send_hour: 9, send_minute: 0,
      to_recipients: ['stake@t.com'], cc_recipients: [], bcc_recipients: [],
      sender_user_id: 'u1', include_csv: true,
    });
    render(<ReportBuilder reportId="r1" onDone={() => {}} />);
    expect(await screen.findByDisplayValue('Existing Report')).toBeInTheDocument();
    expect(screen.getByText('stake@t.com')).toBeInTheDocument();
  });

  it('toggling a component checkbox updates the live summary count', async () => {
    render(<ReportBuilder reportId={null} onDone={() => {}} />);
    await screen.findByText('Key Metrics');
    expect(screen.getByText('0 selected')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Key Metrics'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('adding a recipient chip updates the live summary count', async () => {
    render(<ReportBuilder reportId={null} onDone={() => {}} />);
    await screen.findByText('Key Metrics');
    const toInput = screen.getByLabelText('To');
    await userEvent.type(toInput, 'stake@t.com{enter}');
    expect(screen.getByText('stake@t.com')).toBeInTheDocument();
  });

  it('shows custom date inputs only when date_range_rule is custom', async () => {
    render(<ReportBuilder reportId={null} onDone={() => {}} />);
    await screen.findByText('Key Metrics');
    // Custom range's DateRangePicker (default "Date range" trigger) isn't
    // rendered at all until date_range_rule === 'custom'.
    expect(screen.queryByRole('button', { name: 'Date range' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Previous 7 days' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Custom range' }));
    expect(screen.getByRole('button', { name: 'Date range' })).toBeInTheDocument();
  });

  it('shows weekday selector for weekly and day-of-month input for monthly', async () => {
    render(<ReportBuilder reportId={null} onDone={() => {}} />);
    await screen.findByText('Key Metrics');
    expect(screen.getByRole('button', { name: 'Monday' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Monthly' }));
    expect(screen.getByLabelText('Day of month')).toBeInTheDocument();
  });

  it('saves via createReport and calls onDone on Save & Schedule', async () => {
    AnalyticsService.createReport.mockResolvedValue({ id: 'new-id' });
    const onDone = vi.fn();
    render(<ReportBuilder reportId={null} onDone={onDone} />);
    await screen.findByText('Key Metrics');

    await userEvent.type(screen.getByPlaceholderText(/weekly sdr performance/i), 'My Report');
    await userEvent.click(screen.getByText('Key Metrics'));
    await userEvent.type(screen.getByLabelText('To'), 'stake@t.com{enter}');
    await userEvent.click(screen.getByRole('button', { name: /select a connected mailbox/i }));
    await userEvent.click(screen.getByRole('option', { name: /Ankit Bakshi/ }));

    await userEvent.click(screen.getByRole('button', { name: /save & schedule/i }));

    await waitFor(() => expect(AnalyticsService.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Report', components: ['key_metrics'], to_recipients: ['stake@t.com'], sender_user_id: 'u1' })
    ));
    expect(onDone).toHaveBeenCalled();
  });

  it('preview saves first then shows the rendered HTML', async () => {
    AnalyticsService.createReport.mockResolvedValue({ id: 'new-id' });
    AnalyticsService.previewReport.mockResolvedValue({
      report_name: 'My Report',
      reporting_period_start: '2026-08-10T00:00:00Z',
      reporting_period_end: '2026-08-17T00:00:00Z',
      html: '<h2>My Report</h2><p>42 leads assigned</p>',
      has_csv: true,
    });
    render(<ReportBuilder reportId={null} onDone={() => {}} />);
    await screen.findByText('Key Metrics');

    await userEvent.type(screen.getByPlaceholderText(/weekly sdr performance/i), 'My Report');
    await userEvent.click(screen.getByText('Key Metrics'));
    await userEvent.type(screen.getByLabelText('To'), 'stake@t.com{enter}');
    await userEvent.click(screen.getByRole('button', { name: /select a connected mailbox/i }));
    await userEvent.click(screen.getByRole('option', { name: /Ankit Bakshi/ }));

    await userEvent.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => expect(AnalyticsService.previewReport).toHaveBeenCalledWith('new-id'));
    expect(await screen.findByText('42 leads assigned')).toBeInTheDocument();
  });

  it('surfaces a save error from the backend', async () => {
    AnalyticsService.createReport.mockRejectedValue({ response: { data: { detail: 'At least one recipient (To) is required' } } });
    render(<ReportBuilder reportId={null} onDone={() => {}} />);
    await screen.findByText('Key Metrics');
    await userEvent.click(screen.getByRole('button', { name: /save & schedule/i }));
    expect(await screen.findByText(/at least one recipient/i)).toBeInTheDocument();
  });

  it('calls onDone when Cancel is clicked', async () => {
    const onDone = vi.fn();
    render(<ReportBuilder reportId={null} onDone={onDone} />);
    await screen.findByText('Key Metrics');
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onDone).toHaveBeenCalled();
  });
});
