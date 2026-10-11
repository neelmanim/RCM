// Dashboard click-through: write the view state the Leads hub restores on mount (same shape useLeadsList persists),
// then navigate. `statuses` is a plain status filter; `smart` is a server-side view ({ key, label, from?, to? }).
const VIEW_STATE_KEY = 'leadsHub.viewState';

export function openLeads(onNavigate, { statuses = [], smart = null } = {}) {
  try {
    sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
      filters: statuses.length ? { status: statuses } : {},
      activeFilterKeys: statuses.length ? ['status'] : [],
      globalView: false, page: 1, searchTerm: '', smartView: smart,
    }));
  } catch { /* storage blocked: Leads just opens unfiltered */ }
  if (typeof onNavigate === 'function') onNavigate('leads');
  else window._loadView?.('leads');
}
