import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataSectionUploadHistoryCard } from '../../features/control-center/sections/data/UploadHistoryCard';
import { UploadService } from '../../services/api';

vi.mock('../../services/api', () => ({
  UploadService: {
    getLogs: vi.fn(),
    getBatchDetail: vi.fn(),
    rollback: vi.fn(),
  },
}));

const PAGE1 = {
  logs: [
    {
      id: 'log-1', filename: 'leads1.csv', uploaded_by: 'Amy SDR', status: 'completed',
      created: 20, updated: 3, skipped: 2, errors: 0, created_at: '2026-09-01T10:00:00',
      can_rollback: true, rollback_hours_remaining: 5.5,
    },
    {
      id: 'log-2', filename: 'leads2.csv', uploaded_by: 'Ben SDR', status: 'rolled_back',
      created: 10, updated: 0, skipped: 0, errors: 0, created_at: '2026-08-30T10:00:00',
      can_rollback: false, rollback_hours_remaining: 0,
    },
  ],
  total: 15, page: 1, pages: 2,
  summary: { total_uploads: 15, total_created: 300, total_updated: 40, total_skipped: 12 },
};

const PAGE2 = {
  logs: [
    { id: 'log-3', filename: 'leads3.csv', uploaded_by: 'Cam SDR', status: 'partial', created: 5, updated: 1, skipped: 1, errors: 1, created_at: '2026-08-20T10:00:00', can_rollback: false, rollback_hours_remaining: 0 },
  ],
  total: 15, page: 2, pages: 2,
  summary: { total_uploads: 15, total_created: 300, total_updated: 40, total_skipped: 12 },
};

describe('DataSectionUploadHistoryCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    UploadService.getLogs.mockResolvedValue(PAGE1);
  });

  it('renders stat cards and the history table, and pages forward', async () => {
    render(<DataSectionUploadHistoryCard />);

    await waitFor(() => expect(screen.getByText('leads1.csv')).toBeInTheDocument());
    expect(screen.getByText('leads2.csv')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument(); // Leads Created stat
    expect(screen.getByText('Showing 1–10 of 15')).toBeInTheDocument();

    UploadService.getLogs.mockResolvedValue(PAGE2);
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => expect(UploadService.getLogs).toHaveBeenCalledWith(2, 10, undefined));
    await waitFor(() => expect(screen.getByText('leads3.csv')).toBeInTheDocument());
  });

  it('shows only a rollback button for logs where can_rollback is true', async () => {
    render(<DataSectionUploadHistoryCard />);
    await waitFor(() => expect(screen.getByText('leads1.csv')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Rollback/ })).toBeInTheDocument();
    expect(screen.getByText('Rolled back')).toBeInTheDocument();
  });

  it('opens the per-SDR assignment detail modal on row click', async () => {
    UploadService.getBatchDetail.mockResolvedValue({
      total: 3,
      leads: [],
      assignment_summary: [
        { sdr: 'Amy SDR', count: 2, statuses: { 'Lead Assigned': 2 } },
        { sdr: 'Unassigned', count: 1, statuses: { Research: 1 } },
      ],
    });

    render(<DataSectionUploadHistoryCard />);
    await waitFor(() => expect(screen.getByText('leads1.csv')).toBeInTheDocument());

    await userEvent.click(screen.getByText('leads1.csv'));

    await waitFor(() => expect(UploadService.getBatchDetail).toHaveBeenCalledWith('log-1', { per_page: 200 }));
    const modal = await screen.findByRole('dialog');
    await waitFor(() => expect(within(modal).getByText('Amy SDR')).toBeInTheDocument());
    expect(within(modal).getByText('Unassigned')).toBeInTheDocument();
    expect(within(modal).getByText('Lead Assigned: 2')).toBeInTheDocument();
  });

  it('confirms and calls rollback, then shows the result summary', async () => {
    UploadService.rollback.mockResolvedValue({
      rolled_back: 18, protected: 2,
      protected_details: [{ lead_id: 'l1', reason: "Status progressed to 'Meeting Scheduled'" }],
    });

    render(<DataSectionUploadHistoryCard />);
    await waitFor(() => expect(screen.getByText('leads1.csv')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Rollback/ }));
    const confirmDialog = await screen.findByRole('dialog');
    expect(within(confirmDialog).getByText('Rollback Confirmation')).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/leads1\.csv/)).toBeInTheDocument();

    UploadService.getLogs.mockResolvedValue(PAGE1);
    await userEvent.click(within(confirmDialog).getByRole('button', { name: /Yes, Rollback/ }));

    await waitFor(() => expect(UploadService.rollback).toHaveBeenCalledWith('log-1'));
    const resultDialog = await screen.findByRole('dialog', { name: /Rollback Complete/ });
    expect(within(resultDialog).getByText('18')).toBeInTheDocument();
    expect(within(resultDialog).getByText(/Status progressed to 'Meeting Scheduled'/)).toBeInTheDocument();
  });
});
