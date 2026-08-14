// ── views/sdr_performance.js — SDR performance drill-down ─────────────────────
import { fetchSdrPerformance } from '../api.js';
import { showLoader } from '../utils.js';

export async function renderSdrPerformance(container, sdrId, loadView, filters = {}) {
    showLoader(container);

    const period = filters.period || 'all_time';
    let data;
    try {
        data = await fetchSdrPerformance(sdrId, { period, start_date: filters.start_date, end_date: filters.end_date });
    } catch (e) {
        container.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-muted);">
            <div style="font-size:2.5rem;margin-bottom:12px;">⚠️</div>
            <p>${e.message || 'Failed to load SDR performance.'}</p>
            <button class="btn btn-outline" style="margin-top:16px;" id="sdr-perf-back">← Back to Leaderboard</button>
        </div>`;
        container.querySelector('#sdr-perf-back')?.addEventListener('click', () => loadView('leaderboard'));
        return;
    }

    const sdr = data.sdr;
    const prod = data.productivity;
    const conv = data.conversion;
    const eff = data.efficiency;
    const funnel = data.funnel;

    const periodLabels = { today: 'Today', this_week: 'This Week', this_month: 'This Month', all_time: 'All Time' };
    const activePeriod = period;

    // Funnel colors for each stage
    const funnelColors = {
        'Lead Assigned': '#6366f1',
        'Research': '#8b5cf6',
        'Calling': '#3b82f6',
        'Meeting Scheduled': '#10b981',
        '1st Discovery Meeting': '#a855f7',
        'Discovery Complete': '#7c3aed',
        'Demo Scheduled': '#0ea5e9',
        'Demo Done': '#059669',
        'Completed': '#16a34a',
        'Disqualified': '#ef4444',
    };

    const funnelTotal = Object.values(funnel).reduce((a, b) => a + b, 0) || 1;

    // Build funnel bars
    const funnelBars = Object.entries(funnel).map(([stage, count]) => {
        const pct = Math.round((count / funnelTotal) * 100);
        const color = funnelColors[stage] || '#94a3b8';
        return `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <div style="width:160px;font-size:0.82rem;font-weight:600;color:var(--text-main);text-align:right;flex-shrink:0;">${stage}</div>
            <div style="flex:1;background:var(--bg-secondary);border-radius:8px;height:28px;position:relative;overflow:hidden;">
                <div style="width:${pct}%;min-width:${count > 0 ? '24px' : '0'};height:100%;background:${color};border-radius:8px;transition:width 0.6s ease;"></div>
            </div>
            <div style="width:60px;font-size:0.85rem;font-weight:700;color:var(--text-main);">${count} <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem;">(${pct}%)</span></div>
        </div>`;
    }).join('');

    // Avg time display
    const avgTimeDisplay = eff.avg_time_per_lead_hours != null
        ? (eff.avg_time_per_lead_hours >= 24
            ? `${Math.round(eff.avg_time_per_lead_hours / 24)}d`
            : `${eff.avg_time_per_lead_hours}h`)
        : '—';
    const medianTimeDisplay = eff.median_time_per_lead_hours != null
        ? (eff.median_time_per_lead_hours >= 24
            ? `${Math.round(eff.median_time_per_lead_hours / 24)}d`
            : `${eff.median_time_per_lead_hours}h`)
        : '—';

    container.innerHTML = `
    <div class="fade-in">
        <div class="page-header" style="margin-bottom:28px;">
            <div>
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                    <button class="btn btn-outline" id="sdr-perf-back" style="padding:6px 12px;font-size:0.82rem;">← Back</button>
                    <h1 class="page-title" style="margin:0;">${sdr.name || sdr.email}</h1>
                </div>
                <p class="page-subtitle">${sdr.pod_name ? `POD: ${sdr.pod_name} · ` : ''}${sdr.email} · Performance Analytics</p>
            </div>
        </div>

        <!-- Time Filter -->
        <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;align-items:center;" id="sdr-perf-filters">
            ${Object.entries(periodLabels).map(([key, label]) => `
                <button class="btn ${key === activePeriod ? 'btn-primary' : 'btn-outline'}" data-period="${key}" style="padding:6px 16px;font-size:0.82rem;">${label}</button>
            `).join('')}
            <button class="btn ${activePeriod === 'custom' ? 'btn-primary' : 'btn-outline'}" data-period="custom" style="padding:6px 16px;font-size:0.82rem;">📅 Custom</button>
        </div>
        <div id="sdr-perf-date-range" style="display:${activePeriod === 'custom' ? 'flex' : 'none'};gap:12px;align-items:center;margin-bottom:24px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:6px;">
                <label style="font-size:0.82rem;font-weight:600;color:var(--text-muted);">From</label>
                <input type="date" id="sdr-perf-date-from" style="padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;font-size:0.85rem;" value="${filters.start_date || ''}">
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <label style="font-size:0.82rem;font-weight:600;color:var(--text-muted);">To</label>
                <input type="date" id="sdr-perf-date-to" style="padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;font-size:0.85rem;" value="${filters.end_date || ''}">
            </div>
            <button class="btn btn-primary btn-sm" id="sdr-perf-apply-dates" style="padding:6px 16px;font-size:0.82rem;">Apply</button>
        </div>

        <!-- Metric Cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:28px;">
            ${_metricCard('📋', 'Leads Assigned', prod.total_leads_assigned, '#6366f1')}
            ${_metricCard('🔥', 'Active Leads', prod.active_leads, '#3b82f6')}
            ${_metricCard('✅', 'Leads Closed', prod.leads_closed, '#10b981')}
            ${_metricCard('📞', 'Calls Made', prod.calls_made, '#8b5cf6')}
            ${_metricCard('📊', 'Avg Calls/Lead', prod.avg_calls_per_lead, '#f59e0b')}
            ${_metricCard('🤝', 'Meetings', conv.meetings_scheduled, '#10b981')}
            ${_metricCard('📈', 'Conv. Rate', conv.conversion_rate + '%', conv.conversion_rate >= 20 ? '#10b981' : conv.conversion_rate >= 10 ? '#f59e0b' : '#ef4444')}
            ${_metricCard('⏱️', 'Avg Time/Lead', avgTimeDisplay, '#64748b')}
        </div>

        <!-- Funnel -->
        <div style="background:var(--surface-color);border:1px solid var(--border-color);border-radius:14px;padding:24px;margin-bottom:28px;">
            <h3 style="font-size:1rem;font-weight:700;margin-bottom:20px;">Pipeline Funnel</h3>
            ${funnelBars}
        </div>

        <!-- Efficiency Detail -->
        <div style="background:var(--surface-color);border:1px solid var(--border-color);border-radius:14px;padding:24px;">
            <h3 style="font-size:1rem;font-weight:700;margin-bottom:16px;">Efficiency Metrics</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                <div style="padding:16px;background:var(--bg-secondary);border-radius:10px;">
                    <div style="font-size:0.78rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">Avg Time Per Lead</div>
                    <div style="font-size:1.4rem;font-weight:800;color:var(--text-main);">${avgTimeDisplay}</div>
                </div>
                <div style="padding:16px;background:var(--bg-secondary);border-radius:10px;">
                    <div style="font-size:0.78rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">Median Time Per Lead</div>
                    <div style="font-size:1.4rem;font-weight:800;color:var(--text-main);">${medianTimeDisplay}</div>
                </div>
            </div>
        </div>
    </div>`;

    // Back button
    container.querySelector('#sdr-perf-back')?.addEventListener('click', () => loadView('leaderboard'));

    // Time filter buttons (preset + custom)
    container.querySelectorAll('#sdr-perf-filters button').forEach(btn => {
        btn.addEventListener('click', () => {
            const newPeriod = btn.dataset.period;
            if (newPeriod === 'custom') {
                // Show date range picker
                const dateRange = document.getElementById('sdr-perf-date-range');
                if (dateRange) dateRange.style.display = 'flex';
                // Highlight custom button
                container.querySelectorAll('#sdr-perf-filters button').forEach(b => b.classList.remove('btn-primary'));
                container.querySelectorAll('#sdr-perf-filters button').forEach(b => b.classList.add('btn-outline'));
                btn.classList.remove('btn-outline');
                btn.classList.add('btn-primary');
            } else {
                renderSdrPerformance(container, sdrId, loadView, { period: newPeriod });
            }
        });
    });

    // Apply custom date range
    const applyDatesBtn = document.getElementById('sdr-perf-apply-dates');
    if (applyDatesBtn) {
        applyDatesBtn.addEventListener('click', () => {
            const fromDate = document.getElementById('sdr-perf-date-from')?.value;
            const toDate = document.getElementById('sdr-perf-date-to')?.value;
            if (fromDate && toDate) {
                renderSdrPerformance(container, sdrId, loadView, {
                    period: 'custom',
                    start_date: fromDate,
                    end_date: toDate
                });
            }
        });
    }
}

function _metricCard(icon, label, value, color) {
    return `
    <div style="background:var(--surface-color);border:1px solid var(--border-color);border-radius:14px;padding:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="font-size:1.2rem;">${icon}</span>
            <span style="font-size:0.78rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;">${label}</span>
        </div>
        <div style="font-size:1.6rem;font-weight:800;color:${color};line-height:1;">${value}</div>
    </div>`;
}
