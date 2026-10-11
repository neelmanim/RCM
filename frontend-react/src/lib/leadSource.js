// Single source of truth for turning a lead's raw lead_source column value
// into a human display label.
//
// This was previously reimplemented independently in leads-hub/columns.jsx,
// lead-detail-hub/LeadHeader.jsx, and power-dialer-hub/CurrentCallCard.jsx.
// The lead-detail-hub copy never learned the "upload:"/"gsheet:" prefixes
// (bulk-import sources) and defaulted every unrecognized value to "Manual"
// — so the same lead showed its real source (e.g. an uploaded list's name)
// in the leads table but "Manual" on its own detail page.
//
// Bulk imports store lead_source as "upload:<batch name>:<ISO timestamp>"
// (or "gsheet:...") — show just the batch name, not the internal
// prefix/timestamp.
export function formatLeadSource(source) {
  if (!source) return '—';
  const m = source.match(/^(?:upload|gsheet):(.+):\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/);
  if (m) return m[1];
  if (source.startsWith('klenty_sync')) return 'Klenty';
  if (source.startsWith('aircall_webhook') || source.startsWith('aircall_sync')) return 'Aircall';
  if (source === 'Manual Dial') return 'Manual Dial';
  // Legacy pre-enhancement tags (predate the upload:/gsheet: prefixed format above).
  if (source === 'uploaded') return 'Uploaded';
  if (source === 'manual') return 'Manual';
  if (source === 'salesforce') return 'Salesforce';
  return source;
}
