import React from 'react';

export const Checkbox = ({ checked, onChange, label, className = '', ...props }) => (
  <label className={`inline-flex items-center gap-1.5 text-sm text-slate-600 select-none cursor-pointer ${className}`}>
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer"
      {...props}
    />
    {label}
  </label>
);
