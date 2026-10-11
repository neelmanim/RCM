import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReleaseNotesSection } from '../../features/help-hub/ReleaseNotesSection';

const ungrouped = [
  { version: 'v10.6.38', date: '04 Aug 2026', tags: [{ label: '✨ REDESIGN', variant: 'indigo' }], title: null, items: ['**Thing one** happened'] },
];

// Synthetic — no real release has used `family`/`kind` yet (go-forward-only
// convention, see AGENT_PROTOCOL.md). This is the contract future entries
// must follow, verified here since nothing in releases.json exercises it.
const grouped = [
  { version: 'v10.7.0', date: '10 Aug 2026', family: '10.7', kind: 'major', tags: [], title: 'Big feature', items: ['**Full detail** for the major release'] },
  { version: 'v10.7.1', date: '11 Aug 2026', family: '10.7', kind: 'minor', tags: [], summary: 'Small follow-up fix' },
  { version: 'v10.7.2', date: '12 Aug 2026', family: '10.7', kind: 'minor', tags: [], summary: 'Another small fix' },
];

describe('ReleaseNotesSection', () => {
  it('renders ungrouped (family-less) entries as full cards, unchanged from before', () => {
    render(<ReleaseNotesSection releases={ungrouped} />);
    expect(screen.getByText('v10.6.38')).toBeInTheDocument();
    expect(screen.getByText('Thing one')).toBeInTheDocument();
    expect(screen.getByText('REDESIGN')).toBeInTheDocument(); // emoji stripped
    expect(screen.queryByText('✨ REDESIGN')).not.toBeInTheDocument();
  });

  it('strips a leading emoji from inside a bolded item, same as tag labels', () => {
    render(<ReleaseNotesSection releases={[
      { version: 'v10.9.0', date: '10 Aug 2026', tags: [], title: null,
        items: ['**🛡️ Safety rails** keep things honest'] },
    ]} />);
    expect(screen.getByText('Safety rails')).toBeInTheDocument();
    expect(screen.queryByText(/🛡️/)).not.toBeInTheDocument();
  });

  it('groups consecutive same-family entries under one version header, major full + minor one-liners', () => {
    render(<ReleaseNotesSection releases={grouped} />);
    expect(screen.getByText('v10.7')).toBeInTheDocument(); // family header
    expect(screen.getByText('Big feature')).toBeInTheDocument(); // major entry's title, full detail
    expect(screen.getByText('Small follow-up fix')).toBeInTheDocument(); // minor one-liner
    expect(screen.getByText('Another small fix')).toBeInTheDocument();
  });

  it('renders a summary-only entry as a one-liner regardless of its `kind` label, not just kind==="minor" (RCA 2026-08-19: v11.5.1 shipped with kind:"patch" + summary/no-items, which the old kind==="minor" check missed, falling through to FullEntry and crashing on entry.items.map)', () => {
    render(<ReleaseNotesSection releases={[
      { version: 'v11.5.1', date: '19 Aug 2026', family: '11.5', kind: 'patch', tags: [{ label: '🐛 FIX', variant: 'danger' }], summary: 'Some patch summary' },
    ]} />);
    expect(screen.getByText('Some patch summary')).toBeInTheDocument();
  });

  it('renders a family-less, summary-only entry as a one-liner instead of crashing the whole Help Hub (RCA 2026-09-28 live: v12.7.11 shipped with no `family` and only `summary`/no `items` — the ungrouped branch called FullEntry unconditionally, threw on entry.items.map(undefined), and blanked the entire page for every user, not just that one entry)', () => {
    render(<ReleaseNotesSection releases={[
      { version: 'v12.7.11', date: '28 Sep 2026', kind: 'patch', tags: [{ label: '🐛 FIX', variant: 'danger' }], summary: 'A family-less patch summary' },
    ]} />);
    expect(screen.getByText('A family-less patch summary')).toBeInTheDocument();
  });
});
