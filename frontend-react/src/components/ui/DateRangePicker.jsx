import { CalendarDays } from 'lucide-react';
import React, { useState } from 'react';

import { Calendar } from './Calendar';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { TriggerPill } from './Select';

const fmt = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const toIso = (date) => {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Replaces a pair of native <input type="date"> "from"/"to" fields with a
 * single calendar-range popover — one control for one concept (a date
 * range), instead of two disconnected native pickers a user has to keep in
 * sync themselves. `from`/`to` and the values `onChange` fires are
 * 'yyyy-mm-dd' strings, matching a native date input's own value format. */
export function DateRangePicker({ from, to, onChange, placeholder = 'Date range', ariaLabel = 'Date range', maxDate, minDate, align = 'start' }) {
  const [open, setOpen] = useState(false);
  const range = { from: from ? new Date(`${from}T00:00:00`) : undefined, to: to ? new Date(`${to}T00:00:00`) : undefined };

  const label = from || to
    ? `${fmt(from) ?? 'Any'} – ${fmt(to) ?? 'Any'}`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TriggerPill label={label} icon={CalendarDays} aria-label={ariaLabel} />
      </PopoverTrigger>
      <PopoverContent align={align} collisionPadding={16}>
        <Calendar
          mode="range"
          selected={range}
          defaultMonth={range.from}
          numberOfMonths={2}
          // days outside [minDate, maxDate] cannot be picked
          disabled={[...(maxDate ? [{ after: maxDate }] : []), ...(minDate ? [{ before: minDate }] : [])]}
          endMonth={maxDate}
          onSelect={(next) => onChange({ from: toIso(next?.from), to: toIso(next?.to) })}
        />
        <div className="flex justify-end gap-2 border-t border-slate-100 px-3 py-2">
          <button
            type="button"
            onClick={() => { onChange({ from: '', to: '' }); }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 px-2 py-1"
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
