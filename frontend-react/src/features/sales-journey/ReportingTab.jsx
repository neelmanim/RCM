import React, { useEffect, useState, useCallback } from 'react';
import { EngagementPanel } from './EngagementPanel';
import { RepPerformanceTable } from './RepPerformanceTable';
import { TrendPanel } from './TrendPanel';
import { EnrollmentRosterPanel } from './EnrollmentRosterPanel';
import { SalesJourneyService } from '../../services/api';

// v13.1.8 reporting revamp — replaces ReportingPanel's 384px drawer (live
// feedback: "overwhelming", "can be done in a better way"). A full tab
// (same width JourneyBuilder gives the canvas) instead of a fixed-width
// sidebar is the actual fix; cramming a multi-column table into a drawer
// was never going to read as calm no matter how its contents were tuned.
// Also retires the standalone "Activity" button/modal — its events now
// live inline under the roster's per-lead expand row instead of a
// disconnected feed the user had to manually cross-reference by name.
export function ReportingTab({ journeyId, nodes }) {
  // Fetched once here (not inside EnrollmentRosterPanel) so a lead's
  // expand-row has the data immediately — no per-row fetch, no spinner
  // per click. ACTIVITY_PAGE_LIMIT caps this at 100 events server-side.
  const [activity, setActivity] = useState([]);

  const loadActivity = useCallback(async () => {
    try {
      setActivity(await SalesJourneyService.getActivity(journeyId));
    } catch {
      // Non-fatal — the roster and engagement stats are still useful
      // without per-lead activity; expand rows just show "no activity".
    }
  }, [journeyId]);

  useEffect(() => { loadActivity(); }, [loadActivity]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <EngagementPanel journeyId={journeyId} nodes={nodes} />
      <RepPerformanceTable journeyId={journeyId} />
      <TrendPanel journeyId={journeyId} />
      <EnrollmentRosterPanel journeyId={journeyId} activity={activity} />
    </div>
  );
}
