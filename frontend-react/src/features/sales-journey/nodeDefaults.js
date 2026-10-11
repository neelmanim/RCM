// Node type registry — mirrors the exact set journey_engine.engine dispatches
// on (backend/journey_engine/engine.py::execute_step). Keep these two lists
// in sync: adding a node type here without backend support would let a user
// build a graph the engine can't execute.
export const NODE_TYPES = ['trigger', 'email', 'wait', 'condition', 'call', 'task', 'sms', 'whatsapp', 'instantly_sequence'];

export const NODE_LABELS = {
  trigger: 'Trigger',
  email: 'Email',
  wait: 'Wait',
  condition: 'Condition',
  call: 'Call',
  task: 'Task',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  instantly_sequence: 'Instantly Sequence',
};

// A journey can have at most one trigger — everything else can repeat.
export const SINGLETON_NODE_TYPES = ['trigger'];

// The exact event-type strings the engine actually dispatches condition-node
// branches on (backend/routes/webhook_routes.py, models.py's log_status_change
// funnel, dialer_provider.py's call events). This was previously a free-text
// input with zero hint of the valid set — a typo created a branch that could
// silently never fire, with no validation catching it.
export const CONDITION_EVENT_TYPES = [
  { value: 'email_replied', label: 'Email replied' },
  { value: 'email_auto_replied', label: 'Auto-reply received (out-of-office)' },
  { value: 'sms_replied', label: 'SMS replied' },
  { value: 'whatsapp_replied', label: 'WhatsApp replied' },
  { value: 'status_changed', label: 'Lead status changed' },
  { value: 'CALL_ANSWERED', label: 'Call answered' },
  { value: 'CALL_ENDED', label: 'Call ended' },
];

// A trigger node's entry-event options — a separate, smaller set from
// CONDITION_EVENT_TYPES above: only events the engine can use to *start* a
// cadence (backend/journey_engine/engine.py::check_entry_triggers), not every
// event a mid-cadence condition branch can react to.
export const ENTRY_TRIGGER_EVENT_TYPES = [
  { value: 'status_changed', label: 'Lead status changes to…' },
  { value: 'email_received', label: 'SDR/AE receives an email from the lead' },
  // Never matches an engine event, so leads only enter when enrolled by hand.
  { value: 'manual', label: 'Only when enrolled manually (no automatic start)' },
];

// Manual step kinds — mirrors backend journey_engine/channels/task_channel.py
// TASK_KIND_LABELS. LinkedIn is manual on purpose: LinkedIn doesn't allow
// automated sending without a third-party vendor, so the step hands the rep
// the pre-written message and asks what happened.
export const TASK_KINDS = [
  { value: 'research', label: 'Research' },
  { value: 'linkedin_connect', label: 'LinkedIn connection request' },
  { value: 'linkedin_message', label: 'LinkedIn message' },
  { value: 'custom', label: 'Other manual task' },
];

// Outcomes a new LinkedIn connection step offers, so "message only if
// accepted" works out of the box. Editable per step.
export const LINKEDIN_CONNECT_OUTCOMES = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'not_accepted', label: 'Not accepted' },
];

// A condition node can branch on a lead field instead of waiting for an
// event — mirrors journey_engine/engine.py FIELD_RULE_FIELDS / FIELD_RULE_OPS.
export const FIELD_RULE_FIELDS = [
  { value: 'title', label: 'Job title' },
  { value: 'company', label: 'Company' },
  { value: 'industry', label: 'Industry' },
  { value: 'lead_source', label: 'Lead source' },
  { value: 'status', label: 'Status' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];
export const FIELD_RULE_OPS = [
  { value: 'contains_any', label: 'contains any of', needsValue: true },
  { value: 'equals', label: 'is exactly', needsValue: true },
  { value: 'exists', label: 'is filled in', needsValue: false },
  { value: 'not_exists', label: 'is empty', needsValue: false },
];

export function defaultDataFor(type) {
  switch (type) {
    case 'trigger':
      return { event: 'status_changed', to_status: 'New' };
    case 'email':
      return { subject: '', body: '' };
    case 'wait':
      return { duration_hours: 24 };
    case 'condition':
      return { timeout_hours: 48, branch_on_timeout: null, branch_on_event: {} };
    case 'call':
      return { title: '' };
    case 'task':
      return { task_kind: 'research', title: '', instructions: '', outcomes: [], branch_on_outcome: {}, due_within_hours: 24 };
    case 'sms':
      return { message: '' };
    case 'whatsapp':
      return { template_name: '' };
    case 'instantly_sequence':
      return { steps: [{ subject: '', body: '', delay_days: 0 }] };
    default:
      return {};
  }
}

let _nodeCounter = 0;
export function nextNodeId() {
  _nodeCounter += 1;
  return `n${Date.now()}_${_nodeCounter}`;
}

// Merge fields an Email node's subject/body actually support — substituted
// server-side (backend/journey_engine/channels/email_channel.py) before
// sending. Keep this list in sync with that function's field map. Previously
// the body's placeholder text ("Hi {{first_name}}, …") implied this worked
// with no substitution logic anywhere and no way to discover the field list.
// Re-exported, not redefined: Email Campaigns and saved templates need the
// same list (utils/mergeFields.js is now the one definition), and a second
// copy here is exactly how the campaign composer's field list drifted out of
// reach in the first place.
export { LEAD_MERGE_FIELDS as EMAIL_MERGE_FIELDS } from '../../utils/mergeFields';

// Matches backend/journey_engine/channels/sms_channel.py::SMS_MAX_LENGTH.
export const SMS_MAX_LENGTH = 1600;
// Standard GSM-7 segment size — shown as a friendly "N segments" estimate,
// not enforced (real segment count depends on the recipient's encoding).
export const SMS_SEGMENT_LENGTH = 160;
