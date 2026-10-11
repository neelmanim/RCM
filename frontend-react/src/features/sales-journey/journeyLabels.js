// Shared by the admin builder (FailedEnrollmentsPanel) and the Lead Detail
// Hub's cadence card; mirrors frontend/js/views/lead_detail.js's labels.
/** Badge variant per enrollment status (cadence roster + the lead's cadence card). */
export const JOURNEY_STATUS_VARIANT = { active: 'primary', completed: 'success', failed: 'danger', exited_early: 'default', paused: 'warning' };

export const JOURNEY_STATUS_LABEL = {
  active: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
  paused: 'Paused',
  exited_early: 'Exited',
};

export const JOURNEY_REASON_LABEL = {
  suppressed: 'Contact suppressed (opted out / disqualified)',
  journey_archived: 'Cadence archived',
  exceeded_max_node_passes: 'Exceeded max steps — likely a loop',
  send_failed: 'Send failed',
  manually_skipped: 'Manually skipped',
  manually_removed: 'Manually removed from the cadence',
  unexpected_error: 'Unexpected error',
  cooldown_stalled: 'Blocked by another cadence for too long',
  node_not_found: 'Internal error — step no longer exists',
  unknown_node_type: 'Internal error — unsupported step type',
  // v13.0.0 cadence rules
  replied: 'The lead replied — cadence stopped',
  meeting_booked: 'A meeting was booked — cadence stopped',
  max_duration: "Reached the cadence's time limit",
};

export const JOURNEY_PENDING_LABEL = {
  waiting: 'Waiting for its scheduled time',
  cooldown_blocked: 'Briefly paused — another cadence recently contacted this lead',
  domain_cadence_blocked: "Briefly paused — sending domain's rate limit",
  retry_pending: 'A previous send failed — retrying automatically',
  awaiting_rep: 'Waiting for the rep to complete a manual step',
  awaiting_email_approval: 'Waiting for approval — email draft is in My Tasks',
  awaiting_sms_approval: 'Waiting for approval — SMS draft is in My Tasks',
  awaiting_reply: 'Waiting to see if the lead replies',
  processing: 'Being processed right now',
  unknown: 'Status unclear — check back shortly',
};
