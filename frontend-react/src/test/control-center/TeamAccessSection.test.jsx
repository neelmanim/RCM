import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamAccessSection } from '../../features/control-center/sections/TeamAccessSection';
import { AdminService, PodsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  AdminService: {
    getUsers: vi.fn().mockResolvedValue([]),
    getSdrDialerConfigs: vi.fn().mockResolvedValue([]),
    getAccessRequests: vi.fn().mockResolvedValue([]),
    patchUserRole: vi.fn(),
    patchUserAccess: vi.fn(),
    patchUserSettings: vi.fn(),
    deleteUser: vi.fn(),
    getUserToken: vi.fn(),
  },
  PodsService: {
    getAll: vi.fn().mockResolvedValue([]),
    addMember: vi.fn(),
    removeMember: vi.fn(),
  },
}));

// RCA 2026-09-03: Lead Assignments was briefly its own top-level Control
// Center section, then removed as unneeded — this section is just Users &
// PODs / User Access.
describe('TeamAccessSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to the Users & PODs tab and switches to User Access', async () => {
    render(<TeamAccessSection userRole="Super Admin" />);
    await waitFor(() => expect(AdminService.getUsers).toHaveBeenCalled());
    expect(screen.getByText('No users match your filters.')).toBeInTheDocument();
    expect(screen.queryByText('Lead Assignments')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('User Access'));
    await waitFor(() => expect(AdminService.getSdrDialerConfigs).toHaveBeenCalled());
    expect(screen.getByText('Assign Alternate Messenger Agent')).toBeInTheDocument();
  });

  // Pod Admin, not SDR: since v12.2 Pod Admins can reach this section, so
  // they are the real "can see Users & PODs but must not get View As" case.
  // An SDR now renders nothing here at all (no tab is open to them), which
  // would have made this assertion pass for the wrong reason.
  it('passes userRole through to UsersRolesPanel (a Pod Admin gets no Add User)', async () => {
    render(<TeamAccessSection userRole="Pod Admin" />);
    await waitFor(() => expect(AdminService.getUsers).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Add User/ })).not.toBeInTheDocument();
  });

  it('hides the Super-Admin-only User Access grid from a Pod Admin', async () => {
    render(<TeamAccessSection userRole="Pod Admin" />);
    await waitFor(() => expect(AdminService.getUsers).toHaveBeenCalled());
    // Granting/revoking a vendor seat is not a Pod Admin power in legacy.
    expect(screen.queryByText('User Access')).not.toBeInTheDocument();
    expect(AdminService.getSdrDialerConfigs).not.toHaveBeenCalled();
  });
});
