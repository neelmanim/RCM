// ── views/leaderboard.js — SDR/AE performance leaderboard ────────────────────
import { fetchLeaderboard, fetchAELeaderboard } from '../api.js';
import { showLoader } from '../utils.js';
import { isSDR, isAdmin, currentUser } from '../auth.js';
import { mp } from '../mp.js';

let currentRange = 0; // 0 = all time
let currentTab = 'sdr'; // 'sdr' | 'ae'

// ── Pod view state (independent from dashboard/leads) ──────────────────────
function _getLbGlobalView() {
    try { return JSON.parse(sessionStorage.getItem('leaderboard_view_state'))?.globalView === true; } catch { return false; }
}
function _setLbGlobalView(val) {
    sessionStorage.setItem('leaderboard_view_state', JSON.stringify({ globalView: val }));
}
function _isPodAdmin() { return currentUser?.role === 'Pod Admin'; }

export async function renderLeaderboard(container) {
    showLoader(container);

    // AE users only see the AE leaderboard, SDR users only see SDR
    if (currentUser?.role === 'AE') currentTab = 'ae';
    else if (isSDR) currentTab = 'sdr';

    const isPodAdmin = _isPodAdmin();
    const globalView = _getLbGlobalView();

    // Fetch data for current range + tab (pass globalView for Pod Admin scoping)
    const data = currentTab === 'ae'
        ? await fetchAELeaderboard(currentRange, globalView)
        : await fetchLeaderboard(currentRange, globalView);

    // Current user ID for highlighting
    const myId = currentUser?.sub || currentUser?.id || null;

    const rangeLabel = currentRange === 7 ? '7 Days' : currentRange === 30 ? '30 Days' : currentRange === 90 ? '90 Days' : 'All Time';
    const showTabs = isAdmin; // Only admins see both tabs

    // ── Mixpanel: Leaderboard Viewed
    mp.track('Leaderboard Viewed', {
        period:      rangeLabel,
        tab:         currentTab,
        viewer_role: currentUser?.role || '',
        global_view: globalView,
    });

    // Toggle pill — Pod Admin only
    const togglePill = isPodAdmin ? `
        <div id="lb-scope-toggle" style="display:flex;align-items:center;gap:0;border-radius:20px;overflow:hidden;border:1.5px solid #4f46e5;background:var(--surface-color);user-select:none;" role="group" aria-label="Leaderboard scope">
            <button id="lb-toggle-pod"
                style="padding:5px 14px;font-size:0.78rem;font-weight:600;border:none;cursor:pointer;transition:all 0.15s;background:${!globalView ? '#4f46e5' : 'transparent'};color:${!globalView ? '#fff' : 'var(--text-muted)'};border-radius:0;"
                title="Show only your pod's SDRs">🔒 My Pod</button>
            <button id="lb-toggle-global"
                style="padding:5px 14px;font-size:0.78rem;font-weight:600;border:none;cursor:pointer;transition:all 0.15s;background:${globalView ? '#4f46e5' : 'transparent'};color:${globalView ? '#fff' : 'var(--text-muted)'};border-radius:0;"
                title="Show all SDRs">🌐 Global</button>
        </div>` : '';

    container.innerHTML = `
        <div class="fade-in">
            <!-- ── Header + Controls ─────────────────────────────────── -->
            <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:28px;">
                <div>
                    <h1 style="margin:0;font-size:1.3rem;font-weight:700;color:#18181b;">🏆 Leaderboard</h1>
                    <p style="color:#71717a;font-size:0.82rem;margin:4px 0 0;">${currentTab === 'ae' ? 'AE' : 'SDR'} performance · Ranked by meetings booked · <strong>${rangeLabel}</strong>${isPodAdmin && !globalView ? ' · <span style="color:#4f46e5;font-weight:600;">My Pod</span>' : ''}</p>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
                    ${togglePill}
                    ${showTabs ? `
                    <div style="display:flex;gap:6px;">
                        <button id="lb-tab-sdr" style="padding:6px 18px;border-radius:8px;border:1px solid ${currentTab === 'sdr' ? '#2563eb' : '#e4e4e7'};background:${currentTab === 'sdr' ? '#eff6ff' : '#fff'};font-size:0.8rem;font-weight:700;color:${currentTab === 'sdr' ? '#2563eb' : '#71717a'};cursor:pointer;">SDRs</button>
                        <button id="lb-tab-ae" style="padding:6px 18px;border-radius:8px;border:1px solid ${currentTab === 'ae' ? '#7c3aed' : '#e4e4e7'};background:${currentTab === 'ae' ? '#f5f3ff' : '#fff'};font-size:0.8rem;font-weight:700;color:${currentTab === 'ae' ? '#7c3aed' : '#71717a'};cursor:pointer;">AEs</button>
                    </div>` : ''}
                    <!-- Date Range Presets -->
                    <div style="display:flex;align-items:center;gap:6px;" id="lb-presets">
                    <button class="lb-preset${currentRange === 7 ? ' active' : ''}" data-range="7" style="padding:6px 14px;border-radius:8px;border:1px solid ${currentRange === 7 ? '#2563eb' : '#e4e4e7'};background:${currentRange === 7 ? '#eff6ff' : '#fff'};font-size:0.78rem;font-weight:600;color:${currentRange === 7 ? '#2563eb' : '#71717a'};cursor:pointer;transition:all 0.15s;">7 Days</button>
                    <button class="lb-preset${currentRange === 30 ? ' active' : ''}" data-range="30" style="padding:6px 14px;border-radius:8px;border:1px solid ${currentRange === 30 ? '#2563eb' : '#e4e4e7'};background:${currentRange === 30 ? '#eff6ff' : '#fff'};font-size:0.78rem;font-weight:600;color:${currentRange === 30 ? '#2563eb' : '#71717a'};cursor:pointer;transition:all 0.15s;">30 Days</button>
                    <button class="lb-preset${currentRange === 90 ? ' active' : ''}" data-range="90" style="padding:6px 14px;border-radius:8px;border:1px solid ${currentRange === 90 ? '#2563eb' : '#e4e4e7'};background:${currentRange === 90 ? '#eff6ff' : '#fff'};font-size:0.78rem;font-weight:600;color:${currentRange === 90 ? '#2563eb' : '#71717a'};cursor:pointer;transition:all 0.15s;">90 Days</button>
                    <button class="lb-preset${currentRange === 0 ? ' active' : ''}" data-range="0" style="padding:6px 14px;border-radius:8px;border:1px solid ${currentRange === 0 ? '#2563eb' : '#e4e4e7'};background:${currentRange === 0 ? '#eff6ff' : '#fff'};font-size:0.78rem;font-weight:600;color:${currentRange === 0 ? '#2563eb' : '#71717a'};cursor:pointer;transition:all 0.15s;">All Time</button>
                    </div>
                </div>
            </div>
            ${data.length === 0 ? `
            <div style="padding:60px;text-align:center;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:12px;">📊</div>
                <p style="font-size:0.95rem;">${isPodAdmin && !globalView ? `No ${currentTab === 'ae' ? 'AEs' : 'SDRs'} in your pod yet. Switch to Global to see all.` : `No ${currentTab === 'ae' ? 'AEs' : 'SDRs'} found. Add ${currentTab === 'ae' ? 'AEs' : 'SDRs'} to start tracking performance.`}</p>
            </div>` : `

            <!-- Top 3 Cards -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-bottom:32px;">
                ${data.slice(0, 3).map((sdr, i) => {
                    const colors = [
                        { bg: '#fefce8', border: '#fef08a', accent: '#ca8a04', rank: '#854d0e', rankBg: '#fef08a' },
                        { bg: '#f8fafc', border: '#e2e8f0', accent: '#64748b', rank: '#475569', rankBg: '#e2e8f0' },
                        { bg: '#fff7ed', border: '#fed7aa', accent: '#c2410c', rank: '#9a3412', rankBg: '#ffedd5' },
                    ];
                    const c = colors[i];
                    const isMe = myId && sdr.id === myId;
                    return `
                    <div style="background:${c.bg};border:${isMe ? '2px' : '1px'} solid ${isMe ? '#2563eb' : c.border};border-radius:16px;padding:28px 24px;position:relative;${isMe ? 'box-shadow:0 0 0 3px rgba(37,99,235,0.15);' : ''}">
                        ${isMe ? '<div style="position:absolute;top:10px;right:14px;background:#2563eb;color:#fff;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:0.04em;">You</div>' : ''}
                        <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
                            <div style="width:40px;height:40px;border-radius:50%;background:${c.rankBg};border:2px solid ${c.border};display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800;color:${c.rank};">${i + 1}</div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:700;font-size:1.05rem;color:var(--text-main);${(!isSDR || currentUser?.sub === sdr.id) ? 'cursor:pointer;text-decoration:underline dotted;' : 'cursor:default;'}" ${(!isSDR || currentUser?.sub === sdr.id) ? `class="sdr-perf-link" data-sdr-id="${sdr.id}"` : `title="You can only view your own performance"`}>${sdr.name}</div>
                                <div style="font-size:0.8rem;color:var(--text-muted);">${sdr.pod_name || '—'}</div>
                            </div>
                        </div>
                        <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px;">
                            <span style="font-size:2.2rem;font-weight:800;color:${c.accent};line-height:1;">${sdr.meetings_scheduled}</span>
                            <span style="font-size:0.78rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.03em;">Meetings</span>
                        </div>
                        <div style="display:flex;gap:20px;margin-top:16px;padding-top:14px;border-top:1px solid ${c.border};">
                            <div><div style="font-weight:700;font-size:0.95rem;color:var(--text-main);">${sdr.calls_today}</div><div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;">Today</div></div>
                            <div><div style="font-weight:700;font-size:0.95rem;color:var(--text-main);">${sdr.total_calls}</div><div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;">Total Calls</div></div>
                            <div><div style="font-weight:700;font-size:0.95rem;color:var(--text-main);">${sdr.conversion_rate}%</div><div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;">Conv. Rate</div></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>

            <!-- Full Table -->
            <div class="table-container" style="background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.06);overflow:hidden;">
                <table class="data-table" style="margin:0;">
                    <thead>
                        <tr>
                            <th style="width:50px;text-align:center;">Rank</th>
                            <th>SDR</th>
                            <th>POD</th>
                            <th style="text-align:center;">Calls Today</th>
                            <th style="text-align:center;">Total Calls</th>
                            <th style="text-align:center;">Meetings</th>
                            <th style="text-align:center;">Disqualified</th>
                            <th style="text-align:center;">Leads</th>
                            <th style="text-align:center;">Conv. Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map((sdr, i) => {
                            const isMe = myId && sdr.id === myId;
                            return `
                            <tr style="${isMe ? 'background:linear-gradient(90deg,#eff6ff,#dbeafe);border-left:3px solid #2563eb;' : i % 2 === 1 ? 'background:#fafbfc;' : ''}">
                                <td style="text-align:center;">
                                    <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;font-size:0.82rem;font-weight:700;${
                                        i === 0 ? 'background:#fef08a;color:#854d0e;' :
                                        i === 1 ? 'background:#e2e8f0;color:#475569;' :
                                        i === 2 ? 'background:#ffedd5;color:#9a3412;' :
                                        'background:transparent;color:var(--text-muted);'
                                    }">${sdr.rank || i + 1}</span>
                                </td>
                                <td>
                                    <div style="display:flex;align-items:center;gap:8px;">
                                        <div>
                                            <div style="font-weight:600;font-size:0.9rem;${(!isSDR || currentUser?.sub === sdr.id) ? 'cursor:pointer;color:var(--primary-color);' : 'cursor:default;color:var(--text-main);'}" ${(!isSDR || currentUser?.sub === sdr.id) ? `class="sdr-perf-link" data-sdr-id="${sdr.id}"` : `title="You can only view your own performance"`}>${sdr.name}</div>
                                            <div style="font-size:0.78rem;color:var(--text-muted);">${sdr.email}</div>
                                        </div>
                                        ${isMe ? '<span style="background:#2563eb;color:#fff;font-size:0.6rem;font-weight:700;padding:2px 6px;border-radius:4px;text-transform:uppercase;">You</span>' : ''}
                                    </div>
                                </td>
                                <td><span style="font-size:0.82rem;color:var(--text-muted);">${sdr.pod_name || '—'}</span></td>
                                <td style="text-align:center;font-weight:600;">${sdr.calls_today}</td>
                                <td style="text-align:center;">${sdr.total_calls}</td>
                                <td style="text-align:center;font-weight:700;color:var(--status-won);">${sdr.meetings_scheduled}</td>
                                <td style="text-align:center;color:#ef4444;font-weight:600;">${sdr.disqualified || 0}</td>
                                <td style="text-align:center;">${sdr.total_leads}</td>
                                <td style="text-align:center;">
                                    <span style="background:${sdr.conversion_rate >= 20 ? 'var(--status-won)' : sdr.conversion_rate >= 10 ? '#f59e0b' : 'var(--text-muted)'};color:white;padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:600;">
                                        ${sdr.conversion_rate}%
                                    </span>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`}
        </div>
    `;

    // ── Wire preset buttons ─────────────────────────────────────────────────
    document.querySelectorAll('#lb-presets .lb-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            currentRange = parseInt(btn.dataset.range);
            renderLeaderboard(container);
        });
    });

    // ── Wire SDR/AE tab buttons ─────────────────────────────────────────────
    const tabSdr = document.getElementById('lb-tab-sdr');
    const tabAe  = document.getElementById('lb-tab-ae');
    if (tabSdr) tabSdr.addEventListener('click', () => { currentTab = 'sdr'; renderLeaderboard(container); });
    if (tabAe)  tabAe.addEventListener('click',  () => { currentTab = 'ae';  renderLeaderboard(container); });

    // ── Wire Pod Admin scope toggle ─────────────────────────────────────────
    const lbTogglePod = document.getElementById('lb-toggle-pod');
    const lbToggleGlobal = document.getElementById('lb-toggle-global');
    if (lbTogglePod) lbTogglePod.addEventListener('click', () => { if (_getLbGlobalView()) { _setLbGlobalView(false); renderLeaderboard(container); } });
    if (lbToggleGlobal) lbToggleGlobal.addEventListener('click', () => { if (!_getLbGlobalView()) { _setLbGlobalView(true); renderLeaderboard(container); } });

    // ── Make SDR/AE names clickable → navigate to performance dashboard ─────
    container.querySelectorAll('.sdr-perf-link').forEach(link => {
        link.addEventListener('click', () => {
            const sdrId = link.dataset.sdrId;
            if (sdrId && window._loadView) window._loadView('sdr-performance', sdrId);
        });
    });
}
