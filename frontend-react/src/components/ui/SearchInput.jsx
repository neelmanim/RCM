import { Search } from 'lucide-react';
import React from 'react';

import { cn } from '../../lib/cn';

/**
 * Icon + input laid out with flex, not an absolutely-positioned icon over a
 * separately-padded input — that pairing depends on the icon's padding and
 * the input's line-height staying in lockstep, and drifts out of alignment
 * whenever either one changes. Flex guarantees the icon sits on the input's
 * own vertical center always.
 */
export const SearchInput = React.forwardRef(({ className, inputClassName, ...props }, ref) => (
  <div
    className={cn(
      'flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20',
      className,
    )}
  >
    <Search size={14} className="shrink-0 text-slate-400" />
    <input
      ref={ref}
      type="text"
      className={cn('w-full py-2 text-sm text-slate-800 placeholder:text-slate-400 outline-none border-0', inputClassName)}
      {...props}
    />
  </div>
));
