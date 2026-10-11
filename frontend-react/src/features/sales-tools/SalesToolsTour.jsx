import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:sales-tools-tour-seen';

const STEPS = [
  {
    target: '[data-tour="sales-tools-section-tabs"]',
    title: 'Everything you send, in one place',
    body: 'Cadence is outreach in steps over several days. Email Campaigns sends one email to a list, and SMS Campaigns sends one text. If you can see Replies, it shows the answers to emails sent through Instantly.',
  },
  {
    target: '[data-tour="cadence-list-header"]',
    title: 'Your cadences',
    body: 'A cadence emails, calls and reminds for you, step by step. Start a new one here, or open one below to see who is in it and what has been sent.',
  },
  {
    click: '[data-tab="campaigns"]',
    target: '[data-tour="new-campaign-button"]',
    title: 'Start an email campaign',
    body: 'Pick the people (search, filter, or take everyone matching your search), write one email, then send now, schedule it, or repeat it.',
  },
  {
    target: '[data-tour="campaigns-subtabs"]',
    title: 'Track what happened',
    body: "The snapshot at the top shows what was sent, failed and skipped. Templates lets you save a message once and reuse it.",
  },
  {
    target: '[data-tour="campaigns-status-filter"]',
    title: 'Find a past campaign',
    body: 'Filter by status and page through your campaign history here.',
  },
];

/** Opens the Email Campaigns tab itself for the campaign steps (the `click` on step 3), so the guide is the same whichever tab is open. */
export function SalesToolsTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Sales Tools guided tour" />;
}
