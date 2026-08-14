// Shared toast-dispatch helper — mirrors features/rcm-widget/engine/toast.js's
// established pattern: one place the 'rcm:toast' CustomEvent contract is
// defined, instead of re-inlining the same 3 lines at every call site.
export function toast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('rcm:toast', { detail: { message, type } }));
}
