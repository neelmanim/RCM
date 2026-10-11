import { describe, it, expect, afterEach } from 'vitest';

// Regression test for a real bug: nav-entry.jsx imported flushSync from
// 'react-dom/client' (undefined there — it only exists on 'react-dom'),
// which threw "y.flushSync is not a function" the moment a View-As session
// mounted, aborting the rest of app.js's _doMount() and leaving the whole
// app stuck on skeleton loaders. ViewAsBanner.test.jsx alone couldn't catch
// this — it renders <ViewAsBanner/> directly, never through
// window.NavHub.mountViewAsBanner(), which is where the bad import lived.
describe('nav-entry / NavHub.mountViewAsBanner', () => {
  afterEach(() => {
    window.NavHub?.unmount?.();
    delete window.NavHub;
  });

  it('mounts sidebar/topbar and the View-As banner without throwing', async () => {
    await import('../nav-entry.jsx');

    const sidebarEl = document.createElement('div');
    const topbarEl = document.createElement('div');
    const bannerEl = document.createElement('div');
    document.body.append(sidebarEl, topbarEl, bannerEl);

    window.NavHub.mount(sidebarEl, topbarEl, { userName: 'Dev Kapoor', userRole: 'SDR' });

    expect(() => {
      window.NavHub.mountViewAsBanner(bannerEl, { userName: 'Dev Kapoor', userRole: 'SDR', onExit: () => {} });
    }).not.toThrow();

    expect(bannerEl.textContent).toContain('Dev Kapoor');
    expect(bannerEl.textContent).toContain('SDR');
  });
});
