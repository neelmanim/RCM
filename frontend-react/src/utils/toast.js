// ── utils/toast.js ───────────────────────────────────────────────────────────
// One definition of the 'alternate:toast' CustomEvent contract the vanilla
// shell listens for. Previously copied byte-for-byte into each feature that
// needed it (sales-journey, messenger-widget/engine, and very nearly
// my-settings as a third) — every copy said it was "one place the contract is
// defined", which stopped being true at the second one.
export function toast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('alternate:toast', { detail: { message, type } }));
}
