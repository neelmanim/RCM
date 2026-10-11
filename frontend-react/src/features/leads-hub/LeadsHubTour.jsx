import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:leads-hub-tour-seen-v2';

const STEPS = [
  {
    target: '[data-tour="company-group"]',
    title: 'Leads are grouped by company',
    body: "Contacts at the same company sit together under one heading — even while sorted by priority, your default view. Leads with no company on file always group under ⚠️ No Company at the very bottom, never mixed in up top.",
  },
  {
    target: '[data-tour="bulk-select"]',
    title: 'Select multiple leads at once',
    body: 'Turn this on to check off leads, then add them to a Call List, enroll them in a Cadence, or send them a one-off Email Campaign (Sales Tools) — all from the action bar that appears once you have a selection.',
  },
  {
    target: '[data-tour="saved-views"]',
    title: 'Save a filter as a view',
    body: "Set up filters the way you like them, then save the view as a named tab you can jump straight back to next time.",
  },
  {
    target: '[data-tour="columns-menu"]',
    title: 'Customize your columns',
    body: 'Reorder, resize, or hide columns. Your layout is remembered next time you come back.',
  },
  {
    target: '[data-tour="switch-classic"]',
    title: "Prefer the old table? It's still here",
    body: "This link always takes you back to the classic leads table, if you ever want it. Both show the exact same leads.",
  },
];

/**
 * RCA 2026-08-21: the React leads list shipped with a written help-hub
 * section only. SDRs didn't read it and avoided the whole feature over a
 * change (company grouping) that was actually already there. A short,
 * in-context tour reaches people a doc page doesn't (see AGENT_PROTOCOL.md
 * §13 rule 5). Shares components/ui/GuidedTour.jsx with the Power Dialer's
 * tour — same pattern, own steps, own seen-flag, mounts independently.
 */
export function LeadsHubTour() {
  return <GuidedTour steps={STEPS} seenKey={SEEN_KEY} ariaLabel="Leads guided tour" />;
}
