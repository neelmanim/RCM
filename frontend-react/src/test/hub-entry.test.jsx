import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHub } from '../hub-entry';

/**
 * The contract behind every React island. emailEntryRemount.test.jsx covers
 * it end-to-end through one real entry file; these cover the shared module
 * directly, including the case that shipped twice as a blank screen —
 * navigate() handed a container the shell has since replaced.
 */
describe('registerHub', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.TestHub;
    delete window.__CRM_API_BASE__;
    registerHub('TestHub', (props) => <div data-testid="pane">pane {props.label}</div>);
  });

  afterEach(() => {
    act(() => window.TestHub?.unmount());
  });

  /** What the shell does on every view render: a brand-new root node. */
  function freshRoot() {
    document.body.innerHTML = '<div id="view"><div id="root"></div></div>';
    return document.getElementById('root');
  }

  it('installs the four-part contract on window under the given name', () => {
    expect(typeof window.TestHub.mount).toBe('function');
    expect(typeof window.TestHub.navigate).toBe('function');
    expect(typeof window.TestHub.unmount).toBe('function');
    expect(window.TestHub.isMounted).toBe(false);
  });

  it('re-mounts into the new container when the shell replaced the old one', () => {
    const first = freshRoot();
    act(() => window.TestHub.mount(first, { label: 'A' }));
    expect(first.textContent).toContain('pane A');

    const second = freshRoot(); // detaches `first`
    expect(document.contains(first)).toBe(false);
    act(() => window.TestHub.navigate(second, { label: 'B' }));

    expect(second.textContent).toContain('pane B');
    // Exactly one live tree — not one visible and one orphaned.
    expect(document.querySelectorAll('[data-testid="pane"]').length).toBe(1);
  });

  it('re-mounts when handed a different container that is still attached', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const a = document.getElementById('a');
    const b = document.getElementById('b');
    act(() => window.TestHub.mount(a, { label: 'A' }));
    act(() => window.TestHub.navigate(b, { label: 'B' }));

    expect(b.textContent).toContain('pane B');
    expect(a.textContent).toBe('');
  });

  it('renders in place — no remount — when the same container is reused', () => {
    const el = freshRoot();
    act(() => window.TestHub.mount(el, { label: 'A' }));
    const node = el.querySelector('[data-testid="pane"]');

    act(() => window.TestHub.navigate(el, { label: 'B' }));

    // Same DOM node updated: navigate() exists precisely to avoid a remount
    // (and every API call it triggers) when only props changed.
    expect(el.querySelector('[data-testid="pane"]')).toBe(node);
    expect(el.textContent).toContain('pane B');
  });

  it('mounts via navigate() when nothing is mounted yet', () => {
    const el = freshRoot();
    act(() => window.TestHub.navigate(el, { label: 'A' }));
    expect(window.TestHub.isMounted).toBe(true);
    expect(el.textContent).toContain('pane A');
  });

  it('ignores a double mount and reports isMounted honestly', () => {
    const el = freshRoot();
    act(() => window.TestHub.mount(el, { label: 'A' }));
    act(() => window.TestHub.mount(el, { label: 'B' }));
    expect(el.textContent).toContain('pane A'); // second call was a no-op
    expect(window.TestHub.isMounted).toBe(true);

    act(() => window.TestHub.unmount());
    expect(window.TestHub.isMounted).toBe(false);
    act(() => window.TestHub.unmount()); // idempotent
    expect(window.TestHub.isMounted).toBe(false);
  });

  it('publishes apiBase for the shared axios client on mount and navigate', () => {
    const el = freshRoot();
    act(() => window.TestHub.mount(el, { label: 'A', apiBase: 'https://one.test' }));
    expect(window.__CRM_API_BASE__).toBe('https://one.test');

    act(() => window.TestHub.navigate(el, { label: 'B', apiBase: 'https://two.test' }));
    expect(window.__CRM_API_BASE__).toBe('https://two.test');
  });
});

/**
 * The 15 islands were 15 hand-copied versions of the above, and all 15 got
 * navigate() wrong the same way. A new one that calls createRoot itself would
 * quietly reintroduce that, so keep them routed through the shared module.
 *
 * nav-entry, messenger-widget-entry, and login-entry are exempt on purpose:
 * NavHub owns five separate roots (sidebar, topbar, modal portal, toast
 * portal, view-as-banner portal), the widget is a single always-on FAB, and
 * login-entry has no shell to hand it a container/props at all (frontend/
 * login.html is pre-auth, standalone, no router) — none of the three is a
 * view-swapped island.
 */
describe('*-entry.jsx all use the shared contract', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
  // hub-entry.jsx is the module itself, not an island.
  const EXEMPT = new Set(['hub-entry.jsx', 'nav-entry.jsx', 'messenger-widget-entry.jsx', 'login-entry.jsx']);

  const entries = readdirSync(SRC)
    .filter((f) => f.endsWith('-entry.jsx') && !EXEMPT.has(f));

  it('finds the island entry points', () => {
    // Guards the glob, not the count — a 16th island should not fail a test.
    expect(entries.length).toBeGreaterThanOrEqual(15);
  });

  it.each(entries)('%s calls registerHub and never createRoot', (file) => {
    const src = readFileSync(join(SRC, file), 'utf8');
    expect(src).toMatch(/registerHub\(/);
    expect(src).not.toMatch(/createRoot/);
  });
});
