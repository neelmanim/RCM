/**
 * Smart Analytics v2 — RCM AI Analytics Assistant
 *
 * Supports 5 query modes:
 *   standard  — single metric chart + table
 *   ranking   — top/bottom N with medals
 *   compare   — side-by-side top vs bottom + delta
 *   multi     — multiple metrics stacked
 *   funnel    — pipeline funnel with gap detection
 *
 * Key v2 features:
 *   - Conversation history sent with every query (follow-ups work)
 *   - Clarification via inline chat bubble, NOT query string concatenation
 *   - "New conversation" button resets context
 *   - Period quick-select stays on results
 *   - Mini bars in tables
 *   - Smooth result reveal animation
 */

import { API_BASE, authHeaders } from '../auth.js';

// ─── Conversation State ───────────────────────────────────────────────────────
let _conversationHistory = [];   // [{role, content}]
let _chart               = null;
let _currentResult       = null;
let _currentQuery        = '';
let _currentDSL          = null;
let _savedReports        = [];
let _loading             = false;
let _pendingClarifyQ     = '';   // Original query waiting for clarification
let _filterPod           = null; // {id, name} — active pod filter
let _filterBatch         = null; // {id, label} — active batch filter
let _batches             = [];   // loaded from /api/admin/smart-analytics/batches
let _pods                = [];   // loaded from /api/analytics/filters

const EXAMPLES = [
    { label: '📞 Call trend last 30 days',          q: 'Show call volume trend last 30 days' },
    { label: '🤝 Meetings by SDR this month',       q: 'Show meetings by SDR this month' },
    { label: '🏆 Top SDR by conversion rate',       q: 'Top 3 SDRs by conversion rate this month' },
    { label: '📋 Leads created this week',          q: 'Show leads created this week' },
    { label: '🏢 Compare all pods',                 q: 'Show status of all pods this month' },
    { label: '🔀 Compare top vs bottom SDR',        q: 'Difference between top and least performer by meetings this month' },
    { label: '📊 Calls AND meetings per SDR',       q: 'Show calls and meetings per SDR this month' },
    { label: '📞 Connect rate by SDR',              q: 'What is the connect rate per SDR this month?' },
    { label: '📧 Email open rate this month',       q: 'Show email open rate by SDR this month' },
    { label: '🔬 Ananya\'s funnel this month',      q: 'Show funnel for Ananya this month' },
];

const QUICK_PERIODS = [
    { label: 'Today',     value: 'today' },
    { label: 'This week', value: 'this_week' },
    { label: 'This month',value: 'this_month' },
    { label: '30 days',   value: 'last_30_days' },
    { label: '90 days',   value: 'last_90_days' },
    { label: 'This year', value: 'this_year' },
];

// ─── Entry ────────────────────────────────────────────────────────────────────
export async function renderSmartAnalytics(container) {
    _injectStyles();
    container.innerHTML = _buildShell();
    _bindEvents();
    await Promise.all([_loadHistory(), _loadSavedReports(), _loadFilterOptions()]);
}

/**
 * PUBLIC: Run a single AI query and render a compact inline result into `resultContainer`.
 * Used by the Analytics page command bar and the topbar quick query.
 * Self-contained — does not share mutable state with the full Smart Analytics view.
 *
 * @param {string}      query           - Natural language query
 * @param {HTMLElement} resultContainer - DOM element to render result into
 * @param {Object}      [opts]
 * @param {Array}       [opts.history=[]]       - Conversation history [{role,content}]
 * @param {string}      [opts.filterPod=null]   - Pod name to scope query
 * @param {string}      [opts.filterBatch=null] - Batch label to scope query
 * @returns {Promise<Object>} - The raw API response
 */
export async function runAiQuery(query, resultContainer, opts = {}) {
    _injectStyles();
    const { history = [], filterPod = null, filterBatch = null } = opts;

    // Show thinking state
    resultContainer.innerHTML = `
        <div class="sa-thinking" style="padding:12px 0;">
            <div class="sa-thinking-dots"><span></span><span></span><span></span></div>
            <span>Thinking…</span>
        </div>`;

    try {
        const body = { query, conversation_history: history.slice(-6) };
        if (filterPod)   body.filter_pod   = filterPod;
        if (filterBatch) body.filter_batch = filterBatch;

        const res = await _post('/api/admin/smart-analytics/query', body);

        if (res.action === 'clarify') {
            resultContainer.innerHTML = `
                <div class="sa-state sa-state-clarify">
                    <div class="sa-state-icon">💬</div>
                    <div><div class="sa-state-title">Need a bit more info</div>
                    <div class="sa-state-body">${_esc(res.question)}</div></div>
                </div>`;
        } else if (res.action === 'unsupported' || res.action === 'batch_not_found') {
            resultContainer.innerHTML = `
                <div class="sa-state sa-state-info">
                    <div class="sa-state-icon">ℹ️</div>
                    <div><div class="sa-state-title">Can't answer that yet</div>
                    <div class="sa-state-body">${_esc(res.message)}</div></div>
                </div>`;
        } else {
            // Render compact inline result card
            resultContainer.innerHTML = _buildInlineResult(res, query);
            // Draw chart if needed
            const canvas = resultContainer.querySelector('.sa-inline-canvas');
            if (canvas && res.chart_type && res.chart_type !== 'table') {
                const rows = _flatData(res);
                if (rows.length) _drawInlineChart(canvas, rows, res.chart_type, _human(res.metric));
            }
            // Animate in
            requestAnimationFrame(() => {
                const card = resultContainer.querySelector('.sa-result-card');
                if (card) { setTimeout(() => card.classList.add('sa-result-visible'), 20); }
            });
        }
        return res;
    } catch (err) {
        const msg = err?.detail?.message || err?.message || 'Something went wrong.';
        resultContainer.innerHTML = `
            <div class="sa-state sa-state-error">
                <div class="sa-state-icon">⚠️</div>
                <div><div class="sa-state-title">Error</div>
                <div class="sa-state-body">${_esc(msg)}</div></div>
            </div>`;
        throw err;
    }
}

/** Build a compact inline result card (no save button, no period switcher). */
function _buildInlineResult(res, query) {
    const mode   = res.mode || 'standard';
    const metric = _human(res.metric || '');
    const period = _human(res.period || '');
    const rows   = _flatData(res);
    const isChart = res.chart_type && res.chart_type !== 'table';
    const title  = metric + (res.group_by ? ` by ${_human(res.group_by)}` : '') || 'Result';

    const tableHtml = rows.length
        ? _buildTable(rows, res.metric)
        : '<div class="sa-empty-wrap" style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.86rem;">No data found for this query.</div>';

    return `
        <div class="sa-result-card" style="margin-bottom:0;">
            <div class="sa-result-head">
                <div>
                    <div class="sa-result-query" title="${_esc(query)}">"${_esc(query)}"</div>
                    <div class="sa-result-title">${_esc(title)}</div>
                    ${period ? `<div class="sa-result-meta">${period}</div>` : ''}
                </div>
            </div>
            ${isChart && rows.length ? `<div class="sa-chart-wrap" style="height:220px;"><canvas class="sa-inline-canvas"></canvas></div>` : ''}
            ${tableHtml}
        </div>`;
}

/** Normalise all result modes into a flat [{label, value}] array for inline rendering. */
function _flatData(res) {
    const mode = res.mode || 'standard';
    if (mode === 'ranking' || mode === 'standard') return res.data || [];
    if (mode === 'multi' && res.results?.length)   return res.results[0]?.data || [];
    if (mode === 'compare')                         return [
        ...(res.top    ? [{ label: res.top.name,    value: res.top.value }]    : []),
        ...(res.bottom ? [{ label: res.bottom.name, value: res.bottom.value }] : []),
    ];
    if (mode === 'pod_summary') return (res.rows || []).map(r => ({ label: r.pod, value: r.calls_made ?? r.meetings_scheduled ?? 0 }));
    if (mode === 'funnel' || mode === 'batch_funnel') return (res.stages || []).map(s => ({ label: s.label, value: s.count }));
    return res.data || [];
}

/** Draw a compact Chart.js chart for the inline result. */
function _drawInlineChart(canvas, rows, chartType, label) {
    if (typeof Chart === 'undefined') return;
    const labels = rows.map(r => r.label ?? r.name ?? r.sdr ?? r.pod ?? '');
    const values = rows.map(r => r.value ?? r.count ?? 0);
    const isLine = chartType === 'line';
    new Chart(canvas, {
        type: isLine ? 'line' : 'bar',
        data: {
            labels,
            datasets: [{
                label,
                data: values,
                backgroundColor: isLine ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.75)',
                borderColor: '#6366f1',
                borderWidth: isLine ? 2 : 0,
                borderRadius: isLine ? 0 : 6,
                fill: isLine,
                tension: 0.4,
                pointRadius: isLine ? 3 : 0,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString()}` } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94a3b8', maxRotation: 45 } },
                y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 }, color: '#94a3b8' }, beginAtZero: true },
            },
        },
    });
}

/** PUBLIC: Inject SA styles into the page (idempotent). */
export function injectSmartAnalyticsStyles() { _injectStyles(); }


// ─── Shell ────────────────────────────────────────────────────────────────────
function _buildShell() {
    const examples = EXAMPLES.map(e =>
        `<button class="sa-ex-btn" data-q="${_esc(e.q)}">${e.label}</button>`
    ).join('');

    return `
<div class="sa-wrap" id="sa-wrap">

  <!-- LEFT PANEL: header + search + saved -->
  <div class="sa-left" id="sa-left">
    <!-- Header -->
    <div class="sa-header">
      <div class="sa-header-icon">✦</div>
      <div class="sa-header-text">
        <h2 class="sa-title">Smart Analytics</h2>
        <p class="sa-subtitle">Ask anything about your RCM data</p>
      </div>
    </div>

    <!-- Conversation history display -->
    <div id="sa-conv-history" class="sa-conv-history"></div>

    <!-- Input card -->
    <div class="sa-input-card" id="sa-input-card">
      <div class="sa-input-row">
        <textarea
          id="sa-input"
          class="sa-input"
          placeholder="e.g. Show meetings by SDR last 30 days"
          rows="1"
          maxlength="500"
        ></textarea>
        <button id="sa-ask-btn" class="sa-ask-btn" aria-label="Ask">
          <span id="sa-ask-label">Ask</span>
          <span id="sa-ask-spin" class="sa-spin" aria-hidden="true" style="display:none"></span>
        </button>
      </div>

      <!-- Active filters (pod / batch chips) -->
      <div id="sa-filter-chips" class="sa-filter-chips" style="display:none;"></div>

      <!-- Context filter selectors (visible after first query) -->
      <div id="sa-filter-row" class="sa-filter-row" style="display:none;">
        <select id="sa-filter-pod-sel" class="sa-filter-sel">
          <option value="">🏢 All Pods</option>
        </select>
        <select id="sa-filter-batch-sel" class="sa-filter-sel">
          <option value="">📦 All Batches</option>
        </select>
      </div>

      <!-- Examples (shown only on first turn) -->
      <div id="sa-examples-wrap">
        <div class="sa-examples" id="sa-examples">${examples}</div>
      </div>

      <!-- Recent (shown after history loads) -->
      <div id="sa-recent-row" style="display:none;">
        <div class="sa-divider"></div>
        <div class="sa-recent">
          <span class="sa-recent-label">Recent</span>
          <div id="sa-recent-chips" class="sa-recent-chips"></div>
        </div>
      </div>
    </div>

    <!-- Thinking (visible in left panel before result arrives) -->
    <div id="sa-thinking" class="sa-thinking" style="display:none;">
      <div class="sa-thinking-dots"><span></span><span></span><span></span></div>
      <span id="sa-thinking-label">Analysing…</span>
    </div>

    <!-- New conv + saved reports (left panel, shown after first query) -->
    <div id="sa-left-footer" style="display:none;">
      <button id="sa-new-conv" class="sa-new-conv-btn">↺ New conversation</button>
      <div id="sa-saved-section" style="display:none;">
        <div class="sa-saved-heading">📌 Saved Reports</div>
        <div id="sa-saved-grid" class="sa-saved-grid"></div>
      </div>
    </div>
  </div>

  <!-- RIGHT PANEL: results -->
  <div class="sa-right" id="sa-right" style="display:none;">
    <div id="sa-result-area"></div>
  </div>

</div>

<!-- Save modal -->
<div id="sa-modal" class="sa-modal-bg" style="display:none;" role="dialog" aria-modal="true">
  <div class="sa-modal-box">
    <div class="sa-modal-title">Save Report</div>
    <input id="sa-modal-name" class="sa-modal-input" type="text" placeholder="Report name…" maxlength="100"/>
    <div class="sa-modal-actions">
      <button id="sa-modal-cancel" class="sa-cancel-btn">Cancel</button>
      <button id="sa-modal-save"   class="sa-primary-btn">Save</button>
    </div>
  </div>
</div>`;
}

// ─── Events ───────────────────────────────────────────────────────────────────
function _bindEvents() {
    _on('sa-ask-btn', 'click', _submit);
    _on('sa-input', 'keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); _submit(); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _submit(); }
    });
    const inp = _el('sa-input');
    if (inp) inp.addEventListener('input', _autoResize);

    document.querySelectorAll('.sa-ex-btn').forEach(b =>
        b.addEventListener('click', () => { _setQuery(b.dataset.q); _submit(); })
    );

    _on('sa-new-conv', 'click', _newConversation);
    _on('sa-modal-cancel', 'click', _closeModal);
    _on('sa-modal', 'click', e => { if (e.target.id === 'sa-modal') _closeModal(); });
    _on('sa-modal-save', 'click', _saveReport);
    _on('sa-modal-name', 'keydown', e => { if (e.key === 'Enter') _saveReport(); });
}

// ─── New conversation ─────────────────────────────────────────────────────────
function _newConversation() {
    _conversationHistory = [];
    _currentResult       = null;
    _currentQuery        = '';
    _pendingClarifyQ     = '';
    _filterPod           = null;
    _filterBatch         = null;
    _clearResult();
    _el('sa-conv-history').innerHTML = '';
    _el('sa-examples-wrap').style.display = '';
    _el('sa-right').style.display        = 'none';
    _el('sa-left-footer').style.display  = 'none';
    const fr = _el('sa-filter-row');
    const fc = _el('sa-filter-chips');
    if (fr) fr.style.display = 'none';
    if (fc) fc.style.display = 'none';
    // Reset to centered layout
    _el('sa-wrap')?.classList.remove('sa-split');
    _setQuery('');
    const inp = _el('sa-input');
    if (inp) inp.placeholder = 'e.g. Show meetings by SDR last 30 days';
    inp?.focus();
}

// ─── Submission ───────────────────────────────────────────────────────────────
async function _submit() {
    const query = (_el('sa-input')?.value || '').trim();
    if (!query || _loading) return;

    _currentQuery = query;
    _addToConvHistory('user', query);
    _setQuery('');
    _setLoading(true);
    _clearResult();

    // Switch to split layout on first query
    _el('sa-wrap')?.classList.add('sa-split');
    _el('sa-right').style.display       = 'block';
    _el('sa-left-footer').style.display = 'block';
    _el('sa-examples-wrap').style.display = 'none';
    const fr = _el('sa-filter-row');
    if (fr) fr.style.display = 'flex';
    _renderFilterChips();

    try {
        const body = {
            query,
            conversation_history: _conversationHistory.slice(-6),
        };
        // Include active context filters in body
        if (_filterPod)   body.filter_pod   = _filterPod.name;
        if (_filterBatch) body.filter_batch = _filterBatch.label;
        const res = await _post('/api/admin/smart-analytics/query', body);
        _setLoading(false);

        if (res.action === 'clarify') {
            _pendingClarifyQ = query;
            _addToConvHistory('assistant', `I need a bit more info: ${res.question}`);
            _showClarify(res.question, query);
        } else if (res.action === 'unsupported') {
            _addToConvHistory('assistant', res.message);
            _showUnsupported(res.message);
        } else if (res.action === 'batch_not_found') {
            _addToConvHistory('assistant', res.message);
            _showUnsupported(res.message);
        } else {
            _currentResult = res;
            _currentDSL    = res.dsl;
            _addToConvHistory('assistant', _resultSummary(res));
            _renderResult(res);
            _loadHistory();
            // Switch placeholder to follow-up mode
            const inp = _el('sa-input');
            if (inp) inp.placeholder = 'Ask a follow-up…';
        }
    } catch (err) {
        _setLoading(false);
        const msg = err?.detail?.message || err?.message || 'Something went wrong.';
        _showError(msg);
    }
}

function _resultSummary(res) {
    const mode = res.mode || 'standard';
    if (mode === 'funnel' || mode === 'batch_funnel') return `Here's the funnel breakdown${res.sdr_name ? ` for ${res.sdr_name}` : ''}${res.batch_filter ? ' (batch scoped)' : ''}.`;
    if (mode === 'multi')      return `Here are ${res.results?.length || ''} metrics side by side.`;
    if (mode === 'compare')    return `Here's the comparison.`;
    if (mode === 'pod_summary') return `Here's the pod summary (${res.rows?.length || 0} pods).`;
    const count = res.meta?.result_count || (res.data || []).length;
    return `Found ${count} result${count !== 1 ? 's' : ''} for ${_human(res.metric)} by ${_human(res.group_by || 'overall')}.`;
}

// ─── Conversation history display ─────────────────────────────────────────────
function _addToConvHistory(role, content) {
    _conversationHistory.push({ role, content });
    _renderConvHistory();
}

function _renderConvHistory() {
    const el = _el('sa-conv-history');
    if (!el) return;
    // Only show last N turns (user messages as bubbles)
    const turns = _conversationHistory.filter(m => m.role === 'user').slice(-3);
    if (!turns.length) { el.innerHTML = ''; return; }
    el.innerHTML = turns.map(m => `
<div class="sa-conv-bubble">
  <span class="sa-conv-icon">◆</span>
  <span class="sa-conv-text">${_esc(m.content)}</span>
</div>`).join('');
}

// ─── Loading ──────────────────────────────────────────────────────────────────
function _setLoading(on) {
    _loading = on;
    const btn  = _el('sa-ask-btn');
    const lbl  = _el('sa-ask-label');
    const spin = _el('sa-ask-spin');
    const thk  = _el('sa-thinking');
    if (btn)  btn.disabled = on;
    if (lbl)  lbl.style.display  = on ? 'none' : '';
    if (spin) spin.style.display = on ? 'inline-block' : 'none';
    if (thk)  thk.style.display  = on ? 'flex' : 'none';

    if (on) {
        const msgs = ['Analysing your question…', 'Querying the database…', 'Building results…'];
        let i = 0;
        const lbl2 = _el('sa-thinking-label');
        if (lbl2) {
            lbl2.textContent = msgs[0];
            const t = setInterval(() => {
                if (!_loading) { clearInterval(t); return; }
                lbl2.textContent = msgs[++i % msgs.length];
            }, 900);
        }
    }
}

function _clearResult() {
    const el = _el('sa-result-area');
    if (el) el.innerHTML = '';
    if (_chart) { try { _chart.destroy(); } catch (e) {} _chart = null; }
}

// ─── States ───────────────────────────────────────────────────────────────────
function _showError(msg) {
    _el('sa-result-area').innerHTML = `
<div class="sa-state sa-state-error">
  <div class="sa-state-icon">⚠</div>
  <div>
    <div class="sa-state-title">Couldn't complete that query</div>
    <div class="sa-state-body">${_esc(msg)}</div>
  </div>
</div>`;
}

function _showUnsupported(msg) {
    _el('sa-result-area').innerHTML = `
<div class="sa-state sa-state-info">
  <div class="sa-state-icon">🔍</div>
  <div>
    <div class="sa-state-title">${_esc(msg)}</div>
    <div class="sa-state-body">Try asking about calls, meetings, emails, leads, funnel, or conversion rates.</div>
  </div>
</div>`;
}

function _showClarify(question, originalQuery) {
    _el('sa-result-area').innerHTML = `
<div class="sa-state sa-state-clarify" id="sa-clarify-card">
  <div class="sa-state-icon">💬</div>
  <div style="flex:1">
    <div class="sa-state-title">${_esc(question)}</div>
    <div class="sa-clarify-row">
      <input id="sa-clarify-inp" class="sa-clarify-input" placeholder="Type your answer…" autofocus />
      <button id="sa-clarify-go" class="sa-primary-btn">Go →</button>
    </div>
    <div class="sa-clarify-hints" id="sa-clarify-hints"></div>
  </div>
</div>`;

    // Quick-pick hints for common clarify questions
    if (/metric|by what|which metric/.test(question.toLowerCase())) {
        const hints = ['Calls', 'Meetings', 'Emails', 'Conversion rate', 'Leads'];
        _el('sa-clarify-hints').innerHTML = hints.map(h =>
            `<button class="sa-hint-btn">${h}</button>`
        ).join('');
        document.querySelectorAll('.sa-hint-btn').forEach(b => {
            b.addEventListener('click', () => {
                _el('sa-clarify-inp').value = b.textContent;
                _el('sa-clarify-go')?.click();
            });
        });
    }

    _on('sa-clarify-go', 'click', () => {
        const ans = _el('sa-clarify-inp')?.value?.trim();
        if (!ans) return;
        // Add the answer to conversation history — NOT appended to query string
        _addToConvHistory('user', ans);
        _setQuery(_pendingClarifyQ || originalQuery);
        _submit();
    });
    _on('sa-clarify-inp', 'keydown', e => { if (e.key === 'Enter') _el('sa-clarify-go')?.click(); });
    setTimeout(() => _el('sa-clarify-inp')?.focus(), 100);
}

// ─── Result Dispatcher ────────────────────────────────────────────────────────
function _renderResult(r) {
    const mode = r.mode || 'standard';
    if      (mode === 'compare')      _renderCompare(r);
    else if (mode === 'multi')        _renderMulti(r);
    else if (mode === 'funnel' || mode === 'batch_funnel') _renderFunnel(r);
    else if (mode === 'ranking')      _renderRanking(r);
    else if (mode === 'pod_summary')  _renderPodSummary(r);
    else                              _renderStandard(r);
}

// ─── Renderer: Standard + Ranking ────────────────────────────────────────────
function _renderStandard(r) {
    const { data = [], chart_type, metric, period, group_by, meta } = r;
    if (!data || !data.length) { _showEmpty(); return; }

    const title  = _human(metric) + (group_by ? ` by ${_human(group_by)}` : '');
    const pLabel = period ? `· ${_human(period)}` : '';
    const count  = meta?.result_count ?? data.length;
    const isChart = chart_type !== 'table';

    _el('sa-result-area').innerHTML = _wrapResultCard(`
  ${_buildResultHead(title, `${count} result${count !== 1 ? 's' : ''} ${pLabel}`)}
  ${_buildPeriodRow(period)}
  ${isChart ? `<div class="sa-chart-wrap"><canvas id="sa-chart"></canvas></div>` : ''}
  ${_buildTable(data, metric)}
`);

    _animateIn();
    _bindPeriodBtns(r);
    _on('sa-save-btn', 'click', () => _openModal(_currentQuery));
    if (isChart) _renderChart(data, chart_type, _human(metric));
}

function _renderRanking(r) {
    const { data = [], metric, period, group_by, meta, top = [], bottom = [] } = r;
    if (!data.length) { _showEmpty(); return; }

    const title   = `${_human(metric)} Ranking`;
    const pLabel  = period ? `· ${_human(period)}` : '';
    const topN    = meta?.top_n || data.length;
    const medals  = ['🥇', '🥈', '🥉'];

    // Only show top rows (backend already limits to top_n)
    const topRows = data.map((row, i) => {
        const medal   = medals[i] || `${i + 1}`;
        const isBottom = bottom.some(b => b.label === row.label);
        return `<tr class="${isBottom ? 'sa-row-bottom' : 'sa-row-top'}">
<td class="sa-td sa-td-idx">${medal}</td>
<td class="sa-td sa-td-name">${_esc(String(row.label ?? '—'))}</td>
<td class="sa-td sa-td-bar">${_miniBar(row.value, data)}</td>
<td class="sa-td sa-td-val">${_fmtVal(row.value, metric)}</td>
</tr>`;
    }).join('');

    const bottomRows = bottom.length ? bottom.map((row, i) => `<tr class="sa-row-bottom">
<td class="sa-td sa-td-idx">⬇ ${i + 1}</td>
<td class="sa-td sa-td-name">${_esc(String(row.label ?? '—'))}</td>
<td class="sa-td sa-td-bar">${_miniBar(row.value, [...data, ...bottom])}</td>
<td class="sa-td sa-td-val">${_fmtVal(row.value, metric)}</td>
</tr>`).join('') : '';

    const countLabel = `Top ${data.length}${bottom.length ? ` · Bottom ${bottom.length}` : ''} ${_human(group_by || 'sdr')}s`;

    _el('sa-result-area').innerHTML = _wrapResultCard(`
  ${_buildResultHead(title, countLabel + ' ' + pLabel)}
  ${_buildPeriodRow(period)}
  <div class="sa-chart-wrap"><canvas id="sa-chart"></canvas></div>
  <div class="sa-table-wrap">
    <table class="sa-table">
      <thead><tr>
        <th class="sa-th sa-th-idx">#</th>
        <th class="sa-th">Name</th>
        <th class="sa-th sa-th-bar"></th>
        <th class="sa-th sa-th-val">${_human(metric)}</th>
      </tr></thead>
      <tbody>${topRows}${bottomRows}</tbody>
    </table>
  </div>
`);

    _animateIn();
    _bindPeriodBtns(r);
    _on('sa-save-btn', 'click', () => _openModal(_currentQuery));
    _renderChart(data, 'bar', _human(metric));
}

// ─── Renderer: Compare ────────────────────────────────────────────────────────
function _renderCompare(r) {
    const { comparisons = [], all_data = [], metric, period, meta } = r;
    if (!comparisons.length) { _showEmpty(); return; }

    const pLabel = period ? `· ${_human(period)}` : '';

    const cards = comparisons.map(c => {
        const dSign  = c.delta >= 0 ? '+' : '';
        const dClass = c.delta >= 0 ? 'sa-delta-pos' : 'sa-delta-neg';
        return `
<div class="sa-compare-pair">
  <div class="sa-compare-side sa-compare-top">
    <div class="sa-compare-badge">🏆 Top</div>
    <div class="sa-compare-name">${_esc(c.top_label)}</div>
    <div class="sa-compare-val">${_fmtVal(c.top_value, metric)}</div>
  </div>
  <div class="sa-compare-vs">
    <div class="${dClass} sa-compare-delta">${dSign}${_fmtVal(c.delta, metric)}</div>
    <div class="sa-compare-delta-label">difference</div>
    ${c.delta_pct != null ? `<div class="sa-compare-delta-pct">${dSign}${c.delta_pct}%</div>` : ''}
  </div>
  <div class="sa-compare-side sa-compare-bottom">
    <div class="sa-compare-badge">⬇ Least</div>
    <div class="sa-compare-name">${_esc(c.bottom_label)}</div>
    <div class="sa-compare-val">${_fmtVal(c.bottom_value, metric)}</div>
  </div>
</div>`;
    }).join('');

    _el('sa-result-area').innerHTML = _wrapResultCard(`
  ${_buildResultHead(`${_human(metric)} Comparison`, `Top vs Bottom performer ${pLabel}`)}
  ${_buildPeriodRow(period)}
  <div class="sa-compare-grid">${cards}</div>
  ${all_data.length > 2 ? `
  <div class="sa-compare-all-head">All SDRs</div>
  ${_buildTable(all_data, metric)}` : ''}
`);

    _animateIn();
    _bindPeriodBtns(r);
    _on('sa-save-btn', 'click', () => _openModal(_currentQuery));
}

// ─── Renderer: Multi ─────────────────────────────────────────────────────────
function _renderMulti(r) {
    const { results = [], group_by, period } = r;
    if (!results.length) { _showEmpty(); return; }

    const blocks = results.map((res, i) => {
        if (!res.data?.length) return `<div class="sa-multi-block sa-multi-empty">No data for ${_human(res.metric)}</div>`;
        const isLine = res.chart_type === 'line';
        return `
<div class="sa-multi-block">
  <div class="sa-multi-block-title">${_human(res.metric)}</div>
  ${isLine
    ? `<div class="sa-chart-wrap" style="height:200px"><canvas id="sa-chart-${i}"></canvas></div>`
    : `<div class="sa-chart-wrap" style="height:180px"><canvas id="sa-chart-${i}"></canvas></div>`}
  ${_buildTable(res.data.slice(0, 8), res.metric)}
</div>`;
    }).join('');

    const pLabel = period ? `· ${_human(period)}` : '';

    _el('sa-result-area').innerHTML = _wrapResultCard(`
  ${_buildResultHead(
      results.map(res => _human(res.metric)).join(' & ') + ' by ' + _human(group_by || 'SDR'),
      `${results.length} metrics ${pLabel}`
  )}
  ${_buildPeriodRow(period)}
  <div class="sa-multi-grid">${blocks}</div>
`);

    _animateIn();
    _bindPeriodBtns(r);
    _on('sa-save-btn', 'click', () => _openModal(_currentQuery));

    // Render each chart
    results.forEach((res, i) => {
        if (res.data?.length) {
            _renderChartById(`sa-chart-${i}`, res.data, res.chart_type, _human(res.metric));
        }
    });
}

// ─── Renderer: Funnel ─────────────────────────────────────────────────────────
function _renderFunnel(r) {
    const { steps = [], sdr_name, period, meta } = r;
    if (!steps.length) { _showEmpty(); return; }

    const pLabel = period ? `· ${_human(period)}` : '';
    const title  = sdr_name ? `${sdr_name}'s Pipeline` : 'Team Pipeline';

    const gapStep   = steps.find(s => s.is_gap);
    const gapBanner = gapStep ? `
<div class="sa-funnel-gap-banner">
  <span class="sa-funnel-gap-icon">⚡</span>
  <strong>Bottleneck detected:</strong> ${_esc(gapStep.label)} (${gapStep.pct}% of leads)
</div>` : '';

    const stepHtml = steps.map(s => {
        const isGap = s.is_gap;
        const width = Math.max(s.pct, 5);
        return `
<div class="sa-funnel-step ${isGap ? 'sa-funnel-step-gap' : ''}">
  <div class="sa-funnel-step-label">
    <span class="sa-funnel-icon">${s.icon}</span>
    <span>${_esc(s.label)}</span>
  </div>
  <div class="sa-funnel-bar-wrap">
    <div class="sa-funnel-bar ${isGap ? 'sa-funnel-bar-gap' : ''}" style="width:${width}%"></div>
  </div>
  <div class="sa-funnel-step-stats">
    <span class="sa-funnel-count">${(s.value || 0).toLocaleString()}</span>
    <span class="sa-funnel-pct ${isGap ? 'sa-funnel-pct-gap' : ''}">${s.pct}%</span>
  </div>
</div>`;
    }).join('');

    _el('sa-result-area').innerHTML = _wrapResultCard(`
  ${_buildResultHead(title, `Full pipeline breakdown ${pLabel}`)}
  ${_buildPeriodRow(period)}
  ${gapBanner}
  <div class="sa-funnel">${stepHtml}</div>
`);

    _animateIn();
    _bindPeriodBtns(r);
    _on('sa-save-btn', 'click', () => _openModal(_currentQuery));
}

function _showEmpty() {
    _el('sa-result-area').innerHTML = `
<div class="sa-state sa-state-info">
  <div class="sa-state-icon">📭</div>
  <div>
    <div class="sa-state-title">No data for this period</div>
    <div class="sa-state-body">Try a wider time range or a different metric.</div>
  </div>
</div>`;
}

// ─── Period row + re-run ──────────────────────────────────────────────────────
function _buildPeriodRow(activePeriod) {
    const btns = QUICK_PERIODS.map(p =>
        `<button class="sa-period-btn${activePeriod === p.value ? ' sa-period-active' : ''}" data-period="${p.value}">${p.label}</button>`
    ).join('');
    return `<div class="sa-period-row">${btns}</div>`;
}

// Period pill re-run — bypasses conversation history and backend log.
// Period changes are NOT new queries: they don't add to Recent chips,
// don't add to conv bubbles, and don't call _loadHistory().
async function _rerunWithPeriod(r, period) {
    const PERIOD_PHRASE_RE = /\b(today|yesterday|this week|this month|this quarter|this year|last week|last month|last year|last \d+ days?)\b/gi;
    const periodWords = {
        today: 'today', this_week: 'this week', this_month: 'this month',
        last_30_days: 'last 30 days', last_90_days: 'last 90 days',
        last_7_days: 'last 7 days', this_year: 'this year', this_quarter: 'this quarter',
        yesterday: 'yesterday',
    };
    const periodPhrase = periodWords[period] || period.replace(/_/g, ' ');
    const base = _currentQuery.replace(PERIOD_PHRASE_RE, '').replace(/\s+/g, ' ').trim();
    const newQuery = `${base} ${periodPhrase}`.trim();

    _setLoading(true);
    _clearResult();

    try {
        const body = { query: newQuery };
        if (_filterPod)   body.filter_pod   = _filterPod.name;
        if (_filterBatch) body.filter_batch = _filterBatch.label;
        // Pass conversation history so LLM has context, but DO NOT add the
        // period re-run itself to conversation history
        body.conversation_history = _conversationHistory.slice(-4);
        const res = await _post('/api/admin/smart-analytics/query', body);
        _setLoading(false);
        if (!res || res.action === 'clarify' || res.action === 'unsupported') {
            _renderResult(r); // Restore original
            return;
        }
        _currentResult = res;
        _currentDSL    = res.dsl;
        _currentQuery  = newQuery;
        _renderResult(res);
        // ❌ NO _loadHistory() — period rerun should NOT appear in Recent chips
        // ❌ NO _addToConvHistory() — don't pollute conv bubbles
    } catch {
        _setLoading(false);
        _renderResult(r); // Restore original on error
    }
}

function _bindPeriodBtns(r) {
    document.querySelectorAll('.sa-period-btn').forEach(btn => {
        btn.addEventListener('click', () => _rerunWithPeriod(r, btn.dataset.period));
    });
}

// ─── Renderer: Pod Summary ───────────────────────────────────────────────────────────
function _renderPodSummary(r) {
    const { rows = [], period, meta } = r;
    if (!rows.length) { _showEmpty(); return; }

    const pLabel = period ? `· ${_human(period)}` : '';

    // Find max values for mini bar calculation
    const maxLeads    = Math.max(...rows.map(r => r.leads    || 0), 1);
    const maxCalls    = Math.max(...rows.map(r => r.calls    || 0), 1);
    const maxMeetings = Math.max(...rows.map(r => r.meetings || 0), 1);

    const rowHtml = rows.map(r => {
        const connectStr    = r.connect_rate    != null ? `${r.connect_rate}%`    : '—';
        const convStr       = r.conversion_rate != null ? `${r.conversion_rate}%` : '—';
        const leadsBar  = Math.round((r.leads    || 0) / maxLeads    * 80);
        const callsBar  = Math.round((r.calls    || 0) / maxCalls    * 80);
        const meetBar   = Math.round((r.meetings || 0) / maxMeetings * 80);
        return `
  <tr class="sa-tr">
    <td class="sa-td sa-td-pod">${_esc(r.label)}</td>
    <td class="sa-td sa-td-num">
      <div class="sa-bar-wrap"><div class="sa-bar-fill" style="width:${leadsBar}%"></div></div>
      <span>${r.leads ?? 0}</span>
    </td>
    <td class="sa-td sa-td-num">
      <div class="sa-bar-wrap"><div class="sa-bar-fill" style="width:${callsBar}%"></div></div>
      <span>${r.calls ?? 0}</span>
    </td>
    <td class="sa-td sa-td-num">${connectStr}</td>
    <td class="sa-td sa-td-num">
      <div class="sa-bar-wrap"><div class="sa-bar-fill" style="width:${meetBar}%"></div></div>
      <span>${r.meetings ?? 0}</span>
    </td>
    <td class="sa-td sa-td-num">${convStr}</td>
  </tr>`;
    }).join('');

    const title = `Pod Summary`;
    _el('sa-result-area').innerHTML = _wrapResultCard(`
  ${_buildResultHead(title, `${rows.length} pod${rows.length !== 1 ? 's' : ''} ${pLabel}`)}
  ${_buildPeriodRow(period)}
  <div class="sa-table-wrap">
    <table class="sa-table">
      <thead><tr>
        <th class="sa-th">Pod</th>
        <th class="sa-th sa-th-val">Leads</th>
        <th class="sa-th sa-th-val">Calls</th>
        <th class="sa-th sa-th-val">Connect %</th>
        <th class="sa-th sa-th-val">Meetings</th>
        <th class="sa-th sa-th-val">Conversion %</th>
      </tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>
  </div>
`);

    _animateIn();
    _bindPeriodBtns(r);
    _on('sa-save-btn', 'click', () => _openModal(_currentQuery));
}


// ─── Shared helpers ───────────────────────────────────────────────────────────
// Build the sticky card header with optional query echo + active filter badges
function _buildResultHead(title, meta) {
    const queryEcho = _currentQuery
        ? `<div class="sa-result-query">"⁠${_esc(_currentQuery)}"⁠</div>`
        : '';
    // Active context filter badges
    const badges = [
        _filterPod   ? `<span class="sa-filter-badge">🏢 ${_esc(_filterPod.name)}</span>`   : '',
        _filterBatch ? `<span class="sa-filter-badge">📦 ${_esc(_filterBatch.label)}</span>` : '',
    ].filter(Boolean).join('');
    return `
  <div class="sa-result-head">
    <div style="flex:1;min-width:0">
      ${queryEcho}
      ${badges ? `<div class="sa-filter-badges">${badges}</div>` : ''}
      <div class="sa-result-title">${_esc(title)}</div>
      <div class="sa-result-meta">${_esc(meta)}</div>
    </div>
    <button id="sa-save-btn" class="sa-save-btn">📌 Save</button>
  </div>`;
}

function _wrapResultCard(inner) {
    // The result-head inside is sticky so Save is always visible
    return `<div class="sa-result-card" id="sa-result-card">${inner}</div>`;
}

function _animateIn() {
    requestAnimationFrame(() => {
        const card = _el('sa-result-card');
        if (card) card.classList.add('sa-result-visible');
    });
}

function _buildTable(data, metric) {
    if (!data?.length) return '';
    const hasCalls = data.some(d => d.calls !== undefined);
    const rows = data.slice(0, 100).map((row, i) => `
<tr>
  <td class="sa-td sa-td-idx">${i + 1}</td>
  <td class="sa-td sa-td-name">${_esc(String(row.label ?? '—'))}${row.medal ? ` ${row.medal}` : ''}</td>
  <td class="sa-td sa-td-bar">${_miniBar(row.value, data)}</td>
  <td class="sa-td sa-td-val">${_fmtVal(row.value, metric)}</td>
  ${hasCalls ? `<td class="sa-td sa-td-sub">${row.calls ?? '—'} calls</td>` : ''}
</tr>`).join('');

    return `
<div class="sa-table-wrap">
  <table class="sa-table">
    <thead><tr>
      <th class="sa-th sa-th-idx">#</th>
      <th class="sa-th">Name</th>
      <th class="sa-th sa-th-bar"></th>
      <th class="sa-th sa-th-val">${_human(metric)}</th>
      ${hasCalls ? `<th class="sa-th sa-th-sub">Calls</th>` : ''}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function _miniBar(value, data) {
    const max = Math.max(...data.map(d => Number(d.value || 0)));
    if (!max) return '<div class="sa-mini-bar-wrap"></div>';
    const pct = Math.round((Number(value || 0) / max) * 100);
    return `<div class="sa-mini-bar-wrap"><div class="sa-mini-bar" style="width:${pct}%"></div></div>`;
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function _renderChart(data, type, label) {
    _renderChartById('sa-chart', data, type, label);
}

function _renderChartById(id, data, type, label) {
    const canvas = _el(id);
    if (!canvas || typeof Chart === 'undefined') return;

    const isLine  = type === 'line';
    const labels  = data.map(d => String(d.label ?? ''));
    const values  = data.map(d => Number(d.value ?? 0));
    const palette = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#84cc16','#f97316'];

    const chart = new Chart(canvas.getContext('2d'), {
        type: isLine ? 'line' : 'bar',
        data: {
            labels,
            datasets: [{
                label,
                data: values,
                backgroundColor: isLine ? 'rgba(99,102,241,0.08)' : palette,
                borderColor:     isLine ? '#6366f1' : palette,
                borderWidth:     isLine ? 2 : 0,
                borderRadius:    isLine ? 0 : 8,
                fill:            isLine,
                tension:         0.4,
                maxBarThickness: 72,
                minBarLength:    4,
                pointBackgroundColor:  '#6366f1',
                pointBorderColor:      '#fff',
                pointBorderWidth:      2,
                pointRadius:           isLine ? 5 : 0,
                pointHoverRadius:      isLine ? 7 : 0,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor:      '#f8fafc',
                    bodyColor:       '#94a3b8',
                    borderColor:     '#334155',
                    borderWidth:     1,
                    padding:         12,
                    cornerRadius:    10,
                    displayColors:   false,
                    callbacks: { label: ctx => `  ${ctx.parsed.y?.toLocaleString() ?? 0}` },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { size: 12 }, maxRotation: 45 },
                    border: { color: '#e2e8f0' },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(148,163,184,0.15)', drawTicks: false },
                    ticks: { color: '#94a3b8', font: { size: 12 }, padding: 8, maxTicksLimit: 6 },
                    border: { display: false },
                },
            },
        },
    });

    // Only store the main chart for cleanup
    if (id === 'sa-chart') _chart = chart;
}

// ─── Saved reports ────────────────────────────────────────────────────────────
async function _loadSavedReports() {
    try {
        _savedReports = await _apiFetch('/api/admin/smart-analytics/reports');
        _renderSaved();
    } catch {}
}

function _renderSaved() {
    const section = _el('sa-saved-section');
    const grid    = _el('sa-saved-grid');
    if (!section || !grid) return;
    if (!_savedReports.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    grid.innerHTML = _savedReports.map(r => `
<div class="sa-saved-card">
  <div class="sa-saved-card-name">${_esc(r.name)}</div>
  <div class="sa-saved-card-q">${_esc(r.natural_language_query || '')}</div>
  <div class="sa-saved-card-btns">
    <button class="sa-saved-run" data-id="${r.id}" data-name="${_esc(r.name)}">▶ Run</button>
    <button class="sa-saved-del" data-id="${r.id}" title="Delete">✕</button>
  </div>
</div>`).join('');

    grid.querySelectorAll('.sa-saved-run').forEach(btn => btn.addEventListener('click', async () => {
        _clearResult();
        _setLoading(true);
        try {
            const res = await _post(`/api/admin/smart-analytics/reports/${btn.dataset.id}/run`, {});
            _setLoading(false);
            _currentResult = res;
            _currentQuery  = res.saved_report?.name || btn.dataset.name || '';
            _renderResult(res);
        } catch (err) {
            _setLoading(false);
            _showError(err?.detail?.message || 'Failed to run report.');
        }
    }));

    grid.querySelectorAll('.sa-saved-del').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Delete this saved report?')) return;
        try {
            await _apiFetch(`/api/admin/smart-analytics/reports/${btn.dataset.id}`, { method: 'DELETE' });
            await _loadSavedReports();
        } catch {}
    }));
}

// ─── History ──────────────────────────────────────────────────────────────────
async function _loadHistory() {
    try {
        const rows  = await _apiFetch('/api/admin/smart-analytics/history');
        const row   = _el('sa-recent-row');
        const chips = _el('sa-recent-chips');
        if (!row || !chips || !rows.length) return;
        row.style.display = 'block';
        chips.innerHTML = rows.map(r =>
            `<button class="sa-recent-chip" data-q="${_esc(r.query)}">${_esc(r.query)}</button>`
        ).join('');
        chips.querySelectorAll('.sa-recent-chip').forEach(c =>
            c.addEventListener('click', () => { _setQuery(c.dataset.q); _submit(); })
        );
    } catch {}
}

// ─── Filter Options ───────────────────────────────────────────────────────────
async function _loadFilterOptions() {
    try {
        const [filters, batches] = await Promise.all([
            _apiFetch('/api/admin/analytics/filters'),
            _apiFetch('/api/admin/smart-analytics/batches').catch(() => []),
        ]);
        _pods    = filters?.pods || [];
        _batches = batches || [];

        const podSel = _el('sa-filter-pod-sel');
        if (podSel && _pods.length) {
            _pods.forEach(p => {
                const o = document.createElement('option');
                o.value = p.id; o.textContent = `🏢 ${p.name}`; o.dataset.name = p.name;
                podSel.appendChild(o);
            });
            podSel.addEventListener('change', () => {
                const sel = podSel.options[podSel.selectedIndex];
                _filterPod = sel.value ? { id: sel.value, name: sel.dataset.name } : null;
                _renderFilterChips();
            });
        }

        const batchSel = _el('sa-filter-batch-sel');
        if (batchSel && _batches.length) {
            _batches.forEach(b => {
                const o = document.createElement('option');
                o.value = b.id; o.textContent = `📦 ${b.label}`; o.dataset.label = b.label;
                batchSel.appendChild(o);
            });
            batchSel.addEventListener('change', () => {
                const sel = batchSel.options[batchSel.selectedIndex];
                _filterBatch = sel.value ? { id: sel.value, label: sel.dataset.label } : null;
                _renderFilterChips();
            });
        }
    } catch (e) { console.warn('Smart Analytics: filter options failed', e); }
}

function _renderFilterChips() {
    const el = _el('sa-filter-chips');
    if (!el) return;
    const chips = [
        _filterPod   ? `<span class="sa-chip-active">🏢 ${_esc(_filterPod.name)} <button class="sa-chip-clear" data-type="pod">✕</button></span>` : '',
        _filterBatch ? `<span class="sa-chip-active">📦 ${_esc(_filterBatch.label)} <button class="sa-chip-clear" data-type="batch">✕</button></span>` : '',
    ].filter(Boolean);
    el.innerHTML = chips.join('');
    el.style.display = chips.length ? 'flex' : 'none';
    el.querySelectorAll('.sa-chip-clear').forEach(btn => btn.addEventListener('click', () => {
        if (btn.dataset.type === 'pod')   { _filterPod = null;   const s = _el('sa-filter-pod-sel');   if (s) s.value = ''; }
        else                              { _filterBatch = null;  const s = _el('sa-filter-batch-sel'); if (s) s.value = ''; }
        _renderFilterChips();
    }));
}

// ─── Save modal ───────────────────────────────────────────────────────────────
function _openModal(query) {
    const inp = _el('sa-modal-name');
    if (inp)  inp.value = query.length > 70 ? query.slice(0, 70) + '…' : query;
    _el('sa-modal').style.display = 'flex';
    setTimeout(() => inp?.select(), 80);
}

function _closeModal() { _el('sa-modal').style.display = 'none'; }

async function _saveReport() {
    if (!_currentResult) return;
    const name = _el('sa-modal-name')?.value?.trim();
    if (!name) { _el('sa-modal-name')?.focus(); return; }

    const btn = _el('sa-modal-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    const mode = _currentResult.mode || 'standard';
    const dslPayload = mode === 'multi'
        ? { mode, metrics: _currentResult.metrics, group_by: _currentResult.group_by, period: _currentResult.period }
        : mode === 'funnel'
        ? { mode, period: _currentResult.period, filter_sdr: _currentResult.sdr_name }
        : { mode, metric: _currentResult.metric, group_by: _currentResult.group_by, period: _currentResult.period };

    try {
        await _post('/api/admin/smart-analytics/reports', {
            name,
            natural_language_query: _currentQuery,
            dsl_json:               JSON.stringify(dslPayload),
            chart_type:             _currentResult.chart_type,
        });
        _closeModal();
        await _loadSavedReports();
        _el('sa-saved-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
        alert('Could not save: ' + (err?.detail?.message || 'Unknown error'));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function _el(id)       { return document.getElementById(id); }
function _on(id,ev,fn) { _el(id)?.addEventListener(ev, fn); }
function _setQuery(q)  {
    const i = _el('sa-input');
    if (!i) return;
    i.value = q;
    _autoResize.call(i);
}
function _autoResize() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 140) + 'px';
}
function _human(s) {
    if (!s) return '';
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function _fmtVal(v, metric) {
    if (v === null || v === undefined) return '—';
    if (metric === 'conversion_rate')   return `${Number(v).toFixed(1)}%`;
    if (metric === 'avg_call_duration') return `${Math.round(Number(v))}s`;
    return Number(v).toLocaleString();
}
function _esc(s) {
    return String(s ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function _apiFetch(url, opts = {}) {
    const resp = await fetch(`${API_BASE}${url}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
    });
    const data = await resp.json();
    if (!resp.ok) throw data;
    return data;
}
function _post(url, body) {
    return _apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function _injectStyles() {
    if (_el('sa-styles')) return;
    const s = document.createElement('style');
    s.id = 'sa-styles';
    s.textContent = `
/* ================================================================
   Smart Analytics v2 — RCM AI Assistant
   Uses app CSS variables: --primary-color, --surface-color, etc.
   ================================================================ */

/* ── Base wrap — centered, single-column before first query ──── */
.sa-wrap {
  max-width: 820px;
  margin: 0 auto;
  padding: 32px 24px 80px;
  font-family: 'Inter', sans-serif;
  display: block;
  transition: max-width 0.3s ease;
}

/* ── Split layout — activated after first query ────────────── */
.sa-wrap.sa-split {
  max-width: 1200px;
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 24px;
  align-items: start;
}

/* Left panel: sticky so it stays while scrolling results */
.sa-left {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Right panel: results */
.sa-right {
  min-width: 0;   /* prevent overflow in grid */
}

/* In split mode the header is more compact */
.sa-split .sa-header {
  margin-bottom: 12px;
}
.sa-split .sa-title {
  font-size: 1.15rem;
}
.sa-split .sa-subtitle {
  display: none;   /* hide tagline in split mode to save space */
}

/* Left footer: new-conv + saved reports */
.sa-left-footer, #sa-left-footer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Header ────────────────────────────────────────── */
.sa-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}
.sa-header-icon {
  width: 44px; height: 44px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.3rem; color: #fff; flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(99,102,241,0.3);
}
.sa-header-text { flex: 1; }
.sa-title { font-size: 1.45rem; font-weight: 700; color: var(--text-main); letter-spacing: -0.02em; margin: 0 0 3px; }
.sa-subtitle { font-size: 0.84rem; color: var(--text-muted); margin: 0; }
.sa-new-conv-btn {
  width: 100%;
  background: none; border: 1px solid var(--border-color);
  color: var(--text-muted); border-radius: 8px; padding: 8px 12px;
  font-size: 0.82rem; cursor: pointer; font-family: inherit;
  transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 6px;
}
.sa-new-conv-btn:hover { border-color: var(--primary-color); color: var(--primary-color); background: #f0f0ff; }

/* ── Conversation history ────────────────────────────── */
.sa-conv-history { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.sa-conv-bubble {
  display: flex; gap: 8px; align-items: flex-start;
  font-size: 0.84rem; color: var(--text-muted);
}
.sa-conv-icon { color: var(--primary-color); font-size: 0.6rem; margin-top: 5px; flex-shrink: 0; }
.sa-conv-text { font-style: italic; }

/* ── Input card ─────────────────────────────────────────────────── */
.sa-input-card {
  background: var(--surface-color); border: 1px solid var(--border-color);
  border-radius: 16px; padding: 16px 20px; margin-bottom: 16px;
  box-shadow: var(--shadow-sm); transition: box-shadow 0.2s;
}
.sa-input-card:focus-within {
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1), var(--shadow-sm);
  border-color: #a5b4fc;
}
.sa-input-row { display: flex; gap: 12px; align-items: flex-end; }
.sa-input {
  flex: 1; background: none; border: none; outline: none;
  font-size: 1rem; color: var(--text-main); resize: none; line-height: 1.55;
  font-family: inherit; min-height: 26px; max-height: 140px; padding: 0;
}
.sa-input::placeholder { color: var(--text-muted); }
.sa-ask-btn {
  background: var(--primary-color); color: #fff; border: none;
  border-radius: 10px; padding: 10px 22px; font-size: 0.9rem; font-weight: 600;
  cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  font-family: inherit; transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
  min-width: 70px; justify-content: center; white-space: nowrap;
  box-shadow: 0 2px 8px rgba(79,70,229,0.25);
}
.sa-ask-btn:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(79,70,229,0.35); }
.sa-ask-btn:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
.sa-spin {
  width: 16px; height: 16px; border: 2.5px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%; animation: sa-spin 0.6s linear infinite;
}
@keyframes sa-spin { to { transform: rotate(360deg); } }

.sa-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.sa-ex-btn {
  background: var(--background-color); border: 1px solid var(--border-color);
  color: var(--text-muted); border-radius: 20px; padding: 5px 13px;
  font-size: 0.78rem; cursor: pointer; transition: all 0.15s; font-family: inherit; white-space: nowrap;
}
.sa-ex-btn:hover { border-color: var(--primary-color); color: var(--primary-color); background: #f0f0ff; }

.sa-divider { height: 1px; background: var(--border-color); margin: 12px 0 10px; }
.sa-recent { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sa-recent-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); white-space: nowrap; }
.sa-recent-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sa-recent-chip {
  background: #ede9fe; border: 1px solid #ddd6fe; color: #7c3aed;
  border-radius: 20px; padding: 4px 12px; font-size: 0.76rem; cursor: pointer;
  font-family: inherit; transition: all 0.15s; white-space: nowrap;
}
.sa-recent-chip:hover { background: #ddd6fe; }

/* ── Thinking ────────────────────────────────────────────────────── */
.sa-thinking { display: flex; align-items: center; gap: 10px; padding: 14px 0; color: var(--text-muted); font-size: 0.88rem; }
.sa-thinking-dots { display: flex; gap: 4px; }
.sa-thinking-dots span { width: 6px; height: 6px; background: var(--primary-color); border-radius: 50%; animation: sa-bounce 1s ease-in-out infinite; opacity: 0.6; }
.sa-thinking-dots span:nth-child(2) { animation-delay: 0.15s; }
.sa-thinking-dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes sa-bounce { 0%,80%,100% { transform:scale(0.7); opacity:0.4; } 40% { transform:scale(1); opacity:1; } }

/* ── States ──────────────────────────────────────────────────────── */
.sa-state { display: flex; gap: 14px; align-items: flex-start; padding: 16px 20px; border-radius: 12px; border: 1px solid; font-size: 0.9rem; margin-bottom: 16px; }
.sa-state-error   { background: #fef2f2; border-color: #fecaca; color: #7f1d1d; }
.sa-state-info    { background: var(--surface-color); border-color: var(--border-color); color: var(--text-main); }
.sa-state-clarify { background: var(--surface-color); border-color: #a5b4fc; color: var(--text-main); }
.sa-state-icon    { font-size: 1.1rem; flex-shrink: 0; padding-top: 1px; }
.sa-state-title   { font-weight: 600; margin-bottom: 4px; }
.sa-state-body    { color: var(--text-muted); font-size: 0.84rem; }
.sa-clarify-row   { display: flex; gap: 8px; margin-top: 10px; }
.sa-clarify-input {
  flex: 1; padding: 8px 12px; border: 1.5px solid var(--border-color); border-radius: 8px;
  font-size: 0.9rem; outline: none; font-family: inherit; background: var(--background-color);
  color: var(--text-main); transition: border-color 0.15s;
}
.sa-clarify-input:focus { border-color: var(--primary-color); }
.sa-clarify-hints { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.sa-hint-btn {
  background: #f0f0ff; border: 1px solid #a5b4fc; color: var(--primary-color);
  border-radius: 20px; padding: 4px 12px; font-size: 0.76rem;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.sa-hint-btn:hover { background: #ddd6fe; }

/* ── Result card ────────────────────────────────────────── */
.sa-result-card {
  background: var(--surface-color); border: 1px solid var(--border-color);
  border-radius: 16px; overflow: hidden; box-shadow: var(--shadow-sm);
  margin-bottom: 20px;
  opacity: 0; transform: translateY(8px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.sa-result-card.sa-result-visible { opacity: 1; transform: translateY(0); }

/* Sticky header: Save button always visible when scrolling */
.sa-result-head {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--surface-color);
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.sa-result-title { font-size: 0.95rem; font-weight: 700; color: var(--text-main); letter-spacing: -0.01em; }
.sa-result-query {
  font-size: 0.75rem; color: #7c3aed; font-style: italic;
  margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
}
.sa-result-meta  { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; }

/* Filter row + chips */
.sa-filter-row {
  display: flex; gap: 8px; padding: 8px 0 4px; flex-wrap: wrap;
}
.sa-filter-sel {
  flex: 1; min-width: 120px; font-size: 0.78rem; font-family: inherit;
  border: 1px solid var(--border-color); border-radius: 8px;
  background: var(--card-bg); color: var(--text-main);
  padding: 5px 8px; cursor: pointer; outline: none;
  transition: border-color 0.15s;
}
.sa-filter-sel:focus { border-color: var(--primary-color); }
.sa-filter-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 0 6px; }
.sa-chip-active {
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(124,58,237,0.1); color: #7c3aed;
  border: 1px solid rgba(124,58,237,0.25); border-radius: 20px;
  font-size: 0.75rem; padding: 3px 10px; font-weight: 500;
}
.sa-chip-clear {
  background: none; border: none; cursor: pointer; color: #7c3aed;
  font-size: 0.7rem; padding: 0 2px; line-height: 1;
  opacity: 0.6; transition: opacity 0.1s;
}
.sa-chip-clear:hover { opacity: 1; }

/* Filter badges on result card */
.sa-filter-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.sa-filter-badge {
  display: inline-block; background: rgba(124,58,237,0.08);
  color: #7c3aed; border-radius: 12px; font-size: 0.7rem;
  padding: 2px 8px; font-weight: 500;
}

/* Pod summary specific */
.sa-td-pod { font-weight: 600; min-width: 120px; }
.sa-save-btn {
  background: none; border: 1px solid var(--border-color); color: var(--text-muted);
  border-radius: 8px; padding: 6px 12px; font-size: 0.78rem; font-weight: 500;
  cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap;
}
.sa-save-btn:hover { border-color: var(--primary-color); color: var(--primary-color); background: #f0f0ff; }

/* Period pills */
.sa-period-row {
  display: flex; gap: 6px; padding: 10px 20px;
  border-bottom: 1px solid var(--border-color); background: var(--background-color);
  overflow-x: auto; scrollbar-width: none;
}
.sa-period-row::-webkit-scrollbar { display: none; }
.sa-period-btn {
  background: none; border: 1px solid var(--border-color); color: var(--text-muted);
  border-radius: 20px; padding: 4px 12px; font-size: 0.75rem; font-weight: 500;
  cursor: pointer; font-family: inherit; white-space: nowrap; transition: all 0.15s;
}
.sa-period-btn:hover { border-color: var(--primary-color); color: var(--primary-color); }
.sa-period-active { background: var(--primary-color) !important; color: #fff !important; border-color: var(--primary-color) !important; }

/* Chart */
.sa-chart-wrap { padding: 20px 20px 8px; height: 280px; position: relative; }

/* Table */
.sa-table-wrap { overflow-x: auto; }
.sa-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.sa-th { padding: 9px 16px; text-align: left; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); border-bottom: 1px solid var(--border-color); background: var(--background-color); }
.sa-th-idx { width: 36px; color: transparent; }
.sa-th-bar { width: 120px; }
.sa-th-val, .sa-td-val { text-align: right; }
.sa-th-sub, .sa-td-sub { text-align: right; color: var(--text-muted); }
.sa-td { padding: 11px 16px; color: var(--text-main); border-bottom: 1px solid rgba(0,0,0,0.04); vertical-align: middle; }
.sa-td-idx { color: var(--text-muted); font-size: 0.75rem; }
.sa-td-name { font-weight: 500; }
.sa-td-val { font-weight: 600; font-variant-numeric: tabular-nums; }
.sa-table tbody tr:hover { background: #f8fafc; }
.sa-table tbody tr:last-child .sa-td { border-bottom: none; }
.sa-row-top    { background: #f5f3ff !important; }
.sa-row-bottom { background: #fef2f2 !important; }

/* Mini bar */
.sa-mini-bar-wrap { height: 6px; background: var(--background-color); border-radius: 99px; overflow: hidden; min-width: 60px; }
.sa-mini-bar { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 99px; transition: width 0.6s cubic-bezier(0.16,1,0.3,1); min-width: 3px; }

/* ── Compare mode ────────────────────────────────────────────────── */
.sa-compare-grid { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.sa-compare-pair { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; }
.sa-compare-side { background: var(--background-color); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; text-align: center; }
.sa-compare-badge { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 6px; }
.sa-compare-name { font-size: 0.95rem; font-weight: 700; color: var(--text-main); margin-bottom: 4px; }
.sa-compare-val  { font-size: 1.5rem; font-weight: 800; color: var(--primary-color); font-variant-numeric: tabular-nums; }
.sa-compare-vs { text-align: center; }
.sa-compare-delta { font-size: 1.25rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.sa-compare-delta-label { font-size: 0.7rem; color: var(--text-muted); }
.sa-compare-delta-pct { font-size: 0.78rem; color: var(--text-muted); }
.sa-delta-pos { color: #16a34a; }
.sa-delta-neg { color: #dc2626; }
.sa-compare-top  { border-color: #a5b4fc; background: #f5f3ff; }
.sa-compare-bottom { border-color: #fca5a5; background: #fef2f2; }
.sa-compare-all-head { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0 20px 8px; }

/* ── Multi mode ─────────────────────────────────────────────────── */
.sa-multi-grid { display: flex; flex-direction: column; }
.sa-multi-block { border-bottom: 1px solid var(--border-color); padding: 16px 0 0; }
.sa-multi-block:last-child { border-bottom: none; }
.sa-multi-block-title { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); padding: 0 20px 8px; }
.sa-multi-block .sa-chart-wrap { padding: 0 20px 8px; }
.sa-multi-empty { padding: 20px; color: var(--text-muted); font-size: 0.84rem; text-align: center; }

/* ── Funnel mode ─────────────────────────────────────────────────── */
.sa-funnel-gap-banner {
  margin: 12px 20px 0; padding: 12px 16px;
  background: #fef2f2; border: 1px solid #fca5a5; border-radius: 10px;
  font-size: 0.84rem; color: #7f1d1d; display: flex; align-items: center; gap: 8px;
}
.sa-funnel-gap-icon { font-size: 1rem; }
.sa-funnel { padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
.sa-funnel-step { display: grid; grid-template-columns: 160px 1fr auto; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 10px; transition: background 0.15s; }
.sa-funnel-step:hover { background: var(--background-color); }
.sa-funnel-step-gap { background: #fef9f2 !important; border: 1px solid #fed7aa; }
.sa-funnel-step-label { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; font-weight: 500; color: var(--text-main); }
.sa-funnel-icon { font-size: 1rem; }
.sa-funnel-bar-wrap { background: var(--background-color); border-radius: 99px; height: 8px; overflow: hidden; border: 1px solid var(--border-color); }
.sa-funnel-bar { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 99px; transition: width 0.8s cubic-bezier(0.16,1,0.3,1); }
.sa-funnel-bar-gap { background: linear-gradient(90deg, #f97316, #ef4444); }
.sa-funnel-step-stats { display: flex; align-items: center; gap: 10px; min-width: 80px; justify-content: flex-end; }
.sa-funnel-count { font-size: 0.88rem; font-weight: 600; color: var(--text-main); font-variant-numeric: tabular-nums; }
.sa-funnel-pct { font-size: 0.78rem; font-weight: 700; color: var(--text-muted); min-width: 36px; text-align: right; }
.sa-funnel-pct-gap { color: #f97316; }

/* ── Saved reports ────────────────────────────────────────────────── */
.sa-saved-heading { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 12px; }
.sa-saved-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap: 12px; }
.sa-saved-card { background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; transition: box-shadow 0.15s, border-color 0.15s; }
.sa-saved-card:hover { box-shadow: var(--shadow-md); border-color: #a5b4fc; }
.sa-saved-card-name { font-size: 0.88rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sa-saved-card-q { font-size: 0.76rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sa-saved-card-btns { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.sa-saved-run { background: none; border: none; color: var(--primary-color); font-size: 0.78rem; font-weight: 600; cursor: pointer; padding: 0; font-family: inherit; transition: opacity 0.15s; }
.sa-saved-run:hover { opacity: 0.7; }
.sa-saved-del { background: none; border: none; color: var(--text-muted); font-size: 0.78rem; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-family: inherit; transition: color 0.15s, background 0.15s; }
.sa-saved-del:hover { color: #ef4444; background: #fef2f2; }

/* ── Shared buttons ─────────────────────────────────────────────── */
.sa-primary-btn { background: var(--primary-color); color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 0.88rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s; }
.sa-primary-btn:hover { background: var(--primary-hover); }
.sa-cancel-btn { background: none; border: 1px solid var(--border-color); color: var(--text-muted); border-radius: 8px; padding: 9px 18px; font-size: 0.88rem; cursor: pointer; font-family: inherit; }
.sa-cancel-btn:hover { border-color: var(--secondary-color); }

/* ── Modal ─────────────────────────────────────────────────────── */
.sa-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.4); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; }
.sa-modal-box { background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 16px; padding: 28px; width: 400px; max-width: 92vw; box-shadow: 0 24px 64px rgba(0,0,0,0.15); }
.sa-modal-title { font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin-bottom: 16px; letter-spacing: -0.01em; }
.sa-modal-input { width: 100%; padding: 10px 14px; border: 1.5px solid var(--border-color); border-radius: 8px; font-size: 0.9rem; outline: none; box-sizing: border-box; font-family: inherit; color: var(--text-main); background: var(--background-color); margin-bottom: 20px; transition: border-color 0.15s; }
.sa-modal-input:focus { border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
.sa-modal-actions { display: flex; justify-content: flex-end; gap: 10px; }

/* ── Responsive ─────────────────────────────────────────────────── */
/* Collapse split to single column below 900px */
@media (max-width: 900px) {
  .sa-wrap.sa-split {
    grid-template-columns: 1fr;
    max-width: 760px;
  }
  .sa-left { position: static; }
  .sa-right { display: block !important; }
  .sa-split .sa-subtitle { display: block; }
}
@media (max-width: 600px) {
  .sa-wrap { padding: 16px 12px 48px; }
  .sa-wrap.sa-split { padding: 16px 12px 48px; gap: 16px; }
  .sa-saved-grid { grid-template-columns: 1fr; }
  .sa-chart-wrap { height: 220px; }
  .sa-compare-pair { grid-template-columns: 1fr; }
  .sa-compare-vs { order: -1; display: flex; justify-content: center; gap: 16px; }
  .sa-funnel-step { grid-template-columns: 120px 1fr auto; }
  .sa-result-head { position: static; }  /* sticky less useful on mobile */
}
`;
    document.head.appendChild(s);
}
