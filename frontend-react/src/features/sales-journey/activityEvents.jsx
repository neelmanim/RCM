import React from 'react';
import { Mail, MessageSquareText, MessageSquareReply, MessageCircle, Eye, MousePointerClick } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';

// Shared with the old standalone ActivityPanel (retired in the v13.1.8
// reporting revamp — its global, un-correlated feed duplicated what the
// roster now shows per lead). Kept here since EnrollmentRosterPanel's
// per-lead expand row renders the exact same event shapes.
export const EVENT_META = {
  email_sent:        { icon: Mail, label: (e) => `Email sent to ${e.lead_name}` },
  email_reply:       { icon: MessageSquareReply, label: (e) => `${e.lead_name} replied` },
  email_auto_reply:  { icon: MessageSquareReply, label: (e) => `${e.lead_name} — auto-reply (out-of-office)` },
  sms_sent:          { icon: MessageSquareText, label: (e) => `SMS sent to ${e.lead_name}` },
  sms_reply:         { icon: MessageSquareReply, label: (e) => `${e.lead_name} replied via SMS` },
  whatsapp_sent:     { icon: MessageCircle, label: (e) => `WhatsApp sent to ${e.lead_name}` },
  whatsapp_reply:    { icon: MessageSquareReply, label: (e) => `${e.lead_name} replied via WhatsApp` },
};

export function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ActivityRow({ event }) {
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
