import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignsSection } from '../../features/sales-tools/CampaignsSection';
import { EmailCampaignService } from '../../services/api';

vi.mock('../../services/api', () => ({
  EmailCampaignService: { list: vi.fn(), get: vi.fn(), rename: vi.fn() },
  EmailTemplateService: { list: vi.fn().mockResolvedValue({ templates: [] }) },
  LeadsService: { getLeads: vi.fn() },
  AssignmentsService: { getUploadLogs: vi.fn().mockResolvedValue({ logs: [] }) },
}));

const CAMPAIGNS = [
  { id: 'c1', name: 'Mine', status: 'completed', sent_count: 1, total_recipients: 1, failed_count: 0, skipped_count: 0, open_rate: null, click_rate: null, created_at: null, created_by: 'me', created_by_name: 'Me', is_mine: true },
  { id: 'c2', name: "Someone else's", status: 'completed', sent_count: 1, total_recipients: 1, failed_count: 0, skipped_count: 0, open_rate: null, click_rate: null, created_at: null, created_by: 'other', created_by_name: 'Other Rep', is_mine: false },
];

describe('CampaignsSection — admin visibility (v12.7.10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    EmailCampaignService.list.mockResolvedValue({ campaigns: CAMPAIGNS, total: 2, pages: 1 });
  });

  it('shows a "Run By" column and "My campaigns only" toggle for a Super Admin', async () => {
    render(<CampaignsSection userRole="Super Admin" />);
    // "Someone else's" also appears in PerformanceSection's campaign
    // dropdown — assert on the table's own "Run By" cell instead.
    await waitFor(() => expect(screen.getAllByText("Someone else's").length).toBeGreaterThan(0));

    expect(screen.getByText('Run By')).toBeInTheDocument();
    expect(screen.getByText('Other Rep')).toBeInTheDocument();
    expect(screen.getByLabelText('My campaigns only')).toBeInTheDocument();
  });

  it('re-fetches with mine=true when the toggle is checked', async () => {
    render(<CampaignsSection userRole="Pod Admin" />);
    await waitFor(() => expect(screen.getAllByText("Someone else's").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByLabelText('My campaigns only'));

    await waitFor(() => expect(EmailCampaignService.list).toHaveBeenCalledWith(
      expect.objectContaining({ mine: true })
    ));
  });

  it('hides the "Run By" column and toggle for a non-admin (SDR)', async () => {
    render(<CampaignsSection userRole="SDR" />);
    await waitFor(() => expect(screen.getAllByText('Mine').length).toBeGreaterThan(0));

    expect(screen.queryByText('Run By')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('My campaigns only')).not.toBeInTheDocument();
  });
});

describe('CampaignsSection — rename (old auto-named campaigns)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    EmailCampaignService.list.mockResolvedValue({ campaigns: CAMPAIGNS, total: 2, pages: 1 });
    EmailCampaignService.rename.mockResolvedValue({ id: 'c1', name: 'Renamed' });
  });

  it('lets the creator rename their own campaign', async () => {
    render(<CampaignsSection userRole="SDR" />);
    await waitFor(() => expect(screen.getAllByText('Mine').length).toBeGreaterThan(0));

    const [pencilIcon] = document.querySelectorAll('svg.lucide-pencil');
    expect(pencilIcon).toBeTruthy();
    await userEvent.click(pencilIcon);

    const input = screen.getByDisplayValue('Mine');
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed');
    await userEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(EmailCampaignService.rename).toHaveBeenCalledWith('c1', 'Renamed'));
  });

  it('does not offer a rename icon for someone else\'s campaign to a non-admin', async () => {
    render(<CampaignsSection userRole="SDR" />);
    await waitFor(() => expect(screen.getAllByText('Mine').length).toBeGreaterThan(0));

    // Only "Mine" (is_mine: true) gets a rename icon — "Someone else's" (is_mine: false) shouldn't.
    expect(document.querySelectorAll('svg.lucide-pencil').length).toBe(1);
  });
});
