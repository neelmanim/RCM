import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { Checkbox } from '../../components/ui/Checkbox';
import { SalesJourneyService } from '../../services/api';
import { toast } from './toast';

// A curated list, not the full ~600-zone IANA database — covers the
// timezones a sales team is actually likely to operate out of. Same
// tradeoff most CRMs make rather than a giant searchable list for a
// once-per-cadence setting.
const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland',
];

const DAYS = [
  { value: 0, label: 'Mon' }, { value: 1, label: 'Tue' }, { value: 2, label: 'Wed' },
  { value: 3, label: 'Thu' }, { value: 4, label: 'Fri' }, { value: 5, label: 'Sat' }, { value: 6, label: 'Sun' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h, label: `${String(h).padStart(2, '0')}:00`,
}));

const TIMEZONE_OPTIONS = TIMEZONES.map((z) => ({ value: z, label: z }));

export function SendWindowSettings({ journeyId, journey, onSaved }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tz, setTz] = useState(journey.send_tz || 'UTC');
  const [startHour, setStartHour] = useState(journey.send_window_start_hour);
  const [endHour, setEndHour] = useState(journey.send_window_end_hour);
  const [days, setDays] = useState(
    new Set((journey.send_days || '').split(',').filter((d) => d !== '').map(Number))
  );
  const [windowEnabled, setWindowEnabled] = useState(
    journey.send_window_start_hour !== null && journey.send_window_start_hour !== undefined
  );
  const [daysEnabled, setDaysEnabled] = useState(!!journey.send_days);

  useEffect(() => {
    if (!open) return;
    setTz(journey.send_tz || 'UTC');
    setStartHour(journey.send_window_start_hour ?? 9);
    setEndHour(journey.send_window_end_hour ?? 18);
    setDays(new Set((journey.send_days || '').split(',').filter((d) => d !== '').map(Number)));
    setWindowEnabled(journey.send_window_start_hour !== null && journey.send_window_start_hour !== undefined);
    setDaysEnabled(!!journey.send_days);
  }, [open, journey]);

  const toggleDay = (value) => {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const hasConfig = windowEnabled || daysEnabled;

  const handleSave = async () => {
    if (windowEnabled && endHour <= startHour) {
      toast('End hour must be after start hour.', 'error');
      return;
    }
    if (daysEnabled && days.size === 0) {
      toast('Select at least one allowed day, or turn off day restriction.', 'error');
      return;
    }
    setSaving(true);
    try {
      const patch = {
        send_tz: hasConfig ? tz : null,
        send_window_start_hour: windowEnabled ? startHour : null,
        send_window_end_hour: windowEnabled ? endHour : null,
        send_days: daysEnabled ? [...days].sort((a, b) => a - b).join(',') : null,
      };
      const result = await SalesJourneyService.updateSettings(journeyId, patch);
      onSaved(result);
      toast('Send window saved.', 'success');
      setOpen(false);
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to save — please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const summary = !hasConfig
    ? 'Anytime'
    : [
        windowEnabled ? `${HOUR_OPTIONS[startHour]?.label}–${HOUR_OPTIONS[endHour]?.label}` : null,
        daysEnabled ? [...days].sort((a, b) => a - b).map((d) => DAYS[d].label).join('/') : null,
      ].filter(Boolean).join(', ');

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs border border-slate-200 rounded-md px-1.5 py-1 text-slate-600 bg-white hover:bg-slate-50"
        title="When automated email/SMS sends are allowed to go out"
      >
        <Clock size={12} /> {summary}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Send Window" maxWidth="max-w-md">
        <p className="text-xs text-slate-500 mb-4">
          Restricts when this cadence's automated email/SMS steps actually send. A step that becomes due
          outside the window waits until the next valid time — nothing is skipped or lost.
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
          <Select
            className="w-full justify-between"
            ariaLabel="Timezone"
            value={tz}
            onChange={setTz}
            options={TIMEZONE_OPTIONS}
            searchable
            disabled={!hasConfig}
          />
        </div>

        <div className="mb-4">
          <Checkbox
            className="font-medium text-slate-700 mb-2"
            checked={windowEnabled}
            onChange={(e) => setWindowEnabled(e.target.checked)}
            label="Restrict to business hours"
          />
          {windowEnabled && (
            <div className="flex items-center gap-2">
              <Select className="flex-1 justify-between" ariaLabel="Start hour" value={startHour} onChange={setStartHour} options={HOUR_OPTIONS} />
              <span className="text-slate-400">to</span>
              <Select className="flex-1 justify-between" ariaLabel="End hour" value={endHour} onChange={setEndHour} options={HOUR_OPTIONS} />
            </div>
          )}
        </div>

        <div className="mb-4">
          <Checkbox
            className="font-medium text-slate-700 mb-2"
            checked={daysEnabled}
            onChange={(e) => setDaysEnabled(e.target.checked)}
            label="Restrict to certain days"
          />
          {daysEnabled && (
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={`px-2.5 py-1 rounded-md text-xs border ${
                    days.has(d.value)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Button className="w-full" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Modal>
    </>
  );
}
