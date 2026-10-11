import React from 'react';

// Extracted from Modal.jsx's ConfirmDialog loading state — 'light' for use on a
// colored/dark background (buttons), 'dark' for use on a light background.
const toneClasses = {
  light: 'border-white/30 border-t-white',
  dark: 'border-slate-200 border-t-slate-500',
};

export const Spinner = ({ size = 16, tone = 'dark', className = '' }) => (
  <span
    className={`inline-block rounded-full animate-spin border-2 ${toneClasses[tone] || toneClasses.dark} ${className}`}
    style={{ width: size, height: size }}
    role="status"
    aria-label="Loading"
  />
);
