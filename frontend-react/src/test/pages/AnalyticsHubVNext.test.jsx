import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalyticsHubVNext } from '../../pages/Analytics/vnext/AnalyticsHubVNext';
import { AnalyticsGovernanceService } from '../../services/api';

const METRICS = [
  { id: 'connect_rate', name: 'Connect Rate', unit: 'percent', version: 1, status: 'published' },
  { id: 'leads_assigned', name: 'Leads Assigned', unit: 'count', version: 1, status: 'published' },
];

vi.mock('../../services/api', () => ({
  AnalyticsVNextService: {
    listMetrics: vi.fn(() => Promise.resolve(METRICS)),
    resolveMetric: vi.fn((metricId) =>
      Promise.resolve(
        metricId === 'connect_rate'
          ? { metric: { id: 'connect_rate', name: 'Connect Rate', version: 1, status: 'published', unit: 'percent' }, value: 42.5, explanation: { definition: 'def', formula: 'f', numerator: 5, denominator: 10, numerator_label: 'connected calls', denominator_label: 'calls made', date_basis: 'call_event_time', filters_applied: {}, date_range: { start: null, end: null }, execution_ms: 3, known_caveats: [], warnings: [] } }
          : { metric: { id: metricId, name: 'Leads Assigned', version: 1, status: 'published', unit: 'count' }, value: 12, explanation: { definition: 'd', formula: 'f', numerator: null, denominator: null, numerator_label: null, denominator_label: null, date_basis: 'lead_created_at', filters_applied: {}, date_range: { start: null, end: null }, execution_ms: 1, known_caveats: [], warnings: [] } }
      )
    ),
    compareMetric: vi.fn(() => Promise.resolve({ metric_id: 'connect_rate', legacy_value: 42.5, vnext_value: 42.5, match: true })),
    ask: vi.fn(() => Promise.resolve({
      interpretation: { metric: 'Connect Rate', period: 'last_30_days' },
      result: { metric: { id: 'connect_rate', unit: 'percent' }, value: 42.5 },
      unsupported: false,
      message: null,
    })),
  },
  AnalyticsService: {
    getFilters: vi.fn(() => Promise.resolve({ pods: [], batches: [], sdrs: [] })),
  },
  AnalyticsGovernanceService: {
    listVersions: vi.fn(() => Promise.resolve([])),
    createDraft: vi.fn(),
    editDraft: vi.fn(),
    previewDraft: vi.fn(),
    compareVersions: vi.fn(),
    publish: vi.fn(),
  },
}));

describe('AnalyticsHubVNext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AnalyticsGovernanceService.listVersions.mockResolvedValue([]);
  });

  it('renders a card per registered metric with its resolved value', async () => {
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    await waitFor(() => expect(screen.getByText('42.5%')).toBeInTheDocument());
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('opens Inspect for a metric and shows its definition', async () => {
    const user = userEvent.setup();
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    await waitFor(() => expect(screen.getByText('42.5%')).toBeInTheDocument());

    const inspectButtons = screen.getAllByText('Inspect');
    await user.click(inspectButtons[0]);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('def')).toBeInTheDocument());
    // Registry's numerator/denominator_description text, not just the bare
    // numbers — this is what actually answers "what does this number count".
    expect(within(dialog).getByText(/connected calls/)).toBeInTheDocument();
    expect(within(dialog).getByText(/calls made/)).toBeInTheDocument();
    expect(within(dialog).getByText(/42.5%/)).toBeInTheDocument();
  });

  it('shows the old-vs-new compare result inline, including a match indicator', async () => {
    const user = userEvent.setup();
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    await waitFor(() => expect(screen.getByText('42.5%')).toBeInTheDocument());

    const compareButtons = screen.getAllByText('Compare with current');
    await user.click(compareButtons[0]);
    await waitFor(() => expect(screen.getByText(/match/)).toBeInTheDocument());
  });

  it('switches to Ask Analytics and shows the AI interpretation before the answer', async () => {
    const user = userEvent.setup();
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    await user.click(screen.getByText('Ask Analytics'));
    await user.type(screen.getByPlaceholderText(/connect rate/i), "what's our connect rate?");
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(screen.getByText(/I understood this as/)).toBeInTheDocument());
    expect(screen.getByText('Connect Rate', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('42.5%')).toBeInTheDocument();
  });

  it('calls onBackToClassic when the return link is clicked', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={onBack} />);
    await user.click(screen.getByText('Back to current Analytics Hub'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows a Try vN button when a draft exists and previews it on click', async () => {
    AnalyticsGovernanceService.listVersions.mockImplementation((metricId) =>
      Promise.resolve(
        metricId === 'connect_rate'
          ? [{ id: 'v2', metric_id: 'connect_rate', version_number: 2, status: 'draft', definition: {} }]
          : []
      )
    );
    AnalyticsGovernanceService.previewDraft.mockResolvedValue({
      value: 55.5,
      metric: { id: 'connect_rate', version: 2, status: 'draft' },
      explanation: { definition: 'new def' },
    });
    AnalyticsGovernanceService.compareVersions.mockResolvedValue({
      metric_id: 'connect_rate', published_version: 1, draft_version: 2,
      published: { description: 'old def' }, draft: { description: 'new def' },
      changed_fields: ['description'],
    });

    const user = userEvent.setup();
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    const tryButton = await screen.findByText('Try v2');
    await user.click(tryButton);

    await waitFor(() => expect(screen.getByText('55.5%')).toBeInTheDocument());
    expect(screen.getByText(/Definition \(changed\)/)).toBeInTheDocument();
  });

  it('does not show a Try vN button when no draft exists, but offers to draft one', async () => {
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    await waitFor(() => expect(screen.getByText('42.5%')).toBeInTheDocument());
    expect(screen.queryByText(/^Try v/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Draft v2').length).toBeGreaterThan(0);
  });

  it('creates a draft from the Draft button and can edit and save it', async () => {
    AnalyticsGovernanceService.createDraft.mockResolvedValue({
      id: 'v2', metric_id: 'connect_rate', version_number: 2, status: 'draft',
      definition: { description: 'Percentage of outbound calls that resulted in a human connection.' },
    });
    AnalyticsGovernanceService.previewDraft.mockResolvedValue({
      value: 42.5, metric: { id: 'connect_rate', version: 2, status: 'draft' }, explanation: { definition: 'edited' },
    });
    AnalyticsGovernanceService.compareVersions.mockResolvedValue({
      metric_id: 'connect_rate', published_version: 1, draft_version: 2,
      published: { description: 'old' }, draft: { description: 'edited' }, changed_fields: ['description'],
    });
    AnalyticsGovernanceService.editDraft.mockResolvedValue({
      id: 'v2', metric_id: 'connect_rate', version_number: 2, status: 'draft',
      definition: { description: 'edited' },
    });

    const user = userEvent.setup();
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    await waitFor(() => expect(screen.getByText('42.5%')).toBeInTheDocument());

    await user.click(screen.getAllByText('Draft v2')[0]);
    expect(AnalyticsGovernanceService.createDraft).toHaveBeenCalledWith('connect_rate');

    const tryButton = await screen.findByText('Try v2');
    await user.click(tryButton);

    const textarea = await screen.findByDisplayValue(/human connection/);
    await user.clear(textarea);
    await user.type(textarea, 'edited');
    await user.click(screen.getByText('Save draft'));

    await waitFor(() => expect(AnalyticsGovernanceService.editDraft).toHaveBeenCalledWith('v2', { description: 'edited' }));
  });

  it('renders a trend result as bars instead of a scalar value', async () => {
    const { AnalyticsVNextService } = await import('../../services/api');
    AnalyticsVNextService.ask.mockResolvedValueOnce({
      interpretation: { metric: 'Calls Made', group_by: 'day', period: 'last_30_days' },
      result: { data: [{ label: '01 Aug', value: 5 }, { label: '02 Aug', value: 8 }], group_by: 'day', metric: 'calls_made' },
      unsupported: false,
      message: null,
    });

    const user = userEvent.setup();
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    await user.click(screen.getByText('Ask Analytics'));
    await user.type(screen.getByPlaceholderText(/connect rate/i), 'calls made per day');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(screen.getByText('01 Aug')).toBeInTheDocument());
    expect(screen.getByText('02 Aug')).toBeInTheDocument();
    expect(screen.getByText(/daily trend/)).toBeInTheDocument();
  });

  it('shows a grouped KPI grid on the Overview tab', async () => {
    const user = userEvent.setup();
    render(<AnalyticsHubVNext userRole="Super Admin" onBackToClassic={() => {}} />);
    await user.click(screen.getByText('Overview'));
    await waitFor(() => expect(screen.getByText('42.5%')).toBeInTheDocument());
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Connect Rate')).toBeInTheDocument();
  });
});
