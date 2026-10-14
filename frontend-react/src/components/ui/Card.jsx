import React from 'react';

export const Card = ({ children, className = '', ...rest }) => (
  <div className={`bg-[#12181A] border border-white/10 text-[#F4F6F2]
    rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.25)] transition-all duration-150 hover:border-white/20 ${className}`} {...rest}>
    {children}
  </div>
);

export const CardHeader = ({ title, subtitle, className = '', actions }) => (
  <div className={`px-5 py-4 border-b border-white/5 flex items-start justify-between ${className}`}>
    <div>
      {title && (
        <h3 className="text-base font-bold text-[#F4F6F2] m-0 leading-tight">
          {title}
        </h3>
      )}
      {subtitle && (
        <p className="text-xs text-[#9BA9A5] mt-0.5">{subtitle}</p>
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
  <div className={`px-5 py-3 border-t border-white/5 flex items-center justify-end gap-2 ${className}`}>
    {children}
  </div>
);
