import React from 'react';

const STAGES = ['Qualification', 'Meeting', 'Discovery', 'Demo'];

const STATUS_TO_STAGE_INDEX = {
  'Lead Assigned': 0, 'Research': 0, 'Calling': 0, 'No Phone - Parked': 0, 'Pending Review': 0,
  'Meeting Scheduled': 1,
  '1st Discovery Meeting': 2, 'Discovery Complete': 2,
  'Demo Scheduled': 3, 'Demo Done': 3, 'Completed': 3,
};

const DISQUALIFIED_STATUSES = new Set(['Disqualified', 'Not Interested', 'Unreachable', 'Customer Declined']);

/** Pure — exported for testing. Sales stage is a separate concept from
 * NextBestAction on purpose (spec: "these are different concepts and must
 * remain visually and technically separate"). */
export function deriveStageIndex(status) {
  if (status in STATUS_TO_STAGE_INDEX) return STATUS_TO_STAGE_INDEX[status];
  return 0;
}

// Deliberately no click-to-advance on the stage pips themselves (legacy's
// pipeline click-to-advance, with its SDR-guardrail/no-skip logic). Every
// stage transition this page supports is reachable through NextBestAction's
// CTA + QuickActions instead — a single obvious button beats a second,
// easier-to-misclick way to trigger the same mutation. Revisit only if a
// real user need for direct pip-clicking shows up.
export function SalesStage({ lead }) {
  if (!lead) return null;

  if (DISQUALIFIED_STATUSES.has(lead.status)) {
    return (
      <div className="flex items-center gap-2 text-sm font-semibold text-red-500">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        Disqualified — {lead.status}
      </div>
    );
  }

  const activeIndex = deriveStageIndex(lead.status);

  return (
    <div className="flex items-center gap-2">
      {STAGES.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                i < activeIndex ? 'bg-purple-600 text-white'
                  : i === activeIndex ? 'bg-purple-600 text-white ring-2 ring-purple-200'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm font-semibold ${i === activeIndex ? 'text-purple-700' : 'text-slate-500'}`}>
              {label}
            </span>
          </div>
          {i < STAGES.length - 1 && <span className="text-slate-300">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}
