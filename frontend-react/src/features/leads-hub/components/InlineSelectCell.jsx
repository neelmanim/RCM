import React from 'react';
import { closeOtherPopovers } from '../hooks/useClickOutside';

/** An invisible <select> overlaid on a visible display (a Badge, an avatar +
 * name, …) — autosaves on change, no explicit save step. Shared shape behind
 * StatusCell and AssigneeCell, which only differ in their display and options. */
export function InlineSelectCell({ value, onChange, ariaLabel, options, className = '', children }) {
  return (
    <div
      className={`relative inline-block ${className}`}
      onClick={(e) => { e.stopPropagation(); closeOtherPopovers(); }}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label={ariaLabel}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {children}
    </div>
  );
}
