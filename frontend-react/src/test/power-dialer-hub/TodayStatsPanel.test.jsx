import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayStatsPanel } from '../../features/power-dialer-hub/components/TodayStatsPanel';
import { CallsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  CallsService: { getTodayCalls: vi.fn(), getRecordingUrl: vi.fn() },
}));

const statsWithRecording = {
  date: '2026-08-07',
  summary: { total: 1, connected: 1, no_answer: 0, voicemail: 0, callback: 0, meeting: 0, other: 0 },
  calls: [{ id: 'c1', lead_name: 'Jane Doe', company: 'Acme', outcome: 'Interested', called_at: '2026-08-07T10:00:00Z', recording_url: 'https://cdn.example/rec1.mp3' }],
};

const statsWithoutRecording = {
  ...statsWithRecording,
  calls: [{ ...statsWithRecording.calls[0], recording_url: null }],
};

describe('TodayStatsPanel', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.useRealTimers());

  it('shows a dash for a call with no recording', async () => {
    CallsService.getTodayCalls.mockResolvedValue(statsWithoutRecording);
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.queryByRole('audio')).not.toBeInTheDocument();
  });

  it('renders a playable audio element when a recording exists', async () => {
    CallsService.getTodayCalls.mockResolvedValue(statsWithRecording);
    const { container } = render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(container.querySelector('audio')).toBeInTheDocument();
    expect(container.querySelector('source').src).toContain('rec1.mp3');
  });

  it('fetches a fresh signed URL and retries once when playback errors', async () => {
    CallsService.getTodayCalls.mockResolvedValue(statsWithRecording);
    CallsService.getRecordingUrl.mockResolvedValue({ recording_url: 'https://cdn.example/rec1-fresh.mp3' });
    const { container } = render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());

    fireEvent.error(container.querySelector('audio'));
    await waitFor(() => expect(CallsService.getRecordingUrl).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(container.querySelector('source').src).toContain('rec1-fresh.mp3'));
  });

  it('shows "Unavailable" instead of looping when the retry also fails', async () => {
    CallsService.getTodayCalls.mockResolvedValue(statsWithRecording);
    CallsService.getRecordingUrl.mockResolvedValue({ recording_url: null });
    const { container } = render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());

    fireEvent.error(container.querySelector('audio'));
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument());
    expect(CallsService.getRecordingUrl).toHaveBeenCalledTimes(1); // never loops
  });

  it('refetches for the picked date and shows a "Today" reset button once changed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 15)); // Sep 15, 2026 — fixed "today"
    const emptyDay = { ...statsWithRecording, calls: [], summary: { ...statsWithRecording.summary, total: 0, connected: 0 } };
    CallsService.getTodayCalls
      .mockResolvedValueOnce(statsWithRecording) // initial mount, today
      .mockResolvedValueOnce(emptyDay);          // after date change

    const user = userEvent.setup();
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.queryByText('Today')).not.toBeInTheDocument();

    // DatePicker opens a calendar popover — "today" is frozen to Sep 15, 2026
    // above (real wall-clock date drifts and previously broke this), so go
    // back one month to reach Aug 1, 2026, then click that day.
    await user.click(screen.getByRole('button', { name: 'Select date' }));
    await user.click(screen.getByRole('button', { name: 'Go to the Previous Month' }));
    await user.click(screen.getByRole('button', { name: 'Saturday, August 1st, 2026' }));

    await waitFor(() => expect(CallsService.getTodayCalls).toHaveBeenLastCalledWith('2026-08-01'));
    expect(screen.getByText('Calls')).toBeInTheDocument(); // title drops "Today's" for a past date
    await waitFor(() => expect(screen.getByText('No calls logged on this date.')).toBeInTheDocument());

    await user.click(screen.getByText('Today'));
    await waitFor(() => expect(screen.getByText("Today's Calls")).toBeInTheDocument());
  });

  it('reports the real total via onTotalChange only while viewing today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 15)); // Sep 15, 2026 — fixed "today"
    const pastDay = { ...statsWithRecording, calls: [], summary: { ...statsWithRecording.summary, total: 3 } };
    CallsService.getTodayCalls
      .mockResolvedValueOnce(statsWithRecording) // today, total 1
      .mockResolvedValueOnce(pastDay);           // a past date, total 3 — must NOT report this

    const user = userEvent.setup();
    const onTotalChange = vi.fn();
    render(<TodayStatsPanel onTotalChange={onTotalChange} />);
    await waitFor(() => expect(onTotalChange).toHaveBeenCalledWith(1));

    onTotalChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'Select date' }));
    await user.click(screen.getByRole('button', { name: 'Go to the Previous Month' }));
    await user.click(screen.getByRole('button', { name: 'Saturday, August 1st, 2026' }));
    await waitFor(() => expect(CallsService.getTodayCalls).toHaveBeenLastCalledWith('2026-08-01'));
    expect(onTotalChange).not.toHaveBeenCalled();
  });

  it('falls back to the phone number when there is no usable lead name', async () => {
    const noName = {
      ...statsWithRecording,
      calls: [{ ...statsWithRecording.calls[0], lead_name: null, phone_number: '+15551234567' }],
    };
    CallsService.getTodayCalls.mockResolvedValue(noName);
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('+15551234567')).toBeInTheDocument());
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  it('shows "Unknown" only when neither a lead name nor a phone number exists', async () => {
    const nothing = {
      ...statsWithRecording,
      calls: [{ ...statsWithRecording.calls[0], lead_name: null, phone_number: null }],
    };
    CallsService.getTodayCalls.mockResolvedValue(nothing);
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Unknown')).toBeInTheDocument());
  });

  it('renders call duration formatted as m:ss', async () => {
    const withDuration = {
      ...statsWithRecording,
      calls: [{ ...statsWithRecording.calls[0], duration_sec: 125 }],
    };
    CallsService.getTodayCalls.mockResolvedValue(withDuration);
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('2:05')).toBeInTheDocument());
  });

  it('shows a dash for duration when not available (e.g. manual calls)', async () => {
    const noDuration = {
      ...statsWithRecording,
      calls: [{ ...statsWithRecording.calls[0], duration_sec: null }],
    };
    CallsService.getTodayCalls.mockResolvedValue(noDuration);
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    const durationCells = screen.getAllByText('—');
    expect(durationCells.length).toBeGreaterThan(0);
  });

  it('offers a download link alongside the recording player', async () => {
    CallsService.getTodayCalls.mockResolvedValue(statsWithRecording);
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    const link = screen.getByTitle('Download recording');
    expect(link).toHaveAttribute('href', 'https://cdn.example/rec1.mp3');
    expect(link).toHaveAttribute('download');
  });

  it('filters the call list by outcome', async () => {
    const twoOutcomes = {
      ...statsWithRecording,
      calls: [
        { ...statsWithRecording.calls[0], id: 'c1', lead_name: 'Jane Doe', outcome: 'Interested' },
        { ...statsWithRecording.calls[0], id: 'c2', lead_name: 'John Smith', outcome: 'No Answer' },
      ],
    };
    CallsService.getTodayCalls.mockResolvedValue(twoOutcomes);
    const user = userEvent.setup();
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('John Smith')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All outcomes' }));
    await user.click(screen.getByRole('menuitem', { name: 'No Answer' }));
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    expect(screen.getByText('John Smith')).toBeInTheDocument();
  });

  it('filters the call list by search text across name, company, and phone', async () => {
    const twoCalls = {
      ...statsWithRecording,
      calls: [
        { ...statsWithRecording.calls[0], id: 'c1', lead_name: 'Jane Doe', company: 'Acme' },
        { ...statsWithRecording.calls[0], id: 'c2', lead_name: 'John Smith', company: 'Globex' },
      ],
    };
    CallsService.getTodayCalls.mockResolvedValue(twoCalls);
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Search name, company, phone…'), { target: { value: 'globex' } });
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    expect(screen.getByText('John Smith')).toBeInTheDocument();
  });

  it('paginates when the call list exceeds one page', async () => {
    const manyCalls = {
      ...statsWithRecording,
      calls: Array.from({ length: 20 }, (_, i) => ({
        ...statsWithRecording.calls[0], id: `c${i}`, lead_name: `Lead ${i}`,
      })),
    };
    CallsService.getTodayCalls.mockResolvedValue(manyCalls);
    render(<TodayStatsPanel />);
    await waitFor(() => expect(screen.getByText('Lead 0')).toBeInTheDocument());

    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.queryByText('Lead 19')).not.toBeInTheDocument(); // page 2, not shown yet

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByText('Lead 19')).toBeInTheDocument());
    expect(screen.queryByText('Lead 0')).not.toBeInTheDocument();
  });
});
