// ── views/lead_calls_tab.js — Calls tab lazy-loader + call card rendering ─────
import * as api from '../api.js';
import { ensureUTC, bindRecordingRetry, downloadRecordingFresh, parseTranscript, escapeHtml as _esc } from '../utils.js';

// ── Format helpers (module-scoped so _appendPage can reuse them) ────────────
const _fmtDur = (secs) => {
    if (secs === null || secs === undefined) return '—'; // unknown — disconnect webhook missed
    if (secs === 0) return '0s';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};
const _fmtDate = (iso) => {
    if (!iso) return '';
    return new Date(ensureUTC(iso)).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
};
const _fmtLastCalled = (iso) => {
    if (!iso) return '—';
    const d   = new Date(ensureUTC(iso));
    const now = new Date();
    const diffMs = now - d;
    if (diffMs < 86400000 && d.getDate() === now.getDate()) return 'Today';
    if (diffMs < 172800000) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const _outcomeBadge = (outcome) => {
    if (!outcome) return '';
    const map = {
        'Interested':           'interested',
        'No Answer':            'no-answer',
        'Call Back Later':      'callback',
        'Not Interested':       'not-interested',
        'Do Not Call':          'not-interested',
        'Left the Company':     'not-interested',
        'Voicemail':            'callback',
        'Wrong Number':         'no-answer',
    };
    const cls  = map[outcome] || 'callback';
    const icons = { 'interested': '✅', 'no-answer': '😕', 'callback': '📞', 'not-interested': '🚫' };
    return `<span class="call-outcome-badge ${cls}">${icons[cls] || ''} ${outcome}</span>`;
};
const _statusDot = (call) => {
    if (call.outcome === 'Interested' || call.status === 'CALL_ANSWERED') return 'connected';
    if (call.outcome === 'No Answer' || call.outcome === 'Wrong Number' || call.status === 'FAILED') return 'missed';
    if (call.duration && call.duration > 30) return 'connected';
    return 'pending';
};
const _initials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
};
const _callCard = (c) => {
    const dot      = _statusDot(c);
    const provCls  = c.provider === 'aircall' ? 'aircall' : c.provider === 'rcm' ? 'rcm' : 'manual';
    const provLabel= c.provider === 'aircall' ? 'via Aircall' : c.provider === 'rcm' ? 'via RCM' : 'Manual Log';
    const durStr   = _fmtDur(c.duration);
    const dateStr  = _fmtDate(c.created_at);

    let recordingHTML = '';
    if (c.recording_url) {
        const audioId = `audio-${c.id}`;
        // If duration is unknown, update the card header once audio metadata loads.
        // Use closest('.call-card') to avoid quote-escaping issues in HTML attributes.
        const onLoadedMeta = c.duration == null
            ? `onloadedmetadata="(function(el){var card=el.closest('.call-card');if(card){var s=card.querySelector('[data-dur-id]');if(s&&el.duration&&isFinite(el.duration)){var m=Math.floor(el.duration/60),sec=Math.round(el.duration%60);s.textContent=m>0?m+' '+sec+'s':sec+'s';}}}) (this)"`
            : '';
        recordingHTML = `
        <div style="margin-top:8px;padding:8px 12px;background:var(--bg-card,#f8f9fa);border-radius:8px;display:flex;align-items:center;gap:10px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <audio id="${audioId}" data-call-id="${c.id}" controls preload="metadata" style="height:32px;flex:1;max-width:400px;" ${onLoadedMeta}>
                <source src="${c.recording_url}" type="audio/ogg">
                <source src="${c.recording_url}" type="audio/mpeg">
            </audio>
            <a href="${c.recording_url}" data-download-call-id="${c.id}" target="_blank" style="color:#6366f1;font-size:0.75rem;text-decoration:none;white-space:nowrap;">↓ Download</a>
        </div>`;

    } else if (c.source === 'dialer' && c.duration > 0) {
        recordingHTML = `
        <div style="margin-top:8px;padding:8px 12px;background:#f8f8f8;border-radius:8px;display:flex;align-items:center;gap:8px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            <span style="font-size:0.78rem;color:#9ca3af;">Recording not available for this call</span>
        </div>`;
    }

    let transcriptHTML = '';
    if (c.transcript) {
        let transcriptBody = '';
        // RCA 2026-07-22: this assumed transcript was a plain [{speaker,text}]
        // array — RCM's real shape is {"transcription": [{role, content,
        // start_time}]}, so a real transcript silently rendered nothing here.
        const lines = parseTranscript(c.transcript);
        if (lines.length > 0) {
            transcriptBody = lines.map(l => `<div class="transcript-line"><span class="speaker ${l.speaker === 'SDR' ? 'sdr' : 'lead'}">${_esc(l.speaker)}:</span><span class="text">${_esc(l.text)}</span></div>`).join('');
        }
        if (transcriptBody) {
            transcriptHTML = `
            <div class="call-transcript">
                <div class="call-transcript-header" onclick="this.parentElement.querySelector('.call-transcript-body').classList.toggle('open');this.querySelector('.toggle').textContent=this.parentElement.querySelector('.call-transcript-body').classList.contains('open')?'▼ Collapse':'▶ Expand'">
                    <span class="label">📄 Call Transcript</span>
                    <span class="toggle">▶ Expand</span>
                </div>
                <div class="call-transcript-body">
                    <div class="call-transcript-divider"></div>
                    ${transcriptBody}
                </div>
            </div>`;
        }
    }

    return `
    <div class="call-card" data-call-filter="${dot}">
        <div class="call-card-header">
            <div class="call-card-left">
                <div class="call-status-dot ${dot}"></div>
                <span style="font-weight:600;font-size:0.88rem;">${c.direction === 'inbound' ? 'Inbound' : 'Outbound'} Call</span>
                <span class="call-provider-badge ${provCls}">${provLabel}</span>
            </div>
            <div class="call-card-right">
                <span style="font-weight:500;" data-dur-id="${c.id}">${durStr}</span>
                <span>·</span>
                <span>${dateStr}</span>
            </div>
        </div>
        <div class="call-sdr-row">
            <div class="call-sdr-avatar">${_initials(c.user_name)}</div>
            <span style="font-weight:500;color:var(--text-main);">${c.user_name || 'Unknown'}</span>
            <span style="color:var(--text-muted);">→</span>
            <span style="color:var(--text-muted);">${c.phone_number || '—'}</span>
        </div>
        ${c.outcome ? `<div class="call-outcome-row">
            ${_outcomeBadge(c.outcome)}
            ${c.notes ? `<span class="call-notes">${c.notes}</span>` : ''}
        </div>` : ''}
        ${recordingHTML}
        ${transcriptHTML}
    </div>`;
};

// ── State shared between initial load and "Load more" ────────────────────────
let _currentLeadId = null;
let _currentPage   = 1;
let _activeFilter  = 'all';

/** Load and render the Calls tab content for a given lead. */
export async function loadCallsTab(leadId) {
    _currentLeadId = leadId;
    _currentPage   = 1;
    _activeFilter  = 'all';

    const el = document.getElementById('calls-tab-content');
    if (!el) return;

    // Show loading skeleton
    el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);">Loading calls…</div>`;

    try {
        const data = await api.fetchLeadCalls(leadId, 1, 10);

        if (!data || !data.calls || !data.stats) {
            el.innerHTML = `<div class="calls-empty"><div class="empty-icon">⚠️</div><h3>Could not load calls</h3><p>Unexpected response from server. Please refresh and try again.</p></div>`;
            return;
        }

        const { calls, stats, has_more, total_count } = data;

        // Update tab badge
        const badge = document.getElementById('calls-tab-count');
        if (badge && stats.total > 0) {
            badge.textContent = stats.total;
            badge.style.display = 'inline-flex';
        }

        if (calls.length === 0) {
            el.innerHTML = `<div class="calls-empty">
                <div class="empty-icon">📞</div>
                <h3>No calls yet</h3>
                <p>Call history will appear here after using the dialer or logging calls manually.</p>
            </div>`;
            return;
        }

        // Stats summary strip
        const statsHTML = `
            <div class="call-stats-grid">
                <div class="call-stat-card"><div class="stat-label">Total Calls</div><div class="stat-number">${stats.total}</div></div>
                <div class="call-stat-card"><div class="stat-label">Connected</div><div class="stat-number green">${stats.connected}</div></div>
                <div class="call-stat-card"><div class="stat-label">Avg Duration</div><div class="stat-number">${_fmtDur(stats.avg_duration)}</div></div>
                <div class="call-stat-card"><div class="stat-label">Last Called</div><div class="stat-number primary">${_fmtLastCalled(stats.last_called)}</div></div>
            </div>`;

        const listHeaderHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <div style="font-weight:600;font-size:0.95rem;">Recent Calls</div>
                <div class="call-filters">
                    <span class="call-filter-pill active" data-filter="all">All</span>
                    <span class="call-filter-pill" data-filter="connected">Connected</span>
                    <span class="call-filter-pill" data-filter="missed">Missed</span>
                </div>
            </div>`;

        const cardsHTML = calls.map(_callCard).join('');

        const remaining  = (total_count || stats.total) - calls.length;
        const loadMoreHTML = has_more
            ? `<div id="load-more-calls-wrap" style="text-align:center;margin-top:16px;">
                   <button id="load-more-calls-btn" style="background:none;border:1.5px solid var(--border,#e5e7eb);border-radius:20px;padding:8px 24px;font-size:0.82rem;color:var(--text-muted);cursor:pointer;transition:border-color 0.15s,color 0.15s;"
                       onmouseover="this.style.borderColor='#6366f1';this.style.color='#6366f1'"
                       onmouseout="this.style.borderColor='';this.style.color=''">
                       Load more (${remaining} remaining)
                   </button>
               </div>`
            : '';

        el.innerHTML = statsHTML + listHeaderHTML
            + `<div id="calls-card-list">${cardsHTML}</div>`
            + loadMoreHTML;

        // Filter pill handlers
        _bindFilters(el);
        _bindRecordingLinks(el);

        // Load more handler
        const loadMoreBtn = document.getElementById('load-more-calls-btn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => _loadMoreCalls());
        }
    } catch (e) {
        console.error('[Calls Tab] Error loading calls:', e);
        if (el) el.innerHTML = `<div class="calls-empty"><div class="empty-icon">⚠️</div><h3>Error loading calls</h3><p>${e.message}</p></div>`;
    }
}

/** Fetch the next page and append cards — no full re-render. */
async function _loadMoreCalls() {
    if (!_currentLeadId) return;
    const btn = document.getElementById('load-more-calls-btn');
    if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }

    try {
        _currentPage += 1;
        const data = await api.fetchLeadCalls(_currentLeadId, _currentPage, 10);
        if (!data || !data.calls) return;

        const { calls, has_more, total_count } = data;
        const list = document.getElementById('calls-card-list');
        if (list) {
            const fragment = document.createDocumentFragment();
            calls.forEach(c => {
                const tmp = document.createElement('div');
                tmp.innerHTML = _callCard(c);
                // Apply active filter immediately
                if (_activeFilter !== 'all') {
                    const card = tmp.firstElementChild;
                    if (card && card.dataset.callFilter !== _activeFilter) {
                        card.style.display = 'none';
                    }
                }
                while (tmp.firstChild) fragment.appendChild(tmp.firstChild);
            });
            list.appendChild(fragment);
            _bindRecordingLinks(list);
        }

        // Update or remove the Load more button
        const wrap = document.getElementById('load-more-calls-wrap');
        if (wrap) {
            if (has_more) {
                const totalLoaded = _currentPage * 10;
                const remaining   = (total_count || 0) - totalLoaded;
                if (btn) {
                    btn.textContent = `Load more (${Math.max(0, remaining)} remaining)`;
                    btn.disabled    = false;
                }
            } else {
                wrap.remove();
            }
        }
    } catch (e) {
        console.error('[Calls Tab] Load more error:', e);
        if (btn) { btn.textContent = 'Load more'; btn.disabled = false; }
    }
}

/** Wire fresh-URL retry on every recording player/link in a container. */
function _bindRecordingLinks(container) {
    if (!container) return;
    container.querySelectorAll('audio[data-call-id]').forEach(a => bindRecordingRetry(a, a.dataset.callId));
    container.querySelectorAll('a[data-download-call-id]').forEach(a => {
        a.addEventListener('click', (e) => downloadRecordingFresh(e, a.dataset.downloadCallId, a.href));
    });
}

/** Bind filter pill click handlers. */
function _bindFilters(el) {
    el.querySelectorAll('.call-filter-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            el.querySelectorAll('.call-filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            _activeFilter = pill.dataset.filter;
            el.querySelectorAll('.call-card').forEach(card => {
                if (_activeFilter === 'all') { card.style.display = ''; return; }
                card.style.display = card.dataset.callFilter === _activeFilter ? '' : 'none';
            });
        });
    });
}
