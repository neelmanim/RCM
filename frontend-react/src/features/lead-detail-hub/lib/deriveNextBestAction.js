/**
 * deriveNextBestAction.js
 *
 * Deterministic, priority-ordered ruleset — NOT a fake AI recommender. Mirrors
 * the intent of the legacy per-status banners (frontend/js/views/lead_detail.js)
 * rather than inventing new heuristics. Pure function: (lead, activities) ->
 * {label, reason, ctaLabel, ctaKind, secondary?: {label, ctaKind}}. `secondary`
 * covers cases where legacy shows two competing actions (e.g. Meeting Complete
 * vs. No Show) — NextBestAction renders it as a smaller second button. The
 * contract is network-agnostic so a future backend-computed recommendation
 * could replace this function's call site without changing NextBestAction.jsx's
 * props at all.
 */

const DISQUALIFIED_STATUSES = new Set(['Disqualified', 'Not Interested', 'Unreachable', 'Customer Declined']);
// Mirrors lead_detail.js's `isCompleted` exactly.
const COMPLETED_STATUS = 'Completed';

function firstName(lead) {
  return lead?.first_name || lead?.email?.split('@')[0] || 'this lead';
}

function hasAnsweredCall(activities) {
  return activities.some((a) => (
    a.kind === 'call' && a.raw?.outcome && a.raw.outcome !== 'No Answer' && a.raw.status !== 'CALL_FAILED'
  ));
}

export function deriveNextBestAction(lead, activities = []) {
  if (!lead) {
    return { label: 'Loading…', reason: '', ctaLabel: null, ctaKind: null };
  }

  if (lead.do_not_contact) {
    return { label: 'No action needed', reason: 'This lead has opted out of contact.', ctaLabel: null, ctaKind: null };
  }

  if (lead.opportunity_status === 'Won' || lead.opportunity_status === 'Lost') {
    return {
      label: lead.opportunity_status === 'Won' ? 'Deal won' : 'Deal lost',
      reason: 'This opportunity has already been closed.',
      ctaLabel: 'View opportunity',
      ctaKind: 'view-opportunity',
    };
  }

  if (DISQUALIFIED_STATUSES.has(lead.status)) {
    return { label: 'No further action', reason: `Lead is marked ${lead.status}.`, ctaLabel: null, ctaKind: null };
  }

  if (lead.status === COMPLETED_STATUS) {
    return { label: 'No further action needed', reason: 'This lead has completed the pipeline.', ctaLabel: null, ctaKind: null };
  }

  if (lead.status === 'Pending Review') {
    return {
      label: 'Awaiting Pod Admin decision',
      reason: 'Escalated after a failed demo — your Pod Admin will reschedule, rediscover, or disqualify.',
      ctaLabel: null,
      ctaKind: null,
    };
  }

  if (lead.status === 'No Phone - Parked') {
    return {
      label: 'Lead is parked',
      reason: 'No phone number on file yet.',
      ctaLabel: 'Update contact info',
      ctaKind: 'edit-contact',
    };
  }

  if (lead.max_attempts_reached) {
    return {
      label: 'Review for disqualification',
      // call_attempt_count is lifetime and all reps — say so, and don't claim "no success".
      reason: `${lead.call_attempt_count} call attempts logged on this lead (all reps); the limit is ${lead.max_call_attempts}.`,
      ctaLabel: 'Disqualify Lead',
      ctaKind: 'disqualify',
      secondary: { label: 'Call anyway', ctaKind: 'call' },
    };
  }

  // RCA 2026-09-03: these statuses only ever exist because a call outcome
  // already advanced the lead server-side (log_call()'s auto-promote) — the
  // status itself is stronger evidence of "a call happened" than scanning
  // the activity feed for one with a matching outcome. Checking
  // hasAnsweredCall() unconditionally meant any gap in that feed (a call
  // whose outcome never got attached — the same underlying issue tracked in
  // the dialer's self-heal fixes) left the lead stuck showing "Call Now —
  // no successful conversation yet" with no way to advance, even though the
  // backend had already moved it past Qualification.
  const PAST_QUALIFICATION = new Set(['Meeting Scheduled', 'Demo Scheduled', '1st Discovery Meeting', 'Discovery Complete']);
  if (!PAST_QUALIFICATION.has(lead.status) && !hasAnsweredCall(activities)) {
    return {
      label: `Call ${firstName(lead)}`,
      reason: 'No successful conversation yet.',
      ctaLabel: 'Call Now',
      ctaKind: 'call',
    };
  }

  if (lead.status === 'Meeting Scheduled') {
    return {
      label: 'Meeting happened?',
      reason: 'Confirm the meeting took place to advance to the Discovery stage.',
      ctaLabel: 'Mark Meeting Complete',
      ctaKind: 'meeting-complete',
      secondary: { label: 'Mark No Show', ctaKind: 'no-show' },
    };
  }

  if (lead.status === 'Demo Scheduled') {
    return {
      label: 'Demo outcome?',
      reason: 'Successful demos push to Salesforce; failed demos go to Pending Review.',
      ctaLabel: 'Demo Successful',
      ctaKind: 'demo-success',
      secondary: { label: 'Demo Failed / No Show', ctaKind: 'demo-failed' },
    };
  }

  if (lead.status === '1st Discovery Meeting') {
    return {
      label: 'Log the discovery call',
      reason: 'Add this discovery call, or mark discovery complete if you\'re done.',
      ctaLabel: 'Add Discovery Call',
      ctaKind: 'add-discovery',
      secondary: { label: 'Complete Discovery', ctaKind: 'complete-discovery' },
    };
  }

  if (lead.status === 'Discovery Complete') {
    return {
      label: 'Ready for demo',
      reason: 'Discovery is complete — schedule the demo when you\'re ready.',
      ctaLabel: 'Schedule Demo',
      ctaKind: 'schedule-demo',
    };
  }

  return {
    label: `Follow up with ${firstName(lead)}`,
    reason: 'Keep the conversation moving.',
    ctaLabel: 'Call Now',
    ctaKind: 'call',
  };
}
