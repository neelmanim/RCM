import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmsCampaignsSection } from '../../features/sales-tools/SmsCampaignsSection';

const getEmbedUrl = vi.fn();

vi.mock('../../services/api', () => ({
  ConversationsService: {
    getEmbedUrl: (...args) => getEmbedUrl(...args),
  },
}));

beforeEach(() => {
  getEmbedUrl.mockReset();
});

describe('SmsCampaignsSection', () => {
  it('shows an "Open ... in Alternate Messenger" link (new tab), not an iframe, once the URL is ready', async () => {
    getEmbedUrl.mockResolvedValue({ url: 'https://app.alternatecrm.com/api/v2/crm/authenticate?redirect_url=x' });
    render(<SmsCampaignsSection />);

    expect(getEmbedUrl).toHaveBeenCalledWith('campaigns');
    const link = await screen.findByRole('link', { name: /Open Campaigns in Alternate Messenger/i });
    expect(link).toHaveAttribute('href', 'https://app.alternatecrm.com/api/v2/crm/authenticate?redirect_url=x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows a retry button and re-fetches on error', async () => {
    getEmbedUrl.mockRejectedValueOnce({ message: 'boom' });
    render(<SmsCampaignsSection />);

    await screen.findByText('boom');
    getEmbedUrl.mockResolvedValueOnce({ url: 'https://app.alternatecrm.com/x' });
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await screen.findByRole('link', { name: /Open Campaigns in Alternate Messenger/i });
    expect(getEmbedUrl).toHaveBeenCalledTimes(2);
  });

  it('fetches a fresh URL for Inbox when switching tabs', async () => {
    getEmbedUrl.mockResolvedValue({ url: 'https://app.alternatecrm.com/x' });
    render(<SmsCampaignsSection />);
    await screen.findByRole('link', { name: /Open Campaigns in Alternate Messenger/i });

    await userEvent.click(screen.getByRole('button', { name: 'Inbox' }));

    await waitFor(() => expect(getEmbedUrl).toHaveBeenCalledWith('inbox'));
    await screen.findByRole('link', { name: /Open Inbox in Alternate Messenger/i });
  });
});
