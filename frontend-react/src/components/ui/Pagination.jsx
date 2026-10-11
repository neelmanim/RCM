import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function Pagination({ page, pages, total, perPage, onChange }) {
  if (!total) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className="flex items-center justify-between mt-3 pt-3 text-sm text-slate-500">
      <span>Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={14} /> Prev
        </Button>
        <span className="font-mono">{page} / {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
