import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AircallEverywhereDrawer } from '../../features/aircall-everywhere/AircallEverywhereDrawer';
import { OPT_OUT_KEY } from '../../features/aircall-everywhere/useAircallEverywhere';

const TOUR_SEEN_KEY = 'rcm:aircall-drawer-tour-seen';
const BODY_OPEN_CLASS = 'aircall-drawer-open';

describe('AircallEverywhereDrawer', () => {
  beforeEach(() => {
    localStorage.removeItem(OPT_OUT_KEY);
    localStorage.removeItem(TOUR_SEEN_KEY);
    document.body.classList.remove(BODY_OPEN_CLASS);
  });

  it('renders nothing when ineligible', () => {
    const { container } = render(<AircallEverywhereDrawer status="ineligible" callActive={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the opt-back-in link when opted out, not the pill or drawer', () => {
    render(<AircallEverywhereDrawer status="opted_out" callActive={false} />);
    expect(screen.getByText('Using Aircall Desktop app')).toBeInTheDocument();
    expect(document.getElementById('nh-aircall-drawer-btn')).not.toBeInTheDocument();
  });

  it('shows "Log in to Aircall", forces the drawer open when notready, but the SDR can dismiss and reopen it', () => {
    render(<AircallEverywhereDrawer status="notready" callActive={false} />);
    expect(screen.getByText('Log in to Aircall')).toBeInTheDocument();
    expect(document.querySelector('.nh-aircall-drawer')).toHaveClass('nh-aircall-drawer--open');
    expect(document.querySelector('.nh-aircall-drawer__header button')).toBeInTheDocument(); // close (X) available even pre-login

    fireEvent.click(document.getElementById('nh-aircall-drawer-btn'));
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open');
    fireEvent.click(document.getElementById('nh-aircall-drawer-btn'));
    expect(document.querySelector('.nh-aircall-drawer')).toHaveClass('nh-aircall-drawer--open');
  });

  it('closes via the header X while notready, and via Escape', () => {
    render(<AircallEverywhereDrawer status="notready" callActive={false} />);
    fireEvent.click(document.querySelector('.nh-aircall-drawer__header button'));
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open');

    fireEvent.click(document.getElementById('nh-aircall-drawer-btn')); // reopen
    expect(document.querySelector('.nh-aircall-drawer')).toHaveClass('nh-aircall-drawer--open');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open');
  });

  it('re-nudges (forces open again) on a fresh disconnect, even after the SDR dismissed the previous prompt', () => {
    const { rerender } = render(<AircallEverywhereDrawer status="notready" callActive={false} />);
    fireEvent.click(document.getElementById('nh-aircall-drawer-btn')); // dismiss the nudge
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open');

    rerender(<AircallEverywhereDrawer status="ready" callActive={false} />); // logs in
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open'); // stays closed

    rerender(<AircallEverywhereDrawer status="notready" callActive={false} />); // disconnects again
    expect(document.querySelector('.nh-aircall-drawer')).toHaveClass('nh-aircall-drawer--open'); // re-nudged
  });

  it('shows "Aircall connected" and closes the drawer by default once ready', () => {
    render(<AircallEverywhereDrawer status="ready" callActive={false} />);
    expect(screen.getByText('Aircall connected')).toBeInTheDocument();
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open');
  });

  it('lets the SDR toggle the drawer open/closed once ready', () => {
    render(<AircallEverywhereDrawer status="ready" callActive={false} />);
    const btn = document.getElementById('nh-aircall-drawer-btn');
    fireEvent.click(btn);
    expect(document.querySelector('.nh-aircall-drawer')).toHaveClass('nh-aircall-drawer--open');
    fireEvent.click(btn);
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open');
  });

  it('closes on an outside click once ready, but a stray click elsewhere must not dismiss the pre-login nudge', () => {
    render(<AircallEverywhereDrawer status="ready" callActive={false} />);
    fireEvent.click(document.getElementById('nh-aircall-drawer-btn')); // open it
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open');

    cleanup();
    render(<AircallEverywhereDrawer status="notready" callActive={false} />);
    fireEvent.mouseDown(document.body); // accidental click elsewhere on the page
    expect(document.querySelector('.nh-aircall-drawer')).toHaveClass('nh-aircall-drawer--open'); // still forced open
  });

  it('forces the drawer open during an active call, even after a manual close', () => {
    const { rerender } = render(<AircallEverywhereDrawer status="ready" callActive={false} />);
    fireEvent.click(document.getElementById('nh-aircall-drawer-btn')); // open it
    fireEvent.click(document.getElementById('nh-aircall-drawer-btn')); // close it again

    rerender(<AircallEverywhereDrawer status="ready" callActive={true} />);
    expect(screen.getByText('On a call')).toBeInTheDocument();
    expect(document.querySelector('.nh-aircall-drawer')).toHaveClass('nh-aircall-drawer--open');
    // Close button and opt-out link must not exist mid-call — no way out but hanging up.
    expect(document.querySelector('.nh-aircall-drawer__header button')).not.toBeInTheDocument();
    expect(screen.queryByText('Prefer your Aircall Desktop app instead?')).not.toBeInTheDocument();
  });

  it('always renders the mount div, regardless of open state (never conditionally unmounted)', () => {
    render(<AircallEverywhereDrawer status="ready" callActive={false} />);
    // Closed by default at 'ready', but the mount div must still exist in the DOM.
    expect(document.getElementById('aircall-everywhere-mount')).toBeInTheDocument();
  });

  it('does not show the callout while the drawer is forced open (idle or notready), only once it collapses at ready', () => {
    const { rerender } = render(<AircallEverywhereDrawer status="idle" callActive={false} />);
    expect(screen.queryByText('Got it')).not.toBeInTheDocument();

    rerender(<AircallEverywhereDrawer status="notready" callActive={false} />);
    expect(screen.queryByText('Got it')).not.toBeInTheDocument(); // still open — nothing to point at yet

    rerender(<AircallEverywhereDrawer status="ready" callActive={false} />);
    expect(document.querySelector('.nh-aircall-drawer')).not.toHaveClass('nh-aircall-drawer--open');
    expect(screen.getByText('Got it')).toBeInTheDocument(); // now collapsed to just the pill — this is what it explains
  });

  it('does not show the callout again once already dismissed', () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    render(<AircallEverywhereDrawer status="ready" callActive={false} />);
    expect(screen.queryByText('Got it')).not.toBeInTheDocument();
  });

  it('dismissing the callout via "Got it" hides it and marks it seen for next time', () => {
    render(<AircallEverywhereDrawer status="ready" callActive={false} />);
    fireEvent.click(screen.getByText('Got it'));
    expect(screen.queryByText('Got it')).not.toBeInTheDocument();
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
  });

  it('clicking the trigger pill also dismisses an open callout', () => {
    render(<AircallEverywhereDrawer status="ready" callActive={false} />);
    expect(screen.getByText('Got it')).toBeInTheDocument();
    fireEvent.click(document.getElementById('nh-aircall-drawer-btn'));
    expect(screen.queryByText('Got it')).not.toBeInTheDocument();
  });

  it('adds aircall-drawer-open to <body> while open, and removes it once closed', () => {
    const { rerender, unmount } = render(<AircallEverywhereDrawer status="notready" callActive={false} />);
    expect(document.body.classList.contains(BODY_OPEN_CLASS)).toBe(true); // forced open pre-login
    rerender(<AircallEverywhereDrawer status="ready" callActive={false} />);
    expect(document.body.classList.contains(BODY_OPEN_CLASS)).toBe(false); // closed by default once ready
    unmount();
    expect(document.body.classList.contains(BODY_OPEN_CLASS)).toBe(false);
  });

  it('never adds aircall-drawer-open for ineligible or opted_out — no drawer renders, so nothing should push .view-container', () => {
    const { rerender } = render(<AircallEverywhereDrawer status="ineligible" callActive={false} />);
    expect(document.body.classList.contains(BODY_OPEN_CLASS)).toBe(false);

    rerender(<AircallEverywhereDrawer status="opted_out" callActive={false} />);
    expect(document.body.classList.contains(BODY_OPEN_CLASS)).toBe(false);
    expect(document.getElementById('aircall-everywhere-mount')).not.toBeInTheDocument();
  });
});
