import React, { useEffect, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/DropdownMenu';
import { MenuSkeletonRows } from '../../components/ui/Skeleton';
import { SalesJourneyService } from '../../services/api';

/** Pick a live cadence. `children` is the trigger (any element that forwards
 *  a ref — Radix positions the menu from it). The list loads on first open,
 *  not on mount: the Leads bulk bar re-renders far more often than anyone
 *  enrolls. Shared by the Leads bulk bar and the lead page (v13.7.0). */
export function JourneyPicker({ onEnroll, children, side = 'bottom', align = 'start' }) {
  const [open, setOpen] = useState(false);
  const [journeys, setJourneys] = useState(null); // null = not yet loaded

  useEffect(() => {
    if (open && journeys === null) {
      SalesJourneyService.list()
        .then((all) => setJourneys(all.filter((j) => j.status === 'active')))
        .catch(() => setJourneys([]));
    }
  }, [open, journeys]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-[240px] max-h-[260px] overflow-y-auto">
        {journeys === null && <MenuSkeletonRows />}
        {journeys?.length === 0 && <div className="px-2.5 py-2 text-xs text-slate-400">No published cadences yet.</div>}
        {journeys?.map((j) => (
          <DropdownMenuItem key={j.id} onSelect={() => onEnroll(j)} className="text-sm truncate">
            {j.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
