import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:csm-account-360-tour-seen';

// Split out from CsmPortalTour (2026-09-16): Account 360 is reached by
// drilling into an account from any of the 4 flat sections, not from its
// own nav item, so it needs its own seenKey independent of whichever
// section's tour a CSM has or hasn't seen yet.
const STEPS = [
  {
    target: '[data-tour="csm-portal-account-actions"]',
    title: 'Account 360 actions',
    body: 'From any account: log a touch, flag a champion departure, override the health tier, or create a renewal opportunity.',
  },
  {
    target: '[data-tour="csm-portal-call-log"]',
    title: 'Log a call',
    body: "You've got no Lead to call against here — this ties a call outcome directly to one of the account's Opportunities instead, same as an AE logs a call on their own deals.",
  },
];

export function AccountDetailTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Account 360 guided tour" />;
}
