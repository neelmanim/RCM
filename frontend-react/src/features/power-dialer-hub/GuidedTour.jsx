import React from 'react';
import { GuidedTour as SharedGuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:power-dialer-tour-seen';

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
  return <SharedGuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Power Dialer guided tour" />;
}
