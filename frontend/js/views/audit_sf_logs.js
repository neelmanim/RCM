// ── views/audit_sf_logs.js — SF Log row renderer + detail modal ───────────────
import { fetchSfLogDetail } from '../api.js';
import { ensureUTC } from '../utils.js';

/**
 * Render a single SF log table row.
 */
export function renderSfLogRow(log) {
    const ts = log.timestamp ? new Date(ensureUTC(log.timestamp)).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const statusIcon = log.status === 'success' ? '🟢' : '🔴';
    const opColor = { create: '#3b82f6', update: '#f59e0b', upsert: '#8b5cf6', fetch: '#06b6d4', query: '#6b7280' }[log.operation_type] || '#6b7280';
    const name = [log.first_name, log.last_name].filter(Boolean).join(' ') || '—';
    return `<tr>
        <td style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ts}</td>
        <td><span style="background:${opColor};color:white;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;text-transform:uppercase;">${log.operation_type}</span></td>
        <td style="text-align:center;">${statusIcon}</td>
        <td style="font-size:0.82rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${log.email || '—'}</td>
        <td style="font-family:monospace;font-size:0.7rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${log.record_identifier || ''}">${log.record_identifier || '—'}</td>
        <td><button class="btn btn-outline btn-sm sf-log-detail-btn" data-log-id="${log.id}" style="padding:3px 8px;font-size:0.72rem;">🔍</button></td>
    </tr>`;
}

/**
 * Show SF log detail modal.
 */
export async function showSfLogDetail(logId) {
    let overlay = document.getElementById('sf-log-detail-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sf-log-detail-overlay';
        overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;';
        const panel = document.createElement('div');
        panel.id = 'sf-log-detail-panel';
        panel.style.cssText = 'background:var(--bg-primary);border-radius:16px;width:580px;max-width:92vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:28px;position:relative;';
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
    }
    const panel = document.getElementById('sf-log-detail-panel');
    overlay.style.display = 'flex';
    panel.innerHTML = '<div style="padding:20px;">' + Array(4).fill('').map(() => '<div style="display:flex;gap:12px;padding:8px 0;"><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;width:80px;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div><div style="background:var(--skeleton-bg,#e5e7eb);border-radius:6px;flex:1;height:14px;animation:skeletonPulse 1.4s ease-in-out infinite;"></div></div>').join('') + '</div>';

    const log = await fetchSfLogDetail(logId);
    if (!log) { panel.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:48px;">Log not found.</p>`; return; }

    const ts = log.timestamp ? new Date(ensureUTC(log.timestamp)).toLocaleString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    const statusIcon = log.status === 'success' ? '🟢' : '🔴';
    const name = [log.first_name, log.last_name].filter(Boolean).join(' ') || '—';

    let fieldsHtml = '';
    if (log.fields_updated) {
        let fields = log.fields_updated;
        if (typeof fields === 'string') { try { fields = JSON.parse(fields); } catch { fields = [fields]; } }
        if (Array.isArray(fields) && fields.length) {
            fieldsHtml = `<div style="background:var(--bg-secondary);border-radius:8px;padding:12px;margin-bottom:12px;">
                <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Fields Updated</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">${fields.map(f => `<span style="background:var(--primary-color);color:white;padding:2px 8px;border-radius:4px;font-size:0.72rem;">${f}</span>`).join('')}</div>
            </div>`;
        }
    }

    panel.innerHTML = `
        <button id="sf-detail-close" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-muted);padding:4px 8px;border-radius:6px;">✕</button>
        <h3 style="margin:0 0 20px 0;font-size:1.1rem;">📋 Log Details</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Status</div>
                <div style="font-size:1rem;font-weight:700;margin-top:2px;">${statusIcon} ${log.status.toUpperCase()}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Timestamp</div>
                <div style="font-size:0.82rem;font-weight:500;margin-top:2px;">${ts}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Operation</div>
                <div style="font-size:0.9rem;font-weight:600;text-transform:capitalize;margin-top:2px;">${log.operation_type}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Object</div>
                <div style="font-size:0.9rem;font-weight:500;margin-top:2px;">${log.sf_object}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Source</div>
                <div style="font-size:0.82rem;font-weight:500;margin-top:2px;">${log.source_system || '—'}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;">
                <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);">Record ID</div>
                <div style="font-size:0.75rem;font-family:monospace;word-break:break-all;margin-top:2px;">${log.record_identifier || '—'}</div>
            </div>
        </div>
        <div style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;margin-bottom:12px;">
            <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);margin-bottom:2px;">Lead Info</div>
            <div style="font-size:0.85rem;"><b>${name}</b> ${log.email ? `· ${log.email}` : ''}</div>
        </div>
        ${fieldsHtml}
        ${log.error_message ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:12px;">
            <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:#ef4444;margin-bottom:4px;">Error Message</div>
            <pre style="font-size:0.78rem;color:#dc2626;white-space:pre-wrap;word-break:break-all;margin:0;font-family:monospace;">${log.error_message}</pre>
        </div>` : ''}
        ${log.request_payload ? `<div style="margin-bottom:12px;">
            <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);margin-bottom:4px;">Request Payload</div>
            <pre style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:12px;font-size:0.75rem;overflow-x:auto;max-height:180px;margin:0;white-space:pre-wrap;word-break:break-all;">${JSON.stringify(log.request_payload, null, 2)}</pre>
        </div>` : ''}
        ${log.response_payload ? `<div style="margin-bottom:12px;">
            <div style="font-size:0.68rem;text-transform:uppercase;font-weight:600;color:var(--text-muted);margin-bottom:4px;">Response Payload</div>
            <pre style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:12px;font-size:0.75rem;overflow-x:auto;max-height:180px;margin:0;white-space:pre-wrap;word-break:break-all;">${JSON.stringify(log.response_payload, null, 2)}</pre>
        </div>` : ''}`;

    document.getElementById('sf-detail-close')?.addEventListener('click', () => { overlay.style.display = 'none'; });
    const escHandler = (e) => { if (e.key === 'Escape') { overlay.style.display = 'none'; document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
}
