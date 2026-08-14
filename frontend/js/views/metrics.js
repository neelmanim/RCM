// ── views/metrics.js — SDR Usage Metrics Dashboard ────────────────────────────
import { fetchMetricsSummary, fetchMetricsDailyTrend, fetchMetricsSdrTable, exportMetricsUrl } from '../api.js';
import { authHeaders } from '../auth.js';

let currentRange = 30;
let currentStartDate = '';
let currentEndDate = '';
let trendChart = null;

// ── Pagination & Filter state ─────────────────────────────────────────────────
let sdrData = [];          // full dataset
let sdrFilterText = '';    // search filter
let sdrPage = 1;           // current page
const SDR_PAGE_SIZE = 10;

function formatTime(minutes) {
    if (!minutes) return '0m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getDefaultDates(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
    };
}

export async function renderMetrics(container) {
    const defaults = getDefaultDates(currentRange);
    container.innerHTML = `
        <style>
            @keyframes skeletonPulse {
                0%, 100% { opacity: 1; }
                50%      { opacity: 0.4; }
            }
            .skel-bar { background:var(--skeleton-bg,#e5e7eb); animation:skeletonPulse 1.4s ease-in-out infinite; }
        </style>
        <div class="metrics-dashboard fade-in">
            <!-- ── Header ─────────────────────────────────────────────── -->
            <div class="metrics-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:24px;">
                <div>
                    <h2 style="margin:0;font-size:1.3rem;font-weight:700;color:#18181b;">📊 SDR Usage Metrics</h2>
                    <p style="color:#71717a;font-size:0.82rem;margin:4px 0 0;">Track tool adoption, activity trends, and per-SDR performance</p>
                </div>

                <!-- ── Date Range Picker ──────────────────────────────── -->
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid #e4e4e7;border-radius:10px;padding:6px 12px;">
                        <label style="font-size:0.72rem;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.04em;">From</label>
                        <input type="date" id="metrics-date-start" value="${defaults.start}" style="border:none;background:none;font-size:0.82rem;font-family:inherit;color:#18181b;outline:none;cursor:pointer;">
                    </div>
                    <span style="color:#a1a1aa;font-size:0.82rem;">→</span>
                    <div style="display:flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid #e4e4e7;border-radius:10px;padding:6px 12px;">
                        <label style="font-size:0.72rem;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.04em;">To</label>
                        <input type="date" id="metrics-date-end" value="${defaults.end}" style="border:none;background:none;font-size:0.82rem;font-family:inherit;color:#18181b;outline:none;cursor:pointer;">
                    </div>

                    <!-- Preset buttons -->
                    <div style="display:flex;gap:4px;" id="range-presets">
                        <button class="range-preset" data-days="7" style="padding:5px 12px;border-radius:8px;border:1px solid #e4e4e7;background:#fff;font-size:0.75rem;font-weight:600;color:#71717a;cursor:pointer;transition:all 0.15s;">7D</button>
                        <button class="range-preset active" data-days="30" style="padding:5px 12px;border-radius:8px;border:1px solid #2563eb;background:#eff6ff;font-size:0.75rem;font-weight:600;color:#2563eb;cursor:pointer;transition:all 0.15s;">30D</button>
                        <button class="range-preset" data-days="90" style="padding:5px 12px;border-radius:8px;border:1px solid #e4e4e7;background:#fff;font-size:0.75rem;font-weight:600;color:#71717a;cursor:pointer;transition:all 0.15s;">90D</button>
                        <button class="range-preset" data-days="180" style="padding:5px 12px;border-radius:8px;border:1px solid #e4e4e7;background:#fff;font-size:0.75rem;font-weight:600;color:#71717a;cursor:pointer;transition:all 0.15s;">180D</button>
                    </div>

                    <!-- Export -->
                    <div class="dropdown" style="position:relative;">
                        <button class="btn btn-primary" id="export-btn" style="padding:8px 16px;border-radius:10px;font-size:0.82rem;font-weight:600;">📥 Export</button>
                        <div class="dropdown-menu" id="export-menu" style="display:none;position:absolute;right:0;top:100%;margin-top:4px;background:#fff;border:1px solid #e4e4e7;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:10;min-width:140px;overflow:hidden;">
                            <a href="#" id="export-csv" style="display:block;padding:10px 16px;font-size:0.82rem;color:#18181b;text-decoration:none;transition:background 0.15s;">📄 Export CSV</a>
                            <a href="#" id="export-xlsx" style="display:block;padding:10px 16px;font-size:0.82rem;color:#18181b;text-decoration:none;border-top:1px solid #f4f4f5;transition:background 0.15s;">📊 Export Excel</a>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ── KPI Cards (skeleton) ───────────────────────────────── -->
            <div class="kpi-cards" id="kpi-cards">
                ${Array(5).fill('').map(() => `
                    <div class="kpi-card" style="min-height:90px;">
                        <div class="skel-bar" style="width:80px;height:10px;border-radius:4px;margin-bottom:12px;"></div>
                        <div class="skel-bar" style="width:60px;height:28px;border-radius:6px;margin-bottom:6px;"></div>
                        <div class="skel-bar" style="width:50px;height:10px;border-radius:4px;"></div>
                    </div>
                `).join('')}
            </div>

            <!-- ── Charts Row ─────────────────────────────────────────── -->
            <div class="charts-row">
                <div class="chart-card">
                    <h3>Daily Tool Usage Trend</h3>
                    <div style="position:relative;height:280px;width:100%;">
                        <canvas id="trend-chart"></canvas>
                    </div>
                </div>
                <div class="chart-card">
                    <h3>Feature Usage Breakdown</h3>
                    <div id="feature-bars"></div>
                </div>
            </div>

            <!-- ── SDR Table ──────────────────────────────────────────── -->
            <div class="sdr-table-card" style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
                    <h3 style="margin:0;font-size:1rem;font-weight:700;color:#18181b;">Per-SDR Performance</h3>
                    <!-- Search Filter -->
                    <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e4e4e7;border-radius:10px;padding:6px 14px;min-width:220px;">
                        <span style="font-size:0.85rem;color:#a1a1aa;">🔍</span>
                        <input type="text" id="sdr-search" placeholder="Search SDR name..." style="border:none;background:none;font-size:0.82rem;font-family:inherit;color:#18181b;outline:none;width:100%;">
                    </div>
                </div>
                <div class="table-responsive">
                    <table class="table" id="sdr-table">
                        <thead>
                            <tr>
                                <th>SDR Name</th>
                                <th>Lead Views</th>
                                <th>Calls</th>
                                <th>Meetings</th>
                                <th>Time Spent</th>
                                <th>Total Actions</th>
                            </tr>
                        </thead>
                        <tbody id="sdr-table-body">
                            ${Array(5).fill('').map(() => `
                                <tr>
                                    <td><div class="skel-bar" style="width:120px;height:14px;border-radius:4px;"></div></td>
                                    <td><div class="skel-bar" style="width:40px;height:14px;border-radius:4px;margin:0 auto;"></div></td>
                                    <td><div class="skel-bar" style="width:40px;height:14px;border-radius:4px;margin:0 auto;"></div></td>
                                    <td><div class="skel-bar" style="width:40px;height:14px;border-radius:4px;margin:0 auto;"></div></td>
                                    <td><div class="skel-bar" style="width:60px;height:14px;border-radius:4px;margin:0 auto;"></div></td>
                                    <td><div class="skel-bar" style="width:40px;height:14px;border-radius:4px;margin:0 auto;"></div></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <!-- Pagination -->
                <div id="sdr-pagination" style="display:flex;align-items:center;justify-content:space-between;margin-top:16px;padding-top:14px;border-top:1px solid #f4f4f5;"></div>
            </div>
        </div>
    `;

    // ── Wire up date inputs ─────────────────────────────────────────────────
    const dateStart = document.getElementById('metrics-date-start');
    const dateEnd = document.getElementById('metrics-date-end');

    function applyDateRange() {
        const startVal = dateStart.value;
        const endVal = dateEnd.value;
        const start = new Date(startVal);
        const end = new Date(endVal);
        if (isNaN(start) || isNaN(end) || start > end) return;
        const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        currentRange = Math.max(diffDays, 1);
        currentStartDate = startVal;
        currentEndDate = endVal;

        // Clear preset active states
        document.querySelectorAll('#range-presets .range-preset').forEach(b => {
            b.style.border = '1px solid #e4e4e7';
            b.style.background = '#fff';
            b.style.color = '#71717a';
            b.classList.remove('active');
        });
        loadAllMetrics();
    }

    dateStart.addEventListener('change', applyDateRange);
    dateEnd.addEventListener('change', applyDateRange);

    // ── Wire up preset buttons ─────────────────────────────────────────────
    document.querySelectorAll('#range-presets .range-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const days = parseInt(btn.dataset.days);
            currentRange = days;
            const d = getDefaultDates(days);
            dateStart.value = d.start;
            dateEnd.value = d.end;
            currentStartDate = d.start;
            currentEndDate = d.end;

            document.querySelectorAll('#range-presets .range-preset').forEach(b => {
                b.style.border = '1px solid #e4e4e7';
                b.style.background = '#fff';
                b.style.color = '#71717a';
                b.classList.remove('active');
            });
            btn.style.border = '1px solid #2563eb';
            btn.style.background = '#eff6ff';
            btn.style.color = '#2563eb';
            btn.classList.add('active');
            loadAllMetrics();
        });
    });

    // ── Wire up export ─────────────────────────────────────────────────────
    const exportBtn = document.getElementById('export-btn');
    const exportMenu = document.getElementById('export-menu');
    exportBtn.addEventListener('click', () => {
        exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
        if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) {
            exportMenu.style.display = 'none';
        }
    });
    document.getElementById('export-csv').addEventListener('click', (e) => {
        e.preventDefault();
        window.open(exportMetricsUrl(currentRange, 'csv', currentStartDate, currentEndDate) + '&token=' + localStorage.getItem('crm_token'), '_blank');
        exportMenu.style.display = 'none';
    });
    document.getElementById('export-xlsx').addEventListener('click', (e) => {
        e.preventDefault();
        window.open(exportMetricsUrl(currentRange, 'xlsx', currentStartDate, currentEndDate) + '&token=' + localStorage.getItem('crm_token'), '_blank');
        exportMenu.style.display = 'none';
    });

    // ── Wire up SDR search ─────────────────────────────────────────────────
    document.getElementById('sdr-search').addEventListener('input', (e) => {
        sdrFilterText = e.target.value.toLowerCase().trim();
        sdrPage = 1;
        renderSdrTablePage();
    });

    loadAllMetrics();
}

async function loadAllMetrics() {
    await Promise.all([
        loadKpiCards(),
        loadTrendChart(),
        loadSdrTable(),
    ]);
}

async function loadKpiCards() {
    const container = document.getElementById('kpi-cards');
    try {
        const data = await fetchMetricsSummary(currentRange, currentStartDate, currentEndDate);
        container.innerHTML = `
            <div class="kpi-card">
                <span class="kpi-label">DAILY ACTIVE SDRs</span>
                <span class="kpi-value">${data.daily_active_sdrs || 0}</span>
            </div>
            <div class="kpi-card">
                <span class="kpi-label">LEADS PROCESSED</span>
                <span class="kpi-value">${data.leads_processed || 0}</span>
            </div>
            <div class="kpi-card">
                <span class="kpi-label">MEETINGS SCHEDULED</span>
                <span class="kpi-value">${data.meetings_scheduled || 0}</span>
            </div>
            <div class="kpi-card">
                <span class="kpi-label">AVG TIME / SDR</span>
                <span class="kpi-value">${formatTime(data.avg_time_per_sdr_minutes)}</span>
            </div>
            <div class="kpi-card">
                <span class="kpi-label">MOST USED</span>
                <span class="kpi-value kpi-value-sm">${data.most_used_feature || '—'}</span>
                <span class="kpi-sub">${data.most_used_feature_count || 0} actions</span>
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<div class="alert alert-warning">Failed to load metrics summary</div>`;
    }
}

async function loadTrendChart() {
    try {
        const data = await fetchMetricsDailyTrend(currentRange, currentStartDate, currentEndDate);
        const featureBars = document.getElementById('feature-bars');

        if (!data.length) {
            const chartParent = document.getElementById('trend-chart').parentElement;
            chartParent.innerHTML = '<p class="text-muted text-center" style="padding-top:100px;">No data yet. Activity will appear here after daily aggregation runs.</p>';
            featureBars.innerHTML = '<p class="text-muted text-center">No data available</p>';
            return;
        }

        const ctx = document.getElementById('trend-chart').getContext('2d');
        if (trendChart) trendChart.destroy();

        // Format dates nicely
        const labels = data.map(d => {
            const dt = new Date(d.date || d.summary_date);
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        // Convert time to hours for better readability
        const timeHours = data.map(d => Math.round((d.time_spent_minutes || 0) / 60 * 10) / 10);

        trendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Lead Views',
                        data: data.map(d => d.lead_views || 0),
                        backgroundColor: 'rgba(13,110,110,0.7)',
                        borderRadius: 4,
                        order: 2,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Calls Logged',
                        data: data.map(d => d.calls_logged || 0),
                        backgroundColor: 'rgba(99,102,241,0.7)',
                        borderRadius: 4,
                        order: 2,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Meetings',
                        data: data.map(d => d.meetings || 0),
                        backgroundColor: 'rgba(22,163,74,0.7)',
                        borderRadius: 4,
                        order: 2,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Time Spent (hrs)',
                        data: timeHours,
                        type: 'line',
                        borderColor: '#8B5CF6',
                        backgroundColor: 'rgba(139,92,246,0.08)',
                        borderWidth: 2.5,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        fill: true,
                        tension: 0.4,
                        order: 1,
                        yAxisID: 'y1',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, padding: 16, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                if (ctx.dataset.yAxisID === 'y1') {
                                    return `${ctx.dataset.label}: ${ctx.parsed.y}h`;
                                }
                                return `${ctx.dataset.label}: ${ctx.parsed.y}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxRotation: 45,
                            font: { size: 10 },
                            maxTicksLimit: 15,
                        }
                    },
                    y: {
                        position: 'left',
                        beginAtZero: true,
                        title: { display: true, text: 'Activity Count', font: { size: 11 } },
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        ticks: { font: { size: 10 } },
                        stacked: true,
                    },
                    y1: {
                        position: 'right',
                        beginAtZero: true,
                        title: { display: true, text: 'Time (hours)', font: { size: 11 }, color: '#8B5CF6' },
                        grid: { drawOnChartArea: false },
                        ticks: { font: { size: 10 }, color: '#8B5CF6' },
                    }
                }
            }
        });

        // Feature bars
        const totals = data.reduce((acc, d) => ({
            lead_views: acc.lead_views + (d.lead_views || 0),
            status_updates: acc.status_updates + (d.status_updates || 0),
            calls_logged: acc.calls_logged + (d.calls_logged || 0),
            meetings: acc.meetings + (d.meetings || 0),
            time_spent: acc.time_spent + (d.time_spent_minutes || 0),
        }), { lead_views: 0, status_updates: 0, calls_logged: 0, meetings: 0, time_spent: 0 });

        // Separate max for activity vs time to prevent time from dwarfing activities
        const activityMax = Math.max(totals.lead_views, totals.status_updates, totals.calls_logged, totals.meetings, 1);
        const bars = [
            { label: 'Lead Views', val: totals.lead_views, pct: totals.lead_views / activityMax * 100, color: '#0D6E6E', display: totals.lead_views.toLocaleString() },
            { label: 'Status Updates', val: totals.status_updates, pct: totals.status_updates / activityMax * 100, color: '#E07B54', display: totals.status_updates.toLocaleString() },
            { label: 'Calls Logged', val: totals.calls_logged, pct: totals.calls_logged / activityMax * 100, color: '#6366F1', display: totals.calls_logged.toLocaleString() },
            { label: 'Meetings', val: totals.meetings, pct: totals.meetings / activityMax * 100, color: '#16A34A', display: totals.meetings.toLocaleString() },
            { label: 'Time (min)', val: totals.time_spent, pct: 100, color: '#8B5CF6', display: formatTime(totals.time_spent) },
        ];

        featureBars.innerHTML = bars.map(b => `
            <div class="feature-bar-row">
                <span class="feature-bar-label">${b.label}</span>
                <div class="feature-bar-track">
                    <div class="feature-bar-fill" style="width: ${b.pct.toFixed(1)}%; background: ${b.color};"></div>
                </div>
                <span class="feature-bar-val">${b.display}</span>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load trend chart:', e);
    }
}

async function loadSdrTable() {
    const tbody = document.getElementById('sdr-table-body');
    try {
        sdrData = await fetchMetricsSdrTable(currentRange, currentStartDate, currentEndDate);
        sdrPage = 1;
        sdrFilterText = '';
        const searchInput = document.getElementById('sdr-search');
        if (searchInput) searchInput.value = '';
        renderSdrTablePage();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Failed to load SDR data</td></tr>`;
        document.getElementById('sdr-pagination').innerHTML = '';
    }
}

function renderSdrTablePage() {
    const tbody = document.getElementById('sdr-table-body');
    const paginationEl = document.getElementById('sdr-pagination');

    // Filter
    const filtered = sdrFilterText
        ? sdrData.filter(r => (r.user_name || r.user_email || '').toLowerCase().includes(sdrFilterText))
        : sdrData;

    const totalCount = filtered.length;
    const totalPages = Math.max(Math.ceil(totalCount / SDR_PAGE_SIZE), 1);
    sdrPage = Math.min(sdrPage, totalPages);
    sdrPage = Math.max(sdrPage, 1);

    const startIdx = (sdrPage - 1) * SDR_PAGE_SIZE;
    const endIdx = Math.min(startIdx + SDR_PAGE_SIZE, totalCount);
    const pageData = filtered.slice(startIdx, endIdx);

    if (!totalCount) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No SDR activity data${sdrFilterText ? ' matching "' + sdrFilterText + '"' : ''}</td></tr>`;
        paginationEl.innerHTML = '';
        return;
    }

    tbody.innerHTML = pageData.map((r, i) => `
        <tr style="${i % 2 === 1 ? 'background: #FAFBFC;' : ''}">
            <td><strong>${r.user_name || r.user_email}</strong></td>
            <td class="text-center">${r.lead_views || 0}</td>
            <td class="text-center">${r.calls_logged || 0}</td>
            <td class="text-center" style="color: #16A34A; font-weight: 600;">${r.meetings || 0}</td>
            <td class="text-center" style="color: #8B5CF6; font-weight: 600;">${formatTime(r.time_spent_minutes)}</td>
            <td class="text-center" style="color: #0D6E6E; font-weight: 700;">${r.total_actions || 0}</td>
        </tr>
    `).join('');

    // Pagination controls
    paginationEl.innerHTML = `
        <span style="font-size:0.78rem;color:#71717a;">Showing ${startIdx + 1}–${endIdx} of ${totalCount}${sdrFilterText ? ' (filtered)' : ''}</span>
        <div style="display:flex;align-items:center;gap:6px;">
            <button id="sdr-prev" ${sdrPage <= 1 ? 'disabled' : ''} style="padding:6px 12px;border-radius:8px;border:1px solid ${sdrPage <= 1 ? '#f4f4f5' : '#e4e4e7'};background:${sdrPage <= 1 ? '#fafafa' : '#fff'};font-size:0.78rem;font-weight:600;color:${sdrPage <= 1 ? '#d4d4d8' : '#475569'};cursor:${sdrPage <= 1 ? 'not-allowed' : 'pointer'};transition:all 0.15s;">← Prev</button>
            <span style="font-size:0.78rem;font-weight:600;color:#18181b;padding:0 8px;">${sdrPage} / ${totalPages}</span>
            <button id="sdr-next" ${sdrPage >= totalPages ? 'disabled' : ''} style="padding:6px 12px;border-radius:8px;border:1px solid ${sdrPage >= totalPages ? '#f4f4f5' : '#e4e4e7'};background:${sdrPage >= totalPages ? '#fafafa' : '#fff'};font-size:0.78rem;font-weight:600;color:${sdrPage >= totalPages ? '#d4d4d8' : '#475569'};cursor:${sdrPage >= totalPages ? 'not-allowed' : 'pointer'};transition:all 0.15s;">Next →</button>
        </div>
    `;

    // Wire pagination buttons
    const prevBtn = document.getElementById('sdr-prev');
    const nextBtn = document.getElementById('sdr-next');
    if (prevBtn && sdrPage > 1) {
        prevBtn.addEventListener('click', () => { sdrPage--; renderSdrTablePage(); });
    }
    if (nextBtn && sdrPage < totalPages) {
        nextBtn.addEventListener('click', () => { sdrPage++; renderSdrTablePage(); });
    }
}
