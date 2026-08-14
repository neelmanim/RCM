import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
  TagsService: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
  AdminService: { getUsers: vi.fn(() => Promise.resolve([])) },
  DisqualifyService: {
    getRequests: vi.fn(() => Promise.resolve({ requests: [] })),
    create: vi.fn(() => Promise.resolve({ id: 'dq-1' })),
  },
  CallsService: { getCallOutcomes: vi.fn(() => Promise.resolve({ enabled_outcomes: [] })) },
  default: { get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
}));

const dt = () => ({ setData: () => {}, getData: () => {}, effectAllowed: '' });

describe('LeadsHub — column layout (reorder / resize / show-hide)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  const renderHub = async () => {
    render(<LeadsHub />);
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
  };

  it('drags a column header to reorder it, and persists the order', async () => {
    await renderHub();
    const headerRow = screen.getAllByRole('columnheader')[0].closest('tr');
    const labelsBefore = within(headerRow).getAllByRole('columnheader').map((th) => th.textContent);
    expect(labelsBefore.slice(0, 3)).toEqual(['Contact', 'Status', 'Source']);

    const statusHeader = within(headerRow).getByText('Status').closest('th');
    const sourceHeader = within(headerRow).getByText('Source').closest('th');
    fireEvent.dragStart(statusHeader, { dataTransfer: dt() });
    fireEvent.dragOver(sourceHeader, { dataTransfer: dt() });
    fireEvent.drop(sourceHeader, { dataTransfer: dt() });

    const labelsAfter = within(headerRow).getAllByRole('columnheader').map((th) => th.textContent);
    expect(labelsAfter.slice(0, 3)).toEqual(['Contact', 'Source', 'Status']);

    // Persisted — a fresh mount picks up the same order.
    const saved = JSON.parse(window.localStorage.getItem('leadsHub.columnLayout'));
    expect(saved.order.slice(0, 2)).toEqual(['source', 'status']);
  });

  it('resizes a column via its drag handle', async () => {
    await renderHub();
    const statusHeader = screen.getByText('Status').closest('th');
    const handle = statusHeader.querySelector('span.cursor-col-resize');
    expect(handle).toBeTruthy();

    Object.defineProperty(statusHeader, 'offsetWidth', { value: 150, configurable: true });
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 160 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('leadsHub.columnLayout'));
      expect(saved.widths.status).toBe(210); // 150 + (160 - 100)
    });
  });

  it('hides and re-shows a column via the Columns menu, and Reset restores default', async () => {
    await renderHub();
    expect(screen.getByRole('columnheader', { name: /Phone/ })).toBeInTheDocument();

    await userEvent.click(screen.getByText('Columns'));
    const columnsMenu = screen.getByText('Show columns').parentElement;
    const phoneMenuItem = within(columnsMenu).getByRole('button', { name: 'Phone' });
    await userEvent.click(phoneMenuItem);
    expect(screen.queryByRole('columnheader', { name: /Phone/ })).not.toBeInTheDocument();

    await userEvent.click(phoneMenuItem); // re-show
    expect(screen.getByRole('columnheader', { name: /Phone/ })).toBeInTheDocument();

    await userEvent.click(phoneMenuItem);
    expect(screen.queryByRole('columnheader', { name: /Phone/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Reset column layout'));
    expect(screen.getByRole('columnheader', { name: /Phone/ })).toBeInTheDocument();
  });

  it('does not crash when localStorage has a schema-drifted "hidden" value (not an array)', async () => {
    window.localStorage.setItem('leadsHub.columnLayout', JSON.stringify({ hidden: { assignedTo: true } }));
    await renderHub();
    // Falls back to the default (nothing hidden) rather than throwing on
    // `new Set(...)` over a non-iterable object.
    expect(screen.getByRole('columnheader', { name: /Phone/ })).toBeInTheDocument();
  });

  it('does not crash when localStorage has a schema-drifted "widths" value (not an object)', async () => {
    window.localStorage.setItem('leadsHub.columnLayout', JSON.stringify({ widths: true }));
    await renderHub();
    expect(screen.getByRole('columnheader', { name: /Status/ })).toBeInTheDocument();
  });
});
