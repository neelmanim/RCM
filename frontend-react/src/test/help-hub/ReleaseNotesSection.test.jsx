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
});
