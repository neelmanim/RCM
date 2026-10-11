import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityMonitorHub } from '../../features/activity-monitor/ActivityMonitorHub';
import { ActivityMonitorService, CallsService } from '../../services/api';
import { CSV_EXPORT_CAP } from '../../features/activity-monitor/constants';

vi.mock('../../services/api', () => ({
  ActivityMonitorService: {
    getCallLogs: vi.fn(),
    getEmailLogs: vi.fn(),
    getMessageLogs: vi.fn(),
  },
  CallsService: {
    getRecordingUrl: vi.fn(),
  },
}));

const emptyCalls = { items: [], total: 0, page: 1, per_page: 25, pages: 1, sdrs: [], summary: {} };
const emptyEmail = { items: [], total: 0, page: 1, per_page: 25, pages: 1, sdrs: [], summary: {} };
const emptyMessages = { items: [], total: 0, page: 1, per_page: 25, pages: 1, sdrs: [], summary: {} };

describe('ActivityMonitorHub', () => {
  beforeEach(() => {
    window.__CRM_CAPS__ = { export: true };          // this user may export (the shell publishes it from /api/me/capabilities)
    vi.clearAllMocks();
    ActivityMonitorService.getCallLogs.mockResolvedValue(emptyCalls);
    ActivityMonitorService.getEmailLogs.mockResolvedValue(emptyEmail);
    ActivityMonitorService.getMessageLogs.mockResolvedValue(emptyMessages);
  });

  it('blocks a role that is not Super Admin or Pod Admin', async () => {
    render(<ActivityMonitorHub userRole="SDR" />);
    await waitFor(() => expect(screen.getByText(/don't have access/i)).toBeInTheDocument());
    expect(ActivityMonitorService.getCallLogs).not.toHaveBeenCalled();
  });

  it('allows Pod Admin and defaults to the Calls tab', async () => {
    render(<ActivityMonitorHub userRole="Pod Admin" />);
    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenCalled());
    expect(screen.getByText('Total Calls')).toBeInTheDocument();
  });

  it('shows the Calls empty state when there are no rows', async () => {
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('No calls found')).toBeInTheDocument());
  });

  it('renders a call row with its stats, and switches to the Email tab on click', async () => {
    ActivityMonitorService.getCallLogs.mockResolvedValue({
      ...emptyCalls,
      items: [{
        id: 'c1', sdr_name: 'Aditya Sharma', lead_name: 'Monica Singh', lead_company: 'Shapoorji',
        provider: 'messenger', direction: 'outbound', duration: 61, outcome: 'Call Back Later',
        status: 'CALL_ENDED', recording_url: null, started_at: new Date().toISOString(),
      }],
      total: 1,
      summary: { completed: 1, connected: 1, failed: 0, missed: 0, avg_duration: 61 },
    });
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Monica Singh')).toBeInTheDocument());
    expect(screen.getByText('Shapoorji')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument(); // Connected tile: 1/1

    await userEvent.click(screen.getByRole('button', { name: 'Email' }));
    await waitFor(() => expect(ActivityMonitorService.getEmailLogs).toHaveBeenCalled());
    expect(screen.getByText('No emails found')).toBeInTheDocument();
    // Switching tabs must not leave the Calls-only stat tile behind.
    expect(screen.queryByText('Total Calls')).not.toBeInTheDocument();
  });

  it('resets channel-specific filters when switching tabs so they cannot leak across channels', async () => {
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenCalled());

    // Calls tab exposes a Provider filter; Email tab must not.
    expect(screen.getByText('All Providers')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Messages' }));
    await waitFor(() => expect(ActivityMonitorService.getMessageLogs).toHaveBeenCalled());
    expect(screen.queryByText('All Providers')).not.toBeInTheDocument();
    expect(screen.getByText('All Channels')).toBeInTheDocument();
  });

  it('sends the applied SDR filter to the active channel\'s fetcher', async () => {
    ActivityMonitorService.getCallLogs.mockResolvedValue({
      ...emptyCalls,
      sdrs: [{ id: 'sdr-1', name: 'Aditya Sharma', email: 'aditya@t.com' }],
    });
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenCalled());

    // SDR filter is a searchable combobox (components/ui/Select), not a
    // native <select> — open it, then pick the option.
    await userEvent.click(screen.getByRole('button', { name: 'All SDRs' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Aditya Sharma' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ sdr_id: 'sdr-1' })
    ));
  });

  it('picks a date range from the calendar popover and sends it on Apply', async () => {
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenCalledTimes(1));

    // A single Radix-calendar range picker replaced the two native
    // <input type="date"> fields — range selection is order-independent by
    // construction (react-day-picker always keeps from <= to), so the old
    // "From after To" invalid-range scenario can no longer occur here.
    await userEvent.click(screen.getByRole('button', { name: /Date range/ }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /10th,/ }).length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByRole('button', { name: /10th,/ })[0]);
    await userEvent.click(screen.getAllByRole('button', { name: /\b5th,/ })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ date_from: expect.stringMatching(/-05$/), date_to: expect.stringMatching(/-10$/) })
    ));
  });

  it('parses the real {transcription:[...]} shape instead of dumping raw JSON, and collapses via the footer button', async () => {
    ActivityMonitorService.getCallLogs.mockResolvedValue({
      ...emptyCalls,
      items: [{
        id: 72500, sdr_name: 'Aditya Sharma', started_at: '2026-08-31T11:56:44Z', status: 'ENDED',
        transcript: JSON.stringify({ transcription: [
          { role: 'Speaker 0', content: 'Hello, good morning.', start_time: 0 },
          { role: 'Speaker 1', content: 'Hey, no worries.', start_time: 9.28 },
        ] }),
      }],
    });
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenCalled());

    await userEvent.click(screen.getByText('Aditya Sharma'));
    expect(screen.getByText('Hello, good morning.')).toBeInTheDocument();
    expect(screen.getByText('Speaker 1:')).toBeInTheDocument();
    // The old bug rendered the whole JSON blob as one line — assert that string never appears.
    expect(screen.queryByText(/"transcription":/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Collapse/ }));
    expect(screen.queryByText('Hello, good morning.')).not.toBeInTheDocument();
  });

  it('strips HTML markup from the email body preview instead of showing raw tags', async () => {
    ActivityMonitorService.getEmailLogs.mockResolvedValue({
      ...emptyEmail,
      items: [{
        id: 1, sdr_name: 'Tanya Mishra', timestamp: '2026-08-28T10:00:00Z', subject: 'between visits',
        body_preview: '<div><p style="">Hey Dr. Simon, worth 15 min?</p></div><img width="1" height="1">',
      }],
    });
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Email' }));
    await waitFor(() => expect(ActivityMonitorService.getEmailLogs).toHaveBeenCalled());

    await userEvent.click(screen.getByText('Tanya Mishra'));
    expect(screen.getByText('Hey Dr. Simon, worth 15 min?')).toBeInTheDocument();
    expect(screen.queryByText(/<div>/)).not.toBeInTheDocument();
  });

  it('fetches a fresh recording URL and retries once when the stored one has expired', async () => {
    CallsService.getRecordingUrl.mockResolvedValue({ recording_url: 'https://fresh.example.com/recording.mp3' });
    ActivityMonitorService.getCallLogs.mockResolvedValue({
      ...emptyCalls,
      items: [{
        id: 72500, sdr_name: 'Samya Choudhary', started_at: '2026-08-31T11:56:44Z', status: 'ENDED',
        recording_url: 'https://stale.example.com/recording.mp3?X-Amz-Expires=2794',
      }],
    });
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    const audioEl = await waitFor(() => document.querySelector('audio'));
    expect(audioEl).toHaveAttribute('src', 'https://stale.example.com/recording.mp3?X-Amz-Expires=2794');

    fireEvent.error(audioEl);
    await waitFor(() => expect(CallsService.getRecordingUrl).toHaveBeenCalledWith(72500));
    await waitFor(() => expect(document.querySelector('audio')).toHaveAttribute(
      'src', 'https://fresh.example.com/recording.mp3'
    ));
  });

  it('shows an error instead of silently doing nothing when CSV export fails', async () => {
    ActivityMonitorService.getCallLogs.mockImplementation((params) => {
      if (params?.per_page === CSV_EXPORT_CAP) return Promise.reject(new Error('timeout of 30000ms exceeded'));
      return Promise.resolve(emptyCalls);
    });
    render(<ActivityMonitorHub userRole="Super Admin" />);
    await waitFor(() => expect(ActivityMonitorService.getCallLogs).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(screen.getByText(/Export failed/)).toBeInTheDocument());
    expect(screen.getByText(/timeout of 30000ms exceeded/)).toBeInTheDocument();
  });
});
