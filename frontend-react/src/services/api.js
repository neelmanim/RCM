import axios from 'axios';
import { getToken, logout } from './auth';


const api = axios.create({
  // baseURL intentionally empty — resolved dynamically per request below
  // so that window.__CRM_API_BASE__ (set by mount() before createRoot) is used.
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,  // 10s hard cap — prevents infinite skeleton on slow Render cold starts
  // RCA 2026-08-10: axios's default array serialization produces
  // "status[]=a&status[]=b" — FastAPI's `Optional[List[str]] = Query(None)`
  // only recognizes repeated "status=a&status=b" (no brackets), so a
  // bracket-style array silently matches nothing and the endpoint falls
  // back to its unfiltered default. Caught live on staging: Power Dialer's
  // status-filter checkboxes sent a real request but the backend applied
  // no filter at all, since it's own Query-string parsing (in-process
  // TestClient calls in every test never touch this URL-encoding step, so
  // no test caught it). Any array param through this instance now
  // serializes to the repeated-key form FastAPI actually parses.
  paramsSerializer: {
    serialize: (params) => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
        else search.append(key, value);
      });
      return search.toString();
    },
  },
});

api.interceptors.request.use((config) => {
  // Resolve base at request time, not module load time.
  // mount() sets window.__CRM_API_BASE__ from the Vanilla JS API_BASE prop
  // before createRoot() runs, so this always gets the correct backend origin.
  const base =
    window.__CRM_API_BASE__ ||
    window.__APP_CONFIG__?.API_BASE ||
    '';
  if (base && !config.url?.startsWith('http')) {
    config.baseURL = `${base}/api`;
  } else if (!config.baseURL) {
    config.baseURL = '/api';
  }
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

// The backend's own "your login is no longer valid" 401s. Other 401s (e.g. an email connection that expired) are
// about an integration, not the person's session, and must NOT sign them out.
const SESSION_ENDED = ['Invalid or expired token', 'Not authenticated', 'Your access has been removed. Please contact your admin.'];
let endingSession = false;

api.interceptors.response.use((response) => response, async (error) => {
  const res = error.response;
  // A refused download (e.g. 403 "Exporting data is turned off…") arrives as a Blob; read it so callers can show its message.
  if (res?.data instanceof Blob && /json/.test(res.data.type || '')) {
    try { res.data = JSON.parse(await res.data.text()); } catch { /* leave it as it was */ }
  }
  // Only when the rejected request carried the login we still hold. On first sign-in some widgets call the API
  // a moment before the token is stored; that 401 is not "your session ended" and must not sign anyone out.
  const sent = error.config?.headers?.Authorization;
  if (res?.status === 401 && SESSION_ENDED.includes(res.data?.detail) && sent && sent === `Bearer ${getToken()}` && !endingSession) {
    endingSession = true;
    if (sessionStorage.getItem('crm_view_as_token')) {
      // "View as" session ran out: drop back to the admin's own login instead of signing them out.
      sessionStorage.removeItem('crm_view_as_token');
      window.location.reload();
    } else {
      // Every React screen shares this one handler (the host CRM page is the page to send to login).
      localStorage.removeItem('crm_token');
      sessionStorage.clear();
      window.location.href = 'login.html?expired=1';
    }
  }
  return Promise.reject(error);
});

export default api;

// Leads
export const LeadsService = {
  // `signal` (optional AbortController signal) lets a caller cancel an
  // in-flight request instead of a slower, superseded one tying up a
  // connection/backend worker behind a newer one — see LeadsHub's
  // useLeadsList.js for why this matters (flaky "Couldn't load leads").
  getLeads: async (params = {}, { signal } = {}) => {
    const res = await api.get("/leads", { params: { per_page: 100, ...params }, signal });
    return res.data;
  },
  getAllLeads: async (params = {}) => {
    let allLeads = [];
    let page = 1, totalPages = 1;
    try {
      do {
        const res = await api.get("/leads", { params: { ...params, page, per_page: 100 } });
        const data = res.data;
        const leads = data.data || data.leads || (Array.isArray(data) ? data : []);
        allLeads = [...allLeads, ...leads];
        totalPages = data.pages || data.total_pages || 1;
        if (page >= 20) break;
        page++;
      } while (page <= totalPages);
      return allLeads;
    } catch (err) { console.error("getAllLeads", err); return allLeads; }
  },
  getDashboardStats: async (globalView = false, _ts = null) => {
    const params = new URLSearchParams();
    if (globalView) params.set('global_view', 'true');
    if (_ts) params.set('_ts', _ts);
    const qs = params.toString();
    // 8-second AbortController timeout — dashboard shows error rather than infinite skeleton
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await api.get(`/leads/dashboard-stats${qs ? `?${qs}` : ''}`, { signal: controller.signal });
      return res.data;
    } finally {
      clearTimeout(timer);
    }
  },
  getGrowthIntelligence: async () => (await api.get("/growth-intelligence")).data,
  getErrorLogSummary: async (hours = 24) => (await api.get(`/admin/error-logs/summary?hours=${hours}`)).data,
  getActivityFeed: async () => (await api.get("/leads/activity-feed")).data,
  getLead: async (id) => (await api.get(`/leads/${id}`)).data,
  updateLead: async (id, data) => (await api.patch(`/leads/${id}`, data)).data,
  // The phone doesn't reach this lead: cadence call/text steps skip; status and email untouched.
  markPhoneInvalid: async (id) => (await api.post(`/leads/${id}/phone/invalid`)).data,
  deleteLead: async (id) => (await api.delete(`/leads/${id}`)).data,
  createLead: async (payload) => (await api.post("/leads", payload)).data,
  addNote: async (leadId, content) => (await api.post(`/leads/${leadId}/notes`, { content })).data,
  deleteNote: async (leadId, noteId) => (await api.delete(`/leads/${leadId}/notes/${noteId}`)).data,
  logCall: async (leadId, callData) => (await api.post(`/leads/${leadId}/calls`, callData)).data,
  getCallsForLead: async (leadId, page = 1, limit = 20) =>
    (await api.get(`/leads/${leadId}/calls`, { params: { page, limit } })).data,
  getNotes: async (leadId) => (await api.get(`/leads/${leadId}/notes`)).data,
  getStatusHistory: async (leadId) => (await api.get(`/leads/${leadId}/status-history`)).data,
  getFieldHistory: async (leadId) => (await api.get(`/leads/${leadId}/field-history`)).data,
  getJourney: async (leadId) => (await api.get(`/journeys/by-lead/${leadId}`)).data,
  getConversationConfig: async (leadId) => (await api.get(`/leads/${leadId}/messaging/config`)).data,
  markNoShow: async (leadId, reason) => (await api.post(`/leads/${leadId}/no-show`, { reason })).data,
  closeLead: async (leadId, reason) => (await api.post(`/leads/${leadId}/close`, { reason })).data,
  setOutcome: async (leadId, status, notes) => (await api.patch(`/leads/${leadId}/outcome`, { status, notes })).data,
  // Body key must be priority_score — the backend reads body.get("priority_score", 100),
  // so sending { score } silently no-ops to the default (100/High) regardless of tier picked.
  reprioritize: async (leadId, score = 100) => (await api.patch(`/leads/${leadId}/priority`, { priority_score: score })).data,
  getCompanies: async () => (await api.get("/leads/companies")).data,
  patchResearch: async (leadId, fields) => (await api.patch(`/leads/${leadId}/research`, fields)).data,
  // Tasks
  addTask: async (leadId, title, due_date, due_time = null) => (await api.post(`/leads/${leadId}/tasks`, { title, due_date, due_time })).data,
  getTasks: async (leadId) => (await api.get(`/leads/${leadId}/tasks`)).data,
  patchTask: async (leadId, taskId, fields) => (await api.patch(`/leads/${leadId}/tasks/${taskId}`, fields)).data,
  deleteTask: async (leadId, taskId) => (await api.delete(`/leads/${leadId}/tasks/${taskId}`)).data,
  // v13.7.0: a cadence step's "Skip this step" — closes it and moves the lead on, sending nothing.
  skipTask: async (leadId, taskId) => (await api.post(`/leads/${leadId}/tasks/${taskId}/skip`)).data,
  updateCallOutcome: async (callId, outcome, notes) => (await api.patch(`/calls/${callId}/outcome`, { outcome, notes })).data,
  triggerAiResearch: async (leadId, forceRefresh = false) =>
    (await api.post(`/leads/${leadId}/ai-research`, null, { params: forceRefresh ? { force_refresh: true } : {} })).data,
};

// Email
export const EmailService = {
  getStatus: async () => (await api.get("/email/status")).data,
  getEmailsForLead: async (leadId) => (await api.get(`/email/lead/${leadId}/emails`)).data,
  sendEmail: async ({ leadId, to, subject, body, replyToMessageId, threadId, attachments, cc, bcc }) => {
    const payload = { lead_id: leadId, to, subject, body };
    if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
    if (threadId) payload.thread_id = threadId;
    if (attachments) payload.attachments = attachments;
    if (cc) payload.cc = cc;
    if (bcc) payload.bcc = bcc;
    return (await api.post("/email/send", payload)).data;
  },
  getAuthUrl: async () => (await api.get("/email/auth-url")).data,
  disconnect: async () => (await api.post("/email/disconnect")).data,
  getSignature: async () => (await api.get("/email/signature")).data,
  saveSignature: async (signatureHtml) => (await api.patch("/email/signature", { signature_html: signatureHtml })).data,
  // Added for the My Settings React port (v12.2) — these three were reachable
  // only from legacy frontend/js/api.js before, which is why the React app had
  // no way to render that page.
  getStatus: async () => (await api.get("/email/status")).data,
  toggleBranding: async (hide) =>
    (await api.patch("/email/toggle-branding", { hide_branding_in_email: hide })).data,
  uploadSignatureLogo: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    // No explicit Content-Type — the browser must set the multipart boundary.
    return (await api.post("/email/signature/logo", formData)).data;
  },
  downloadAttachment: async (attachmentId, messageId, filename) =>
    (await api.get(`/email/attachment/${attachmentId}`, { params: { message_id: messageId, filename }, responseType: 'blob' })).data,
};

// Admin
export const AdminService = {
  getMetricsSummary: async (params) => (await api.get("/admin/metrics/summary", { params })).data,
  getMetricsDailyTrend: async (params) => (await api.get("/admin/metrics/daily-trend", { params })).data,
  getMetricsSdrTable: async (params) => (await api.get("/admin/metrics/sdr-table", { params })).data,
  exportMetricsUrl: (range = 30, format = 'csv', startDate = '', endDate = '') => {
    const params = new URLSearchParams({ range, format });
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return `${API_BASE}/api/admin/metrics/export?${params}`;
  },
  // fresh: skip the server's 120s cache — settings screens re-read after every change and must show the truth
  getUsers: async ({ fresh = false } = {}) => (await api.get("/admin/users", fresh ? { params: { fresh: true } } : undefined)).data,
  createUser: async (payload) => (await api.post("/admin/users", payload)).data,
  // Pending sign-in attempts from emails not yet added — see backend
  // models.AccessRequest. [] on any failure so a missing/older backend
  // doesn't break the rest of Team & Access.
  getAccessRequests: async () => {
    try { return (await api.get("/admin/access-requests")).data; } catch { return []; }
  },
  // Bulk add/remove via CSV — POST /admin/users/upload, body: { csv } with
  // columns email,name,action(add/remove). Same endpoint admin.js's legacy
  // "Upload CSV" button already calls; Control Center just adds a UI for it.
  uploadUsersCsv: async (csvText) => (await api.post("/admin/users/upload", { csv: csvText })).data,
  deleteUser: async (userId) => (await api.delete(`/admin/users/${userId}`)).data,
  patchUserRole: async (userId, role) => (await api.patch(`/admin/users/${userId}/role`, { role })).data,
  patchUserAccess: async (userId, action) => (await api.patch(`/admin/users/${userId}/access`, { action })).data,
  patchUserSettings: async (userId, settings) => (await api.patch(`/admin/users/${userId}/settings`, settings)).data,
  getUserToken: async (userId) => (await api.get(`/admin/users/${userId}/token`)).data,
  // Full per-user Alternate Messenger/Aircall dialer+messaging config list — legacy
  // `fetchSdrDialerConfigs()` (frontend/js/api.js) → GET /api/admin/dialer/sdr-configs.
  // Used by Control Center's Team & Access → User Access grid.
  getSdrDialerConfigs: async () => (await api.get("/admin/dialer/sdr-configs")).data,
  getSfLogs: async (params = {}) => (await api.get("/admin/sf-logs", { params })).data,
  getSfLogDetail: async (logId) => (await api.get(`/admin/sf-logs/${logId}`)).data,
  // Control Center's Monitoring → Salesforce Sync Log "Export CSV" — same
  // authenticated-blob pattern as exportLeadsBySdr/AnalyticsService.downloadCsv
  // above (a bare URL/href wouldn't carry the bearer token; legacy sf_logs.js
  // worked around this with its own manual fetch+authHeaders()). Replaces the
  // old exportSfLogsCsvUrl(), which only built the URL and had no caller.
  exportSfLogsCsv: async (params = {}) => {
    const res = await api.get(`/admin/sf-logs/export`, { params, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sf_integration_logs.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  getLoginLogs: async (params = {}) => (await api.get("/admin/login-logs", { params })).data,
  getClaudeLogs: async (params = {}) => (await api.get("/admin/claude-logs", { params })).data,
  getActivityFeed: async (params = {}) => (await api.get("/leads/activity-feed", { params })).data,
  // Control Center's Monitoring → Audit Log tab. No dedicated paginated audit-trail
  // endpoint exists server-side (unlike sf-logs/login-logs) — legacy `audit_logs.js`'s
  // Activity tab (frontend/js/api.js `fetchAuditActivity`) works around this the same
  // way: fetch up to 200 rows from GET /api/leads/activity-feed (backend/routes/lead_routes.py
  // `get_activity_feed`, `limit` is its only query param), then filter + paginate client-side.
  // Ported here rather than reused verbatim so date-range filtering applies before pagination
  // instead of only within the current page (a quirk of the legacy version).
  getAuditLogs: async ({ page = 1, per_page = 20, search = '', date_from = '', date_to = '' } = {}) => {
    const all = (await api.get("/leads/activity-feed", { params: { limit: 200 } })).data;
    let filtered = all;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((a) =>
        (a.lead_name || '').toLowerCase().includes(q) || (a.changed_by || '').toLowerCase().includes(q));
    }
    if (date_from || date_to) {
      filtered = filtered.filter((a) => {
        if (!a.changed_at) return false;
        const d = new Date(a.changed_at);
        if (date_from && d < new Date(date_from)) return false;
        if (date_to && d > new Date(`${date_to}T23:59:59`)) return false;
        return true;
      });
    }
    const total = filtered.length;
    const offset = (page - 1) * per_page;
    return { data: filtered.slice(offset, offset + per_page), total, page, per_page, pages: Math.max(1, Math.ceil(total / per_page)) };
  },
  // Control Center's Monitoring section — remaining audit_logs.js tabs
  // (Logins already covered by getLoginLogs above).
  getFeedback: async (params = {}) => (await api.get("/admin/feedback", { params })).data,
  patchFeedbackStatus: async (feedbackId, status) => (await api.patch(`/admin/feedback/${feedbackId}`, { status })).data,
  getErrorLogs: async (params = {}) => (await api.get("/admin/error-logs", { params })).data,
  reportError: async (payload) => (await api.post("/admin/error-logs", payload)).data,
  getPerfSummary: async (params = {}) => (await api.get("/admin/perf-summary", { params })).data,
  // Control Center's Data section — "Export Leads": full lead-field CSV,
  // filterable by SDR, upload batch, and/or a created_at date range (any
  // combination — backend requires at least one). Same authenticated-blob
  // pattern as AnalyticsService.downloadCsv (a bare URL-based download
  // wouldn't carry the bearer token).
  exportLeadsBySdr: async ({ sdrIds, uploadLogId, dateFrom, dateTo } = {}) => {
    const params = new URLSearchParams();
    (sdrIds || []).forEach((id) => params.append('assigned_to', id));
    if (uploadLogId) params.set('upload_log_id', uploadLogId);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    const res = await api.get(`/admin/leads/export?${params.toString()}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers['content-disposition'] || '';
    const match = cd.match(/filename[^;=\n]*=["']?([^"';\n]+)/);
    a.download = match?.[1] || `leads-export-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// Assignments
export const AssignmentsService = {
  getUnassigned: async (params = {}) => (await api.get("/admin/leads/unassigned", { params })).data,
  getAssigned: async (params = {}) => (await api.get("/admin/leads/assigned", { params })).data,
  // Single-lead reassignment reuses these with a 1-item array.
  bulkAssign: async (userId, leadIds) => (await api.post("/admin/assignments/bulk-assign", { user_id: userId, lead_ids: leadIds })).data,
  bulkUnassign: async (leadIds) => (await api.post("/admin/assignments/bulk-unassign", { lead_ids: leadIds })).data,
  bulkDelete: async (leadIds) => (await api.post("/admin/leads/bulk-delete", { lead_ids: leadIds })).data,
  autoAssignAll: async () => (await api.post("/admin/assignments/auto-assign-all")).data,
  getUploadLogs: async (page = 1, per_page = 50) =>
    (await api.get("/admin/leads/upload-logs", { params: { page, per_page } })).data,
};

// Tags — independent of upload batch; a lead can carry several, a tag can span
// multiple imports over time (Leads redesign).
export const TagsService = {
  list: async () => (await api.get("/tags")).data,
  create: async (name) => (await api.post("/tags", { name })).data,
  attach: async (leadId, tagId) => (await api.post(`/leads/${leadId}/tags/${tagId}`)).data,
  detach: async (leadId, tagId) => (await api.delete(`/leads/${leadId}/tags/${tagId}`)).data,
};

// Call Lists — user-curated, org-wide-visible Power Dialer dial lists. Any
// SDR/AE/Admin can create one and add leads to it (unlike Tags, which are
// admin-curated at upload time).
// A person's saved Leads views live on the server (per user) so they follow them to any browser/device.
export const SavedViewsService = {
  /** scope: "leads" (default, the Leads page) or "digest" (Team Digest numbers) */
  list: async (scope = "leads") => (await api.get("/me/saved-views", { params: { scope } })).data.views,
  create: async (view) => (await api.post("/me/saved-views", view)).data,
  remove: async (id) => (await api.delete(`/me/saved-views/${id}`)).data,
};

// Save a fetched blob as a file (the Excel/CSV exports below).
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// "My Day": what was given to me and what I did, in my own timezone (browser offset sent along).
export const MyDayService = {
  // params: { date, kind, given_page, did_page, per_page }
  get: async (params = {}) => (await api.get("/my-day", { params: { tz_offset_min: new Date().getTimezoneOffset(), ...params } })).data,
  // My leads by lifecycle state (New to me / Inherited / In progress / …).
  lifecycle: async () => (await api.get("/my-day/lifecycle")).data,
  // Admin / Pod Admin: raw calls + meetings workbook for the last `days` days (Excel), so any number can be checked row by row.
  exportActivity: async (days = 7) => {
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const to = new Date(); const from = new Date(); from.setDate(from.getDate() - (days - 1));
    const res = await api.get("/exports/activity.xlsx", { params: { date_from: fmt(from), date_to: fmt(to), tz_offset_min: new Date().getTimezoneOffset() }, responseType: "blob" });
    saveBlob(res.data, `activity_${fmt(from)}_${fmt(to)}.xlsx`);
  },
  // The whole day as one CSV (every row, not the visible page). Authenticated blob, like the other exports.
  exportCsv: async (date) => {
    const res = await api.get("/my-day/export", { params: { tz_offset_min: new Date().getTimezoneOffset(), ...(date ? { date } : {}) }, responseType: "blob" });
    saveBlob(res.data, `my-day-${date || new Date().toISOString().slice(0, 10)}.csv`);
  },
};

export const CallListsService = {
  list: async () => (await api.get("/call-lists")).data,
  create: async (name) => (await api.post("/call-lists", { name })).data,
  addLeads: async (callListId, leadIds) =>
    (await api.post(`/call-lists/${callListId}/leads`, { lead_ids: leadIds })).data,
  delete: async (callListId) => (await api.delete(`/call-lists/${callListId}`)).data,
};

// Disqualify Requests — company-scoped maker/checker flow (Leads redesign UI;
// backend already existed: routes/disqualify_routes.py).
// Reassign requests — an SDR/AE asks for a lead another rep owns (from the duplicate-lead 409);
// Pod Admin+ approves/rejects. Mirrors DisqualifyService.
export const ReassignService = {
  create: async (leadId, note = "") => (await api.post("/reassign-requests", { lead_id: leadId, note })).data,
  getRequests: async (status = "pending") => (await api.get("/reassign-requests", { params: { status } })).data,
  approve: async (requestId) => (await api.post(`/reassign-requests/${requestId}/approve`)).data,
  reject: async (requestId, rejectionReason = "") =>
    (await api.post(`/reassign-requests/${requestId}/reject`, { rejection_reason: rejectionReason })).data,
};

export const DisqualifyService = {
  create: async (company, leadIds, reason) =>
    (await api.post("/disqualify-requests", { company, lead_ids: leadIds, reason })).data,
  getMine: async (status = "pending") =>
    (await api.get("/disqualify-requests/mine", { params: { status } })).data,
  getRequests: async (status = "pending") =>
    (await api.get("/disqualify-requests", { params: { status } })).data,
  approve: async (requestId) => (await api.post(`/disqualify-requests/${requestId}/approve`)).data,
  reject: async (requestId, rejectionReason = "") =>
    (await api.post(`/disqualify-requests/${requestId}/reject`, { rejection_reason: rejectionReason })).data,
};

// Helper: build query string from filters object (skip null/empty values)
const _analyticsQs = (filters = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  return qs.toString();
};

export const DailyDigestService = {
  /** The Team Digest for a period. `range` is { date } (one day, vs the same weekday a week earlier) or { from, to } (vs the range
   *  right before it); `podId` is a Super Admin's pod picker (a Pod Admin is always their own pod). */
  get: async (range = {}, podId) => {
    try {
      return (await api.get("/admin/analytics/daily-digest", { params: { ...range, ...(podId ? { pod_id: podId } : {}) } })).data;
    } catch (e) { return e?.response?.data?.detail ? { error: e.response.data.detail } : null; }
  },
  /** The digest's lead-by-lead list, filtered and paged on the server. params: date | from+to, pod_id, page, per_page, rep_id, follow_up, activity, campaign, q */
  leads: async (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    try { return (await api.get("/admin/analytics/daily-digest/leads", { params: clean })).data; } catch { return null; }
  },
  /** The whole digest as one Excel file (Summary, Team, Campaigns, Leads, Pipeline movement). */
  exportXlsx: async (range = {}, podId) => {
    const res = await api.get("/admin/analytics/daily-digest/export.xlsx", {
      params: { ...range, ...(podId ? { pod_id: podId } : {}) }, responseType: "blob",
    });
    saveBlob(res.data, `team-digest-${range.date || `${range.from}-${range.to}`}.xlsx`);
  },
};

/** Team Digest drill-downs — the period's activity grouped by who the lead is, by account, and by call. Each returns { error } on a refusal. */
const drill = (path) => async (params = {}) => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  try { return (await api.get(`/admin/analytics/daily-digest/${path}`, { params: clean })).data; }
  catch (e) { return { error: e?.response?.data?.detail || "Could not load this view." }; }
};
export const DigestDrillService = {
  /** params: from, to, pod_id, dimension (icp|industry|country|city|seniority|function|company_size|source) */
  breakdown: drill("breakdown"),
  accounts: drill("accounts"),
  calls: drill("calls"),
  /** The leads behind one breakdown row ({dimension, segment}) or one account ({account}). */
  leads: drill("drilldown/leads"),
  /** The drill-down as one Excel file (breakdown + accounts + calls). Needs export access; a refusal reads as the server's message. */
  exportXlsx: async (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    const res = await api.get("/admin/analytics/daily-digest/drilldown.xlsx", { params: clean, responseType: "blob" });
    saveBlob(res.data, `team-digest-drilldown-${clean.from}-${clean.to}.xlsx`);
  },
  getIcp: async () => (await api.get("/admin/analytics/icp")).data,
  /** Super Admin: the industry words that make a lead "in ICP". */
  setIcp: async (keywords) => (await api.put("/admin/analytics/icp", { keywords })).data,
};

export const FunnelService = {
  /** Accounts -> conversations -> meetings booked -> SAL -> held, for a date range. params: from, to, pod_id, group_by (none|sdr|campaign), campaign, rep_id */
  get: async (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    try { return (await api.get("/admin/analytics/sales-funnel", { params: clean })).data; }
    catch (e) { return { error: e?.response?.data?.detail || "Could not load the funnel." }; }
  },
  exportXlsx: async (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    const res = await api.get("/admin/analytics/sales-funnel/export.xlsx", { params: clean, responseType: "blob" });
    saveBlob(res.data, `funnel-${params.from || "start"}-${params.to || "today"}.xlsx`);
  },
};

export const AnalyticsService = {
  /** Filter dropdown options — pods, batches, scoped by current filters */
  getFilters: async (filters = {}) => {
    try {
      const res = await api.get(`/admin/analytics/filters?${_analyticsQs(filters)}`);
      return res.data || { pods: [], batches: [], sdrs: [] };
    } catch { return { pods: [], batches: [], sdrs: [] }; }
  },

  /** KPI funnel metrics — lead status distribution + call/meeting counts */
  getFunnel: async (filters = {}) => {
    try {
      return (await api.get(`/admin/analytics/sales-funnel?${_analyticsQs(filters)}`)).data;
    } catch { return null; }
  },

  /** Time-series trend data */
  getTrend: async (filters = {}) => {
    try {
      return (await api.get(`/admin/analytics/trend?${_analyticsQs(filters)}`)).data;
    } catch { return null; }
  },

  /** Per-SDR performance table — returns { sdrs: [...] } */
  getSdrTable: async (filters = {}, page = 1, sortBy = 'calls_made') => {
    try {
      const qs = _analyticsQs({ ...filters, page, sort_by: sortBy });
      const data = (await api.get(`/admin/analytics/sdr-table?${qs}`)).data;
      // Normalise to { sdrs: [...] } regardless of backend shape
      const rawList = Array.isArray(data) ? data : (data?.sdrs || data?.data || []);
      return { sdrs: rawList };
    } catch { return { sdrs: [] }; }
  },

  /** Email sequence breakdown by stage */
  getEmailBreakdown: async (filters = {}) => {
    try {
      return (await api.get(`/admin/analytics/email-breakdown?${_analyticsQs(filters)}`)).data;
    } catch { return null; }
  },

  /** Per-batch aggregate metrics for All Batches comparison */
  getBatchSummary: async (filters = {}) => {
    try {
      const data = (await api.get(`/admin/analytics/batch-summary?${_analyticsQs(filters)}`)).data;
      return { batches: Array.isArray(data) ? data : (data?.batches || []) };
    } catch { return { batches: [] }; }
  },

  /** Per-lead assignment/call activity — Lead Activity drill-down panel */
  getLeadActivity: async (filters = {}, page = 1) => {
    try {
      const qs = _analyticsQs({ ...filters, page });
      return (await api.get(`/admin/analytics/leads?${qs}`)).data;
    } catch { return { leads: [], total: 0 }; }
  },

  /** Chronological status/call history for one lead */
  getLeadTimeline: async (leadId) => {
    try {
      return (await api.get(`/admin/analytics/leads/${leadId}/timeline`)).data;
    } catch { return { timeline: [] }; }
  },

  /** Data-grounded AI recommendation for current filter context */
  getAiRecommendation: async (filters = {}, signal = null) => {
    try {
      return (await api.post('/admin/analytics/ai-recommendation', filters, { signal })).data;
    } catch { return { recommendation: '' }; }
  },

  /** Trigger CSV export download */
  downloadCsv: async (filters = {}) => {
    try {
      // Route through the shared `api` instance so its interceptor resolves
      // the real backend origin (window.__CRM_API_BASE__) — a bare relative
      // fetch('/api/...') hit the frontend's own static-site origin instead
      // (frontend and backend are on separate domains), 404ed, and silently
      // downloaded the SPA's index.html fallback page as if it were the CSV.
      const res = await api.get(`/admin/analytics/export?${_analyticsQs(filters)}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement('a');
      a.href    = url;
      // Derive filename from Content-Disposition or fallback
      const cd    = res.headers['content-disposition'] || '';
      const match = cd.match(/filename[^;=\n]*=["']?([^"';\n]+)/);
      a.download  = match?.[1] || `analytics-export-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[AnalyticsService] Export failed:', err);
      alert('Export failed — please try again.');
    }
  },

  /** Automated Reports (v11.4.0) — multiple named, scheduled reports */
  listReports: async () => {
    try { return (await api.get('/admin/analytics/reports')).data; } catch { return []; }
  },
  getReport: async (id) => (await api.get(`/admin/analytics/reports/${id}`)).data,
  createReport: async (body) => (await api.post('/admin/analytics/reports', body)).data,
  updateReport: async (id, body) => (await api.patch(`/admin/analytics/reports/${id}`, body)).data,
  deleteReport: async (id) => (await api.delete(`/admin/analytics/reports/${id}`)).data,
  toggleReport: async (id, enabled) => (await api.patch(`/admin/analytics/reports/${id}/toggle`, { enabled })).data,
  duplicateReport: async (id) => (await api.post(`/admin/analytics/reports/${id}/duplicate`)).data,
  runReportNow: async (id) => (await api.post(`/admin/analytics/reports/${id}/run-now`)).data,
  previewReport: async (id) => (await api.get(`/admin/analytics/reports/${id}/preview`)).data,

  /** Weekly Changelog Digest — a single all-users on/off switch, not a normal report */
  getChangelogDigestStatus: async () => (await api.get('/admin/analytics/reports/changelog-digest')).data,
  setChangelogDigestEnabled: async (enabled) =>
    (await api.patch('/admin/analytics/reports/changelog-digest', { enabled })).data,

  listReportComponents: async () => {
    try { return (await api.get('/admin/analytics/reports/components')).data; } catch { return []; }
  },
  /** Users with a connected mailbox — the only valid "send from" options */
  getReportSenders: async () => {
    try { return (await api.get('/admin/analytics/reports/senders')).data; } catch { return []; }
  },

  listReportExecutions: async (filters = {}) => {
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) { if (v !== undefined && v !== '') qs.set(k, v); }
      return (await api.get(`/admin/analytics/report-executions?${qs}`)).data;
    } catch { return { items: [], total: 0, page: 1, per_page: 50, pages: 1 }; }
  },
};

// Smart Analytics — maps to /api/admin/smart-analytics/* endpoints
export const SmartAnalyticsService = {
  /**
   * Run a natural-language query against the pipeline data.
   * Passes the current Dashboard filters as scoping context so the AI
   * knows which Pod / Batch the user is looking at.
   */
  query: async (query, history = [], filters = {}) => {
    const body = {
      query,
      conversation_history: history.slice(-6), // last 6 turns only
    };
    // Scope to currently selected pod/batch if set
    if (filters.pod_id) body.filter_pod = filters.pod_id;
    if (filters.upload_log_id) body.filter_batch = filters.upload_log_id;
    return (await api.post('/admin/smart-analytics/query', body)).data;
  },

  getReports: async () => {
    try {
      return (await api.get('/admin/smart-analytics/reports')).data;
    } catch { return []; }
  },

  saveReport: async (name, naturalLanguageQuery, dslJson, chartType = null, skipDslValidation = false) =>
    (await api.post('/admin/smart-analytics/reports', {
      name,
      natural_language_query: naturalLanguageQuery,
      dsl_json: dslJson || '{}',
      chart_type: chartType,
      skip_dsl_validation: skipDslValidation,
    })).data,

  deleteReport: async (id) =>
    (await api.delete(`/admin/smart-analytics/reports/${id}`)).data,

  /** Toggle is_pinned on a saved report. Returns { id, name, is_pinned, pin_order }. */
  pinReport: async (id, pinned) =>
    (await api.patch(`/admin/smart-analytics/reports/${id}/pin`, { pinned })).data,

  /** Fetch all reports pinned by the current user (ordered by pin_order ASC). */
  getPinnedReports: async () => {
    try {
      return (await api.get('/admin/smart-analytics/reports/pinned')).data ?? [];
    } catch { return []; }
  },

  runReport: async (id) =>
    (await api.post(`/admin/smart-analytics/reports/${id}/run`, {})).data,

  getHistory: async () => {
    try {
      return (await api.get('/admin/smart-analytics/history')).data;
    } catch { return []; }
  },
};


// Analytics Hub vNext (Phase 1 — Metric Registry + Semantic Layer)
export const AnalyticsVNextService = {
  listMetrics: async () => {
    try {
      return (await api.get('/admin/analytics/vnext/metrics')).data?.metrics || [];
    } catch { return []; }
  },

  resolveMetric: async (metricId, filters = {}) => {
    const qs = _analyticsQs(filters);
    return (await api.get(`/admin/analytics/vnext/metrics/${metricId}${qs ? `?${qs}` : ''}`)).data;
  },

  compareMetric: async (metricId, filters = {}) => {
    const qs = _analyticsQs(filters);
    return (await api.get(`/admin/analytics/vnext/compare/${metricId}${qs ? `?${qs}` : ''}`)).data;
  },

  ask: async (query) => (await api.post('/admin/analytics/vnext/ask', { query })).data,
};

// Analytics Hub vNext — Metric Governance (Phase 3: draft/preview/compare/publish)
export const AnalyticsGovernanceService = {
  listVersions: async (metricId) => (await api.get(`/admin/analytics/governance/metrics/${metricId}/versions`)).data?.versions || [],
  createDraft: async (metricId) => (await api.post(`/admin/analytics/governance/metrics/${metricId}/draft`)).data,
  editDraft: async (versionId, body) => (await api.put(`/admin/analytics/governance/drafts/${versionId}`, body)).data,
  previewDraft: async (versionId) => (await api.get(`/admin/analytics/governance/drafts/${versionId}/preview`)).data,
  compareVersions: async (metricId) => (await api.get(`/admin/analytics/governance/metrics/${metricId}/compare-versions`)).data,
  publish: async (metricId) => (await api.post(`/admin/analytics/governance/metrics/${metricId}/publish`)).data,
};


// Search
export const SearchService = {
  global: async (q) => (await api.get("/search", { params: { q } })).data,
};

// Settings
// v13.4.0 Claude connector — the signed-in user's own API keys.
export const ClaudeConnectorService = {
  listKeys: async () => (await api.get("/me/api-keys")).data,
  createKey: async (name) => (await api.post("/me/api-keys", { name })).data,
  revokeKey: async (id) => (await api.delete(`/me/api-keys/${id}`)).data,
};

export const SfMappingService = {
  /** Extra Alternate CRM -> Salesforce Lead field mappings (Super Admin): {custom, builtin, available} */
  list: async () => (await api.get("/admin/sf-field-mappings")).data,
  add: async (leadField, sfField) => (await api.post("/admin/sf-field-mappings", { lead_field: leadField, sf_field: sfField })).data,
  setEnabled: async (id, enabled) => (await api.patch(`/admin/sf-field-mappings/${id}`, { enabled })).data,
  /** Edit a mapping: any of { enabled, lead_field, sf_field } — a changed field is re-checked against Salesforce. */
  update: async (id, patch) => (await api.patch(`/admin/sf-field-mappings/${id}`, patch)).data,
  remove: async (id) => (await api.delete(`/admin/sf-field-mappings/${id}`)).data,
  /** A built-in mapping: { sf_field?, enabled? } — all but first/last name, email, phone and status. */
  updateBuiltin: async (leadField, patch) => (await api.patch(`/admin/sf-field-mappings/builtin/${leadField}`, patch)).data,
  resetBuiltin: async (leadField) => (await api.delete(`/admin/sf-field-mappings/builtin/${leadField}`)).data,
};

export const AuditService = {
  /** The permanent who/what/when trail (Super Admin). params: { category: "export,export_access" | "sf_mapping", q, date_from, date_to, page, per_page } */
  list: async (params = {}) => (await api.get("/admin/audit-log", { params })).data,
  /** A CSV built in the browser reports itself here (refused without export access). */
  exportEvent: async (what, rows) => (await api.post("/me/export-event", { what, rows })).data,
};

export const SettingsService = {
  getSfStatus: async () => (await api.get("/admin/sf/status")).data,
  /** How many Alternate CRM leads are in Salesforce: { total, in_salesforce, only_in_alternatecrm, push_stage, waiting_at_push_stage } */
  getSfOverview: async () => (await api.get("/admin/sf-sync-overview")).data,
  getSfConnectionInfo: async () => (await api.get("/admin/sf-connection-info")).data,
  connectSf: async (creds) => (await api.post("/admin/sf/connect", creds)).data,
  disconnectSf: async () => (await api.post("/admin/sf/disconnect")).data,
  reconnectSf: async () => (await api.post("/admin/sf/reconnect")).data,
  syncSf: async () => (await api.post("/admin/sf/reconnect")).data,
  getSyncSettings: async () => (await api.get("/admin/sync-settings")).data,
  patchSyncSettings: async (fields) => (await api.patch("/admin/sync-settings", fields)).data,
  // ponytail bug fix (per CRM Alternate audit): this used to call /admin/sf/status
  // (wrong — that's the SF connection card's endpoint) instead of the real
  // record-types endpoint, matching legacy's fetchRecordTypes() (frontend/js/api.js).
  getRecordTypes: async () => { try { return (await api.get("/admin/record-types")).data; } catch { return []; } },
  getNylasConfig: async () => (await api.get("/email/config")).data,
  saveNylasConfig: async (config) => (await api.post("/email/config", config)).data,
  // ponytail: same GET /email/health probe the legacy Nylas card used (settings_connection.js), just proxied through the shared api instance instead of a bare fetch().
  testNylasConnection: async () => (await api.get("/email/health")).data,
  // Public API key (CMT <-> Salesforce bridge) — Control Center Integrations, ported from settings.js's inline publicapi panel (no prior api.js coverage existed).
  getPublicApiKeyStatus: async () => (await api.get("/admin/public-api-key/status")).data,
  generatePublicApiKey: async () => (await api.post("/admin/public-api-key/generate")).data,
  revokePublicApiKey: async () => (await api.delete("/admin/public-api-key")).data,
};

// Dialer
export const DialerService = {
  getStatus: async () => (await api.get("/dialer/status")).data,
  recordEverywhereLogin: async () => (await api.post("/dialer/everywhere-login")).data,
  getConfig: async () => (await api.get("/dialer/config")).data,
  saveConfig: async (data) => (await api.patch("/dialer/config", data)).data,
  // Optional provider ("aircall" | "messaging_provider") — matches legacy testDialerConnection(providerKey). No existing callers passed one, so this stays backward compatible.
  testConnection: async (provider) => (await api.post("/dialer/test", null, provider ? { params: { provider } } : undefined)).data,
  getUsers: async () => (await api.get("/dialer/users")).data,
  getNumbers: async () => (await api.get("/dialer/numbers")).data,
  startCall: async (leadId, phoneNumber, callMode) => (await api.post("/calls/start", { lead_id: leadId, phone_number: phoneNumber, ...(callMode && { call_mode: callMode }) })).data,
  // Power Dialer queue-status — server-side per-lead progress (survives reload).
  getQueueStatus: async (leadIds) => (await api.get("/dialer/queue-status", { params: { lead_ids: leadIds.join(",") } })).data,
  setQueueStatus: async (leadId, status, skipReason) =>
    (await api.post("/dialer/queue-status", { lead_id: leadId, status, skip_reason: skipReason })).data,
  clearQueueStatus: async (leadId) => (await api.delete(`/dialer/queue-status/${leadId}`)).data,
  getSkipSummary: async (days = 7) => (await api.get("/admin/dialer/skip-summary", { params: { days } })).data,
  // My Settings React port (v12.2) — the caller's own caller-ID and dialer
  // on/off switch. Distinct from getConfig/saveConfig above, which are the
  // org-wide admin credentials.
  getMyPhone: async () => (await api.get("/dialer/my-phone")).data,
  setMyPhone: async (phoneNumber) => (await api.patch("/dialer/my-phone", { phone_number: phoneNumber })).data,
  toggleMyDialer: async (enabled) => (await api.patch("/dialer/toggle", { dialer_enabled: enabled })).data,
  getInstantlyAnalytics: async () => (await api.get("/admin/instantly/analytics")).data,
  // v13.3.0 — sending-accounts picker + real-time webhook toggle (section 5).
  getInstantlyAccounts: async () => (await api.get("/admin/instantly/accounts")).data,
  // Webhook register/disable: built against the contract in the plan's
  // section 4/5 (Super-Admin-only, no body) — the backend route is owned by
  // a parallel phase and may not exist yet; callers handle a 404 gracefully.
  registerInstantlyWebhook: async () => (await api.post("/admin/instantly/webhook/register")).data,
  disableInstantlyWebhook: async () => (await api.post("/admin/instantly/webhook/disable")).data,
  // Klenty has no webhooks (pull-only, per klenty_provider.py) — this is the
  // only way to catch up besides waiting for the nightly job.
  syncKlentyNow: async (lookbackDays) => (await api.post("/admin/dialer/sync-klenty", lookbackDays ? { lookback_days: lookbackDays } : {})).data,
};

// Leaderboard — SDR/AE performance ranking (React port of legacy
// frontend/js/views/leaderboard.js). `range` in days; 0/omitted = all time.
// `globalView` only means anything for a Pod Admin, whose default scope is
// their own pod (the backend applies the scoping).
export const LeaderboardService = {
  getTop: async () => (await api.get("/leaderboard")).data,   // the Dashboard's top-5 (server's default range)
  getSdrs: async (range = 0, globalView = false) => (await api.get("/leaderboard", {
    params: { ...(range > 0 && { range }), ...(globalView && { global_view: true }) },
  })).data,
  getAes: async (range = 0, globalView = false) => (await api.get("/leaderboard/ae", {
    params: { ...(range > 0 && { range }), ...(globalView && { global_view: true }) },
  })).data,
};

// Pods
export const PodsService = {
  getAll: async () => (await api.get("/pods")).data,
  create: async (name, adminId, timezone) => (await api.post("/pods", { name, admin_id: adminId, timezone })).data,
  update: async (podId, fields) => (await api.patch(`/pods/${podId}`, fields)).data,
  remove: async (podId) => (await api.delete(`/pods/${podId}`)).data,
  addMember: async (podId, userId) => (await api.post(`/pods/${podId}/members`, { user_id: userId })).data,
  removeMember: async (podId, userId) => (await api.delete(`/pods/${podId}/members/${userId}`)).data,
  addAdmin: async (podId, userId) => (await api.post(`/pods/${podId}/admins`, { user_id: userId })).data,
  removeAdmin: async (podId, userId) => (await api.delete(`/pods/${podId}/admins/${userId}`)).data,
  assignLeads: async (podId, leadIds) => (await api.post(`/pods/${podId}/assign-leads`, { lead_ids: leadIds })).data,
};

// Uploads
export const UploadService = {
  getLogs: async (page = 1, perPage = 10, sortBy) => (await api.get("/admin/leads/upload-logs", { params: { page, per_page: perPage, sort_by: sortBy || undefined } })).data,
  // NB (2026-09-04, Control Center Data section port): both of these previously
  // pointed at /admin/leads/upload-logs regardless of args — never caught
  // because nothing called them until now. Fixed to the routes that actually
  // exist (backend/routes/admin_upload_routes.py:586, :644).
  getBatchMetrics: async (params = {}) => { try { return (await api.get("/admin/leads/upload-batch-metrics", { params })).data; } catch { return []; } },
  getBatchDetail: async (logId, params = {}) => (await api.get(`/admin/leads/upload-batch-metrics/${logId}/leads`, { params })).data,
  rollback: async (logId) => (await api.post(`/admin/leads/upload-logs/${logId}/rollback`)).data,
  // NB (2026-09-02, Control Center Data section port): both of these previously
  // sent `csv_text` — backend/routes/admin_upload_routes.py's upload-preview
  // and upload-sheet handlers read `body.get("csv")`. Never caught because
  // nothing called this service until now. Fixed to the real field name.
  previewCsv: async (csvText) => (await api.post("/admin/leads/upload-preview", { csv: csvText })).data,
  uploadSheet: async (csvText, mapping, opts = {}) => (await api.post("/admin/leads/upload-sheet", { csv: csvText, mapping, ...opts })).data,
  // NB: upload-gsheet is a POST route (reads a JSON body) — this used to be a
  // GET with query params, which 405s. Same 2026-09-02 fix.
  previewGSheet: async (url) => (await api.post("/admin/leads/upload-gsheet", { url })).data,
  importGSheet: async (url, mapping, opts = {}) => (await api.post("/admin/leads/import-gsheet", { url, mapping, ...opts })).data,
  uploadSdrCsv: async (csvText) => (await api.post("/admin/users/upload", { csv_text: csvText })).data,
};

// Sandbox Data Refresh (Control Center Data section) — endpoints traced from
// frontend/js/views/settings.js `_initSandboxTab()` and confirmed live in
// backend/routes/sandbox_routes.py (router prefix /api/admin/sandbox).
export const SandboxService = {
  getEnv: async () => (await api.get("/admin/sandbox/env")).data,
  getTokenStatus: async () => (await api.get("/admin/sandbox/token/status")).data,
  generateToken: async () => (await api.post("/admin/sandbox/token/generate")).data,
  revokeToken: async () => (await api.delete("/admin/sandbox/token")).data,
  getConnection: async () => (await api.get("/admin/sandbox/connection")).data,
  saveConnection: async (prodUrl, token) => (await api.post("/admin/sandbox/connection", { prod_url: prodUrl, token })).data,
  clearConnection: async () => (await api.delete("/admin/sandbox/connection")).data,
  refresh: async () => (await api.post("/admin/sandbox/refresh", { confirm: "REFRESH" })).data,
  getRefreshStatus: async () => (await api.get("/admin/sandbox/status")).data,
  generateSynthetic: async (count) => (await api.post("/admin/sandbox/generate", { count, confirm: "GENERATE" })).data,
  clearStagingData: async () => (await api.post("/admin/sandbox/clear", { confirm: "CLEAR" })).data,
};

// Calls
export const CallsService = {
  getActivityFeed: async (params = {}) => (await api.get("/leads/activity-feed", { params })).data,
  getSdrSummary: async () => (await api.get("/sdr/call-summary")).data,
  getSdrPerformance: async (sdrId, params = {}) => (await api.get(`/sdr-performance/${sdrId}`, { params })).data,
  // Pre-signed provider recording URLs expire — always re-fetch a fresh one before playback.
  getRecordingUrl: async (callId) => (await api.get(`/calls/${callId}/recording-url`)).data,
  getCallOutcomes: async () => (await api.get("/call-outcomes")).data,
  // Alternate Messenger dialer engine — ported from frontend/js/api.js, same endpoints/payloads.
  disconnect: async (callId) => (await api.post("/calls/disconnect", { call_id: callId })).data,
  action: async (callId, action, roomName = null) =>
    (await api.post(`/calls/${callId}/action`, { action, ...(roomName && { room_name: roomName }) })).data,
  getStatus: async (callId) => (await api.get(`/calls/${callId}/status`)).data,
  forceEnd: async (callId) => (await api.post("/calls/force-end", { call_id: callId })).data,
  getMyActive: async () => {
    try {
      return (await api.get("/calls/my-active")).data;
    } catch {
      return { active: false };
    }
  },
  // Power Dialer's stats/history panel — direct port of what
  // frontend/js/views/my_calls.js computed server-side (now retired).
  getTodayCalls: async (date = null) =>
    (await api.get("/my/today-calls", { params: date ? { date } : {} })).data,
};

// AI Research — Control Center Automation section. LLM provider/key/model,
// the custom research prompt, and the research gate toggle all live on the
// same admin/sync-settings object (misnomer inherited from legacy
// settings_sync.js's "sync-settings" endpoint) — reuse
// SettingsService.getSyncSettings/patchSyncSettings for those rather than
// duplicating them here. Bulk Research pre-population is the one genuinely
// new surface (ported from frontend/js/views/settings_ai_dialer.js, no
// prior api.js coverage existed): GET/POST /api/admin/bulk-research.
export const AiResearchService = {
  getBulkResearchStatus: async () => (await api.get("/admin/bulk-research/status")).data,
  startBulkResearch: async (podId) =>
    (await api.post(`/admin/bulk-research${podId ? `?pod_id=${encodeURIComponent(podId)}` : ""}`)).data,
};

// Activity Monitor — Calls / Email / Messages tabs, one shared response shape
// ({items, total, page, per_page, pages, sdrs, summary}) per channel.
export const ActivityMonitorService = {
  // opts (e.g. {timeout}) let CSV export override the shared 10s cap for its
  // much heavier per_page=2000 request without affecting normal pagination.
  getCallLogs: async (params = {}, opts = {}) => (await api.get("/admin/call-logs", { params, ...opts })).data,
  getEmailLogs: async (params = {}, opts = {}) => (await api.get("/admin/email-logs", { params, ...opts })).data,
  getMessageLogs: async (params = {}, opts = {}) => (await api.get("/admin/message-logs", { params, ...opts })).data,
};

// Instantly team inbox + report (v13.8.0). 403 for CSM.
export const InstantlyInboxService = {
  replies: async (params = {}) => (await api.get("/instantly/replies", { params })).data,
  filters: async () => (await api.get("/instantly/filters")).data,
  reply: async (id) => (await api.get(`/instantly/replies/${id}`)).data,
  markRead: async (id, read, implicit = false) => (await api.patch(`/instantly/replies/${id}/read`, { read, implicit })).data,
  report: async (params = {}) => (await api.get("/instantly/report", { params })).data,
  summary: async () => (await api.get("/instantly/summary")).data,
};

// Alternate Messenger Conversations (WhatsApp/SMS) — every route is lead-scoped and
// ownership-checked server-side (lead_id + phone must belong to the caller).
// `signal` (an AbortController signal) is optional on the GETs that get
// re-issued as a lead/channel changes or on a polling interval — lets callers
// cancel an in-flight request instead of applying a stale result.
export const ConversationsService = {
  getStatus: async () => (await api.get("/conversations/status")).data,
  getSessionState: async (leadId, phone, senderId, channel = "whatsapp", { signal } = {}) =>
    (await api.get("/conversations/session-state", { params: { lead_id: leadId, phone, sender_id: senderId, channel }, signal })).data,
  getTemplates: async (params = {}) => (await api.get("/conversations/templates", { params })).data,
  getMessages: async (leadId, conversationId, params = {}, { signal } = {}) =>
    (await api.get(`/conversations/${conversationId}/messages`, { params: { lead_id: leadId, ...params }, signal })).data,
  send: async (body) => (await api.post("/conversations/send", body)).data,
  list: async (leadId, phone, params = {}, { signal } = {}) =>
    (await api.get("/conversations", { params: { lead_id: leadId, phone, ...params }, signal })).data,
  getEmbedUrl: async (view) => (await api.get("/conversations/embed-url", { params: { view } })).data,
};

// Feedback
export const FeedbackService = {
  submit: async (type, message) => (await api.post("/admin/feedback", { type, message })).data,
  getAll: async (params = {}) => (await api.get("/admin/feedback", { params })).data,
  patchStatus: async (feedbackId, status) => (await api.patch(`/admin/feedback/${feedbackId}`, { status })).data,
};

// Tasks
export const TasksService = {
  getPending: async () => (await api.get("/my/tasks/pending")).data,
  dismiss: async (taskId) => (await api.patch(`/my/tasks/${taskId}/dismiss`)).data,
  // body: { minutes } or { until: ISO date-time } (v13.7.0, up to 90 days).
  snooze: async (taskId, body) => (await api.patch(`/my/tasks/${taskId}/snooze`, body)).data,
  // The "My Tasks" page — every task across every lead, not just what's due
  // right now (getPending above). status: 'open' | 'done' | 'all'.
  getMine: async (status = 'open') => (await api.get("/my/tasks", { params: { status } })).data,
};

// Auth
export const AuthService = {
  getMe: async () => (await api.get("/auth/me")).data,
};

// Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md)
export const SalesJourneyService = {
  list: async () => (await api.get("/journeys")).data,
  get: async (journeyId) => (await api.get(`/journeys/${journeyId}`)).data,
  // Mailboxes an Instantly step may send from — only the ones a Super Admin enabled.
  getInstantlySendingAccounts: async () => (await api.get("/instantly/sending-accounts")).data,
  create: async (name, podId) => (await api.post("/journeys", { name, pod_id: podId || null })).data,
  // v13.0.0 — copy steps + settings into a new draft you own (e.g. Cadence 2 from Cadence 1).
  duplicate: async (journeyId, name) => (await api.post(`/journeys/${journeyId}/duplicate`, name ? { name } : {})).data,
  updateSettings: async (journeyId, fields) => (await api.patch(`/journeys/${journeyId}`, fields)).data,
  generateEmail: async (prompt) => (await api.post(`/journeys/ai/generate-email`, { prompt })).data,
  saveDraft: async (journeyId, versionId, graphDefinition, expectedUpdatedAt) =>
    (await api.put(`/journeys/${journeyId}/versions/${versionId}`, {
      graph_definition: graphDefinition,
      expected_updated_at: expectedUpdatedAt,
    })).data,
  publish: async (journeyId) => (await api.post(`/journeys/${journeyId}/publish`)).data,
  enroll: async (journeyId, leadIds) => (await api.post(`/journeys/${journeyId}/enroll`, { lead_ids: leadIds })).data,
  getEnrollmentStatus: async (journeyId, leadId) =>
    (await api.get(`/journeys/${journeyId}/enrollments/${leadId}`)).data,
  getStats: async (journeyId) => (await api.get(`/journeys/${journeyId}/stats`)).data,
  getStatsBulk: async (journeyIds) =>
    (await api.get(`/journeys/stats-bulk`, { params: { ids: journeyIds.join(',') } })).data,
  getStatsByRep: async (journeyId) => (await api.get(`/journeys/${journeyId}/stats/by-rep`)).data,
  getStatsTrend: async (journeyId, bucket = 'week') =>
    (await api.get(`/journeys/${journeyId}/stats/trend`, { params: { bucket } })).data,
  archive: async (journeyId, confirmExitCount) =>
    (await api.post(`/journeys/${journeyId}/archive`, { confirm_exit_count: confirmExitCount })).data,
  pause: async (journeyId) => (await api.post(`/journeys/${journeyId}/pause`)).data,
  resume: async (journeyId) => (await api.post(`/journeys/${journeyId}/resume`)).data,
  getFailedEnrollments: async (journeyId) => (await api.get(`/journeys/${journeyId}/failed-enrollments`)).data,
  // Backlog fix: enroll-time mailbox warning — called before confirming enroll.
  checkEnrollmentMailboxes: async (journeyId, leadIds) =>
    (await api.get(`/journeys/${journeyId}/enroll-check`, { params: { lead_ids: leadIds.join(',') } })).data,
  // Feedback #8/#9: per-lead roster (who's enrolled, current step, how they ended up).
  getEnrollmentRoster: async (journeyId, offset = 0) =>
    (await api.get(`/journeys/${journeyId}/enrollments`, { params: { offset } })).data,
  // Feedback #10: raw downloadable report — same authenticated-blob pattern
  // as exportLeadsBySdr/exportSfLogsCsv above (a bare href can't carry the bearer token).
  exportEnrollmentsCsv: async (journeyId) => {
    const res = await api.get(`/journeys/${journeyId}/enrollments/export`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers['content-disposition'] || '';
    const match = cd.match(/filename[^;=\n]*=["']?([^"';\n]+)/);
    a.download = match?.[1] || `cadence-export-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  getActivity: async (journeyId) => (await api.get(`/journeys/${journeyId}/activity`)).data,
  retryEnrollment: async (enrollmentId) => (await api.post(`/journeys/enrollments/${enrollmentId}/retry`)).data,
  skipEnrollment: async (enrollmentId) => (await api.post(`/journeys/enrollments/${enrollmentId}/skip`)).data,
  removeEnrollment: async (enrollmentId) => (await api.post(`/journeys/enrollments/${enrollmentId}/remove`)).data,
};

// Email Campaigns (Sales Tools — bulk email bursts, see
// .claude/plans/i-was-working-on-idempotent-ritchie.md)
export const EmailCampaignService = {
  create: async ({ name, subject, body, templateId, leadIds, schedule, includeSignature }) =>
    (await api.post("/email-campaigns", {
      name, subject, body, template_id: templateId, lead_ids: leadIds, schedule,
      include_signature: includeSignature,
    })).data,
  list: async ({ status, page = 1, perPage = 20, mine, createdBy, sortBy } = {}) =>
    (await api.get("/email-campaigns", {
      params: { status: status || undefined, page, per_page: perPage, mine: mine || undefined, created_by: createdBy || undefined, sort_by: sortBy || undefined },
    })).data,
  get: async (campaignId) => (await api.get(`/email-campaigns/${campaignId}`)).data,
  rename: async (campaignId, name) => (await api.patch(`/email-campaigns/${campaignId}`, { name })).data,
};

// CSM Portal (Phase 2 — see .claude/plans/i-was-working-on-idempotent-ritchie.md).
// Backend scopes /portfolio and /digest to the caller's own accounts for a
// CSM automatically; `csmId` only means anything for a Super Admin filtering
// to one CSM's book.
export const CsmPortalService = {
  getPortfolio: async ({ sort, csmId } = {}) =>
    (await api.get('/csm-portal/portfolio', { params: { sort: sort || undefined, csm_id: csmId || undefined } })).data,
  getAccount: async (accountId) => (await api.get(`/csm-portal/accounts/${accountId}`)).data,
  logTouch: async (accountId, note) => (await api.post(`/csm-portal/accounts/${accountId}/touches`, { note })).data,
  championDeparted: async (accountId) => (await api.post(`/csm-portal/accounts/${accountId}/champion-departed`)).data,
  setHealthOverride: async (accountId, tier, reason) =>
    (await api.post(`/csm-portal/accounts/${accountId}/health-override`, { tier, reason })).data,
  createRenewalOpportunity: async (accountId, { name, amount, closeDate } = {}) =>
    (await api.post(`/csm-portal/accounts/${accountId}/renewal-opportunity`, {
      name: name || undefined, amount: amount || undefined, close_date: closeDate || undefined,
    })).data,
  // Lets a CSM progress/close their own renewal without a hand-off to an AE
  // or a trip to Salesforce — same core logic as AEPipelineService below,
  // scoped by account instead of by opportunity ownership.
  updateOpportunity: async (accountId, opportunityId, { stageName, closeDate } = {}) =>
    (await api.patch(`/csm-portal/accounts/${accountId}/opportunities/${opportunityId}`, {
      stage_name: stageName ?? undefined, close_date: closeDate || undefined,
    })).data,
  closeOpportunity: async (accountId, opportunityId, payload) =>
    (await api.post(`/csm-portal/accounts/${accountId}/opportunities/${opportunityId}/close`, payload)).data,
  logOpportunityCall: async (accountId, opportunityId, outcome, notes) =>
    (await api.post(`/csm-portal/accounts/${accountId}/opportunities/${opportunityId}/calls`, { outcome, notes: notes || null })).data,
  getStageOptions: async () => {
    try { return (await api.get("/csm-portal/stage-options")).data; } catch { return []; }
  },
  getCloseFieldOptions: async () => {
    try { return (await api.get("/csm-portal/close-field-options")).data; } catch { return { standard_product_names: [], lost_reasons: [] }; }
  },
  bulkAssign: async (accountIds, csmId) =>
    (await api.post('/csm-portal/accounts/assign', { account_ids: accountIds, csm_id: csmId })).data,
  getDigest: async ({ csmId } = {}) =>
    (await api.get('/csm-portal/digest', { params: { csm_id: csmId || undefined } })).data,
  setStakeholderRole: async (accountId, stakeholderId, role) =>
    (await api.patch(`/csm-portal/accounts/${accountId}/stakeholders/${stakeholderId}`, { role })).data,
  createMilestone: async (accountId, body) =>
    (await api.post(`/csm-portal/accounts/${accountId}/milestones`, body)).data,
  updateMilestone: async (accountId, milestoneId, body) =>
    (await api.patch(`/csm-portal/accounts/${accountId}/milestones/${milestoneId}`, body)).data,
};

export const EmailTemplateService = {
  list: async () => (await api.get("/email-templates")).data,
  create: async (name, subject, body) => (await api.post("/email-templates", { name, subject, body })).data,
  update: async (templateId, name, subject, body) => (await api.put(`/email-templates/${templateId}`, { name, subject, body })).data,
  delete: async (templateId) => (await api.delete(`/email-templates/${templateId}`)).data,
};

// AE Pipeline (Phase 1 — AE/CSM expansion, see
// .claude/plans/i-was-working-on-idempotent-ritchie.md). Reads swallow to a
// safe empty default like DailyDigestService/LeaderboardService above; the
// two write actions (logCall, closeDeal) let errors propagate so the form
// can show the backend's actual message (e.g. the 409 on a locked brief).
export const AEPipelineService = {
  list: async () => {
    try { return (await api.get("/ae-pipeline/opportunities")).data; } catch { return []; }
  },
  get: async (opportunityId) => (await api.get(`/ae-pipeline/opportunities/${opportunityId}`)).data,
  logCall: async (opportunityId, outcome, notes) =>
    (await api.post(`/ae-pipeline/opportunities/${opportunityId}/calls`, { outcome, notes: notes || null })).data,
  closeDeal: async (opportunityId, payload) =>
    (await api.post(`/ae-pipeline/opportunities/${opportunityId}/close`, payload)).data,
  updateOpportunity: async (opportunityId, { stageName, closeDate } = {}) =>
    (await api.patch(`/ae-pipeline/opportunities/${opportunityId}`, {
      stage_name: stageName ?? undefined, close_date: closeDate || undefined,
    })).data,
  // This org's real Opportunity.StageName picklist — [] when Salesforce
  // isn't configured, in which case the caller falls back to free text.
  getStageOptions: async () => {
    try { return (await api.get("/ae-pipeline/opportunities/stage-options")).data; } catch { return []; }
  },
  // This org's real Standard_Product_Name__c picklist — live finding,
  // 2026-09-15: required by an SF validation rule before any Closed-stage
  // push, alongside a free-text invoice number.
  getCloseFieldOptions: async () => {
    try { return (await api.get("/ae-pipeline/opportunities/close-field-options")).data; } catch { return { standard_product_names: [], lost_reasons: [] }; }
  },
};
