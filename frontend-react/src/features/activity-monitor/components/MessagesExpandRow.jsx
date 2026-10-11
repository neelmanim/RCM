import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ExpandRowFooter } from './ExpandRowFooter';

export function MessagesExpandRow({ message, onOpenLead, onCollapse }) {
  return (
    <div className="p-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Message</div>
      <div className="mb-3 text-sm text-slate-700 whitespace-pre-wrap break-words">
        {message.message_text || <span className="italic text-slate-400">No content</span>}
      </div>
      {message.failure_reason && (
        <div className="mb-3 flex items-center gap-1.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 break-words">
          <AlertTriangle size={14} className="shrink-0" />
          {message.failure_reason}
        </div>
      )}
      <ExpandRowFooter
        className="flex items-center justify-between pt-3 border-t border-slate-200"
        pills={[
          <span key="phone" className="px-2 py-1 bg-slate-100 rounded">{message.phone_number || '—'}</span>,
          message.provider && <span key="provider" className="px-2 py-1 bg-slate-100 rounded">Provider: {message.provider}</span>,
          message.conversation_id && <span key="thread" className="px-2 py-1 bg-slate-100 rounded">Thread: {message.conversation_id}</span>,
        ]}
        leadId={message.lead_id}
        onOpenLead={onOpenLead}
        onCollapse={onCollapse}
      />
    </div>
  );
}
