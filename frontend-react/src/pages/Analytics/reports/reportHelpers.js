/**
 * reportHelpers.js — shared display/formatting logic for the Automated
 * Reports UI (My Reports list, Report Builder, Logs). Kept out of the
 * components themselves so the same "how do we describe this schedule"
 * logic can't drift between the list and the builder's live summary.
 */

// A curated set, not every IANA zone — covers where this org's stakeholders
// actually are. Intl.supportedValuesOf('timeZone') would give an exhaustive
// list but a multi-hundred-entry <select> is worse UX for this org's size.
export const TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
];

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const DATE_RANGE_LABELS = {
  previous_1_day: 'Previous 1 day',
  previous_7_days: 'Previous 7 days',
  previous_calendar_month: 'Previous calendar month',
  custom: 'Custom range',
};

export const STATUS_BADGE_VARIANT = {
  sent: 'success',
  failed: 'danger',
  skipped: 'warning',
  processing: 'default',
};

export function fmtSchedule(report) {
  const time = `${String(report.send_hour).padStart(2, '0')}:${String(report.send_minute).padStart(2, '0')}`;
  const tzAbbrev = report.timezone === 'UTC' ? 'UTC' : report.timezone.split('/').pop().replace('_', ' ');
  if (report.frequency === 'daily') return `Daily · ${time} ${tzAbbrev}`;
  if (report.frequency === 'weekly') return `Every ${WEEKDAYS[report.weekday] || 'Monday'} · ${time} ${tzAbbrev}`;
  if (report.frequency === 'monthly') return `Monthly (day ${report.day_of_month}) · ${time} ${tzAbbrev}`;
  return time;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
