import React from 'react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';

// Fed the exact same `lead` object PreCallIntelligence reads — spec's "one
// source of truth" fix for the legacy page's duplicated research display.
export function CallStrategy({ lead }) {
  if (!lead) return null;
  const hasStrategy = lead.research_hypothesis || lead.research_opening;
  if (!hasStrategy) {
    return (
      <Card>
        <CardHeader title="Call Strategy" />
        <CardContent>
          <EmptyState title="No strategy yet — run Pre-Call Intelligence first." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Call Strategy" />
      <CardContent>
        <div className="space-y-2 text-sm">
          {lead.research_hypothesis && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider m-0">Pitch angle</p>
              <p className="text-slate-700 m-0">{lead.research_hypothesis}</p>
            </div>
          )}
          {lead.research_opening && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider m-0">Opening line</p>
              <p className="text-slate-700 m-0">{lead.research_opening}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
