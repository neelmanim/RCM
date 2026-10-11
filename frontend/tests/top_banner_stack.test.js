/**
 * Tests for js/top_banner_stack.js — sticky top-banner stacking.
 *
 * RCA 2026-08-19: two of app.js's three sticky banners never compensated
 * with body padding at all, sitting directly over the topbar's real
 * controls (a Clarity-confirmed dead-click cause), and all three were
 * hardcoded to top:0 — meaning if more than one ever showed at once
 * they'd silently overlap each other too. This covers the actual stacking
 * math, not just "does a banner appear."
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { stackTopBanner, unstackTopBanner } from '../js/top_banner_stack.js';

function makeBanner(id, height) {
    const el = document.createElement('div');
    el.id = id;
    // jsdom doesn't do real layout, so offsetHeight is stubbed per-element.
    Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
    return el;
}

describe('stackTopBanner / unstackTopBanner', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.body.style.paddingTop = '';
    });

    it('positions the first banner at top:0 and pads body to its height', () => {
        const banner = makeBanner('b1', 40);
        stackTopBanner(banner);

        expect(banner.style.top).toBe('0px');
        expect(document.body.style.paddingTop).toBe('40px');
        expect(document.body.contains(banner)).toBe(true);
    });

    it('stacks a second banner below the first instead of overlapping it', () => {
        const first = makeBanner('b1', 40);
        stackTopBanner(first);
        const second = makeBanner('b2', 50);
        stackTopBanner(second);

        expect(first.style.top).toBe('0px');
        expect(second.style.top).toBe('40px');
        expect(document.body.style.paddingTop).toBe('90px'); // 40 + 50
    });

    it('closes the gap and shrinks padding when the top banner is removed', () => {
        const first = makeBanner('b1', 40);
        stackTopBanner(first);
        const second = makeBanner('b2', 50);
        stackTopBanner(second);

        unstackTopBanner(first);

        expect(document.body.contains(first)).toBe(false);
        expect(second.style.top).toBe('0px'); // re-flowed up to fill the gap
        expect(document.body.style.paddingTop).toBe('50px');
    });

    it('pads back to 0 once every banner is gone', () => {
        const only = makeBanner('b1', 40);
        stackTopBanner(only);
        unstackTopBanner(only);

        expect(document.body.style.paddingTop).toBe('0px');
    });

    it('is a no-op-safe on a null/undefined element (banner never shown)', () => {
        expect(() => unstackTopBanner(null)).not.toThrow();
        expect(() => unstackTopBanner(undefined)).not.toThrow();
    });
});
