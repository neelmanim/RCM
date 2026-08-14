/**
 * Tests for js/views/lead_helpers.js — renderSourceBadge.
 *
 * auth.js has top-level side effects (redirects when no token) — mocked out
 * here the same way, in spirit, as auth.test.js's own comment describes.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/auth.js', () => ({
    isSuperAdmin: false,
    isPodAdmin: false,
    userPodId: null,
}));

const { renderSourceBadge } = await import('../js/views/lead_helpers.js');

describe('renderSourceBadge', () => {
    it('labels the Klenty nightly call sync instead of leaking the raw source string', () => {
        const html = renderSourceBadge({ lead_source: 'klenty_sync:2026-07-30' });
        expect(html).toContain('Klenty');
        expect(html).not.toContain('klenty_sync:2026-07-30');
    });

    it('labels an anonymous manual-dial lead instead of defaulting to Salesforce', () => {
        const html = renderSourceBadge({ lead_source: 'Manual Dial' });
        expect(html).toContain('Manual Dial');
        expect(html).not.toContain('Salesforce');
    });

    it('shows Salesforce only for an actual Salesforce-sourced lead', () => {
        const html = renderSourceBadge({ lead_source: 'salesforce' });
        expect(html).toContain('Salesforce');
    });

    it('does NOT default an empty/unset source to Salesforce (v10.9.6 fixed this at the DB layer; this is the same bug reintroduced at render time)', () => {
        const html = renderSourceBadge({ lead_source: '' });
        expect(html).not.toContain('Salesforce');
        expect(html).toContain('Unknown');
    });

    it('does NOT default a missing lead_source field to Salesforce', () => {
        const html = renderSourceBadge({});
        expect(html).not.toContain('Salesforce');
    });

    it('labels an Aircall-webhook auto-created lead instead of defaulting to Salesforce', () => {
        const html = renderSourceBadge({ lead_source: 'aircall_webhook:2026-08-14' });
        expect(html).toContain('Aircall');
        expect(html).not.toContain('Salesforce');
    });

    it('labels an Aircall historical-sync auto-created lead instead of defaulting to Salesforce', () => {
        const html = renderSourceBadge({ lead_source: 'aircall_sync:2026-08-14' });
        expect(html).toContain('Aircall');
        expect(html).not.toContain('Salesforce');
    });

    it('shows an unrecognized tag verbatim rather than guessing it is Salesforce', () => {
        const html = renderSourceBadge({ lead_source: 'synthetic' });
        expect(html).toContain('synthetic');
        expect(html).not.toContain('Salesforce');
    });
});
