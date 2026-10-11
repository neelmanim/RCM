import '@testing-library/jest-dom';

// jsdom has no ResizeObserver — needed by @xyflow/react (Sales Journey builder)
// for canvas auto-sizing. No-op stub is safe globally: nothing else uses it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has no scrollIntoView — GuidedTour.jsx (shared by 14 tour instances
// across the app) started calling it 2026-09-28 to fix a below-the-fold
// target bug; every test that mounts a page with an unseen tour started
// throwing "el.scrollIntoView is not a function" (172 tests, 22 files) until
// this no-op landed.
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
