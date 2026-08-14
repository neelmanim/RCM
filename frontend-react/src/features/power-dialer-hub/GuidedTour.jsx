import React, { useState, useLayoutEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { hasSeen, markSeen } from '../../utils/seenFlag';

const SEEN_KEY = 'rcm:power-dialer-tour-seen';

const STEPS = [
  {
    target: '[data-tour="current-call"]',
    title: 'Your queue, one lead at a time',
    body: "This is the lead up next — sorted by priority automatically, so you don't have to decide who to call first.",
  },
  {
    target: '[data-tour="skip-reason"]',
    title: 'Skip is always one click',
    body: "Not ready to call this one? Skip moves on instantly. The little arrow next to it lets you note why, if you want to — totally optional.",
  },
  {
    target: '[data-tour="add-note"]',
    title: 'Jot a note without leaving the queue',
    body: "View the full lead in the CRM or add a quick note right here — you don't have to break your dialing flow to do either. Keyboard: N for a note, O to open in CRM.",
  },
  {
    target: '[data-tour="queue-list"]',
    title: 'Drag to reorder what\'s next',
    body: 'Want to batch a few leads at the same company, or push one down? Drag any row below your current lead to reorder it. Your place is saved — reloading the page won\'t lose your progress.',
  },
  {
    target: '[data-tour="email-column"]',
    title: "See who you've already emailed",
    body: 'Green means a synced mailbox already sent this lead an email — grey means you haven\'t reached out yet.',
  },
  {
    target: '[data-tour="today-stats"]',
    title: "Today's results, or any day's",
    body: 'This updates automatically as you log calls. Pick a different date to review a past day.',
  },
];

/**
 * A full nav-item replacement ("Today's Calls" -> Power Dialer) shipped with
 * zero in-app explanation beyond a release-note bullet — see the 2026-08-10
 * review. Homegrown rather than a new dependency (react-joyride etc.): one
 * feature doesn't warrant a new library, and this is genuinely simple —
 * highlight a `data-tour` target, show a card near it, Next/Skip.
 */
export function GuidedTour() {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    if (!hasSeen(SEEN_KEY)) setActive(true);
  }, []);

  const measure = useCallback((index) => {
    for (let i = index; i < STEPS.length; i++) {
      const el = document.querySelector(STEPS[i].target);
      if (el) {
        setStepIndex(i);
        setRect(el.getBoundingClientRect());
        return;
      }
    }
    // Nothing left to point at (e.g. an empty queue hid every target) — end quietly.
    setActive(false);
    markSeen(SEEN_KEY);
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    measure(0);
    const onResize = () => measure(stepIndex);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active || !rect) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex >= STEPS.length - 1;
  const finish = () => { setActive(false); markSeen(SEEN_KEY); };
  const next = () => (isLast ? finish() : measure(stepIndex + 1));

  // Card goes below the target by default, flips above if there's no room.
  const cardTop = rect.bottom + 12 + 140 > window.innerHeight ? rect.top - 12 - 140 : rect.bottom + 12;

  return (
    <div className="fixed inset-0 z-[999]" role="dialog" aria-label="Power Dialer guided tour">
      <div className="absolute inset-0 bg-slate-900/50" onClick={finish} />
      <div
        className="absolute rounded-lg ring-2 ring-blue-500 ring-offset-2 pointer-events-none transition-all duration-200"
        style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <div
        className="absolute w-72 bg-white rounded-xl shadow-xl p-4 flex flex-col gap-2 transition-all duration-200"
        style={{ top: Math.max(12, cardTop), left: Math.min(window.innerWidth - 300, Math.max(12, rect.left)) }}
      >
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-800 m-0">{step.title}</h4>
          <button onClick={finish} aria-label="Close tour" className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-slate-600 m-0">{step.body}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-slate-400">{stepIndex + 1} of {STEPS.length}</span>
          <div className="flex gap-2">
            {!isLast && <Button variant="ghost" size="sm" onClick={finish}>Skip tour</Button>}
            <Button variant="primary" size="sm" onClick={next}>{isLast ? 'Got it' : 'Next'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
