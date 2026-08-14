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

api.interceptors.response.use((response) => response, (error) => {
  // Do NOT call logout() here — in IIFE mode window.location.href = '/login'
  // would redirect the entire host CRM page.
  return Promise.reject(error);
});

export default api;

// Leads
export const LeadsService = {
  getLeads: async (params = {}) => {
    const res = await api.get("/leads", { params: { per_page: 100, ...params } });
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
  deleteLead: async (id) => (await api.delete(`/leads/${id}`)).data,
  createLead: async (payload) => (await api.post("/leads", payload)).data,
  addNote: async (leadId, content) => (await api.post(`/leads/${leadId}/notes`, { content })).data,
  deleteNote: async (leadId, noteId) => (await api.delete(`/leads/${leadId}/notes/${noteId}`)).data,
  logCall: async (leadId, callData) => (await api.post(`/leads/${leadId}/calls`, callData)).data,
  getCallsForLead: async (leadId) => (await api.get(`/leads/${leadId}/calls`)).data,
  getNotes: async (leadId) => (await api.get(`/leads/${leadId}/notes`)).data,
  getStatusHistory: async (leadId) => (await api.get(`/leads/${leadId}/status-history`)).data,
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
  updateCallOutcome: async (callId, outcome, notes) => (await api.patch(`/calls/${callId}/outcome`, { outcome, notes })).data,
  triggerAiResearch: async (leadId) => (await api.post(`/leads/${leadId}/ai-research`)).data,
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
  getUsers: async () => (await api.get("/admin/users")).data,
  createUser: async (payload) => (await api.post("/admin/users", payload)).data,
  deleteUser: async (userId) => (await api.delete(`/admin/users/${userId}`)).data,
  patchUserRole: async (userId, role) => (await api.patch(`/admin/users/${userId}/role`, { role })).data,
  patchUserAccess: async (userId, action) => (await api.patch(`/admin/users/${userId}/access`, { action })).data,
  patchUserSettings: async (userId, settings) => (await api.patch(`/admin/users/${userId}/settings`, settings)).data,
  getUserToken: async (userId) => (await api.get(`/admin/users/${userId}/token`)).data,
  getSfLogs: async (params = {}) => (await api.get("/admin/sf-logs", { params })).data,
  getSfLogDetail: async (logId) => (await api.get(`/admin/sf-logs/${logId}`)).data,
  exportSfLogsCsvUrl: (params = {}) => {
    const qs = new URLSearchParams(params);
    return `${API_BASE}/api/admin/sf-logs/export?${qs}`;
  },
  getLoginLogs: async (params = {}) => (await api.get("/admin/login-logs", { params })).data,
  getActivityFeed: async (params = {}) => (await api.get("/leads/activity-feed", { params })).data,
  impersonate: async (userId) => (await api.post(`/admin/impersonate/${userId}`)).data,
};

// Assignments
export const AssignmentsService = {
  getUnassigned: async () => (await api.get("/admin/leads/unassigned")).data,
  getAssigned: async () => (await api.get("/admin/leads/assigned")).data,
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

// Disqualify Requests — company-scoped maker/checker flow (Leads redesign UI;
// backend already existed: routes/disqualify_routes.py).
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
      return (await api.get(`/admin/analytics/funnel?${_analyticsQs(filters)}`)).data;
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



// Search
export const SearchService = {
  global: async (q) => (await api.get("/search", { params: { q } })).data,
};

// Settings
export const SettingsService = {
  getSfStatus: async () => (await api.get("/admin/sf/status")).data,
  getSfConnectionInfo: async () => (await api.get("/admin/sf-connection-info")).data,
  connectSf: async (creds) => (await api.post("/admin/sf/connect", creds)).data,
  disconnectSf: async () => (await api.post("/admin/sf/disconnect")).data,
  reconnectSf: async () => (await api.post("/admin/sf/reconnect")).data,
  syncSf: async () => (await api.post("/admin/sf/reconnect")).data,
  getSyncSettings: async () => (await api.get("/admin/sync-settings")).data,
  patchSyncSettings: async (fields) => (await api.patch("/admin/sync-settings", fields)).data,
  getRecordTypes: async () => { try { return (await api.get("/admin/sf/status")).data; } catch { return {}; } },
  getNylasConfig: async () => (await api.get("/email/config")).data,
  saveNylasConfig: async (config) => (await api.post("/email/config", config)).data,
};

// Dialer
export const DialerService = {
  getStatus: async () => (await api.get("/dialer/status")).data,
  getConfig: async () => (await api.get("/dialer/config")).data,
  saveConfig: async (data) => (await api.patch("/dialer/config", data)).data,
  testConnection: async () => (await api.post("/dialer/test")).data,
  getUsers: async () => (await api.get("/dialer/users")).data,
  getNumbers: async () => (await api.get("/dialer/numbers")).data,
  startCall: async (leadId, phoneNumber, callMode) => (await api.post("/calls/start", { lead_id: leadId, phone_number: phoneNumber, ...(callMode && { call_mode: callMode }) })).data,
  // Power Dialer queue-status — server-side per-lead progress (survives reload).
  getQueueStatus: async (leadIds) => (await api.get("/dialer/queue-status", { params: { lead_ids: leadIds.join(",") } })).data,
  setQueueStatus: async (leadId, status, skipReason) =>
    (await api.post("/dialer/queue-status", { lead_id: leadId, status, skip_reason: skipReason })).data,
  clearQueueStatus: async (leadId) => (await api.delete(`/dialer/queue-status/${leadId}`)).data,
  getSkipSummary: async (days = 7) => (await api.get("/admin/dialer/skip-summary", { params: { days } })).data,
};

// Pods
export const PodsService = {
  getAll: async () => (await api.get("/pods")).data,
  create: async (name, adminId) => (await api.post("/pods", { name, admin_id: adminId })).data,
  update: async (podId, fields) => (await api.patch(`/pods/${podId}`, fields)).data,
  remove: async (podId) => (await api.delete(`/pods/${podId}`)).data,
  addMember: async (podId, userId) => (await api.post(`/pods/${podId}/members`, { user_id: userId })).data,
  removeMember: async (podId, userId) => (await api.delete(`/pods/${podId}/members/${userId}`)).data,
  assignLeads: async (podId, leadIds) => (await api.post(`/pods/${podId}/assign-leads`, { lead_ids: leadIds })).data,
};

// Uploads
export const UploadService = {
  getLogs: async () => (await api.get("/admin/leads/upload-logs")).data,
  getBatchMetrics: async (params = {}) => { try { return (await api.get("/admin/leads/upload-logs", { params })).data; } catch { return []; } },
  getBatchDetail: async (logId, params = {}) => { try { return (await api.get("/admin/leads/upload-logs", { params: { log_id: logId, ...params } })).data; } catch { return {}; } },
  previewCsv: async (csvText) => (await api.post("/admin/leads/upload-preview", { csv_text: csvText })).data,
  uploadSheet: async (csvText, mapping, opts = {}) => (await api.post("/admin/leads/upload-sheet", { csv_text: csvText, mapping, ...opts })).data,
  previewGSheet: async (url) => (await api.get("/admin/leads/upload-gsheet", { params: { url } })).data,
  importGSheet: async (url, mapping, opts = {}) => (await api.post("/admin/leads/import-gsheet", { url, mapping, ...opts })).data,
  uploadSdrCsv: async (csvText) => (await api.post("/admin/users/upload", { csv_text: csvText })).data,
};

// Calls
export const CallsService = {
  getActivityFeed: async (params = {}) => (await api.get("/leads/activity-feed", { params })).data,
  getSdrSummary: async () => (await api.get("/sdr/call-summary")).data,
  getSdrPerformance: async (sdrId, params = {}) => (await api.get(`/sdr-performance/${sdrId}`, { params })).data,
  // Pre-signed provider recording URLs expire — always re-fetch a fresh one before playback.
  getRecordingUrl: async (callId) => (await api.get(`/calls/${callId}/recording-url`)).data,
  getCallOutcomes: async () => (await api.get("/call-outcomes")).data,
  // RCM dialer engine — ported from frontend/js/api.js, same endpoints/payloads.
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

// RCM Conversations (WhatsApp/SMS) — every route is lead-scoped and
// ownership-checked server-side (lead_id + phone must belong to the caller).
// `signal` (an AbortController signal) is optional on the GETs that get
// re-issued as a lead/channel changes or on a polling interval — lets callers
// cancel an in-flight request instead of applying a stale result.
export const ConversationsService = {
  getSessionState: async (leadId, phone, senderId, channel = "whatsapp", { signal } = {}) =>
    (await api.get("/conversations/session-state", { params: { lead_id: leadId, phone, sender_id: senderId, channel }, signal })).data,
  getTemplates: async (params = {}) => (await api.get("/conversations/templates", { params })).data,
  getMessages: async (leadId, conversationId, params = {}, { signal } = {}) =>
    (await api.get(`/conversations/${conversationId}/messages`, { params: { lead_id: leadId, ...params }, signal })).data,
  send: async (body) => (await api.post("/conversations/send", body)).data,
  list: async (leadId, phone, params = {}, { signal } = {}) =>
    (await api.get("/conversations", { params: { lead_id: leadId, phone, ...params }, signal })).data,
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
  snooze: async (taskId, minutes = 15) => (await api.patch(`/my/tasks/${taskId}/snooze`, { minutes })).data,
};

// Auth
export const AuthService = {
  getMe: async () => (await api.get("/auth/me")).data,
};

// Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md)
export const SalesJourneyService = {
  list: async () => (await api.get("/journeys")).data,
  get: async (journeyId) => (await api.get(`/journeys/${journeyId}`)).data,
  create: async (name, podId) => (await api.post("/journeys", { name, pod_id: podId || null })).data,
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
  archive: async (journeyId, confirmExitCount) =>
    (await api.post(`/journeys/${journeyId}/archive`, { confirm_exit_count: confirmExitCount })).data,
  pause: async (journeyId) => (await api.post(`/journeys/${journeyId}/pause`)).data,
  resume: async (journeyId) => (await api.post(`/journeys/${journeyId}/resume`)).data,
  getFailedEnrollments: async (journeyId) => (await api.get(`/journeys/${journeyId}/failed-enrollments`)).data,
  getActivity: async (journeyId) => (await api.get(`/journeys/${journeyId}/activity`)).data,
  retryEnrollment: async (enrollmentId) => (await api.post(`/journeys/enrollments/${enrollmentId}/retry`)).data,
  skipEnrollment: async (enrollmentId) => (await api.post(`/journeys/enrollments/${enrollmentId}/skip`)).data,
};
