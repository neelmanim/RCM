// One place that turns a task's raw fields into what a rep reads: its type,
// its cadence, and when it's due. Shared by My Tasks, the lead page's Tasks
// card and the bell, so the three never disagree again (they used to: one
// said "Overdue 6 Oct, 16:59", another showed nothing, the bell "4h ago").

const APPROVAL_KINDS = ['email_approval', 'sms_approval'];
export const isApproval = (t) => APPROVAL_KINDS.includes(t?.kind);
export const isDone = (t) => t?.done === true || t?.done === 'true';
/** Tell the bell (and through it the sidebar badge) to refetch now. */
export const tasksChanged = () => window.dispatchEvent(new CustomEvent('alternate:tasks-changed'));

/** Badge label + variant for a task's type. */
export function taskKind(t) {
  if (t.kind === 'email_approval') return { label: 'Email approval', variant: 'indigo' };
  if (t.kind === 'sms_approval') return { label: 'SMS approval', variant: 'teal' };
  if (t.from_cadence || t.journey_enrollment_id) return { label: 'Cadence step', variant: 'purple' };
  return null;
}

/** "[Demo — Alternate CRM Cadence] Review & send email: Asha" → title + cadence,
 *  so the cadence name can sit quietly in the meta line instead of the title. */
export function splitTitle(title = '') {
  const m = /^\[(.+?)\]\s*(.*)$/.exec(title);
  return m ? { cadence: m[1], title: m[2] } : { cadence: null, title };
}

const HOUR = 3600e3;
const GRACE = 15 * 60e3;

function span(ms) {
  const mins = Math.round(ms / 60e3);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const hours = Math.round(ms / HOUR);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const timeOf = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** When it's due, in words, with a tone: danger only when it's genuinely
 *  late — a task the cadence just created is due at the step's deadline
 *  (backend v13.7.0), so it reads "Due in 24h", never "Overdue". */
export function describeDue(t, now = new Date()) {
  if (isDone(t)) return null;
  if (!t.due_time) {
    if (t.due_date) return { text: `Due ${t.due_date}`, tone: 'muted' };
    return t.from_cadence || t.journey_enrollment_id ? { text: 'No deadline', tone: 'muted' } : null;
  }
  const d = new Date(t.due_time);
  const ms = d - now;
  // Just came due (a call reminder is due the moment it's made): "now",
  // not "Overdue by 1m".
  if (Math.abs(ms) < GRACE) return { text: 'Due now', tone: 'warning' };
  if (ms < 0) return { text: `Overdue by ${span(-ms)}`, tone: 'danger' };
  if (ms < 2 * HOUR) return { text: `Due in ${span(ms)}`, tone: 'warning' };
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / (24 * HOUR));
  if (days === 0) return { text: `Due today, ${timeOf(d)}`, tone: 'muted' };
  if (days === 1) return { text: `Due tomorrow, ${timeOf(d)}`, tone: 'muted' };
  return { text: `Due ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeOf(d)}`, tone: 'muted' };
}

/** Which To-do group a task belongs to. */
export function dueGroup(t, now = new Date()) {
  if (t.snoozed_until && new Date(t.snoozed_until) > now) return 'snoozed';
  if (!t.due_time) return 'none';
  const d = new Date(t.due_time);
  if (d < now - GRACE) return 'overdue';
  return new Date(d).setHours(0, 0, 0, 0) === new Date(now).setHours(0, 0, 0, 0) ? 'today' : 'upcoming';
}
