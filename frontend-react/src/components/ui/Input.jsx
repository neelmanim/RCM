import React from 'react';

// forwardRef so a caller that needs the real <input> node can reach it — e.g.
// MergeFieldComposer, which reads/sets selectionStart to insert a {{token}} at
// the caret. Purely additive: every existing call site is unaffected.
export const Input = React.forwardRef(({
  label,
  id,
  error,
  hint,
  className = '',
  containerClassName = '',
  ...props
}, ref) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={`mb-4 ${containerClassName}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-slate-700 mb-1"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`
          w-full px-3 py-2 rounded-lg text-sm border transition-all duration-150 outline-none
          bg-white text-slate-800 placeholder:text-slate-400 border-slate-200
          focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''}
          ${className}
        `}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
});

Input.displayName = 'Input';
