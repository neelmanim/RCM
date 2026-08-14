// email body_preview is stored as rich HTML (see backend/email_utils.py) so
// message bodies can render correctly — anywhere that only needs a flat text
// snippet/preview must strip it first, or React will show the literal tags.
export function htmlToPlainText(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}
