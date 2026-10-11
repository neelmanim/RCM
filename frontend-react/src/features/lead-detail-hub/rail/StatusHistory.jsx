import React from 'react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonText } from '../../../components/ui/Skeleton';
import { fmtDateTime } from '../lib/formatDate';

// Reuses the SAME normalized activity array ActivityTimeline renders,
// filtered to signals — not a second merge implementation (one source of
// truth for the status+field history client-side merge, since no server-side
// merge exists for either).
export function StatusHistory({ activities, loading }) {
  const signals = activities.filter((a) => a.kind === 'signal');

  return (
    <Card>
      <CardHeader title="Status History" />
      <CardContent>
        {loading && signals.length === 0 ? (
          <SkeletonText lines={3} />
        ) : signals.length === 0 ? (
          <EmptyState title="No history yet." />
        ) : (
          <div className="space-y-2 text-sm">
            {signals.slice(0, 10).map((s) => (
              <div key={s.id} className="border-t border-slate-50 pt-2 first:border-0 first:pt-0">
                <p className="text-slate-700 m-0">{s.summary}</p>
                <p className="text-xs text-slate-400 m-0">{fmtDateTime(s.ts)}{s.actor ? ` · ${s.actor}` : ''}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
