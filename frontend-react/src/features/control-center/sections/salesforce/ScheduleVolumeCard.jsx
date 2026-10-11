import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Switch } from '../../../../components/ui/Switch';
import { TimePicker } from '../../../../components/ui/TimePicker';
import { SettingRow } from '../../../../components/ui/SettingRow';
import { RecordTypePicker } from './RecordTypePicker';
import { ConfirmDialog } from '../../../../components/ui/Modal';
import { SettingsService } from '../../../../services/api';
import { toast, errorText } from '../../notify';

const pad = (n) => String(n).padStart(2, '0');
const typeLabel = (set) => (set.size ? `${set.size} selected` : 'all types');
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * When the Salesforce sync runs and how much it reads: the daily auto-sync, the per-run lead limit, and which record types
 * are included. One form, one Save. Saving anything except "turn auto-sync off" first shows exactly what will change.
 */
export function ScheduleVolumeCard({ syncSettings, onChanged }) {
  const s = syncSettings || {};
  const [base, setBase] = useState(() => ({      // what is saved right now, kept locally so the diff stays right after a save
    auto: !!s.sf_auto_sync_enabled,
    time: s.sf_auto_sync_hour_utc != null ? `${pad(s.sf_auto_sync_hour_utc)}:${pad(s.sf_auto_sync_minute_utc || 0)}` : '02:00',
    limit: String(s.lead_limit ?? 1000),
    types: new Set(s.record_type_ids || []),
  }));
  const [draft, setDraft] = useState(base);
  const lastRun = s.sf_auto_sync_last_run_at ? new Date(s.sf_auto_sync_last_run_at).toLocaleString() : '';
  const [recordTypes, setRecordTypes] = useState(null);
  const [typesFailed, setTypesFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    SettingsService.getRecordTypes()
      .then((t) => setRecordTypes(Array.isArray(t) ? t : []))
      .catch(() => { setRecordTypes([]); setTypesFailed(true); });
  }, []);

  const changes = [];
  if (draft.auto !== base.auto) changes.push(`Run automatically every day: ${base.auto ? 'On' : 'Off'} → ${draft.auto ? `On, at ${draft.time} UTC` : 'Off'}`);
  else if (draft.auto && draft.time !== base.time) changes.push(`Daily run time: ${base.time} → ${draft.time} UTC`);
  if (draft.limit !== base.limit) changes.push(`Leads read per sync: ${base.limit} → ${draft.limit}${Number(draft.limit) === 0 ? ' (no limit)' : ''}`);
  if (!sameSet(draft.types, base.types)) changes.push(`Record types read: ${typeLabel(base.types)} → ${typeLabel(draft.types)}`);
  const onlyTurningOff = changes.length === 1 && base.auto && !draft.auto;

  const save = async () => {
    setConfirming(false);
    setSaving(true);
    setError('');
    const [hh, mm] = draft.time.split(':').map(Number);
    try {
      await SettingsService.patchSyncSettings({
        sf_auto_sync_enabled: draft.auto, sf_auto_sync_hour_utc: hh, sf_auto_sync_minute_utc: mm,
        lead_limit: parseInt(draft.limit, 10) || 0, record_type_ids: [...draft.types],
      });
      setBase(draft);
      toast('Saved');
      await onChanged?.();
    } catch (e) {
      setError(errorText(e, 'Could not save — nothing was changed.'));
    } finally {
      setSaving(false);
    }
  };
  const onSave = () => (onlyTurningOff ? save() : setConfirming(true));

  return (
    <Card>
      <CardHeader title="Schedule and Volume" subtitle="When the sync runs and how much it reads. Review your changes, then Save." />
      <CardContent>
        <SettingRow
          label="Run automatically every day"
          description={`Runs the same sync as the manual Sync button, once a day, at the time shown (UTC).${lastRun ? ` Last automatic run: ${lastRun}.` : ''}`}
          control={(
            <div className="flex items-center gap-3">
              <TimePicker ariaLabel="Daily run time" value={draft.time} onChange={(t) => setDraft((d) => ({ ...d, time: t }))} />
              <span className="text-xs text-slate-400">UTC</span>
              <Switch checked={draft.auto} onChange={(e) => setDraft((d) => ({ ...d, auto: e.target.checked }))} ariaLabel="Run automatically every day" />
            </div>
          )}
        />
        <SettingRow
          label="Leads read per sync"
          description="The most leads one sync run reads from Salesforce. 0 means no limit."
          control={<Input aria-label="Leads read per sync" type="number" min="0" step="100" value={draft.limit}
            onChange={(e) => setDraft((d) => ({ ...d, limit: e.target.value }))} containerClassName="!mb-0 w-28" />}
        />
        <SettingRow
          label="Record types to read"
          description="Tick the Salesforce record types to read. Leave all unticked to read every type."
        >
          <RecordTypePicker types={recordTypes} selected={draft.types} loadFailed={typesFailed}
            onChange={(types) => setDraft((d) => ({ ...d, types }))} />
        </SettingRow>
        {error && <p className="text-xs text-red-700 bg-red-50 rounded-lg p-2.5 mt-3" role="alert">{error}</p>}
      </CardContent>
      <CardFooter>
        <Button size="sm" onClick={onSave} disabled={saving || !changes.length}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(base)} disabled={saving || !changes.length}>Discard</Button>
        <span className="text-xs text-slate-500">{changes.length ? `${changes.length} unsaved ${changes.length === 1 ? 'change' : 'changes'}` : ''}</span>
      </CardFooter>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Save these sync changes?"
        message="This will change:"
        confirmLabel="Save Changes"
        onConfirm={save}
      >
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
      </ConfirmDialog>
    </Card>
  );
}
