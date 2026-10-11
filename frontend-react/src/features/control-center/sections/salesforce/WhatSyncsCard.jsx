import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from '../../../../components/ui/Card';
import { Select } from '../../../../components/ui/Select';
import { Switch } from '../../../../components/ui/Switch';
import { SettingRow } from '../../../../components/ui/SettingRow';
import { ConfirmDialog } from '../../../../components/ui/Modal';
import { SettingsService } from '../../../../services/api';
import { toast, errorText } from '../../notify';
import { PIPELINE_STAGES } from './stages';

const Heading = ({ children }) => <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 pt-5 pb-1 first:pt-0">{children}</h3>;

/**
 * Everything that decides what moves between Alternate CRM and Salesforce, in one place: which direction leads flow, at which
 * stage they are sent, which closing outcomes are sent, and what happens with opportunities. Rule for the whole tab:
 * a switch applies at once; anything that makes Salesforce write to Alternate CRM, or Alternate CRM write to Salesforce, asks first.
 * Turning something OFF never asks — it only ever reduces what moves.
 */
export function WhatSyncsCard({ syncSettings, onChanged }) {
  const s = syncSettings || {};
  const [vals, setVals] = useState({
    twoWay: (s.sync_direction || 'push_only') === 'both',
    stage: s.sf_push_stage || 'Meeting Scheduled',
    declined: !!s.sync_declined_to_salesforce,
    unreachable: !!s.sync_unreachable_to_salesforce,
    oppPull: (s.opportunity_sync_direction || 'push_only') === 'both',
    writeback: !!s.opportunity_writeback_enabled,
  });
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(null);

  // change = { id, next (value for vals[id]), patch (settings body), confirm?: { title, message, confirmLabel } }
  const apply = async ({ id, next, patch }) => {
    const prev = vals[id];
    setVals((v) => ({ ...v, [id]: next }));
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: '' }));
    try {
      await SettingsService.patchSyncSettings(patch);
      toast('Saved');
      await onChanged?.();
    } catch (e) {
      setVals((v) => ({ ...v, [id]: prev }));
      setErrors((x) => ({ ...x, [id]: errorText(e, 'Could not save — nothing was changed.') }));
    } finally {
      setBusy('');
    }
  };
  const request = (change) => (change.confirm ? setPending(change) : apply(change));
  const toggle = (id, patchFor, confirm) => (e) => {
    const next = e.target.checked;
    request({ id, next, patch: patchFor(next), confirm: next ? confirm : undefined });
  };

  const row = (id, label, description, confirm, patchFor, { danger = false } = {}) => (
    <SettingRow
      label={label}
      description={description}
      danger={danger && vals[id]}
      status={busy === id ? 'Saving…' : errors[id]}
      statusTone={errors[id] ? 'error' : 'info'}
      control={<Switch checked={vals[id]} onChange={toggle(id, patchFor, confirm)} ariaLabel={label} disabled={!!busy} />}
    />
  );

  return (
    <Card data-tour="cc-sf-sync">
      <CardHeader title="What Syncs with Salesforce" subtitle="Switches apply straight away. Anything that writes data in either direction asks you to confirm first." />
      <CardContent>
        <Heading>Leads</Heading>
        {row('twoWay', 'Two-way lead sync',
          vals.twoWay
            ? 'On: changes made in Salesforce are pulled into Alternate CRM on every sync, and can overwrite fields on existing leads.'
            : 'Off: Alternate CRM sends changes to Salesforce; changes made in Salesforce are not pulled back.',
          { title: 'Turn on two-way lead sync?', confirmLabel: 'Turn On',
            message: 'On every sync, changes made in Salesforce will be pulled into Alternate CRM and can overwrite the matching fields on existing leads. Alternate CRM keeps sending its own changes to Salesforce as well.' },
          (on) => ({ sync_direction: on ? 'both' : 'push_only' }), { danger: true })}

        <SettingRow
          label="Send leads to Salesforce at stage"
          description="Leads in this stage are created or updated in Salesforce on each sync."
          status={busy === 'stage' ? 'Saving…' : errors.stage}
          statusTone={errors.stage ? 'error' : 'info'}
          control={(
            <Select ariaLabel="Send leads to Salesforce at stage" value={vals.stage} disabled={!!busy}
              onChange={(v) => v !== vals.stage && request({
                id: 'stage', next: v, patch: { sf_push_stage: v },
                confirm: { title: 'Change the stage that sends leads to Salesforce?', confirmLabel: 'Change Stage',
                  message: `From the next sync, leads in "${v}" are created or updated in Salesforce instead of leads in "${vals.stage}". Leads already sent stay in Salesforce as they are.` },
              })}
              options={PIPELINE_STAGES.map((st) => ({ value: st, label: st }))} />
          )}
        />

        {row('declined', 'Also send Customer Declined leads', 'Leads that end as Customer Declined are sent to Salesforce.',
          { title: 'Send Customer Declined leads to Salesforce?', confirmLabel: 'Turn On',
            message: 'Leads that end as Customer Declined will be sent to Salesforce from the next sync, and created there if they are not in Salesforce yet.' },
          (on) => ({ sync_declined_to_salesforce: on }))}

        {row('unreachable', 'Also send Unreachable leads', 'Leads that end as Unreachable are sent to Salesforce.',
          { title: 'Send Unreachable leads to Salesforce?', confirmLabel: 'Turn On',
            message: 'Leads that end as Unreachable will be sent to Salesforce from the next sync, and created there if they are not in Salesforce yet.' },
          (on) => ({ sync_unreachable_to_salesforce: on }))}

        <Heading>Opportunities and accounts (AE Pipeline, CSM Portal)</Heading>
        {row('oppPull', 'Read opportunities and accounts from Salesforce',
          vals.oppPull
            ? 'On: the scheduled sync also reads Opportunities and Accounts and creates or updates matching records in Alternate CRM. It never writes to Salesforce.'
            : 'Off: Alternate CRM never reads Opportunities or Accounts back from Salesforce.',
          { title: 'Read opportunities and accounts from Salesforce?', confirmLabel: 'Turn On',
            message: 'From the next scheduled sync (and any manual Sync Salesforce), Alternate CRM will read Opportunity and Account records and create or update the matching local records. Nothing is created, changed or deleted in Salesforce. These records show in the Sync Log as "Pulled from Salesforce".' },
          (on) => ({ opportunity_sync_direction: on ? 'both' : 'push_only' }))}

        {row('writeback', 'Send AE and CSM deal actions to Salesforce',
          vals.writeback
            ? 'On: closing a deal, changing its stage or close date, or creating a renewal also changes the record in Salesforce.'
            : 'Off: those actions stay in Alternate CRM only. Nothing reaches Salesforce until you turn this on.',
          { title: 'Send deal actions to Salesforce?', confirmLabel: 'Turn On',
            message: 'Closing a deal, changing its stage or close date, and creating a renewal in Alternate CRM will change the real record in Salesforce straight away. Check this on a sandbox first if you have not already.' },
          (on) => ({ opportunity_writeback_enabled: on }), { danger: true })}
      </CardContent>

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending?.confirm.title || ''}
        message={pending?.confirm.message || ''}
        confirmLabel={pending?.confirm.confirmLabel || 'Confirm'}
        onConfirm={() => { const c = pending; setPending(null); apply(c); }}
      />
    </Card>
  );
}
