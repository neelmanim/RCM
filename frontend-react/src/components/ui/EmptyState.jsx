import React from 'react';

export const EmptyState = ({ icon: Icon, title, message, action, className = '' }) => (
  <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}>
    {Icon && (
      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 text-[#C9FF68]">
        <Icon size={22} />
      </div>
    )}
    {title && <p className="text-sm font-bold text-[#F4F6F2] m-0">{title}</p>}
    {message && <p className="text-xs text-[#9BA9A5] mt-1 max-w-xs">{message}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
