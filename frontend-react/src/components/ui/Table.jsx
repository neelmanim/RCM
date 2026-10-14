import React from 'react';

export const Table = ({ children, className = '', tableStyle }) => (
  <div className={`w-full overflow-x-auto rounded-2xl border border-white/10 bg-[#12181A] shadow-sm ${className}`}>
    <table className="w-full text-sm border-collapse" style={tableStyle}>{children}</table>
  </div>
);

export const TableHead = ({ children, className = '' }) => {
  const hasBgOverride = /\bbg-/.test(className);
  return (
    <thead className={`${hasBgOverride ? '' : 'bg-white/[0.02]'} border-b border-white/5 ${className}`}>
      {children}
    </thead>
  );
};

export const TableBody = ({ children }) => (
  <tbody className="divide-y divide-white/5">{children}</tbody>
);

export const TableRow = ({ children, onClick, className = '', ...rest }) => (
  <tr
    onClick={onClick}
    className={`
      transition-colors duration-100
      ${onClick ? 'cursor-pointer hover:bg-white/[0.04]' : ''}
      ${className}
    `}
    {...rest}
  >
    {children}
  </tr>
);

export const TableHeader = ({ children, className = '', colSpan, ...rest }) => (
  <th colSpan={colSpan} className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider
    text-[#9BA9A5] whitespace-nowrap ${className}`} {...rest}>
    {children}
  </th>
);

export const TableCell = ({ children, className = '', colSpan, ...rest }) => {
  const hasWhitespaceOverride = /\bwhitespace-/.test(className);
  return (
    <td colSpan={colSpan} className={`px-4 py-3 text-[#F4F6F2] ${hasWhitespaceOverride ? '' : 'whitespace-nowrap'} ${className}`} {...rest}>
      {children}
    </td>
  );
};
