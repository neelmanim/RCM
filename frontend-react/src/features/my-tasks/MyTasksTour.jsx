import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:my-tasks-tour-seen';

const STEPS = [
  {
    target: '[data-tour="task-list"]',
    title: 'Everything waiting on you',
    body: "Tasks you added on a lead, plus cadence steps assigned to you — grouped by when they're due.",
  },
  {
    target: '[data-tour="task-status-filter"]',
    title: 'Approvals, To do, Done',
    body: "Approvals are cadence emails and texts waiting for you to review and send — the cadence is paused until you do.",
  },
  {
    target: '[data-tour="task-row"]',
    title: 'Work a task right here',
    body: 'Send a draft, pick an outcome or tick a task done. The ⋯ menu snoozes it, opens the lead, or skips a cadence step.',
  },
];

/** Same shared components/ui/GuidedTour.jsx pattern as every other tour —
 *  see AEPipelineTour.jsx's own comment for why this isn't hand-rolled. */
export function MyTasksTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="My Tasks guided tour" />;
}
