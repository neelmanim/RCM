import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';

// Mirrors legacy's outcome card: optional free-text notes alongside Won/Lost,
// and a "Change outcome" once one is set (RCA 2026-09-29: React had neither —
// deal-size / reason-lost context couldn't be captured, and a mis-marked
// outcome couldn't be corrected from this page).
function OutcomeButtons({ onSetOutcome, onCancel }) {
  const [notes, setNotes] = useState('');
  const set = (status) => onSetOutcome?.(status, notes.trim());
  return (
    <div className="mt-2 space-y-2">
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional: add context (e.g., deal size, reason lost)…"
        aria-label="Outcome notes"
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-focus-ring"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => set('Won')}>Won</Button>
        <Button size="sm" variant="outline" onClick={() => set('Lost')}>Lost</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}

export function RelatedOpportunity({ opportunities, canSetOutcome, onSetOutcome }) {
  const [changing, setChanging] = useState(false);

  if (!opportunities || opportunities.length === 0) {
    return (
      <Card>
        <CardHeader title="Related Opportunity" />
        <CardContent>
          <EmptyState title="No linked opportunity." />
        </CardContent>
      </Card>
    );
  }

  const submit = (status, notes) => { setChanging(false); onSetOutcome?.(status, notes); };

  return (
    <Card>
      <CardHeader title="Related Opportunity" />
      <CardContent>
        {opportunities.map((opp, i) => (
          <div key={i} className="text-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="font-semibold text-slate-800 m-0">{opp.name}</p>
              {opp.status ? <Badge>{opp.status}</Badge> : <Badge variant="warning">Pending</Badge>}
            </div>
            {opp.notes && <p className="text-slate-500 m-0 mb-2">{opp.notes}</p>}
            {canSetOutcome && (!opp.status || changing) && (
              <OutcomeButtons onSetOutcome={submit} onCancel={opp.status ? () => setChanging(false) : null} />
            )}
            {canSetOutcome && opp.status && !changing && (
              <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>✏️ Change outcome</Button>
            )}
            {!canSetOutcome && !opp.status && (
              <p className="text-xs text-slate-400 m-0">⏳ Awaiting outcome update from admin</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
