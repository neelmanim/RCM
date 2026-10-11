import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportLogs } from '../../../pages/Analytics/reports/ReportLogs';
import { AnalyticsService } from '../../../services/api';

vi.mock('../../../services/api', () => ({
  AnalyticsService: {
    listReports: vi.fn(),
    listReportExecutions: vi.fn(),
  },
}));

const execution = {
  id: 'e1',
  report_id: 'r1',
  report_name: 'Weekly SDR Report',
  status: 'sent',
  triggered_by: 'scheduler',
  started_at: '2026-08-17T09:00:00Z',
  reporting_period_start: '2026-08-10T00:00:00Z',
  reporting_period_end: '2026-08-17T00:00:00Z',
  recipients: { to: ['a@t.com'], cc: [], bcc: [] },
  failure_reason: null,
};

const executionsPage = (items) => ({ items, total: items.length, page: 1, per_page: 25, pages: 1 });

describe('ReportLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AnalyticsService.listReports.mockResolvedValue([{ id: 'r1', name: 'Weekly SDR Report' }]);
    AnalyticsService.listReportExecutions.mockResolvedValue(executionsPage([execution]));
  });

  it('renders execution rows with status and recipient count', async () => {
    render(<ReportLogs />);
    // The report picker's options no longer live in the DOM until its
    // popover is opened, so "Weekly SDR Report" now only appears once — the
    // table cell.
    await waitFor(() => expect(screen.getByText('Weekly SDR Report')).toBeInTheDocument());
    expect(screen.getByText('sent')).toBeInTheDocument();
    expect(screen.getByText('scheduler')).toBeInTheDocument();
  });

  it('shows an empty state when no executions match filters', async () => {
    AnalyticsService.listReportExecutions.mockResolvedValue(executionsPage([]));
    render(<ReportLogs />);
    expect(await screen.findByText(/no report executions/i)).toBeInTheDocument();
  });

  it('refetches with the status filter when changed', async () => {
    render(<ReportLogs />);
    await waitFor(() => expect(AnalyticsService.listReportExecutions).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'All Statuses' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Failed' }));
    await waitFor(() => expect(AnalyticsService.listReportExecutions).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed' })
    ));
  });

  it('shows a truncated failure reason when present', async () => {
    AnalyticsService.listReportExecutions.mockResolvedValue(executionsPage([
      { ...execution, status: 'failed', failure_reason: 'A'.repeat(60) },
    ]));
    render(<ReportLogs />);
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(screen.getByText(`${'A'.repeat(40)}…`)).toBeInTheDocument();
  });

  it('pages through executions via the shared Pagination control', async () => {
    AnalyticsService.listReportExecutions.mockResolvedValue({
      items: [execution], total: 60, page: 1, per_page: 25, pages: 3,
    });
    render(<ReportLogs />);
    await waitFor(() => expect(AnalyticsService.listReportExecutions).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, per_page: 25 })
    ));
    expect(await screen.findByText('Showing 1–25 of 60')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(AnalyticsService.listReportExecutions).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 })
    ));
  });

  it('resets to page 1 when a filter changes', async () => {
    // Echoes back the requested page, like the real endpoint does — a mock
    // that always returns the same page can't tell "advanced a page" apart
    // from "stayed put".
    AnalyticsService.listReportExecutions.mockImplementation((filters) =>
      Promise.resolve({ items: [execution], total: 60, page: filters.page, per_page: 25, pages: 3 })
    );
    render(<ReportLogs />);
    await waitFor(() => expect(AnalyticsService.listReportExecutions).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(AnalyticsService.listReportExecutions).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 })
    ));

    await userEvent.click(screen.getByRole('button', { name: 'All Statuses' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Failed' }));
    await waitFor(() => expect(AnalyticsService.listReportExecutions).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed', page: 1 })
    ));
  });
});
