// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  call_monitor.js — Unified call monitor view for Super Admin / Pod Admin ║
// ║  Shows all calls across the team with inline audio, filters, and stats.  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import { API_BASE, authHeaders } from '../auth.js';
import { showToast, bindRecordingRetry, downloadRecordingFresh, parseTranscript, escapeHtml as _esc } from '../utils.js';
const API = API_BASE;

// ── State ──────────────────────────────────────────────────────────────────
let _filters    = { sdr_id: '', provider: '', direction: '', outcome: '', date_from: '', date_to: '', has_recording: '', search: '' };
let _page       = 1;
let _perPage    = 25;
let _totalPages = 1;
let _refreshTimer = null;
let _autoRefresh  = true;
let _expandedRow  = null;   // currently expanded call id
let _activeAudio  = null;   // <audio> element currently playing
let _abortCtrl   = null;   // AbortController for in-flight fetch — prevents race (E12/E14)

export async function renderCallMonitor(container) {
    container.innerHTML = `
    <div class="cm-root">

        <!-- Header ─────────────────────────────────────────────────────── -->
        <div class="cm-header">
            <div>
                <h1 class="cm-title">📞 Call Monitor</h1>
                <p class="cm-subtitle">Real-time call activity across your team</p>
            </div>
            <div class="cm-header-actions">
                <button class="cm-refresh-btn" id="cm-refresh-toggle" title="Toggle auto-refresh">
                    <span class="cm-refresh-dot" id="cm-refresh-dot"></span>
                    <span id="cm-refresh-label">Auto-refresh: ON</span>
                </button>
                <span class="cm-last-updated" id="cm-last-updated"></span>
                <button class="btn btn-outline cm-export-btn" id="cm-export-btn">↓ Export CSV</button>
            </div>
        </div>

        <!-- Filter Bar ─────────────────────────────────────────────────── -->
        <div class="cm-filter-card" id="cm-filter-bar">
            <div class="cm-filter-row">
                <select class="cm-filter-select" id="cm-filter-sdr">
                    <option value="">All SDRs</option>
                </select>
                <select class="cm-filter-select" id="cm-filter-provider">
                    <option value="">All Providers</option>
                    <option value="rcm">📞 RCM</option>
                    <option value="aircall">✈️ Aircall</option>
                    <option value="klenty">📲 Klenty</option>
                    <option value="manual">📋 Manual</option>
                </select>
                <select class="cm-filter-select" id="cm-filter-direction">
                    <option value="">All Directions</option>
                    <option value="outbound">↗ Outbound</option>
                    <option value="inbound">↙ Inbound</option>
                </select>
                <select class="cm-filter-select" id="cm-filter-outcome">
                    <option value="">All Outcomes</option>
                    <option value="Interested">Interested</option>
                    <option value="No Answer">No Answer</option>
                    <option value="Left Voicemail">Left Voicemail</option>
                    <option value="Call Back Later">Call Back Later</option>
                    <option value="Meeting Scheduled">Meeting Scheduled</option>
                    <option value="Not Interested">Not Interested</option>
                    <option value="Not the Right Person">Not the Right Person</option>
                </select>
                <input type="date" class="cm-filter-select" id="cm-filter-date-from" title="From date">
                <input type="date" class="cm-filter-select" id="cm-filter-date-to" title="To date">
                <label class="cm-recording-toggle" title="Only show calls with a recording">
                    <input type="checkbox" id="cm-filter-has-recording">
                    <span>🎙️ Has Recording</span>
                </label>
                <div class="cm-search-wrap">
                    <input type="text" class="cm-filter-select" id="cm-filter-search"
                           placeholder="🔍 Search lead or company…" style="min-width:200px;">
                </div>
                <button class="btn btn-primary cm-apply-btn" id="cm-apply-btn">Apply</button>
                <button class="btn btn-outline cm-reset-btn" id="cm-reset-btn">Reset</button>
            </div>
        </div>

        <!-- Stat Strip ─────────────────────────────────────────────────── -->
        <div class="cm-stat-strip" id="cm-stat-strip">
            <div class="cm-stat-card">
                <div class="cm-stat-icon cm-stat-icon--blue">📊</div>
                <div>
                    <div class="cm-stat-value" id="cm-stat-total">—</div>
                    <div class="cm-stat-label">Total Calls</div>
                </div>
            </div>
            <div class="cm-stat-card">
                <div class="cm-stat-icon cm-stat-icon--green">⏱️</div>
                <div>
                    <div class="cm-stat-value" id="cm-stat-avg">—</div>
                    <div class="cm-stat-label">Avg Duration</div>
                </div>
            </div>
            <div class="cm-stat-card">
                <div class="cm-stat-icon cm-stat-icon--teal">✅</div>
                <div>
                    <div class="cm-stat-value" id="cm-stat-connected">—</div>
                    <div class="cm-stat-label">Connected</div>
                </div>
            </div>
            <div class="cm-stat-card">
                <div class="cm-stat-icon cm-stat-icon--red">❌</div>
                <div>
                    <div class="cm-stat-value cm-stat-value--red" id="cm-stat-failed">—</div>
                    <div class="cm-stat-label">Failed</div>
                </div>
            </div>
        </div>

        <!-- Table ──────────────────────────────────────────────────────── -->
        <div class="cm-table-card">
            <div id="cm-table-wrap">
                <div class="cm-loading">Loading calls…</div>
            </div>
            <div class="cm-pagination" id="cm-pagination" style="display:none;">
                <span class="cm-page-info" id="cm-page-info"></span>
                <div class="cm-page-btns">
                    <button class="btn btn-outline cm-page-btn" id="cm-prev-btn">← Prev</button>
                    <button class="btn btn-outline cm-page-btn" id="cm-next-btn">Next →</button>
                </div>
            </div>
        </div>

    </div>`;

    _attachEvents(container);
    await _loadData(container);
    _startAutoRefresh(container);
}

// ── Events ─────────────────────────────────────────────────────────────────

// ── E13: Inline date-range validation ────────────────────────────────────────
// Shows an inline error inside the filter bar when From > To.
// The API is never called while dates are invalid.
function _validateDateRange(container) {
    const fromEl = container.querySelector('#cm-filter-date-from');
    const toEl   = container.querySelector('#cm-filter-date-to');
    const errEl  = container.querySelector('#cm-date-range-err');
    if (!fromEl || !toEl) return true;
    const from = fromEl.value;
    const to   = toEl.value;
    if (from && to && from > to) {
        if (errEl) {
            errEl.textContent = '⚠ "From" date must be on or before "To" date.';
            errEl.style.display = 'block';
        }
        return false;
    }
    if (errEl) errEl.style.display = 'none';
    return true;
}

function _attachEvents(container) {
    // Inject the date-error element into the filter bar (once)
    const filterBar = container.querySelector('#cm-filter-bar');
    if (filterBar && !filterBar.querySelector('#cm-date-range-err')) {
        const errDiv = document.createElement('div');
        errDiv.id = 'cm-date-range-err';
        errDiv.style.cssText = [
            'display:none', 'grid-column:1/-1', 'margin-top:4px',
            'padding:7px 12px', 'background:#fef2f2', 'color:#b91c1c',
            'border:1px solid #fecaca', 'border-radius:8px',
            'font-size:0.82rem', 'font-weight:600',
        ].join(';');
        filterBar.querySelector('.cm-filter-row')?.appendChild(errDiv);
    }

    container.querySelector('#cm-apply-btn').addEventListener('click', () => {
        _page = 1;
        _readFilters(container);
        if (!_validateDateRange(container)) return;  // E13: block API call
        _loadData(container);
    });
    container.querySelector('#cm-reset-btn').addEventListener('click', () => {
        _page = 1;
        _resetFilters(container);
        const errEl = container.querySelector('#cm-date-range-err');
        if (errEl) errEl.style.display = 'none';
        _loadData(container);
    });

    // Validate on date-field change for immediate feedback (no need to click Apply)
    ['cm-filter-date-from', 'cm-filter-date-to'].forEach(id => {
        container.querySelector(`#${id}`)?.addEventListener('change', () => {
            _validateDateRange(container);
        });
    });

    container.querySelector('#cm-prev-btn').addEventListener('click', () => {
        if (_page > 1) { _page--; _loadData(container); }
    });
    container.querySelector('#cm-next-btn').addEventListener('click', () => {
        if (_page < _totalPages) { _page++; _loadData(container); }
    });

    container.querySelector('#cm-refresh-toggle').addEventListener('click', () => {
        _autoRefresh = !_autoRefresh;
        const dot   = container.querySelector('#cm-refresh-dot');
        const label = container.querySelector('#cm-refresh-label');
        dot.classList.toggle('cm-refresh-dot--off', !_autoRefresh);
        label.textContent = `Auto-refresh: ${_autoRefresh ? 'ON' : 'OFF'}`;
        if (_autoRefresh) _startAutoRefresh(container); else _stopAutoRefresh();
    });

    container.querySelector('#cm-export-btn').addEventListener('click', () => _exportCSV(container));

    // Debounced search on Enter
    container.querySelector('#cm-filter-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { _page = 1; _readFilters(container); _loadData(container); }
    });
}

function _readFilters(container) {
    const get = id => container.querySelector(`#${id}`)?.value?.trim() || '';
    _filters = {
        sdr_id:        get('cm-filter-sdr'),
        provider:      get('cm-filter-provider'),
        direction:     get('cm-filter-direction'),
        outcome:       get('cm-filter-outcome'),
        date_from:     get('cm-filter-date-from'),
        date_to:       get('cm-filter-date-to'),
        has_recording: container.querySelector('#cm-filter-has-recording')?.checked ? 'true' : '',
        search:        get('cm-filter-search'),
    };
}

function _resetFilters(container) {
    ['cm-filter-sdr','cm-filter-provider','cm-filter-direction','cm-filter-outcome','cm-filter-date-from','cm-filter-date-to'].forEach(id => {
        const el = container.querySelector(`#${id}`);
        if (el) el.value = '';
    });
    const hrCB = container.querySelector('#cm-filter-has-recording');
    if (hrCB) hrCB.checked = false;
    const srch = container.querySelector('#cm-filter-search');
    if (srch) srch.value = '';
    _filters = { sdr_id:'', provider:'', direction:'', outcome:'', date_from:'', date_to:'', has_recording:'', search:'' };
}

// ── Data Loading ────────────────────────────────────────────────────────────
async function _loadData(container) {
    // Cancel any in-flight request (E12: rapid filter changes, E14: nav-away mid-refresh)
    if (_abortCtrl) _abortCtrl.abort();
    _abortCtrl = new AbortController();
    const signal = _abortCtrl.signal;

    const params = new URLSearchParams({ page: _page, per_page: _perPage });
    if (_filters.sdr_id)        params.set('sdr_id',       _filters.sdr_id);
    if (_filters.provider)      params.set('provider',     _filters.provider);
    if (_filters.direction)     params.set('direction',    _filters.direction);
    if (_filters.outcome)       params.set('outcome',      _filters.outcome);
    if (_filters.date_from)     params.set('date_from',    _filters.date_from);
    if (_filters.date_to)       params.set('date_to',      _filters.date_to);
    if (_filters.has_recording) params.set('has_recording', _filters.has_recording);

    try {
        const res = await fetch(`${API}/api/admin/call-logs?${params}`, {
            headers: authHeaders(),
            signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Populate SDR dropdown (once — if empty)
        const sdrSel = container.querySelector('#cm-filter-sdr');
        if (sdrSel && sdrSel.options.length === 1 && data.sdrs?.length) {
            data.sdrs.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id; opt.textContent = s.name;
                sdrSel.appendChild(opt);
            });
        }

        _totalPages = data.pages || 1;
        _renderStats(container, data.total, data.summary);
        _renderTable(container, data.items, data.total);
        _renderPagination(container, data.total);

        // RCA 2026-08-06: _renderTable rebuilds the whole table via innerHTML
        // on every refresh (including the 30s auto-refresh tick), which
        // silently collapsed whatever row a user had open mid-read —
        // reported as "this view keeps auto-closing." Every freshly-built
        // row starts collapsed (_buildRow's template), so re-open the one
        // that was open before this refresh, if it's still on this page.
        if (_expandedRow && data.items?.some(c => c.id === _expandedRow)) {
            const wrap = container.querySelector('#cm-table-wrap');
            const savedId = _expandedRow;
            _expandedRow = null;
            _toggleExpand(wrap, savedId);
        }

        // Update last-refreshed label
        const lu = container.querySelector('#cm-last-updated');
        if (lu) lu.textContent = `Updated ${new Date().toLocaleTimeString()}`;

    } catch (err) {
        if (err.name === 'AbortError') return;  // deliberate cancel — not an error
        const wrap = container.querySelector('#cm-table-wrap');
        if (wrap) wrap.innerHTML = `<div class="cm-error">⚠️ Failed to load call data. ${err.message}</div>`;
    }
}

// ── Stats ───────────────────────────────────────────────────────────────────
function _renderStats(container, total, summary) {
    const set = (id, val) => { const el = container.querySelector(`#${id}`); if (el) el.textContent = val; };
    set('cm-stat-total', total?.toLocaleString() ?? '—');

    const avg = summary?.avg_duration;
    set('cm-stat-avg', avg != null ? _fmtDuration(avg) : '—');

    // RCA 2026-08-06: this used to read summary.completed (status ILIKE
    // '%ENDED%' — true whether or not the call was answered), showing 97%
    // "Connected" for data whose real connect rate was 15%. summary.connected
    // is the backend's actually-answered check (outcome set OR
    // provider_disposition='ANSWERED').
    const connected = summary?.connected ?? 0;
    const pct = total > 0 ? Math.round((connected / total) * 100) : 0;
    set('cm-stat-connected', total > 0 ? `${pct}%` : '—');

    set('cm-stat-failed', summary?.failed != null ? summary.failed : '—');
}

// ── Table ───────────────────────────────────────────────────────────────────
function _renderTable(container, items, total) {
    const wrap = container.querySelector('#cm-table-wrap');
    if (!items?.length) {
        wrap.innerHTML = `
            <div class="cm-empty">
                <div style="font-size:2.5rem;margin-bottom:12px;">📭</div>
                <div style="font-weight:600;color:var(--text-main);margin-bottom:6px;">No calls found</div>
                <div style="font-size:0.85rem;color:var(--text-muted);">Try adjusting your filters or date range.</div>
                <button class="btn btn-outline" style="margin-top:16px;" id="cm-empty-reset">Reset Filters</button>
            </div>`;
        wrap.querySelector('#cm-empty-reset')?.addEventListener('click', () => {
            _resetFilters(container); _page = 1; _loadData(container);
        });
        return;
    }

    const rows = items.map(c => _buildRow(c)).join('');
    wrap.innerHTML = `
        <table class="cm-table">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>SDR</th>
                    <th>Lead</th>
                    <th>Provider</th>
                    <th>Direction</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th>Status</th>
                    <th>Recording</th>
                </tr>
            </thead>
            <tbody id="cm-tbody">${rows}</tbody>
        </table>`;

    // Attach row expand and play handlers
    wrap.querySelectorAll('.cm-row[data-id]').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.cm-play-btn') || e.target.closest('audio')) return;
            const id = row.dataset.id;
            _toggleExpand(wrap, id, items.find(c => c.id === id));
        });
    });

    wrap.querySelectorAll('.cm-play-btn[data-url]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            _handlePlay(btn);
        });
    });

    wrap.querySelectorAll('.cm-download-recording-btn').forEach(a => {
        a.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadRecordingFresh(e, a.dataset.callId, a.href);
        });
    });
}

function _buildRow(c) {
    const isFailed = c.status && c.status.toUpperCase().includes('FAIL');
    const rowClass = isFailed ? 'cm-row cm-row--failed' : 'cm-row';

    const providerBadge = _providerBadge(c.provider);
    const dirBadge      = _directionBadge(c.direction);
    const outcomeBadge  = _outcomeBadge(c.outcome);
    const statusBadge   = _statusBadge(c.status);
    const recordingCell = _recordingCell(c);

    const leadDisplay = c.lead_name
        ? `<div class="cm-lead-name">${_esc(c.lead_name)}</div>
           ${c.lead_company ? `<div class="cm-lead-company">${_esc(c.lead_company)}</div>` : ''}`
        : `<span class="cm-muted">${_esc(c.phone_number || '—')}</span>`;

    const sdrDisplay = c.sdr_name
        ? `<div class="cm-sdr-name">${_esc(c.sdr_name)}</div>`
        : `<span class="cm-muted">Unknown</span>`;

    const failedBanner = isFailed && c.error_detail
        ? `<tr class="cm-row cm-row--error-banner" data-parent="${c.id}">
               <td colspan="9"><div class="cm-error-banner">⚠️ ${_esc(c.error_detail)}</div></td>
           </tr>` : '';

    return `
        <tr class="${rowClass}" data-id="${c.id}" style="cursor:pointer;">
            <td>
                <div class="cm-time-rel" title="${c.started_at || c.created_at || ''}">${_timeAgo(c.started_at || c.created_at)}</div>
            </td>
            <td>${sdrDisplay}</td>
            <td>${leadDisplay}</td>
            <td>${providerBadge}</td>
            <td>${dirBadge}</td>
            <td><span class="cm-duration">${_fmtDuration(c.duration)}</span></td>
            <td>${outcomeBadge}</td>
            <td>${statusBadge}</td>
            <td>${recordingCell}</td>
        </tr>
        ${failedBanner}
        <tr class="cm-expand-row" id="cm-expand-${c.id}" style="display:none;">
            <td colspan="9">${_buildExpandPanel(c)}</td>
        </tr>`;
}

function _buildExpandPanel(c) {
    // Transcript
    let transcriptSection = '';
    const lines = parseTranscript(c.transcript);

    if (!lines.length) {
        // Greyed-out placeholder — shown whenever transcript would be available (i.e. always visible, grayed)
        transcriptSection = `<div class="cm-transcript-empty">
            <span style="opacity:0.45;">📝</span>
            <em style="opacity:0.5;">Transcript not available for this call</em>
            <span class="cm-transcript-hint" style="opacity:0.5;">Call transcription requires RCM or Aircall transcription to be enabled on your account.</span>
        </div>`;
    } else {
        transcriptSection = `<div class="cm-transcript-body">${
            lines.slice(0, 20).map(l =>
                `<div class="cm-transcript-line">
                    ${l.speaker ? `<span class="cm-transcript-speaker">${_esc(l.speaker)}</span>` : ''}
                    <span>${_esc(l.text || String(l))}</span>
                 </div>`).join('')
        }${lines.length > 20 ? `<div class="cm-transcript-more">… ${lines.length - 20} more lines</div>` : ''}</div>`;
    }

    // Notes
    const notes = c.notes || c.error_detail;
    const noteSection = notes
        ? `<div class="cm-expand-notes"><strong>Notes:</strong> ${_esc(notes)}</div>`
        : '';

    // Timing details
    const ringTime = (c.answered_at && c.started_at)
        ? Math.round((new Date(c.answered_at) - new Date(c.started_at)) / 1000)
        : null;

    const timingHtml = `
        <div class="cm-expand-meta">
            ${c.provider_call_id ? `<span class="cm-meta-chip">ID: <code>${_esc(c.provider_call_id)}</code></span>` : ''}
            ${ringTime !== null ? `<span class="cm-meta-chip">Ring time: ${ringTime}s</span>` : ''}
            ${c.started_at ? `<span class="cm-meta-chip">Started: ${new Date(c.started_at).toLocaleString()}</span>` : ''}
        </div>`;

    const openLeadBtn = c.lead_id
        ? `<button class="btn btn-outline cm-open-lead-btn" onclick="window._loadView('lead-detail','${c.lead_id}')">Open Lead →</button>`
        : '';

    return `
        <div class="cm-expand-panel">
            <div class="cm-expand-content">
                ${c.recording_url ? `<div id="cm-audio-slot-${c.id}" class="cm-audio-slot" style="margin-bottom:10px;"></div>` : ''}
                ${noteSection}
                <div class="cm-expand-transcript">
                    <div class="cm-transcript-label">Transcript</div>
                    ${transcriptSection}
                </div>
            </div>
            <div class="cm-expand-footer">
                ${timingHtml}
                ${openLeadBtn}
            </div>
        </div>`;
}

function _toggleExpand(wrap, id, call) {
    const expandRow = wrap.querySelector(`#cm-expand-${id}`);
    if (!expandRow) return;

    const isOpen = expandRow.style.display !== 'none';

    // Close any previously open row
    if (_expandedRow && _expandedRow !== id) {
        const prev = wrap.querySelector(`#cm-expand-${_expandedRow}`);
        if (prev) { prev.style.display = 'none'; }
        const prevRow = wrap.querySelector(`.cm-row[data-id="${_expandedRow}"]`);
        if (prevRow) prevRow.classList.remove('cm-row--expanded');
    }

    if (isOpen) {
        expandRow.style.display = 'none';
        const row = wrap.querySelector(`.cm-row[data-id="${id}"]`);
        if (row) row.classList.remove('cm-row--expanded');
        _expandedRow = null;
    } else {
        expandRow.style.display = '';
        const row = wrap.querySelector(`.cm-row[data-id="${id}"]`);
        if (row) row.classList.add('cm-row--expanded');
        _expandedRow = id;
    }
}

// ── Audio Player ─────────────────────────────────────────────────────────────
// Play/download live in the (narrow) table cell, but the actual <audio> element
// renders into the full-width expand panel (#cm-audio-slot-<id>) — appending a
// native <audio controls> into a table cell squeezed it into a broken, clipped
// widget (bug report screenshot). Recording URLs are provider-signed and
// time-limited; bindRecordingRetry/openRecordingFresh (utils.js) are the
// shared, already-correct fix used by every other recording surface in the
// app (lead_calls_tab.js, activity_feed.js) — this view had its
// own bespoke reimplementation that lacked their auto-retry-on-expiry and
// download support. Reuse them instead of maintaining a second copy.
function _recordingCell(c) {
    if (!c.recording_url) {
        return `<span class="cm-muted">—</span>`;
    }
    return `
        <div class="cm-play-wrap">
            <button class="cm-play-btn btn btn-outline" data-url="${_esc(c.recording_url)}" data-id="${c.id}" title="Play recording">
                ▶ Play
            </button>
            <a class="cm-download-recording-btn" href="${_esc(c.recording_url)}" data-call-id="${c.id}" target="_blank" download
                style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;padding:3px 9px;border:1px solid var(--border-color);border-radius:6px;background:var(--surface-color);color:var(--text-muted);cursor:pointer;margin-top:4px;text-decoration:none;">
                ⬇ Download
            </a>
        </div>`;
}

function _handlePlay(btn) {
    const url = btn.dataset.url;
    const id = btn.dataset.id;
    const wasPlaying = btn.dataset.playing === 'true';

    // Stop any currently playing audio
    if (_activeAudio) {
        _activeAudio.pause();
        _activeAudio.remove();
        _activeAudio = null;
    }
    document.querySelectorAll('.cm-play-btn[data-playing="true"]').forEach(b => {
        b.dataset.playing = ''; b.textContent = '▶ Play';
    });

    // If clicking the same button that was already playing, just stop (state
    // already reset above) — don't restart it.
    if (wasPlaying) return;

    // Player renders in the full-width expand panel, not the table cell —
    // make sure that row is open so the player is actually visible.
    const row = btn.closest('.cm-row');
    if (row && !row.classList.contains('cm-row--expanded')) {
        _toggleExpand(document, id);
    }
    const slot = document.getElementById(`cm-audio-slot-${id}`);
    if (!slot) return;
    slot.innerHTML = '';

    const audio = document.createElement('audio');
    audio.src = url;
    audio.controls = true;
    audio.style.cssText = 'width:100%;';
    bindRecordingRetry(audio, id);
    audio.addEventListener('recording-unavailable', () => {
        showToast('Recording no longer available from provider', 'warning');
        audio.remove();
        btn.textContent = '▶ Play';
        btn.dataset.playing = '';
        if (_activeAudio === audio) _activeAudio = null;
    });
    audio.onended = () => { btn.textContent = '▶ Play'; btn.dataset.playing = ''; };

    btn.dataset.playing = 'true';
    btn.textContent = '⏸ Pause';
    slot.appendChild(audio);
    audio.play().catch(() => {});
    _activeAudio = audio;
}

// ── Pagination ───────────────────────────────────────────────────────────────
function _renderPagination(container, total) {
    const pag     = container.querySelector('#cm-pagination');
    const info    = container.querySelector('#cm-page-info');
    const prevBtn = container.querySelector('#cm-prev-btn');
    const nextBtn = container.querySelector('#cm-next-btn');

    if (!total) { pag.style.display = 'none'; return; }
    pag.style.display = 'flex';

    const from = (_page - 1) * _perPage + 1;
    const to   = Math.min(_page * _perPage, total);
    if (info) info.textContent = `Showing ${from}–${to} of ${total.toLocaleString()} calls`;
    if (prevBtn) prevBtn.disabled = _page <= 1;
    if (nextBtn) nextBtn.disabled = _page >= _totalPages;
}

// ── Auto-refresh ─────────────────────────────────────────────────────────────
function _startAutoRefresh(container) {
    _stopAutoRefresh();
    _refreshTimer = setInterval(() => {
        if (!_autoRefresh) return;
        // RCA 2026-07-22: _renderTable() rebuilds the whole table via innerHTML,
        // which destroys any in-progress <audio> element — a recording longer
        // than 30s would silently cut off mid-playback on the next refresh tick.
        if (_activeAudio && !_activeAudio.paused) return;
        _loadData(container);
    }, 30_000);
}

function _stopAutoRefresh() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

// ── Export CSV ───────────────────────────────────────────────────────────────
async function _exportCSV(container) {
    const params = new URLSearchParams({ page: 1, per_page: 2000 });
    if (_filters.sdr_id)        params.set('sdr_id',       _filters.sdr_id);
    if (_filters.provider)      params.set('provider',     _filters.provider);
    if (_filters.direction)     params.set('direction',    _filters.direction);
    if (_filters.outcome)       params.set('outcome',      _filters.outcome);
    if (_filters.date_from)     params.set('date_from',    _filters.date_from);
    if (_filters.date_to)       params.set('date_to',      _filters.date_to);
    if (_filters.has_recording) params.set('has_recording', _filters.has_recording);

    try {
        const res = await fetch(`${API}/api/admin/call-logs?${params}`, {
            headers: authHeaders(),
        });
        const data = await res.json();
        const cols  = ['id','sdr_name','lead_name','lead_company','phone_number','provider','direction','status','outcome','duration','started_at','ended_at','recording_url','error_detail'];
        const lines = [cols.join(',')];
        (data.items || []).forEach(c => {
            lines.push(cols.map(k => JSON.stringify(c[k] ?? '')).join(','));
        });
        const blob = new Blob([lines.join('\n')], {type:'text/csv'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `call-monitor-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        showToast(`Exported ${(data.items || []).length} calls`, 'success');
    } catch(e) {
        console.error('[CallMonitor] export error:', e);
        showToast('Export failed: ' + e.message, 'error');
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _fmtDuration(secs) {
    if (secs == null || secs === '') return '—';
    const s = parseInt(secs, 10);
    if (isNaN(s) || s < 0) return '—';
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}m ${r.toString().padStart(2,'0')}s`;
}

function _timeAgo(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return new Date(iso).toLocaleDateString();
}

function _providerBadge(p) {
    if (!p) return '<span class="cm-muted">—</span>';
    const lp = p.toLowerCase();
    if (lp === 'rcm') return `<span class="cm-badge cm-badge--indigo">📞 RCM</span>`;
    if (lp === 'aircall')    return `<span class="cm-badge cm-badge--purple">✈️ Aircall</span>`;
    if (lp === 'klenty')     return `<span class="cm-badge cm-badge--teal">📲 Klenty</span>`;
    return `<span class="cm-badge cm-badge--grey">${_esc(p)}</span>`;
}

function _directionBadge(d) {
    if (!d) return '<span class="cm-muted">—</span>';
    if (d === 'outbound') return `<span class="cm-badge cm-badge--teal">↗ Out</span>`;
    if (d === 'inbound')  return `<span class="cm-badge cm-badge--blue">↙ In</span>`;
    return `<span class="cm-badge cm-badge--grey">${_esc(d)}</span>`;
}

function _outcomeBadge(o) {
    if (!o) return '<span class="cm-muted">—</span>';
    const colors = {
        'Interested':          'green',
        'Meeting Scheduled':   'green',
        'Meeting Confirmed':   'green',
        'No Answer':           'grey',
        'Left Voicemail':      'grey',
        'Call Back Later':     'yellow',
        'Not Interested':      'red',
        'Not the Right Person':'red',
        'Disqualified':        'red',
    };
    const c = colors[o] || 'grey';
    return `<span class="cm-badge cm-badge--${c}">${_esc(o)}</span>`;
}

function _statusBadge(s) {
    if (!s) return '<span class="cm-muted">—</span>';
    const su = s.toUpperCase();
    const cls = su.includes('FAIL') ? 'red' :
                su.includes('ENDED') || su.includes('ANSWERED') ? 'green' :
                su.includes('START') ? 'blue' : 'grey';
    const label = su.replace('CALL_','');
    return `<span class="cm-badge cm-badge--${cls}">${_esc(label)}</span>`;
}

