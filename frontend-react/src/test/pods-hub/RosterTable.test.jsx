import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RosterTable } from '../../features/pods-hub/components/RosterTable';

const roster = [
  { podId: 'p1', podName: 'Alpha', userId: 'u1', name: 'Amy', email: 'amy@x.com', role: 'SDR', activeLeads: 5, stale24h: 1, stale72h: 0 },
  { podId: 'p1', podName: 'Alpha', userId: 'u2', name: 'Ben', email: 'ben@x.com', role: 'SDR', activeLeads: 3, stale24h: 2, stale72h: 4 },
  { podId: 'p2', podName: 'Beta', userId: 'u3', name: 'Cy', email: 'cy@x.com', role: 'AE', activeLeads: 8, stale24h: 0, stale72h: 1 },
];

function rowOrder() {
  return screen.getAllByText(/^(Amy|Ben|Cy)$/).map((el) => el.textContent);
}

describe('RosterTable', () => {
  it('defaults to sorting by stale72h descending — the most-neglected rep first', () => {
    render(<RosterTable roster={roster} onOpenRep={() => {}} />);
    expect(rowOrder()).toEqual(['Ben', 'Cy', 'Amy']);
  });

  it('re-sorts by a clicked column and flips direction on a second click', () => {
    render(<RosterTable roster={roster} onOpenRep={() => {}} />);
    fireEvent.click(screen.getByText('Active leads'));
    expect(rowOrder()).toEqual(['Cy', 'Amy', 'Ben']); // desc: 8, 5, 3
    fireEvent.click(screen.getByText('Active leads'));
    expect(rowOrder()).toEqual(['Ben', 'Amy', 'Cy']); // asc: 3, 5, 8
  });

  it('hands off the clicked rep to the parent for the Leads Hub drilldown', () => {
    const onOpenRep = vi.fn();
    render(<RosterTable roster={roster} onOpenRep={onOpenRep} />);
    fireEvent.click(screen.getByText('Ben'));
    expect(onOpenRep).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', name: 'Ben' }));
  });

  it('shows an empty state instead of a headerless table when no one is assigned', () => {
    render(<RosterTable roster={[]} onOpenRep={() => {}} />);
    expect(screen.getByText(/No SDRs or AEs assigned/)).toBeInTheDocument();
  });

  it('filters by rep name, email, or pod as the user types', () => {
    render(<RosterTable roster={roster} onOpenRep={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search rep/), { target: { value: 'beta' } });
    expect(rowOrder()).toEqual(['Cy']);
  });

  it('shows a no-match message instead of an empty table when the search excludes everyone', () => {
    render(<RosterTable roster={roster} onOpenRep={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search rep/), { target: { value: 'zzz' } });
    expect(screen.getByText(/No reps match/)).toBeInTheDocument();
  });

  it('paginates at 20 rows and Prev/Next page through the rest', () => {
    const bigRoster = Array.from({ length: 25 }, (_, i) => ({
      podId: 'p1', podName: 'Alpha', userId: `u${i}`, name: `Rep${String(i).padStart(2, '0')}`,
      email: `rep${i}@x.com`, role: 'SDR', activeLeads: i, stale24h: 0, stale72h: 0,
    }));
    render(<RosterTable roster={bigRoster} onOpenRep={() => {}} />);
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.queryByText('Rep24')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Rep24')).toBeInTheDocument();
  });
});
