import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoTip } from '../../components/ui/InfoTip';
import { DrillDownSection } from '../../features/daily-digest/DrillDownSection';
import { DigestDrillService } from '../../services/api';

vi.mock('../../services/api', () => ({
  DigestDrillService: { breakdown: vi.fn(), accounts: vi.fn(), calls: vi.fn(), getIcp: vi.fn(), setIcp: vi.fn(), exportXlsx: vi.fn(), leads: vi.fn() },
}));
vi.mock('../../features/control-center/notify', () => ({ toast: vi.fn(), errorText: () => 'failed' }));

describe('InfoTip', () => {
  it('explains itself on hover and on keyboard focus, and goes away again', async () => {
    render(<InfoTip text="Calls made, including the ones nobody answered." label="About Calls" />);
    const btn = screen.getByRole('button', { name: 'About Calls' });
    fireEvent.mouseEnter(btn);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Calls made, including the ones nobody answered.');
    fireEvent.mouseLeave(btn);
    await waitFor(() => expect(screen.queryByRole('tooltip')?.getAttribute('data-state') ?? 'closed').toBe('closed'));
    fireEvent.focus(btn);
    await waitFor(() => expect(screen.getByRole('tooltip').getAttribute('data-state')).toBe('open'));
  });

  it('a click on it does not trigger the row or header it sits in', async () => {
    const onRow = vi.fn();
    render(<table><tbody><tr onClick={onRow}><td><InfoTip text="help" /></td></tr></tbody></table>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'More information' }));
    expect(onRow).not.toHaveBeenCalled();
  });
});

const ROW = (label) => ({ label, leads: 9, accounts: 9, calls: 40, conversations: 12, connect_rate: 30, emails: 1, notes: 0, booked: 2, held: 1, no_show: 0, leads_spoken_to: 6,
  lead_to_conversation: 66.7, booked_per_100_conversations: 16.7, held_rate: 50, thin: {}, prev: { leads: 8, calls: 30, conversations: 10, booked: 1 }, delta: { leads: 12.5, calls: 33.3, conversations: 20, booked: 100 } });

describe('every number on the drill-down is explained', () => {
  it('each column header and tile has a plain-language tip (no jargon), and the extra columns do too', async () => {
    DigestDrillService.breakdown.mockResolvedValue({ dimension: 'country', label: 'Country', more: 0, compared: true, compare_label: 'the previous 7 days', icp_keywords: null, unclassified_titles: [],
      rows: [ROW('India')], total: ROW('Total'), coverage: { leads: 10, filled: 9, pct: 90 } });
    render(<DrillDownSection podId="" range={{ from: '2026-09-01', to: '2026-09-07' }} />);
    await screen.findByText('India');
    await userEvent.setup().click(screen.getByRole('button', { name: 'More columns' }));
    const heads = screen.getAllByRole('columnheader').filter((h) => !/^\s*(Country|Open)?\s*$/.test(h.textContent) && h.querySelector('button[aria-label^="About"]') !== null);
    const labels = heads.map((h) => h.querySelector('button[aria-label^="About"]').getAttribute('aria-label'));
    for (const want of ['Leads', 'Accounts', 'Calls', 'Conversations', 'Connect %', 'Leads spoken to %', 'Emails', 'Booked', 'Booked / 100 conv.', 'Held', 'Held %']) expect(labels).toContain(`About ${want}`);
    for (const h of heads) {
      const text = h.querySelector('button[aria-label^="About"]').getAttribute('title');
      expect(text.length).toBeGreaterThan(15);
      expect(text).not.toMatch(/\b(api|endpoint|sql|query|json|null|rate limit|dedup)\b/i);
    }
    expect(screen.getByRole('button', { name: 'About Filled in' }).getAttribute('title')).toMatch(/leads worked.*on record/i);
  });
});
