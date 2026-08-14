import React, { useState, useEffect, useCallback } from 'react';
import { History, Mail, MessageSquareText, MessageSquareReply, MessageCircle, Eye, MousePointerClick } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { SalesJourneyService } from '../../services/api';
import { toast } from './toast';

const EVENT_META = {
  email_sent:        { icon: Mail, label: (e) => `Email sent to ${e.lead_name}` },
  email_reply:       { icon: MessageSquareReply, label: (e) => `${e.lead_name} replied` },
  email_auto_reply:  { icon: MessageSquareReply, label: (e) => `${e.lead_name} — auto-reply (out-of-office)` },
  sms_sent:          { icon: MessageSquareText, label: (e) => `SMS sent to ${e.lead_name}` },
  sms_reply:         { icon: MessageSquareReply, label: (e) => `${e.lead_name} replied via SMS` },
  whatsapp_sent:     { icon: MessageCircle, label: (e) => `WhatsApp sent to ${e.lead_name}` },
  whatsapp_reply:    { icon: MessageSquareReply, label: (e) => `${e.lead_name} replied via WhatsApp` },
};

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ActivityRow({ event }) {
  const meta = EVENT_META[event.type];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-slate-100 last:border-0">
      <Icon size={14} className="text-slate-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-700">{meta.label(event)}</span>
          {event.type === 'email_sent' && event.opened && (
            <span title="Opened" className="text-slate-400"><Eye size={12} /></span>
          )}
          {event.type === 'email_sent' && event.clicked && (
            <span title="Clicked a link" className="text-slate-400"><MousePointerClick size={12} /></span>
          )}
          {(event.type === 'sms_sent' || event.type === 'whatsapp_sent') && event.status === 'failed' && (
            <Badge variant="danger" className="text-[10px]">failed</Badge>
          )}
          {event.variant_key && <Badge variant="default" className="text-[10px]">Variant {event.variant_key}</Badge>}
        </div>
        {(event.subject || event.message) && (
          <div className="text-xs text-slate-400 truncate">{event.subject || event.message}</div>
        )}
      </div>
      <span className="text-xs text-slate-400 shrink-0">{formatWhen(event.at)}</span>
    </div>
  );
}

// v10.9.9 — a unified, chronological view across every channel a cadence
// touches (email + SMS today), the "unified inbox" concept Klenty ships —
// previously an admin had to check LeadEmailActivity and SmsLog separately
// with no shared timeline. Modal rather than an always-visible panel: the
// builder already stacks FailedEnrollmentsPanel + EngagementPanel below the
// canvas, and this is a deeper drill-down, not a glance-at-a-metric view.
export function ActivityPanel({ journeyId }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await SalesJourneyService.getActivity(journeyId));
    } catch (err) {
      toast('Failed to load activity.', 'error');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs border border-slate-200 rounded-md px-1.5 py-1 text-slate-600 bg-white hover:bg-slate-50"
        title="A unified, chronological feed of every email and SMS send/reply for this cadence"
      >
        <History size={12} /> Activity
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Cadence Activity" maxWidth="max-w-lg">
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No activity yet.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
            {events.map((e, i) => <ActivityRow key={i} event={e} />)}
          </div>
        )}
      </Modal>
    </>
  );
}
