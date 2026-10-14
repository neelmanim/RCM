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
          className="block text-sm font-bold text-[#F4F6F2] mb-1.5"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`
          w-full px-3.5 py-2.5 rounded-xl text-sm border transition-all duration-150 outline-none
          bg-[#151D20] text-[#F4F6F2] placeholder:text-[#9BA9A5]/60 border-white/10
          focus:border-[#C9FF68] focus:ring-2 focus:ring-[#C9FF68]/20
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''}
          ${className}
        `}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-[#9BA9A5]">{hint}</p>}
    </div>
  );
});

Input.displayName = 'Input';
