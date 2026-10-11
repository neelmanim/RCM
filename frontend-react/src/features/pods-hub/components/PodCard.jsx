import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { TIMEZONES } from '../constants';

const TIMEZONE_OPTIONS = TIMEZONES.map((tz) => ({ value: tz, label: tz }));

function TimezoneSelect({ value, onChange }) {
  return (
    <Select
      value={value || ''}
      onChange={onChange}
      options={TIMEZONE_OPTIONS}
      placeholder="-- Default (UTC) --"
      searchable
      className="flex-1 min-w-0"
    />
  );
}

/** One POD's admin/member management card — mirrors the classic views/pods.js card 1:1. */
export function PodCard({ pod, isSuperAdmin, eligibleAdmins, availableSdrs, onDelete, onSaveTimezone, onAddAdmin, onRemoveAdmin, onAddMember, onRemoveMember }) {
  const [timezone, setTimezone] = useState(pod.timezone || '');
  const [addAdminId, setAddAdminId] = useState('');
  const [addMemberId, setAddMemberId] = useState('');
  const [confirm, setConfirm] = useState(null); // { type: 'pod'|'admin'|'member', ...ids, label }
  const [busy, setBusy] = useState(false);

  const runConfirmed = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.type === 'pod') await onDelete(pod.id);
      else if (confirm.type === 'admin') await onRemoveAdmin(pod.id, confirm.userId);
      else if (confirm.type === 'member') await onRemoveMember(pod.id, confirm.userId);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-slate-800">{pod.name}</h3>
        <div className="flex items-center gap-2">
          <Badge variant="primary">{pod.member_count} members</Badge>
          {isSuperAdmin && (
            <button
              title="Delete POD"
              onClick={() => setConfirm({ type: 'pod', label: `Delete POD "${pod.name}"? Members will be unassigned.` })}
              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {isSuperAdmin && (
        <div className="flex items-center gap-2 mb-4">
          <label className="text-xs font-semibold text-slate-500 whitespace-nowrap" title="Used to bucket this team's Analytics by their own local day, not UTC.">Timezone</label>
          <TimezoneSelect value={timezone} onChange={setTimezone} />
          <Button size="sm" variant="outline" onClick={() => onSaveTimezone(pod.id, timezone)}>Save</Button>
        </div>
      )}

      <div className="mb-4 p-3 bg-slate-50 rounded-lg">
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">
          Pod Admins {pod.admins?.length > 0 && <span className="normal-case font-normal text-slate-700">({pod.admins.length})</span>}
        </div>
        {!pod.admins?.length
          ? <div className="text-sm text-slate-400 italic">No admins assigned</div>
          : pod.admins.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-2 py-1.5 bg-white rounded-lg mb-1">
              <div>
                <span className="font-semibold text-sm">{a.name}</span>
                <span className="text-xs text-slate-400 ml-1.5">{a.email}</span>
              </div>
              {isSuperAdmin && (
                <button
                  onClick={() => setConfirm({ type: 'admin', userId: a.id, label: `Remove ${a.name} as Pod Admin of this POD?\n\nIf this is their only pod, their role will revert to SDR.` })}
                  className="text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        {isSuperAdmin && (
          <div className="flex items-center gap-2 mt-2">
            <Select
              value={addAdminId}
              onChange={(v) => setAddAdminId(v)}
              options={eligibleAdmins.filter((u) => !pod.admins?.some((a) => a.id === u.id)).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
              placeholder="-- Add Pod Admin --"
              searchable
              className="flex-1 min-w-0"
            />
            <Button size="sm" variant="outline" onClick={() => { if (addAdminId) { onAddAdmin(pod.id, addAdminId); setAddAdminId(''); } }}>Add</Button>
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Members</div>
        {!pod.members?.length && <div className="text-sm text-slate-400 py-1">No members yet</div>}
        {pod.members?.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg mb-1.5">
            <div className="min-w-0 overflow-hidden">
              <span className="font-semibold text-sm">{m.name || m.email}</span>
              <span className="text-xs text-slate-400 ml-2">{m.role} · {m.assigned_leads} leads</span>
            </div>
            <button
              onClick={() => setConfirm({ type: 'member', userId: m.id, label: `Remove ${m.name} from this POD?` })}
              className="text-xs text-red-500 hover:underline flex-shrink-0"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2">
          <Select
            value={addMemberId}
            onChange={(v) => setAddMemberId(v)}
            options={availableSdrs.filter((s) => !pod.members?.some((m) => m.id === s.id)).map((s) => ({ value: s.id, label: `${s.name} (${s.email})` }))}
            placeholder="-- Add SDR / AE --"
            searchable
            className="flex-1 min-w-0"
          />
          <Button size="sm" variant="outline" onClick={() => { if (addMemberId) { onAddMember(pod.id, addMemberId); setAddMemberId(''); } }}>Add</Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Confirm"
        message={confirm?.label}
        confirmLabel="Confirm"
        confirmVariant="danger"
        onConfirm={runConfirmed}
        loading={busy}
      />
    </div>
  );
}
