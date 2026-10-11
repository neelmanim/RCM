import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DailyDigestTour, DIGEST_STEPS, DIGEST_TOUR_KEY } from '../../features/daily-digest/DailyDigestTour';

const targets = (skip = []) => DIGEST_STEPS.map((s) => s.target).filter((t) => !skip.includes(t));
// Stand-ins carrying the same data-tour / data-tab attributes as the real page (the drill-down tab sits inside the drill-down card).
function Page({ skip = [], late = false }) {
  const [ready, setReady] = React.useState(!late);
  React.useEffect(() => { if (late) { const t = setTimeout(() => setReady(true), 900); return () => clearTimeout(t); } return undefined; }, [late]);
  return (
    <div>
      {ready && DIGEST_STEPS.map((s) => s.target).filter((t) => !skip.includes(t)).map((t) => {
        const m = t.match(/data-tour="([^"]+)"\]( \[data-tab="([^"]+)"\])?/);
        return m[3] ? null : <div key={t} data-tour={m[1]}>{m[1]}{t.includes('digest-drilldown') && <button data-tab="accounts">Accounts</button>}</div>;
      })}
      <DailyDigestTour />
    </div>
  );
}

describe('DailyDigestTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('is a plain-language walk through the whole page: period first, export last, nothing technical', () => {
    const titles = DIGEST_STEPS.map((s) => s.title);
    expect(titles[0]).toBe('Choose the period');
    expect(titles).toEqual(expect.arrayContaining(['Funnel', 'Drill-down: who the work goes to', 'Accounts and Calls', 'Download it']));
    expect(titles[titles.length - 1]).toBe('Download it');
    for (const s of DIGEST_STEPS) expect(`${s.title} ${s.body}`).not.toMatch(/\b(api|endpoint|json|sql|query|payload|data-tour|jwt)\b/i);
    expect(DIGEST_STEPS.every((s) => s.body.length > 40 && s.body.length < 330)).toBe(true);
  });

  it('shows on the first visit and walks every step, Back included, then marks itself seen', async () => {
    render(<Page />);
    expect(await screen.findByText('Choose the period')).toBeInTheDocument();
    expect(screen.getByText(`1 of ${DIGEST_STEPS.length}`)).toBeInTheDocument();
    expect(screen.queryByText('Back')).toBeNull();
    fireEvent.click(screen.getByText('Next'));
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    expect(await screen.findByText('Choose the period')).toBeInTheDocument();
    for (let i = 1; i < DIGEST_STEPS.length; i++) {
      fireEvent.click(screen.getByText('Next'));
      await screen.findByText(`${i + 1} of ${DIGEST_STEPS.length}`);
    }
    expect(screen.getByText('Download it')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem(DIGEST_TOUR_KEY)).toBe('1');
  });

  it('does not show again once seen', () => {
    window.localStorage.setItem(DIGEST_TOUR_KEY, '1');
    render(<Page />);
    expect(screen.queryByRole('dialog', { name: /team digest guided tour/i })).toBeNull();
  });

  it('a page that is still loading gets the tour once it appears - and is not marked seen while nothing was shown', async () => {
    render(<Page late />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(DIGEST_TOUR_KEY)).toBeNull();
    expect(await screen.findByText('Choose the period', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('a person without export access (no Export button) never sees the Download step', async () => {
    render(<Page skip={['[data-tour="digest-export"]']} />);
    await screen.findByText('Choose the period');
    for (let i = 0; i < DIGEST_STEPS.length; i++) {
      if (screen.queryByText('Got it')) break;
      fireEvent.click(screen.getByText('Next'));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    }
    expect(screen.queryByText('Download it')).toBeNull();
  }, 20000);

  it('Escape closes it and counts as seen', async () => {
    render(<Page />);
    await screen.findByText('Choose the period');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.localStorage.getItem(DIGEST_TOUR_KEY)).toBe('1');
  });
});
