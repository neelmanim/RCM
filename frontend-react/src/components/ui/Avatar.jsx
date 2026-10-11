import React from 'react';

const PALETTE = ['#7c3aed', '#2563eb', '#059669', '#dc2626', '#d97706', '#0891b2', '#db2777'];

// Deterministic color from name so the same person always gets the same avatar.
function colorFromName(name) {
  const str = name || 'U';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// Initials-circle avatar. Pass `background` (a CSS color or gradient string)
// to override the deterministic default — e.g. NavSidebar's role-color gradient.
export const Avatar = ({ name = '', size = 32, background, className = '' }) => (
  <div
    className={`inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 ${className}`}
    style={{
      width: size,
      height: size,
      fontSize: Math.max(11, size * 0.42),
      background: background || `linear-gradient(135deg, ${colorFromName(name)}, #7c3aed)`,
    }}
  >
    {(name || 'U').trim().charAt(0).toUpperCase()}
  </div>
);
