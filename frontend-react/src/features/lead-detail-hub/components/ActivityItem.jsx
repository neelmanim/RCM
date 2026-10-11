import React, { useState } from 'react';
import { Phone, CheckSquare, StickyNote, Activity as ActivityIcon, Mail, ChevronDown, ChevronRight } from 'lucide-react';
import { IconButton } from '../../../components/ui/IconButton';
import { Badge } from '../../../components/ui/Badge';
import { fmtDateTime } from '../lib/formatDate';

const KIND_ICON = { call: Phone, task: CheckSquare, note: StickyNote, signal: ActivityIcon, email: Mail };

export function ActivityItem({ activity, onOpenClassicTab }) {
  const Icon = KIND_ICON[activity.kind] || ActivityIcon;
  // Recording playback / transcript / "Edit outcome" live in the classic
  // Calls tab's existing player — not rebuilt here, just deep-linked to,
  // same as the plan's Email/SMS reachability approach.
  const [expanded, setExpanded] = useState(false);
  const body = activity.kind === 'email' && activity.raw?.provider === 'instantly' ? activity.raw?.body_preview : null;
  const isDialerCall = activity.kind === 'call' && Boolean(activity.raw?.dialer_call_id);

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-50 last:border-0">
      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={13} className="text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-800 m-0">{activity.summary}</p>
          {activity.kind === 'call' && <Badge>{activity.providerLabel}</Badge>}
          {activity.kind === 'email' && activity.raw?.provider === 'instantly' && <Badge variant="info">Instantly</Badge>}
          {body && (
            <IconButton
              aria-expanded={expanded}
              aria-label={expanded ? 'Hide email body' : 'Show email body'}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </IconButton>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          {fmtDateTime(activity.ts)}{activity.actor ? ` · ${activity.actor}` : ''}
        </p>
        {body && expanded && (
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-700 whitespace-pre-wrap break-words">
            {body}
          </div>
        )}
        {activity.kind === 'call' && activity.raw?.notes && (
          <p className="text-xs text-slate-500 mt-1">{activity.raw.notes}</p>
        )}
        {isDialerCall && onOpenClassicTab && (
          <button
            type="button"
            onClick={() => onOpenClassicTab('calls')}
            className="text-xs text-blue-600 hover:underline mt-1"
          >
            {activity.raw?.recording_url ? '🎧 Play recording / edit outcome' : 'Edit outcome'} →
          </button>
        )}
      </div>
    </div>
  );
}
