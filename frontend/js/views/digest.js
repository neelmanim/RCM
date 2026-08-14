// ── digest.js — Daily Digest: Leadership Summary for Super Admins ─────────────
import { API_BASE, authHeaders } from '../auth.js';
import { showToast } from '../utils.js';
import { mp } from '../mp.js';

// ── Status color map (consistent with rest of app) ──────────────────────────
const STATUS_COLORS = {
    'Lead Assigned':      '#6366f1',
    'Research':           '#f59e0b',
    'Calling':            '#3b82f6',
    'Meeting Scheduled':  '#10b981',
    'Meeting Confirmed':  '#059669',
    '1st Discovery Meeting': '#0ea5e9',
    'Discovery Complete': '#06b6d4',
    'Demo Scheduled':     '#8b5cf6',
    'Demo Done':          '#a855f7',
    'Completed':          '#22c55e',
    'Closed':             '#6b7280',
    'Not Interested':     '#ef4444',
    'Unreachable':        '#9ca3af',
    'Disqualified':       '#dc2626',
};

// ── SDR avatar colors (rotating palette) ────────────────────────────────────
const AVATAR_COLORS = [
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#2563eb',
];

/**
 * Renders the Daily Digest page into the given container.
 */
export async function renderDigest(container) {
    // ── Skeleton Loading State ─────────────────────────────────────────────
    // Show content-shaped skeleton instead of a bare spinner.
    // The showLoader() skeleton from app.js is already visible — we replace
    // it here with a digest-specific skeleton that matches the final layout.
    const _sk = (w, h = '14px', r = '6px') =>
        `<div style="background:var(--skeleton-bg,#e5e7eb);border-radius:${r};width:${w};height:${h};animation:skeletonPulse 1.4s ease-in-out infinite;"></div>`;

    container.innerHTML = `
        <style>
            @keyframes skeletonPulse {
                0%, 100% { opacity: 1; }
                50%      { opacity: 0.4; }
            }
        </style>
        <div class="digest-page" id="digest-root">
            <!-- Header skeleton -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
                <div>
                    ${_sk('220px', '28px', '8px')}
                    <div style="margin-top:8px;">${_sk('320px', '14px')}</div>
                </div>
                <div style="display:flex;gap:10px;">
                    ${_sk('140px', '36px', '8px')}
                    ${_sk('120px', '36px', '8px')}
                </div>
            </div>
            <!-- KPI cards skeleton -->
            <div style="margin-bottom:8px;">${_sk('100px', '12px')}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:28px;">
                ${Array(6).fill('').map(() => `
                    <div style="background:var(--card-bg,#fff);border-radius:12px;padding:18px;border:1px solid var(--border,#e5e7eb);">
                        ${_sk('70px', '10px')}
                        <div style="margin-top:10px;">${_sk('80px', '28px', '8px')}</div>
                        <div style="margin-top:6px;">${_sk('50px', '10px')}</div>
                    </div>
                `).join('')}
            </div>
            <!-- Two-column skeleton -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                ${Array(2).fill('').map(() => `
                    <div style="background:var(--card-bg,#fff);border-radius:12px;padding:20px;border:1px solid var(--border,#e5e7eb);min-height:200px;">
                        ${_sk('150px', '16px', '8px')}
                        <div style="margin-top:16px;">${_sk('100%', '120px', '8px')}</div>
                    </div>
                `).join('')}
            </div>
        </div>`;

    // Default to yesterday
    await _loadDigest(container, _yesterday());
}

/**
 * Fetch data and render the full digest.
 */
async function _loadDigest(container, dateStr) {
    const root = container.querySelector('#digest-root') || container;

    try {
        const res = await fetch(`${API_BASE}/api/admin/analytics/daily-digest?date=${dateStr}`, {
            headers: authHeaders(),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data = await res.json();
        // ── Mixpanel: Daily Digest Viewed
        mp.track('Daily Digest Viewed', {
            date:            dateStr,
            viewer_role:     (window.__CRM_CURRENT_USER__ || {}).role || '',
            calls_made:      data.kpi?.calls_made?.today ?? null,
            meetings_booked: data.kpi?.meetings_booked?.today ?? null,
        });
        _renderDigestContent(root, data, dateStr);
    } catch (err) {
        console.error('[Digest] Load failed:', err);
        root.innerHTML = `
            <div class="digest-page">
                <div class="digest-empty">
                    <div class="digest-empty-icon">⚠️</div>
                    <p>Failed to load digest: ${err.message}</p>
                    <button class="btn btn-outline" style="margin-top:16px;" onclick="location.reload()">Retry</button>
                </div>
            </div>`;
    }
}

/**
 * Render all sections of the digest.
 */
function _renderDigestContent(root, data, dateStr) {
    const digestDate = new Date(data.digest_date + 'T00:00:00');
    const compareDate = new Date(data.comparison_date + 'T00:00:00');
    const dayLabel = digestDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const compareDayLabel = compareDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    // Weekend adjustment notice
    const weekendBanner = (!data.is_working_day && data.original_date !== data.digest_date)
        ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;font-size:0.8rem;color:#1E40AF;margin-bottom:16px;">
            <span>📅</span>
            <span>Showing data for <strong>${dayLabel}</strong> — weekends are excluded from digest comparisons.</span>
           </div>`
        : '';

    root.innerHTML = `
        <div class="digest-page" id="digest-content">
            <!-- Header -->
            <div class="digest-header">
                <div class="digest-title-group">
                    <h1>📰 Daily Digest</h1>
                    <div class="digest-subtitle">Leadership summary for <strong>${dayLabel}</strong> · Compared to ${compareDayLabel}</div>
                    ${weekendBanner}
                </div>
                <div class="digest-actions">
                    <input type="date" class="digest-date-input" id="digest-date-picker" value="${dateStr}" max="${_yesterday()}">
                    <button class="digest-pdf-btn" id="digest-pdf-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        Download PDF
                    </button>
                </div>
            </div>

            <!-- KPI Cards -->
            <div class="digest-section-title">At a Glance</div>
            <div class="digest-kpi-grid" id="digest-kpi-grid"></div>

            <!-- Status Snapshot Chips -->
            <div class="digest-section-title">Current Pipeline Snapshot</div>
            <div class="digest-status-chips" id="digest-status-chips"></div>

            <!-- Pipeline Flow + Comparison Chart -->
            <div class="digest-two-col">
                <div class="digest-card digest-funnel" id="digest-funnel-card">
                    <div class="digest-card-title">🔀 Pipeline Flow <span style="font-size:0.72rem;font-weight:500;color:var(--text-muted);margin-left:auto;">Transitions on ${_shortDate(digestDate)}</span></div>
                    <div id="digest-funnel-content"></div>
                </div>
                <div class="digest-card" id="digest-comparison-card">
                    <div class="digest-card-title">📊 Yesterday vs Last Week</div>
                    <div id="digest-comparison-content"></div>
                </div>
            </div>

            <!-- SDR Snapshot + Notable Events -->
            <div class="digest-two-col">
                <div class="digest-card" id="digest-sdr-card">
                    <div class="digest-card-title">👥 SDR Performance Snapshot <span style="font-size:0.72rem;font-weight:500;color:var(--text-muted);margin-left:auto;">Sorted by activity</span></div>
                    <div id="digest-sdr-content"></div>
                </div>
                <div class="digest-card" id="digest-events-card">
                    <div class="digest-card-title">⚡ Notable Events</div>
                    <div id="digest-events-content"></div>
                </div>
            </div>
        </div>`;

    // ── Populate each section ───────────────────────────────────────────────
    _renderKPICards(data.kpi);
    _renderStatusChips(data.status_snapshot);
    _renderPipelineFunnel(data.pipeline_flow);
    _renderComparisonChart(data.kpi);
    _renderSDRSnapshot(data.sdr_snapshot);
    _renderNotableEvents(data.notable_events);

    // ── Date picker change handler ──────────────────────────────────────────
    const picker = document.getElementById('digest-date-picker');
    if (picker) {
        picker.addEventListener('change', (e) => {
            const newDate = e.target.value;
            if (newDate) {
                // Show loading overlay
                const content = document.getElementById('digest-content');
                if (content) {
                    content.style.opacity = '0.5';
                    content.style.pointerEvents = 'none';
                }
                _loadDigest(root.closest('#view-container') || root.parentElement, newDate);
            }
        });
    }

    // ── PDF Export handler ───────────────────────────────────────────────────
    const pdfBtn = document.getElementById('digest-pdf-btn');
    if (pdfBtn) {
        pdfBtn.addEventListener('click', () => _exportPDF(data, dayLabel));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section Renderers
// ═══════════════════════════════════════════════════════════════════════════════

function _renderKPICards(kpi) {
    const grid = document.getElementById('digest-kpi-grid');
    if (!grid) return;

    const cards = [
        { key: 'new_leads',        label: 'New Leads',        icon: '📥' },
        { key: 'calls_made',       label: 'Calls Made',       icon: '📞' },
        { key: 'meetings_booked',  label: 'Meetings Booked',  icon: '📅' },
        { key: 'pipeline_moved',   label: 'Pipeline Moved',   icon: '🔄' },
        { key: 'leads_researched', label: 'Leads Researched', icon: '🔍' },
        { key: 'demos_completed',  label: 'Demos Completed',  icon: '🎯' },
    ];

    grid.innerHTML = cards.map(({ key, label, icon }) => {
        const d = kpi[key] || { today: 0, compare: 0, delta_pct: null };
        const deltaHtml = _renderDelta(d.delta_pct);
        return `
            <div class="digest-kpi-card">
                <div class="digest-kpi-label">${icon} ${label}</div>
                <div class="digest-kpi-value">${_animateNumber(d.today)}</div>
                ${deltaHtml}
                <div class="digest-kpi-compare">vs ${d.compare} last week</div>
            </div>`;
    }).join('');
}

function _renderDelta(deltaPct) {
    if (deltaPct === null || deltaPct === undefined) {
        return `<span class="digest-kpi-delta neutral">— No change</span>`;
    }
    if (deltaPct === 'new') {
        return `<span class="digest-kpi-delta new-badge">✨ New</span>`;
    }
    const isPositive = deltaPct > 0;
    const isNegative = deltaPct < 0;
    const cls = isPositive ? 'positive' : isNegative ? 'negative' : 'neutral';
    const arrow = isPositive ? '↗' : isNegative ? '↘' : '→';
    const sign = isPositive ? '+' : '';
    return `<span class="digest-kpi-delta ${cls}">${arrow} ${sign}${deltaPct}%</span>`;
}

function _renderStatusChips(snapshot) {
    const container = document.getElementById('digest-status-chips');
    if (!container || !snapshot) return;

    // Pipeline order
    const orderedStatuses = [
        'Lead Assigned', 'Research', 'Calling', 'Meeting Scheduled',
        'Meeting Confirmed', '1st Discovery Meeting', 'Discovery Complete',
        'Demo Scheduled', 'Demo Done', 'Completed', 'Closed',
        'Not Interested', 'Unreachable', 'Disqualified'
    ];

    const sortedEntries = orderedStatuses
        .filter(s => snapshot[s] !== undefined && snapshot[s] > 0)
        .map(s => [s, snapshot[s]]);

    // Add any remaining statuses not in the ordered list
    Object.entries(snapshot).forEach(([status, count]) => {
        if (!orderedStatuses.includes(status) && count > 0) {
            sortedEntries.push([status, count]);
        }
    });

    container.innerHTML = sortedEntries.map(([status, count]) => {
        const color = STATUS_COLORS[status] || '#6b7280';
        return `<div class="digest-status-chip">
            <span class="digest-status-dot" style="background:${color}"></span>
            ${status}: <strong>${count.toLocaleString()}</strong>
        </div>`;
    }).join('');
}

function _renderPipelineFunnel(flow) {
    const container = document.getElementById('digest-funnel-content');
    if (!container) return;

    if (!flow || flow.length === 0) {
        container.innerHTML = `<div class="digest-empty" style="padding:20px;"><div class="digest-empty-icon">🔇</div><p>No pipeline transitions recorded</p></div>`;
        return;
    }

    // Show top transitions as a list of flow arrows
    const html = flow.slice(0, 8).map(t => {
        const fromColor = STATUS_COLORS[t.from_status] || '#6b7280';
        const toColor = STATUS_COLORS[t.to_status] || '#6b7280';
        return `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color,#f4f4f5);">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${fromColor};flex-shrink:0;"></span>
                <span style="font-size:0.82rem;font-weight:500;min-width:100px;">${t.from_status}</span>
                <span style="color:var(--text-muted);font-size:0.85rem;">→</span>
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${toColor};flex-shrink:0;"></span>
                <span style="font-size:0.82rem;font-weight:500;flex:1;">${t.to_status}</span>
                <span style="font-size:0.9rem;font-weight:700;color:var(--primary-color,#6366f1);background:rgba(99,102,241,0.08);padding:2px 10px;border-radius:6px;">${t.count}</span>
            </div>`;
    }).join('');

    const totalMoved = flow.reduce((sum, t) => sum + t.count, 0);
    container.innerHTML = `
        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px;">
            <strong>${totalMoved}</strong> total transitions · Top ${Math.min(flow.length, 8)} shown
        </div>
        ${html}`;
}

function _renderComparisonChart(kpi) {
    const container = document.getElementById('digest-comparison-content');
    if (!container) return;

    const metrics = [
        { key: 'new_leads',        label: 'New Leads' },
        { key: 'calls_made',       label: 'Calls Made' },
        { key: 'meetings_booked',  label: 'Meetings' },
        { key: 'pipeline_moved',   label: 'Pipeline Moved' },
        { key: 'leads_researched', label: 'Researched' },
        { key: 'demos_completed',  label: 'Demos' },
    ];

    const maxVal = Math.max(...metrics.map(m => Math.max(kpi[m.key]?.today || 0, kpi[m.key]?.compare || 0)), 1);

    container.innerHTML = `
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">
            <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:600;color:#6366f1;">
                <span style="width:10px;height:10px;border-radius:2px;background:linear-gradient(90deg,#6366f1,#818cf8);"></span> Selected Day
            </span>
            <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;font-weight:600;color:#a1a1aa;">
                <span style="width:10px;height:10px;border-radius:2px;background:linear-gradient(90deg,#d4d4d8,#a1a1aa);"></span> Last Week
            </span>
        </div>
        <div class="digest-bar-chart">
            ${metrics.map(m => {
                const d = kpi[m.key] || { today: 0, compare: 0 };
                const todayPct = maxVal > 0 ? Math.max((d.today / maxVal) * 100, 2) : 2;
                const comparePct = maxVal > 0 ? Math.max((d.compare / maxVal) * 100, 2) : 2;
                return `
                    <div>
                        <div class="digest-bar-row">
                            <div class="digest-bar-label">${m.label}</div>
                            <div class="digest-bar-track">
                                <div class="digest-bar-fill today" style="width:${todayPct}%">${d.today}</div>
                            </div>
                        </div>
                        <div class="digest-bar-row" style="margin-top:4px;">
                            <div class="digest-bar-label" style="font-size:0.7rem;color:#a1a1aa;">Last week</div>
                            <div class="digest-bar-track">
                                <div class="digest-bar-fill compare" style="width:${comparePct}%">${d.compare}</div>
                            </div>
                        </div>
                    </div>`;
            }).join('')}
        </div>`;
}

function _renderSDRSnapshot(snapshot) {
    const container = document.getElementById('digest-sdr-content');
    if (!container) return;

    if (!snapshot || snapshot.length === 0) {
        container.innerHTML = `<div class="digest-empty" style="padding:20px;"><div class="digest-empty-icon">😶</div><p>No SDR activity recorded for this day</p></div>`;
        return;
    }

    container.innerHTML = `
        <div style="overflow-x:auto;">
            <table class="digest-sdr-table">
                <thead>
                    <tr>
                        <th>SDR</th>
                        <th>Calls</th>
                        <th>Meetings</th>
                        <th>Leads Progressed</th>
                        <th>Activity</th>
                    </tr>
                </thead>
                <tbody>
                    ${snapshot.map((sdr, i) => {
                        const initial = (sdr.name || '?')[0].toUpperCase();
                        const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
                        const callsDelta = _miniDelta(sdr.calls, sdr.calls_last_week);
                        const mtgDelta = _miniDelta(sdr.meetings, sdr.meetings_last_week);
                        return `
                            <tr>
                                <td>
                                    <div class="digest-sdr-name">
                                        <div class="digest-sdr-avatar" style="background:${color}">${initial}</div>
                                        ${sdr.name}
                                    </div>
                                </td>
                                <td>${sdr.calls} ${callsDelta}</td>
                                <td>${sdr.meetings} ${mtgDelta}</td>
                                <td>${sdr.leads_progressed}</td>
                                <td><strong>${sdr.total_activity}</strong></td>
                            </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
}

function _renderNotableEvents(events) {
    const container = document.getElementById('digest-events-content');
    if (!container) return;

    if (!events || events.length === 0) {
        container.innerHTML = `<div class="digest-empty" style="padding:20px;"><div class="digest-empty-icon">✨</div><p>No notable events for this day</p></div>`;
        return;
    }

    container.innerHTML = `
        <div class="digest-events-list">
            ${events.map(e => `
                <div class="digest-event ${e.type}">
                    <div style="font-size:0.92rem;line-height:1.5;">${e.message}</div>
                </div>
            `).join('')}
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF Export
// ═══════════════════════════════════════════════════════════════════════════════

function _exportPDF(data, dayLabel) {
    // Use the browser's print-to-PDF functionality with a clean layout
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast('Pop-up blocked! Please allow pop-ups for PDF export.', 'warning');
        return;
    }

    const kpiCards = Object.entries(data.kpi).map(([key, val]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const delta = val.delta_pct === null ? '—' : val.delta_pct === 'new' ? 'New' : `${val.delta_pct > 0 ? '+' : ''}${val.delta_pct}%`;
        return `<div style="border:1px solid #e4e4e7;border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:0.7rem;font-weight:600;color:#71717a;text-transform:uppercase;">${label}</div>
            <div style="font-size:1.8rem;font-weight:800;margin:6px 0;">${val.today}</div>
            <div style="font-size:0.75rem;color:${val.delta_pct > 0 ? '#059669' : val.delta_pct < 0 ? '#dc2626' : '#71717a'}">${delta} vs ${val.compare}</div>
        </div>`;
    }).join('');

    const flowRows = (data.pipeline_flow || []).map(t =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #f4f4f5;">${t.from_status}</td><td style="padding:6px 12px;">→</td><td style="padding:6px 12px;border-bottom:1px solid #f4f4f5;">${t.to_status}</td><td style="padding:6px 12px;font-weight:700;text-align:right;border-bottom:1px solid #f4f4f5;">${t.count}</td></tr>`
    ).join('');

    const sdrRows = (data.sdr_snapshot || []).map(s =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #f4f4f5;font-weight:600;">${s.name}</td><td style="padding:8px 12px;border-bottom:1px solid #f4f4f5;text-align:center;">${s.calls}</td><td style="padding:8px 12px;border-bottom:1px solid #f4f4f5;text-align:center;">${s.meetings}</td><td style="padding:8px 12px;border-bottom:1px solid #f4f4f5;text-align:center;">${s.leads_progressed}</td><td style="padding:8px 12px;border-bottom:1px solid #f4f4f5;text-align:center;font-weight:700;">${s.total_activity}</td></tr>`
    ).join('');

    const eventsHtml = (data.notable_events || []).map(e =>
        `<div style="padding:8px 14px;margin-bottom:6px;border-radius:8px;background:${e.type === 'achievement' ? '#ecfdf5' : e.type === 'warning' ? '#fffbeb' : '#eff6ff'};font-size:0.85rem;">${e.message}</div>`
    ).join('');

    const statusChips = Object.entries(data.status_snapshot || {})
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `<span style="display:inline-block;padding:4px 12px;margin:3px;border-radius:20px;background:#f4f4f5;font-size:0.78rem;font-weight:600;">${status}: ${count}</span>`)
        .join('');

    printWindow.document.write(`<!DOCTYPE html><html><head>
        <title>Daily Digest — ${dayLabel}</title>
        <style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#18181b; padding:40px; max-width:800px; margin:0 auto; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            h1 { font-size:1.4rem; margin-bottom:4px; }
            .subtitle { font-size:0.82rem; color:#71717a; margin-bottom:24px; }
            .section-title { font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#71717a; margin:24px 0 12px; }
            .kpi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:24px; }
            .status-chips { margin-bottom:20px; }
            table { width:100%; border-collapse:collapse; font-size:0.82rem; }
            th { text-align:left; padding:8px 12px; font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#71717a; border-bottom:2px solid #e4e4e7; }
            @media print {
                body { padding:20px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
                .no-print { display:none; }
            }
        </style>
    </head><body>
        <h1>📰 RCM Daily Digest</h1>
        <div class="subtitle">${dayLabel} · Compared to ${new Date(data.comparison_date + 'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div>

        <div class="section-title">KPI Summary</div>
        <div class="kpi-grid">${kpiCards}</div>

        <div class="section-title">Pipeline Snapshot</div>
        <div class="status-chips">${statusChips || '<span style="color:#71717a;font-size:0.85rem;">No data</span>'}</div>

        <div class="section-title">Pipeline Transitions</div>
        <table>${flowRows || '<tr><td style="color:#71717a;padding:12px;">No transitions recorded</td></tr>'}</table>

        <div class="section-title">SDR Performance</div>
        <table>
            <thead><tr><th>SDR</th><th style="text-align:center;">Calls</th><th style="text-align:center;">Meetings</th><th style="text-align:center;">Progressed</th><th style="text-align:center;">Activity</th></tr></thead>
            <tbody>${sdrRows || '<tr><td colspan="5" style="text-align:center;padding:16px;color:#71717a;">No activity</td></tr>'}</tbody>
        </table>

        <div class="section-title">Notable Events</div>
        ${eventsHtml || '<div style="color:#71717a;font-size:0.85rem;">No notable events</div>'}

        <div style="margin-top:32px;font-size:0.7rem;color:#a1a1aa;text-align:center;">
            Generated by RCM · ${new Date().toLocaleString()}
        </div>
    </body></html>`);

    printWindow.document.close();
    // Trigger print once ready — but never wait longer than 1.5s regardless.
    // No external fonts are loaded here (see above), so document.fonts.ready
    // should resolve near-instantly; the timeout is just a safety net so a
    // slow/blocked resource can never silently prevent the dialog from
    // opening at all (the original bug: an external Google Fonts request
    // gated this, and a blocked/slow font load meant print() never fired).
    let _printed = false;
    const triggerPrint = () => {
        if (_printed) return;
        _printed = true;
        // Some browsers open this as a background tab; print() on an
        // unfocused window can render a blank print preview even though
        // the document itself is fully populated. Focusing first fixes it.
        try { printWindow.focus(); } catch (e) { /* ignore */ }
        try { printWindow.print(); } catch (e) { console.warn('[PDF] Print failed:', e); }
    };
    if (printWindow.document.fonts && printWindow.document.fonts.ready) {
        printWindow.document.fonts.ready.then(() => setTimeout(triggerPrint, 300));
    }
    setTimeout(triggerPrint, 1500);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function _yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return _fmtDate(d);
}

function _fmtDate(d) {
    // Local calendar date, NOT toISOString() (which forces UTC) — for anyone
    // in a positive UTC-offset timezone (e.g. IST, UTC+5:30), toISOString()
    // silently rolled the date back an extra day during the hours after
    // local midnight but before UTC midnight catches up (roughly 12:00am-
    // 5:30am IST), so "yesterday" showed data from two days back instead.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function _shortDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _animateNumber(n) {
    return n.toLocaleString();
}

function _miniDelta(today, lastWeek) {
    if (lastWeek === 0 && today === 0) return '';
    if (lastWeek === 0 && today > 0) return '<span class="digest-sdr-delta up">new</span>';
    if (today === lastWeek) return '';
    const diff = today - lastWeek;
    const cls = diff > 0 ? 'up' : 'down';
    const sign = diff > 0 ? '+' : '';
    return `<span class="digest-sdr-delta ${cls}">${sign}${diff}</span>`;
}
