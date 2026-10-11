import { CalendarDays } from 'lucide-react';
import React, { useState } from 'react';

import { Calendar } from './Calendar';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { TriggerPill } from './Select';

const fmt = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const toIso = (date) => {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Single-date replacement for a native <input type="date">. `value`/the
 * value `onChange` fires with are 'yyyy-mm-dd' strings, matching a native
 * date input's own value format — a drop-in swap at every call site.
 * `min`/`max` are also 'yyyy-mm-dd' strings, matching the native attributes
 * they replace (e.g. capping a date filter at today). */
export function DatePicker({ value, onChange, placeholder = 'Select date', ariaLabel = 'Select date', min, max, className }) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  const label = value ? fmt(value) : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TriggerPill label={label} icon={CalendarDays} aria-label={ariaLabel} className={className} />
      </PopoverTrigger>
      <PopoverContent align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          startMonth={min ? new Date(`${min}T00:00:00`) : undefined}
          endMonth={max ? new Date(`${max}T00:00:00`) : undefined}
          disabled={(date) => (min && date < new Date(`${min}T00:00:00`)) || (max && date > new Date(`${max}T00:00:00`))}
          onSelect={(next) => { onChange(toIso(next)); setOpen(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}
