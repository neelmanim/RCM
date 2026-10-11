import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangelogDigestCard } from '../../../pages/Analytics/reports/ChangelogDigestCard';
import { AnalyticsService } from '../../../services/api';

vi.mock('../../../services/api', () => ({
  AnalyticsService: {
    getChangelogDigestStatus: vi.fn(),
    setChangelogDigestEnabled: vi.fn(),
  },
}));

describe('ChangelogDigestCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is off by default', async () => {
    AnalyticsService.getChangelogDigestStatus.mockResolvedValue({ enabled: false });
    render(<ChangelogDigestCard />);
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  });

  it('reflects an already-enabled digest', async () => {
    AnalyticsService.getChangelogDigestStatus.mockResolvedValue({ enabled: true });
    render(<ChangelogDigestCard />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
  });

  it('turning it on calls the API and updates the switch', async () => {
    AnalyticsService.getChangelogDigestStatus.mockResolvedValue({ enabled: false });
    AnalyticsService.setChangelogDigestEnabled.mockResolvedValue({ enabled: true });
    render(<ChangelogDigestCard />);
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());

    await userEvent.click(screen.getByRole('checkbox'));

    expect(AnalyticsService.setChangelogDigestEnabled).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
  });

  it('shows an error and leaves the switch unchanged when the toggle fails (e.g. no connected mailbox)', async () => {
    AnalyticsService.getChangelogDigestStatus.mockResolvedValue({ enabled: false });
    AnalyticsService.setChangelogDigestEnabled.mockRejectedValue({
      response: { data: { detail: 'No connected mailbox available to send from — connect one in Email Hub first.' } },
    });
    render(<ChangelogDigestCard />);
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());

    await userEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(screen.getByText(/no connected mailbox/i)).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
