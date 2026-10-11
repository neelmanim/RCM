import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersRolesPanel } from '../../features/control-center/sections/team-access/UsersRolesPanel';
import { AdminService, PodsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  AdminService: {
    getUsers: vi.fn(),
    patchUserRole: vi.fn(),
    patchUserAccess: vi.fn(),
    deleteUser: vi.fn(),
    getUserToken: vi.fn(),
    createUser: vi.fn(),
    uploadUsersCsv: vi.fn(),
    getAccessRequests: vi.fn(),
    patchUserSettings: vi.fn(),
  },
  PodsService: {
    getAll: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
  },
}));

const users = [
  { id: 'u1', name: 'Amy SDR', email: 'amy@x.com', role: 'SDR', pod: { id: 'p1', name: 'Alpha' }, access_allowed: true, last_login_at: new Date().toISOString() },
  { id: 'u2', name: 'Ben AE', email: 'ben@x.com', role: 'AE', pod: null, access_allowed: true, last_login_at: null },
];
const pods = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }];

describe('UsersRolesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AdminService.getUsers.mockResolvedValue(users);
    AdminService.getAccessRequests.mockResolvedValue([]);
    PodsService.getAll.mockResolvedValue(pods);
  });

  it('lists users with their current role and POD', async () => {
    render(<UsersRolesPanel />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());
    expect(screen.getByText('Ben AE')).toBeInTheDocument();
  });

  // Data export is OFF for everyone but Super Admins until a Super Admin switches it on, one person at a time.
  it('a Super Admin turns data export on for someone only after confirming, and off without asking', async () => {
    AdminService.patchUserSettings.mockResolvedValue({});
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());
    const sw = screen.getByRole('checkbox', { name: 'Allow Amy SDR exporting data' });
    expect(sw).not.toBeChecked();

    await userEvent.click(sw);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/will be able to download CSV and Excel files/)).toBeInTheDocument();
    expect(AdminService.patchUserSettings).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(AdminService.patchUserSettings).not.toHaveBeenCalled();

    await userEvent.click(sw);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Allow Export' }));
    await waitFor(() => expect(AdminService.patchUserSettings).toHaveBeenCalledWith('u1', { export_enabled: true }));
  });

  it('turning export off for a rep needs no confirmation', async () => {
    AdminService.getUsers.mockResolvedValue([{ ...users[0], export_enabled: true }, users[1]]);
    AdminService.patchUserSettings.mockResolvedValue({});
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Block Amy SDR exporting data' }));
    await waitFor(() => expect(AdminService.patchUserSettings).toHaveBeenCalledWith('u1', { export_enabled: false }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a Super Admin can be blocked from exporting, after a confirmation, and shows as Off', async () => {
    const sue = { id: 'u9', name: 'Sue Boss', email: 's@x.com', role: 'Super Admin', pod: null, access_allowed: true, export_enabled: true, export_always: true };
    AdminService.getUsers.mockResolvedValue([users[0], sue]);
    AdminService.patchUserSettings.mockResolvedValue({});
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Sue Boss')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Block Sue Boss exporting data' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/even though their role normally can/)).toBeInTheDocument();
    expect(AdminService.patchUserSettings).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block Export' }));
    await waitFor(() => expect(AdminService.patchUserSettings).toHaveBeenCalledWith('u9', { export_enabled: false }));
  });

  it('a Pod Admin only reads the setting', async () => {
    AdminService.getUsers.mockResolvedValue([{ ...users[0], export_enabled: true }, { id: 'u9', name: 'Sue Boss', email: 's@x.com', role: 'Super Admin', pod: null, access_allowed: true, export_enabled: false, export_always: true }]);
    render(<UsersRolesPanel userRole="Pod Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /exporting data/ })).not.toBeInTheDocument();
  });

  // "I switched it off, it said so, and the switch still showed On": the list was served from a cache. The panel now always
  // asks for a fresh list and keeps the table on screen (no skeleton) while it re-reads after a change.
  it('always reads a fresh user list, and keeps the table on screen while re-reading after a change', async () => {
    AdminService.getUsers.mockResolvedValue([{ ...users[0], export_enabled: true }, users[1]]);
    AdminService.patchUserSettings.mockResolvedValue({ export_enabled: false });
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());
    expect(AdminService.getUsers).toHaveBeenCalledWith({ fresh: true });
    AdminService.getUsers.mockResolvedValue([{ ...users[0], export_enabled: false }, users[1]]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Block Amy SDR exporting data' }));
    expect(screen.getByText('Amy SDR')).toBeInTheDocument();                                   // never replaced by a skeleton
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Allow Amy SDR exporting data' })).not.toBeChecked());
    expect(AdminService.getUsers).toHaveBeenLastCalledWith({ fresh: true });
  });

  it('filters the table by role', async () => {
    render(<UsersRolesPanel />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Role: All'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'AE' }));

    expect(screen.queryByText('Amy SDR')).not.toBeInTheDocument();
    expect(screen.getByText('Ben AE')).toBeInTheDocument();
  });

  it('confirms before changing a role, then calls patchUserRole', async () => {
    AdminService.patchUserRole.mockResolvedValue({});
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());

    await userEvent.click(screen.getByText('SDR'));
    await userEvent.click(screen.getByText('Pod Admin'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Change Amy SDR's role to Pod Admin/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change role' }));

    await waitFor(() => expect(AdminService.patchUserRole).toHaveBeenCalledWith('u1', 'Pod Admin'));
  });

  it('reassigns a POD by removing membership from the old pod and adding to the new one, with a confirmation toast', async () => {
    // Bug report (2026-09-22): this succeeded silently — no toast, easy to
    // mistake for a no-op. Also fires 'alternate:pod-membership-changed' so
    // Pods Hub (a separately-persisted React island) refreshes on next visit
    // instead of showing the pre-reassignment POD until a hard refresh.
    PodsService.removeMember.mockResolvedValue({});
    PodsService.addMember.mockResolvedValue({});
    const toastHandler = vi.fn();
    const eventHandler = vi.fn();
    window.addEventListener('alternate:toast', toastHandler);
    window.addEventListener('alternate:pod-membership-changed', eventHandler);
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Alpha'));
    await userEvent.click(screen.getByText('Beta'));

    await waitFor(() => {
      expect(PodsService.removeMember).toHaveBeenCalledWith('p1', 'u1');
      expect(PodsService.addMember).toHaveBeenCalledWith('p2', 'u1');
    });
    await waitFor(() => expect(toastHandler).toHaveBeenCalled());
    expect(toastHandler.mock.calls[0][0].detail.message).toContain('Beta');
    expect(eventHandler).toHaveBeenCalled();
    window.removeEventListener('alternate:toast', toastHandler);
    window.removeEventListener('alternate:pod-membership-changed', eventHandler);
  });

  it('confirms before revoking access, then calls patchUserAccess', async () => {
    AdminService.patchUserAccess.mockResolvedValue({});
    render(<UsersRolesPanel />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());

    const row = screen.getByText('Amy SDR').closest('tr');
    await userEvent.click(within(row).getByTitle('Revoke login access'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Revoke login access/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(AdminService.patchUserAccess).toHaveBeenCalledWith('u1', 'revoke'));
  });

  // RCA 2026-09-03: legacy admin.js's 👁️ "View As" button (Super Admin only)
  // was never ported when this page moved to React — restored here. It
  // reuses the exact working mechanism (GET .../token → open a new tab with
  // ?token=), not the newer, unwired POST /admin/impersonate endpoint.
  // v12.2 audit: this panel was written Super-Admin-only, then v12.2 admitted
  // Pod Admins to Control Center → Team & Access without re-gating it. That
  // handed them Add User, an editable Role dropdown (privilege escalation, had
  // the backend allowed it), POD reassignment, and delete/revoke on any listed
  // user. Backend counterpart: admin_user_routes._require_may_manage_user.
  it('offers a Pod Admin none of the Super-Admin-only user controls', async () => {
    render(<UsersRolesPanel userRole="Pod Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /Add User/ })).not.toBeInTheDocument();
    const row = screen.getByText('Amy SDR').closest('tr');
    // Role and POD render as plain text, not editable selects.
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('still lets a Pod Admin manage an SDR in their (server-scoped) list', async () => {
    render(<UsersRolesPanel userRole="Pod Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());
    const row = screen.getByText('Amy SDR').closest('tr');
    // SDR/AE rows keep the two actions legacy admin.js gave a Pod Admin.
    expect(within(row).getByTitle('Delete user')).toBeInTheDocument();
    expect(within(row).getByTitle(/login access/)).toBeInTheDocument();
  });

  // v14.0.0: a Pod Admin may View As the SDRs/AEs of their own pod (the server enforces it) — never a Pod Admin/admin row.
  it('offers a Pod Admin View As on an SDR in their pod, and opens it in a new tab', async () => {
    AdminService.getUserToken.mockResolvedValue({ token: 'pod-view-as-jwt' });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    render(<UsersRolesPanel userRole="Pod Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());
    const row = screen.getByText('Amy SDR').closest('tr');
    await userEvent.click(within(row).getByTitle('View As'));
    await waitFor(() => expect(AdminService.getUserToken).toHaveBeenCalledWith('u1'));
    expect(openSpy).toHaveBeenCalledWith('index.html?token=pod-view-as-jwt', '_blank');
    openSpy.mockRestore();
  });

  it('fetches a View-As token and opens it in a new tab for a Super Admin', async () => {
    AdminService.getUserToken.mockResolvedValue({ token: 'view-as-jwt' });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());

    const row = screen.getByText('Amy SDR').closest('tr');
    await userEvent.click(within(row).getByTitle('View As'));

    await waitFor(() => expect(AdminService.getUserToken).toHaveBeenCalledWith('u1'));
    expect(openSpy).toHaveBeenCalledWith('index.html?token=view-as-jwt', '_blank');
    openSpy.mockRestore();
  });

  it('creates a single user via the Add User modal', async () => {
    AdminService.createUser.mockResolvedValue({ user_id: 'u3' });
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Add User/ }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new@x.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create User' }));

    await waitFor(() => expect(AdminService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@x.com', role: 'SDR' })
    ));
  });

  it('uploads a bulk CSV via the Add User modal', async () => {
    AdminService.uploadUsersCsv.mockResolvedValue({ added: ['a@x.com'], removed: [], skipped: [] });
    render(<UsersRolesPanel userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Amy SDR')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Add User/ }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bulk CSV' }));

    const file = new File(['email,name,action\na@x.com,A,add'], 'users.csv', { type: 'text/csv' });
    const input = dialog.querySelector('input[type="file"]');
    await userEvent.upload(input, file);
    await userEvent.click(within(dialog).getByRole('button', { name: /Upload CSV/ }));

    await waitFor(() => expect(AdminService.uploadUsersCsv).toHaveBeenCalled());
    expect(await within(dialog).findByText(/Added 1/)).toBeInTheDocument();
  });
});
