import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogPanel } from '../../features/control-center/sections/AuditLogPanel';
import { TeamAccessSection } from '../../features/control-center/sections/TeamAccessSection';
import { AuditService } from '../../services/api';

vi.mock('../../services/api', () => ({
  AuditService: { list: vi.fn() },
  AdminService: { getUsers: vi.fn().mockResolvedValue([]), getSdrDialerConfigs: vi.fn().mockResolvedValue([]), getAccessRequests: vi.fn().mockResolvedValue([]) },
  PodsService: { getAll: vi.fn().mockResolvedValue([]) },
}));

const ev = (i, extra = {}) => ({ id: `e${i}`, at: '2026-10-09T09:30:00Z', actor_name: `Person ${i}`, actor_email: `p${i}@x.com`, actor_role: 'Super Admin',
  category: 'export', action: 'DOWNLOAD', summary: `Leads export ${i}`, detail: {}, ...extra });
const page = (items, extra = {}) => ({ items, total: items.length, page: 1, pages: 1, per_page: 15, ...extra });

describe('AuditLogPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); AuditService.list.mockResolvedValue(page([ev(1), ev(2, { action: 'BROWSER_CSV', detail: { rows: 1200 } })])); });

  it('lists who did what and when, and asks the server for the category it was given', async () => {
    render(<AuditLogPanel category="export,export_access" />);
    expect(await screen.findByText('Leads export 1')).toBeInTheDocument();
    expect(screen.getByText('Person 1')).toBeInTheDocument();
    expect(screen.getByText('p1@x.com · Super Admin')).toBeInTheDocument();
    expect(screen.getByText('CSV in browser')).toBeInTheDocument();
    expect(screen.getByText(/1200 rows/)).toBeInTheDocument();
    expect(screen.getByText('2 records')).toBeInTheDocument();
    expect(AuditService.list).toHaveBeenCalledWith(expect.objectContaining({ category: 'export,export_access', page: 1 }));
  });

  it('searching waits for a pause, then asks again from page 1', async () => {
    render(<AuditLogPanel category="export" />);
    await screen.findByText('Leads export 1');
    await userEvent.type(screen.getByLabelText(/Search by person/), 'rita');
    await waitFor(() => expect(AuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'rita', page: 1 })));
  });

  it('the kind menu narrows the category', async () => {
    render(<AuditLogPanel category="export,export_access" kinds={[{ value: '', label: 'All' }, { value: 'export_access', label: 'Access changes only' }]} />);
    await screen.findByText('Leads export 1');
    await userEvent.click(screen.getByLabelText('Kind'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Access changes only' }));
    await waitFor(() => expect(AuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'export_access' })));
  });

  it('pages through long histories', async () => {
    AuditService.list.mockResolvedValue(page([ev(1)], { total: 40, pages: 3 }));
    render(<AuditLogPanel category="export" />);
    await screen.findByText('Leads export 1');
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(AuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('says so when nothing is recorded, and when filters match nothing', async () => {
    AuditService.list.mockResolvedValue(page([]));
    render(<AuditLogPanel category="export" emptyMessage="No one has exported data yet." />);
    expect(await screen.findByText('No one has exported data yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Search by person/), 'zzz');
    expect(await screen.findByText('Nothing recorded matches those filters.')).toBeInTheDocument();
  });

  it('shows the server\'s reason when the log cannot be loaded', async () => {
    AuditService.list.mockRejectedValue({ response: { data: { detail: 'Only a Super Admin can read this.' } } });
    render(<AuditLogPanel category="export" />);
    expect(await screen.findByText(/Only a Super Admin can read this/)).toBeInTheDocument();
  });
});

describe('Export History tab', () => {
  beforeEach(() => { vi.clearAllMocks(); AuditService.list.mockResolvedValue(page([ev(1)])); });
  it('is there for a Super Admin only', async () => {
    const { unmount } = render(<TeamAccessSection userRole="Super Admin" />);
    await userEvent.click(await screen.findByText('Export History'));
    expect(await screen.findByText('Leads export 1')).toBeInTheDocument();
    expect(screen.getByText(/nothing here can be edited/)).toBeInTheDocument();
    unmount();
    render(<TeamAccessSection userRole="Pod Admin" />);
    expect(screen.queryByText('Export History')).not.toBeInTheDocument();
  });
});
