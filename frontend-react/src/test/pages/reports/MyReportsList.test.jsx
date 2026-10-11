import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyReportsList } from '../../../pages/Analytics/reports/MyReportsList';
import { AnalyticsService } from '../../../services/api';

vi.mock('../../../services/api', () => ({
  AnalyticsService: {
    listReports: vi.fn(),
    toggleReport: vi.fn(),
    runReportNow: vi.fn(),
    duplicateReport: vi.fn(),
    deleteReport: vi.fn(),
  },
}));

const sampleReport = {
  id: 'r1',
  name: 'Weekly SDR Report',
  enabled: true,
  components: ['key_metrics', 'sdr_performance'],
  frequency: 'weekly',
  weekday: 0,
  timezone: 'UTC',
  send_hour: 9,
  send_minute: 0,
  recipient_count: 2,
  next_run_at: '2026-08-24T09:00:00Z',
  last_run_at: '2026-08-17T09:00:00Z',
  last_status: 'sent',
};

describe('MyReportsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AnalyticsService.listReports.mockResolvedValue([sampleReport]);
  });

  it('renders reports with schedule/recipient/status info', async () => {
    render(<MyReportsList onCreateNew={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText('Weekly SDR Report')).toBeInTheDocument();
    expect(screen.getByText('2 components')).toBeInTheDocument();
    expect(screen.getByText('2 recipients')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('shows an empty state with a New Report CTA when there are no reports', async () => {
    AnalyticsService.listReports.mockResolvedValue([]);
    render(<MyReportsList onCreateNew={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText(/create a report/i)).toBeInTheDocument();
  });

  it('calls onCreateNew when New Report is clicked', async () => {
    const onCreateNew = vi.fn();
    render(<MyReportsList onCreateNew={onCreateNew} onEdit={() => {}} />);
    await waitFor(() => expect(AnalyticsService.listReports).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /new report/i }));
    expect(onCreateNew).toHaveBeenCalled();
  });

  it('toggles enabled state on click', async () => {
    AnalyticsService.toggleReport.mockResolvedValue({});
    render(<MyReportsList onCreateNew={() => {}} onEdit={() => {}} />);
    await screen.findByText('Enabled');
    await userEvent.click(screen.getByText('Enabled'));
    expect(AnalyticsService.toggleReport).toHaveBeenCalledWith('r1', false);
  });

  it('runs a report now and shows a result toast', async () => {
    AnalyticsService.runReportNow.mockResolvedValue({ status: 'sent' });
    render(<MyReportsList onCreateNew={() => {}} onEdit={() => {}} />);
    await screen.findByText('Weekly SDR Report');
    await userEvent.click(screen.getByTitle('Run Now'));
    expect(AnalyticsService.runReportNow).toHaveBeenCalledWith('r1');
    expect(await screen.findByText('"Weekly SDR Report" sent.')).toBeInTheDocument();
  });

  it('notifies the parent after a run so Report Logs can refresh', async () => {
    AnalyticsService.runReportNow.mockResolvedValue({ status: 'sent' });
    const onLogsChanged = vi.fn();
    render(<MyReportsList onCreateNew={() => {}} onEdit={() => {}} onLogsChanged={onLogsChanged} />);
    await screen.findByText('Weekly SDR Report');
    await userEvent.click(screen.getByTitle('Run Now'));
    await waitFor(() => expect(onLogsChanged).toHaveBeenCalled());
  });

  it('notifies the parent after a delete so Report Logs can drop the cascaded executions', async () => {
    AnalyticsService.deleteReport.mockResolvedValue({ ok: true });
    const onLogsChanged = vi.fn();
    render(<MyReportsList onCreateNew={() => {}} onEdit={() => {}} onLogsChanged={onLogsChanged} />);
    await screen.findByText('Weekly SDR Report');
    await userEvent.click(screen.getByTitle('Delete'));
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    await userEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(onLogsChanged).toHaveBeenCalled());
  });

  it('deletes a report after confirmation', async () => {
    AnalyticsService.deleteReport.mockResolvedValue({ ok: true });
    render(<MyReportsList onCreateNew={() => {}} onEdit={() => {}} />);
    await screen.findByText('Weekly SDR Report');
    await userEvent.click(screen.getByTitle('Delete'));
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    await userEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(AnalyticsService.deleteReport).toHaveBeenCalledWith('r1');
  });

  it('calls onEdit when Edit is clicked', async () => {
    const onEdit = vi.fn();
    render(<MyReportsList onCreateNew={() => {}} onEdit={onEdit} />);
    await screen.findByText('Weekly SDR Report');
    await userEvent.click(screen.getByTitle('Edit'));
    expect(onEdit).toHaveBeenCalledWith(sampleReport);
  });
});
