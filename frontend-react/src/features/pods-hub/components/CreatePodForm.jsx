import React, { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { TIMEZONES } from '../constants';

const TIMEZONE_OPTIONS = TIMEZONES.map((tz) => ({ value: tz, label: tz }));

export function CreatePodForm({ eligibleAdmins, onCreate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [adminId, setAdminId] = useState('');
  const [timezone, setTimezone] = useState('');
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!name.trim()) { setError('Pod name is required'); return; }
    try {
      if (await onCreate(name.trim(), adminId, timezone) === false) return;   // the hook already toasted why
      setName(''); setAdminId(''); setTimezone(''); setError(null); setOpen(false);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to create POD');
    }
  };

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Create POD</Button>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <h3 className="text-sm font-bold text-slate-800 mb-4">Create New POD</h3>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Pod Name</label>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alpha Team"
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Initial Admin (optional)</label>
          <Select
            value={adminId}
            onChange={(v) => setAdminId(v)}
            options={eligibleAdmins.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
            placeholder="-- No admin yet --"
            searchable
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1" title="Used to bucket this team's Analytics by their own local day, not UTC.">Timezone (optional)</label>
          <Select
            value={timezone}
            onChange={(v) => setTimezone(v)}
            options={TIMEZONE_OPTIONS}
            placeholder="-- Default (UTC) --"
            searchable
            className="w-full"
          />
        </div>
        <Button onClick={submit}>Create</Button>
      </div>
    </div>
  );
}
