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
