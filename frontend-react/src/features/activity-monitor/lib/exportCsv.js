import { AuditService } from '../../../services/api';

/**
 * Client-side CSV blob export — matches every other export in this codebase
 * (call_monitor.js's own _exportCSV included), no backend export endpoint.
 */
// A text cell starting with = + - @ runs as a formula when opened in Excel/Sheets; subjects and
// names come from outside senders, so prefix those with a quote.
const csvSafe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function exportCsv({ rows, columns, filenamePrefix }) {
  // This CSV is built in the browser, so the server never sees the download - tell it, so it is in the audit trail.
  try { AuditService?.exportEvent?.(filenamePrefix, rows.length)?.catch?.(() => {}); } catch { /* the file still downloads */ }
  const lines = [columns.map((c) => c.label).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((c) => JSON.stringify(csvSafe(row[c.key] ?? ''))).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  // Some WebKit/Safari versions no-op .click() on a detached anchor —
  // append/remove + revoke matches activity_feed.js's export (the other
  // legacy predecessor already does this; call_monitor.js's didn't).
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return rows.length;
}
