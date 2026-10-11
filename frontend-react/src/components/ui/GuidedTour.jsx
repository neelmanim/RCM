import React, { useState, useLayoutEffect, useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { hasSeen, markSeen } from '../../utils/seenFlag';

/**
 * Homegrown, dependency-free guided tour: highlight a real `data-tour` target on the page, show a small card near it,
 * Back / Next / Skip. Shown once per browser via seenFlag (AGENT_PROTOCOL.md §13 rule 5), and replayable any time:
 *   - the "Guide" button in the top bar sends `alternate:start-tour` (the tour on the page starts again);
 *   - the Help Hub's "Guided tours" list stores `alternate:tour-pending` and opens the page, whose tour then starts.
 *
 * It WAITS for the page: most targets only exist once data has loaded, so the first target is looked for for up to
 * WAIT_FIRST_MS and later ones briefly. A tour that could not show anything is NOT marked seen (it used to be, which
 * silently killed the tour for good whenever the page was still loading). A step may carry `click: '<selector>'`, a tab or button
 * to press first so the step's target is on screen (e.g. open the "Team & Access" tab before pointing at the Data Export column).
 * Steps whose target never appears are skipped.
 */
export const START_TOUR_EVENT = 'alternate:start-tour';
export const TOURS_CHANGED_EVENT = 'alternate:tours-changed';
export const PENDING_TOUR_KEY = 'alternate:tour-pending';
const WAIT_FIRST_MS = 12000;     // the page has none of the targets yet: it is still loading
const WAIT_CLICK_MS = 10000;      // after pressing a tab / button for a step
const WAIT_SKIP_MS = 4000;       // the page is there but this step's target is not: skip it (data may still be arriving)
const WAIT_NEXT_MS = 4000;
const TOP_BAR = 72;              // the fixed top bar: a target tucked under it is not visible
const CARD_W = 320;
const CARD_H = 170;

// Only one guide is on screen at a time (a page can have two: e.g. Sales Tools and the cadence guide). The second waits its turn.
let activeTour = null;
const find = (selector) => { try { return document.querySelector(selector); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function register(seenKey, ariaLabel, on) {
  try {
    const all = (window.__CRM_TOURS__ = window.__CRM_TOURS__ || {});
    if (on) all[seenKey] = ariaLabel; else delete all[seenKey];
    window.dispatchEvent(new CustomEvent(TOURS_CHANGED_EVENT));
  } catch { /* no window: nothing to tell */ }
}

export function GuidedTour({ steps, seenKey, ariaLabel }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [moving, setMoving] = useState(false);   // a Next / Back is still looking for its target: buttons wait, so a quick second press cannot cancel it
  const [rect, setRect] = useState(null);
  const run = useRef(0);               // a newer run (Back / Next / replay) cancels the one still waiting for its target
  const shownAt = useRef(0);           // when the current step went up: a page that is still settling gets the step re-centred for a few seconds
  const shown = useRef(false);         // did this run ever put a step on screen?
  const card = useRef(null);
  const [cardH, setCardH] = useState(CARD_H);   // the card's real height (long text makes it taller than the guess)
  const stepsRef = useRef(steps);       // some pages build their step list on every render; callbacks below stay stable by reading the latest
  stepsRef.current = steps;

  const place = useCallback((el) => {
    const r = el.getBoundingClientRect();
    // Targets below the fold would otherwise leave the ring and card off-screen (a dark scrim with nothing to point at, which
    // looks like the page hung). Scroll only when the target is not already fully visible, and measure on the next frame.
    if ((r.top >= TOP_BAR && r.bottom <= window.innerHeight) || !el.scrollIntoView || (r.width === 0 && r.height === 0)) { setRect(r); return; }   // (no layout to scroll against: nothing to do)
    // A target taller than most of the screen (a whole table card) is shown from its top, clear of the top bar; the card then sits
    // over the rest of it. Anything smaller is centred.
    const tall = r.height > window.innerHeight * 0.7;
    if (tall) el.style.scrollMarginTop = '84px';
    el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'instant' });
    requestAnimationFrame(() => setRect(el.getBoundingClientRect()));
  }, []);

  // Show the first available step at or after `from` (or at or before it, going `dir` = -1). Looks right away; if the target is
  // not there yet, keeps looking while the page loads. Returns true if something was shown.
  const go = useCallback(async (from, dir = 1) => {
    const steps = stepsRef.current;
    const mine = ++run.current;
    // First look: if the page shows none of this tour's targets yet it is still loading - wait for it (up to WAIT_FIRST_MS).
    if (!shown.current) {
      for (let queued = 0; activeTour && activeTour !== seenKey && queued < 300000; queued += 300) {
        await sleep(300);
        if (run.current !== mine) return null;
      }
      activeTour = seenKey;   // claimed in the same breath as the check above, so two guides cannot both start
      for (let waited = 0; !steps.some((s) => find(s.target)) && waited < WAIT_FIRST_MS; waited += 200) {
        await sleep(200);
        if (run.current !== mine) return null;
      }
    }
    let missed = false;   // after one step has been waited for in vain, the ones behind it get only a quick look (the page had its chance)
    for (let i = from; i >= 0 && i < steps.length; i += dir) {
      const step = steps[i];
      // Press the step's tab / button only if its target is not already on screen (pressing the tab that is already open reloads it).
      let pressed = false;
      if (!find(step.target)) for (const sel of [].concat(step.click || [])) { const btn = find(sel); pressed = !!btn; if (btn) { btn.click(); await sleep(150); } }   // `pressed`: the LAST one (the tab that holds the target) exists
      if (run.current !== mine) return null;
      // A step that opens something first gets time to appear; a plain step whose target is missing is skipped quickly.
      const limit = pressed ? WAIT_CLICK_MS : missed ? 400 : shown.current ? WAIT_NEXT_MS : WAIT_SKIP_MS;
      let el = find(step.target);
      for (let waited = 0; !el && waited < limit; waited += 200) {
        await sleep(200);
        if (run.current !== mine) return null;
        el = find(step.target);
      }
      if (run.current !== mine) return null;
      if (el) { shown.current = true; shownAt.current = Date.now(); setStepIndex(i); place(el); return true; }
      missed = true;
    }
    return false;
  }, [place, seenKey]);

  const release = useCallback(() => { if (activeTour === seenKey) activeTour = null; }, [seenKey]);

  const finish = useCallback(() => { run.current += 1; release(); setActive(false); setRect(null); markSeen(seenKey); }, [seenKey, release]);

  // Next / Back / arrow keys. Returns when the new step is on screen (or none was found, which ends the tour on the way forward).
  const move = useCallback((to, dir = 1) => {
    setMoving(true);
    return go(to, dir).then((ok) => { if (ok === false && dir === 1) finish(); }).finally(() => setMoving(false));
  }, [go, finish]);

  const begin = useCallback(() => {
    shown.current = false;
    setStepIndex(0);
    setRect(null);
    setActive(true);
    go(0).then((ok) => {
      // Nothing to point at (page did not load, or this role has none of the targets): stop quietly and DON'T mark it seen.
      // (null = a newer run took over, which is not a failure.)
      if (ok === false) { release(); setActive(false); setRect(null); }
    });
  }, [go, release]);

  // First visit, or opened from the Help Hub.
  useLayoutEffect(() => {
    let pending = false;
    try { pending = window.sessionStorage.getItem(PENDING_TOUR_KEY) === seenKey; if (pending) window.sessionStorage.removeItem(PENDING_TOUR_KEY); } catch { /* storage blocked */ }
    if (pending || !hasSeen(seenKey)) begin();
    return () => { run.current += 1; release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenKey]);

  // Replay on request, and tell the top bar a tour exists on this page.
  useEffect(() => {
    const onStart = (e) => { if (!e.detail?.seenKey || e.detail.seenKey === seenKey) begin(); };
    window.addEventListener(START_TOUR_EVENT, onStart);
    register(seenKey, ariaLabel, true);
    return () => { window.removeEventListener(START_TOUR_EVENT, onStart); register(seenKey, ariaLabel, false); };
  }, [seenKey, ariaLabel, begin]);

  // Keep the ring on its target when the page moves under it (data arrives, window resizes, user scrolls).
  useEffect(() => {
    if (!active || !rect) return undefined;
    const measure = () => {
      const target = find(stepsRef.current[stepIndex]?.target);
      if (!target) return;
      const r = target.getBoundingClientRect();
      // Still settling (a loading skeleton collapsed, data arrived) and the target slid off screen: bring it back, but only in the first
      // few seconds so a person who scrolls to read is never pulled back.
      if (Date.now() - shownAt.current < 4000 && (r.top < TOP_BAR || r.bottom > window.innerHeight) && r.height <= window.innerHeight * 0.7) { place(target); return; }
      setRect((old) => (old && old.top === r.top && old.left === r.left && old.width === r.width && old.height === r.height ? old : r));
    };
    const id = setInterval(measure, 400);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearInterval(id); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [active, stepIndex, !!rect]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => { const h = card.current?.offsetHeight; if (h && Math.abs(h - cardH) > 1) setCardH(h); });

  useEffect(() => { if (active && rect) card.current?.querySelector('[data-tour-next]')?.focus?.({ preventScroll: true }); }, [active, stepIndex, !!rect]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      if (moving) return;
      if (e.key === 'ArrowRight') move(stepIndex + 1);
      if (e.key === 'ArrowLeft' && stepIndex > 0) move(stepIndex - 1, -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stepIndex, finish, move, moving]);

  if (!active || !rect) return null;

  const step = steps[stepIndex];
  const isLast = stepIndex >= steps.length - 1;
  const next = () => { if (isLast) finish(); else move(stepIndex + 1); };
  const back = () => move(stepIndex - 1, -1);

  // Card goes below the target, flips above if there is no room, and sits at the bottom edge if there is room nowhere (tall targets).
  const width = Math.min(CARD_W, window.innerWidth - 24);
  const below = rect.bottom + 12;
  const above = rect.top - 12 - cardH;
  const top = below + cardH <= window.innerHeight ? below : above >= 12 ? above : Math.max(12, window.innerHeight - cardH - 12);
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left));

  return (
    <div className="fixed inset-0 z-[10002]" role="dialog" aria-label={ariaLabel}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={finish} />
      <div
        className="absolute rounded-lg ring-2 ring-blue-500 ring-offset-2 pointer-events-none transition-all duration-200"
        style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <div ref={card} className="absolute bg-white rounded-xl shadow-xl p-4 flex flex-col gap-2 transition-all duration-200" style={{ top, left, width }}>
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-800 m-0">{step.title}</h4>
          <button onClick={finish} aria-label="Close tour" className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-slate-600 m-0">{step.body}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-slate-400">{stepIndex + 1} of {steps.length}</span>
          <div className="flex gap-2">
            {stepIndex > 0 && <Button variant="ghost" size="sm" onClick={back} disabled={moving}>Back</Button>}
            {!isLast && <Button variant="ghost" size="sm" onClick={finish}>Skip tour</Button>}
            <Button variant="primary" size="sm" onClick={next} disabled={moving} data-tour-next>{isLast ? 'Got it' : 'Next'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
