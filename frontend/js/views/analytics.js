/**
 * Analytics Hub — frontend/js/views/analytics.js
 * ================================================
 * Redesigned for Super Admin — hierarchical, context-aware view.
 *
 * Filter hierarchy (strict top-to-bottom):
 *   1. POD — always first; scopes everything
 *   2. Date Range — activates after POD selected
 *   3. Batch — populates only after date range set
 *   4. Date/Time Refinement — locked until batch selected
 *
 * Layout:
 *   Step Pills → Breadcrumb → Insight Bar
 *   Funnel Strip → KPI Cards (6)
 *   Bottom Panels: Trend (left, 60%) + SDR Table (right, 40%)
 *   All Batches mode: full-width Batch Comparison Table
 *
 * Access: Super Admin (all pods) + Pod Admin (auto-scoped)
 */

import {
    fetchAnalyticsFunnel,
    fetchAnalyticsTrend,
    fetchAnalyticsSdrTable,
    fetchAnalyticsEmailBreakdown,
    fetchAnalyticsFilters,
    fetchAnalyticsAiRecommendation,
    fetchAnalyticsBatchSummary,
    downloadAnalyticsCsv,
} from '../api.js';
import { isSuperAdmin as _isSuperAdmin } from '../auth.js';
import { ensureUTC } from '../utils.js';
import { renderActivityFeed, setActivityFeedFilter } from './activity_feed.js';
import { runAiQuery } from './smart_analytics.js';

// ─── Module-level state ────────────────────────────────────────────────────────
let _state = {
    pod_id:     '',           // Step 1
    date_from:  '',           // Step 2a
    date_to:    '',           // Step 2b
    preset:     '',           // Step 2 quick pick
    batch_id:   '',           // Step 3 (upload_log_id)
    refine_from: '',          // Step 4a
    refine_to:   '',          // Step 4b
    sdr_id:     '',           // SDR pill selection for trend
    viewMode:   'single',     // 'single' | 'all_batches'
};

// Which metrics are toggled ON in the trend chart
let _metricToggles = {
    calls:        true,
    meetings:     true,
    research:     true,
    disqualified: true,
    emails:       true,
};

let _allSdrs      = [];   // [{id, name, pod_id}] from filters API
let _allBatches   = [];   // [{id, label}] re-populated when date changes
let _chart        = null; // Chart.js instance
let _aiAbortCtrl  = null; // AbortController for AI recommendation fetch
let _debounceTimer = null;
let _sdrPage      = 1;
let _sdrSortBy    = 'calls_made';
let _showInactive = false;

// ─── Public entry point ────────────────────────────────────────────────────────
export async function renderAnalytics(container, navigateToLead) {
    container.innerHTML = _buildSkeletonHTML();
    _bindAll(container, navigateToLead);
    _enforceFilterHierarchy();

    // Load filter options (pods list — fast)
    fetchAnalyticsFilters({})
        .then(opts => {
            _allSdrs = opts.sdrs || [];
            _populatePodDropdown(opts.pods || []);
        })
        .catch(() => {});

    // Initial data load (no filters yet → still useful for "All Pods, all time" context)
    _loadAllSections();

    // ── AI Command Bar: pick up any pending query from the topbar ──────────────
    // When an admin types in the topbar AI bar and clicks "Open full Analytics Hub →",
    // the query is stored in sessionStorage and auto-run here.
    const pendingQuery = sessionStorage.getItem('ls_ai_pending_query');
    if (pendingQuery) {
        sessionStorage.removeItem('ls_ai_pending_query');
        const aiInput = container.querySelector('#analytics-ai-input');
        if (aiInput) {
            aiInput.value = pendingQuery;
            // Small delay to let the page paint first
            setTimeout(() => _runAnalyticsAiQuery(container, pendingQuery), 150);
        }
    }
}

// ─── Build filter state from current selects ───────────────────────────────────
function _buildApiFilters() {
    const f = {};
    if (_state.pod_id)    f.pod_id        = _state.pod_id;
    if (_state.preset)    f.preset        = _state.preset;
    if (_state.date_from) f.date_from     = _state.date_from;
    if (_state.date_to)   f.date_to       = _state.date_to;
    if (_state.batch_id)  f.upload_log_id = _state.batch_id;
    // Step-4 refinement overrides step-2 dates when present
    if (_state.batch_id && _state.refine_from) f.date_from = _state.refine_from;
    if (_state.batch_id && _state.refine_to)   f.date_to   = _state.refine_to;
    return f;
}

// ─── Section loaders ──────────────────────────────────────────────────────────

function _loadAllSections() {
    if (_state.viewMode === 'all_batches') {
        _loadBatchComparisonTable();
    } else {
        _loadFunnelSection();
        _loadTrendSection();
        _loadSdrSection();
    }
    _updateBreadcrumb();
}

function _loadFunnelSection() {
    const el = document.getElementById('an-kpi-section');
    if (!el) return;
    _dimSection(el);
    fetchAnalyticsFunnel(_buildApiFilters())
        .then(data => {
            _renderFunnelStrip(data);
            _renderKpiCards(data);
            _renderInsightBar(data);
            _undimSection(el);
        })
        .catch(err => _renderSectionError('an-kpi-section', err, 'KPI Metrics'));
}

function _loadTrendSection() {
    const el = document.getElementById('an-trend-section');
    if (!el) return;
    _dimSection(el);
    const filters = { ..._buildApiFilters() };
    if (_state.sdr_id) filters.sdr_id = _state.sdr_id;
    fetchAnalyticsTrend(filters)
        .then(data => { _renderTrendChart(data); _undimSection(el); })
        .catch(err => _renderSectionError('an-trend-section', err, 'Trend Chart'));
}

function _loadSdrSection() {
    const el = document.getElementById('an-sdr-section');
    if (!el) return;
    _dimSection(el);
    delete _buildApiFilters().include_inactive;
    fetchAnalyticsSdrTable(_buildApiFilters(), _sdrPage, _sdrSortBy)
        .then(data => { _renderSdrTable(data); _undimSection(el); })
        .catch(err => _renderSectionError('an-sdr-section', err, 'SDR Table'));
}

function _loadBatchComparisonTable() {
    const el = document.getElementById('an-batch-table-section');
    if (!el) return;
    _dimSection(el);
    fetchAnalyticsBatchSummary(_buildApiFilters())
        .then(data => { _renderBatchComparisonTable(data); _undimSection(el); })
        .catch(err => _renderSectionError('an-batch-table-section', err, 'Batch Comparison'));
}

function _dimSection(el)   { el.style.opacity = '0.45'; el.style.pointerEvents = 'none'; el.style.transition = 'opacity 0.2s'; }
function _undimSection(el) { el.style.opacity = '1';    el.style.pointerEvents = ''; }

function _renderSectionError(sectionId, err, label) {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.style.opacity = '1'; el.style.pointerEvents = '';
    el.innerHTML = `
        <div class="analytics-error-card">
            <span class="analytics-error-icon">⚠️</span>
            <p class="analytics-error-title">${label} failed to load</p>
            <p class="analytics-error-sub">${err?.message || 'Unknown error'}</p>
            <button class="btn btn-sm btn-outline" onclick="window._analyticsRetry('${sectionId}')">Retry</button>
        </div>`;
}

window._analyticsRetry = function(sectionId) {
    const map = {
        'an-kpi-section':         _loadFunnelSection,
        'an-trend-section':       _loadTrendSection,
        'an-sdr-section':         _loadSdrSection,
        'an-batch-table-section': _loadBatchComparisonTable,
    };
    const fn = map[sectionId]; if (fn) fn();
};

// ─── Skeleton HTML ─────────────────────────────────────────────────────────────

function _buildSkeletonHTML() {
    const isSA = _isSuperAdmin;
    return `
<div class="analytics-hub">

    <!-- Header -->
    <div class="analytics-header">
        <div>
            <h1 class="analytics-title">📊 Analytics Hub</h1>
            <p class="analytics-subtitle">Hierarchical SDR activity by POD, date range, and batch</p>
        </div>
        <div class="analytics-header-actions" style="display:flex;gap:8px;align-items:center;">
            <div class="analytics-view-toggle" id="an-view-toggle">
                <button class="analytics-view-toggle-btn active" data-mode="single">Single Batch</button>
                <button class="analytics-view-toggle-btn" data-mode="all_batches">All Batches</button>
            </div>
            <button id="analytics-export-btn" class="btn btn-outline btn-sm" title="Export CSV">⬇ Export CSV</button>
        </div>
    </div>

    <!-- AI Command Bar — inline query across the full analytics surface -->
    <div class="analytics-ai-bar" id="analytics-ai-bar">
        <div class="analytics-ai-bar-inner">
            <span class="analytics-ai-bar-icon">✦</span>
            <input
                type="text"
                id="analytics-ai-input"
                class="analytics-ai-bar-input"
                placeholder="Ask your pipeline anything… e.g. "calls by SDR this month""
                autocomplete="off"
                aria-label="AI pipeline query"
            >
            <button id="analytics-ai-btn" class="analytics-ai-bar-btn">
                <span id="analytics-ai-btn-label">Ask AI</span>
            </button>
            <a href="#" id="analytics-open-smart" class="analytics-ai-open-link" title="Open full AI workspace">
                ✦ Full AI Workspace
            </a>
        </div>
        <!-- Inline result area — appears below the bar when a query runs -->
        <div id="analytics-ai-result" class="analytics-ai-result" style="display:none;"></div>
    </div>

    <!-- Step Pills -->
    <div class="analytics-step-pills" id="an-step-pills">
        <span class="analytics-step-pill active" data-step="1">
            <span class="step-num">1</span> POD
        </span>
        <span class="analytics-step-chevron">›</span>
        <span class="analytics-step-pill locked" data-step="2">
            <span class="step-num">2</span> Date Range
        </span>
        <span class="analytics-step-chevron">›</span>
        <span class="analytics-step-pill locked" data-step="3">
            <span class="step-num">3</span> Batch
        </span>
        <span class="analytics-step-chevron">›</span>
        <span class="analytics-step-pill locked" data-step="4">
            <span class="step-num">4</span> Refine Date/Time
        </span>
    </div>

    <!-- Filter Row (top: POD + Date + Batch + toggle) -->
    <div class="analytics-filter-row" id="an-filter-row-top">

        <!-- Step 1: POD -->
        <div class="analytics-filter-group" id="an-fg-pod">
            <label class="analytics-filter-label">① POD</label>
            <select class="analytics-filter-select" id="an-pod-select">
                <option value="">All Pods</option>
            </select>
        </div>

        <!-- Step 2: Date Quick Picks + Custom -->
        <div class="analytics-filter-group analytics-filter-locked" id="an-fg-date">
            <label class="analytics-filter-label">② Date Range</label>
            <div class="analytics-preset-pills" id="an-preset-pills" style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="analytics-preset-pill" data-preset="7d">7D</button>
                <button class="analytics-preset-pill" data-preset="30d">30D</button>
                <button class="analytics-preset-pill" data-preset="90d">90D</button>
                <button class="analytics-preset-pill" data-preset="all">All</button>
                <button class="analytics-preset-pill" data-preset="custom">Custom</button>
            </div>
            <div id="an-custom-range" style="display:none;gap:6px;align-items:center;margin-top:6px;display:none;" class="analytics-filter-refine-row">
                <input type="date" class="analytics-filter-input" id="an-date-from" style="width:130px;">
                <span style="color:var(--text-muted);font-size:0.8rem;">to</span>
                <input type="date" class="analytics-filter-input" id="an-date-to" style="width:130px;">
            </div>
        </div>

        <!-- Step 3: Batch -->
        <div class="analytics-filter-group analytics-filter-locked" id="an-fg-batch">
            <label class="analytics-filter-label">③ Batch</label>
            <select class="analytics-filter-select analytics-filter-select" id="an-batch-select" disabled>
                <option value="">Select date range first</option>
            </select>
            <div class="analytics-filter-lock-hint" id="an-batch-hint" style="display:none;">
                <span>🔒</span> Select a date range to unlock batches
            </div>
        </div>

        <!-- Step 2 lock hint -->
        <div style="display:flex;flex-direction:column;justify-content:flex-end;gap:4px;">
            <div class="analytics-filter-lock-hint" id="an-date-hint" style="display:none;">
                <span>🔒</span> Select a POD first
            </div>
        </div>

    </div>

    <!-- Filter Row bottom: Step 4 Refine (locked until batch) -->
    <div class="analytics-filter-row-bottom analytics-filter-locked" id="an-filter-row-bottom">
        <div class="analytics-filter-refine-row">
            <span style="font-size:0.8rem;font-weight:600;color:var(--text-muted);white-space:nowrap;">④ Refine:</span>
            <input type="date" class="analytics-filter-input" id="an-refine-from" disabled style="width:130px;">
            <span style="color:var(--text-muted);font-size:0.8rem;">to</span>
            <input type="date" class="analytics-filter-input" id="an-refine-to" disabled style="width:130px;">
            <div class="analytics-filter-lock-hint" id="an-refine-hint">
                <span>🔒</span> Select a batch first
            </div>
        </div>
    </div>

    <!-- Breadcrumb Trail -->
    <div class="analytics-breadcrumb" id="an-breadcrumb">
        <span class="analytics-breadcrumb-empty">Select a POD to begin filtering</span>
    </div>

    <!-- Insight Bar -->
    <div class="analytics-insight-bar" id="an-insight-bar" style="display:none;">
        <div class="analytics-insight-rule-pills" id="an-rule-pills"></div>
        <div class="analytics-ai-rec-wrap" id="an-ai-rec-wrap" style="display:none;">
            <span class="analytics-ai-rec-tag">AI</span>
            <span class="analytics-ai-rec-text" id="an-ai-rec-text">
                <span class="analytics-ai-rec-skeleton"></span>
            </span>
        </div>
    </div>

    <!-- Funnel Strip -->
    <div class="analytics-funnel-strip" id="an-funnel-strip">
        ${_shimmer(60, 16)} <span style="padding:0 12px;color:var(--text-muted);">→</span>
        ${_shimmer(60, 16)} <span style="padding:0 12px;color:var(--text-muted);">→</span>
        ${_shimmer(60, 16)} <span style="padding:0 12px;color:var(--text-muted);">→</span>
        ${_shimmer(60, 16)}
    </div>

    <!-- KPI Cards (6) -->
    <div class="analytics-kpi-grid-6" id="an-kpi-section">
        ${_skeletonKpiCards(6)}
    </div>

    <!-- Single Batch Mode: Bottom Panels -->
    <div class="analytics-bottom-panels" id="an-single-mode">

        <!-- Trend Panel (left) -->
        <div class="analytics-trend-panel" id="an-trend-section">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                <span class="analytics-chart-title">Activity Trend</span>
            </div>
            <!-- SDR Picker (All SDRs + searchable dropdown) -->
            <div class="analytics-sdr-picker" id="an-sdr-pills">
                <div class="analytics-shimmer" style="height:28px;width:120px;border-radius:999px;"></div>
                <div class="analytics-shimmer" style="height:28px;width:160px;border-radius:8px;"></div>
            </div>
            <!-- Metric Toggles -->
            <div class="analytics-metric-toggle-row" id="an-metric-toggles">
                <button class="analytics-metric-toggle" data-metric="calls">
                    <span class="analytics-metric-dot analytics-metric-dot-blue"></span>Calls
                </button>
                <button class="analytics-metric-toggle" data-metric="meetings">
                    <span class="analytics-metric-dot analytics-metric-dot-green"></span>Meetings
                </button>
                <button class="analytics-metric-toggle" data-metric="research">
                    <span class="analytics-metric-dot analytics-metric-dot-purple"></span>Research
                </button>
                <button class="analytics-metric-toggle" data-metric="disqualified">
                    <span class="analytics-metric-dot analytics-metric-dot-red"></span>Disqualified
                </button>
                <button class="analytics-metric-toggle" data-metric="emails">
                    <span class="analytics-metric-dot analytics-metric-dot-sky"></span>Emails
                </button>
            </div>
            <!-- Chart canvas area -->
            <div class="an-chart-area" style="position:relative;height:260px;width:100%;">
                <div class="analytics-shimmer analytics-chart-placeholder"></div>
            </div>
        </div>

        <!-- SDR Table Panel (right) -->
        <div class="analytics-sdr-panel" id="an-sdr-section">
            <div class="analytics-sdr-header">
                <span class="analytics-chart-title">SDR Performance</span>
                <label class="analytics-inactive-toggle">
                    <input type="checkbox" id="an-show-inactive"> Inactive
                </label>
            </div>
            <div class="analytics-shimmer" style="height:200px;border-radius:8px;margin-top:8px;"></div>
        </div>

    </div>

    <!-- All Batches Mode: Batch Comparison Table (hidden by default) -->
    <div id="an-batch-table-section" style="display:none;">
        <div class="analytics-batch-table-wrap">
            <div class="analytics-shimmer" style="height:200px;border-radius:8px;"></div>
        </div>
    </div>

    <!-- Activity Feed Toggle -->
    <div class="analytics-activity-toggle-row">
        <button id="analytics-activity-toggle-btn" class="analytics-activity-toggle-btn">
            📡 Show Activity Feed
        </button>
    </div>
    <div id="analytics-tab-activity" class="analytics-tab-content" style="display:none;">
        <div id="analytics-activity-container"></div>
    </div>

</div>`;
}

function _shimmer(w, h) {
    return `<div class="analytics-shimmer" style="width:${w}px;height:${h}px;border-radius:6px;flex-shrink:0;"></div>`;
}

function _skeletonKpiCards(n) {
    return Array.from({ length: n }, () => `
        <div class="analytics-kpi-card">
            <div class="analytics-shimmer" style="height:12px;width:60%;border-radius:4px;margin-bottom:12px;"></div>
            <div class="analytics-shimmer" style="height:32px;width:40%;border-radius:4px;margin-bottom:8px;"></div>
            <div class="analytics-shimmer" style="height:10px;width:50%;border-radius:4px;"></div>
        </div>
    `).join('');
}

// ─── Analytics AI Command Bar ──────────────────────────────────────────────────

async function _runAnalyticsAiQuery(container, query) {
    const resultEl = container.querySelector('#analytics-ai-result') || document.getElementById('analytics-ai-result');
    const btnLabel = container.querySelector('#analytics-ai-btn-label') || document.getElementById('analytics-ai-btn-label');
    const btn      = container.querySelector('#analytics-ai-btn')      || document.getElementById('analytics-ai-btn');
    if (!resultEl || !query?.trim()) return;

    if (btn) btn.disabled = true;
    if (btnLabel) btnLabel.textContent = '…';
    resultEl.style.display = 'block';

    try {
        await runAiQuery(query, resultEl);
        // Show "✕ Clear" and "✦ Full workspace" links after result
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px 0 0;';
        actions.innerHTML = `
            <button id="analytics-ai-clear" style="background:none;border:none;color:var(--text-muted);font-size:0.78rem;cursor:pointer;font-family:inherit;">✕ Clear result</button>
            <a id="analytics-open-smart-result"
               style="font-size:0.78rem;color:var(--primary-color);text-decoration:none;font-weight:600;cursor:pointer;">
               ✦ Open full AI Workspace →</a>`;
        resultEl.appendChild(actions);
        document.getElementById('analytics-ai-clear')?.addEventListener('click', () => {
            resultEl.style.display = 'none';
            resultEl.innerHTML = '';
            const inp = document.getElementById('analytics-ai-input');
            if (inp) inp.value = '';
        });
        document.getElementById('analytics-open-smart-result')?.addEventListener('click', (e) => {
            e.preventDefault();
            const q = document.getElementById('analytics-ai-input')?.value?.trim();
            if (q) sessionStorage.setItem('ls_ai_pending_query', q);
            window._loadView?.('smart-analytics');  // Falls back to the redirect → analytics
        });
    } catch {} finally {
        if (btn) btn.disabled = false;
        if (btnLabel) btnLabel.textContent = 'Ask AI';
    }
}

// ─── Bind all events ───────────────────────────────────────────────────────────

function _bindAll(container, navigateToLead) {
    // ── AI Command Bar bindings ──────────────────────────────────────────────
    const aiInput = container.querySelector('#analytics-ai-input');
    const aiBtn   = container.querySelector('#analytics-ai-btn');
    const aiOpen  = container.querySelector('#analytics-open-smart');

    if (aiInput && aiBtn) {
        const _submit = () => {
            const q = aiInput.value.trim();
            if (!q || aiBtn.disabled) return;  // EC-02: guard double-submit
            _runAnalyticsAiQuery(container, q);
        };
        aiBtn.addEventListener('click', _submit);
        aiInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _submit(); }
        });
    }
    if (aiOpen) {
        aiOpen.addEventListener('click', e => {
            e.preventDefault();
            const q = aiInput?.value?.trim();
            // EC-10: smart-analytics route is kept alive (sidebar hidden, but routable)
            // — gives access to full conversation history + saved reports
            if (q) sessionStorage.setItem('ls_ai_pending_query', q);
            window._loadView?.('smart-analytics');
        });
    }

    // ① POD select
    const podSel = document.getElementById('an-pod-select');
    if (podSel) {
        podSel.addEventListener('change', () => {
            _state.pod_id = podSel.value;
            // Reset downstream
            _state.date_from = ''; _state.date_to = ''; _state.preset = '';
            _state.batch_id  = ''; _state.refine_from = ''; _state.refine_to = '';
            _state.sdr_id    = '';
            _allBatches = [];
            _enforceFilterHierarchy();
            // Reload SDR cascade
            const filtered = _state.pod_id
                ? _allSdrs.filter(s => s.pod_id === _state.pod_id)
                : _allSdrs;
            _buildSdrPills(filtered);
            _debounceRefresh();
        });
    }

    // ② Preset pills
    container.querySelectorAll('#an-preset-pills .analytics-preset-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            container.querySelectorAll('#an-preset-pills .analytics-preset-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const preset = pill.dataset.preset;
            if (preset === 'custom') {
                document.getElementById('an-custom-range').style.display = 'flex';
                _state.preset = ''; // will be date_from/to
            } else {
                document.getElementById('an-custom-range').style.display = 'none';
                _state.preset = preset;
                _state.date_from = '';
                _state.date_to = '';
            }
            // Date range changed → reload batch list
            _state.batch_id = ''; _state.refine_from = ''; _state.refine_to = '';
            _enforceFilterHierarchy();
            _reloadBatchOptions().then(() => _debounceRefresh());
        });
    });

    // Custom date inputs
    const fromIn = document.getElementById('an-date-from');
    const toIn   = document.getElementById('an-date-to');
    [fromIn, toIn].forEach(inp => {
        if (!inp) return;
        inp.addEventListener('change', () => {
            _state.date_from = fromIn?.value || '';
            _state.date_to   = toIn?.value   || '';
            _state.preset    = '';
            _state.batch_id  = ''; _state.refine_from = ''; _state.refine_to = '';
            _enforceFilterHierarchy();
            _reloadBatchOptions().then(() => _debounceRefresh());
        });
    });

    // ③ Batch select
    const batchSel = document.getElementById('an-batch-select');
    if (batchSel) {
        batchSel.addEventListener('change', () => {
            _state.batch_id = batchSel.value;
            _state.refine_from = ''; _state.refine_to = '';
            _enforceFilterHierarchy();
            _debounceRefresh();
        });
    }

    // ④ Refine date inputs
    const rfFrom = document.getElementById('an-refine-from');
    const rfTo   = document.getElementById('an-refine-to');
    [rfFrom, rfTo].forEach(inp => {
        if (!inp) return;
        inp.addEventListener('change', () => {
            _state.refine_from = rfFrom?.value || '';
            _state.refine_to   = rfTo?.value   || '';
            _debounceRefresh();
        });
    });

    // View toggle (Single / All Batches)
    container.querySelectorAll('#an-view-toggle .analytics-view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('#an-view-toggle .analytics-view-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _state.viewMode = btn.dataset.mode;
            _toggleViewMode();
            _debounceRefresh();
        });
    });

    // Metric toggles (in trend panel)
    container.addEventListener('click', evt => {
        const btn = evt.target.closest('.analytics-metric-toggle');
        if (!btn || !btn.dataset.metric) return;
        const m = btn.dataset.metric;
        _metricToggles[m] = !_metricToggles[m];
        btn.classList.toggle('off', !_metricToggles[m]);
        _applyChartToggles();
    });

    // Export
    const exportBtn = document.getElementById('analytics-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            exportBtn.textContent = '⏳ Exporting…'; exportBtn.disabled = true;
            downloadAnalyticsCsv(_buildApiFilters());
            setTimeout(() => { exportBtn.textContent = '⬇ Export CSV'; exportBtn.disabled = false; }, 3000);
        });
    }

    // Inactive SDR checkbox
    const inactiveChk = document.getElementById('an-show-inactive');
    if (inactiveChk) {
        inactiveChk.addEventListener('change', () => {
            _showInactive = inactiveChk.checked;
            const wrap = document.querySelector('#an-sdr-section .analytics-table-wrap');
            if (wrap) wrap.classList.toggle('sdr-hide-inactive', !_showInactive);
        });
    }

    // Activity feed toggle
    const toggleBtn = document.getElementById('analytics-activity-toggle-btn');
    const feedPanel  = document.getElementById('analytics-tab-activity');
    if (toggleBtn && feedPanel) {
        toggleBtn.addEventListener('click', () => {
            const isOpen = feedPanel.style.display !== 'none';
            feedPanel.style.display = isOpen ? 'none' : 'block';
            toggleBtn.textContent = isOpen ? '📡 Show Activity Feed' : '📡 Hide Activity Feed';
            toggleBtn.classList.toggle('open', !isOpen);
            if (!isOpen) {
                const ac = document.getElementById('analytics-activity-container');
                if (ac && !ac.dataset.loaded) {
                    ac.dataset.loaded = 'true';
                    renderActivityFeed(ac, navigateToLead);
                }
            }
        });
    }
}

// ─── Filter hierarchy enforcement ─────────────────────────────────────────────

function _enforceFilterHierarchy() {
    const hasPod    = !!_state.pod_id;
    const hasDate   = !!((_state.preset && _state.preset !== 'custom') || (_state.date_from && _state.date_to));
    const hasBatch  = !!_state.batch_id;

    // Step pills
    _setPillState(1, hasPod ? 'completed' : 'active');
    _setPillState(2, !hasPod ? 'locked' : hasDate ? 'completed' : 'active');
    _setPillState(3, !hasDate ? 'locked' : hasBatch ? 'completed' : 'active');
    _setPillState(4, !hasBatch ? 'locked' : 'active');

    // Date range group
    const dateFg = document.getElementById('an-fg-date');
    if (dateFg) dateFg.classList.toggle('analytics-filter-locked', !hasPod);
    const dateHint = document.getElementById('an-date-hint');
    if (dateHint) dateHint.style.display = !hasPod ? '' : 'none';
    document.querySelectorAll('#an-preset-pills .analytics-preset-pill').forEach(pill => {
        pill.disabled = !hasPod;
        pill.style.opacity = hasPod ? '' : '0.45';
        pill.style.cursor  = hasPod ? '' : 'not-allowed';
    });
    ['an-date-from', 'an-date-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = !hasPod; }
    });

    // Batch group
    const batchFg  = document.getElementById('an-fg-batch');
    const batchSel = document.getElementById('an-batch-select');
    const batchHint = document.getElementById('an-batch-hint');
    if (batchFg)   batchFg.classList.toggle('analytics-filter-locked', !hasDate);
    if (batchSel)  batchSel.disabled = !hasDate;
    if (batchHint) batchHint.style.display = !hasDate ? '' : 'none';

    // Refine row
    const refineRow = document.getElementById('an-filter-row-bottom');
    const refineHint = document.getElementById('an-refine-hint');
    if (refineRow)  refineRow.classList.toggle('analytics-filter-locked', !hasBatch);
    if (refineHint) refineHint.style.display = !hasBatch ? '' : 'none';
    ['an-refine-from', 'an-refine-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !hasBatch;
    });
}

function _setPillState(step, state) {
    const pill = document.querySelector(`[data-step="${step}"]`);
    if (!pill) return;
    pill.classList.remove('active', 'completed', 'locked');
    pill.classList.add(state);
}

// ─── View Mode toggle ──────────────────────────────────────────────────────────

function _toggleViewMode() {
    const isSingle = _state.viewMode === 'single';
    const singlePanel = document.getElementById('an-single-mode');
    const batchPanel  = document.getElementById('an-batch-table-section');
    if (singlePanel) singlePanel.style.display = isSingle ? '' : 'none';
    if (batchPanel)  batchPanel.style.display  = isSingle ? 'none' : '';
}

// ─── Batch option reload (after date selection) ────────────────────────────────

async function _reloadBatchOptions() {
    const batchSel = document.getElementById('an-batch-select');
    if (!batchSel) return;
    batchSel.innerHTML = '<option value="">Loading batches…</option>';

    // Bug-1 fix: Convert preset values to explicit ISO dates so the
    // backend can properly scope batches by date range.
    let dateFrom = _state.date_from || undefined;
    let dateTo   = _state.date_to   || undefined;
    if (!dateFrom && !dateTo && _state.preset && _state.preset !== 'all') {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const presetDays = { '7d': 6, '30d': 29, '90d': 89 };
        const days = presetDays[_state.preset];
        if (days !== undefined) {
            const start = new Date(today);
            start.setDate(start.getDate() - days);
            dateFrom = start.toISOString().slice(0, 10);
            dateTo   = now.toISOString().slice(0, 10);
        }
    }

    try {
        const opts = await fetchAnalyticsFilters({
            pod_id:    _state.pod_id    || undefined,
            date_from: dateFrom,
            date_to:   dateTo,
        });
        _allBatches = opts.batches || [];
        batchSel.innerHTML = '<option value="">All Batches</option>';
        _allBatches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id; opt.textContent = b.label;
            batchSel.appendChild(opt);
        });
    } catch {
        batchSel.innerHTML = '<option value="">All Batches</option>';
    }
}

// ─── Populate POD dropdown ─────────────────────────────────────────────────────
function _populatePodDropdown(pods) {
    const sel = document.getElementById('an-pod-select');
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    pods.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

// ─── SDR Pills (for trend chart scoping) ──────────────────────────────────────

function _buildSdrPills(sdrs) {
    const wrap = document.getElementById('an-sdr-pills');
    if (!wrap) return;

    const currentSdrId = String(_state.sdr_id || '');
    wrap.innerHTML    = '';
    wrap.className    = 'analytics-sdr-picker';

    // ── 1. "All SDRs" pill ──────────────────────────────────────────────────
    const allBtn = document.createElement('button');
    allBtn.className    = 'analytics-sdr-pill';
    allBtn.dataset.sdrId = '';
    allBtn.id           = 'an-sdr-all-btn';
    allBtn.textContent  = 'All SDRs';
    allBtn.addEventListener('click', () => { _sdrPickerSelect('', wrap, sdrs); });
    wrap.appendChild(allBtn);

    // ── 2. Searchable SDR search box with dropdown ──────────────────────────
    const searchWrap = document.createElement('div');
    searchWrap.className = 'analytics-sdr-search-wrap';

    const searchInput = document.createElement('input');
    searchInput.type        = 'text';
    searchInput.className   = 'analytics-sdr-search-input';
    searchInput.placeholder = '🔍 Search SDR…';
    searchInput.autocomplete = 'off';
    searchInput.id          = 'an-sdr-search-input';

    const dropdown = document.createElement('div');
    dropdown.className = 'analytics-sdr-dropdown';
    dropdown.id        = 'an-sdr-dropdown';

    const _populateDropdown = (query) => {
        const q = query.trim().toLowerCase();
        // Always search the full SDR list, not the pod-filtered subset
        const source = _allSdrs.length ? _allSdrs : sdrs;
        const filtered = q ? source.filter(s => s.name.toLowerCase().includes(q)) : source;
        dropdown.innerHTML = '';
        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className   = 'analytics-sdr-dropdown-empty';
            empty.textContent = 'No SDRs found';
            dropdown.appendChild(empty);
        } else {
            filtered.forEach(s => {
                const item = document.createElement('button');
                item.className    = 'analytics-sdr-dropdown-item';
                item.dataset.sdrId = String(s.id || '');
                item.textContent  = s.name;
                if (String(s.id || '') === String(_state.sdr_id || '')) {
                    item.classList.add('selected');
                }
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // keep input focused
                    _sdrPickerSelect(s.id, wrap, sdrs);
                    searchInput.value = '';
                    dropdown.classList.remove('open');
                });
                dropdown.appendChild(item);
            });
        }
    };

    searchInput.addEventListener('input', () => {
        _populateDropdown(searchInput.value);
        dropdown.classList.add('open');
    });
    searchInput.addEventListener('focus', () => {
        _populateDropdown(searchInput.value);
        dropdown.classList.add('open');
    });
    searchInput.addEventListener('blur', () => {
        // Delay so mousedown on item fires first
        setTimeout(() => dropdown.classList.remove('open'), 150);
    });

    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(dropdown);
    wrap.appendChild(searchWrap);

    // ── Restore active state ────────────────────────────────────────────────
    _sdrPickerSetActive(currentSdrId, wrap, sdrs);
}

function _sdrPickerSelect(sdrId, wrap, sdrs) {
    const sid = String(sdrId || '');
    _state.sdr_id = sid;
    _sdrPickerSetActive(sid, wrap, sdrs);
    _loadTrendSection();
}

function _sdrPickerSetActive(sid, wrap, sdrs) {
    if (!wrap) return;
    sid = String(sid || '');

    // Toggle All SDRs pill
    const allBtn = wrap.querySelector('#an-sdr-all-btn');
    if (allBtn) allBtn.classList.toggle('active', sid === '');

    // Remove any existing selected chip
    const oldChip = wrap.querySelector('.analytics-sdr-chip');
    if (oldChip) oldChip.remove();

    // If an SDR is selected, render a chip
    if (sid) {
        const sdr = sdrs.find(s => String(s.id || '') === sid);
        if (sdr) {
            const chip = document.createElement('div');
            chip.className = 'analytics-sdr-chip';
            chip.innerHTML =
                `<span>${sdr.name}</span>` +
                `<button class="analytics-sdr-chip-remove" title="Clear SDR">✕</button>`;
            chip.querySelector('.analytics-sdr-chip-remove').addEventListener('click', () => {
                _sdrPickerSelect('', wrap, sdrs);
            });
            // Insert chip between All SDRs and search wrap
            const searchWrap = wrap.querySelector('.analytics-sdr-search-wrap');
            wrap.insertBefore(chip, searchWrap);
        }
    }
}

// ─── Breadcrumb ────────────────────────────────────────────────────────────────

function _updateBreadcrumb() {
    const el = document.getElementById('an-breadcrumb');
    if (!el) return;

    const segments = [];
    const podSel = document.getElementById('an-pod-select');
    const podLabel = podSel ? (podSel.options[podSel.selectedIndex]?.text || '') : '';
    if (_state.pod_id && podLabel) segments.push(podLabel);

    if (_state.preset && _state.preset !== 'custom') {
        const labels = { '7d': 'Last 7 Days', '30d': 'Last 30 Days', '90d': 'Last 90 Days', all: 'All Time' };
        segments.push(labels[_state.preset] || _state.preset);
    } else if (_state.date_from && _state.date_to) {
        segments.push(`${_state.date_from} → ${_state.date_to}`);
    }

    const batchSel = document.getElementById('an-batch-select');
    const batchLabel = batchSel ? (batchSel.options[batchSel.selectedIndex]?.text || '') : '';
    if (_state.batch_id && batchLabel && batchLabel !== 'All Batches') segments.push(batchLabel);

    if (_state.refine_from && _state.refine_to) {
        segments.push(`${_state.refine_from} → ${_state.refine_to}`);
    }

    if (!segments.length) {
        el.innerHTML = '<span class="analytics-breadcrumb-empty">Select a POD to begin filtering</span>';
        return;
    }
    el.innerHTML = segments.map((seg, i) =>
        `${i > 0 ? '<span class="analytics-breadcrumb-sep">›</span>' : ''}<span class="analytics-breadcrumb-segment">${seg}</span>`
    ).join('');
}

// ─── Funnel Strip ──────────────────────────────────────────────────────────────

function _renderFunnelStrip(data) {
    const el = document.getElementById('an-funnel-strip');
    if (!el) return;
    const c = data.calls    || {};
    const m = data.meetings || {};
    const leads    = data.leads_assigned || 0;
    const calls    = c.made             || 0;
    const connects = c.connected        || 0;
    const meetings = m.booked           || 0;

    const pct = (a, b) => b > 0 ? `${Math.round(a / b * 100)}%` : '—';

    const stages = [
        { label: 'Leads',    value: leads },
        { label: 'Calls',    value: calls,    conv: pct(calls, leads) },
        { label: 'Connects', value: connects, conv: pct(connects, calls) },
        { label: 'Meetings', value: meetings, conv: pct(meetings, connects || calls) },
    ];

    el.innerHTML = stages.map((s, i) => `
        ${i > 0 ? `
            <span class="analytics-funnel-arrow">→</span>
            <span class="analytics-funnel-conv-pill">${s.conv}</span>
            <span class="analytics-funnel-arrow">→</span>
        ` : ''}
        <div class="analytics-funnel-stage-block">
            <span class="analytics-funnel-stage-value">${s.value.toLocaleString()}</span>
            <span class="analytics-funnel-stage-label">${s.label}</span>
        </div>
    `).join('');
}

// ─── KPI Cards (6 cards) ──────────────────────────────────────────────────────

function _pct(val) { return val === null || val === undefined ? '—' : `${val}%`; }
function _num(val) { return val === null || val === undefined ? '—' : val.toLocaleString(); }

function _renderKpiCards(data) {
    const el = document.getElementById('an-kpi-section');
    if (!el) return;

    const r = data.research || {};
    const e = data.emails   || {};
    const c = data.calls    || {};
    const m = data.meetings || {};

    const cards = [
        {
            title: 'Leads Assigned',
            value: _num(data.leads_assigned),
            sub: '',
            icon: '👥',
            tooltip: 'Filtered by lead created date',
            color: 'blue',
        },
        {
            title: 'Research Complete',
            value: _num(r.complete),
            sub: `${_pct(r.complete_pct)} of assigned`,
            icon: '🔬',
            tooltip: 'Personalization filled = complete',
            color: 'violet',
        },
        {
            title: 'Emails Sent',
            value: _num(e.sent),
            sub: `${_pct(e.open_rate)} open · ${_pct(e.reply_rate)} reply`,
            icon: '✉️',
            tooltip: 'Outbound emails filtered by send date',
            color: 'sky',
        },
        {
            title: 'Calls Made',
            value: _num(c.made),
            sub: c.unique_leads_called
                ? `${_num(c.unique_leads_called)} unique leads · ${c.avg_calls_per_lead || 0} avg/lead`
                : (c.has_incomplete_logs
                    ? `⚠️ ${c.null_outcome_count} incomplete logs`
                    : 'All outcomes recorded'),
            icon: '📞',
            tooltip: 'Filtered by call date',
            color: 'indigo',
        },
        {
            title: 'Connect Rate',
            value: _pct(data.connect_rate),
            sub: `${_num(c.connected)} live connects`,
            icon: '🎯',
            tooltip: 'Live connects / calls with outcome',
            color: data.connect_rate > 30 ? 'green' : 'amber',
            badge: data.connect_rate !== null
                ? `<span class="analytics-connect-badge ${data.connect_rate >= 30 ? 'analytics-connect-badge-green' : 'analytics-connect-badge-amber'}">${data.connect_rate >= 30 ? '✓ Strong' : '↓ Low'}</span>`
                : '',
        },
        {
            title: 'Disqualified',
            value: _num(data.disqualified),
            sub: data.leads_assigned > 0
                ? `${_pct(Math.round(data.disqualified / data.leads_assigned * 1000) / 10)} of assigned`
                : '—',
            icon: '🚫',
            tooltip: 'Not Interested, Disqualified, Unreachable',
            color: 'red',
        },
    ];

    el.innerHTML = cards.map(card => `
        <div class="analytics-kpi-card analytics-kpi-${card.color}">
            <div class="analytics-kpi-top">
                <span class="analytics-kpi-icon">${card.icon}</span>
                <span class="analytics-kpi-label">${card.title}
                    <span class="analytics-tooltip" title="${card.tooltip}">ⓘ</span>
                </span>
            </div>
            <div class="analytics-kpi-value">${card.value}</div>
            ${card.badge ? `<div style="margin-top:4px;">${card.badge}</div>` : ''}
            ${card.sub   ? `<div class="analytics-kpi-sub">${card.sub}</div>` : ''}
        </div>
    `).join('');
}

// ─── Insight Bar (rule pills + AI recommendation) ─────────────────────────────

const _insightCache = new Map();
const _INSIGHT_TTL  = 2 * 60 * 1000; // 2 min

function _runRuleEngine(data) {
    const insights = [];
    const r  = data.research || {};
    const c  = data.calls    || {};
    const m  = data.meetings || {};
    const leads    = data.leads_assigned || 0;
    const calls    = c.made             || 0;
    const connects = c.connected        || 0;
    const meetings = m.booked           || 0;
    const disq     = data.disqualified  || 0;
    const resComp  = r.complete         || 0;
    const connRate = data.connect_rate;

    if (resComp > 0 && calls === 0)
        insights.push({ icon: '📋', text: `${resComp} researched leads not yet called`, level: 'warn' });
    else if (resComp > 0 && calls < resComp * 0.5 && resComp - calls > 1)
        insights.push({ icon: '📋', text: `${resComp - calls} researched leads still not called`, level: 'info' });

    if (connRate !== null && connRate !== undefined && calls >= 10) {
        if (connRate < 20)
            insights.push({ icon: '📉', text: `Low connect rate at ${connRate}% — review call timing`, level: 'warn' });
        else if (connRate >= 45)
            insights.push({ icon: '📈', text: `Strong connect rate at ${connRate}%`, level: 'good' });
    }

    if (calls >= 20 && meetings === 0)
        insights.push({ icon: '🎯', text: `${calls} calls logged but 0 meetings booked`, level: 'warn' });
    else if (calls >= 10 && meetings > 0 && Math.round(calls / meetings) > 30)
        insights.push({ icon: '⏱️', text: `${Math.round(calls / meetings)} calls per meeting — high effort`, level: 'warn' });

    if (leads > 10 && calls === 0)
        insights.push({ icon: '🔴', text: `${leads} leads assigned with no calls`, level: 'warn' });
    else if (leads > 20 && calls < leads * 0.3)
        insights.push({ icon: '⚠️', text: `Only ${Math.round(calls / leads * 100)}% of leads called`, level: 'warn' });

    if (leads > 5 && disq / leads > 0.35)
        insights.push({ icon: '🚫', text: `${Math.round(disq / leads * 100)}% disqualification rate`, level: 'warn' });

    if (leads === 0 && calls === 0 && meetings === 0) return [];

    const seen = new Set();
    return insights.filter(i => { if (seen.has(i.text)) return false; seen.add(i.text); return true; }).slice(0, 3);
}

function _renderInsightBar(data) {
    const bar     = document.getElementById('an-insight-bar');
    const pillWrap = document.getElementById('an-rule-pills');
    if (!bar || !pillWrap) return;

    const insights = _runRuleEngine(data);
    if (!insights.length) { bar.style.display = 'none'; return; }
    bar.style.display = '';

    const levelClass = { warn: 'analytics-insight-warn', good: 'analytics-insight-good', info: 'analytics-insight-info' };
    pillWrap.innerHTML = insights.map(ins =>
        `<span class="analytics-insight-pill ${levelClass[ins.level] || ''}">${ins.icon} ${ins.text}</span>`
    ).join('');

    // AI recommendation (non-blocking, POST to backend)
    const aiWrap = document.getElementById('an-ai-rec-wrap');
    const aiText = document.getElementById('an-ai-rec-text');
    if (!aiWrap || !aiText) return;

    const ckey = JSON.stringify(_buildApiFilters());
    const cached = _insightCache.get(ckey);
    if (cached && Date.now() - cached.ts < _INSIGHT_TTL) {
        aiWrap.style.display = '';
        aiText.textContent = cached.text;
        return;
    }

    aiWrap.style.display = '';
    aiText.innerHTML = '<span class="analytics-ai-rec-skeleton"></span>';

    if (_aiAbortCtrl) _aiAbortCtrl.abort();
    _aiAbortCtrl = new AbortController();

    fetchAnalyticsAiRecommendation({
        insights: insights.map(i => i.text),
        filters: _buildApiFilters(),
        kpi: {
            leads: data.leads_assigned,
            calls: (data.calls || {}).made,
            connect_rate: data.connect_rate,
            meetings: (data.meetings || {}).booked,
            disqualified: data.disqualified,
        },
    }, _aiAbortCtrl.signal)
        .then(res => {
            const rec = res.recommendation || null;
            if (rec) {
                _insightCache.set(ckey, { text: rec, ts: Date.now() });
                if (aiText) aiText.textContent = rec;
            } else {
                if (aiWrap) aiWrap.style.display = 'none';
            }
        })
        .catch(() => { if (aiWrap) aiWrap.style.display = 'none'; });
}

// ─── Trend Chart ──────────────────────────────────────────────────────────────

const _METRIC_COLORS = {
    calls:        { border: '#3b82f6', bg: 'rgba(59,130,246,0.06)' },
    meetings:     { border: '#10b981', bg: 'rgba(16,185,129,0.06)' },
    research:     { border: '#8b5cf6', bg: 'rgba(139,92,246,0.06)' },
    disqualified: { border: '#ef4444', bg: 'rgba(239,68,68,0.06)'  },
    emails:       { border: '#0ea5e9', bg: 'rgba(14,165,233,0.06)' },
};

let _lastTrendData = null; // keep for toggle re-render without refetch

function _renderTrendChart(data) {
    _lastTrendData = data;
    const el = document.getElementById('an-trend-section');
    if (!el) return;

    const series      = data.series || [];
    const granularity = data.granularity || 'daily';
    const labels      = series.map(s => _formatPeriodLabel(s.period, granularity));

    // Rebuild SDR picker — always pass full _allSdrs so search works across all pods
    // The pod-filtered subset is only used if filtering actually narrows it down
    const podId = String(_state.pod_id || '');
    const podSdrs = podId
        ? _allSdrs.filter(s => String(s.pod_id || '') === podId)
        : _allSdrs;
    _buildSdrPills(podSdrs.length ? podSdrs : _allSdrs);

    // Apply toggle button states
    const toggleBtns = document.querySelectorAll('#an-metric-toggles .analytics-metric-toggle');
    toggleBtns.forEach(btn => {
        const m = btn.dataset.metric;
        if (m) btn.classList.toggle('off', !_metricToggles[m]);
    });

    // Destroy previous chart
    if (_chart) { _chart.destroy(); _chart = null; }

    // Reuse the skeleton chart area div (it already has class="an-chart-area")
    // If for any reason it's missing, create it once
    let chartArea = el.querySelector('.an-chart-area');
    if (!chartArea) {
        chartArea = document.createElement('div');
        chartArea.className = 'an-chart-area';
        el.appendChild(chartArea);
    }
    chartArea.style.cssText = 'position:relative;height:260px;width:100%';
    chartArea.innerHTML = '<canvas id="an-trend-canvas"></canvas>';

    const ctx = document.getElementById('an-trend-canvas');
    if (!ctx || !window.Chart) {
        chartArea.innerHTML = '<p class="analytics-error-sub" style="text-align:center;padding:40px 0;">Chart.js not loaded</p>';
        return;
    }

    // Compute visible max so Y-axis is sensibly bounded
    const allValues = Object.entries(_METRIC_COLORS).flatMap(([key]) =>
        _metricToggles[key] ? series.map(s => s[key] ?? 0) : []
    );
    const dataMax   = allValues.length ? Math.max(...allValues) : 10;
    // Add 20% headroom, floor at 5 so the chart never looks microscopic
    const yMax      = Math.max(5, Math.ceil(dataMax * 1.25));
    const stepSize  = yMax <= 10 ? 1 : yMax <= 50 ? 5 : yMax <= 200 ? 20 : 50;

    // Only the primary (Calls) dataset gets a gradient fill; rest are clean lines
    const metricKeys = Object.keys(_METRIC_COLORS);
    const datasets = Object.entries(_METRIC_COLORS).map(([key, colors], idx) => {
        const isFirst = idx === 0;
        return {
            label:           key.charAt(0).toUpperCase() + key.slice(1),
            data:            series.map(s => s[key] ?? 0),
            borderColor:     colors.border,
            backgroundColor: isFirst ? colors.bg : 'transparent',
            borderWidth:     2,
            tension:         series.length <= 7 ? 0.3 : 0.4,
            fill:            isFirst,
            pointRadius:     series.length <= 14 ? 4 : 2,
            pointHoverRadius: 6,
            hidden:          !_metricToggles[key],
        };
    });

    _chart = new window.Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { size: 11 },
                        color: '#94a3b8',
                        maxTicksLimit: 10,
                        maxRotation: 0,
                    },
                },
                y: {
                    beginAtZero: true,
                    max: yMax,
                    grid: { color: 'rgba(148,163,184,0.12)' },
                    ticks: {
                        font: { size: 11 },
                        color: '#94a3b8',
                        precision: 0,
                        stepSize,
                    },
                },
            },
        },
    });
    _chart._granularityLabel = granularity;
}

function _applyChartToggles() {
    if (!_chart || !_lastTrendData) return;
    const metricKeys = Object.keys(_METRIC_COLORS);
    _chart.data.datasets.forEach((ds, i) => {
        const key = metricKeys[i];
        if (key) { ds.hidden = !_metricToggles[key]; }
    });

    // Recompute Y max for currently visible metrics
    const series = _lastTrendData.series || [];
    const allValues = metricKeys.flatMap(key =>
        _metricToggles[key] ? series.map(s => s[key] ?? 0) : []
    );
    const dataMax = allValues.length ? Math.max(...allValues) : 10;
    const yMax    = Math.max(5, Math.ceil(dataMax * 1.25));
    const stepSize = yMax <= 10 ? 1 : yMax <= 50 ? 5 : yMax <= 200 ? 20 : 50;
    _chart.options.scales.y.max      = yMax;
    _chart.options.scales.y.ticks.stepSize = stepSize;

    _chart.update();
}

function _formatPeriodLabel(iso, granularity) {
    if (!iso || iso === 'unknown') return '?';
    const d = new Date(ensureUTC(iso));
    if (granularity === 'daily')   return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (granularity === 'weekly')  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (granularity === 'monthly') return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    return iso.slice(0, 10);
}

// ─── SDR Table (right panel) ──────────────────────────────────────────────────

function _renderSdrTable(data) {
    const el = document.getElementById('an-sdr-section');
    if (!el) return;

    const sdrs = data.sdrs || [];

    const batchLabel = (() => {
        const sel = document.getElementById('an-batch-select');
        if (!_state.batch_id || !sel) return null;
        return sel.options[sel.selectedIndex]?.text || null;
    })();

    const cols = [
        { key: 'sdr_name',            label: 'SDR',              sortable: false },
        { key: 'leads_assigned',      label: 'Leads',            sortable: true  },
        { key: 'calls_made',          label: 'Calls',            sortable: true  },
        { key: 'connect_rate',        label: 'Connect %',        sortable: true  },
        { key: 'account_connect_rate',label: 'Acct Connect %',   sortable: true  },
        { key: 'emails_sent',         label: 'Emails',           sortable: true  },
        { key: 'meetings',            label: 'Meetings',         sortable: true  },
    ];

    const headerHtml = cols.map(c => `
        <th ${c.sortable ? `class="analytics-sortable" data-sort="${c.key}"` : ''}>
            ${c.label}${c.sortable && _sdrSortBy === c.key ? ' ↓' : ''}
        </th>
    `).join('');

    const connectBadge = rate =>
        rate !== null && rate !== undefined
            ? `<span class="analytics-connect-badge ${rate >= 30 ? 'analytics-connect-badge-green' : 'analytics-connect-badge-amber'}">${_pct(rate)}</span>`
            : '—';

    const rowsHtml = sdrs.length === 0
        ? `<tr><td colspan="${cols.length}" class="analytics-empty-row">No SDR data for this period</td></tr>`
        : sdrs.map(sdr => `
            <tr class="${sdr.is_inactive ? 'analytics-sdr-inactive' : ''}">
                <td>${sdr.sdr_name}${sdr.is_inactive ? '<span class="analytics-inactive-badge">Inactive</span>' : ''}</td>
                <td>${_num(sdr.leads_assigned)}</td>
                <td>${_num(sdr.calls_made)}</td>
                <td>${connectBadge(sdr.connect_rate)}</td>
                <td>${connectBadge(sdr.account_connect_rate)}</td>
                <td>${_num(sdr.emails_sent)}</td>
                <td>${_num(sdr.meetings)}</td>
            </tr>
        `).join('');

    const paginationHtml = data.total_pages > 1 ? `
        <div class="analytics-pagination">
            <button class="analytics-page-btn" ${data.page <= 1 ? 'disabled' : ''} id="an-sdr-prev">←</button>
            <span class="analytics-pagination-info">${data.page} / ${data.total_pages}</span>
            <button class="analytics-page-btn" ${data.page >= data.total_pages ? 'disabled' : ''} id="an-sdr-next">→</button>
        </div>` : '';

    el.innerHTML = `
        <div class="analytics-sdr-header">
            <span class="analytics-chart-title">SDR Performance</span>
            <label class="analytics-inactive-toggle">
                <input type="checkbox" id="an-show-inactive" ${_showInactive ? 'checked' : ''}> Inactive
            </label>
        </div>
        ${batchLabel ? `<div class="analytics-sdr-context-label">Batch: ${batchLabel}</div>` : ''}
        <div class="analytics-table-wrap ${!_showInactive ? 'sdr-hide-inactive' : ''}">
            <table class="analytics-table">
                <thead><tr>${headerHtml}</tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
        ${paginationHtml}
    `;

    // Sort headers
    el.querySelectorAll('.analytics-sortable').forEach(th => {
        th.addEventListener('click', () => { _sdrSortBy = th.dataset.sort; _sdrPage = 1; _loadSdrSection(); });
    });
    // Pagination
    el.querySelector('#an-sdr-prev')?.addEventListener('click', () => { _sdrPage--; _loadSdrSection(); });
    el.querySelector('#an-sdr-next')?.addEventListener('click', () => { _sdrPage++; _loadSdrSection(); });
    // Inactive checkbox
    el.querySelector('#an-show-inactive')?.addEventListener('change', evt => {
        _showInactive = evt.target.checked;
        const wrap = el.querySelector('.analytics-table-wrap');
        if (wrap) wrap.classList.toggle('sdr-hide-inactive', !_showInactive);
    });
}

// ─── Batch Comparison Table (All Batches mode) ────────────────────────────────

const _SOURCE_ICONS = {
    'upload':       '📁',
    'google sheet': '📊',
    'salesforce':   '☁️',
    'manual':       '✍️',
};

function _sourceIcon(label = '') {
    const lower = label.toLowerCase();
    for (const [key, icon] of Object.entries(_SOURCE_ICONS)) {
        if (lower.includes(key)) return icon;
    }
    return '📦';
}

function _renderBatchComparisonTable(data) {
    const el = document.getElementById('an-batch-table-section');
    if (!el) return;

    const batches = data.batches || [];

    if (!batches.length) {
        el.innerHTML = `
            <div class="analytics-batch-table-wrap">
                <div class="analytics-empty-nudge">
                    <b>No batches found</b> for this filter context.<br>
                    Try a different date range or POD.
                </div>
            </div>`;
        return;
    }

    // Totals row
    const totals = {
        leads:        batches.reduce((s, b) => s + (b.leads || 0), 0),
        calls:        batches.reduce((s, b) => s + (b.calls || 0), 0),
        connects:     batches.reduce((s, b) => s + (b.connects || 0), 0),
        emails:       batches.reduce((s, b) => s + (b.emails || 0), 0),
        meetings:     batches.reduce((s, b) => s + (b.meetings || 0), 0),
        disqualified: batches.reduce((s, b) => s + (b.disqualified || 0), 0),
    };
    const totalConnect = totals.calls > 0 ? Math.round(totals.connects / totals.calls * 100) : null;

    const connectBadge = (connects, calls) => {
        const rate = calls > 0 ? Math.round(connects / calls * 100) : null;
        if (rate === null) return '—';
        return `<span class="analytics-connect-badge ${rate >= 30 ? 'analytics-connect-badge-green' : 'analytics-connect-badge-amber'}">${rate}%</span>`;
    };

    const rowsHtml = batches.map(b => `
        <tr>
            <td>
                <span class="analytics-batch-source-label">
                    ${_sourceIcon(b.label)} ${b.label}
                </span>
            </td>
            <td>${_num(b.leads)}</td>
            <td>${_num(b.calls)}</td>
            <td>${connectBadge(b.connects, b.calls)}</td>
            <td>${_num(b.emails)}</td>
            <td>${_num(b.meetings)}</td>
            <td>${_num(b.disqualified)}</td>
        </tr>
    `).join('');

    el.innerHTML = `
        <div class="analytics-batch-table-wrap">
            <div class="analytics-batch-table-header">
                <span class="analytics-chart-title">All Batches — Performance Comparison</span>
                <span style="font-size:0.8rem;color:var(--text-muted);">${batches.length} batch${batches.length !== 1 ? 'es' : ''}</span>
            </div>
            <div style="overflow-x:auto;">
                <table class="analytics-batch-table">
                    <thead>
                        <tr>
                            <th>Batch</th>
                            <th>Leads</th>
                            <th>Calls</th>
                            <th>Connect %</th>
                            <th>Emails</th>
                            <th>Meetings</th>
                            <th>Disqualified</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                        <tr class="analytics-batch-totals-row">
                            <td>Totals</td>
                            <td>${_num(totals.leads)}</td>
                            <td>${_num(totals.calls)}</td>
                            <td>${connectBadge(totals.connects, totals.calls)}</td>
                            <td>${_num(totals.emails)}</td>
                            <td>${_num(totals.meetings)}</td>
                            <td>${_num(totals.disqualified)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>`;
}

// ─── Debounced refresh ─────────────────────────────────────────────────────────

function _debounceRefresh() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
        _sdrPage = 1;
        _updateBreadcrumb();
        _loadAllSections();
        setActivityFeedFilter({
            upload_log_id: _state.batch_id || null,
            date_range:    _state.preset   || '7d',
            pod_id:        _state.pod_id   || '',
        });
    }, 350);
}
