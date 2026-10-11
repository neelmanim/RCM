/** Shared date formatters — was copy-pasted with minor variations across
 * LeadSummary/ActivityItem/NotesPanel/StatusHistory; one source of truth. */
export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}
