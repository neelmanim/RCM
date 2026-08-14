// ── utils.js — Shared helpers: formatting, badges, loader, pagination ─────────
import { fetchRecordingUrl } from './api.js';

// Dialer providers return pre-signed, time-limited recording URLs. A URL cached in a
// call list/detail response can expire while the page just sits open, so every
// playback surface needs to re-fetch a fresh one on failure, not just show an error.
// Attaches a bounded retry: on the <audio>'s `error` event, fetch a fresh URL, resume
// from wherever playback stopped, and retry. Capped at MAX_RECORDING_RETRIES — a long
// call can outlive one provider-signed URL's TTL more than once (bug report: playback
// "stops midway"), so a single retry wasn't enough; unlimited retries would just spin
// forever against a genuinely-gone recording.
const MAX_RECORDING_RETRIES = 3;

export function bindRecordingRetry(audioEl, callId) {
    if (!audioEl || !callId) return;
    audioEl.addEventListener('error', async () => {
        const retries = Number(audioEl.dataset.retried || 0);
        if (retries >= MAX_RECORDING_RETRIES) return;
        audioEl.dataset.retried = String(retries + 1);
        const resumeAt = audioEl.currentTime || 0;
        const data = await fetchRecordingUrl(callId).catch(() => null);
        if (data?.recording_url) {
            audioEl.querySelectorAll('source').forEach(s => { s.src = data.recording_url; });
            if (!audioEl.querySelector('source')) audioEl.src = data.recording_url;
            audioEl.load();
            const resume = () => {
                if (resumeAt > 0) audioEl.currentTime = resumeAt;
                audioEl.play().catch(() => {});
                audioEl.removeEventListener('loadedmetadata', resume);
            };
            audioEl.addEventListener('loadedmetadata', resume);
        } else {
            audioEl.dispatchEvent(new CustomEvent('recording-unavailable', { bubbles: true }));
        }
    });
}

// For plain "open recording in new tab" links — fetch a fresh URL before navigating
// instead of opening whatever was cached when the page loaded.
export async function openRecordingFresh(event, callId, fallbackUrl) {
    event.preventDefault();
    const data = await fetchRecordingUrl(callId).catch(() => null);
    window.open(data?.recording_url || fallbackUrl, '_blank');
}

// A real forced download, not just "open in a new tab". The provider's signed
// URL is cross-origin, so the HTML `download` attribute alone is ignored by
// browsers there — fetch the audio as a blob first, then save that local
// blob URL, which browsers do honour.
export async function downloadRecordingFresh(event, callId, fallbackUrl, filename) {
    event.preventDefault();
    const data = await fetchRecordingUrl(callId).catch(() => null);
    const url = data?.recording_url || fallbackUrl;
    if (!url) return;
    try {
        const res = await fetch(url);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename || `call-recording-${callId}.mp3`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
    } catch (e) {
        // Cross-origin fetch blocked or network error — fall back to opening
        // the recording directly so the user can still save it manually.
        window.open(url, '_blank');
    }
}

// Normalizes a DialerCall.transcript string into a flat array of
// {speaker, text} segments, regardless of provider-specific shape.
// RCM nests segments as {"transcription": [{role, content, start_time}]}
// (RCA 2026-07-22: every transcript view previously assumed a different,
// wrong shape — a plain array, a plain string, or generic key/value pairs —
// so a real transcript silently failed to render anywhere).
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseTranscript(raw) {
    if (!raw) return [];
    let data;
    try { data = JSON.parse(raw); } catch { data = raw; }
    if (data === '{}' || data === '') return [];
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) return [];
    if (Array.isArray(data?.transcription)) {
        // Deepgram's diarization labels are 0-indexed ("Speaker 0"/"Speaker 1")
        // and don't identify SDR vs lead — just make the numbering human (1-indexed).
        return data.transcription.map(s => ({
            speaker: (s.role || '').replace(/Speaker (\d+)/, (_, n) => `Speaker ${Number(n) + 1}`),
            text: s.content || '',
        }));
    }
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') return [{ speaker: '', text: data }];
    if (data && typeof data === 'object') return Object.entries(data).map(([k, v]) => ({ speaker: k, text: v }));
    return [];
}

export const STATUS_BADGE = {
    'Lead Assigned': 'badge-new',
    'Lead Unassigned': 'badge-unassigned',
    'Research': 'badge-working',
    'Calling': 'badge-qualified',
    'Meeting Scheduled': 'badge-meeting',
    '1st Discovery Meeting': 'badge-discovery',
    'Discovery Complete': 'badge-discovery-done',
    'Demo Scheduled': 'badge-demo',
    'Demo Done': 'badge-demo-done',
    'Completed': 'badge-completed',
    'Disqualified': 'badge-declined',
    // Legacy compat
    'Customer Declined': 'badge-declined',
    'Unreachable': 'badge-unreachable',
};

export const CALL_OUTCOME_ICON = {
    // ── New grouped outcomes ──
    'Call Back Later': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:var(--status-won);"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>',
    'Meeting Scheduled': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#22c55e;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
    'Meeting Confirmed': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#16a34a;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    'Text Me': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#6366f1;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    'Not the Right Person': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#9ca3af;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="18" y1="8" x2="23" y2="13"></line><line x1="23" y1="8" x2="18" y2="13"></line></svg>',
    'Referred Someone Else': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#0ea5e9;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>',
    'Left Voicemail': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:var(--text-muted);"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>',
    'No Answer': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:var(--status-working);"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path><line x1="18" y1="2" x2="22" y2="6"></line><line x1="22" y1="2" x2="18" y2="6"></line></svg>',
    'Wrong Number': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:var(--status-lost);"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    'Not Interested': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#f59e0b;"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>',
    'Unreachable': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#ef4444;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    'Left the Company': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#dc2626;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>',
    // ── Legacy compat (old call logs may still have these values) ──
    'Call Completed': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#22c55e;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    'Callback Scheduled': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:var(--status-won);"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>',
    'Customer Declined': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#f59e0b;"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>',
};

export function statusBadgeClass(s) { return STATUS_BADGE[s] || 'badge-new'; }

/** Display-friendly status: shows 'Lead Unassigned' for leads with no assignment. */
export function displayStatus(lead) {
    if (lead.status === 'Lead Assigned' && (!lead.assigned_to || lead.assigned_to.length === 0)) {
        return 'Lead Unassigned';
    }
    return lead.status;
}

export function fmtDate(iso) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ensureUTC(iso)));
}

export function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ensureUTC(iso)));
}

/** Ensure a timestamp string is treated as UTC (server stores without Z). */
export function ensureUTC(ts) {
    if (!ts) return ts;
    const s = String(ts).trim();
    // Already has timezone info
    if (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s)) return s;
    // Replace space between date and time with T, append Z
    return s.replace(' ', 'T') + 'Z';
}

export function fmtRelativeTime(ts) {
    if (!ts) return `<span style="color:var(--text-muted);font-size:0.8rem;">Never</span>`;
    const d = new Date(ensureUTC(ts)), now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs  = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 2)  return `<span style="color:var(--status-won);font-size:0.8rem;">Just now</span>`;
    if (diffMins < 60) return `<span style="font-size:0.8rem;">${diffMins}m ago</span>`;
    if (diffHrs  < 24) return `<span style="font-size:0.8rem;">${diffHrs}h ago</span>`;
    if (diffDays < 7)  return `<span style="font-size:0.8rem;">${diffDays}d ago</span>`;
    return `<span style="font-size:0.8rem;">${d.toLocaleDateString()}</span>`;
}

export function timeInStatus(ts) {
    if (!ts) return '—';
    const d = new Date(ensureUTC(ts)), now = new Date();
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    const hrs  = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    // Color: green < 1h, yellow 1-4h, red > 4h
    let color = '#22c55e';  // green
    if (hrs >= 1 && hrs < 4) color = '#f59e0b';  // yellow
    if (hrs >= 4) color = '#ef4444';  // red
    let label;
    if (mins < 1) label = 'just now';
    else if (mins < 60) label = `${mins}m`;
    else if (hrs < 24) label = `${hrs}h ${mins % 60}m`;
    else label = `${days}d ${hrs % 24}h`;
    return `<span style="color:${color};font-weight:600;font-size:0.8rem;" title="In current status since ${d.toLocaleString()}">${label}</span>`;
}

// Auto-created leads (Klenty sync with no caller name, manual-dial anonymous
// leads) get a hardcoded "Unknown"/"Unknown Caller" name to satisfy the DB's
// NOT NULL last_name constraint — every one of this function's 8 callers
// (kanban cards, dashboard feed, assignments table, email thread bubbles,
// the lead detail header, the leads table) would otherwise show that literal
// placeholder. Fall back to the phone number, the one identifier these leads
// always have, instead — same "—" contract as before when there's truly nothing.
export function fullName(lead) {
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
    const isPlaceholder = !name || /^unknown(\s+caller)?$/i.test(name);
    if (!isPlaceholder) return name;
    return lead.phone || lead.phone_secondary || lead.company_phone || '—';
}

export function showLoader(container) {
    // ── Universal skeleton loader ───────────────────────────────────────
    // Shows a content-like skeleton instead of a bare spinner.
    // Every view goes through loadView → showLoader, so this gives
    // consistent progressive-loading UX across the entire app.
    const _skel = (w, h = '14px', r = '6px') =>
        `<div style="background:var(--skeleton-bg,#e5e7eb);border-radius:${r};width:${w};height:${h};animation:skeletonPulse 1.4s ease-in-out infinite;"></div>`;

    container.innerHTML = `
        <style>
            @keyframes skeletonPulse {
                0%, 100% { opacity: 1; }
                50%      { opacity: 0.4; }
            }
        </style>
        <div style="padding:28px 32px;max-width:1200px;">
            <!-- Title skeleton -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
                ${_skel('200px','28px','8px')}
                ${_skel('120px','36px','8px')}
            </div>

            <!-- Stats row skeleton -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:28px;">
                ${Array(4).fill('').map(() => `
                    <div style="background:var(--card-bg,#fff);border-radius:12px;padding:20px;border:1px solid var(--border,#e5e7eb);">
                        ${_skel('80px','12px')}
                        <div style="margin-top:12px;">${_skel('120px','32px','8px')}</div>
                        <div style="margin-top:8px;">${_skel('60px','10px')}</div>
                    </div>
                `).join('')}
            </div>

            <!-- Table skeleton -->
            <div style="background:var(--card-bg,#fff);border-radius:12px;border:1px solid var(--border,#e5e7eb);overflow:hidden;">
                <div style="padding:16px 20px;border-bottom:1px solid var(--border,#e5e7eb);display:flex;align-items:center;gap:12px;">
                    ${_skel('160px','18px')}
                    <div style="margin-left:auto;">${_skel('200px','32px','8px')}</div>
                </div>
                ${Array(6).fill('').map(() => `
                    <div style="padding:14px 20px;border-bottom:1px solid var(--border,#f1f5f9);display:flex;align-items:center;gap:16px;">
                        ${_skel('36px','36px','50%')}
                        ${_skel('140px')}
                        ${_skel('100px')}
                        ${_skel('80px')}
                        <div style="margin-left:auto;">${_skel('60px','24px','12px')}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

export function ssoTag(linked) {
    return linked
        ? `<span title="Logged in via Google SSO" style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;color:var(--status-won);font-weight:600;">✅ Linked</span>`
        : `<span title="Never logged in via Google" style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;color:var(--text-muted);">⏳ Pending</span>`;
}

export function renderPaginated(data, tbodyId, pagerId, pageSize, renderFn, emptyMsg) {
    const tbody = document.getElementById(tbodyId);
    const pager = document.getElementById(pagerId);
    let page = 1;
    const total = Math.max(1, Math.ceil(data.length / pageSize));

    function show() {
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = emptyMsg;
            if (pager) pager.innerHTML = '';
            return;
        }
        const start = (page - 1) * pageSize;
        const slice = data.slice(start, start + pageSize);
        slice.forEach(item => { const tr = renderFn(item); if (tr) tbody.appendChild(tr); });

        if (pager) {
            if (total > 1) {
                const end = Math.min(start + pageSize, data.length);
                pager.innerHTML = `
                    <div>Showing ${start + 1}–${end} of ${data.length} records</div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button class="btn btn-outline btn-sm" id="pg-prev-${tbodyId}" ${page === 1 ? 'disabled' : ''}>&larr; Prev</button>
                        <span style="font-weight:600;">Page ${page} of ${total}</span>
                        <button class="btn btn-outline btn-sm" id="pg-next-${tbodyId}" ${page === total ? 'disabled' : ''}>Next &rarr;</button>
                    </div>`;
                pager.querySelector(`#pg-prev-${tbodyId}`)?.addEventListener('click', () => { page--; show(); });
                pager.querySelector(`#pg-next-${tbodyId}`)?.addEventListener('click', () => { page++; show(); });
            } else {
                pager.innerHTML = `<div>Showing all ${data.length} records</div><div></div>`;
            }
        }
    }
    show();
}

/**
 * Show a non-blocking toast notification instead of alert().
 * @param {string} msg - Message text
 * @param {'error'|'success'|'info'} type - Toast type (default: 'error')
 * @param {number} duration - Auto-dismiss time in ms (default: 4000)
 */
export function showToast(msg, type = 'error', duration = 4000) {
    const themes = {
        error:   { bg: '#fef2f2', border: '#fca5a5', color: '#991b1b', icon: '❌' },
        success: { bg: '#f0fdf4', border: '#86efac', color: '#166534', icon: '✅' },
        info:    { bg: '#eef2ff', border: '#a5b4fc', color: '#3730a3', icon: 'ℹ️' },
        warning: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e', icon: '⚠️' },
    };
    const t = themes[type] || themes.error;
    const toast = document.createElement('div');
    toast.innerHTML = `
        <span style="font-size:1.1rem;flex-shrink:0;">${t.icon}</span>
        <span style="flex:1;">${msg}</span>
        <span class="toast-close" style="cursor:pointer;opacity:0.5;font-size:1rem;flex-shrink:0;margin-left:8px;">✕</span>`;
    Object.assign(toast.style, {
        position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
        padding: '14px 20px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: '500',
        color: t.color, background: t.bg, border: `1.5px solid ${t.border}`,
        maxWidth: '420px', lineHeight: '1.4',
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)', opacity: '0',
        transition: 'all 0.3s ease', transform: 'translateY(10px)',
        display: 'flex', alignItems: 'center', gap: '10px',
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
    const dismiss = () => { toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)'; setTimeout(() => toast.remove(), 300); };
    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, duration);
}
