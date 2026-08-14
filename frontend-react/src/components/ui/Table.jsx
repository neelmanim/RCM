import React from 'react';

export const Table = ({ children, className = '', tableStyle }) => (
  <div className={`w-full overflow-x-auto rounded-xl border border-slate-200 bg-white ${className}`}>
    <table className="w-full text-sm border-collapse" style={tableStyle}>{children}</table>
  </div>
);

export const TableHead = ({ children, className = '' }) => {
  const hasBgOverride = /\bbg-/.test(className);
  return (
    <thead className={`${hasBgOverride ? '' : 'bg-slate-50'} border-b border-slate-200 ${className}`}>
      {children}
    </thead>
  );
};

export const TableBody = ({ children }) => (
  <tbody className="divide-y divide-slate-100">{children}</tbody>
);

export const TableRow = ({ children, onClick, className = '', ...rest }) => (
  <tr
    onClick={onClick}
    className={`
      transition-colors duration-100
      ${onClick ? 'cursor-pointer hover:bg-slate-50' : ''}
      ${className}
    `}
    {...rest}
  >
    {children}
  </tr>
);

export const TableHeader = ({ children, className = '', colSpan, ...rest }) => (
  <th colSpan={colSpan} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider
    text-slate-500 whitespace-nowrap ${className}`} {...rest}>
    {children}
  </th>
);

export const TableCell = ({ children, className = '', colSpan, ...rest }) => {
  // RCA 2026-07-28: Tailwind resolves conflicting utilities (whitespace-nowrap
  // vs whitespace-normal) by stylesheet definition order, not by which class
  // appears later in the `className` string — so a caller passing
  // "whitespace-normal" to wrap long text was silently losing to this
  // default, keeping text on one line and spilling into adjacent columns.
  const hasWhitespaceOverride = /\bwhitespace-/.test(className);
  return (
    <td colSpan={colSpan} className={`px-4 py-3 text-slate-700 ${hasWhitespaceOverride ? '' : 'whitespace-nowrap'} ${className}`} {...rest}>
      {children}
    </td>
  );
};
