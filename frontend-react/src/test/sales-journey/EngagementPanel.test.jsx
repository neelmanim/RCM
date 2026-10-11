import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EngagementPanel } from '../../features/sales-journey/EngagementPanel';

const getStats = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    getStats: (...args) => getStats(...args),
  },
}));

const NODES = [
  { id: 'n1', type: 'trigger', data: {} },
  { id: 'n2', type: 'email', data: {} },
];

beforeEach(() => {
  getStats.mockClear();
});

describe('EngagementPanel', () => {
  it('renders nothing while loading or when nothing has been sent yet', async () => {
    getStats.mockResolvedValue({
      engagement: { overall: { sent: 0, opened: 0, clicked: 0, replied: 0, open_rate: 0, click_rate: 0, reply_rate: 0 }, by_step: {} },
      total: 0,
    });
    const { container } = render(<EngagementPanel journeyId="j1" nodes={NODES} />);
    await waitFor(() => expect(getStats).toHaveBeenCalledWith('j1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows overall email KPIs once emails have been sent', async () => {
    getStats.mockResolvedValue({
      engagement: {
        overall: { sent: 10, opened: 5, clicked: 2, replied: 3, open_rate: 0.5, click_rate: 0.2, reply_rate: 0.3 },
        by_step: { n2: { sent: 10, opened: 5, clicked: 2, replied: 3, open_rate: 0.5, click_rate: 0.2, reply_rate: 0.3 } },
      },
      total: 10,
    });
    render(<EngagementPanel journeyId="j1" nodes={NODES} />);

    await screen.findByText('Engagement');
    const kpiCard = screen.getByText(/Email · 10 sent/).closest('.rounded-xl');
    expect(kpiCard).toHaveTextContent('50%');
  });

  it('shows a per-step breakdown table with one row per step', async () => {
    getStats.mockResolvedValue({
      engagement: {
        overall: { sent: 10, opened: 5, clicked: 2, replied: 3, open_rate: 0.5, click_rate: 0.2, reply_rate: 0.3 },
        by_step: {
          n2: { sent: 6, opened: 3, clicked: 1, replied: 2, open_rate: 0.5, click_rate: 0.167, reply_rate: 0.33 },
          n3: { sent: 4, opened: 2, clicked: 1, replied: 1, open_rate: 0.5, click_rate: 0.25, reply_rate: 0.25 },
        },
      },
      total: 10,
    });
    const nodes = [...NODES, { id: 'n3', type: 'email', data: {} }];
    render(<EngagementPanel journeyId="j1" nodes={nodes} />);

    await screen.findByText('Step');
    expect(screen.getByText('Email #1')).toBeInTheDocument();
    expect(screen.getByText('Email #2')).toBeInTheDocument();
  });

  it('shows a per-variant breakdown row even with only a single email step', async () => {
    getStats.mockResolvedValue({
      engagement: {
        overall: { sent: 10, opened: 6, clicked: 2, replied: 1, open_rate: 0.6, click_rate: 0.2, reply_rate: 0.1 },
        by_step: {
          n2: {
            sent: 10, opened: 6, clicked: 2, replied: 1, open_rate: 0.6, click_rate: 0.2, reply_rate: 0.1,
            by_variant: {
              A: { sent: 5, opened: 4, clicked: 1, replied: 1, open_rate: 0.8, click_rate: 0.2, reply_rate: 0.2 },
              B: { sent: 5, opened: 2, clicked: 1, replied: 0, open_rate: 0.4, click_rate: 0.2, reply_rate: 0 },
            },
          },
        },
      },
      total: 10,
    });
    render(<EngagementPanel journeyId="j1" nodes={NODES} />);

    await screen.findByText('Step');
    expect(screen.getByText('↳ Variant A')).toBeInTheDocument();
    expect(screen.getByText('↳ Variant B')).toBeInTheDocument();
  });

  it('merges a manual SMS step\'s send-engagement AND its done/missed counters into one row', async () => {
    getStats.mockResolvedValue({
      engagement: { overall: { sent: 0, opened: 0, clicked: 0, replied: 0, open_rate: 0, click_rate: 0, reply_rate: 0 }, by_step: {} },
      sms_engagement: {
        overall: { sent: 4, delivered: 3, replied: 1, delivery_rate: 0.75, reply_rate: 0.25 },
        by_step: { n3: { sent: 4, delivered: 3, replied: 1, delivery_rate: 0.75, reply_rate: 0.25 } },
      },
      step_activity: {
        n2: { channel: 'task', sent: 2, skipped: 0, completed: 1, missed: 1, outcomes: {}, is_manual: false },
        n3: { channel: 'sms', sent: 4, skipped: 0, completed: 3, missed: 1, outcomes: {}, is_manual: true },
      },
      total: 0,
    });
    const nodes = [
      { id: 'n1', type: 'trigger', data: {} },
      { id: 'n2', type: 'task', data: {} },
      { id: 'n3', type: 'sms', data: {} },
    ];
    render(<EngagementPanel journeyId="j1" nodes={nodes} />);

    const row = (await screen.findByText('SMS')).closest('tr');
    expect(row).toHaveTextContent('75%'); // delivered %
    expect(row).toHaveTextContent('25%'); // reply %
    expect(row).toHaveTextContent('3');   // done
    expect(row).toHaveTextContent('1');   // missed

    const taskRow = screen.getByText('Task').closest('tr');
    expect(taskRow).toHaveTextContent('1'); // done
  });

  it('labels a call step\'s Sent count as reminder tasks, not calls placed (AE: "Call #1 sent 2" read as 2 calls)', async () => {
    getStats.mockResolvedValue({
      engagement: { overall: { sent: 0, opened: 0, clicked: 0, replied: 0, open_rate: 0, click_rate: 0, reply_rate: 0 }, by_step: {} },
      step_activity: {
        n2: { channel: 'call', sent: 2, skipped: 0, completed: 0, missed: 0, outcomes: {}, is_manual: false },
        n3: { channel: 'task', sent: 4, skipped: 0, completed: 1, missed: 0, outcomes: {}, is_manual: false },
      },
      total: 4,
    });
    const nodes = [
      { id: 'n1', type: 'trigger', data: {} },
      { id: 'n2', type: 'call', data: {} },
      { id: 'n3', type: 'task', data: {} },
    ];
    render(<EngagementPanel journeyId="j1" nodes={nodes} />);

    const callRow = (await screen.findByText('Call')).closest('tr');
    expect(callRow).toHaveTextContent('2 tasks created');
    expect(screen.getByTitle(/not calls placed/)).toBeInTheDocument();
    expect(screen.getByText('Task').closest('tr')).not.toHaveTextContent('tasks created');
  });

  it('shows the opt-out rate as its own KPI', async () => {
    getStats.mockResolvedValue({
      engagement: { overall: { sent: 5, opened: 0, clicked: 0, replied: 0, open_rate: 0, click_rate: 0, reply_rate: 0 }, by_step: {} },
      exit_reasons: { suppressed: 2 },
      total: 8,
      opted_out: { count: 2, rate: 0.25 },
    });
    render(<EngagementPanel journeyId="j1" nodes={NODES} />);

    await screen.findByText(/Opted out · of 8 enrolled/);
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText(/2 opted out/)).toBeInTheDocument();
  });
});
