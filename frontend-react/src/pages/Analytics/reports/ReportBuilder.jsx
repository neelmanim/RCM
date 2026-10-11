/**
 * ReportBuilder.jsx
 *
 * Full-page report creation/edit experience — deliberately not a small
 * modal (there's too much configuration for that). Two columns: the
 * configuration form on the left, a sticky "send checklist" + actions panel
 * on the right so Save/Preview/Cancel and readiness stay visible no matter
 * how far down the form the user has scrolled.
 *
 * "Preview" saves the current configuration first (same validation path as
 * "Save & Schedule"), then renders it through the exact same pipeline the
 * real send uses (GET .../preview calls report_service.build_report_content
 * directly) — there's no separate preview-only rendering logic to drift
 * from what actually gets emailed.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Eye, Send, CheckCircle2, AlertCircle, BarChart3, Users2, Plus } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { DateRangePicker } from '../../../components/ui/DateRangePicker';
import { TimePicker } from '../../../components/ui/TimePicker';
import { Switch } from '../../../components/ui/Switch';
import { AnalyticsService } from '../../../services/api';
import { RecipientChips } from './RecipientChips';
import { TIMEZONES, WEEKDAYS, DATE_RANGE_LABELS, fmtSchedule } from './reportHelpers';
import { useCanExport } from '../../../lib/useCanExport';

const DEFAULT_STATE = {
  name: '',
  components: [],
  pod_id: '',
  upload_log_id: '',
  sdr_id: '',
  date_range_rule: 'previous_7_days',
  custom_start: '',
  custom_end: '',
  frequency: 'weekly',
  weekday: 0,
  day_of_month: 1,
  timezone: 'UTC',
  send_hour: 9,
  send_minute: 0,
  to_recipients: [],
  cc_recipients: [],
  bcc_recipients: [],
  sender_user_id: '',
  include_csv: true,
};

// Component ids are backend-defined; icons here are a display nicety with a
// generic fallback, not a contract either side depends on.
const COMPONENT_ICONS = { key_metrics: BarChart3, sdr_performance: Users2 };

const pad2 = (n) => String(n).padStart(2, '0');

function toFormState(report) {
  return {
    name: report.name,
    components: report.components,
    pod_id: report.pod_id || '',
    upload_log_id: report.upload_log_id || '',
    sdr_id: report.sdr_id || '',
    date_range_rule: report.date_range_rule,
    custom_start: report.custom_start ? report.custom_start.slice(0, 10) : '',
    custom_end: report.custom_end ? report.custom_end.slice(0, 10) : '',
    frequency: report.frequency,
    weekday: report.weekday,
    day_of_month: report.day_of_month,
    timezone: report.timezone,
    send_hour: report.send_hour,
    send_minute: report.send_minute,
    to_recipients: report.to_recipients,
    cc_recipients: report.cc_recipients,
    bcc_recipients: report.bcc_recipients,
    sender_user_id: report.sender_user_id || '',
    include_csv: report.include_csv,
  };
}

function toPayload(form) {
  return {
    ...form,
    pod_id: form.pod_id || null,
    upload_log_id: form.upload_log_id || null,
    sdr_id: form.sdr_id || null,
    sender_user_id: form.sender_user_id || null,
    custom_start: form.date_range_rule === 'custom' && form.custom_start ? `${form.custom_start}T00:00:00Z` : null,
    custom_end: form.date_range_rule === 'custom' && form.custom_end ? `${form.custom_end}T23:59:59Z` : null,
    send_hour: Number(form.send_hour),
    send_minute: Number(form.send_minute),
    weekday: Number(form.weekday),
    day_of_month: Number(form.day_of_month),
  };
}

const ChecklistRow = ({ ok, children }) => (
  <div className="flex items-center gap-2 text-sm">
    {ok ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0" /> : <AlertCircle size={15} className="text-amber-500 shrink-0" />}
    <span className={ok ? 'text-slate-700' : 'text-slate-500'}>{children}</span>
  </div>
);

export const ReportBuilder = ({ reportId, onDone }) => {
  const canExport = useCanExport();
  const [form, setForm] = useState(DEFAULT_STATE);
  const [savedId, setSavedId] = useState(reportId || null);
  const [components, setComponents] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ pods: [], batches: [], sdrs: [] });
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);

  useEffect(() => {
    (async () => {
      const [comps, filters, senderList] = await Promise.all([
        AnalyticsService.listReportComponents(),
        AnalyticsService.getFilters(),
        AnalyticsService.getReportSenders(),
      ]);
      setComponents(comps);
      setFilterOptions(filters);
      setSenders(senderList);
      if (reportId) {
        const report = await AnalyticsService.getReport(reportId);
        setForm(toFormState(report));
        setShowCc(report.cc_recipients.length > 0);
        setShowBcc(report.bcc_recipients.length > 0);
      }
      setLoading(false);
    })();
  }, [reportId]);

  const patch = (fields) => setForm((f) => ({ ...f, ...fields }));

  const toggleComponent = (id) => {
    setForm((f) => ({
      ...f,
      components: f.components.includes(id) ? f.components.filter((c) => c !== id) : [...f.components, id],
    }));
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const payload = toPayload(form);
      if (!canExport) delete payload.include_csv;     // CSV attachments are a data export: the server only accepts the field from someone who may export
      const saved = savedId
        ? await AnalyticsService.updateReport(savedId, payload)
        : await AnalyticsService.createReport(payload);
      setSavedId(saved.id);
      return saved;
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to save report.');
      return null;
    } finally {
      setSaving(false);
    }
  }, [form, savedId, canExport]);

  const handleSaveAndSchedule = async () => {
    const saved = await save();
    if (saved) onDone();
  };

  const handlePreview = async () => {
    const saved = await save();
    if (!saved) return;
    const result = await AnalyticsService.previewReport(saved.id);
    setPreview(result);
  };

  if (loading) {
    return <p className="text-sm text-slate-400 py-8 text-center">Loading builder…</p>;
  }

  const selectedSender = senders.find((s) => s.id === form.sender_user_id);
  const recipientCount = form.to_recipients.length + form.cc_recipients.length + form.bcc_recipients.length;

  return (
    <div className="animate-fade-in">
      <button onClick={onDone} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
        <ArrowLeft size={15} /> Back to My Reports
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        {/* ── Configuration ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Report" subtitle="Name it and choose what goes in the email." />
            <CardContent className="space-y-4">
              <Input
                label="Report Name"
                placeholder="e.g. Weekly SDR Performance"
                value={form.name}
                maxLength={100}
                onChange={(e) => patch({ name: e.target.value })}
                containerClassName="mb-0"
              />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-700">Content</label>
                  <span className="text-xs font-semibold text-slate-400">{form.components.length} selected</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {components.map((c) => {
                    const Icon = COMPONENT_ICONS[c.id] || BarChart3;
                    const selected = form.components.includes(c.id);
                    return (
                      <div
                        key={c.id}
                        onClick={() => toggleComponent(c.id)}
                        className={`relative p-3 rounded-xl border-2 cursor-pointer transition-all ${
                          selected ? 'border-indigo-500 bg-indigo-50/60' : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className={`p-1.5 rounded-lg ${selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                            <Icon size={15} />
                          </span>
                          <span>
                            <span className="block text-sm font-semibold text-slate-800">{c.label}</span>
                            <span className="block text-xs text-slate-500 mt-0.5">{c.description}</span>
                          </span>
                        </div>
                        {selected && <CheckCircle2 size={16} className="absolute top-2.5 right-2.5 text-indigo-600" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Scope & Period" subtitle="Explicitly chosen for this report — not inherited from the dashboard's current filters." />
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">POD</label>
                  <Select
                    value={form.pod_id}
                    onChange={(v) => patch({ pod_id: v })}
                    options={filterOptions.pods.map((p) => ({ value: p.id, label: p.name }))}
                    placeholder="All PODs"
                    searchable
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Batch</label>
                  <Select
                    value={form.upload_log_id}
                    onChange={(v) => patch({ upload_log_id: v })}
                    options={filterOptions.batches.map((b) => ({ value: b.id, label: b.label }))}
                    placeholder="All Batches"
                    searchable
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">SDR</label>
                  <Select
                    value={form.sdr_id}
                    onChange={(v) => patch({ sdr_id: v })}
                    options={filterOptions.sdrs.map((s) => ({ value: s.id, label: s.name }))}
                    placeholder="All SDRs"
                    searchable
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <label className="block text-sm font-medium text-slate-700 mb-1">Date Range</label>
                <Select
                  value={form.date_range_rule}
                  onChange={(v) => patch({ date_range_rule: v })}
                  options={Object.entries(DATE_RANGE_LABELS).map(([k, label]) => ({ value: k, label }))}
                />
                <p className="text-xs text-slate-400 mt-1.5">Resolved to the exact matching period each time this report runs.</p>
                {form.date_range_rule === 'custom' && (
                  <div className="mt-3">
                    <DateRangePicker
                      from={form.custom_start}
                      to={form.custom_end}
                      onChange={({ from, to }) => patch({ custom_start: from, custom_end: to })}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Schedule" />
            <CardContent className="space-y-4">
              <div className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-sm font-semibold text-indigo-700">
                Sends {fmtSchedule(form)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Frequency</label>
                  <Select
                    value={form.frequency}
                    onChange={(v) => patch({ frequency: v })}
                    options={[
                      { value: 'daily', label: 'Daily' },
                      { value: 'weekly', label: 'Weekly' },
                      { value: 'monthly', label: 'Monthly' },
                    ]}
                  />
                </div>
                {form.frequency === 'weekly' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Day of week</label>
                    <Select
                      value={form.weekday}
                      onChange={(v) => patch({ weekday: v })}
                      options={WEEKDAYS.map((d, i) => ({ value: i, label: d }))}
                    />
                  </div>
                )}
                {form.frequency === 'monthly' && (
                  <Input label="Day of month" type="number" min={1} max={31} value={form.day_of_month} onChange={(e) => patch({ day_of_month: e.target.value })} containerClassName="mb-0" hint="Clamped to the last day if a shorter month doesn't have it." />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Send time</label>
                  <TimePicker
                    ariaLabel="Send time"
                    value={`${pad2(form.send_hour)}:${pad2(form.send_minute)}`}
                    onChange={(v) => {
                      const [h, m] = v.split(':').map(Number);
                      patch({ send_hour: h, send_minute: m });
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
                  <Select
                    value={form.timezone}
                    onChange={(v) => patch({ timezone: v })}
                    options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                    searchable
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Delivery" subtitle="Who gets it, who it's sent from, and what's attached." />
            <CardContent className="space-y-4">
              <div>
                <RecipientChips label="To" values={form.to_recipients} onChange={(v) => patch({ to_recipients: v })} />
                <div className="flex gap-3 -mt-2 mb-3">
                  {!showCc && (
                    <button type="button" onClick={() => setShowCc(true)} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      <Plus size={12} /> Add Cc
                    </button>
                  )}
                  {!showBcc && (
                    <button type="button" onClick={() => setShowBcc(true)} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      <Plus size={12} /> Add Bcc
                    </button>
                  )}
                </div>
                {showCc && <RecipientChips label="CC" values={form.cc_recipients} onChange={(v) => patch({ cc_recipients: v })} />}
                {showBcc && <RecipientChips label="BCC" values={form.bcc_recipients} onChange={(v) => patch({ bcc_recipients: v })} />}
              </div>

              <div className="pt-3 border-t border-slate-100">
                <label className="block text-sm font-medium text-slate-700 mb-1">Sender</label>
                <Select
                  value={form.sender_user_id}
                  onChange={(v) => patch({ sender_user_id: v })}
                  options={senders.map((s) => ({ value: s.id, label: `${s.name} (${s.email})` }))}
                  placeholder="Select a connected mailbox…"
                  searchable
                />
                {senders.length === 0 && <p className="text-xs text-amber-600 mt-2">No users have a connected email mailbox yet — connect one in Email Hub first.</p>}
              </div>

              <div className="pt-3 border-t border-slate-100">
                {canExport ? (
                  <Switch
                    checked={form.include_csv}
                    onChange={(e) => patch({ include_csv: e.target.checked })}
                    label="Attach CSV data"
                    hint="Underlying tabular data for the selected components."
                  />
                ) : (
                  <p className="text-xs text-slate-500">CSV attachments are turned off for your account. Ask a Super Admin to switch on data export.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Send checklist + actions (sticky) ────────────────────────── */}
        <Card className="sticky top-4">
          <CardHeader title={form.name || 'Untitled report'} subtitle={fmtSchedule(form)} />
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <ChecklistRow ok={form.components.length > 0}>{form.components.length} content section{form.components.length === 1 ? '' : 's'}</ChecklistRow>
              <ChecklistRow ok={recipientCount > 0}>{recipientCount} recipient{recipientCount === 1 ? '' : 's'}</ChecklistRow>
              <ChecklistRow ok={!!form.sender_user_id}>{selectedSender ? `From ${selectedSender.name}` : 'No sender selected'}</ChecklistRow>
              <ChecklistRow ok>{DATE_RANGE_LABELS[form.date_range_rule]}</ChecklistRow>
              <ChecklistRow ok>{canExport && form.include_csv ? 'CSV attached' : 'No attachment'}</ChecklistRow>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <Button onClick={handleSaveAndSchedule} disabled={saving}><Send size={14} className="mr-1.5" /> {saving ? 'Saving…' : 'Save & Schedule'}</Button>
              <Button variant="secondary" onClick={handlePreview} disabled={saving}><Eye size={14} className="mr-1.5" /> Preview</Button>
              <Button variant="outline" onClick={onDone}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Report Preview" maxWidth="max-w-2xl">
        {preview && (
          <div>
            <p className="text-xs text-slate-500 mb-3">
              Reporting period: {new Date(preview.reporting_period_start).toLocaleDateString()} – {new Date(preview.reporting_period_end).toLocaleDateString()}
              {preview.has_csv && ' · CSV will be attached'}
            </p>
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        )}
      </Modal>
    </div>
  );
};
