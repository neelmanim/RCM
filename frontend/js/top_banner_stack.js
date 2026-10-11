// ── top_banner_stack.js — Shared sticky top-banner stacking ────────────────
//
// RCA 2026-08-19 (Microsoft Clarity audit: 44% of sessions had dead clicks):
// app.js has three full-width `position:fixed;top:0` banners (View-As,
// "Force Clear" stuck-call, outcome-logging nag) that can each appear
// independently. Two of them never compensated with body padding at all,
// so they sat directly over the topbar's real controls (search, sync,
// notifications) with no way to click through — a textbook dead click.
// Hardcoding each to top:0 also meant that if more than one ever showed at
// once, they'd silently overlap each other, not just the topbar.
//
// One shared stacking helper instead of three near-identical "prepend and
// guess a paddingTop" implementations — root-caused once, not patched
// per banner. Every banner using this gets `.crm-top-banner` so the others
// can find it and stack below it.

/**
 * Position `el` below whatever other `.crm-top-banner` elements already
 * exist, append it to <body>, and grow body's top padding to match the
 * new total stacked height.
 * @param {HTMLElement} el - not yet in the document; must not already have
 *   `position`/`top`/`left`/`right` set — this function owns those.
 */
export function stackTopBanner(el) {
    const existing = Array.from(document.querySelectorAll('.crm-top-banner')).filter(b => b !== el);
    const offset = existing.reduce((sum, b) => sum + b.offsetHeight, 0);
    el.classList.add('crm-top-banner');
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.right = '0';
    el.style.top = `${offset}px`;
    document.body.appendChild(el);
    document.body.style.paddingTop = `${offset + el.offsetHeight}px`;
    return offset;
}

/**
 * Remove `el` (if present) and re-stack whatever `.crm-top-banner`s remain,
 * closing the gap it leaves and shrinking body's padding to match.
 * @param {HTMLElement|null|undefined} el
 */
export function unstackTopBanner(el) {
    el?.remove();
    const remaining = Array.from(document.querySelectorAll('.crm-top-banner'));
    let offset = 0;
    remaining.forEach(b => { b.style.top = `${offset}px`; offset += b.offsetHeight; });
    document.body.style.paddingTop = `${offset}px`;
    return offset;
}
