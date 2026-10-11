import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:leaderboard-tour-seen';

const STEPS = [
  {
    target: '[data-tour="leaderboard-podium"]',
    title: 'Top three at a glance',
    body: 'The three people with the most meetings booked for the period, with their calls and conversion rate. Your own card is outlined and badged.',
  },
  {
    target: '[data-tour="leaderboard-range"]',
    title: 'Pick a period',
    body: 'Last 7, 30 or 90 days, or all time. Everything on the page — podium, table and ranking — follows this.',
  },
  {
    target: '[data-tour="leaderboard-tabs"]',
    title: 'SDRs and AEs',
    body: 'Two separate boards, ranked on their own. Only admins see both.',
  },
  {
    target: '[data-tour="leaderboard-scope"]',
    title: 'Your pod, or everyone',
    body: "As a Pod Admin you see your own pod by default. Switch to Global to rank against the whole org — the choice sticks for the rest of your session.",
  },
  {
    target: '[data-tour="leaderboard-table"]',
    title: 'The full picture',
    body: 'Every metric per person. Click a name to open their performance dashboard.',
  },
];

/** Same shared components/ui/GuidedTour.jsx pattern as every other tour —
 *  steps whose targets aren't on the page (the admin-only tabs, the Pod Admin
 *  scope toggle) are skipped by GuidedTour itself. */
export function LeaderboardTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Leaderboard guided tour" />;
}
