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
      'flex items-center gap-2 rounded-lg border border-white/10 bg-[#151D20] px-3 focus-within:border-[#C9FF68]/60 focus-within:ring-2 focus-within:ring-[#C9FF68]/20 transition-all',
      className,
    )}
  >
    <Search size={14} className="shrink-0 text-[#8E9B97]" />
    <input
      ref={ref}
      type="text"
      className={cn('w-full py-2 text-sm text-[#F4F6F2] placeholder:text-[#8E9B97] outline-none border-0 bg-transparent', inputClassName)}
      {...props}
    />
  </div>
));
