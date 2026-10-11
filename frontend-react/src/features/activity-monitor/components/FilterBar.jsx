import React, { useState, useEffect } from 'react';
import { Mic, Users, Phone, ArrowLeftRight, Target, MessageSquare, CircleDot } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { SearchInput } from '../../../components/ui/SearchInput';
import { DateRangePicker } from '../../../components/ui/DateRangePicker';
import { Select } from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import {
  PROVIDER_OPTIONS, DIRECTION_OPTIONS, OUTCOME_OPTIONS,
  MESSAGE_CHANNEL_OPTIONS, MESSAGE_STATUS_OPTIONS, EMPTY_FILTERS,
} from '../constants';

/**
 * Committed on Apply/Enter (search) or Reset — never live-as-you-type —
 * matching call_monitor.js's own explicit-apply UX. Channel-specific fields
 * (Provider/Direction/Outcome for calls;
 * direction for email; channel/status/direction for messages) are shown
 * conditionally, but the draft itself always resets on tab change so a
 * leftover Provider filter from Calls can't silently apply to Email.
 *
 * Every dropdown is the shared components/ui/Select, not a native <select> — a
 * plain select for a 20+ person SDR list rendered as an unstyled,
 * unsearchable OS dropdown that ran off-screen (flagged in review). The SDR
 * field passes `searchable` for that long list; the rest are short static
 * option sets with no search needed.
 */
export function FilterBar({ channel, sdrs, onApply }) {
  const [draft, setDraft] = useState(EMPTY_FILTERS);

  useEffect(() => { setDraft(EMPTY_FILTERS); }, [channel]);

  const set = (key) => (val) => setDraft((d) => ({ ...d, [key]: val }));

  const apply = () => onApply(draft);
  const reset = () => { setDraft(EMPTY_FILTERS); onApply(EMPTY_FILTERS); };

  const sdrOptions = [{ value: '', label: 'All SDRs' }, ...sdrs.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={draft.sdr_id} onChange={set('sdr_id')} options={sdrOptions} placeholder="All SDRs" icon={Users} searchable />

        {channel === 'calls' && (
          <>
            <Select value={draft.provider} onChange={set('provider')} options={PROVIDER_OPTIONS} placeholder="All Providers" icon={Phone} />
            <Select value={draft.direction} onChange={set('direction')} options={DIRECTION_OPTIONS} placeholder="All Directions" icon={ArrowLeftRight} />
            <Select value={draft.outcome} onChange={set('outcome')} options={OUTCOME_OPTIONS} placeholder="All Outcomes" icon={Target} />
          </>
        )}
        {channel === 'email' && (
          <Select value={draft.direction} onChange={set('direction')} options={DIRECTION_OPTIONS} placeholder="All Directions" icon={ArrowLeftRight} />
        )}
        {channel === 'messages' && (
          <>
            <Select value={draft.channel} onChange={set('channel')} options={MESSAGE_CHANNEL_OPTIONS} placeholder="All Channels" icon={MessageSquare} />
            <Select value={draft.status} onChange={set('status')} options={MESSAGE_STATUS_OPTIONS} placeholder="All Statuses" icon={CircleDot} />
            <Select value={draft.direction} onChange={set('direction')} options={DIRECTION_OPTIONS} placeholder="All Directions" icon={ArrowLeftRight} />
          </>
        )}

        <DateRangePicker
          from={draft.date_from}
          to={draft.date_to}
          onChange={({ from, to }) => setDraft((d) => ({ ...d, date_from: from, date_to: to }))}
        />

        {channel === 'calls' && (
          <Checkbox
            className="px-1"
            checked={draft.has_recording === 'true'}
            onChange={(e) => set('has_recording')(e.target.checked ? 'true' : '')}
            label={<><Mic size={14} className="text-slate-400" /> Has Recording</>}
          />
        )}

        <SearchInput
          value={draft.search}
          onChange={(e) => set('search')(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
          placeholder="Search lead or company…"
          className="flex-1 min-w-[200px]"
        />

        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={apply}>Apply</Button>
          <Button size="sm" variant="outline" onClick={reset}>Reset</Button>
        </div>
      </div>
    </div>
  );
}
