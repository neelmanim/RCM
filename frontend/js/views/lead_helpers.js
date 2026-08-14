// ── views/lead_helpers.js — Shared helper functions for all leads modules ─────
import { isSuperAdmin, isPodAdmin, userPodId } from '../auth.js';

/** Check if the current user can modify a given lead (based on pod ownership). */
export function canModifyLead(lead) {
    if (isSuperAdmin) return true;       // Super Admin can modify anything
    if (!isPodAdmin) return true;        // SDRs are scoped by backend already
    // Pod Admin: can modify unassigned leads or leads assigned to their pod
    if (!lead.lead_pod_ids || lead.lead_pod_ids.length === 0) return true;  // unassigned
    return userPodId && lead.lead_pod_ids.includes(userPodId);
}

/** Parse lead_source into a styled badge. */
export function renderSourceBadge(lead, compact = true) {
    const src = lead.lead_source || '';

    // Genuinely unset — do NOT default to Salesforce (that was the exact
    // bug fixed in v10.9.6 at the DB-column-default layer; this frontend
    // fallback silently reintroduced the same mislabeling independently).
    if (!src) {
        return `<span class="badge" style="background:#F1F5F9;color:#94A3B8;font-size:${compact ? '0.68' : '0.72'}rem;border:1px solid #E2E8F0;">— Unknown</span>`;
    }

    // New dynamic upload: "upload:filename.csv:2026-03-25T10:30:00+00:00"
    if (src.startsWith('upload:')) {
        const parts = src.split(':');
        const fname = parts[1] || 'file';
        const ts = parts.slice(2).join(':'); // rejoin timestamp (contains colons)
        const truncName = fname.length > 20 ? fname.slice(0, 18) + '...' : fname;
        const fmtTs = ts ? new Date(ts).toLocaleString(undefined, { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
        if (compact) {
            return `<span class="badge" style="background:#EDE9FE;color:#4F46E5;font-size:0.68rem;display:inline-flex;align-items:center;gap:4px;border:1px solid #C7D2FE;" title="${fname}">
                📄 <span style="font-weight:700;">${truncName}</span>${fmtTs ? ` <span style="color:#94A3B8;font-size:0.62rem;">· ${fmtTs}</span>` : ''}
            </span>`;
        }
        return `<span class="badge" style="background:#EDE9FE;color:#4F46E5;font-size:0.72rem;border:1px solid #C7D2FE;" title="${fname}">📄 ${truncName}${fmtTs ? ' · ' + fmtTs : ''}</span>`;
    }

    // Google Sheets: "gsheet:SheetName:2026-03-25T11:00:00+00:00"
    if (src.startsWith('gsheet:')) {
        const parts = src.split(':');
        const sheetName = parts[1] || 'Sheet';
        const ts = parts.slice(2).join(':');
        const truncName = sheetName.length > 20 ? sheetName.slice(0, 18) + '...' : sheetName;
        const fmtTs = ts ? new Date(ts).toLocaleString(undefined, { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
        if (compact) {
            return `<span class="badge" style="background:#ECFDF5;color:#059669;font-size:0.68rem;display:inline-flex;align-items:center;gap:4px;border:1px solid #A7F3D0;" title="${sheetName}">
                📊 <span style="font-weight:700;">${truncName}</span>${fmtTs ? ` <span style="color:#94A3B8;font-size:0.62rem;">· ${fmtTs}</span>` : ''}
            </span>`;
        }
        return `<span class="badge" style="background:#ECFDF5;color:#059669;font-size:0.72rem;border:1px solid #A7F3D0;" title="${sheetName}">📊 ${truncName}${fmtTs ? ' · ' + fmtTs : ''}</span>`;
    }

    // Manual lead
    if (src === 'manual') {
        return `<span class="badge" style="background:#FFF7ED;color:#C2410C;font-size:${compact ? '0.68' : '0.72'}rem;border:1px solid #FED7AA;">✏️ Manual</span>`;
    }

    // Klenty nightly call sync: "klenty_sync:2026-07-30"
    if (src.startsWith('klenty_sync')) {
        return `<span class="badge" style="background:#E0F2FE;color:#0369A1;font-size:${compact ? '0.68' : '0.72'}rem;border:1px solid #BAE6FD;">📲 Klenty</span>`;
    }

    // Aircall auto-created lead — webhook (real-time) or historical sync
    // (dialer_service.py: "aircall_webhook:<date>" / "aircall_sync:<date>").
    // Previously unhandled here, so it fell through to the Salesforce
    // default below despite never having come from Salesforce.
    if (src.startsWith('aircall_webhook') || src.startsWith('aircall_sync')) {
        return `<span class="badge" style="background:#EFF6FF;color:#1D4ED8;font-size:${compact ? '0.68' : '0.72'}rem;border:1px solid #BFDBFE;">📞 Aircall</span>`;
    }

    // Anonymous lead auto-created for an outbound manual dial with no matching lead
    if (src === 'Manual Dial') {
        return `<span class="badge" style="background:#F1F5F9;color:#475569;font-size:${compact ? '0.68' : '0.72'}rem;border:1px solid #E2E8F0;">📞 Manual Dial</span>`;
    }

    // Legacy "uploaded" (pre-enhancement)
    if (src === 'uploaded') {
        return `<span class="badge" style="background:#F3E8FF;color:#7C3AED;font-size:${compact ? '0.68' : '0.72'}rem;">📄 Uploaded</span>`;
    }

    // Salesforce — exact match only, never a fallback default.
    if (src === 'salesforce') {
        return `<span class="badge" style="font-size:${compact ? '0.68' : '0.72'}rem;">☁️ Salesforce</span>`;
    }

    // Unrecognized tag (e.g. "synthetic" sandbox data, or a future source
    // this hasn't been taught yet) — show it verbatim rather than guessing.
    return `<span class="badge" style="background:#F1F5F9;color:#475569;font-size:${compact ? '0.68' : '0.72'}rem;border:1px solid #E2E8F0;">${src}</span>`;
}

/** Format a note/activity date as a relative time string. */
export function formatNoteDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now - d;
        const diffH = diffMs / (1000 * 60 * 60);
        if (diffH < 1) return `${Math.max(1, Math.round(diffMs / 60000))}m ago`;
        if (diffH < 24) return `${Math.round(diffH)}h ago`;
        const diffD = Math.round(diffH / 24);
        if (diffD < 7) return `${diffD}d ago`;
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch { return ''; }
}
