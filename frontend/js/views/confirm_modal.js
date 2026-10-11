// ── views/confirm_modal.js — Reusable confirm dialog for the classic frontend ──
// Replaces the browser's native confirm()/alert() with the app's own styled
// modal (RCA 2026-08-25: admin.js's delete/revoke/role-change actions were
// still using window.confirm() — a "richer message" fix in v11.5.19 only
// changed the text inside that same native dialog, never the dialog itself).
// Built dynamically (not static HTML like modals.js's other modals) so no
// index.html markup is needed — reuses the existing .modal/.modal-content/
// .btn-danger CSS classes so it looks identical to every other modal in the app.

/**
 * @param {string} message - shown in the modal body (supports \n for line breaks)
 * @param {{title?: string, confirmLabel?: string, danger?: boolean}} [opts]
 * @returns {Promise<boolean>} resolves true if confirmed, false if cancelled/dismissed
 */
export function confirmModal(message, opts = {}) {
    const { title = 'Please confirm', confirmLabel = 'Confirm', danger = false } = opts;
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal active';
        overlay.style.zIndex = '100050'; // above the outcome modal (100000) if ever stacked
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:420px;">
                <div class="modal-header">
                    <h2>${title}</h2>
                    <span class="close-modal">&times;</span>
                </div>
                <div class="modal-body" style="white-space:pre-line;">${message}</div>
                <div class="modal-actions" style="padding:0 24px 24px;">
                    <button type="button" class="btn btn-outline" data-action="cancel">Cancel</button>
                    <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${confirmLabel}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const settle = (result) => {
            overlay.remove();
            resolve(result);
        };
        overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => settle(true));
        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => settle(false));
        overlay.querySelector('.close-modal').addEventListener('click', () => settle(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) settle(false); });
        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); settle(false); }
        });
    });
}
