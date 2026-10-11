import React, { useState, useEffect } from 'react';
import { Phone, Mail, ExternalLink, Pencil, Check, X, Building2, Briefcase, Tag } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { getPhoneTimezone } from '../../../../../frontend/js/phone_timezone.js';
import { LeadsService } from '../../../services/api';

function TimezoneBadge({ phone }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const tz = getPhoneTimezone(phone);
  if (!tz) return null;
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz.tz }).format(now);
  return (
    <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap" title={tz.tz}>
      🕐 {time} {tz.label}
    </span>
  );
}

// Click-to-edit — legacy has this ungated (a real gap); gated here behind
// canModify as defense-in-depth, per the plan's explicit call-out.
//
// `trailing` renders extra content after the value (e.g. a timezone badge)
// and `onCall` renders a Call button — both stay visible once a value is
// set, unlike the pencil (hover-only). Previously phone/phone_secondary
// bypassed this component entirely once populated, which is why they
// couldn't be re-edited (RCA 2026-09-28) — every field now goes through
// the same component regardless of current value.
function EditableField({ icon: Icon, value, placeholder, canModify, onSave, trailing, onCall }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => { setDraft(value || ''); }, [value]);

  if (!canModify) {
    return value ? (
      <div className="flex items-center gap-2 text-slate-700">
        <Icon size={14} className="text-slate-400" /> {value} {trailing}
      </div>
    ) : null;
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-slate-400 flex-shrink-0" />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onSave(draft); setEditing(false); }
            if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); }
          }}
          className="flex-1 text-sm border border-slate-300 rounded-md px-2 py-1"
        />
        <button type="button" onClick={() => { onSave(draft); setEditing(false); }} className="text-emerald-600"><Check size={14} /></button>
        <button type="button" onClick={() => { setDraft(value || ''); setEditing(false); }} className="text-slate-400"><X size={14} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 text-slate-700 group">
      <span className="flex items-center gap-2 min-w-0">
        <Icon size={14} className="text-slate-400 flex-shrink-0" />
        <span className={value ? '' : 'text-slate-400 italic'}>{value || placeholder}</span>
        {trailing}
        <button type="button" onClick={() => setEditing(true)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600">
          <Pencil size={12} />
        </button>
      </span>
      {onCall && value && (
        <Button size="sm" variant="secondary" onClick={onCall}>Call</Button>
      )}
    </div>
  );
}

export function ContactCard({ lead, canModify, onCall }) {
  if (!lead) return null;

  const saveField = (field) => (newValue) => {
    if (newValue === (lead[field] || '')) return;
    LeadsService.updateLead(lead.id, { [field]: newValue }).catch(() => {
      window.dispatchEvent(new CustomEvent('alternate:toast', { detail: { message: `Failed to update ${field}`, type: 'error' } }));
    });
  };

  return (
    <Card>
      <CardHeader title="Contact" />
      <CardContent>
        <div className="space-y-2 text-sm">
          <EditableField
            icon={Phone} value={lead.phone} placeholder="Add phone" canModify={canModify}
            onSave={saveField('phone')}
            trailing={<>
              <TimezoneBadge phone={lead.phone} />
              {lead.phone_invalid_at && <Badge variant="danger">Wrong number</Badge>}
            </>}
            onCall={() => onCall?.(lead.phone)}
          />
          <EditableField
            icon={Phone} value={lead.phone_secondary} placeholder="Add secondary phone" canModify={canModify}
            onSave={saveField('phone_secondary')} trailing={<TimezoneBadge phone={lead.phone_secondary} />}
            onCall={() => onCall?.(lead.phone_secondary)}
          />
          <EditableField
            icon={Phone} value={lead.company_phone} placeholder="Add company phone" canModify={canModify}
            onSave={saveField('company_phone')} trailing={<TimezoneBadge phone={lead.company_phone} />}
            onCall={() => onCall?.(lead.company_phone)}
          />
          <EditableField icon={Mail} value={lead.email} placeholder="Add email" canModify={canModify} onSave={saveField('email')} />
          {(lead.linkedin_url || lead.person_linkedin) && (
            <a href={lead.linkedin_url || lead.person_linkedin} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 text-blue-600 hover:underline">
              <ExternalLink size={14} /> LinkedIn
            </a>
          )}
          <div className="pt-2 border-t border-slate-100 space-y-1">
            <EditableField icon={Building2} value={lead.company} placeholder="Add company" canModify={canModify} onSave={saveField('company')} />
            <EditableField icon={Briefcase} value={lead.title} placeholder="Add title" canModify={canModify} onSave={saveField('title')} />
            <EditableField icon={Tag} value={lead.vertical} placeholder="Add vertical" canModify={canModify} onSave={saveField('vertical')} />
          </div>
          {!lead.phone && !lead.phone_secondary && !lead.company_phone && !lead.email && !canModify && (
            <p className="text-slate-400 italic">No contact information on file.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
