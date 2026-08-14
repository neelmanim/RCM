// Section titles and release-note tags were authored with a leading emoji
// (e.g. "🚀 Getting Started", "🐛 BUG FIX") back when that emoji WAS the
// only icon. Now that each section/tag also gets a real lucide icon, the
// emoji is a second, inconsistent icon system sitting right next to the
// first — strip it so the lucide icon is the only one.
// \p{Extended_Pictographic} covers the emoji itself; ‍/️ cover
// ZWJ-joined and variation-selector sequences (e.g. the "🛡️" shield).
const LEADING_EMOJI_RE = /^[\p{Extended_Pictographic}‍️\s]+/u;

export function stripLeadingEmoji(text) {
  return text.replace(LEADING_EMOJI_RE, '').trim();
}
