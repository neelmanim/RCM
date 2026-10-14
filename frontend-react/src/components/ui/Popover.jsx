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
      className={cn(
        'activitymonitor-portal z-[110] rounded-xl border border-white/10 bg-[#12181A] text-[#F4F6F2] shadow-[0_16px_36px_rgba(0,0,0,0.6)] backdrop-blur-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));

export { Popover, PopoverContent, PopoverTrigger };
