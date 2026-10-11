import React from 'react';
import { Columns3, Check, RotateCcw } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/DropdownMenu';

/** Show/hide checkboxes for the reorderable table columns — reordering and
 * resizing happen by dragging the header itself; this menu only covers
 * visibility + resetting a layout someone has fiddled into an unreadable state. */
export function ColumnsMenu({ allColumns, hidden, onToggle, onReset }) {
  // modal={false}: this menu stays open across multiple toggles (each item
  // calls preventDefault() to keep it open) — Radix's default modal
  // DropdownMenu aria-hides/scroll-locks the rest of the page while open,
  // which would hide the very table this menu is editing.
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 rounded-md px-2.5 py-1.5 text-xs font-semibold"
        >
          <Columns3 size={13} strokeWidth={2.25} /> Columns
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[190px]">
        <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400 px-2.5 py-1">Show columns</div>
        {allColumns.map((col) => {
          const visible = !hidden.has(col.key);
          return (
            <DropdownMenuItem
              key={col.key}
              onSelect={(e) => { e.preventDefault(); onToggle(col.key); }}
              className="justify-between text-xs"
            >
              <span className={visible ? 'text-slate-700' : 'text-slate-300'}>{col.label}</span>
              {visible && <Check size={13} strokeWidth={2.5} className="text-blue-600" />}
            </DropdownMenuItem>
          );
        })}
        <div className="border-t border-slate-100 mt-1 pt-1">
          <DropdownMenuItem onSelect={onReset} className="gap-1.5 text-xs text-slate-500">
            <RotateCcw size={12} strokeWidth={2.25} /> Reset column layout
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
