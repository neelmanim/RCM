import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:analytics-hub-tour-seen';

const STEPS = [
  {
    target: '[data-tour="analytics-filters"]',
    title: 'Choose what to look at',
    body: 'Nothing loads until you apply filters: pick a pod, a date range and, if you like, a batch or a rep, then press Apply Filters. The charts and tables below follow what you pick.',
  },
  {
    target: '[data-tour="lead-activity-card"]',
    title: 'Lead Activity',
    body: 'After you apply filters, scroll down to this card: for every lead in your filters, who it is assigned to, who called and what happened. It is collapsed until you open it.',
  },
  {
    target: '[data-tour="lead-activity-toggle"]',
    title: 'Open it',
    body: 'Press Show to expand the table.',
  },
];

/** Starts on arrival (the filters are always there); the Lead Activity steps appear once filters are applied and are skipped until then. */
export function AnalyticsHubTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Analytics Hub guided tour" />;
}
