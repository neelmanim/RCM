import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Clock, ChevronDown } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
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

const selectClass = 'w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white ' +
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none';

// Custom listbox instead of a native <select> — a native dropdown's OS-level
// popup (checkmarks, hover highlight, styling) isn't something page CSS can
// touch at all, which is what made the 17-zone list look inconsistent with
// the rest of this modal (reported 2026-08-13). Portal-rendered (not just
// absolutely positioned) because the Modal body has `overflow-y-auto` and
// the outer card has `overflow-hidden` — an in-place absolute panel would
// get clipped the moment it needed more room than the modal's own flow
// height, since browsers don't count absolutely-positioned overflow when
// sizing a clipping ancestor.
function TimezoneSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open) setRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  // Escape closes just this dropdown — stopPropagation keeps the parent
  // Modal's own document-level Escape listener from also closing the whole
  // modal in the same keypress.
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div onKeyDown={handleKeyDown}>
      <button
        type="button"
        ref={btnRef}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${selectClass} flex items-center justify-between text-left disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span>{value}</span>
        <ChevronDown size={14} className="text-slate-400 shrink-0 ml-1.5" />
      </button>
      {open && rect && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 1000 }}
          className="max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1"
        >
          {TIMEZONES.map((z) => (
            <div
              key={z}
              role="option"
              aria-selected={z === value}
              onClick={() => { onChange(z); setOpen(false); }}
              className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-blue-50 ${
                z === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'
              }`}
            >
              {z}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

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
          <TimezoneSelect value={tz} onChange={setTz} disabled={!hasConfig} />
        </div>

        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
            <input type="checkbox" checked={windowEnabled} onChange={(e) => setWindowEnabled(e.target.checked)} />
            Restrict to business hours
          </label>
          {windowEnabled && (
            <div className="flex items-center gap-2">
              <select className={selectClass} value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
                {HOUR_OPTIONS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
              <span className="text-slate-400">to</span>
              <select className={selectClass} value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
                {HOUR_OPTIONS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
            <input type="checkbox" checked={daysEnabled} onChange={(e) => setDaysEnabled(e.target.checked)} />
            Restrict to certain days
          </label>
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
