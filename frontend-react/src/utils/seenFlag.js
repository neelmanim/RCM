// Shared by any one-time UI hint gated on "has this browser seen it before" —
// GuidedTour.jsx and AircallEverywhereDrawer.jsx both had their own identical
// try/catch copy of this before it was extracted here.
export function hasSeen(key) {
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
}

export function markSeen(key) {
  try { window.localStorage.setItem(key, '1'); } catch { /* storage unavailable — hint just reappears next visit */ }
}
