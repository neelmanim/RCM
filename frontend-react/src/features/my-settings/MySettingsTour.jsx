import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:my-settings-tour-seen';

const STEPS = [
  {
    target: '[data-tour="my-settings-email"]',
    title: 'Connect your mailbox',
    body: 'Send lead email from your own address and have replies logged against the lead automatically.',
  },
  {
    target: '[data-tour="my-settings-dialer"]',
    title: 'Your dialer and caller ID',
    body: 'Shows whether calling is enabled for you and which number you call from. Your caller ID is assigned by an admin — you can switch calling off yourself, but only an admin can switch it back on.',
  },
  {
    // Signature and branding are one card now, so one step instead of two
    // consecutive steps pointing at halves of the same thing.
    target: '[data-tour="my-settings-signature"]',
    title: 'Your email sign-off',
    body: 'Your signature is appended to every email you send — bold, italics, links, and images, including an uploaded company logo. The toggle underneath hides the small “Powered by Alternate Messenger” line below it.',
  },
];

/** Same shared components/ui/GuidedTour.jsx pattern as every other tour. */
export function MySettingsTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="My Settings guided tour" />;
}
