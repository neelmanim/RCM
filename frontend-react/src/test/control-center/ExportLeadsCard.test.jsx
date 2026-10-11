import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataSectionExportCard } from '../../features/control-center/sections/data/ExportLeadsCard';
import { AdminService, UploadService } from '../../services/api';

vi.mock('../../services/api', () => ({
  AdminService: {
    getUsers: vi.fn(),
    exportLeadsBySdr: vi.fn(),
  },
  UploadService: {
    getLogs: vi.fn(),
  },
}));

describe('DataSectionExportCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AdminService.getUsers.mockResolvedValue([
      { id: 'u1', name: 'Amy SDR', email: 'amy@x.com', role: 'SDR' },
      { id: 'u2', name: 'Ben Admin', email: 'ben@x.com', role: 'Super Admin' },
    ]);
    // Real shape of GET /admin/leads/upload-logs is { logs: [...] }, not { data: [...] } —
    // a prior version of this mock used the wrong key and masked a real bug.
    UploadService.getLogs.mockResolvedValue({
      logs: [{ id: 'log1', filename: 'apollo_batch.csv', tag: 'Apollo', created_at: '2026-08-01T00:00:00Z' }],
      total: 1,
    });
  });

  it('only offers SDR/AE/Pod Admin roles, not admins', async () => {
    render(<DataSectionExportCard />);
    await waitFor(() => expect(AdminService.getUsers).toHaveBeenCalled());
    await userEvent.click(screen.getByText('Any SDR'));
    expect(screen.getByText('Amy SDR')).toBeInTheDocument();
    expect(screen.queryByText('Ben Admin')).not.toBeInTheDocument();
  });

  it('requires at least one filter before exporting', async () => {
    render(<DataSectionExportCard />);
    await waitFor(() => expect(AdminService.getUsers).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled();
  });

  it('exports the chosen SDR\'s leads', async () => {
    AdminService.exportLeadsBySdr.mockResolvedValue();
    render(<DataSectionExportCard />);
    await waitFor(() => expect(AdminService.getUsers).toHaveBeenCalled());

    await userEvent.click(screen.getByText('Any SDR'));
    await userEvent.click(screen.getByText('Amy SDR'));
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(AdminService.exportLeadsBySdr).toHaveBeenCalledWith({
      sdrIds: ['u1'], uploadLogId: undefined, dateFrom: undefined, dateTo: undefined,
    }));
  });

  it('exports multiple selected SDRs\' leads at once', async () => {
    AdminService.getUsers.mockResolvedValue([
      { id: 'u1', name: 'Amy SDR', email: 'amy@x.com', role: 'SDR' },
      { id: 'u3', name: 'Priya SDR', email: 'priya@x.com', role: 'SDR' },
    ]);
    AdminService.exportLeadsBySdr.mockResolvedValue();
    render(<DataSectionExportCard />);
    await waitFor(() => expect(AdminService.getUsers).toHaveBeenCalled());

    await userEvent.click(screen.getByText('Any SDR'));
    await userEvent.click(screen.getByText('Amy SDR'));
    await userEvent.click(screen.getByText('Priya SDR'));
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(AdminService.exportLeadsBySdr).toHaveBeenCalledWith({
      sdrIds: ['u1', 'u3'], uploadLogId: undefined, dateFrom: undefined, dateTo: undefined,
    }));
  });

  it('exports by upload batch alone, without requiring an SDR', async () => {
    AdminService.exportLeadsBySdr.mockResolvedValue();
    render(<DataSectionExportCard />);
    await waitFor(() => expect(UploadService.getLogs).toHaveBeenCalled());
    // 50 is the backend route's own per_page cap (le=50) — 100 would 422.
    expect(UploadService.getLogs).toHaveBeenCalledWith(1, 50);

    await userEvent.click(screen.getByText('Any batch'));
    await userEvent.click(screen.getByText(/apollo_batch\.csv/));
    expect(screen.getByRole('button', { name: /Export CSV/ })).not.toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(AdminService.exportLeadsBySdr).toHaveBeenCalledWith({
      sdrIds: undefined, uploadLogId: 'log1', dateFrom: undefined, dateTo: undefined,
    }));
  });
});
