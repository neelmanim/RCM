import React from 'react';
import { ExpandRowFooter } from './ExpandRowFooter';
import { stripHtml } from '../lib/format';

export function EmailExpandRow({ email, onOpenLead, onCollapse }) {
  return (
    <div className="p-4">
      <div className="mb-2 text-sm break-words">
        <span className="text-slate-400">From:</span> {email.from_email || '—'}
        <span className="mx-2 text-slate-300">→</span>
        <span className="text-slate-400">To:</span> {email.to_email || '—'}
      </div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Subject</div>
      <div className="mb-3 text-sm font-semibold text-slate-800 break-words">{email.subject || '(no subject)'}</div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Body preview</div>
      <div className="text-sm text-slate-700 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
        {email.body_preview ? stripHtml(email.body_preview) : <span className="italic text-slate-400">No preview available</span>}
      </div>
      <ExpandRowFooter
        pills={[
          email.opened_at && <span key="opened" className="px-2 py-1 bg-slate-100 rounded">First opened: {new Date(email.opened_at).toLocaleString()}</span>,
          email.is_auto_reply && <span key="auto" className="px-2 py-1 bg-amber-100 text-amber-700 rounded">Auto-reply</span>,
        ]}
        leadId={email.lead_id}
        onOpenLead={onOpenLead}
        onCollapse={onCollapse}
      />
    </div>
  );
}
