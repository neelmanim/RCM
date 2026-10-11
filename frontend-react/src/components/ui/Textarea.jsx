import React from 'react';

// Multi-line counterpart of Input.jsx — same border/focus/disabled look.
// `[font-family:inherit]` matters: these bundles ship without Tailwind's Preflight,
// so a bare <textarea> falls back to the browser's monospace font (the
// cadence approval editor looked like a code box because of it).
export const Textarea = React.forwardRef(({ className = '', hint, rows = 4, ...props }, ref) => (
  <div>
    <textarea
      ref={ref}
      rows={rows}
      className={`
        block w-full px-3 py-2 rounded-lg text-sm leading-relaxed border outline-none resize-y [font-family:inherit]
        bg-white text-slate-800 placeholder:text-slate-400 border-slate-200 transition-all duration-150
        focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
      {...props}
    />
    {hint && <p className="mt-1 mb-0 text-xs text-slate-400">{hint}</p>}
  </div>
));
Textarea.displayName = 'Textarea';
