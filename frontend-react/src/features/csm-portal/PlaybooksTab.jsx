import React, { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonCard, SkeletonText } from '../../components/ui/Skeleton';
import { CsmPortalService } from '../../services/api';
import {
  tierVariant, emptyPortfolioCopy,
  isSilentAccount, isRenewalUpcoming, isZeroFormHandoverReady,
  SILENT_ACCOUNT_DAYS, RENEWAL_COUNTDOWN_DAYS,
} from './utils';

// The 4 buildable playbooks (per the plan) — the 5 Usage/Support/Sentiment/
// Payment/Expansion ones have no real data source yet and are deliberately
// left out. Champion Departure has no queue at all: it's manual-trigger
// only (ClosingBrief's own doc comment — no auto-detection signal exists),
// so showing a "candidate" list here would just be every account with an
// active champion, which isn't actionable triage.
const PLAYBOOKS = [
  {
    key: 'zero_form_handover',
    title: 'Zero-Form Handover',
    description: 'Closed-Won accounts with a brief auto-carried from the AE — nothing to fill in, just review and log your first touch.',
    getMatches: (accounts) => accounts.filter(isZeroFormHandoverReady),
  },
  {
    key: 'renewal_countdown',
    title: 'Renewal Countdown',
    description: `Open renewals closing within ${RENEWAL_COUNTDOWN_DAYS} days.`,
    getMatches: (accounts) => accounts.filter(isRenewalUpcoming),
  },
  {
    key: 'silent_account',
    title: 'Silent Account',
    description: `No logged touch in ${SILENT_ACCOUNT_DAYS}+ days.`,
    getMatches: (accounts) => accounts.filter(isSilentAccount),
  },
  {
    key: 'champion_departure',
    title: 'Champion Departure',
    description: "Manual only — no auto-detection exists. Open an account and use \"Champion departed\" the moment you learn one has left.",
    getMatches: null,
  },
];

export function PlaybooksTab({ isAdmin, onOpenAccount }) {
  const [accounts, setAccounts] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    CsmPortalService.getPortfolio()
      .then((res) => { if (!cancelled) setAccounts(res.accounts || []); })
      .catch(() => { if (!cancelled) { setError('Failed to load playbooks.'); setAccounts([]); } });
    return () => { cancelled = true; };
  }, []);

  if (accounts === null) return <SkeletonCard><SkeletonText lines={4} /></SkeletonCard>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  if (!accounts.length) {
    const { title, message } = emptyPortfolioCopy(isAdmin);
    return <EmptyState icon={ListChecks} title={title} message={message} />;
  }

  const cards = PLAYBOOKS.map((meta) => ({ ...meta, matches: meta.getMatches ? meta.getMatches(accounts) : null }));
  const anyTriggerable = cards.some((c) => c.matches && c.matches.length > 0);

  if (!anyTriggerable) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Nothing to action right now"
        message="No account currently matches a playbook trigger — check back as accounts age or renewals approach."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-tour="csm-portal-playbooks">
      {cards.map((card) => (
        <Card key={card.key}>
          <CardHeader title={card.title} subtitle={card.description} />
          <CardContent>
            {card.matches === null ? (
              <p className="text-xs text-slate-400 m-0">No queue — this playbook has no automatic trigger.</p>
            ) : card.matches.length === 0 ? (
              <p className="text-xs text-slate-400 m-0">No accounts currently match.</p>
            ) : (
              <div className="space-y-2">
                {card.matches.slice(0, 8).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onOpenAccount(a.id)}
                    className="w-full flex items-center justify-between gap-2 text-left text-sm px-3 py-2 rounded-lg border border-slate-100 hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-700">{a.name}</span>
                    <Badge variant={tierVariant(a.health.displayed_tier)}>{a.health.displayed_tier}</Badge>
                  </button>
                ))}
                {card.matches.length > 8 && (
                  <p className="text-xs text-slate-400 m-0">+ {card.matches.length - 8} more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
