const NAV_STORAGE_KEY = 'leads_nav_state';
let _navLeads = [];  // [{id, name, phone}] — current visible page in display order

export function getNavLeads() {
    if (_navLeads.length) return _navLeads;
    try {
        const saved = JSON.parse(sessionStorage.getItem(NAV_STORAGE_KEY) || '[]');
        if (Array.isArray(saved)) _navLeads = saved;
    } catch { /* corrupt/unavailable storage — stay empty, pager just won't show */ }
    return _navLeads;
}

function _setNavLeads(leads) {
    _navLeads = leads;
    try { sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(_navLeads)); } catch { /* storage full/unavailable — in-memory still works this tab */ }
}

function _toNavLeads(leads) {
    return leads.map(l => ({ id: l.id, name: [l.first_name, l.last_name].filter(Boolean).join(' ') || l.company || '—', phone: l.phone || l.phone_secondary || '' }));
}

export function setNavLeadsFromRaw(leads) { _setNavLeads(_toNavLeads(leads || [])); }

