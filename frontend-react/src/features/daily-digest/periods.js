// The periods a Team Digest can show. Everything is in UTC "yesterday" terms (the server refuses today and the future).
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; };
const utcDay = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const PERIODS = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last_week', label: 'Last week (Mon–Sun)' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'this_month', label: 'This month so far' },
  { key: 'last_month', label: 'Last month' },
  { key: 'custom', label: 'Custom range…' },
];

/** -> { from, to, params } for a period key; params is what the API takes (`date` for one day, `from`/`to` otherwise).
 *  `custom` is { from, to } as 'yyyy-mm-dd'. Returns null when the period has no complete day yet (this month on the 1st) or a
 *  custom range is unfinished. */
export function resolvePeriod(key, custom = {}, now = new Date()) {
  const today = utcDay(now);
  const y = addDays(today, -1);
  const range = (from, to) => (from > to ? null : { from: iso(from), to: iso(to), params: iso(from) === iso(to) ? { date: iso(from) } : { from: iso(from), to: iso(to) } });
  switch (key) {
    case 'yesterday': return range(y, y);
    case 'last7': return range(addDays(y, -6), y);
    case 'last30': return range(addDays(y, -29), y);
    case 'last_week': {
      const monday = addDays(today, -((today.getUTCDay() + 6) % 7));
      return range(addDays(monday, -7), addDays(monday, -1));
    }
    case 'this_month': return range(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), y);
    case 'last_month': return range(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)), new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)));
    case 'custom': return custom.from && custom.to ? range(new Date(`${custom.from}T00:00:00Z`), new Date(`${custom.to}T00:00:00Z`)) : null;
    default: return null;
  }
}

export const periodLabel = (from, to) => {
  const fmt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
};

export const MAX_RANGE_DAYS = 92;
/** The latest day a digest can show (UTC yesterday) as a local Date, for the calendar's "no future days". */
export const lastPickableDay = (now = new Date()) => { const y = addDays(utcDay(now), -1); return new Date(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()); };
/** Why a complete custom range cannot be shown, or '' when it can. */
export function customProblem({ from, to }, now = new Date()) {
  if (!from || !to) return '';
  if (from > to) return 'The start date is after the end date.';
  if (to > iso(addDays(utcDay(now), -1))) return 'Only past days can be shown — the digest covers whole days up to yesterday.';
  if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 + 1 > MAX_RANGE_DAYS) return `Pick at most ${MAX_RANGE_DAYS} days.`;
  return '';
}
