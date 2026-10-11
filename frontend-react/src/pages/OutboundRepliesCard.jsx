import React, { useEffect, useState } from 'react';
import { MessageSquareReply, ArrowRight } from 'lucide-react';
import { InstantlyInboxService } from '../services/api';
import { canSeeReplies } from '../utils/roles';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';

const Stat = ({ label, value }) => (
  <div className="flex-1 min-w-[70px]">
    <div className="text-xl font-extrabold text-slate-900">{value}</div>
    <div className="text-[11px] font-semibold text-slate-500">{label}</div>
  </div>
);

export const OutboundRepliesCard = ({ userRole }) => {
  const allowed = canSeeReplies(userRole);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | error | hidden

  useEffect(() => {
    if (!allowed) { setState('hidden'); return undefined; }
    let cancelled = false;
    // Staggered 1000ms after mount — lowest priority, after the Groq card.
    const timer = setTimeout(async () => {
      try {
        const d = await InstantlyInboxService.summary();
        if (!cancelled) { setData(d); setState('ok'); }
      } catch (e) {
        if (!cancelled) setState(e?.response?.status === 403 ? 'hidden' : 'error');
      }
    }, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [allowed]);

  if (state === 'hidden') return null;
  // Not the onNavigate prop: the shell's onNavigate is (view) => loadView(view) and drops `extra`.
  const open = () => window._loadView?.('sales-tools', 'replies');
  const rate = data?.reply_rate;

  return (
    <Card data-testid="outbound-replies-card">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><MessageSquareReply size={15} className="text-indigo-600" />Outbound replies</span>}
        subtitle="Last 7 days"
        actions={<Button size="sm" variant="ghost" onClick={open}>Open Replies <ArrowRight size={13} /></Button>}
      />
      <CardContent className="flex gap-3">
        {state === 'loading' && <Skeleton className="h-10 w-full" />}
        {state === 'error' && <span className="text-xs text-slate-400">Couldn't load reply stats</span>}
        {state === 'ok' && (
          <>
            <Stat label="Replies" value={data.replies ?? 0} />
            <Stat label="Positive" value={data.positive ?? 0} />
            <Stat label="Reply rate" value={rate != null ? `${Math.round(rate * 10) / 10}%` : '—'} />
            <Stat label="Unread" value={data.unread ?? 0} />
          </>
        )}
      </CardContent>
    </Card>
  );
};
