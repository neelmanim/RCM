import React from 'react';

// Compact icon-only action button — row actions, card-header controls, tab
// triggers — where Button.jsx's padding/sizing doesn't fit. Consolidates the
// raw `<button className="...">`{icon}`</button>` pattern that had been
// reinvented slightly differently in ~6 files (per AGENT_PROTOCOL.md §19).
const variantClasses = {
  default: 'text-slate-400 hover:text-slate-700 hover:bg-slate-100',
  danger: 'text-slate-400 hover:text-red-600 hover:bg-red-50',
  active: 'text-blue-700 bg-blue-100',
};

// forwardRef so it can be a Radix trigger (`<DropdownMenuTrigger asChild>`),
// which positions its menu from the trigger's DOM node.
export const IconButton = React.forwardRef(({
  as: Tag = 'button',
  children,
  variant = 'default',
  active = false,
  className = '',
  disabled = false,
  ...props
}, ref) => (
  <Tag
    ref={ref}
    type={Tag === 'button' ? 'button' : undefined}
    className={`
      inline-flex items-center justify-center rounded-lg p-1.5
      transition-colors cursor-pointer border-none outline-none bg-transparent
      disabled:opacity-50 disabled:cursor-not-allowed
      focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1
      ${variantClasses[active ? 'active' : variant] || variantClasses.default}
      ${className}
    `}
    disabled={Tag === 'button' ? disabled : undefined}
    {...props}
  >
    {children}
  </Tag>
));
IconButton.displayName = 'IconButton';
