import React from 'react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonCallRow } from '../../../components/ui/Skeleton';
import { ActivityItem } from './ActivityItem';
import { ACTIVITY_FILTER_LABELS } from '../lib/normalizeActivity';

export function ActivityTimeline({ activities, filter, onFilterChange, loading, error, hasMore, onLoadMore, onOpenClassicTab }) {
  const filtered = filter === 'all' ? activities : activities.filter((a) => a.kind === filter);

  return (
    <Card>
      <CardHeader
        title="Activity"
        actions={
          <div className="flex items-center gap-1">
            {Object.entries(ACTIVITY_FILTER_LABELS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onFilterChange?.(key)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  filter === key ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      <CardContent>
        {loading && filtered.length === 0 ? (
          <div>
            <SkeletonCallRow /><SkeletonCallRow /><SkeletonCallRow />
          </div>
        ) : error ? (
          <p className="text-sm text-red-500">Couldn't load activity. Try refreshing.</p>
        ) : filtered.length === 0 ? (
          <EmptyState title="No activity yet." />
        ) : (
          <>
            <div>
              {filtered.map((a) => <ActivityItem key={a.id} activity={a} onOpenClassicTab={onOpenClassicTab} />)}
            </div>
            {hasMore && filter === 'all' && (
              <div className="pt-3 text-center">
                <Button size="sm" variant="outline" onClick={onLoadMore}>Load more</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
