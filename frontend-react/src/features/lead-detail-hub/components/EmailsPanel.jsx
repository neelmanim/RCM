import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonText } from '../../../components/ui/Skeleton';
import { fmtDateTime } from '../lib/formatDate';
import { EmailsTour } from './EmailsTour';

// RCA 2026-09-29: the hub dropped classic's Emails tab — sent/received mail
// and its opens/clicks were invisible here. Clicking one opens the React
// EmailHub on that thread in place — no bounce to the classic view.
const SOURCE_LABEL = { cadence: 'Cadence', campaign: 'Campaign' };

function emailStats(emails) {
  const sent = emails.filter((e) => e.direction === 'outbound');
  const opened = sent.filter((e) => e.opened_at || e.open_count > 0).length;
  const clicked = sent.filter((e) => e.clicked_at || e.click_count > 0).length;
  const replied = emails.filter((e) => e.direction === 'inbound' && !e.is_auto_reply).length;
  const pct = (n) => (sent.length ? ` (${Math.round((n / sent.length) * 100)}%)` : '');
  return [
    ['Sent', String(sent.length)],
    ['Opened', `${opened}${pct(opened)}`],
    ['Clicked', `${clicked}${pct(clicked)}`],
    ['Replied', String(replied)],
  ];
}

// Emails are fetched once by useLeadDetail (so the activity feed can also
// include them — see normalizeActivity.js) and passed in here; this panel
// used to self-fetch via its own refreshKey prop, which started
// double-fetching once the hook needed the same data.
export function EmailsPanel({ emails = [], loading = false, error = false, onOpen }) {
  const [showAll, setShowAll] = useState(false);
  const newestFirst = [...emails].reverse();
  const shown = showAll ? newestFirst : newestFirst.slice(0, 5);

  return (
    <Card>
      <CardHeader
        title="Emails"
        actions={emails.length > 0 && onOpen && (
          <button type="button" onClick={() => onOpen(null)} className="text-xs text-slate-500 underline underline-offset-2">
            View all conversations
          </button>
        )}
      />
      <CardContent>
        {loading ? (
          <SkeletonText lines={3} />
        ) : error ? (
          <p className="text-sm text-red-600 m-0">Couldn't load emails.</p>
        ) : emails.length === 0 ? (
          <EmptyState title="No emails with this lead yet." />
        ) : (
          <>
            <EmailsTour />
            <div data-tour="emails-stats" className="grid grid-cols-4 gap-2 mb-3">
              {emailStats(emails).map(([label, value]) => (
                <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 m-0">{label}</p>
                  <p className="text-sm font-semibold text-slate-800 m-0">{value}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {shown.map((e, i) => (
                <button
                  data-tour={i === 0 ? 'emails-row' : undefined}
                  type="button"
                  key={e.id}
                  onClick={() => onOpen?.(e.id)}
                  className="block w-full text-left text-sm border-t border-slate-50 pt-2 first:border-0 first:pt-0 hover:bg-slate-50 rounded"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-slate-700 m-0 truncate">
                      <span className="text-slate-400">{e.direction === 'outbound' ? '↗ ' : '↙ '}</span>
                      {e.subject || '(no subject)'}
                    </p>
                    <span className="flex gap-1 shrink-0 text-[11px]">
                      {SOURCE_LABEL[e.source] && <span className="px-1.5 rounded bg-indigo-50 text-indigo-600">{SOURCE_LABEL[e.source]}</span>}
                      {e.direction === 'outbound' && e.open_count > 0 && <span className="px-1.5 rounded bg-emerald-50 text-emerald-700">Opened ×{e.open_count}</span>}
                      {e.direction === 'outbound' && e.click_count > 0 && <span className="px-1.5 rounded bg-sky-50 text-sky-700">Clicked ×{e.click_count}</span>}
                      {e.is_auto_reply && <span className="px-1.5 rounded bg-slate-100 text-slate-500">Auto-reply</span>}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 m-0">
                    {fmtDateTime(e.timestamp)} · {e.direction === 'outbound' ? `from ${e.user_name || e.from_email || '—'}` : `from ${e.from_email || 'lead'}`}
                  </p>
                </button>
              ))}
            </div>
            {newestFirst.length > 5 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-slate-500 underline underline-offset-2">
                {showAll ? 'Show fewer' : `Show all ${newestFirst.length}`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
