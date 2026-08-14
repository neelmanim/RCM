import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FeedbackModal } from '../../layout/FeedbackModal';

describe('FeedbackModal (live, nav-hub)', () => {
  beforeEach(() => {
    window.__CRM_API_BASE__ = 'https://api.test';
    window._authHeaders = () => ({ Authorization: 'Bearer test-token' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true }) })));
  });

  it('renders nothing when closed', () => {
    render(<FeedbackModal open={false} onClose={() => {}} />);
    expect(screen.queryByText('Send Feedback')).not.toBeInTheDocument();
  });

  it('renders the form when open, defaulting to Bug Report', () => {
    render(<FeedbackModal open onClose={() => {}} />);
    expect(screen.getByText('Send Feedback')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe the issue or suggestion...')).toBeInTheDocument();
  });

  it('requires a message before submitting', () => {
    render(<FeedbackModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText('Submit Feedback'));
    expect(screen.getByText('Please enter a message.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('submits the selected type + message to /api/admin/feedback', async () => {
    render(<FeedbackModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText('Feature Request'));
    fireEvent.change(screen.getByPlaceholderText('Describe the issue or suggestion...'), {
      target: { value: 'Please add dark mode' },
    });
    fireEvent.click(screen.getByText('Submit Feedback'));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      'https://api.test/api/admin/feedback',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        body: JSON.stringify({ type: 'feature', message: 'Please add dark mode' }),
      }),
    ));
    expect(await screen.findByText('Thanks for your feedback!')).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    fetch.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    render(<FeedbackModal open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Describe the issue or suggestion...'), {
      target: { value: 'Something broke' },
    });
    fireEvent.click(screen.getByText('Submit Feedback'));
    expect(await screen.findByText('Failed to submit. Please try again.')).toBeInTheDocument();
  });
});
