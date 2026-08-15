// ── api.js — All API calls as named async functions ───────────────────────────
import { API_BASE, authHeaders, isAdmin } from './auth.js';

/** If any API call returns 401, session is expired — redirect to login. */
function handleUnauthorized(res) {
    if (res.status === 401) {
        localStorage.removeItem('crm_token');
        window.location.href = 'signup.html';
        throw new Error('Session expired. Redirecting to login...');
    }
}

export async function fetchLeads({ page = 1, per_page = 20, search = '', status = '', source = '', company = '', date_from = '', date_to = '', outcome = '', assigned_to = '', ids_only = false, global_view = false } = {}) {
    const base = isAdmin ? `${API_BASE}/api/leads` : `${API_BASE}/api/leads/my`;
    const params = new URLSearchParams({ page, per_page });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (company) params.set('company', company);
    if (date_from) params.set('date_from', date_from);
    if (date_to) params.set('date_to', date_to);
    if (outcome) params.set('outcome', outcome);
    if (assigned_to) params.set('assigned_to', assigned_to);
    if (ids_only) params.set('ids_only', 'true');
    if (global_view) params.set('global_view', 'true');
    const res = await fetch(`${base}?${params}`, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Failed to fetch leads');
    return res.json();  // { data, total, page, per_page, pages }
}


export async function fetchLeadCompanies() {
    const res = await fetch(`${API_BASE}/api/leads/companies`, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.companies || [];
}

export async function fetchKanbanLeads() {
    const res = await fetch(`${API_BASE}/api/leads/kanban`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch kanban leads');
    return res.json();  // array of lead summaries
}

export async function fetchDashboardStats(globalView = false) {
    const params = new URLSearchParams();
    if (globalView) params.set('global_view', 'true');
    const qs = params.toString() ? '?' + params.toString() : '';
    const res = await fetch(`${API_BASE}/api/leads/dashboard-stats${qs}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch dashboard stats');
    return res.json();  // { total, status_counts, recent_leads }
}

export async function fetchActivityFeed(limit = 50, globalView = false) {
    const params = new URLSearchParams({ limit });
    if (globalView) params.set('global_view', 'true');
    const res = await fetch(`${API_BASE}/api/leads/activity-feed?${params}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch activity feed');
    return res.json();  // array of status change objects
}

export async function fetchLeadStatusHistory(leadId) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/status-history`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch status history');
    return res.json();  // array of status change objects
}

export async function fetchLead(leadId) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}`, { headers: authHeaders() });
    return res.json();
}

export async function patchLead(leadId, fields) {
    return fetch(`${API_BASE}/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
    });
}

export async function updateLeadStatus(leadId, newStatus) {
    return fetch(`${API_BASE}/api/leads/kanban/move?lead_id=${leadId}&new_status=${encodeURIComponent(newStatus)}`, {
        method: 'PATCH', headers: authHeaders()
    });
}

export async function closeLead(leadId, reason) {
    return fetch(`${API_BASE}/api/leads/${leadId}/close`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
}

export async function markNoShow(leadId, reason) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/no-show`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to mark no-show');
    }
    return res.json();
}

export async function addDiscoveryMeeting(leadId) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/add-discovery`, {
        method: 'POST',
        headers: authHeaders(),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to log discovery meeting');
    }
    return res.json();
}

export async function patchLeadOutcome(leadId, status, notes = '') {
    return fetch(`${API_BASE}/api/leads/${leadId}/outcome`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes })
    });
}

export async function createLead(payload) {
    return fetch(`${API_BASE}/api/leads`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

// ── Research ──────────────────────────────────────────────────────────────────
export async function patchLeadResearch(leadId, fields) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/research`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
    });
    handleUnauthorized(res);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to save research (${res.status})`);
    }
    return res.json();
}

// ── Notes ─────────────────────────────────────────────────────────────────────
export async function fetchLeadNotes(leadId) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/notes`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function addLeadNote(leadId, content, author) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/notes`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, author })
    });
    return res.json();
}

export async function deleteLeadNote(leadId, noteId) {
    return fetch(`${API_BASE}/api/leads/${leadId}/notes/${noteId}`, { method: 'DELETE', headers: authHeaders() });
}

// ── Sales Journey ─────────────────────────────────────────────────────────────
export async function fetchLeadJourneyEnrollments(leadId) {
    const res = await fetch(`${API_BASE}/api/journeys/by-lead/${leadId}`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export async function fetchLeadTasks(leadId) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/tasks`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function addLeadTask(leadId, title, due_date, due_time = null) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/tasks`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, due_date, ...(due_time ? { due_time } : {}) })
    });
    return res.json();
}

export async function patchLeadTask(leadId, taskId, fields) {
    return fetch(`${API_BASE}/api/leads/${leadId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
    });
}

export async function deleteLeadTask(leadId, taskId) {
    return fetch(`${API_BASE}/api/leads/${leadId}/tasks/${taskId}`, { method: 'DELETE', headers: authHeaders() });
}

// ── Calls ─────────────────────────────────────────────────────────────────────

export async function logCall(leadId, payload) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/calls`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Call log failed (${res.status})`);
    }
    return res.json();
}

export async function fetchCallSummary() {
    const res = await fetch(`${API_BASE}/api/sdr/call-summary`, { headers: authHeaders() });
    return res.ok ? res.json() : null;
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export async function fetchAdminUsers() {
    const res = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function createUser(payload) {
    return fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

export async function deleteUser(userId) {
    return fetch(`${API_BASE}/api/admin/users/${userId}`, { method: 'DELETE', headers: authHeaders() });
}

export async function patchUserAccess(userId, action) {
    return fetch(`${API_BASE}/api/admin/users/${userId}/access`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
    });
}

export async function patchUserRole(userId, role) {
    return fetch(`${API_BASE}/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
    });
}

export async function patchUserSettings(userId, settings) {
    return fetch(`${API_BASE}/api/admin/users/${userId}/settings`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    });
}

/** Fetch all SDR RCM dialer assignments (Super Admin only). */
export async function fetchSdrDialerConfigs() {
    const res = await fetch(`${API_BASE}/api/admin/dialer/sdr-configs`, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Failed to fetch SDR dialer configs');
    return res.json();   // [{id, name, email, rcm_user_id, rcm_from_number, rcm_email, ...}]
}

export async function fetchUserToken(userId) {
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}/token`, { headers: authHeaders() });
    return res.ok ? res.json() : null;
}

export async function fetchUnassignedLeads() {
    const res = await fetch(`${API_BASE}/api/admin/leads/unassigned`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function fetchAssignedLeads() {
    const res = await fetch(`${API_BASE}/api/admin/leads/assigned`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function bulkAssign(userId, leadIds) {
    const res = await fetch(`${API_BASE}/api/admin/assignments/bulk-assign`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, lead_ids: leadIds })
    });
    return res.json();
}

export async function autoAssignAll() {
    return fetch(`${API_BASE}/api/admin/assignments/auto-assign-all`, {
        method: 'POST', headers: authHeaders()
    });
}

export async function unassignLead(userId, leadId) {
    return fetch(`${API_BASE}/api/admin/assignments/${userId}/${leadId}`, {
        method: 'DELETE', headers: authHeaders()
    });
}

export async function bulkUnassign(leadIds) {
    const res = await fetch(`${API_BASE}/api/admin/assignments/bulk-unassign`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: leadIds })
    });
    return res.json();
}

export async function bulkDeleteLeads(leadIds) {
    const res = await fetch(`${API_BASE}/api/admin/leads/bulk-delete`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: leadIds })
    });
    return res.json();
}

export async function syncSalesforce() {
    return fetch(`${API_BASE}/api/admin/sync`, { method: 'POST', headers: authHeaders() });
}

export async function fetchSyncSettings() {
    const res = await fetch(`${API_BASE}/api/admin/sync-settings`, { headers: authHeaders() });
    return res.ok ? res.json() : { lead_limit: 1000, record_type_ids: [], sf_push_stage: 'Demo Done' };
}

export async function fetchCallOutcomes() {
    const res = await fetch(`${API_BASE}/api/call-outcomes`, { headers: authHeaders() });
    return res.ok ? res.json() : { outcomes: [], enabled_outcomes: [] };
}

/** Poll whether an Aircall webhook already logged an outcome for this DialerCall. */
export async function fetchCallOutcomeStatus(callId) {
    const res = await fetch(`${API_BASE}/api/dialer/call-outcome-status?call_id=${encodeURIComponent(callId)}`, { headers: authHeaders() });
    if (res.status === 404) return { outcome_logged: false };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();  // { outcome_logged: bool, outcome: string|null }
}

export async function fetchSfConnectionInfo() {
    const res = await fetch(`${API_BASE}/api/admin/sf-connection-info`, { headers: authHeaders() });
    return res.ok ? res.json() : { connected: false, username: '', domain_type: 'Production', instance_url: '' };
}

export async function patchSyncSettings(fields) {
    return fetch(`${API_BASE}/api/admin/sync-settings`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
    });
}

export async function fetchRecordTypes() {
    const res = await fetch(`${API_BASE}/api/admin/record-types`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function uploadSdrCsv(csvText) {
    return fetch(`${API_BASE}/api/admin/users/upload`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText })
    });
}

// ── Lead Upload (Enriched Sheets) ─────────────────────────────────────────────
export async function uploadLeadPreview(csvText) {
    const res = await fetch(`${API_BASE}/api/admin/leads/upload-preview`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText })
    });
    handleUnauthorized(res);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Preview failed (${res.status})`);
    }
    return res.json();
}

export async function uploadLeadSheet(csvText, mapping, skipUnmatched = true, filename = 'unknown', updateExisting = false, assignToUserId = null, assignToPodId = null, tag = null) {
    const payload = { csv: csvText, mapping, skip_unmatched: skipUnmatched, filename, update_existing: updateExisting };
    if (assignToUserId) payload.assign_to_user_id = assignToUserId;
    if (assignToPodId) payload.assign_to_pod_id = assignToPodId;
    if (tag) payload.tag = tag;
    const res = await fetch(`${API_BASE}/api/admin/leads/upload-sheet`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    handleUnauthorized(res);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Import failed (${res.status})`);
    }
    return res.json();
}

export async function fetchUploadLogs(page = 1, perPage = 10) {
    const params = new URLSearchParams({ page, per_page: perPage });
    const res = await fetch(`${API_BASE}/api/admin/leads/upload-logs?${params}`, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Failed to fetch upload logs');
    return res.json();
}

export async function fetchUploadBatchMetrics({ date_range = 'all', pod_id = '' } = {}) {
    const params = new URLSearchParams({ date_range });
    if (pod_id) params.set('pod_id', pod_id);
    const res = await fetch(`${API_BASE}/api/admin/leads/upload-batch-metrics?${params}`, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Failed to fetch upload batch metrics');
    return res.json();
}

export async function fetchBatchLeadDetail(logId, { pod_id = '', page = 1, per_page = 50 } = {}) {
    const params = new URLSearchParams({ page, per_page });
    if (pod_id) params.set('pod_id', pod_id);
    const res = await fetch(`${API_BASE}/api/admin/leads/upload-batch-metrics/${logId}/leads?${params}`, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Failed to fetch batch lead detail');
    return res.json();
}

export async function rollbackUploadBatch(logId) {
    const res = await fetch(`${API_BASE}/api/admin/leads/upload-logs/${logId}/rollback`, {
        method: 'POST',
        headers: authHeaders()
    });
    handleUnauthorized(res);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Rollback failed (${res.status})`);
    }
    return res.json();
}

export async function fetchGoogleSheetPreview(url) {
    const res = await fetch(`${API_BASE}/api/admin/leads/upload-gsheet`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to fetch Google Sheet');
    }
    return res.json();
}

export async function importGoogleSheet(url, mapping, updateExisting = false, sheetName = 'Google Sheet', assignToUserId = null, assignToPodId = null, tag = null) {
    const payload = { url, mapping, update_existing: updateExisting, sheet_name: sheetName };
    if (assignToUserId) payload.assign_to_user_id = assignToUserId;
    if (assignToPodId) payload.assign_to_pod_id = assignToPodId;
    if (tag) payload.tag = tag;
    const res = await fetch(`${API_BASE}/api/admin/leads/import-gsheet`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return res.json();
}

// ── PODs ──────────────────────────────────────────────────────────────────────
export async function fetchPods() {
    const res = await fetch(`${API_BASE}/api/pods`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function createPod(name, adminId, timezone) {
    const res = await fetch(`${API_BASE}/api/pods`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, admin_id: adminId, timezone: timezone || null })
    });
    return res.json();
}

export async function updatePod(podId, fields) {
    return fetch(`${API_BASE}/api/pods/${podId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
    });
}

export async function deletePod(podId) {
    return fetch(`${API_BASE}/api/pods/${podId}`, { method: 'DELETE', headers: authHeaders() });
}

export async function addPodMember(podId, userId) {
    return fetch(`${API_BASE}/api/pods/${podId}/members`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
    });
}

export async function removePodMember(podId, userId) {
    return fetch(`${API_BASE}/api/pods/${podId}/members/${userId}`, {
        method: 'DELETE', headers: authHeaders()
    });
}

export async function assignLeadsToPod(podId, leadIds) {
    return fetch(`${API_BASE}/api/pods/${podId}/assign-leads`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: leadIds })
    });
}

export async function addPodAdmin(podId, userId) {
    const res = await fetch(`${API_BASE}/api/pods/${podId}/admins`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to add Pod Admin');
    }
    return res.json();
}

export async function removePodAdmin(podId, userId) {
    const res = await fetch(`${API_BASE}/api/pods/${podId}/admins/${userId}`, {
        method: 'DELETE', headers: authHeaders()
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to remove Pod Admin');
    }
    return res.json();
}


// ── Leaderboard ───────────────────────────────────────────────────────────────
export async function fetchLeaderboard(range = 0, globalView = false) {
    const params = new URLSearchParams();
    if (range > 0) params.set('range', range);
    if (globalView) params.set('global_view', 'true');
    const qs = params.toString() ? '?' + params.toString() : '';
    const res = await fetch(`${API_BASE}/api/leaderboard${qs}`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function fetchAELeaderboard(range = 0, globalView = false) {
    const params = new URLSearchParams();
    if (range > 0) params.set('range', range);
    if (globalView) params.set('global_view', 'true');
    const qs = params.toString() ? '?' + params.toString() : '';
    const res = await fetch(`${API_BASE}/api/leaderboard/ae${qs}`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

// ── SDR Performance ───────────────────────────────────────────────────────
export async function fetchSdrPerformance(sdrId, { period = 'all_time', start_date, end_date } = {}) {
    const params = new URLSearchParams({ period });
    if (start_date) params.set('start_date', start_date);
    if (end_date) params.set('end_date', end_date);
    const res = await fetch(`${API_BASE}/api/sdr-performance/${sdrId}?${params}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch SDR performance');
    return res.json();
}

// ── Search ────────────────────────────────────────────────────────────────────
export async function globalSearch(q) {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
    return res.ok ? res.json() : { leads: [], users: [] };
}

// ── SF Integration Logs ───────────────────────────────────────────────────────
export async function fetchSfLogs(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
    const res = await fetch(`${API_BASE}/api/admin/sf-logs?${qs}`, { headers: authHeaders() });
    return res.ok ? res.json() : { logs: [], total: 0, page: 1, per_page: 20, total_pages: 1 };
}

export async function fetchSfLogDetail(logId) {
    const res = await fetch(`${API_BASE}/api/admin/sf-logs/${logId}`, { headers: authHeaders() });
    return res.ok ? res.json() : null;
}

export function exportSfLogsCsvUrl(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
    return `${API_BASE}/api/admin/sf-logs/export?${qs}`;
}

// ── Login Logs ────────────────────────────────────────────────────────────────
export async function fetchLoginLogs({ page = 1, per_page = 20, search = '' } = {}) {
    const params = new URLSearchParams({ page, per_page });
    if (search) params.set('search', search);
    const res = await fetch(`${API_BASE}/api/admin/login-logs?${params}`, { headers: authHeaders() });
    return res.ok ? res.json() : { data: [], total: 0, page: 1, per_page: 20, pages: 1 };
}

// ── Audit Activity (paginated) ────────────────────────────────────────────────
export async function fetchAuditActivity({ page = 1, per_page = 20, search = '' } = {}) {
    const limit = per_page;
    const offset = (page - 1) * per_page;
    const res = await fetch(`${API_BASE}/api/leads/activity-feed?limit=200`, { headers: authHeaders() });
    if (!res.ok) return { data: [], total: 0, page, per_page, pages: 1 };
    const all = await res.json();
    // Client-side search + pagination (backend activity-feed doesn't paginate yet)
    let filtered = all;
    if (search) {
        const q = search.toLowerCase();
        filtered = all.filter(a =>
            (a.lead_name || '').toLowerCase().includes(q) ||
            (a.changed_by || '').toLowerCase().includes(q)
        );
    }
    const total = filtered.length;
    const data = filtered.slice(offset, offset + per_page);
    return { data, total, page, per_page, pages: Math.max(1, Math.ceil(total / per_page)) };
}

// ── Feedback ──────────────────────────────────────────────────────────────────
// Submission is handled by the React NavHub FeedbackModal directly (fetch to
// /api/admin/feedback with window._authHeaders()) — see layout/FeedbackModal.jsx.
export async function fetchFeedback({ page = 1, per_page = 20, status = '' } = {}) {
    const params = new URLSearchParams({ page, per_page });
    if (status) params.set('status', status);
    const res = await fetch(`${API_BASE}/api/admin/feedback?${params}`, { headers: authHeaders() });
    return res.ok ? res.json() : { data: [], total: 0, page: 1, per_page: 20, pages: 1 };
}

export async function patchFeedbackStatus(feedbackId, status) {
    return fetch(`${API_BASE}/api/admin/feedback/${feedbackId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });
}

// ── Salesforce Connection Management ──────────────────────────────────────────
export async function fetchSfConnectionStatus() {
    const res = await fetch(`${API_BASE}/api/admin/sf/status`, { headers: authHeaders() });
    return res.ok ? res.json() : { connected: false };
}

export async function connectSalesforce(creds) {
    const res = await fetch(`${API_BASE}/api/admin/sf/connect`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(creds)
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Connection failed');
    }
    return res.json();
}

export async function disconnectSalesforce() {
    const res = await fetch(`${API_BASE}/api/admin/sf/disconnect`, {
        method: 'POST', headers: authHeaders()
    });
    return res.json();
}

export async function reconnectSalesforce() {
    const res = await fetch(`${API_BASE}/api/admin/sf/reconnect`, {
        method: 'POST', headers: authHeaders()
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Reconnection failed');
    }
    return res.json();
}

// ── RCM / RCM Messaging Messaging ──────────────────────────────────────────
export async function fetchMessagingConfig(leadId) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/messaging/config`, { headers: authHeaders() });
    return res.ok ? res.json() : { enabled: false, reason: 'Failed to load messaging config' };
}

// ── SDR Usage Metrics ─────────────────────────────────────────────────────────
export async function fetchMetricsSummary(range = 30, startDate = '', endDate = '') {
    const params = new URLSearchParams({ range });
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const res = await fetch(`${API_BASE}/api/admin/metrics/summary?${params}`, { headers: authHeaders() });
    return res.ok ? res.json() : {};
}

export async function fetchMetricsDailyTrend(range = 30, startDate = '', endDate = '') {
    const params = new URLSearchParams({ range });
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const res = await fetch(`${API_BASE}/api/admin/metrics/daily-trend?${params}`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export async function fetchMetricsSdrTable(range = 30, startDate = '', endDate = '') {
    const params = new URLSearchParams({ range });
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const res = await fetch(`${API_BASE}/api/admin/metrics/sdr-table?${params}`, { headers: authHeaders() });
    return res.ok ? res.json() : [];
}

export function exportMetricsUrl(range = 30, format = 'csv', startDate = '', endDate = '') {
    const params = new URLSearchParams({ range, format });
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return `${API_BASE}/api/admin/metrics/export?${params}`;
}

// ── Nylas Email Integration ──────────────────────────────────────────────────
export async function getNylasConfig() {
    const res = await fetch(`${API_BASE}/api/email/config`, { headers: authHeaders() });
    return res.ok ? res.json() : { configured: false };
}

export async function saveNylasConfig(config) {
    const res = await fetch(`${API_BASE}/api/email/config`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    return res.json();
}

export async function getEmailAuthUrl() {
    const res = await fetch(`${API_BASE}/api/email/auth-url`, { headers: authHeaders() });
    return res.ok ? res.json() : null;
}

export async function getEmailStatus() {
    const res = await fetch(`${API_BASE}/api/email/status`, { headers: authHeaders() });
    return res.ok ? res.json() : { connected: false, nylas_configured: false };
}

export async function toggleEmailBranding(hide) {
    const res = await fetch(`${API_BASE}/api/email/toggle-branding`, {
        method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ hide_branding_in_email: hide }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || data?.message || `Failed to update (${res.status})`);
    return data;
}

export async function getMySignature() {
    const res = await fetch(`${API_BASE}/api/email/signature`, { headers: authHeaders() });
    return res.ok ? res.json() : { signature_html: '' };
}

export async function saveMySignature(signatureHtml) {
    const res = await fetch(`${API_BASE}/api/email/signature`, {
        method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature_html: signatureHtml }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || data?.message || `Failed to save (${res.status})`);
    return data;
}

export async function getCalendarAvailability(startIso, durationMinutes) {
    // Network/parse failure is "unknown", not "not connected" — the caller
    // (modals.js) must not conflate the two; this check is purely advisory.
    try {
        const params = new URLSearchParams({ start: startIso, duration_minutes: durationMinutes });
        const res = await fetch(`${API_BASE}/api/email/calendar/availability?${params}`, { headers: authHeaders() });
        return res.ok ? res.json() : { connected: null, available: null, conflicts: [] };
    } catch {
        return { connected: null, available: null, conflicts: [] };
    }
}

export async function draftMeetingAgenda(leadId) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/meeting-agenda-draft`, {
        method: 'POST', headers: authHeaders(),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Agenda draft failed (${res.status})`);
    }
    return (await res.json()).agenda;
}

export async function disconnectEmail() {
    const res = await fetch(`${API_BASE}/api/email/disconnect`, {
        method: 'POST',
        headers: authHeaders()
    });
    return res.json();
}

export async function sendEmail(leadId, subject, body, { replyToMessageId, threadId, attachments, cc, bcc } = {}) {
    const hasAttachments = attachments && attachments.length > 0;

    if (hasAttachments || replyToMessageId) {
        // Multipart send (supports attachments + reply threading)
        const formData = new FormData();
        formData.append('lead_id', leadId);
        formData.append('subject', subject);
        formData.append('body', body);
        if (replyToMessageId) formData.append('reply_to_message_id', replyToMessageId);
        if (threadId) formData.append('thread_id', threadId);
        if (cc) formData.append('cc', cc);
        if (bcc) formData.append('bcc', bcc);
        if (attachments) {
            attachments.forEach((file, i) => formData.append(`attachment${i}`, file));
        }
        const res = await fetch(`${API_BASE}/api/email/send`, {
            method: 'POST',
            headers: authHeaders(),  // No Content-Type — browser auto-sets multipart boundary
            body: formData
        });
        return { ok: res.ok, data: await res.json() };
    }

    // JSON send (no attachments, backward-compatible)
    const res = await fetch(`${API_BASE}/api/email/send`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, subject, body, cc: cc || undefined, bcc: bcc || undefined })
    });
    return { ok: res.ok, data: await res.json() };
}

export async function getLeadEmails(leadId) {
    const res = await fetch(`${API_BASE}/api/email/lead/${leadId}/emails`, { headers: authHeaders() });
    return res.ok ? res.json() : { emails: [], total: 0 };
}

export async function downloadEmailAttachment(attachmentId, messageId, filename) {
    const res = await fetch(
        `${API_BASE}/api/email/attachment/${attachmentId}/download?message_id=${encodeURIComponent(messageId)}`,
        { headers: authHeaders() }
    );
    if (!res.ok) throw new Error('Failed to download attachment');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Dialer Integration ──────────────────────────────────────────────────────
export async function startDialerCall(leadId, phoneNumber, callMode = 'browser') {
    const res = await fetch(`${API_BASE}/api/calls/start`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, phone_number: phoneNumber, call_mode: callMode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Call initiation failed');
    return data;
}

export async function getCallStatus(callId) {
    const res = await fetch(`${API_BASE}/api/calls/${callId}/status`, { headers: authHeaders() });
    if (!res.ok) return null;
    return res.json();
}

/**
 * Check if the current SDR has an active (non-stale) call in the DB.
 * Used on page load to trigger call recovery if the widget was lost mid-call.
 * Returns { active: true, call_id, status, lead_id, lead_name, phone, call_mode, started_at, answered_at }
 * or { active: false } if none.
 */
export async function getMyActiveCall() {
    try {
        const res = await fetch(`${API_BASE}/api/calls/my-active`, { headers: authHeaders() });
        if (!res.ok) return { active: false };
        return res.json();
    } catch {
        return { active: false };
    }
}

/**
 * Force-end a call: marks DB as CALL_ENDED, best-effort provider disconnect.
 * Safe to call even if the call is already ended (idempotent).
 * Accepts the JWT either as Authorization header (standard) or in the body
 * as _token (for navigator.sendBeacon which cannot set custom headers).
 */
export async function forceEndCall(callId) {
    return fetch(`${API_BASE}/api/calls/force-end`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: callId }),
    });
}


export async function fetchDialerConfig() {
    const res = await fetch(`${API_BASE}/api/dialer/config`, { headers: authHeaders() });
    return res.ok ? res.json() : { provider: 'none', has_credentials: false };
}

export async function fetchDialerStatus() {
    const res = await fetch(`${API_BASE}/api/dialer/status`, { headers: authHeaders() });
    return res.ok ? res.json() : { active: false, provider: 'none', has_credentials: false };
}

export async function saveDialerConfig(config) {
    const res = await fetch(`${API_BASE}/api/dialer/config`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to save dialer config');
    return data;
}

export async function testDialerConnection(providerKey = null) {
    const url = providerKey
        ? `${API_BASE}/api/dialer/test?provider=${encodeURIComponent(providerKey)}`
        : `${API_BASE}/api/dialer/test`;
    const res = await fetch(url, { method: 'POST', headers: authHeaders() });
    return res.ok ? res.json() : { success: false, message: 'Connection test failed' };
}

export async function testKlentyConnection() {
    const res = await fetch(`${API_BASE}/api/klenty/health`, { headers: authHeaders() });
    return res.ok ? res.json() : { status: 'error', checks: {} };
}

export async function testNylasConnection() {
    const res = await fetch(`${API_BASE}/api/email/health`, { headers: authHeaders() });
    return res.ok ? res.json() : { status: 'error', checks: {} };
}

export async function fetchDialerUsers() {
    const res = await fetch(`${API_BASE}/api/dialer/users`, { headers: authHeaders() });
    return res.ok ? res.json() : { users: [] };
}

export async function fetchDialerNumbers() {
    const res = await fetch(`${API_BASE}/api/dialer/numbers`, { headers: authHeaders() });
    return res.ok ? res.json() : { numbers: [] };
}

export async function getMyPhone() {
    const res = await fetch(`${API_BASE}/api/dialer/my-phone`, { headers: authHeaders() });
    return res.ok ? res.json() : { phone_number: "" };
}

export async function setMyPhone(phoneNumber) {
    const res = await fetch(`${API_BASE}/api/dialer/my-phone`, {
        method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || data?.message || `Failed to save (${res.status})`);
    return data;
}

export async function toggleMyDialer(enabled) {
    const res = await fetch(`${API_BASE}/api/dialer/toggle`, {
        method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ dialer_enabled: enabled }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || data?.message || `Failed to toggle dialer status (${res.status})`);
    return data;
}

// ── RCM Call Actions ──────────────────────────────────────────────

export async function callAction(callId, action, roomName = null) {
    const body = { action };
    if (roomName) body.room_name = roomName;
    const res = await fetch(`${API_BASE}/api/calls/${callId}/action`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Call action failed');
    return data;
}

export async function disconnectCall(callId = null, phoneNumber = null) {
    const body = {};
    if (callId) body.call_id = callId;
    if (phoneNumber) body.phone_number = phoneNumber;
    const res = await fetch(`${API_BASE}/api/calls/disconnect`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Disconnect failed');
    return data;
}

export async function fetchRecordingUrl(callId) {
    const res = await fetch(`${API_BASE}/api/calls/${callId}/recording-url`, { headers: authHeaders() });
    if (!res.ok) return null;
    return res.json();
}

// ── Lead Call History ────────────────────────────────────────────────────
export async function fetchLeadCalls(leadId, page = 1, limit = 10) {
    const url = `${API_BASE}/api/leads/${leadId}/calls?page=${page}&limit=${limit}`;
    const res = await fetch(url, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) return { calls: [], has_more: false, total_count: 0, stats: { total: 0, connected: 0, avg_duration: 0, last_called: null } };
    return res.json();
}

export async function updateCallOutcome(callId, outcome, notes) {
    const res = await fetch(`${API_BASE}/api/calls/${callId}/outcome`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to update call outcome');
    return data;
}

// ── Task Notifications ──────────────────────────────────────────────────────
export async function fetchPendingTasks() {
    const res = await fetch(`${API_BASE}/api/my/tasks/pending`, { headers: authHeaders() });
    if (!res.ok) {
        console.error(`[TaskNotifications] /my/tasks/pending failed: ${res.status}`);
        throw new Error(`Failed to fetch pending tasks (${res.status})`);
    }
    return res.json();
}

export async function snoozeTask(taskId, minutes = 15) {
    const res = await fetch(`${API_BASE}/api/my/tasks/${taskId}/snooze`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes })
    });
    return res.json();
}

export async function dismissTask(taskId) {
    const res = await fetch(`${API_BASE}/api/my/tasks/${taskId}/dismiss`, {
        method: 'PATCH',
        headers: authHeaders()
    });
    return res.json();
}

// ── Lead Deprioritization (V22) ───────────────────────────────────────────────
export async function reprioritizeLead(leadId, score = 100) {
    const res = await fetch(`${API_BASE}/api/leads/${leadId}/priority`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority_score: score })
    });
    if (!res.ok) throw new Error('Failed to update lead priority');
    return res.json();
}

// ── Admin Activity Feed ───────────────────────────────────────────────────────
export async function fetchAdminActivityFeed(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) { if (v !== undefined && v !== '') qs.set(k, v); }
    const res = await fetch(`${API_BASE}/api/admin/activity-feed?${qs}`, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Failed to fetch activity feed');
    return res.json();
}

// ── Account Disqualify (maker-checker) ────────────────────────────────────────
export async function createDisqualifyRequest(company, leadIds, reason) {
    const res = await fetch(`${API_BASE}/api/disqualify-requests`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, lead_ids: leadIds, reason })
    });
    handleUnauthorized(res);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to submit disqualify request');
    }
    return res.json();
}

export async function fetchDisqualifyRequests(status = 'pending') {
    const res = await fetch(`${API_BASE}/api/disqualify-requests?status=${status}`, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Failed to fetch disqualify requests');
    return res.json();
}

// Maker's own view of their requests — any role, so the Leads view can show a
// pending/rejected badge without checker (Pod Admin+) access.
export async function fetchMyDisqualifyRequests(status = 'pending') {
    const res = await fetch(`${API_BASE}/api/disqualify-requests/mine?status=${status}`, { headers: authHeaders() });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Failed to fetch my disqualify requests');
    return res.json();
}

export async function approveDisqualifyRequest(requestId) {
    const res = await fetch(`${API_BASE}/api/disqualify-requests/${requestId}/approve`, {
        method: 'POST',
        headers: authHeaders()
    });
    handleUnauthorized(res);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to approve request');
    }
    return res.json();
}

export async function rejectDisqualifyRequest(requestId, rejectionReason) {
    const res = await fetch(`${API_BASE}/api/disqualify-requests/${requestId}/reject`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejection_reason: rejectionReason })
    });
    handleUnauthorized(res);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to reject request');
    }
    return res.json();
}

// ── Analytics Hub ─────────────────────────────────────────────────────────────

function _analyticsQs(filters = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    return qs.toString();
}

/** KPI funnel metrics — filtered by date, pod, lead_source, upload_log_id */
export async function fetchAnalyticsFunnel(filters = {}) {
    const res = await fetch(`${API_BASE}/api/admin/analytics/funnel?${_analyticsQs(filters)}`, {
        headers: authHeaders(),
    });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Analytics funnel fetch failed');
    return res.json();
}

/** Time-series trend data — calls, emails, meetings per period */
export async function fetchAnalyticsTrend(filters = {}) {
    const res = await fetch(`${API_BASE}/api/admin/analytics/trend?${_analyticsQs(filters)}`, {
        headers: authHeaders(),
    });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Analytics trend fetch failed');
    return res.json();
}

/** Per-SDR performance table — paginated and sortable */
export async function fetchAnalyticsSdrTable(filters = {}, page = 1, sortBy = 'calls_made', pageSize = 7) {
    const qs = _analyticsQs({ ...filters, page, sort_by: sortBy, page_size: pageSize });
    const res = await fetch(`${API_BASE}/api/admin/analytics/sdr-table?${qs}`, {
        headers: authHeaders(),
    });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Analytics SDR table fetch failed');
    return res.json();
}

/** Email sequence breakdown by stage (intro / follow-up 1 / follow-up 2) */
export async function fetchAnalyticsEmailBreakdown(filters = {}) {
    const res = await fetch(`${API_BASE}/api/admin/analytics/email-breakdown?${_analyticsQs(filters)}`, {
        headers: authHeaders(),
    });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Analytics email breakdown fetch failed');
    return res.json();
}

/** Filter dropdown options — pods, lead_sources, batches (optionally scoped by pod + date range) */
export async function fetchAnalyticsFilters({ pod_id, date_from, date_to } = {}) {
    const qs = _analyticsQs({ pod_id, date_from, date_to });
    const res = await fetch(`${API_BASE}/api/admin/analytics/filters?${qs}`, {
        headers: authHeaders(),
    });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Analytics filters fetch failed');
    return res.json();
}

/** Data-grounded AI recommendation for current filter context */
export async function fetchAnalyticsAiRecommendation(payload = {}, signal = null) {
    const opts = {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
    if (signal) opts.signal = signal;
    const res = await fetch(`${API_BASE}/api/admin/analytics/ai-recommendation`, opts);
    handleUnauthorized(res);
    if (!res.ok) return { recommendation: null };
    return res.json();
}

/** Per-batch aggregate metrics for the All Batches comparison table */
export async function fetchAnalyticsBatchSummary(filters = {}) {
    const res = await fetch(`${API_BASE}/api/admin/analytics/batch-summary?${_analyticsQs(filters)}`, {
        headers: authHeaders(),
    });
    handleUnauthorized(res);
    if (!res.ok) throw new Error('Analytics batch summary fetch failed');
    return res.json();
}



/** Trigger a streaming CSV download — doesn't return JSON, triggers browser download */
export function downloadAnalyticsCsv(filters = {}) {
    const qs = _analyticsQs(filters);
    // Build URL and open in same tab — browser handles it as download
    const url = `${API_BASE}/api/admin/analytics/export?${qs}`;
    // Fetch with auth header then create blob download (avoids URL token exposure)
    fetch(url, { headers: authHeaders() })
        .then(res => {
            if (!res.ok) throw new Error('Export failed');
            return res.blob();
        })
        .then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `analytics_export_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
        })
        .catch(err => console.error('CSV export error:', err));
}

