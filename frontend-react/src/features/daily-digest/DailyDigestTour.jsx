import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

export const DIGEST_TOUR_KEY = 'alternate:daily-digest-tour-seen-v2';

// Plain-language walk through Team Digest, top to bottom. A step whose target is not on the page for this person (no export access,
// nothing needing attention today) is skipped by the shared tour.
export const DIGEST_STEPS = [
  {
    target: '[data-tour="digest-date-picker"]',
    title: 'Choose the period',
    body: 'Pick yesterday, the last 7 days, last month or your own dates (past days only). Everything on this page follows it, including the Funnel and the Drill-down. Super Admins can also look at one pod.',
  },
  {
    target: '[data-tour="digest-notable-events"]',
    title: 'Needs attention',
    body: 'Only what someone can act on: reps with no activity and leads with an overdue follow-up. Click one to see who, or which leads.',
  },
  {
    target: '[data-tour="digest-kpi-grid"]',
    title: 'Your numbers',
    body: 'Calls, emails, meetings and more for the period, each compared with the period before (▲ up, ▼ down). Click a number to see the leads behind it.',
  },
  {
    target: '[data-tour="digest-views"]',
    title: 'Choose what you see',
    body: 'Customize numbers lets you pick which numbers show and in what order. Save the set as a view to get it back next time. Admins can also share a view with the whole team.',
  },
  {
    target: '[data-tour="digest-sdr-snapshot"]',
    title: 'Your team',
    body: 'One row per rep, including anyone with no activity. Click a rep to see only their leads further down.',
  },
  {
    target: '[data-tour="digest-campaigns"]',
    title: 'Campaigns',
    body: 'What was worked for each campaign tag. Click a campaign to see just its leads. "No campaign" means the lead has no tag yet.',
  },
  {
    target: '[data-tour="digest-funnel"]',
    title: 'Funnel',
    body: 'From accounts given, to conversations, to meetings booked, meetings in Salesforce and meetings held. Group it by rep or by campaign to see who, or what, converts best.',
  },
  {
    target: '[data-tour="digest-drilldown"]',
    title: 'Drill-down: who the work goes to',
    body: 'Break the period down by industry, country, city, job level, function, company size or where the leads came from. "ICP fit" shows how much of the work goes to your ideal customers. Grey rates rest on very few calls, so do not read much into them.',
  },
  {
    target: '[data-tour="digest-drilldown"] [data-tab="accounts"]',
    title: 'Accounts and Calls',
    body: 'Accounts lists each company you worked and where it stands; "Spoke, no meeting" is your follow-up list. Calls shows how calls ended and which hours connect best. Click any row to see the leads behind it.',
  },
  {
    target: '[data-tour="digest-lead-activity"]',
    title: 'Leads touched',
    body: 'Every lead worked in the period, overdue follow-ups first. Filter by rep, follow-up status or kind of activity, search by name or company, and click a lead to open it.',
  },
  {
    target: '[data-tour="digest-export"]',
    title: 'Download it',
    body: 'Export Excel gives you this page as one file (the Funnel and the Drill-down have their own Export buttons). A Super Admin switches downloads on per person, and every download is recorded.',
  },
];

export function DailyDigestTour() {
  return <GuidedTour steps={DIGEST_STEPS} seenKey={DIGEST_TOUR_KEY} ariaLabel="Team Digest guided tour" />;
}
