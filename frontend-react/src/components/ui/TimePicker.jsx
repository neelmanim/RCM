import React from 'react';

import { Select } from './Select';

const pad2 = (n) => String(n).padStart(2, '0');
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: pad2(h) }));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, m) => ({ value: m, label: pad2(m) }));

/** Replacement for a native <input type="time">. `value`/the value
 * `onChange` fires with are 'HH:MM' strings (24h, zero-padded), matching a
 * native time input's own value format — a drop-in swap at every call site.
 * Two short Selects (hour, minute) rather than a calendar-style popover —
 * a time-of-day has no "browse around a grid" use case a picker UI would
 * help with, unlike a date. */
export function TimePicker({ value, onChange, ariaLabel = 'Time', className }) {
  const [h, m] = (value || '00:00').split(':').map(Number);

  return (
    <div className={`inline-flex items-center gap-1.5 ${className || ''}`}>
      <Select
        ariaLabel={`${ariaLabel} — hour`}
        value={h}
        onChange={(v) => onChange(`${pad2(v)}:${pad2(m)}`)}
        options={HOUR_OPTIONS}
      />
      <span className="text-slate-400">:</span>
      <Select
        ariaLabel={`${ariaLabel} — minute`}
        value={m}
        onChange={(v) => onChange(`${pad2(h)}:${pad2(v)}`)}
        options={MINUTE_OPTIONS}
      />
    </div>
  );
}
