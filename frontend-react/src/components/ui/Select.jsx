import { Check, ChevronDown } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';

import { cn } from '../../lib/cn';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './DropdownMenu';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { SearchInput } from './SearchInput';

export const TriggerPill = React.forwardRef(({ label, icon: Icon, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap max-w-full',
      className,
    )}
    {...props}
  >
    {Icon && <Icon size={14} className="text-slate-400 shrink-0" />}
    {/* a long value (name + email) shortens with … inside its box instead of spilling over the neighbouring button */}
    <span className="min-w-0 truncate" title={typeof label === 'string' ? label : undefined}>{label}</span>
    <ChevronDown size={14} className="text-slate-400 shrink-0" />
  </button>
));

/**
 * The one dropdown every picker in this app should render through — not a
 * native <select> (unstyled, can't be searched, runs off-screen with a long
 * option list) and not a one-off hand-rolled portal+click-outside popup
 * (see the retired leads-hub InlineSelectCell, which this superseded).
 *
 * Two trigger shapes:
 *  - no `children`: renders the default icon+label+chevron TriggerPill (a
 *    filter control — activity-monitor's FilterBar).
 *  - `children`: renders your own trigger content instead (a Badge, an
 *    avatar+name — leads-hub's inline-editable cells), wrapped in Radix's
 *    own trigger button rather than TriggerPill's.
 *
 * Short static option lists render as a Radix DropdownMenu — no search,
 * closes itself on selection. `searchable` (20+ names) opens a Popover with
 * a text input instead: DropdownMenu's roving-focus/typeahead model actively
 * fights a real text input, where Popover doesn't manage focus for you.
 *
 * `disabled` disables the whole control; an individual option can carry its
 * own `disabled: true` (e.g. an SDR already at capacity) without disabling
 * the rest of the list.
 */
export function Select({ value, onChange, options, placeholder, icon, searchable = false, children, ariaLabel, className, disabled = false }) {
  // options: [{ value, label, disabled? }] — disabled greys an individual
  // choice out and blocks selecting it (e.g. an SDR already at capacity),
  // distinct from the top-level `disabled` prop which disables the whole
  // control (e.g. a step-gated picker not usable yet).
  const current = options.find((o) => o.value === value);
  const label = current?.label ?? placeholder;
  const asChild = !children;
  const trigger = children ?? <TriggerPill label={label} icon={icon} aria-label={ariaLabel ?? placeholder} className={className} />;

  if (searchable) {
    return (
      <SearchableSelect
        value={value} onChange={onChange} options={options} trigger={trigger}
        asChild={asChild} ariaLabel={ariaLabel} className={className} disabled={disabled}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild={asChild} disabled={disabled}
        aria-label={asChild ? undefined : ariaLabel} className={asChild ? undefined : className}
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} disabled={o.disabled} onSelect={() => onChange(o.value)} className="justify-between">
            <span>{o.label}</span>
            {o.value === value && <Check size={13} strokeWidth={2.5} className="text-indigo-600" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchableSelect({ value, onChange, options, trigger, asChild, ariaLabel, className, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, search]);

  const commit = (o) => { if (o.disabled) return; onChange(o.value); setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % Math.max(filtered.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) commit(filtered[highlighted]);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => { if (disabled) return; setOpen(next); if (next) { setSearch(''); setHighlighted(0); } }}>
      <PopoverTrigger asChild={asChild} disabled={disabled} aria-label={asChild ? undefined : ariaLabel} className={asChild ? undefined : className}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        role="listbox"
        className="w-[240px] p-1.5"
        onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus(); }}
      >
        <SearchInput
          ref={searchRef}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setHighlighted(0); }}
          onKeyDown={onKeyDown}
          placeholder="Search…"
          className="mb-1.5"
        />
        <div className="max-h-[260px] overflow-y-auto">
          {filtered.length === 0 && <div className="px-2.5 py-2 text-xs text-slate-400">No matches</div>}
          {filtered.map((o, i) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                disabled={o.disabled}
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                onClick={() => commit(o)}
                className={`w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-md text-sm ${
                  o.disabled ? 'text-slate-300 cursor-not-allowed'
                    : selected ? 'bg-indigo-50 text-indigo-700 font-semibold' : i === highlighted ? 'bg-slate-50' : 'hover:bg-slate-50'
                }`}
              >
                <span>{o.label}</span>
                {selected && <Check size={13} strokeWidth={2.5} className="text-indigo-600 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
