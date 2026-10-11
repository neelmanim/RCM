const ADMIN_ROLES = ['super admin', 'admin', 'pod admin'];

// Case-insensitive on purpose — the vanilla shell and various backend JWTs
// have both passed Title Case ("Super Admin") and lowercase role strings at
// different times; a call site that skipped .toLowerCase() (SalesToolsHub's
// old CADENCE_ALLOWED_ROLES) only "worked" by coincidence.
export const isAdminRole = (userRole) => ADMIN_ROLES.includes((userRole || '').toLowerCase());

// Instantly Replies (Sales Tools): CSM and unknown roles get 403 server-side,
// so the tab is hidden for them too.
const REPLIES_ROLES = ['super admin', 'admin', 'pod admin', 'sdr', 'ae'];
export const canSeeReplies = (userRole) => REPLIES_ROLES.includes((userRole || '').toLowerCase());
