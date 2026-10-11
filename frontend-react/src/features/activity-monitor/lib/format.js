export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// Email bodies come through as raw HTML (Nylas). Extracting via DOMParser
// textContent is safe (no script execution, unlike dangerouslySetInnerHTML)
// and avoids the raw markup showing up verbatim in the expand-row preview.
export function stripHtml(html) {
  if (!html) return '';
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  return text.replace(/\s+/g, ' ').trim();
}

export function fmtDuration(secs) {
  if (secs == null || secs === '') return '—';
  const s = parseInt(secs, 10);
  if (isNaN(s) || s < 0) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}
