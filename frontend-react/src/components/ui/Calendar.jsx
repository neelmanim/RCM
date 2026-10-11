import { ChevronLeft, ChevronRight } from 'lucide-react';
import React from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

import { cn } from '../../lib/cn';

/**
 * react-day-picker themed via its own CSS custom properties (v10 exposes
 * the whole look as --rdp-* vars on .rdp-root) — cheaper and more robust
 * than re-deriving its ~30 internal class hooks with Tailwind overrides.
 */
export const Calendar = ({ className, ...props }) => (
  <DayPicker
    showOutsideDays
    components={{
      Chevron: ({ orientation, ...chevronProps }) =>
        orientation === 'left' ? <ChevronLeft size={16} {...chevronProps} /> : <ChevronRight size={16} {...chevronProps} />,
    }}
    className={cn('activitymonitor-calendar p-3 text-sm', className)}
    {...props}
  />
);
