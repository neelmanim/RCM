import React from 'react';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge } from '../../../components/ui/Badge';
import { timeAgo } from '../../activity-monitor/lib/format';

/** Keyboard model: ↑/↓ move the highlighted row, Enter opens it. */
export function ReplyList({ items, activeId, onActivate, onOpen }) {
  const onKeyDown = (e) => {
    const i = items.findIndex((r) => r.id === activeId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) onActivate(next);
    } else if (e.key === 'Enter' && i >= 0) {
      e.preventDefault();
      onOpen(items[i]);
    }
  };

  return (
    <ul role="listbox" aria-label="Replies" tabIndex={0} onKeyDown={onKeyDown} className="list-none m-0 p-0 divide-y divide-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-lg">
      {items.map((r) => (
        <li
          key={r.id}
          role="option"
          aria-selected={r.id === activeId}
          aria-label={`${r.unread ? 'Unread reply' : 'Reply'} from ${r.lead_name}: ${r.subject || 'no subject'}`}
          onClick={() => onOpen(r)}
          className={`flex gap-3 px-3 py-3 cursor-pointer hover:bg-slate-50 ${r.id === activeId ? 'bg-blue-50' : ''}`}
        >
          <Avatar name={r.lead_name} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {r.unread && <span data-testid="unread-dot" aria-hidden="true" className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />}
              <span className={`text-sm truncate ${r.unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>{r.lead_name}</span>
              <span className="text-xs text-slate-400 ml-auto shrink-0">{timeAgo(r.timestamp)}</span>
            </div>
            {r.lead_company && <div className="text-xs text-slate-500 truncate">{r.lead_company}</div>}
            <div className="text-sm text-slate-700 truncate">{r.subject || '(no subject)'}</div>
            <div className="text-xs text-slate-400 truncate">{r.snippet}</div>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {r.intent_label && <Badge variant={r.positive ? 'success' : 'default'}>{r.intent_label}</Badge>}
              {r.is_auto_reply && <Badge variant="warning">Out of office</Badge>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
