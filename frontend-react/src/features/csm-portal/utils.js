// Shared formatting + client-side playbook triage helpers for the CSM
// Portal. Triage (silent/renewal/handover-ready) is computed here from
// fields the /portfolio endpoint already returns per account
// (last_touch_at, open_opportunity.close_date, closing_brief_locked) —
// no extra endpoint per playbook, mirrors the backend's own reuse of one
// AccountActivity table for several purposes.

export const TIER_VARIANT = { Healthy: 'success', 'At Risk': 'warning', Critical: 'danger' };
export const tierVariant = (tier) => TIER_VARIANT[tier] || 'default';

export function formatMoney(amount) {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// Matches backend csm_health.py's own 30-day silent-account threshold.
export const SILENT_ACCOUNT_DAYS = 30;
export const RENEWAL_COUNTDOWN_DAYS = 60;

export function isSilentAccount(account) {
  const d = daysSince(account.last_touch_at);
  return d === null || d >= SILENT_ACCOUNT_DAYS;
}

export function isRenewalUpcoming(account) {
  if (!account.open_opportunity?.close_date) return false;
  const daysUntil = -daysSince(account.open_opportunity.close_date); // daysSince is negative for a future date
  return daysUntil >= 0 && daysUntil <= RENEWAL_COUNTDOWN_DAYS;
}

export function isZeroFormHandoverReady(account) {
  // A closing brief exists and hasn't locked yet — the CSM hasn't logged
  // their first touch, so the auto-carried handover is sitting there
  // unreviewed with nothing manually entered.
  return account.closing_brief_locked === false;
}

// Gap #3 — explicit empty-state copy instead of a blank screen. Wording
// differs for a CSM (assignment is someone else's job) vs an admin (might
// mean SF Account sync isn't even on).
export function emptyPortfolioCopy(isAdmin) {
  return isAdmin
    ? { title: 'No accounts yet', message: 'Salesforce Account sync may not be enabled. Check Integrations settings.' }
    : { title: 'No accounts assigned to you yet', message: 'Your Super Admin manages CSM assignments.' };
}
