import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

/**
 * A small "i" that explains a column, number or switch in plain words. Opens on hover or keyboard focus (and on click/tap, so it works on a
 * phone), and floats above everything, so a table's scroll area never clips it. Write the text for someone new to the page: what it
 * counts and why it matters, not how it is calculated in code.
 */
export const InfoTip = ({ text, label = 'More information', className = '' }) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={text}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center justify-center align-middle ml-1 text-slate-300 hover:text-slate-500 focus:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded-full ${className}`}
        >
          <Info size={13} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" sideOffset={6} onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-w-[260px] px-3 py-2 text-xs font-normal normal-case tracking-normal leading-snug text-slate-600" role="tooltip">
        {text}
      </PopoverContent>
    </Popover>
  );
};
