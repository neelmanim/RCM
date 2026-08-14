import React from 'react';

export const Card = ({ children, className = '', ...rest }) => (
  <div className={`bg-white border border-slate-200
    rounded-xl shadow-sm transition-shadow duration-150 hover:shadow-md ${className}`} {...rest}>
    {children}
  </div>
);

export const CardHeader = ({ title, subtitle, className = '', actions }) => (
  <div className={`px-5 py-4 border-b border-slate-100 flex items-start justify-between ${className}`}>
    <div>
      {title && (
        <h3 className="text-base font-semibold text-slate-800 m-0 leading-tight">
          {title}
        </h3>
      )}
      {subtitle && (
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      )}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const CardContent = ({ children, className = '' }) => (
  <div className={`px-5 py-4 ${className}`}>
    {children}
  </div>
);

export const CardFooter = ({ children, className = '' }) => (
  <div className={`px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 ${className}`}>
    {children}
  </div>
);
