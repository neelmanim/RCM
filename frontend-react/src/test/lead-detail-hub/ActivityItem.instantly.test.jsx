import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityItem } from '../../features/lead-detail-hub/components/ActivityItem';
import { normalizeEmailActivity } from '../../features/lead-detail-hub/lib/normalizeActivity';

const row = (o) => normalizeEmailActivity([{ id: 'e1', provider: 'instantly', direction: 'inbound', timestamp: '2026-10-01T00:00:00Z', subject: 'Re: Hi', ...o }])[0];

describe('ActivityItem — Instantly body expand', () => {
  it('toggles a plain-text body with aria-expanded', async () => {
    const user = userEvent.setup();
    render(<ActivityItem activity={row({ body_preview: '<b>Hi</b>\nthere' })} />);
    const btn = screen.getByRole('button', { name: 'Show email body' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/there/)).not.toBeInTheDocument();
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    // rendered as text, never parsed as HTML
    expect(screen.getByText(/<b>Hi<\/b>/)).toBeInTheDocument();
    await user.click(btn);
    expect(screen.queryByText(/there/)).not.toBeInTheDocument();
  });

  it('has no toggle without a body preview', () => {
    render(<ActivityItem activity={row({})} />);
    expect(screen.queryByRole('button', { name: /email body/ })).not.toBeInTheDocument();
  });
});
