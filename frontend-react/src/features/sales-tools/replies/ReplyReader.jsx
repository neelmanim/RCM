import React, { useEffect, useState, useCallback } from 'react';
import { ExternalLink, Mail, MailOpen, Download, AlertTriangle } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Skeleton, SkeletonText } from '../../../components/ui/Skeleton';
import { InstantlyInboxService } from '../../../services/api';
import { fmtDateTime } from '../../lead-detail-hub/lib/formatDate';
import { errorMessage } from '../../../utils/errorMessage';

function ThreadMessage({ m }) {
  return (
    <div className="border border-slate-100 rounded-lg px-3 py-2 bg-slate-50">
      <div className="text-xs text-slate-500 mb-1">
        {m.direction === 'outbound' ? 'Sent' : 'Received'} · {m.from_email} → {m.to_email} · {fmtDateTime(m.timestamp)}
      </div>
      {m.subject && <div className="text-xs font-semibold text-slate-700 mb-1">{m.subject}</div>}
      <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{m.body}</div>
    </div>
  );
}

/** Reading pane. `item` is the list row (shown instantly); the full body and
 * earlier thread load from GET /instantly/replies/{id}. Plain text only. */
export function ReplyReader({ item, onToggleRead, onExport }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setDetail(null);
    InstantlyInboxService.reply(item.id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.id, attempt]);

  const thread = detail?.thread || [];

  return (
    <Card className="p-5 hover:shadow-sm" aria-label="Reply reader">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-slate-900 m-0 break-words">{item.subject || '(no subject)'}</h2>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => onToggleRead(item)}>
            {item.unread ? <MailOpen size={14} /> : <Mail size={14} />}
            {item.unread ? 'Mark read' : 'Mark unread'}
          </Button>
          {onExport && <Button size="sm" variant="outline" onClick={onExport}><Download size={14} /> Export page as CSV</Button>}
          <Button size="sm" onClick={() => window._loadView?.('lead-detail', item.lead_id)}>
            <ExternalLink size={14} /> Open lead
          </Button>
        </div>
      </div>

      <div className="mt-2 text-sm text-slate-600">
        <span className="font-semibold text-slate-800">{item.lead_name}</span>
        {item.lead_company ? ` · ${item.lead_company}` : ''}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        {item.from_email}{item.mailbox ? ` → ${item.mailbox}` : ''} · {fmtDateTime(item.timestamp)}
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-2">
        {item.journey_name && <Badge variant="info">{item.journey_name}</Badge>}
        {item.step != null && <Badge>{`Step ${item.step}`}</Badge>}
        {item.intent_label && <Badge variant={item.positive ? 'success' : 'default'}>{item.intent_label}</Badge>}
        {item.is_auto_reply && <Badge variant="warning">Out of office</Badge>}
        {item.rep_name && <span className="text-xs text-slate-400">Rep: {item.rep_name}</span>}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        {loading && <div role="status" aria-label="Loading message"><SkeletonText lines={5} /><Skeleton className="h-3.5 w-1/3 mt-3" /></div>}
        {error && (
          <div role="alert" className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 text-xs font-semibold">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">Couldn't load this message: {error}</span>
            <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
          </div>
        )}
        {detail && (
          <>
            {thread.length > 0 && (
              <details className="mb-3">
                <summary className="text-xs font-semibold text-slate-500 cursor-pointer">
                  {thread.length} earlier message{thread.length === 1 ? '' : 's'} in this thread
                </summary>
                <div className="mt-2 space-y-2">{thread.map((m) => <ThreadMessage key={m.id} m={m} />)}</div>
              </details>
            )}
            <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{detail.body || '(empty message)'}</div>
          </>
        )}
      </div>
    </Card>
  );
}
