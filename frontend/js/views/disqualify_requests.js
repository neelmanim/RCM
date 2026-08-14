// ── views/disqualify_requests.js — Disqualify Requests (checker step, Pod Admin+) ──
// Maker step (SDR/AE submitting a request) lives in lead_list.js's company-group
// header + modals.js's openDisqualifyModal. This view is the approve/reject side.
import { fetchDisqualifyRequests, approveDisqualifyRequest, rejectDisqualifyRequest } from '../api.js';
import { showToast, showLoader, fmtDate } from '../utils.js';

export async function renderDisqualifyRequests(container) {
    showLoader(container);

    const { requests } = await fetchDisqualifyRequests('pending');

    container.innerHTML = `
        <div class="fade-in">
            <div class="page-header">
                <div>
                    <h1 class="page-title">🚫 Disqualify Requests</h1>
                    <p class="page-subtitle">Review account disqualify requests submitted by your team before any leads are disqualified.</p>
                </div>
            </div>

            <section class="info-card fade-in">
                ${requests.length === 0
                    ? `<p style="text-align:center;color:var(--text-muted);padding:40px;">No pending requests.</p>`
                    : `<div class="table-container">
                        <table class="data-table">
                            <thead><tr>
                                <th>Company</th><th>Leads</th><th>Reason</th><th>Requested By</th><th>Requested</th><th>Action</th>
                            </tr></thead>
                            <tbody>
                                ${requests.map(r => `
                                    <tr data-request-id="${r.id}">
                                        <td>${r.company}</td>
                                        <td>${r.lead_ids.length}</td>
                                        <td style="max-width:280px;">${r.reason}</td>
                                        <td>${r.requested_by_name || '—'}</td>
                                        <td>${fmtDate(r.requested_at)}</td>
                                        <td style="white-space:nowrap;">
                                            <button class="btn approve-request-btn" data-id="${r.id}"
                                                style="background:#16a34a;color:#fff;padding:6px 14px;border-radius:6px;font-weight:600;font-size:0.8rem;margin-right:6px;">
                                                ✅ Approve
                                            </button>
                                            <button class="btn reject-request-btn" data-id="${r.id}"
                                                style="background:#fff;color:#dc2626;border:1px solid #fecaca;padding:6px 14px;border-radius:6px;font-weight:600;font-size:0.8rem;">
                                                ✕ Reject
                                            </button>
                                        </td>
                                    </tr>
                                    <tr class="reject-reason-row" data-reject-row-for="${r.id}" style="display:none;">
                                        <td colspan="6" style="background:#fef2f2;padding:12px 16px;">
                                            <textarea class="reject-reason-input" data-id="${r.id}" rows="2" placeholder="Reason for rejecting (optional)…"
                                                style="width:100%;max-width:480px;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;font-family:inherit;font-size:0.85rem;resize:vertical;"></textarea>
                                            <div style="margin-top:8px;">
                                                <button class="btn confirm-reject-btn" data-id="${r.id}"
                                                    style="background:#dc2626;color:#fff;padding:6px 14px;border-radius:6px;font-weight:600;font-size:0.8rem;margin-right:6px;">
                                                    Confirm Reject
                                                </button>
                                                <button class="btn btn-outline cancel-reject-btn" data-id="${r.id}"
                                                    style="padding:6px 14px;border-radius:6px;font-size:0.8rem;">
                                                    Cancel
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>`
                }
            </section>
        </div>
    `;

    _bindHandlers(container);
}

function _bindHandlers(container) {
    container.querySelectorAll('.approve-request-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'Approving…';
            try {
                const result = await approveDisqualifyRequest(btn.dataset.id);
                showToast(result.message || 'Request approved', 'success', 4000);
                await renderDisqualifyRequests(container);
            } catch (err) {
                showToast(err.message || 'Failed to approve request', 'error', 5000);
                btn.disabled = false;
                btn.textContent = '✅ Approve';
            }
        });
    });

    container.querySelectorAll('.reject-request-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = container.querySelector(`.reject-reason-row[data-reject-row-for="${btn.dataset.id}"]`);
            if (row) row.style.display = 'table-row';
        });
    });

    container.querySelectorAll('.cancel-reject-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = container.querySelector(`.reject-reason-row[data-reject-row-for="${btn.dataset.id}"]`);
            if (row) row.style.display = 'none';
        });
    });

    container.querySelectorAll('.confirm-reject-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const reasonEl = container.querySelector(`.reject-reason-input[data-id="${btn.dataset.id}"]`);
            btn.disabled = true;
            btn.textContent = 'Rejecting…';
            try {
                await rejectDisqualifyRequest(btn.dataset.id, reasonEl?.value.trim() || '');
                showToast('Request rejected', 'success', 4000);
                await renderDisqualifyRequests(container);
            } catch (err) {
                showToast(err.message || 'Failed to reject request', 'error', 5000);
                btn.disabled = false;
                btn.textContent = 'Confirm Reject';
            }
        });
    });
}
