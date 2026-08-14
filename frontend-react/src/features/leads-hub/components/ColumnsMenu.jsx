import React, { useState, useRef } from 'react';
import { Columns3, Check, RotateCcw } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';

/** Show/hide checkboxes for the reorderable table columns — reordering and
 * resizing happen by dragging the header itself; this menu only covers
 * visibility + resetting a layout someone has fiddled into an unreadable state. */
export function ColumnsMenu({ allColumns, hidden, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 rounded-md px-2.5 py-1.5 text-xs font-semibold"
      >
        <Columns3 size={13} strokeWidth={2.25} /> Columns
      </button>
      {open && (
        <div className="absolute z-40 top-full right-0 mt-1.5 min-w-[190px] bg-white border border-slate-200 rounded-lg shadow-lg p-1.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400 px-2.5 py-1">Show columns</div>
          {allColumns.map((col) => {
            const visible = !hidden.has(col.key);
            return (
              <button
                key={col.key} type="button" onClick={() => onToggle(col.key)}
                className="w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-slate-50"
              >
                <span className={visible ? 'text-slate-700' : 'text-slate-300'}>{col.label}</span>
                {visible && <Check size={13} strokeWidth={2.5} className="text-blue-600" />}
              </button>
            );
          })}
          <div className="border-t border-slate-100 mt-1 pt-1">
            <button
              type="button" onClick={onReset}
              className="w-full flex items-center gap-1.5 text-left px-2.5 py-1.5 rounded-md text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
              <RotateCcw size={12} strokeWidth={2.25} /> Reset column layout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
