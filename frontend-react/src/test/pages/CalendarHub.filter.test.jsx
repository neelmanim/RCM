import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarHub } from '../../pages/Calendar/CalendarHub';
import api from '../../services/api';

vi.mock('../../services/api', () => ({ default: { get: vi.fn() } }));

// 2026-09-28: filteredMeetings (search/SDR filter) was wired correctly, but
// meetingsByDay — what the Month/Week grid actually renders from — memoized
// off the unfiltered `meetingsWithTime` instead of `filteredMeetings`, so
// typing in the search box or picking an SDR had no visible effect on the
// grid (only the List view, which reads filteredMeetings directly, updated).
describe('CalendarHub search filter', () => {
  it('hides a non-matching meeting from the month grid once searched', async () => {
    const today = new Date();
    const iso = today.toISOString().replace('T', ' ').slice(0, 19);
    api.get.mockResolvedValue({
      data: {
        meetings: [
          { lead_id: 'l1', lead_name: 'Alice Anderson', company: 'Acme', meeting_scheduled_at: iso },
          { lead_id: 'l2', lead_name: 'Bob Brown', company: 'Other Co', meeting_scheduled_at: iso },
        ],
      },
    });

    render(<CalendarHub userRole="SDR" />);

    await waitFor(() => expect(screen.getByText(/Alice Anderson/)).toBeInTheDocument());
    expect(screen.getByText(/Bob Brown/)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/Search by lead or company/i), 'Alice');

    await waitFor(() => expect(screen.queryByText(/Bob Brown/)).not.toBeInTheDocument());
    expect(screen.getByText(/Alice Anderson/)).toBeInTheDocument();
  });
});
