import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Switch } from '../../../components/ui/Switch';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SkeletonCard } from '../../../components/ui/Skeleton';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { CallsService, SettingsService } from '../../../services/api';

// ── Call Outcomes Configuration — settings_sync.js renderCallOutcomesConfig(), 288-559 ──
// Legacy only ever supported enable/disable, editing group+action+notes on
// custom outcomes, adding a custom outcome, and one bulk save — there is no
// delete or reorder anywhere in that function (confirmed by reading it in
// full), so none is added here either.
const GROUP_OPTIONS = [
  { value: 'answered', label: 'Answered' },
  { value: 'not_answered', label: 'Not Answered' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'demo', label: 'Demo' },
];
const ACTION_OPTIONS = [
  { value: 'none', label: '— None' },
  { value: 'disqualify', label: 'Auto-Disqualify' },
  { value: 'meeting_scheduled', label: '→ Meeting Scheduled' },
  { value: 'meeting_complete', label: '→ Meeting Complete' },
  { value: 'pending_review', label: '→ Pending Review' },
];
const GROUP_BADGE_VARIANT = { answered: 'success', not_answered: 'default', terminal: 'danger', demo: 'info' };
const ACTION_BADGE_VARIANT = { disqualify: 'danger', meeting_scheduled: 'success', meeting_complete: 'success', pending_review: 'warning', none: 'default' };

export function CallOutcomesCard() {
  const [outcomes, setOutcomes] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newGroup, setNewGroup] = useState('terminal');
  const [newAction, setNewAction] = useState('none');
  const [formError, setFormError] = useState('');

  const load = () => {
    setError(null);
    CallsService.getCallOutcomes()
      .then((data) => setOutcomes(data.outcomes || []))
      .catch(() => setError('Failed to load outcomes.'));
  };
  useEffect(load, []);

  const updateField = (idx, field, val) => {
    setOutcomes((prev) => {
      const next = prev.map((o, i) => (i === idx ? { ...o, [field]: val } : o));
      // Group changed away from Terminal resets a disqualify action — same rule settings_sync.js applies.
      if (field === 'group' && val !== 'terminal' && next[idx].action === 'disqualify') {
        next[idx] = { ...next[idx], action: 'none' };
      }
      return next;
    });
  };

  const handleActionChange = (idx, val) => {
    setFormError('');
    if (val === 'disqualify' && outcomes[idx].group !== 'terminal') {
      setFormError('Auto-Disqualify action is only allowed for Terminal group outcomes.');
      return;
    }
    updateField(idx, 'action', val);
  };

  const handleAdd = () => {
    setFormError('');
    const value = newValue.trim();
    if (!value || value.length < 2 || value.length > 50) { setFormError('Outcome name must be 2-50 characters.'); return; }
    if (outcomes.some((o) => o.value.toLowerCase() === value.toLowerCase())) { setFormError('An outcome with this name already exists.'); return; }
    if (newAction === 'disqualify' && newGroup !== 'terminal') { setFormError('Auto-Disqualify is only allowed for Terminal group.'); return; }
    setOutcomes((prev) => [...prev, { value, group: newGroup, action: newAction, notes_required: false, builtin: false, enabled: true }]);
    setNewValue('');
    setNewGroup('terminal');
    setNewAction('none');
  };

  const [confirmSave, setConfirmSave] = useState(false);
  const handleSave = async () => {
    setConfirmSave(false);
    setSaving(true);
    setStatus('');
    try {
      await SettingsService.patchSyncSettings({ outcome_config: outcomes });
      setStatus('Saved successfully!');
      const fresh = await CallsService.getCallOutcomes();
      setOutcomes(fresh.outcomes || []);
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(err.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <Card>
        <CardHeader title="Call Outcomes Configuration" />
        <CardContent><p className="text-sm text-red-600">{error}</p></CardContent>
      </Card>
    );
  }
  if (outcomes === null) return <SkeletonCard />;

  const customCount = outcomes.filter((o) => o.builtin === false).length;

  return (
    <Card>
      <CardHeader
        title="Call Outcomes Configuration"
        subtitle="Configure which outcomes SDRs can log and what happens when they do"
      />
      <CardContent>
        {outcomes.length === 0 ? (
          <p className="text-sm text-slate-400">No outcomes configured.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader className="text-center">Enabled</TableHeader>
                <TableHeader>Outcome</TableHeader>
                <TableHeader>Group</TableHeader>
                <TableHeader>Action</TableHeader>
                <TableHeader className="text-center">Notes Req.</TableHeader>
                <TableHeader className="text-center">Type</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {outcomes.map((o, idx) => {
                const isBuiltin = o.builtin !== false;
                return (
                  <TableRow key={o.value} className={!o.enabled ? 'opacity-50' : ''}>
                    <TableCell className="text-center">
                      <Switch checked={!!o.enabled} onChange={(e) => updateField(idx, 'enabled', e.target.checked)} />
                    </TableCell>
                    <TableCell className="font-medium text-slate-900 whitespace-normal">
                      {o.value}
                      {!isBuiltin && <span className="text-[10px] text-purple-400 ml-1.5">✦ custom</span>}
                    </TableCell>
                    <TableCell>
                      {isBuiltin
                        ? <Badge variant={GROUP_BADGE_VARIANT[o.group] || 'default'}>{GROUP_OPTIONS.find((g) => g.value === o.group)?.label || o.group}</Badge>
                        : <Select ariaLabel="Group" value={o.group} onChange={(v) => updateField(idx, 'group', v)} options={GROUP_OPTIONS} />}
                    </TableCell>
                    <TableCell>
                      {isBuiltin
                        ? <Badge variant={ACTION_BADGE_VARIANT[o.action] || 'default'}>{ACTION_OPTIONS.find((a) => a.value === o.action)?.label || '— None'}</Badge>
                        : <Select ariaLabel="Action" value={o.action} onChange={(v) => handleActionChange(idx, v)} options={ACTION_OPTIONS} />}
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox checked={!!o.notes_required} onChange={(e) => updateField(idx, 'notes_required', e.target.checked)} />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`text-[10px] ${isBuiltin ? 'text-slate-400' : 'text-purple-600 font-semibold'}`}>{isBuiltin ? 'built-in' : 'custom'}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {formError && <p className="text-xs text-red-700 bg-red-50 rounded-lg p-2.5 mt-3" role="alert">{formError}</p>}

        {customCount < 10 && (
          <div className="mt-4 p-4 rounded-xl border border-dashed border-purple-200 bg-purple-50/50">
            <div className="flex gap-3 items-end flex-wrap">
              <Input
                containerClassName="flex-1 min-w-[180px] mb-0"
                label="Outcome Name"
                placeholder="e.g. Budget Freeze"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Group</label>
                <Select ariaLabel="New outcome group" value={newGroup} onChange={setNewGroup} options={GROUP_OPTIONS} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Action</label>
                <Select ariaLabel="New outcome action" value={newAction} onChange={setNewAction} options={ACTION_OPTIONS} />
              </div>
              <Button size="sm" onClick={handleAdd}><Plus size={14} /> Add Outcome</Button>
            </div>
            <p className="text-[10px] text-purple-400 mt-2">{customCount}/10 custom outcomes used</p>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => setConfirmSave(true)} disabled={saving}>{saving ? 'Saving…' : 'Save Outcomes Configuration'}</Button>
          <span className="text-xs text-slate-500">{status}</span>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmSave}
        onClose={() => setConfirmSave(false)}
        title="Save the call outcomes?"
        message="Every SDR sees these outcomes from their next call, and the actions you set (such as Auto-Disqualify or Meeting Scheduled) change lead statuses automatically."
        confirmLabel="Save Outcomes"
        onConfirm={handleSave}
      />
    </Card>
  );
}
