import React from 'react';

export const EmptyState = ({ icon: Icon, title, message, action, className = '' }) => (
  <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}>
    {Icon && (
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 text-slate-400">
        <Icon size={22} />
      </div>
    )}
    {title && <p className="text-sm font-bold text-slate-700 m-0">{title}</p>}
    {message && <p className="text-xs text-slate-400 mt-1 max-w-xs">{message}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
