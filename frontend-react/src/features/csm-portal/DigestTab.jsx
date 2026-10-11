import React, { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Clock, Users } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { SkeletonMetricCard, SkeletonCard, SkeletonText } from '../../components/ui/Skeleton';
import { CsmPortalService } from '../../services/api';

const TILE_META = [
  { key: 'total_accounts', label: 'Total accounts', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
  { key: 'critical_count', label: 'Critical', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
  { key: 'at_risk_count', label: 'At Risk', icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
  { key: 'renewals_due_soon_count', label: 'Renewals due soon', icon: CalendarClock, color: 'text-violet-600', bg: 'bg-violet-50' },
  { key: 'playbook_executions_this_week', label: 'Playbooks run this week', icon: Clock, color: 'text-emerald-600', bg: 'bg-emerald-50' },
];

/** Weekly summary — total in scope, Critical/At Risk counts, playbook
 * executions this week, and the estimated (never claimed measured) time
 * saved. Same /digest endpoint InboxTab's KPI banner uses. */
export function DigestTab() {
  const [digest, setDigest] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    CsmPortalService.getDigest()
      .then((res) => { if (!cancelled) setDigest(res); })
      .catch(() => { if (!cancelled) setError('Failed to load the digest.'); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;

  if (!digest) {
    return (
      <div className="space-y-4" data-tour="csm-portal-digest">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {TILE_META.map((t) => <SkeletonMetricCard key={t.key} />)}
        </div>
        <SkeletonCard><SkeletonText lines={2} /></SkeletonCard>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-tour="csm-portal-digest">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {TILE_META.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.key} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-1">
              <div className={`w-8 h-8 ${t.bg} rounded-xl flex items-center justify-center ${t.color} mb-1`}>
                <Icon size={16} />
              </div>
              <p className="text-2xl font-extrabold text-slate-800 leading-tight tabular-nums">{digest[t.key]}</p>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{t.label}</p>
            </div>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Estimated time saved" subtitle={digest.estimate_label} />
        <CardContent>
          <p className="text-3xl font-extrabold text-emerald-600 m-0">{digest.estimated_minutes_saved} min</p>
          <p className="text-xs text-slate-400 mt-2 m-0">
            An estimate, not a measurement — playbook executions this week × an assumed number of minutes each.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
