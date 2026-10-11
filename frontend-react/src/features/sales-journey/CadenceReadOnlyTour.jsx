import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

// v2 key: the v1 tour told reps they couldn't create, edit, or delete a
// cadence — wrong since v13.1.1 — so reps who dismissed it see the fix.
const SEEN_KEY = 'alternate:cadence-rep-tour-seen-v2';

const STEPS = [
  {
    target: '[data-tour="cadence-list-header"]',
    title: 'Build your own cadences',
    body: 'Create a cadence for your own leads with New Cadence. You can edit, publish, pause, or delete the cadences you own. Cadences owned by someone else open read-only, so you can see exactly how they work.',
  },
  {
    target: '[data-tour="cadence-readonly-banner"]',
    title: "Want to change someone else's cadence?",
    body: 'Ask its owner, or duplicate it to get your own editable copy.',
  },
];

/** Mounted for non-admin roles only (SalesJourneyHub). */
export function CadenceReadOnlyTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Cadence guided tour" />;
}
