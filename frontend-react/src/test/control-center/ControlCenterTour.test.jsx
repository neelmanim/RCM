import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ControlCenterTour, CONTROL_CENTER_STEPS, CONTROL_CENTER_TOUR_KEY } from '../../features/control-center/ControlCenterTour';

// A stand-in Control Center with the same data-tab / data-tour attributes and the same behaviour that matters here: a screen's
// targets exist only while its tab is open, so the guide has to open the tab itself. `isSuper` hides Export History like the real page.
function Page({ isSuper = true }) {
  const [top, setTop] = React.useState('integrations');
  const [team, setTeam] = React.useState('users');
  const [integ, setInteg] = React.useState('connections');
  return (
    <div className="controlcenter">
      <div data-tour="cc-search">search</div>
      {['integrations', 'team-access', 'automation', 'data', 'monitoring'].map((t) => <button key={t} data-tab={t} onClick={() => setTop(t)}>{t}</button>)}
      {top === 'team-access' && (
        <div>
          <button data-tab="users" onClick={() => setTeam('users')}>Users</button>
          {isSuper && <button data-tab="exports" onClick={() => setTeam('exports')}>Export History</button>}
          {team === 'users' && <table><thead><tr><th data-tour="cc-data-export">Data Export</th></tr></thead></table>}
          {team === 'exports' && isSuper && <div data-tour="cc-export-history">history</div>}
        </div>
      )}
      {top === 'integrations' && (
        <div>
          <button data-tab="connections" onClick={() => setInteg('connections')}>Connections</button>
          <button data-tab="salesforce" onClick={() => setInteg('salesforce')}>Salesforce</button>
          {integ === 'salesforce' && (<><div data-tour="cc-sf-overview">overview</div><div data-tour="cc-sf-sync">sync</div><div data-tour="cc-sf-mapping">mapping</div></>)}
        </div>
      )}
      <ControlCenterTour />
    </div>
  );
}

const walk = async (n) => { for (let i = 1; i < n; i++) { fireEvent.click(screen.getByText('Next')); await waitFor(() => expect(screen.getByText(new RegExp(`^${i + 1} of `))).toBeInTheDocument(), { timeout: 5000 }); } };

describe('ControlCenterTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('covers what is new in plain words: who may download, Export History, Salesforce overview, syncing and field mapping', () => {
    const titles = CONTROL_CENTER_STEPS.map((s) => s.title);
    expect(titles).toEqual(expect.arrayContaining(['Who may download data', 'Export History', 'Salesforce at a glance', 'What syncs', 'Field mapping']));
    for (const s of CONTROL_CENTER_STEPS) {
      expect(`${s.title} ${s.body}`).not.toMatch(/\b(api|endpoint|json|sql|payload|jwt|rbac|crud)\b/i);
      expect(`${s.title} ${s.body}`).not.toMatch(/5 tabs replace|old Settings|Sync tab/);       // the stale wording of the first version
    }
  });

  it('shows on first visit, pointing at the Integrations tab first', async () => {
    render(<Page />);
    expect(await screen.findByText('Welcome to Control Center')).toBeInTheDocument();
    expect(screen.getByText(`1 of ${CONTROL_CENTER_STEPS.length}`)).toBeInTheDocument();
  });

  it('does not show again once seen', () => {
    window.localStorage.setItem(CONTROL_CENTER_TOUR_KEY, '1');
    render(<Page />);
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).toBeNull();
  });

  it('opens the right tab by itself for each screen and reaches the end', async () => {
    render(<Page />);
    await screen.findByText('Welcome to Control Center');
    await walk(CONTROL_CENTER_STEPS.length);
    expect(screen.getByText('Monitoring')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem(CONTROL_CENTER_TOUR_KEY)).toBe('1');
  }, 30000);

  it('stepping Back to an earlier screen opens that screen again', async () => {
    render(<Page />);
    await screen.findByText('Welcome to Control Center');
    await walk(6);                                                      // on "What syncs" (Integrations > Salesforce)
    expect(screen.getByText('What syncs')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    await screen.findByText(/^5 of /, {}, { timeout: 5000 });
    fireEvent.click(screen.getByText('Back'));
    await screen.findByText(/^4 of /, {}, { timeout: 5000 });
    expect(await screen.findByText('Export History', { selector: 'h4' }, { timeout: 5000 })).toBeInTheDocument();      // Team & Access > Export History reopened
  }, 30000);

  it('an Admin who cannot see Export History skips that step instead of getting stuck', async () => {
    render(<Page isSuper={false} />);
    await screen.findByText('Welcome to Control Center');
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(await screen.findByText('Next'));                   // Team & Access -> Who may download data
    await screen.findByText('Who may download data');
    fireEvent.click(screen.getByText('Next'));
    expect(await screen.findByText('Salesforce at a glance', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText('Export History', { selector: 'h4' })).toBeNull();
  }, 30000);
});
