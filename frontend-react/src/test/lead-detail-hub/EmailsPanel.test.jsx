import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailsPanel } from '../../features/lead-detail-hub/components/EmailsPanel';

const EMAILS = [
  { id: 'a', direction: 'outbound', subject: 'Intro', open_count: 2, click_count: 1, source: 'cadence', user_name: 'Monisha' },
  { id: 'b', direction: 'outbound', subject: 'Follow up', open_count: 0, click_count: 0, source: 'manual' },
  { id: 'c', direction: 'inbound', subject: 'Re: Intro', from_email: 'paul@x.com', is_auto_reply: false },
  { id: 'd', direction: 'inbound', subject: 'Out of office', is_auto_reply: true },
];

// RCA 2026-09-29: the hub showed no emails or email stats at all.
// Emails are now fetched once by useLeadDetail (so the activity feed can
// also include them) and passed into this panel as props instead of it
// self-fetching — see LeadDetailHub.jsx/useLeadDetail.js.
describe('EmailsPanel', () => {
  it('lists the emails with sent/opened/clicked/replied stats (auto-replies not counted)', async () => {
    render(<EmailsPanel emails={EMAILS} />);
    expect(await screen.findByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('Follow up')).toBeInTheDocument();
    const stat = (label) => screen.getByText(label, { selector: 'p' }).nextSibling.textContent;
    expect(stat('Sent')).toBe('2');
    expect(stat('Opened')).toBe('1 (50%)');
    expect(stat('Clicked')).toBe('1 (50%)');
    expect(stat('Replied')).toBe('1');
    expect(screen.getByText('Cadence')).toBeInTheDocument();
    expect(screen.getByText('Auto-reply')).toBeInTheDocument();
  });

  it('shows the one-time Emails tour once the lead has emails', async () => {
    localStorage.removeItem('alternate:lead-detail-emails-tour-seen');
    render(<EmailsPanel emails={EMAILS} />);
    expect(await screen.findByText("This lead's email at a glance")).toBeInTheDocument();
  });

  it('shows a loading skeleton while emails are being fetched', () => {
    render(<EmailsPanel emails={[]} loading />);
    expect(screen.queryByText('No emails with this lead yet.')).not.toBeInTheDocument();
  });

  it('shows an error message when the fetch failed', () => {
    render(<EmailsPanel emails={[]} error />);
    expect(screen.getByText("Couldn't load emails.")).toBeInTheDocument();
  });
});
