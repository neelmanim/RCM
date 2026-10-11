import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskAiTab } from '../../pages/Analytics/AskAiTab';
import { SmartAnalyticsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  SmartAnalyticsService: {
    query: vi.fn(),
    getReports: vi.fn(),
    saveReport: vi.fn(),
    deleteReport: vi.fn(),
    pinReport: vi.fn(),
  },
}));

// AiResultChart wraps window.Chart, which jsdom doesn't provide — not what
// these tests are exercising, so render a stub instead.
vi.mock('../../pages/Analytics/AiResultChart', () => ({ AiResultChart: () => <div data-testid="chart" /> }));

describe('AskAiTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SmartAnalyticsService.getReports.mockResolvedValue([]);
  });

  it('renders a table result through the shared Table component', async () => {
    SmartAnalyticsService.query.mockResolvedValue({
      mode: 'standard',
      answer: 'Here are the results.',
      data: [{ sdr_name: 'Tanya Batra', calls_made: 12 }],
    });
    render(<AskAiTab filters={{}} />);

    await userEvent.type(screen.getByPlaceholderText(/ask your pipeline/i), 'Calls by SDR');
    await userEvent.click(screen.getByRole('button', { name: /run query/i }));

    expect(await screen.findByText('Here are the results.')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Tanya Batra')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('calls onEditFilters from the scoping banner', async () => {
    const onEditFilters = vi.fn();
    render(<AskAiTab filters={{ pod_name: 'Pod A' }} onEditFilters={onEditFilters} />);
    await userEvent.click(screen.getByTitle('Edit filters in Dashboard tab'));
    expect(onEditFilters).toHaveBeenCalled();
  });

  it('does not render an edit control when onEditFilters is not provided', () => {
    render(<AskAiTab filters={{}} />);
    expect(screen.queryByTitle('Edit filters in Dashboard tab')).not.toBeInTheDocument();
  });

  it('pins a result to the Dashboard, auto-saving it first', async () => {
    SmartAnalyticsService.query.mockResolvedValue({ mode: 'standard', answer: 'Answer text' });
    SmartAnalyticsService.saveReport.mockResolvedValue({ id: 'r1', name: 'Pinned Report' });
    SmartAnalyticsService.pinReport.mockResolvedValue({ id: 'r1', is_pinned: true });
    const onPinSuccess = vi.fn();
    render(<AskAiTab filters={{}} onPinSuccess={onPinSuccess} />);

    await userEvent.type(screen.getByPlaceholderText(/ask your pipeline/i), 'Top performers');
    await userEvent.click(screen.getByRole('button', { name: /run query/i }));
    await screen.findByText('Answer text');

    await userEvent.click(screen.getByRole('button', { name: /pin to dashboard/i }));

    await waitFor(() => expect(SmartAnalyticsService.pinReport).toHaveBeenCalledWith('r1', true));
    expect(onPinSuccess).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /^pinned$/i })).toBeDisabled();
  });

  it('shows saved reports and suggestions in the query typeahead on focus', async () => {
    SmartAnalyticsService.getReports.mockResolvedValue([
      { id: 'r1', name: 'Weekly SDR calls', natural_language_query: 'Calls made by each SDR this week' },
    ]);
    render(<AskAiTab filters={{}} />);
    await screen.findByText('Weekly SDR calls'); // saved reports loaded into the side panel too

    await userEvent.click(screen.getByPlaceholderText(/ask your pipeline/i));

    expect(await screen.findByText('Try asking')).toBeInTheDocument();
    expect(screen.getAllByText('Saved Reports').length).toBe(2); // side panel header + typeahead section
    expect(screen.getAllByText('Weekly SDR calls').length).toBe(2); // side panel row + typeahead row
    expect(screen.getByText('Top performers vs target this month')).toBeInTheDocument();
  });

  it('filters the typeahead as the user types', async () => {
    render(<AskAiTab filters={{}} />);
    const input = screen.getByPlaceholderText(/ask your pipeline/i);

    await userEvent.type(input, 'pipeline health');

    expect(await screen.findByText('Pipeline health score summary')).toBeInTheDocument();
    expect(screen.queryByText('Top performers vs target this month')).not.toBeInTheDocument();
  });

  it('keeps the typeahead open when clicking back into the query box mid-session', async () => {
    render(<AskAiTab filters={{}} />);
    const input = screen.getByPlaceholderText(/ask your pipeline/i);
    await userEvent.click(input);
    await screen.findByText('Top performers vs target this month');

    await userEvent.click(input); // e.g. repositioning the caret while typing

    expect(screen.getByText('Top performers vs target this month')).toBeInTheDocument();
  });

  it('runs a query selected from the typeahead suggestions', async () => {
    SmartAnalyticsService.query.mockResolvedValue({ mode: 'standard', answer: 'Suggestion answer' });
    render(<AskAiTab filters={{}} />);

    await userEvent.click(screen.getByPlaceholderText(/ask your pipeline/i));
    await userEvent.click(await screen.findByText('Meeting conversion rate by pod'));

    expect(await screen.findByText('Suggestion answer')).toBeInTheDocument();
    expect(SmartAnalyticsService.query).toHaveBeenCalledWith('Meeting conversion rate by pod', [], {});
  });

  it('runs a saved report selected from the typeahead', async () => {
    SmartAnalyticsService.getReports.mockResolvedValue([
      { id: 'r1', name: 'Weekly SDR calls', natural_language_query: 'Calls made by each SDR this week' },
    ]);
    SmartAnalyticsService.query.mockResolvedValue({ mode: 'standard', answer: 'Saved report answer' });
    render(<AskAiTab filters={{}} />);
    await screen.findByText('Weekly SDR calls');

    await userEvent.click(screen.getByPlaceholderText(/ask your pipeline/i));
    const matches = await screen.findAllByText('Weekly SDR calls');
    await userEvent.click(matches[matches.length - 1]); // the typeahead's copy, not the side panel's

    expect(await screen.findByText('Saved report answer')).toBeInTheDocument();
    expect(SmartAnalyticsService.query).toHaveBeenCalledWith('Calls made by each SDR this week', [], {});
  });

  it('shows a clarify prompt and re-runs with the reply', async () => {
    SmartAnalyticsService.query
      .mockResolvedValueOnce({ action: 'clarify', question: 'Which pod?' })
      .mockResolvedValueOnce({ mode: 'standard', answer: 'Resolved answer' });
    render(<AskAiTab filters={{}} />);

    await userEvent.type(screen.getByPlaceholderText(/ask your pipeline/i), 'Top performers');
    await userEvent.click(screen.getByRole('button', { name: /run query/i }));
    expect(await screen.findByText('Which pod?')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/type your answer/i), 'Pod A{enter}');
    expect(await screen.findByText('Resolved answer')).toBeInTheDocument();
  });
});
