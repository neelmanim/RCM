/**
 * Test for js/views/confirm_modal.js.
 *
 * RCA 2026-08-25: admin.js's delete/revoke/role-change actions used a native
 * browser confirm() — a "richer message" fix (v11.5.19) only ever changed the
 * text passed into that same confirm(), never the dialog itself. This is the
 * reusable modal that replaces it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { confirmModal } from '../js/views/confirm_modal.js';

afterEach(() => {
    document.querySelectorAll('.modal').forEach((el) => el.remove());
});

describe('confirmModal', () => {
    it('resolves true when the confirm button is clicked', async () => {
        const promise = confirmModal('Delete this user?', { confirmLabel: 'Delete', danger: true });
        const modal = document.querySelector('.modal.active');
        expect(modal).not.toBeNull();
        expect(modal.querySelector('.modal-body').textContent).toBe('Delete this user?');
        expect(modal.querySelector('[data-action="confirm"]').textContent).toBe('Delete');
        expect(modal.querySelector('[data-action="confirm"]').className).toContain('btn-danger');

        modal.querySelector('[data-action="confirm"]').click();
        expect(await promise).toBe(true);
        // Torn down after resolving — no stale modal left in the DOM.
        expect(document.querySelector('.modal')).toBeNull();
    });

    it('resolves false when the cancel button is clicked', async () => {
        const promise = confirmModal('Revoke access?');
        document.querySelector('[data-action="cancel"]').click();
        expect(await promise).toBe(false);
    });

    it('resolves false when the close (×) button is clicked', async () => {
        const promise = confirmModal('Change role?');
        document.querySelector('.close-modal').click();
        expect(await promise).toBe(false);
    });

    it('resolves false when clicking the overlay background', async () => {
        const promise = confirmModal('Change role?');
        document.querySelector('.modal.active').click(); // click on the overlay itself, not modal-content
        expect(await promise).toBe(false);
    });

    it('resolves false on Escape', async () => {
        const promise = confirmModal('Change role?');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(await promise).toBe(false);
    });

    it('does not resolve when clicking inside the modal content (not the overlay)', async () => {
        const promise = confirmModal('Change role?');
        document.querySelector('.modal-content').click();
        // Give any (incorrect) handler a chance to fire before asserting nothing happened.
        await new Promise((r) => setTimeout(r, 0));
        expect(document.querySelector('.modal')).not.toBeNull();
        document.querySelector('[data-action="cancel"]').click();
        await promise;
    });
});
