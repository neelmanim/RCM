import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:cadence-builder-v13-tour-seen';

const STEPS = [
  {
    target: '[data-tour="add-task-step"]',
    title: 'New: manual steps inside the cadence',
    body: 'A Task step gives the rep a research, LinkedIn or other hand-done task. The cadence waits for them, and the outcome they pick (e.g. "Accepted") can send the lead down a different path.',
  },
  {
    target: '[data-tour="add-condition-step"]',
    title: 'Branch on a lead field',
    body: 'A Condition can now check the lead itself — e.g. title contains "marketing" → the Marketing email, otherwise the Ops one.',
  },
  {
    target: '[data-tour="cadence-rules"]',
    title: 'Cadence rules',
    body: 'Stop when the lead replies or books a meeting, cap how long the cadence runs, add a re-engagement follow-up, and send as the lead\'s own rep.',
  },
  {
    target: '[data-tour="add-instantly-sequence-step"]',
    title: 'New: send through Instantly.ai',
    body: 'An Instantly Sequence step hands the lead off to a live Instantly campaign, sending through your pooled, pre-warmed domains instead of a personal mailbox. Alternate CRM still writes the content and resumes the cadence automatically on reply, interest, or completion — results show up right here in Reporting, same as any other step.',
  },
];

/** Shared components/ui/GuidedTour.jsx pattern (AGENT_PROTOCOL §13 rule 5)
 *  for the v13.0.0 builder additions. Mounted only for people who can edit. */
export function CadenceBuilderTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Cadence builder guided tour" />;
}
