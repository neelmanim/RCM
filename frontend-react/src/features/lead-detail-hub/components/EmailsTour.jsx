import React from 'react';
import { GuidedTour } from '../../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:lead-detail-emails-tour-seen';

const STEPS = [
  {
    target: '[data-tour="emails-stats"]',
    title: "This lead's email at a glance",
    body: 'Sent, Opened, Clicked and Replied across every email with this lead — yours, cadence steps and campaigns. Out-of-office auto-replies don\'t count as replies.',
  },
  {
    target: '[data-tour="emails-row"]',
    title: 'Click an email to open the conversation',
    body: 'The full thread opens right here — read it, reply, or start a new email without leaving the lead.',
  },
];

/** Shared components/ui/GuidedTour.jsx pattern (AGENT_PROTOCOL §13 rule 5).
 *  Rendered by EmailsPanel only once the lead has emails, so an empty card
 *  never spends the one-time tour. */
export function EmailsTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Lead emails guided tour" />;
}
