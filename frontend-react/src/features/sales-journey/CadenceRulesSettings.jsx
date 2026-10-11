import React, { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { Checkbox } from '../../components/ui/Checkbox';
import { SalesJourneyService } from '../../services/api';
import { toast } from './toast';

const SEND_AS_OPTIONS = [
  { value: 'assigned_rep', label: "The lead's assigned rep (falls back to the owner)" },
  { value: 'owner', label: 'The cadence owner' },
];

const numberInput = 'w-16 px-2 py-1 rounded-md text-sm border border-slate-200 bg-white outline-none focus:border-blue-500';

/** v13.0.0 — the cadence-wide rules from the two-cadence playbook: stop on a
 *  reply or a booked meeting, a hard length limit ("stops at Day 15"), the
 *  60-day re-engagement task, and who messages go out as. Sibling of
 *  SendWindowSettings; both PATCH the same /journeys/{id} settings. */
export function CadenceRulesSettings({ journeyId, journey, onSaved }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm({
      stop_on_reply: !!journey.stop_on_reply,
      stop_on_meeting: !!journey.stop_on_meeting,
      limitOn: journey.max_duration_days != null,
      max_duration_days: journey.max_duration_days ?? 15,
      reengageOn: journey.reengage_after_days != null,
      reengage_after_days: journey.reengage_after_days ?? 60,
      reengage_min_opens: journey.reengage_min_opens ?? 2,
      allow_reenroll: journey.allow_reenroll !== false,
      cooloffOn: journey.reenroll_cooloff_days != null,
      reenroll_cooloff_days: journey.reenroll_cooloff_days ?? 30,
      send_as: journey.send_as || 'owner',
      vertical: journey.vertical || '',
    });
  }, [open, journey]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const int = (v) => Math.max(1, parseInt(v, 10) || 1);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await SalesJourneyService.updateSettings(journeyId, {
        stop_on_reply: form.stop_on_reply,
        stop_on_meeting: form.stop_on_meeting,
        max_duration_days: form.limitOn ? form.max_duration_days : null,
        reengage_after_days: form.reengageOn ? form.reengage_after_days : null,
        reengage_min_opens: form.reengageOn ? form.reengage_min_opens : null,
        allow_reenroll: form.allow_reenroll,
        reenroll_cooloff_days: form.allow_reenroll && form.cooloffOn ? form.reenroll_cooloff_days : null,
        send_as: form.send_as,
        vertical: form.vertical.trim(),
      });
      onSaved(result);
      toast('Cadence rules saved.', 'success');
      setOpen(false);
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to save — please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const summary = [
    journey.stop_on_reply && 'stop on reply',
    journey.max_duration_days && `${journey.max_duration_days}d max`,
  ].filter(Boolean).join(' · ') || 'Rules';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs border border-slate-200 rounded-md px-1.5 py-1 text-slate-600 bg-white hover:bg-slate-50"
        title="When this cadence stops, how long it runs, and who messages go out as"
      >
        <ShieldCheck size={12} /> {summary}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Cadence Rules" maxWidth="max-w-md">
        <div className="space-y-4 text-sm">
          <div>
            <div className="font-medium text-slate-700 mb-2">Stop the cadence for a lead when…</div>
            <Checkbox className="mb-1.5" checked={!!form.stop_on_reply}
              onChange={(e) => set({ stop_on_reply: e.target.checked })}
              label="they reply — email, SMS or WhatsApp (out-of-office doesn't count)" />
            <Checkbox checked={!!form.stop_on_meeting}
              onChange={(e) => set({ stop_on_meeting: e.target.checked })}
              label="a meeting is booked (Meeting Scheduled or later)" />
          </div>

          <div>
            <Checkbox className="font-medium text-slate-700 mb-1.5" checked={!!form.limitOn}
              onChange={(e) => set({ limitOn: e.target.checked })} label="Maximum length" />
            {form.limitOn && (
              <div className="flex items-center gap-2 text-slate-600 pl-6">
                End every lead's cadence
                <input type="number" min="1" max="365" aria-label="Maximum days" className={numberInput}
                  value={form.max_duration_days} onChange={(e) => set({ max_duration_days: int(e.target.value) })} />
                days after they join, whatever happened.
              </div>
            )}
          </div>

          <div>
            <Checkbox className="font-medium text-slate-700 mb-1.5" checked={!!form.reengageOn}
              onChange={(e) => set({ reengageOn: e.target.checked })} label="Re-engagement follow-up" />
            {form.reengageOn && (
              <div className="text-slate-600 pl-6 leading-7">
                When a lead's cadence ends and they replied or opened
                <input type="number" min="1" max="20" aria-label="Minimum opened emails" className={`${numberInput} mx-1.5`}
                  value={form.reengage_min_opens} onChange={(e) => set({ reengage_min_opens: int(e.target.value) })} />
                or more emails, give their rep a "Re-engage" task
                <input type="number" min="1" max="365" aria-label="Re-engage after days" className={`${numberInput} mx-1.5`}
                  value={form.reengage_after_days} onChange={(e) => set({ reengage_after_days: int(e.target.value) })} />
                days later. Not when a meeting was booked.
              </div>
            )}
          </div>

          <div>
            <Checkbox className="font-medium text-slate-700 mb-1.5" checked={!!form.allow_reenroll}
              onChange={(e) => set({ allow_reenroll: e.target.checked })} label="Allow re-enrollment" />
            <p className="text-xs text-slate-400 pl-6 -mt-0.5 mb-1.5">
              Off: a lead that already finished, was stopped or paused in this cadence can't join it again
              — by a status trigger or by hand.
            </p>
            {form.allow_reenroll && (
              <div className="pl-6">
                <Checkbox checked={!!form.cooloffOn} onChange={(e) => set({ cooloffOn: e.target.checked })}
                  label="Wait before a lead can join again" />
                {form.cooloffOn && (
                  <div className="flex items-center gap-2 text-slate-600 pl-6 mt-1">
                    At least
                    <input type="number" min="1" max="365" aria-label="Re-enrollment wait days" className={numberInput}
                      value={form.reenroll_cooloff_days} onChange={(e) => set({ reenroll_cooloff_days: int(e.target.value) })} />
                    days after their last run.
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="font-medium text-slate-700 mb-1">Vertical (optional)</div>
            <input type="text" aria-label="Vertical" placeholder="e.g. Sales/BD, Patient Ops"
              className="w-full px-2.5 py-1.5 rounded-md text-sm border border-slate-200 bg-white outline-none focus:border-blue-500"
              value={form.vertical} onChange={(e) => set({ vertical: e.target.value })} />
            <p className="text-xs text-slate-400 mt-1">
              If set, enrolling a lead tagged with a different vertical shows a warning (not a block).
            </p>
          </div>

          <div>
            <div className="font-medium text-slate-700 mb-1">Emails and texts go out as</div>
            <Select className="w-full justify-between" ariaLabel="Emails and texts go out as" value={form.send_as}
              onChange={(v) => set({ send_as: v })} options={SEND_AS_OPTIONS} />
            <p className="text-xs text-slate-400 mt-1">
              {'{{rep_name}}'} is always the lead's rep; {'{{sender_name}}'} is whoever actually sent it.
            </p>
          </div>
        </div>

        <Button className="w-full mt-5" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Modal>
    </>
  );
}
