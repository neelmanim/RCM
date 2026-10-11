import React from 'react';
import { Compass } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { toursFor } from './data/tours';
import { PENDING_TOUR_KEY } from '../../components/ui/GuidedTour';

// Opens the page and asks its guide to start (the guide reads the pending key when it appears, so it works even though the page has to load first).
export function startTour(tour) {
  try { window.sessionStorage.setItem(PENDING_TOUR_KEY, tour.seenKey); } catch { /* storage blocked: the page opens, the guide starts only if unseen */ }
  window._loadView?.(tour.view);
}

export function GuidedToursSection({ role }) {
  const tours = toursFor(role);
  if (tours.length === 0) return <EmptyState title="No guides for your role yet" message="Open any page and look for the compass button at the top." />;
  return (
    <div>
      <p className="mb-3">
        Every page has a short guided tour that points at the real buttons. They start by themselves the first time you open a page;
        start one again here, or press the <Compass size={14} className="inline align-text-bottom" aria-hidden="true" /> button at the top of any page that has one.
      </p>
      <ul className="m-0 p-0 list-none divide-y divide-slate-100 border border-slate-200 rounded-xl">
        {tours.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="font-semibold text-slate-800">{t.title}</div>
              <div className="text-xs text-slate-500">{t.blurb}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => startTour(t)} aria-label={`Start the ${t.title} tour`}>Start</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
