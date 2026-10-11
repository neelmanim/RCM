import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserAccessTable } from '../../features/control-center/sections/team-access/UserAccessTable';
import { AdminService } from '../../services/api';

vi.mock('../../services/api', () => ({
  AdminService: {
    getSdrDialerConfigs: vi.fn(),
    patchUserSettings: vi.fn(),
  },
}));

function sdr(i, overrides = {}) {
  return {
    id: `u${i}`, name: `Rep ${i}`, email: `rep${i}@x.com`,
    effective_dialer_provider: 'messenger', effective_messaging_provider: 'messenger',
    dialer_enabled: false, sms_enabled: false, whatsapp_enabled: false,
    messenger_user_id: null,
    ...overrides,
  };
}

describe('UserAccessTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('paginates at 5 rows per page, matching the legacy _uaState pageSize', async () => {
    AdminService.getSdrDialerConfigs.mockResolvedValue(Array.from({ length: 7 }, (_, i) => sdr(i)));
    render(<UserAccessTable />);
    await waitFor(() => expect(screen.getByText('Rep 0')).toBeInTheDocument());
    expect(screen.getByText('Rep 4')).toBeInTheDocument();
    expect(screen.queryByText('Rep 5')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('Rep 5')).toBeInTheDocument());
    expect(screen.queryByText('Rep 0')).not.toBeInTheDocument();
  });

  it('filters by "has Alternate Messenger agent ID"', async () => {
    AdminService.getSdrDialerConfigs.mockResolvedValue([
      sdr(0, { messenger_user_id: '123' }),
      sdr(1, { messenger_user_id: null }),
    ]);
    render(<UserAccessTable />);
    await waitFor(() => expect(screen.getByText('Rep 0')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Alternate Messenger agent ID: any'));
    await userEvent.click(screen.getByText('Has Alternate Messenger agent ID'));

    expect(screen.getByText('Rep 0')).toBeInTheDocument();
    expect(screen.queryByText('Rep 1')).not.toBeInTheDocument();
  });

  it('surfaces a soft warning returned by the PATCH endpoint on a capability grant', async () => {
    AdminService.getSdrDialerConfigs.mockResolvedValue([sdr(0)]);
    AdminService.patchUserSettings.mockResolvedValue({ dialer_enabled: true, warning: "won't send yet — Alternate Messenger isn't configured" });
    render(<UserAccessTable />);
    await waitFor(() => expect(screen.getByText('Rep 0')).toBeInTheDocument());

    await userEvent.click(screen.getByTitle('Click to grant Calling'));
    await waitFor(() => expect(screen.getByText(/won't send yet/)).toBeInTheDocument());
  });

  it('shows a friendlier retry-able message on a dropped connection, and retries the same toggle', async () => {
    AdminService.getSdrDialerConfigs.mockResolvedValue([sdr(0)]);
    const networkErr = new Error('Network Error'); // axios: no .response on a dropped connection
    AdminService.patchUserSettings.mockRejectedValueOnce(networkErr).mockResolvedValueOnce({ dialer_enabled: true });
    render(<UserAccessTable />);
    await waitFor(() => expect(screen.getByText('Rep 0')).toBeInTheDocument());

    await userEvent.click(screen.getByTitle('Click to grant Calling'));
    await waitFor(() => expect(screen.getByText(/Network error — check your connection/)).toBeInTheDocument());

    await userEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(AdminService.patchUserSettings).toHaveBeenCalledTimes(2));
  });

  it('shows a plain (non-retryable) error message for a real validation failure', async () => {
    AdminService.getSdrDialerConfigs.mockResolvedValue([sdr(0)]);
    const err = new Error('Failed');
    err.response = { data: { detail: 'Invalid Alternate Messenger agent ID' } };
    AdminService.patchUserSettings.mockRejectedValue(err);
    render(<UserAccessTable />);
    await waitFor(() => expect(screen.getByText('Rep 0')).toBeInTheDocument());

    await userEvent.click(screen.getByTitle('Click to grant Calling'));
    await waitFor(() => expect(screen.getByText('Invalid Alternate Messenger agent ID')).toBeInTheDocument());
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  it('merges calling+messaging provider into one chip when they match, instead of showing the name twice', async () => {
    AdminService.getSdrDialerConfigs.mockResolvedValue([sdr(0)]); // both 'messenger'
    render(<UserAccessTable />);
    await waitFor(() => expect(screen.getByText('Rep 0')).toBeInTheDocument());
    expect(screen.getAllByText('messenger')).toHaveLength(1);
  });

  it('shows two separate provider chips when calling and messaging differ', async () => {
    AdminService.getSdrDialerConfigs.mockResolvedValue([sdr(0, { effective_dialer_provider: 'aircall', effective_messaging_provider: 'messenger' })]);
    render(<UserAccessTable />);
    await waitFor(() => expect(screen.getByText('Rep 0')).toBeInTheDocument());
    expect(screen.getByTitle('Calling provider')).toBeInTheDocument();
    expect(screen.getByTitle('Messaging provider')).toBeInTheDocument();
  });

  it('opens the Assign Alternate Messenger Agent drawer and validates required fields', async () => {
    AdminService.getSdrDialerConfigs.mockResolvedValue([sdr(0)]);
    render(<UserAccessTable />);
    await waitFor(() => expect(screen.getByText('Rep 0')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Assign Alternate Messenger Agent'));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByText('Assign'));
    expect(within(dialog).getByText('Please select an SDR.')).toBeInTheDocument();
  });
});
