/**
 * hub-entry.jsx — the one mount/unmount contract every React island exposes
 * to the Vanilla JS shell (frontend/js/app.js).
 *
 *   window.<Name>.mount(container, props)
 *   window.<Name>.navigate(container, props)   // re-render in place
 *   window.<Name>.unmount()
 *   window.<Name>.isMounted
 *
 * This was 15 hand-copied versions of the same 45 lines, and all 15 accepted
 * navigate()'s `container` and then ignored it — re-rendering into whatever
 * node mount() first attached to. When the shell rebuilt that node the root
 * kept painting into a detached element: no error, just a screen that stayed
 * blank until a full reload. It shipped twice (Calendar 2026-08-05, the Email
 * tab in v12.2.2) and both times was patched in the *caller*, leaving the
 * defect for the next code path that rebuilds a container. navigate() below
 * checks the container it was handed, in the one place all 15 route through.
 */
import { createRoot } from 'react-dom/client';

/**
 * @param {string}   name   global to install, e.g. 'CalendarHub'
 * @param {function} render (props) => ReactElement — the island's tree,
 *                          including any ErrorBoundary wrapper it needs.
 */
export function registerHub(name, render) {
  let root = null;
  let node = null; // the element `root` is attached to; null when unmounted

  const hub = {
    mount(container, props = {}) {
      if (root) {
        console.warn(`[${name}] Already mounted — skipping double mount`);
        return;
      }
      // Exposed so api.js can configure the axios baseURL.
      if (props.apiBase) window.__CRM_API_BASE__ = props.apiBase;
      root = createRoot(container);
      node = container;
      root.render(render(props));
    },

    navigate(container, props = {}) {
      // A different container, or one the shell has since detached, means the
      // root we hold can no longer reach the screen — remount instead of
      // rendering into nothing.
      if (!root || container !== node || !document.contains(node)) {
        hub.unmount();
        hub.mount(container, props);
        return;
      }
      if (props.apiBase) window.__CRM_API_BASE__ = props.apiBase;
      root.render(render(props));
    },

    unmount() {
      if (!root) return;
      root.unmount();
      root = null;
      node = null;
    },

    /** Read-only, so app.js can check mount state without importing React. */
    get isMounted() { return root !== null; },
  };

  window[name] = hub;
}
