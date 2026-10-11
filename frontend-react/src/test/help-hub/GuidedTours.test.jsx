import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuidedToursSection } from '../../features/help-hub/GuidedToursSection';
import { TOURS, toursFor } from '../../features/help-hub/data/tours';
import { GuidedTour, PENDING_TOUR_KEY, START_TOUR_EVENT, TOURS_CHANGED_EVENT } from '../../components/ui/GuidedTour';

const sources = import.meta.glob('../../**/*Tour.jsx', { query: '?raw', import: 'default', eager: true });
const NAV = import.meta.glob('../../layout/NavSidebar.jsx', { query: '?raw', import: 'default', eager: true });
const navText = Object.values(NAV)[0];

describe('the list of guided tours', () => {
  it('every entry points at a real page and a real tour key', () => {
    const all = Object.values(sources).join('\n');
    for (const t of TOURS) {
      expect(navText).toContain(`id: '${t.view}'`);                                   // the page exists in the navigation
      const key = t.seenKey.replace(/^alternatecrm:/, '');
      const csm = key.startsWith('csm-portal-') && key.endsWith('-tour-seen');
      expect(csm ? all.includes('csm-portal-${section}-tour-seen') : all.includes(t.seenKey)).toBe(true);   // that tour file really uses this key
    }
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    expect(new Set(TOURS.map((t) => t.seenKey)).size).toBe(TOURS.length);
  });

  it('each person is offered only the guides for pages they have', () => {
    const titles = (role) => toursFor(role).map((t) => t.title);
    expect(titles('SDR')).toEqual(expect.arrayContaining(['Dashboard', 'My Tasks', 'Leads']));
    expect(titles('SDR')).not.toEqual(expect.arrayContaining(['Team Digest']));
    expect(titles('SDR')).not.toEqual(expect.arrayContaining(['Control Center']));
    expect(titles('Pod Admin')).toEqual(expect.arrayContaining(['Team Digest', 'Control Center']));
    expect(titles('Pod Admin')).not.toContain('AE Pipeline');   // a Pod Admin has no AE Pipeline page
    expect(titles('Super Admin')).toEqual(expect.arrayContaining(['Team Digest', 'Control Center']));
    expect(titles('AE')).toContain('AE Pipeline');
    expect(titles('CSM')).toEqual(expect.arrayContaining(['CSM Inbox', 'CSM Portfolio', 'CSM Playbooks', 'CSM Digest', 'My Tasks', 'My Settings']));
    expect(titles('CSM')).not.toEqual(expect.arrayContaining(['Dashboard', 'Leads', 'Team Digest']));
  });

  it('Start opens the page and asks its guide to start', async () => {
    window._loadView = vi.fn();
    window.sessionStorage.clear();
    render(<GuidedToursSection role="Super Admin" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start the Team Digest tour' }));
    expect(window._loadView).toHaveBeenCalledWith('digest');
    expect(window.sessionStorage.getItem(PENDING_TOUR_KEY)).toBe('alternate:daily-digest-tour-seen-v2');
  });
});

const STEPS = [{ target: '[data-tour="a"]', title: 'First', body: 'One' }, { target: '[data-tour="b"]', title: 'Second', body: 'Two' }];
const Page = () => (<div><div data-tour="a">a</div><div data-tour="b">b</div><GuidedTour steps={STEPS} seenKey="alternate:t-seen" ariaLabel="T guide" /></div>);

describe('replaying a guide', () => {
  beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

  it('a guide that was already seen can be started again from the top bar, from step one', async () => {
    window.localStorage.setItem('alternate:t-seen', '1');
    render(<Page />);
    expect(screen.queryByRole('dialog')).toBeNull();
    window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
    expect(await screen.findByText('First')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    await screen.findByText('Second');
    window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
    expect(await screen.findByText('First')).toBeInTheDocument();
  });

  it('a start request for a different guide is ignored', async () => {
    window.localStorage.setItem('alternate:t-seen', '1');
    render(<Page />);
    window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: { seenKey: 'alternate:other' } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opened from the Help Hub: the pending request starts a seen guide once, then is used up', async () => {
    window.localStorage.setItem('alternate:t-seen', '1');
    window.sessionStorage.setItem(PENDING_TOUR_KEY, 'alternate:t-seen');
    const { unmount } = render(<Page />);
    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(PENDING_TOUR_KEY)).toBeNull();
    unmount();
    render(<Page />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('announces itself to the top bar while the page is open and withdraws when it closes', () => {
    window.localStorage.setItem('alternate:t-seen', '1');
    const heard = vi.fn();
    window.addEventListener(TOURS_CHANGED_EVENT, heard);
    const { unmount } = render(<Page />);
    expect(window.__CRM_TOURS__['alternate:t-seen']).toBe('T guide');
    unmount();
    expect(window.__CRM_TOURS__['alternate:t-seen']).toBeUndefined();
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(TOURS_CHANGED_EVENT, heard);
  });

  it('a page with none of the targets ends quietly and is NOT marked seen (so it tries again next visit)', async () => {
    vi.useFakeTimers();
    try {
      render(<div><GuidedTour steps={STEPS} seenKey="alternate:t-seen" ariaLabel="T guide" /></div>);
      await vi.advanceTimersByTimeAsync(13000);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(window.localStorage.getItem('alternate:t-seen')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('waits for a page that is still loading and then shows the guide', async () => {
    function Late() {
      const [on, setOn] = React.useState(false);
      React.useEffect(() => { const t = setTimeout(() => setOn(true), 1500); return () => clearTimeout(t); }, []);
      return <div>{on && <div data-tour="a">a</div>}<GuidedTour steps={STEPS} seenKey="alternate:t-seen" ariaLabel="T guide" /></div>;
    }
    render(<Late />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('First', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('Back, the arrow keys and Escape work', async () => {
    render(<Page />);
    await screen.findByText('First');
    await waitFor(() => expect(screen.getByRole('button', { name: /^(Next|Got it)$/ })).toBeEnabled());
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await screen.findByText('Second');
    await waitFor(() => expect(screen.getByRole('button', { name: /^(Next|Got it)$/ })).toBeEnabled());
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await screen.findByText('First');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.localStorage.getItem('alternate:t-seen')).toBe('1');
  });

  it('the card stays on screen: below the target when there is room, above when there is not', async () => {
    const orig = Element.prototype.getBoundingClientRect;
    const set = (top) => { Element.prototype.getBoundingClientRect = function () { return this.getAttribute?.('data-tour') === 'a' ? { top, bottom: top + 40, left: 20, right: 220, width: 200, height: 40 } : orig.call(this); }; };
    try {
      set(100);
      const { unmount } = render(<Page />);
      const card = (await screen.findByText('First')).closest('div[style*="width"]');
      expect(parseInt(card.style.top, 10)).toBeGreaterThan(100);
      unmount();
      window.localStorage.clear();
      set(window.innerHeight - 50);
      render(<Page />);
      const card2 = (await screen.findByText('First')).closest('div[style*="width"]');
      expect(parseInt(card2.style.top, 10)).toBeLessThan(window.innerHeight - 50);
      expect(parseInt(card2.style.top, 10)).toBeGreaterThanOrEqual(12);
    } finally { Element.prototype.getBoundingClientRect = orig; }
  });
});

describe('two guides on one page', () => {
  beforeEach(() => window.localStorage.clear());

  it('show one at a time: the second starts only after the first is closed', async () => {
    render(
      <div>
        <div data-tour="one">One</div>
        <div data-tour="two">Two</div>
        <GuidedTour seenKey="alternate:first-seen" ariaLabel="First guided tour" steps={[{ target: '[data-tour="one"]', title: 'First guide', body: 'a' }]} />
        <GuidedTour seenKey="alternate:second-seen" ariaLabel="Second guided tour" steps={[{ target: '[data-tour="two"]', title: 'Second guide', body: 'b' }]} />
      </div>
    );
    await screen.findByText('First guide');
    expect(screen.queryByText('Second guide')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(await screen.findByText('Second guide')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

