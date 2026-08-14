import React from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { TableHeader } from '../../../components/ui/Table';

export function SortableTableHeader({ label, sortKey, sort, onSort, className = '', children, ...rest }) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHeader className={className} {...rest}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider bg-transparent rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40 hover:text-slate-700 ${active ? 'text-slate-700' : 'text-slate-500'}`}
      >
        {label}
        <Icon size={12} strokeWidth={2.25} className={active ? '' : 'opacity-40'} />
      </button>
      {children}
    </TableHeader>
  );
}
