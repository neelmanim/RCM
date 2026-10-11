import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:ae-pipeline-tour-seen';

const STEPS = [
  {
    // Only present for the Super-Admin-only merged Pipeline hub
    // (PipelineHub.jsx) — skips quietly on AE's own standalone view, which
    // has no tab switcher to explain.
    target: '[data-tour="pipeline-hub-tabs"]',
    title: 'AE Pipeline & CSM Portal',
    body: 'Switch between the AE Pipeline table and every CSM\'s account portfolio without leaving this page.',
  },
  {
    target: '[data-tour="ae-pipeline-table"]',
    title: 'Your open deals',
    body: 'Every Opportunity you own — synced in from Salesforce — with account, amount, stage and close date. Click a row to open it.',
  },
  {
    target: '[data-tour="ae-pipeline-log-call"]',
    title: 'Log a call',
    body: 'Record an outcome and notes against this deal — separate from Lead call logging, so it works even on Opportunities with no Lead behind them.',
  },
  {
    target: '[data-tour="ae-pipeline-close-deal"]',
    title: 'Close the deal',
    body: "Mark it Won or Lost. Winning it asks for a quick handover brief — champion, promises made, notes — that carries straight to the CSM, no separate form for them to fill in.",
  },
];

/** Same shared components/ui/GuidedTour.jsx pattern as every other tour —
 *  copied from LeaderboardTour.jsx's shape (see that file's own comment). */
export function AEPipelineTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="AE Pipeline guided tour" />;
}
