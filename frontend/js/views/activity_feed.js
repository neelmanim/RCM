// ── views/activity_feed.js — Unified Activity Feed (Admin view) ───────────────
import { fetchAdminActivityFeed, fetchAdminUsers, fetchPods } from '../api.js';
import { showLoader, showToast, ensureUTC, openRecordingFresh, downloadRecordingFresh, parseTranscript, escapeHtml as _esc } from '../utils.js';
import { currentUser } from '../auth.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _state = {
    page: 1,
    per_page: 25,
    type: '',
    sdr: '',
    pod_id: '',
    outcome: '',
    date_range: '7d',
    search: '',
    global_view: false,
};
let _stats = {};
let _sdrs = [];
let _pods = [];
let _searchTimeout;
let _container;

// ── Pod Admin helpers ─────────────────────────────────────────────────────────
function _isPodAdmin() { return currentUser?.role === 'Pod Admin'; }
function _getAfGlobalView() {
    try { return JSON.parse(sessionStorage.getItem('activity_view_state'))?.globalView === true; } catch { return false; }
}
function _setAfGlobalView(val) {
    sessionStorage.setItem('activity_view_state', JSON.stringify({ globalView: val }));
    _state.global_view = val;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────
const OUTCOME_COLORS = {
    'Meeting Scheduled':  'green',
    'Meeting Confirmed':  'green',
    'Call Back Later':    'yellow',
    'Text Me':           'yellow',
    'No Answer':         'gray',
    'Left Voicemail':    'gray',
    'Wrong Number':      'gray',
    'Not Interested':    'red',
    'Unreachable':       'red',
    'Not the Right Person': 'gray',
    'Referred Someone Else': 'gray',
    'Email Sent':        'blue',
    'Email Received':    'blue',
    'Research Complete':  'purple',
};
const STATUS_COLORS = {
    'Lead Assigned': 'blue', 'Research': 'purple', 'Calling': 'yellow',
    'Meeting Scheduled': 'green', '1st Discovery Meeting': 'purple',
    'Discovery Complete': 'purple', 'Demo Scheduled': 'blue',
    'Demo Done': 'green', 'Completed': 'green',
    'Disqualified': 'red', 'Working': 'yellow', 'New': 'blue',
};
function badge(text, color) {
    const c = color || OUTCOME_COLORS[text] || 'gray';
    return `<span class="af-badge af-badge-${c}">${text}</span>`;
}
function statusBadge(status) {
    return badge(status, STATUS_COLORS[status] || 'gray');
}

// ── Format helpers ────────────────────────────────────────────────────────────
function _timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(ensureUTC(iso));
    const now = new Date();
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
}
function _formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(ensureUTC(iso));
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const isYesterday = d.toDateString() === new Date(now - 86400000).toDateString();
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (isToday) return `Today, ${time}`;
    if (isYesterday) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}
function _formatDuration(seconds) {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function _truncate(text, len = 60) {
    if (!text) return '';
    return text.length > len ? text.substring(0, len) + '…' : text;
}

// ── Type icon ─────────────────────────────────────────────────────────────────
const TYPE_ICONS = {
    call: { emoji: '📞', cls: 'af-icon-call' },
    email: { emoji: '📧', cls: 'af-icon-email' },
    status: { emoji: '🔄', cls: 'af-icon-status' },
    research: { emoji: '🔬', cls: 'af-icon-research' },
};

// ── Main render ───────────────────────────────────────────────────────────────
export async function renderActivityFeed(container, navigateToLead) {
    _container = container;
    _state.global_view = _getAfGlobalView();
    showLoader(container);
    await _loadAndRender(navigateToLead);
}

async function _loadAndRender(navigateToLead) {
    try {
        const result = await fetchAdminActivityFeed(_state);
        _stats = result.stats || {};
        _renderView(result, navigateToLead);
    } catch (err) {
        _container.innerHTML = `<div style="padding:60px;text-align:center;"><h3>⚠️ Failed to load activity feed</h3><p style="color:var(--text-muted);margin-top:8px;">${err.message}</p></div>`;
    }
}

function _renderView(result, navigateToLead) {
    const { data, total, page, per_page, pages, stats } = result;
    const tc = stats.type_counts || {};

    _container.innerHTML = `
<style>
/* ── Activity Feed Styles ──────────────────────────────────── */
.af-page { max-width: 1400px; margin: 0 auto; }

.af-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.af-header h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-color, #0f172a); }
.af-header p { color: var(--text-muted, #64748b); font-size: 0.875rem; margin-top: 2px; }
.af-export-btn { padding: 8px 18px; background: var(--surface-color, #fff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.15s; font-family: inherit; }
.af-export-btn:hover { background: #f8fafc; border-color: #cbd5e1; }

/* Stats */
.af-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
.af-stat { background: var(--surface-color, #fff); border-radius: 12px; padding: 18px 20px; border: 1px solid var(--border-color, #e2e8f0); position: relative; overflow: hidden; }
.af-stat::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.af-stat.c1::before { background: linear-gradient(90deg, #818cf8, #6366f1); }
.af-stat.c2::before { background: linear-gradient(90deg, #34d399, #10b981); }
.af-stat.c3::before { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
.af-stat.c4::before { background: linear-gradient(90deg, #f472b6, #ec4899); }
.af-stat-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #64748b); margin-bottom: 4px; }
.af-stat-num { font-size: 1.65rem; font-weight: 800; color: var(--text-color, #0f172a); letter-spacing: -0.03em; }

/* Type tabs */
.af-tabs { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.af-tab { padding: 7px 16px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color, #e2e8f0); background: var(--surface-color, #fff); color: var(--text-muted, #64748b); transition: all 0.15s; display: flex; align-items: center; gap: 6px; font-family: inherit; }
.af-tab:hover { border-color: #cbd5e1; color: #334155; }
.af-tab.active { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.af-tab .af-count { background: rgba(0,0,0,0.08); padding: 1px 7px; border-radius: 10px; font-size: 0.7rem; }
.af-tab.active .af-count { background: rgba(255,255,255,0.25); }

/* Filters */
.af-filters { display: flex; gap: 12px; margin-bottom: 18px; align-items: center; flex-wrap: wrap; }
.af-select { padding: 7px 12px; border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; background: var(--surface-color, #fff); font-size: 0.8rem; color: #334155; outline: none; min-width: 140px; cursor: pointer; font-family: inherit; }
.af-select:focus { border-color: #818cf8; }
.af-search { padding: 7px 12px; border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; background: var(--surface-color, #fff); font-size: 0.8rem; outline: none; width: 240px; font-family: inherit; }
.af-search:focus { border-color: #818cf8; }
.af-spacer { flex: 1; }

/* Table */
.af-table { width: 100%; background: var(--surface-color, #fff); border-radius: 12px; border: 1px solid var(--border-color, #e2e8f0); overflow: hidden; border-collapse: separate; border-spacing: 0; }
.af-table thead th { background: #f8fafc; padding: 12px 14px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted, #64748b); text-align: left; border-bottom: 1px solid var(--border-color, #e2e8f0); position: sticky; top: 0; z-index: 2; }
.af-table tbody tr { transition: background 0.1s; cursor: pointer; }
.af-table tbody tr:hover { background: #f8fafc; }
.af-table tbody tr.af-expanded { background: #f8fafc; }
.af-table tbody td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; font-size: 0.85rem; vertical-align: middle; }
.af-table tbody tr:last-child td { border-bottom: none; }

/* Type icon */
.af-type-icon { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.9rem; flex-shrink: 0; }
.af-icon-call { background: #ede9fe; }
.af-icon-email { background: #dbeafe; }
.af-icon-status { background: #d1fae5; }
.af-icon-research { background: #fef3c7; }

/* Lead cell */
.af-lead-name { font-weight: 600; color: var(--text-color, #0f172a); }
.af-lead-name:hover { color: #4f46e5; text-decoration: underline; }
.af-lead-title { font-size: 0.72rem; color: var(--text-muted, #94a3b8); margin-top: 1px; }

/* Badges */
.af-badge { padding: 3px 10px; border-radius: 20px; font-size: 0.7rem; font-weight: 600; display: inline-block; white-space: nowrap; }
.af-badge-green { background: #d1fae5; color: #065f46; }
.af-badge-yellow { background: #fef3c7; color: #92400e; }
.af-badge-gray { background: #f1f5f9; color: #475569; }
.af-badge-red { background: #fee2e2; color: #991b1b; }
.af-badge-blue { background: #dbeafe; color: #1e40af; }
.af-badge-purple { background: #ede9fe; color: #5b21b6; }

/* Notes preview in table */
.af-notes-preview { max-width: 280px; white-space: normal; overflow: visible; text-overflow: unset; word-break: break-word; display: block; color: #475569; font-size: 0.8rem; line-height: 1.45; }
.af-notes-preview.empty { color: #cbd5e1; font-style: italic; }

/* Expand chevron */
.af-expand-btn { width: 26px; height: 26px; border: none; background: transparent; cursor: pointer; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 0.75rem; transition: all 0.15s; }
.af-expand-btn:hover { background: #f1f5f9; color: #334155; }
.af-expand-btn.open { transform: rotate(90deg); color: #4f46e5; background: #ede9fe; }

/* Detail row */
.af-detail-row { display: none; }
.af-detail-row.open { display: table-row; }
.af-detail-row td { padding: 0 !important; border-bottom: 1px solid var(--border-color, #e2e8f0) !important; background: #f8fafc; }

.af-detail-panel { padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.af-detail-panel.three-col { grid-template-columns: 1fr 1fr 1fr; }

.af-d-card { background: var(--surface-color, #fff); border-radius: 10px; padding: 16px; border: 1px solid var(--border-color, #e2e8f0); }
.af-d-card h5 { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.af-d-card h5.purple { color: #7c3aed; }
.af-d-card h5.blue   { color: #2563eb; }
.af-d-card h5.green  { color: #059669; }
.af-d-card h5.amber  { color: #d97706; }
.af-d-card h5.slate  { color: #475569; }
.af-d-card h5.indigo { color: #4f46e5; }
.af-d-card p { font-size: 0.82rem; color: #334155; line-height: 1.55; }
.af-d-card .af-meta { font-size: 0.75rem; color: #94a3b8; margin-top: 6px; }
.af-d-card.full { grid-column: 1 / -1; }

/* Audio player */
.af-audio-player { display: flex; align-items: center; gap: 10px; background: #f1f5f9; border-radius: 8px; padding: 10px 14px; margin-top: 8px; }
.af-play-btn a { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: #4f46e5; color: #fff; text-decoration: none; font-size: 0.8rem; flex-shrink: 0; }
.af-audio-time { font-size: 0.75rem; color: #64748b; font-weight: 600; }

/* Transcript */
.af-transcript-box { background: #f8fafc; border-radius: 8px; padding: 12px; margin-top: 8px; max-height: 180px; overflow-y: auto; font-size: 0.8rem; color: #475569; line-height: 1.6; white-space: pre-wrap; border: 1px solid #e2e8f0; }

/* Email detail sections */
.af-email-header { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 0.82rem; margin-bottom: 12px; }
.af-email-header .label { color: #94a3b8; font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
.af-email-header .value { color: #334155; }
.af-email-body { background: #f8fafc; border-radius: 8px; padding: 14px; border: 1px solid #e2e8f0; font-size: 0.82rem; color: #334155; line-height: 1.6; max-height: 200px; overflow-y: auto; }
.af-email-stats { display: flex; gap: 16px; margin-top: 10px; font-size: 0.75rem; color: #64748b; }
.af-email-stats .stat { display: flex; align-items: center; gap: 4px; }

/* Indicator dots */
.af-has-recording { display: inline-flex; align-items: center; gap: 4px; font-size: 0.7rem; color: #059669; font-weight: 600; }
.af-has-recording::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #10b981; }

/* Pagination */
.af-pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding: 12px 0; }
.af-pagination .af-info { font-size: 0.8rem; color: var(--text-muted, #64748b); }
.af-page-btns { display: flex; gap: 4px; }
.af-page-btns button { width: 32px; height: 32px; border: 1px solid var(--border-color, #e2e8f0); border-radius: 6px; background: var(--surface-color, #fff); font-size: 0.8rem; font-weight: 600; cursor: pointer; color: #475569; transition: all 0.1s; font-family: inherit; }
.af-page-btns button:hover { background: #f8fafc; }
.af-page-btns button.active { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.af-page-btns button:disabled { opacity: 0.4; cursor: default; }

/* Empty state */
.af-empty { padding: 60px 20px; text-align: center; color: var(--text-muted, #64748b); }
.af-empty .af-empty-icon { font-size: 3rem; margin-bottom: 12px; }

@media (max-width: 900px) {
    .af-stats { grid-template-columns: repeat(2, 1fr); }
    .af-filters { flex-direction: column; align-items: stretch; }
    .af-search { width: 100%; }
    .af-detail-panel, .af-detail-panel.three-col { grid-template-columns: 1fr; }
}
</style>

<div class="af-page">
    <!-- Header -->
    <div class="af-header">
        <div>
            <h1>📡 Activity Feed</h1>
            <p>Track call outcomes, follow-ups, and team interactions at a glance${_isPodAdmin() && !_state.global_view ? ' <span style="color:#4f46e5;font-weight:600;font-size:0.8rem;">· My Pod</span>' : ''}</p>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
            ${_isPodAdmin() ? `
            <div id="af-scope-toggle" style="display:flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;border:1.5px solid #4f46e5;background:var(--surface-color);user-select:none;" role="group" aria-label="Activity feed scope">
                <button id="af-toggle-pod" style="padding:5px 14px;font-size:0.78rem;font-weight:600;border:none;cursor:pointer;transition:all 0.15s;background:${!_state.global_view ? '#4f46e5' : 'transparent'};color:${!_state.global_view ? '#fff' : 'var(--text-muted)'};border-radius:0;" title="Show only your pod's activities">🔒 My Pod</button>
                <button id="af-toggle-global" style="padding:5px 14px;font-size:0.78rem;font-weight:600;border:none;cursor:pointer;transition:all 0.15s;background:${_state.global_view ? '#4f46e5' : 'transparent'};color:${_state.global_view ? '#fff' : 'var(--text-muted)'};border-radius:0;" title="Show all org activities">🌐 Global</button>
            </div>` : ''}
            <button class="af-export-btn" id="af-export-btn">📥 Export CSV</button>
        </div>
    </div>

    <!-- Stats -->
    <div class="af-stats">
        <div class="af-stat c1">
            <div class="af-stat-label">Total Activities (${_state.date_range || '7d'})</div>
            <div class="af-stat-num">${(stats.total_activities || 0).toLocaleString()}</div>
        </div>
        <div class="af-stat c2">
            <div class="af-stat-label">Meetings Booked</div>
            <div class="af-stat-num">${stats.meetings_booked || 0}</div>
        </div>
        <div class="af-stat c3">
            <div class="af-stat-label">Call Connect Rate</div>
            <div class="af-stat-num">${stats.connect_rate || 0}%</div>
        </div>
        <div class="af-stat c4">
            <div class="af-stat-label">Emails</div>
            <div class="af-stat-num">${(stats.total_emails || 0).toLocaleString()}</div>
        </div>
    </div>

    <!-- Type Tabs -->
    <div class="af-tabs" id="af-tabs">
        <div class="af-tab ${_state.type === '' ? 'active' : ''}" data-type="">All <span class="af-count">${total.toLocaleString()}</span></div>
        <div class="af-tab ${_state.type === 'call' ? 'active' : ''}" data-type="call">📞 Calls <span class="af-count">${(tc.call || 0).toLocaleString()}</span></div>
        <div class="af-tab ${_state.type === 'email' ? 'active' : ''}" data-type="email">📧 Emails <span class="af-count">${(tc.email || 0).toLocaleString()}</span></div>
        <div class="af-tab ${_state.type === 'status' ? 'active' : ''}" data-type="status">🔄 Status <span class="af-count">${(tc.status || 0).toLocaleString()}</span></div>
        <div class="af-tab ${_state.type === 'research' ? 'active' : ''}" data-type="research">🔬 Research <span class="af-count">${(tc.research || 0).toLocaleString()}</span></div>
    </div>

    <!-- Search -->
    <div class="af-filters">
        <div class="af-spacer"></div>
        <input class="af-search" type="text" id="af-search" placeholder="🔍 Filter by lead or company..." value="${_esc(_state.search)}">
    </div>

    <!-- Table -->
    ${data.length === 0 ? `
        <div class="af-empty">
            <div class="af-empty-icon">📭</div>
            <h3>No activities found</h3>
            <p style="margin-top:6px;">Try adjusting your filters or date range.</p>
        </div>
    ` : `
    <table class="af-table">
        <thead>
            <tr>
                <th style="width:36px"></th>
                <th style="width:40px">Type</th>
                <th>Date / Time</th>
                <th>Lead</th>
                <th>Company</th>
                <th>POD</th>
                <th>SDR</th>
                <th>Outcome / Action</th>
                <th>Notes / Summary</th>
            </tr>
        </thead>
        <tbody id="af-tbody">
            ${data.map((a, i) => _renderRow(a, i)).join('')}
        </tbody>
    </table>
    `}

    <!-- Pagination -->
    ${pages > 1 ? `
    <div class="af-pagination">
        <div class="af-info">Showing ${((page-1)*per_page)+1}–${Math.min(page*per_page, total)} of ${total.toLocaleString()} activities</div>
        <div class="af-page-btns" id="af-page-btns">
            <button ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">←</button>
            ${_renderPageButtons(page, pages)}
            <button ${page >= pages ? 'disabled' : ''} data-page="${page + 1}">→</button>
        </div>
    </div>
    ` : total > 0 ? `
    <div class="af-pagination">
        <div class="af-info">Showing all ${total.toLocaleString()} activities</div>
    </div>
    ` : ''}
</div>`;

    // ── Wire up events ──────────────────────────────────────────────────
    // Type tabs
    _container.querySelectorAll('#af-tabs .af-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            _state.type = tab.dataset.type;
            _state.page = 1;
            _loadAndRender(navigateToLead);
        });
    });

    // Search (lead/company text search — AF specific)
    const searchEl = _container.querySelector('#af-search');
    if (searchEl) {
        searchEl.addEventListener('input', () => {
            clearTimeout(_searchTimeout);
            _searchTimeout = setTimeout(() => {
                _state.search = searchEl.value.trim();
                _state.page = 1;
                _loadAndRender(navigateToLead);
            }, 400);
        });
    }

    // Pagination
    _container.querySelectorAll('#af-page-btns button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = parseInt(btn.dataset.page, 10);
            if (p >= 1 && p <= pages) {
                _state.page = p;
                _loadAndRender(navigateToLead);
            }
        });
    });

    // Expand/collapse
    _container.querySelectorAll('.af-expand-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            _toggleDetail(btn);
        });
    });

    // Row click → expand
    _container.querySelectorAll('tr[data-row-idx]').forEach(tr => {
        tr.addEventListener('click', () => {
            const btn = tr.querySelector('.af-expand-btn');
            if (btn) _toggleDetail(btn);
        });
    });

    // Recording play → fetch a fresh URL before opening (cached one may have expired)
    _container.querySelectorAll('.af-play-btn a[data-call-id]').forEach(a => {
        a.addEventListener('click', (e) => {
            e.stopPropagation();
            openRecordingFresh(e, a.dataset.callId, a.href);
        });
    });
    _container.querySelectorAll('.af-download-btn[data-call-id]').forEach(a => {
        a.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadRecordingFresh(e, a.dataset.callId, a.href);
        });
    });

    // Lead name click → navigate
    _container.querySelectorAll('.af-lead-name[data-lead-id]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (navigateToLead) navigateToLead(el.dataset.leadId);
        });
    });

    // Export
    const exportBtn = _container.querySelector('#af-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => _exportCsv(result));
    }

    // ── Pod Admin scope toggle ───────────────────────────────────────────────────
    const afTogglePod = _container.querySelector('#af-toggle-pod');
    const afToggleGlobal = _container.querySelector('#af-toggle-global');
    if (afTogglePod) {
        afTogglePod.addEventListener('click', () => {
            if (_getAfGlobalView()) { _setAfGlobalView(false); _state.page = 1; _loadAndRender(navigateToLead); }
        });
    }
    if (afToggleGlobal) {
        afToggleGlobal.addEventListener('click', () => {
            if (!_getAfGlobalView()) { _setAfGlobalView(true); _state.page = 1; _loadAndRender(navigateToLead); }
        });
    }
}

// ── Get a summary/notes preview for the last column ───────────────────────────
function _getNotesPreview(a) {
    if (a.type === 'call') {
        // Show call notes, or call strategy if no notes
        if (a.notes) return _truncate(a.notes, 120);
        if (a.research_personalization) return `🎯 ${_truncate(a.research_personalization, 110)}`;
        return '';
    }
    if (a.type === 'email') {
        if (a.subject) return `📋 ${_truncate(a.subject, 110)}`;
        return a.direction === 'outbound' ? 'Email Sent' : 'Email Received';
    }
    if (a.type === 'status') {
        return `${a.from_status || 'New'} → ${a.to_status || '—'}`;
    }
    if (a.type === 'research') {
        if (a.research_personalization) return `🎯 ${_truncate(a.research_personalization, 110)}`;
        if (a.research_hypothesis) return `💡 ${_truncate(a.research_hypothesis, 110)}`;
        return 'Research completed';
    }
    return '';
}

// ── Render a single table row ─────────────────────────────────────────────────
function _renderRow(a, i) {
    const icon = TYPE_ICONS[a.type] || { emoji: '•', cls: '' };
    const outcomeDisplay = a.type === 'status' && a.from_status !== undefined
        ? `${badge(a.from_status || 'New', STATUS_COLORS[a.from_status])} → ${badge(a.to_status, STATUS_COLORS[a.to_status])}`
        : badge(a.outcome || '—');

    const notesPreview = _getNotesPreview(a);
    const hasMedia = a.recording_url || a.transcript;

    return `
        <tr data-row-idx="${i}">
            <td><button class="af-expand-btn" data-idx="${i}">▶</button></td>
            <td><div class="af-type-icon ${icon.cls}">${icon.emoji}</div></td>
            <td>
                <div style="font-weight:600;font-size:.8rem">${_formatDate(a.timestamp)}</div>
                <div style="font-size:.7rem;color:#94a3b8">${_timeAgo(a.timestamp)}</div>
            </td>
            <td>
                <div class="af-lead-name" data-lead-id="${a.lead_id}">${_esc(a.lead_name || '—')}</div>
                ${a.lead_status ? `<div style="margin-top:2px">${statusBadge(a.lead_status)}</div>` : ''}
            </td>
            <td style="font-size:.85rem">${_esc(a.company || '—')}</td>
            <td><span style="font-size:.75rem;color:#64748b">${_esc(a.pod_name || '—')}</span></td>
            <td><span style="font-weight:600;font-size:.85rem">${_esc(a.sdr_name || '—')}</span></td>
            <td>
                ${outcomeDisplay}
                ${hasMedia ? '<span class="af-has-recording" style="margin-left:6px">REC</span>' : ''}
            </td>
            <td>
                <span class="af-notes-preview ${!notesPreview ? 'empty' : ''}">${notesPreview ? _esc(notesPreview) : 'Click to expand'}</span>
            </td>
        </tr>
        <tr class="af-detail-row" data-detail-idx="${i}">
            <td colspan="9">${_renderDetailPanel(a)}</td>
        </tr>`;
}

// ── Render expansion detail panel ─────────────────────────────────────────────
function _renderDetailPanel(a) {
    if (a.type === 'call') return _renderCallDetail(a);
    if (a.type === 'email') return _renderEmailDetail(a);
    if (a.type === 'status') return _renderStatusDetail(a);
    if (a.type === 'research') return _renderResearchDetail(a);
    return '<div class="af-detail-panel"><div class="af-d-card full"><p>No additional details available.</p></div></div>';
}

function _renderCallDetail(a) {
    const hasRecording = !!a.recording_url;
    const hasTranscript = !!a.transcript;
    const hasStrategy = !!(a.research_personalization || a.research_hypothesis);
    const hasNotes = !!a.notes;

    let cards = '';

    // 1. Call Strategy (personalization angle — what should/did the SDR use?)
    if (hasStrategy) {
        cards += `<div class="af-d-card">
            <h5 class="indigo">🎯 Call Strategy</h5>
            ${a.research_personalization ? `<p>${_esc(a.research_personalization)}</p>` : ''}
            ${a.research_hypothesis ? `<p style="margin-top:6px;color:#64748b;font-size:.78rem"><strong>Hypothesis:</strong> ${_esc(a.research_hypothesis)}</p>` : ''}
        </div>`;
    }

    // 2. Call Notes — what happened on the call
    if (hasNotes) {
        cards += `<div class="af-d-card">
            <h5 class="green">📝 Call Notes</h5>
            <p>${_esc(a.notes)}</p>
            <div class="af-meta">Outcome: ${_esc(a.outcome || 'N/A')} · Duration: ${_formatDuration(a.duration)}</div>
        </div>`;
    }

    // 3. Call Recording
    if (hasRecording) {
        cards += `<div class="af-d-card">
            <h5 class="amber">🎙️ Call Recording</h5>
            <div class="af-audio-player">
                <div class="af-play-btn"><a href="${a.recording_url}" data-call-id="${a.id}" target="_blank" title="Play recording">▶</a></div>
                <div style="flex:1;font-size:.8rem;color:#64748b">Recording available — click to play</div>
                <span class="af-audio-time">${_formatDuration(a.duration)}</span>
                <a class="af-download-btn" href="${a.recording_url}" data-call-id="${a.id}" title="Download recording" style="margin-left:8px;color:#6366f1;text-decoration:none;font-size:.85rem;">⬇</a>
            </div>
        </div>`;
    }

    // 4. Transcript
    // RCA 2026-07-22: this only rendered when transcript was a plain string —
    // RCM's real shape is {"transcription": [{role, content, start_time}]},
    // so a real transcript silently produced no card at all.
    const transcriptLines = hasTranscript ? parseTranscript(a.transcript) : [];
    if (transcriptLines.length > 0) {
        cards += `<div class="af-d-card full">
            <h5 class="slate">📃 Call Transcript</h5>
            <div class="af-transcript-box">${
                transcriptLines.map(l =>
                    `<div>${l.speaker ? `<strong>${_esc(l.speaker)}:</strong> ` : ''}${_esc(l.text)}</div>`
                ).join('')
            }</div>
        </div>`;
    }

    // Fallback if nothing available
    if (!cards) {
        cards = `<div class="af-d-card full">
            <h5 class="slate">📞 Call Summary</h5>
            <p>Outcome: <strong>${_esc(a.outcome || 'N/A')}</strong> · Duration: ${_formatDuration(a.duration)}</p>
            <p style="margin-top:6px;color:#94a3b8">No call notes, recording, or transcript available for this call.</p>
        </div>`;
    }

    return `<div class="af-detail-panel">${cards}</div>`;
}

function _renderEmailDetail(a) {
    return `<div class="af-detail-panel">
        <div class="af-d-card full">
            <h5 class="blue">📧 Email ${a.direction === 'outbound' ? 'Sent' : 'Received'}</h5>
            <div class="af-email-header">
                <span class="label">Subject</span>
                <span class="value">${_esc(a.subject || 'No subject')}</span>
                <span class="label">Direction</span>
                <span class="value">${a.direction === 'outbound' ? '↗ Outbound' : '↙ Inbound'}</span>
                <span class="label">SDR</span>
                <span class="value">${_esc(a.sdr_name || 'System')}</span>
            </div>
            ${a.body_preview ? `
                <div class="af-email-body">${_esc(a.body_preview).substring(0, 600)}</div>
            ` : '<p style="color:#94a3b8;font-style:italic">No email body preview available.</p>'}
            <div class="af-email-stats">
                <div class="stat">📬 ${a.open_count ? `Opened ${a.open_count}x` : 'Not yet opened'}</div>
                <div class="stat">📅 ${_formatDate(a.timestamp)}</div>
            </div>
        </div>
    </div>`;
}

function _renderStatusDetail(a) {
    return `<div class="af-detail-panel">
        <div class="af-d-card full">
            <h5 class="green">🔄 Status Transition</h5>
            <p>Lead moved from ${badge(a.from_status || 'New', STATUS_COLORS[a.from_status])} to ${badge(a.to_status, STATUS_COLORS[a.to_status])} by <strong>${_esc(a.sdr_name)}</strong></p>
            <div class="af-meta">${_formatDate(a.timestamp)}</div>
        </div>
    </div>`;
}

function _renderResearchDetail(a) {
    let cards = '';
    if (a.research_personalization) {
        cards += `<div class="af-d-card"><h5 class="indigo">🎯 Call Strategy / Personalization</h5><p>${_esc(a.research_personalization)}</p></div>`;
    }
    if (a.research_hypothesis) {
        cards += `<div class="af-d-card"><h5 class="blue">💡 Research Hypothesis</h5><p>${_esc(a.research_hypothesis)}</p></div>`;
    }
    if (a.research_company) {
        cards += `<div class="af-d-card"><h5 class="purple">🏢 Company Intel</h5><p>${_esc(a.research_company)}</p></div>`;
    }
    if (!cards) {
        cards = `<div class="af-d-card full"><p style="color:#94a3b8">No research details available.</p></div>`;
    }
    return `<div class="af-detail-panel">${cards}</div>`;
}

// ── Toggle detail row ─────────────────────────────────────────────────────────
function _toggleDetail(btn) {
    const idx = btn.dataset.idx;
    btn.classList.toggle('open');
    const detailRow = _container.querySelector(`tr[data-detail-idx="${idx}"]`);
    const dataRow = btn.closest('tr');
    if (detailRow) {
        detailRow.classList.toggle('open');
        dataRow.classList.toggle('af-expanded');
    }
}

// ── Pagination buttons ────────────────────────────────────────────────────────
function _renderPageButtons(current, total) {
    const buttons = [];
    const show = new Set();
    show.add(1);
    show.add(total);
    for (let i = Math.max(1, current - 1); i <= Math.min(total, current + 1); i++) show.add(i);

    let prev = 0;
    [...show].sort((a, b) => a - b).forEach(p => {
        if (p - prev > 1) buttons.push(`<button disabled>…</button>`);
        buttons.push(`<button data-page="${p}" class="${p === current ? 'active' : ''}">${p}</button>`);
        prev = p;
    });
    return buttons.join('');
}

// ── CSV Export ──────────────────────────────────────────────────────────────────
async function _exportCsv(cachedResult) {
    try {
        // Fetch all activities (no pagination) for export
        const allParams = { ..._state, page: 1, per_page: 10000 };
        const result = await fetchAdminActivityFeed(allParams);
        const rows = result.data || [];

        if (rows.length === 0) {
            showToast('No data to export', 'warning');
            return;
        }

        const headers = ['Type', 'Date', 'Lead', 'Company', 'POD', 'SDR', 'Outcome', 'Duration (s)', 'Notes', 'Call Strategy'];
        const csvRows = [headers.join(',')];
        for (const a of rows) {
            csvRows.push([
                a.type || '',
                a.timestamp || '',
                `"${(a.lead_name || '').replace(/"/g, '""')}"`,
                `"${(a.company || '').replace(/"/g, '""')}"`,
                `"${(a.pod_name || '').replace(/"/g, '""')}"`,
                `"${(a.sdr_name || '').replace(/"/g, '""')}"`,
                `"${(a.outcome || '').replace(/"/g, '""')}"`,
                a.duration || 0,
                `"${(a.notes || '').replace(/"/g, '""')}"`,
                `"${(a.research_personalization || '').replace(/"/g, '""')}"`,
            ].join(','));
        }

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `activity_feed_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast(`Exported ${rows.length} activities to CSV`, 'success');
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    }
}

// ── External filter bridge (called by analytics.js global filter bar) ─────────
/**
 * Push one or more filter overrides into the Activity Feed state and refresh.
 * Called by analytics.js when the global batch/source/period filters change
 * while the Activity Feed tab is active or has been loaded.
 *
 * @param {Object} overrides - e.g. { upload_log_id: 'abc', date_range: '7d' }
 */
export function setActivityFeedFilter(overrides = {}) {
    Object.assign(_state, overrides);
    _state.page = 1;  // reset pagination on filter change
    if (_container) {
        _loadAndRender(null);  // re-fetch with new state; navigateToLead not needed for inline refresh
    }
}
