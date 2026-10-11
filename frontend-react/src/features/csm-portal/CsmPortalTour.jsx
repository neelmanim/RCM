import React from 'react';
import { GuidedTour } from '../../components/ui/GuidedTour';

const SEEN_KEY = 'alternate:csm-portal-tour-seen';

const HEADER_STEP = {
  target: '[data-tour="csm-portal-header"]',
  title: 'Inbox, Portfolio, Playbooks, Digest',
  body: 'Four views on the same accounts — what needs attention now, the full list, what you can act on today, and the weekly summary. Each is its own item in your left nav.',
};

const ADMIN_TABS_STEP = {
  target: '[data-tour="csm-portal-tabs"]',
  title: 'Browsing as an admin',
  body: 'These four switch between sections without leaving the page — a CSM sees the same four as separate items in their own left nav instead.',
};

const SECTION_STEP = {
  inbox: {
    target: '[data-tour="csm-portal-time-saved"]',
    title: 'Worst-health accounts first',
    body: "Inbox sorts by computed health score, worst first, plus this week's estimated time saved from playbooks.",
  },
  portfolio: {
    target: '[data-tour="csm-portal-portfolio-table"]',
    title: 'Your full portfolio',
    body: 'Every account you own (or, for admins, the whole org) with its renewal and health tier. Click a row to open its Account 360.',
  },
  playbooks: {
    target: '[data-tour="csm-portal-playbooks"]',
    title: 'Playbooks',
    body: 'Zero-form handover, renewal countdown, silent account, and champion departure — click any account to act on it.',
  },
  digest: {
    target: '[data-tour="csm-portal-digest"]',
    title: 'Your weekly roll-up',
    body: 'Total accounts, Critical/At Risk counts, playbooks run this week, and the same estimated time-saved figure as Inbox — useful for a quick self-check or a manager conversation.',
  },
};

/**
 * Same shared components/ui/GuidedTour.jsx pattern as every other tour.
 *
 * 2026-09-16: split section-aware after the nav restructuring. A CSM's own
 * flat nav items (Inbox/Portfolio/Playbooks/Digest) are 4 separate page
 * mounts now, not one continuously-tabbed page — a single tour walking
 * through all 4 content steps used to work because switching tabs never
 * unmounted GuidedTour, so it could resume mid-tour. Across 4 separate
 * mounts, `hasSeen` would flip true after whichever page loaded first, and
 * the other 3 pages would never show their own step at all. `section`
 * gives each flat page its own short, always-complete 2-step tour (header +
 * that one section) and its own seenKey, so every page gets a real
 * walkthrough the first time it's visited. Omitted for the Super-Admin-only
 * merged Pipeline hub (PipelineHub.jsx's CSM Portal tab), which keeps the
 * original single continuous 6-step tour since admin browsing there really
 * is one page with an internal tab strip.
 */
export function CsmPortalTour({ section }) {
  const steps = section
    ? [HEADER_STEP, SECTION_STEP[section]].filter(Boolean)
    : [HEADER_STEP, ADMIN_TABS_STEP, ...Object.values(SECTION_STEP)];
  const seenKey = section ? `alternate:csm-portal-${section}-tour-seen` : SEEN_KEY;
  return <GuidedTour steps={steps} seenKey={seenKey} ariaLabel="CSM Portal guided tour" />;
}
