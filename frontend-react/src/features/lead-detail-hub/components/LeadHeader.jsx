import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Select } from '../../../components/ui/Select';
import { formatLeadSource } from '../../../lib/leadSource';

// Icon shown only for the labels that have one — an uploaded/gsheet batch
// name or an unrecognized raw tag renders as plain text, matching how the
// leads table (columns.jsx) shows the same value, instead of being guessed
// as one of these four and mislabeled.
const SOURCE_ICONS = { Klenty: '📲', Salesforce: '☁️', Aircall: '📞', Manual: '✏️' };

function sourceLabel(leadSource) {
  const label = formatLeadSource(leadSource);
  const icon = SOURCE_ICONS[label];
  return icon ? `${icon} ${label}` : label;
}

export function LeadHeader({
  lead, navPosition, onPreviousLead, onNextLead, onBack, onOptOut, canModify,
  isAssignAdmin, assignableUsers = [], onReassign,
}) {
  const lockRef = useRef(false);
  const [reassigning, setReassigning] = useState(false);

  // Alt+←/→ shortcuts, ignored while focus is in a text field — mirrors the
  // legacy nav bar's exact guard (frontend/js/views/lead_detail.js).
  useEffect(() => {
    const handleKeydown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!e.altKey || lockRef.current) return;
      if (e.key === 'ArrowLeft' && onPreviousLead) { lockRef.current = true; onPreviousLead(); }
      if (e.key === 'ArrowRight' && onNextLead) { lockRef.current = true; onNextLead(); }
    };
    const unlock = () => { lockRef.current = false; };
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('keyup', unlock);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('keyup', unlock);
    };
  }, [onPreviousLead, onNextLead]);

  if (!lead) return null;
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Lead';

  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        {onBack && (
          <button type="button" onClick={onBack} className="text-xs text-slate-500 hover:text-slate-700 font-semibold mb-2">
            ← Back to Leads
          </button>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-extrabold text-slate-900 m-0">{name}</h1>
          <Badge>{sourceLabel(lead.lead_source)}</Badge>
          {lead.do_not_contact && <Badge variant="danger">Opted Out</Badge>}
        </div>
        <p className="text-sm text-slate-500 mt-1">
          {[lead.company, lead.title].filter(Boolean).join(' · ') || '—'}
        </p>
        {isAssignAdmin ? (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-slate-400">Assigned to</span>
            <Select
              ariaLabel="Change lead assignment"
              value={lead.assigned_to?.[0]?.id || ''}
              options={[{ label: 'Unassigned', value: '' }, ...assignableUsers.map((u) => ({ label: u.name, value: u.id }))]}
              onChange={async (userId) => {
                setReassigning(true);
                await onReassign?.(userId || null);
                setReassigning(false);
              }}
              searchable
            >
              <span className={`flex items-center gap-0.5 text-xs font-semibold ${reassigning ? 'text-slate-400' : 'text-slate-600 hover:text-slate-900'}`}>
                {reassigning ? 'Updating…' : (lead.assigned_to_name || 'Unassigned')}
                <ChevronDown size={12} />
              </span>
            </Select>
          </div>
        ) : (
          <p className="text-xs text-slate-400 mt-0.5">
            Assigned to {lead.assigned_to_name || 'Unassigned'}
            {!canModify && ' · Read-only — assigned to another pod'}
          </p>
        )}
        {(lead.sf_lead_url || lead.sf_opportunity_url) && (
          <p className="text-xs mt-1 flex gap-3">
            {lead.sf_lead_url && (
              <a href={lead.sf_lead_url} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-2">SF Lead</a>
            )}
            {lead.sf_opportunity_url && (
              <a href={lead.sf_opportunity_url} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-2">SF Opportunity</a>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {navPosition && (
          <div className="flex items-center gap-1 text-xs font-bold text-slate-500 tabular-nums">
            <button type="button" onClick={onPreviousLead} disabled={!onPreviousLead}
              aria-label="Previous lead"
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronLeft size={16} />
            </button>
            <span>{navPosition}</span>
            <button type="button" onClick={onNextLead} disabled={!onNextLead}
              aria-label="Next lead"
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
        {canModify && !lead.do_not_contact && onOptOut && (
          <button type="button" onClick={onOptOut} className="text-xs font-semibold text-red-500 hover:text-red-700">
            Mark Opted Out
          </button>
        )}
      </div>
    </div>
  );
}
