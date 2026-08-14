// Node type registry — mirrors the exact set journey_engine.engine dispatches
// on (backend/journey_engine/engine.py::execute_step). Keep these two lists
// in sync: adding a node type here without backend support would let a user
// build a graph the engine can't execute.
export const NODE_TYPES = ['trigger', 'email', 'wait', 'condition', 'call', 'sms', 'whatsapp'];

export const NODE_LABELS = {
  trigger: 'Trigger',
  email: 'Email',
  wait: 'Wait',
  condition: 'Condition',
  call: 'Call',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
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
    case 'sms':
      return { message: '' };
    case 'whatsapp':
      return { template_name: '' };
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
export const EMAIL_MERGE_FIELDS = [
  'first_name', 'last_name', 'company', 'title', 'email', 'phone',
];

// Matches backend/journey_engine/channels/sms_channel.py::SMS_MAX_LENGTH.
export const SMS_MAX_LENGTH = 1600;
// Standard GSM-7 segment size — shown as a friendly "N segments" estimate,
// not enforced (real segment count depends on the recipient's encoding).
export const SMS_SEGMENT_LENGTH = 160;
