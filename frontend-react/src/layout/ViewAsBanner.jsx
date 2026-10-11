import { Eye } from 'lucide-react';

/**
 * ViewAsBanner — content-only. The vanilla shell (app.js) owns the actual
 * DOM node lifecycle: it builds the container, calls
 * NavHub.mountViewAsBanner(container, props) to fill it synchronously (see
 * nav-entry.jsx — uses flushSync so the container has real rendered content
 * before app.js hands it to top_banner_stack.js's stackTopBanner(), which
 * measures offsetHeight right after appending — a detached/empty container
 * at that point would compute a wrong (zero) stacked height, the exact
 * dead-click bug stackTopBanner was written to fix). app.js also owns
 * mp.track(...) and the exit redirect, passed in as onExit.
 */
export function ViewAsBanner({ userName, userRole, onExit }) {
  return (
    <div className="nh-viewas-banner flex items-center justify-center gap-3 px-5 py-2 bg-gradient-to-r from-amber-500 to-red-500 text-white text-sm font-semibold">
      <span className="flex items-center gap-1.5">
        <Eye size={15} strokeWidth={2.5} />
        Viewing as <strong className="font-bold">{userName || 'User'}</strong> ({userRole || 'Unknown'})
      </span>
      <button
        type="button"
        onClick={onExit}
        className="rounded-md bg-white px-3.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
      >
        ✕ Exit View-As
      </button>
    </div>
  );
}
