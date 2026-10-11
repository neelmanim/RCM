import React, { useState } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Switch } from '../../../components/ui/Switch';
import { SettingRow } from '../../../components/ui/SettingRow';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { SettingsService } from '../../../services/api';
import { toast, errorText } from '../notify';

const NUMBERS = [
  { key: 'max_call_attempts', label: 'Call attempts before a warning', min: 1, def: 5,
    description: 'SDRs are warned after this many No Answer or Voicemail calls on one lead.' },
  { key: 'min_call_attempts_for_unreachable', label: 'Attempts before a lead can be Unreachable', min: 1, def: 3,
    description: 'The fewest calls a lead needs before it can be marked Unreachable.' },
  { key: 'terminal_lead_cooldown_days', label: 'Days before a closed lead can be worked again', min: 0, def: 30,
    description: 'How long a Disqualified, Declined or Unreachable lead stays out of calling queues.' },
  { key: 'conversation_min_seconds', label: 'Seconds that make a call a conversation', min: 1, def: 120,
    description: 'A call this long counts as a conversation in every report. Changing it changes reported numbers.' },
];

/** The team-wide rules that are not about Salesforce: who may be in several pods, and the call limits that drive warnings,
 *  statuses and report numbers. The pod switch applies after a confirmation; the numbers are one form with one Save. */
export function RulesCard({ syncSettings, onChanged }) {
  const s = syncSettings || {};
  const initial = Object.fromEntries(NUMBERS.map((n) => [n.key, String(s[n.key] ?? n.def)]));
  const [multiPod, setMultiPod] = useState(!!s.allow_multi_pod_sdr);
  const [podBusy, setPodBusy] = useState(false);
  const [podError, setPodError] = useState('');
  const [confirmPod, setConfirmPod] = useState(false);
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const setPod = async (next) => {
    setConfirmPod(false);
    setPodBusy(true);
    setPodError('');
    setMultiPod(next);
    try {
      await SettingsService.patchSyncSettings({ allow_multi_pod_sdr: next });
      toast('Saved');
      await onChanged?.();
    } catch (e) {
      setMultiPod(!next);
      setPodError(errorText(e, 'Could not save — nothing was changed.'));
    } finally {
      setPodBusy(false);
    }
  };

  const changed = NUMBERS.filter((n) => draft[n.key] !== base[n.key]);
  const save = async () => {
    setConfirming(false);
    setSaving(true);
    setError('');
    try {
      await SettingsService.patchSyncSettings(Object.fromEntries(NUMBERS.map((n) => [n.key, parseInt(draft[n.key], 10) || 0])));
      setBase(draft);
      toast('Saved');
      await onChanged?.();
    } catch (e) {
      setError(errorText(e, 'Could not save — nothing was changed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Pod and Call Rules" subtitle="Rules that apply to every pod and every SDR." />
      <CardContent>
        <SettingRow
          label="Let an SDR belong to more than one pod"
          description={multiPod
            ? 'On: an SDR can be in several pods, and each of those pods\' admins can see them.'
            : 'Off: each SDR belongs to exactly one pod.'}
          danger={multiPod}
          status={podBusy ? 'Saving…' : podError}
          statusTone={podError ? 'error' : 'info'}
          control={<Switch checked={multiPod} disabled={podBusy} ariaLabel="Let an SDR belong to more than one pod"
            onChange={(e) => (e.target.checked ? setConfirmPod(true) : setPod(false))} />}
        />
        {NUMBERS.map((n) => (
          <SettingRow
            key={n.key}
            label={n.label}
            description={n.description}
            control={<Input aria-label={n.label} type="number" min={n.min} step="1" value={draft[n.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [n.key]: e.target.value }))} containerClassName="!mb-0 w-24" />}
          />
        ))}
        {error && <p className="text-xs text-red-700 bg-red-50 rounded-lg p-2.5 mt-3" role="alert">{error}</p>}
      </CardContent>
      <CardFooter>
        <Button size="sm" onClick={() => setConfirming(true)} disabled={saving || !changed.length}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(base)} disabled={saving || !changed.length}>Discard</Button>
        <span className="text-xs text-slate-500">{changed.length ? `${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}` : ''}</span>
      </CardFooter>

      <ConfirmDialog
        open={confirmPod}
        onClose={() => setConfirmPod(false)}
        title="Let SDRs belong to more than one pod?"
        message="An SDR in several pods is shown to the admins of each of those pods, so it widens who can see their leads and activity."
        confirmLabel="Allow"
        onConfirm={() => setPod(true)}
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Save these call rules?"
        message="They apply to every SDR straight away and can change lead statuses and report numbers:"
        confirmLabel="Save Changes"
        onConfirm={save}
      >
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
          {changed.map((n) => <li key={n.key}>{n.label}: {base[n.key]} → {draft[n.key]}</li>)}
        </ul>
      </ConfirmDialog>
    </Card>
  );
}
