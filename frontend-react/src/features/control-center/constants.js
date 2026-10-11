// constants.js — Control Center section list.
//
// 2026-09-04: the visibility gate widened from a single owner email to all
// Super Admins — see app.js's control-center route guard and
// ControlCenterHub.jsx's own role check. Every legacy page Control Center
// consolidates (Settings, Admin, Upload Center, System Logs, Pods) is at
// minimum Super-Admin-accessible, so this changes HOW a Super Admin reaches
// things they already had full legitimate access to, not WHAT they can
// reach. Deliberately not widened to Pod Admin yet — Data and most of
// Monitoring have no internal role sub-gating and are Super-Admin-only in
// legacy.

// 2026-09-09 (v12.2): Pod Admins admitted, but only to the sections they
// already legitimately have in the legacy pages — see `roles` below. This is
// the "migrate Pod Admin settings" half of the v12.2 settings work.

// [{key, label, roles}] — icons are attached in ControlCenterHub.jsx
// (lucide-react components aren't plain-data-safe to store here).
//
// `roles` is the allowlist of roles that may open the section. Deriving it
// from what each role holds in the legacy pages, NOT from convenience:
//   - Team & Access  -> admin.js ("Team Management": users, roles, POD
//                       reassignment) is nav-gated to Pod Admin today, and
//                       GET /admin/users is require_admin and already scopes a
//                       Pod Admin to their own pod members server-side.
//   - Integrations   -> Super Admin only. It renders Aircall/Alternate Messenger
//                       credentials and Public API key generation; the API-key
//                       routes are require_super_admin, so a Pod Admin would
//                       get a section of 403s and credential fields they have
//                       no business seeing.
//   - AI & Automation-> Super Admin only (legacy `ai` + call-outcomes tabs).
//   - Data           -> Super Admin only (Upload Center + Sandbox refresh,
//                       both Super-Admin-only in legacy, no role sub-gating).
//   - Monitoring     -> Super Admin only (System Logs, likewise).
// A UI gate, not a security boundary — every endpoint keeps its own gate.
export const SECTION_TABS = [
    { key: 'integrations', label: 'Integrations',    roles: ['Super Admin'] },
    { key: 'team-access',  label: 'Team & Access',   roles: ['Super Admin', 'Pod Admin'] },
    { key: 'automation',   label: 'AI & Automation', roles: ['Super Admin'] },
    { key: 'data',         label: 'Data',            roles: ['Super Admin'] },
    { key: 'monitoring',   label: 'Monitoring',      roles: ['Super Admin'] },
];

/** Sections this role may open. An empty result means no Control Center at
 *  all, so this doubles as the access check — no second role list to keep in
 *  step with SECTION_TABS above. */
export const sectionsForRole = (role) =>
    SECTION_TABS.filter((t) => t.roles.includes(role));
