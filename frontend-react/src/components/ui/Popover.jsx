import * as PopoverPrimitive from '@radix-ui/react-popover';
import React from 'react';

import { cn } from '../../lib/cn';

/**
 * Radix Popover, styled to match DropdownMenu.jsx's card (same border/
 * shadow/radius/animation) — used where content needs a free-text input
 * (search-a-long-list, a calendar), which fights Radix DropdownMenu's
 * roving-focus/typeahead model.
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        // see DropdownMenu.jsx's DropdownMenuContent for why this class exists,
        // and why z-index is z-[110] (above Modal's z-[100])
        'activitymonitor-portal z-[110] rounded-lg border border-slate-200 bg-white text-slate-700 shadow-lg shadow-black/5 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));

export { Popover, PopoverContent, PopoverTrigger };
