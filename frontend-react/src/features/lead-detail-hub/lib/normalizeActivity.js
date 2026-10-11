/**
 * normalizeActivity.js
 *
 * Merges DialerCall/CallLog, Task, Note, LeadStatusLog, and LeadFieldHistory
 * rows into one activity model: {id, kind, ts, actor, summary, raw}. No
 * server-side merge exists for status/field history — this centralizes what
 * the legacy page does inline, in one place, so ActivityTimeline and
 * StatusHistory share exactly one merge implementation instead of two.
 */

const KNOWN_CALL_PROVIDERS = { aircall: 'Aircall', messenger: 'Alternate Messenger', klenty: 'Klenty' };

// Legacy lead_calls_tab.js only branches on 'aircall'/'messenger' and
// mislabels Klenty calls "Manual Log" as a result. This checks the full known
// provider set first so a Klenty-sourced call gets "Klenty" here, matching
// the (correct) lead-level source badge instead of repeating that bug in the
// new unified timeline. Legacy code itself is not touched.
export function providerLabel(call) {
  const key = (call?.provider || '').toLowerCase();
  return KNOWN_CALL_PROVIDERS[key] || 'Manual Log';
}

export function normalizeCalls(calls = []) {
  return calls.map((c) => ({
    id: `call-${c.id}`,
    kind: 'call',
    ts: c.called_at || c.created_at,
    actor: c.user_name || null,
    summary: c.outcome || (c.status === 'CALL_ENDED' ? 'Call ended' : 'Call'),
    providerLabel: providerLabel(c),
    raw: c,
  }));
}

export function normalizeTasks(tasks = []) {
  return tasks.map((t) => ({
    id: `task-${t.id}`,
    kind: 'task',
    ts: t.created_at,
    actor: null,
    summary: t.title,
    raw: t,
  }));
}

export function normalizeNotes(notes = []) {
  return notes.map((n) => ({
    id: `note-${n.id}`,
    kind: 'note',
    ts: n.created_at,
    actor: n.author,
    summary: n.content,
    raw: n,
  }));
}

export function normalizeStatusHistory(entries = []) {
  return entries.map((e) => ({
    id: `status-${e.id}`,
    kind: 'signal',
    subKind: 'status-change',
    ts: e.changed_at,
    actor: e.changed_by,
    summary: `${e.from_status || '—'} → ${e.to_status}`,
    raw: e,
  }));
}

// tags / assigned_to are written explicitly (association tables the field-diff listener can't see)
function fieldChangeSummary(e) {
  if (e.field_name === 'tags') {
    if (e.old_value == null) return `Tag added: ${e.new_value}`;
    if (e.new_value == null) return `Tag removed: ${e.old_value}`;
  }
  if (e.field_name === 'assigned_to') return `Owner: ${e.old_value ?? 'unassigned'} → ${e.new_value ?? 'unassigned'}`;
  return `${e.field_name}: ${e.old_value ?? '—'} → ${e.new_value ?? '—'}`;
}

export function normalizeFieldHistory(entries = []) {
  return entries.map((e) => ({
    id: `field-${e.id}`,
    kind: 'signal',
    subKind: 'field-change',
    ts: e.changed_at,
    actor: e.changed_by,
    summary: fieldChangeSummary(e),
    raw: e,
  }));
}

// Instantly.ai pull sync (informational-only signals — never a status
// change, see PATCH /leads/kanban/move for where the SDR actually moves a
// lead). Rows come from the same lead_email_activity list Nylas rows use
// (GET /email/lead/{id}/emails), discriminated by `provider: "instantly"`
// — `source` on this payload already means something else (cadence/
// campaign/manual send path, see EmailsPanel.jsx's SOURCE_LABEL), so the
// nylas/instantly discriminator is its own field. Branch on `provider` for
// the label/icon, don't build a parallel feed renderer.
function instantlyActivitySummary(e) {
  let label;
  if (e.direction === 'inbound' && !e.is_auto_reply) label = 'Instantly: replied';
  else if (e.clicked_at || e.click_count > 0) label = 'Instantly: clicked link';
  else if (e.opened_at || e.open_count > 0) label = 'Instantly: opened email';
  else label = e.direction === 'inbound' ? 'Instantly: received email' : 'Instantly: email sent';
  return e.subject ? `${label} — ${e.subject}` : label;     // subject only when there is one
}

export function normalizeEmailActivity(emails = []) {
  return emails.map((e) => ({
    id: `email-${e.id}`,
    kind: 'email',
    ts: e.timestamp,
    actor: e.direction === 'outbound' ? (e.user_name || null) : (e.from_email || null),
    summary: e.provider === 'instantly' ? instantlyActivitySummary(e) : (e.subject || '(no subject)'),
    raw: e,
  }));
}

export function mergeActivity({ calls = [], tasks = [], notes = [], statusHistory = [], fieldHistory = [], emails = [] } = {}) {
  return [
    ...normalizeCalls(calls),
    ...normalizeTasks(tasks),
    ...normalizeNotes(notes),
    ...normalizeStatusHistory(statusHistory),
    ...normalizeFieldHistory(fieldHistory),
    ...normalizeEmailActivity(emails),
  ].sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
}

export const ACTIVITY_FILTER_LABELS = {
  all: 'All',
  call: 'Calls',
  task: 'Tasks',
  note: 'Notes',
  signal: 'Signals',
  email: 'Emails',
};
