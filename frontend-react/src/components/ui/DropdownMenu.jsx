import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import React from 'react';

import { cn } from '../../lib/cn';

/**
 * Radix-backed dropdown menu, styled with this app's own slate/indigo
 * palette (no shadcn CSS-variable tokens — this project doesn't define
 * those). Gives every dropdown correct positioning/focus/animation for
 * free instead of the hand-rolled portal+click-outside logic each feature
 * used to copy-paste (see leads-hub / activity-monitor's old
 * InlineSelectCell).
 *
 * Trimmed to the pieces actually used (a flat single-select list) — add
 * DropdownMenuSub/RadioGroup/Checkbox back from the shadcn reference
 * (ui.shadcn.com/docs/components/dropdown-menu) when a consumer needs them.
 */
const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = React.forwardRef(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // "activitymonitor-portal": this content is teleported to document.body by
        // Radix's portal, outside the .activitymonitor subtree its CSS reset
        // scopes to — this class re-applies that same reset (see
        // activity-monitor-tailwind.css).
        //
        // z-[110]: above Modal's z-[100] — a Select/DropdownMenu opened from
        // inside a modal (e.g. Sales Journey's SendWindowSettings Timezone
        // picker) also portals to document.body, and without this it renders
        // behind the modal's own backdrop instead of on top of the modal.
        // Stays below GuidedTour (z-[999]) and Toast (z-[9999]).
        'activitymonitor-portal z-[110] min-w-[200px] overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 text-slate-700 shadow-lg shadow-black/5 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));

const DropdownMenuItem = React.forwardRef(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
      inset && 'pl-8',
      className,
    )}
    {...props}
  />
));

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
};
