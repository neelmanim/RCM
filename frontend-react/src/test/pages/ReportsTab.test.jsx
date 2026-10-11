import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportsTab } from '../../pages/Analytics/ReportsTab';

vi.mock('../../pages/Analytics/reports/ChangelogDigestCard', () => ({
  ChangelogDigestCard: () => <div>changelog-digest-card</div>,
}));
vi.mock('../../pages/Analytics/reports/MyReportsList', () => ({
  MyReportsList: ({ onCreateNew, onLogsChanged }) => (
    <div>
      <span>my-reports-list</span>
      <button onClick={() => onCreateNew()}>trigger-create</button>
      <button onClick={() => onLogsChanged()}>trigger-logs-changed</button>
    </div>
  ),
}));
vi.mock('../../pages/Analytics/reports/ReportBuilder', () => ({
  ReportBuilder: ({ reportId, onDone }) => (
    <div>
      <span>report-builder-{reportId || 'new'}</span>
      <button onClick={onDone}>trigger-done</button>
    </div>
  ),
}));
// Module-level counter so each remount (a new `key`) is observable in the
// rendered text — proves ReportLogs actually refetches after a run, not just
// that a callback fired.
let reportLogsMountCount = 0;
vi.mock('../../pages/Analytics/reports/ReportLogs', () => ({
  ReportLogs: () => <div>report-logs-mount-{++reportLogsMountCount}</div>,
}));

describe('ReportsTab — sub-navigation shell', () => {
  beforeEach(() => { reportLogsMountCount = 0; });

  it('shows My Reports by default', () => {
    render(<ReportsTab />);
    expect(screen.getByText('my-reports-list')).toBeInTheDocument();
  });

  it('shows Report Logs on the same page as My Reports, with no tab switch needed', () => {
    render(<ReportsTab />);
    expect(screen.getByText('my-reports-list')).toBeInTheDocument();
    expect(screen.getByText(/report-logs-mount-/)).toBeInTheDocument();
  });

  it('opens the builder for a new report and hides the list view', async () => {
    render(<ReportsTab />);
    await userEvent.click(screen.getByText('trigger-create'));
    expect(screen.getByText(/report-builder-new/)).toBeInTheDocument();
    expect(screen.queryByText('my-reports-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/report-logs-mount-/)).not.toBeInTheDocument();
  });

  it('returns to the list when the builder signals done', async () => {
    render(<ReportsTab />);
    await userEvent.click(screen.getByText('trigger-create'));
    await userEvent.click(screen.getByText('trigger-done'));
    expect(screen.getByText('my-reports-list')).toBeInTheDocument();
  });

  it('remounts Report Logs (so it refetches) after a report is run or deleted', async () => {
    render(<ReportsTab />);
    expect(screen.getByText('report-logs-mount-1')).toBeInTheDocument();
    await userEvent.click(screen.getByText('trigger-logs-changed'));
    expect(screen.getByText('report-logs-mount-2')).toBeInTheDocument();
  });
});
