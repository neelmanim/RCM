import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Send, Trash2, Pencil, Plus, Filter as FilterIcon, PieChart, Copy } from 'lucide-react';
import { DonutSummaryCard } from '../../components/ui/DonutSummaryCard';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/ui/Table';
import { SortableTableHeader } from '../../components/ui/SortableTableHeader';
import { useSort } from '../../utils/useSort';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Checkbox } from '../../components/ui/Checkbox';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { Calendar } from '../../components/ui/Calendar';
import { DatePicker } from '../../components/ui/DatePicker';
import { TimePicker } from '../../components/ui/TimePicker';
import { Select } from '../../components/ui/Select';
import { MergeFieldComposer } from '../../components/ui/MergeFieldComposer';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Popover';
import { Tabs } from '../../components/ui/Tabs';
import { Skeleton, SkeletonTable, SkeletonCard, SkeletonText } from '../../components/ui/Skeleton';
import { EmailCampaignService, EmailTemplateService, LeadsService, AssignmentsService } from '../../services/api';
import { useCampaignComposeForm, hasContent } from './campaignCompose';
import { STATUSES } from '../leads-hub/constants';
import { isAdminRole } from '../../utils/roles';

const SUB_TABS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'templates', label: 'Templates' },
];

const STATUS_VARIANT = { sent: 'success', failed: 'danger', pending: 'warning', skipped_dnc: 'default', skipped_no_email: 'default' };

function toast(message, type = 'success') {
  window.dispatchEvent(new CustomEvent('alternate:toast', { detail: { message, type } }));
}

function CampaignDetailModal({ campaignId, onClose }) {
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    const load = () => EmailCampaignService.get(campaignId).then((d) => { if (!cancelled) setDetail(d); });
    load();
    const id = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [campaignId]);

  return (
    <Modal open={!!campaignId} onClose={onClose} title={detail?.name || 'Campaign'} maxWidth="max-w-2xl">
      {!detail ? (
        <SkeletonTable rows={5} cols={3} />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Badge variant={detail.status === 'completed' ? 'success' : 'warning'}>{detail.status}</Badge>
            <span className="text-xs text-slate-500">
              {detail.sent_count} sent · {detail.failed_count} failed · {detail.skipped_count} skipped
              {detail.open_rate != null && ` · ${detail.opened_count} opened (${detail.open_rate}%)`}
              {detail.click_rate != null && ` · ${detail.clicked_count} clicked (${detail.click_rate}%)`}
            </span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Lead</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Opened</TableHeader>
                  <TableHeader>Clicked</TableHeader>
                  <TableHeader>Detail</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {detail.recipients.map((r) => (
                  <TableRow key={r.lead_id}>
                    <TableCell>{r.lead_name || r.lead_email || r.lead_id}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.status] || 'default'}>{r.status}</Badge></TableCell>
                    <TableCell>{r.status === 'sent' ? (r.opened ? <Badge variant="success">Yes</Badge> : <span className="text-slate-400">No</span>) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell>{r.status === 'sent' ? (r.clicked ? <Badge variant="purple">Yes</Badge> : <span className="text-slate-400">No</span>) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="whitespace-normal text-xs text-slate-500">{r.error || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Shared by the "New Campaign" flow here and the Leads Hub bulk-action
 *  compose button (BulkActionBar.jsx) — same subject/body/template form,
 *  two entry points into it. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _browserTimezone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; }
};
// 'yyyy-mm-dd' in *local* time — Date#toISOString() is UTC, which shifts the
// date near a timezone's day boundary; DatePicker/Calendar both work in
// local-time y/m/d already, so this matches them instead of introducing a
// UTC/local mismatch.
const toIso = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const WEEKDAY_OPTIONS = WEEKDAYS.map((d, i) => ({ value: i, label: d }));

/** "Send now" (schedule === null) vs "Later, once" vs "Repeating" — a
 *  send-time picker only needs the browser's own timezone (shown, not
 *  editable — a full IANA picker is real surface for marginal value here).
 *  Built entirely from this app's own DatePicker/TimePicker/Select — not
 *  native <input type="date/time"> or <select>, so it matches every other
 *  picker in the product instead of looking like a different app. */
function ScheduleControls({ schedule, setSchedule }) {
  const mode = !schedule ? 'now' : schedule.frequency === 'scheduled_once' ? 'once' : 'recurring';
  const tz = _browserTimezone();

  const setMode = (next) => {
    if (next === 'now') { setSchedule(null); return; }
    if (next === 'once') { setSchedule({ frequency: 'scheduled_once', scheduled_send_at: '' }); return; }
    setSchedule({ frequency: 'daily', send_hour: 9, send_minute: 0, timezone: tz });
  };

  // scheduled_send_at is kept as a "yyyy-mm-ddTHH:MM" string (same shape a
  // native datetime-local input produced) so toScheduleApiPayload's
  // `new Date(...)` parse — and everything downstream of it — needs no change.
  const [datePart, timePart] = (schedule?.scheduled_send_at || '').split('T');
  const setDatePart = (d) => setSchedule((s) => ({ ...s, scheduled_send_at: `${d}T${timePart || '09:00'}` }));
  const setTimePart = (t) => setSchedule((s) => ({ ...s, scheduled_send_at: `${datePart || ''}T${t}` }));

  const recurringTime = schedule?.send_hour != null
    ? `${String(schedule.send_hour).padStart(2, '0')}:${String(schedule.send_minute || 0).padStart(2, '0')}`
    : '09:00';
  const setRecurringTime = (v) => {
    const [h, m] = v.split(':').map(Number);
    setSchedule((s) => ({ ...s, send_hour: h, send_minute: m, timezone: tz }));
  };

  return (
    <div className="mb-2">
      <div className="flex items-center gap-1 mb-2">
        {[['now', 'Send now'], ['once', 'Schedule for later'], ['recurring', 'Repeat']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setMode(key)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold ${mode === key ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'once' && (
        <div className="flex items-center gap-2">
          <DatePicker value={datePart || ''} onChange={setDatePart} ariaLabel="Send date" min={toIso(new Date())} />
          <TimePicker value={timePart || '09:00'} onChange={setTimePart} ariaLabel="Send time" />
          <span className="text-xs text-slate-400">({tz})</span>
        </div>
      )}
      {mode === 'recurring' && (
        <div className="flex items-center gap-2 flex-wrap">
          <Select ariaLabel="Repeat frequency" value={schedule.frequency}
            onChange={(v) => setSchedule((s) => ({ ...s, frequency: v }))} options={FREQUENCY_OPTIONS} />
          {schedule.frequency === 'weekly' && (
            <Select ariaLabel="Repeat weekday" value={schedule.weekday ?? 0}
              onChange={(v) => setSchedule((s) => ({ ...s, weekday: v }))} options={WEEKDAY_OPTIONS} />
          )}
          {schedule.frequency === 'monthly' && (
            <Input type="number" min={1} max={31} value={schedule.day_of_month ?? 1}
              onChange={(e) => setSchedule((s) => ({ ...s, day_of_month: Number(e.target.value) }))}
              containerClassName="mb-0 w-16" aria-label="Day of month" />
          )}
          <span className="text-xs text-slate-400">at</span>
          <TimePicker value={recurringTime} onChange={setRecurringTime} ariaLabel="Repeat time" />
          <span className="text-xs text-slate-400">({tz})</span>
        </div>
      )}
    </div>
  );
}

export function CampaignComposeFields({
  templates, templateId, onPickTemplate,
  campaignName, setCampaignName,
  subject, setSubject, body, setBody,
  saveAsTemplate, setSaveAsTemplate, templateName, setTemplateName,
  schedule, setSchedule, includeSignature, setIncludeSignature,
}) {
  return (
    <>
      {templates?.length > 0 && (
        <Select
          ariaLabel="Start from a template"
          className="w-full justify-between mb-2"
          value={templateId}
          onChange={onPickTemplate}
          placeholder="Start from a template…"
          options={templates.map((t) => ({ value: t.id, label: t.name }))}
          searchable
        />
      )}
      {/* Distinct from the subject/template — without this, every campaign
          started from the same template showed the identical, merge-field
          subject as its "name" in the campaigns list, with no way to tell
          them apart. */}
      <Input
        placeholder="Campaign name"
        value={campaignName}
        onChange={(e) => setCampaignName(e.target.value)}
        containerClassName="mb-2"
      />
      {/* Same composer as the saved-template editor — the merge fields used
          to be advertised only in placeholder text here too, leaving you to
          type "{{first_name}}" by hand and hope you spelled it right. */}
      <div className="mb-2">
        <MergeFieldComposer
          subject={subject}
          onSubjectChange={setSubject}
          body={body}
          onBodyChange={setBody}
          subjectPlaceholder="Subject"
          bodyPlaceholder="Write the email body…"
        />
      </div>
      {setSchedule && <ScheduleControls schedule={schedule} setSchedule={setSchedule} />}
      <Checkbox
        checked={includeSignature}
        onChange={(e) => setIncludeSignature(e.target.checked)}
        label={<span className="text-xs text-slate-500">Include my email signature</span>}
      />
      <Checkbox
        checked={saveAsTemplate}
        onChange={(e) => setSaveAsTemplate(e.target.checked)}
        label={<span className="text-xs text-slate-500">Save as a new template</span>}
      />
      {saveAsTemplate && (
        <Input
          placeholder="Template name"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          containerClassName="mt-2 mb-0"
        />
      )}
    </>
  );
}

/** Animated placeholder rows shown while a page of leads is loading —
 *  mirrors LeadsHub.jsx's own SkeletonRow (not exported from there, so a
 *  small local twin instead of reaching into another feature's internals). */
function PickerSkeletonRows() {
  const widths = ['60%', '80%', '50%'];
  return Array.from({ length: 6 }).map((_, i) => (
    <TableRow key={i}>
      <TableCell><div className="w-3.5 h-3.5 bg-slate-100 rounded animate-pulse" /></TableCell>
      {widths.map((w, j) => (
        <TableCell key={j}><div className="h-3.5 bg-slate-100 rounded animate-pulse" style={{ width: w }} /></TableCell>
      ))}
    </TableRow>
  ));
}

/** Step 1 of "New Campaign": search/filter leads and check off up to 200 to
 *  email. Open to every role — an SDR/AE picking from their own visible
 *  leads is no different a privilege than the Leads Hub bulk-select path
 *  already is; the Upload-file filter alone stays admin-only, matching
 *  Leads Hub's own FilterBar (GET /leads/upload-logs is admin-only server-side). */
function LeadPickerModal({ open, onClose, onConfirm, userRole }) {
  const isAdmin = isAdminRole(userRole);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [status, setStatus] = useState([]);
  const [uploadLogId, setUploadLogId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [uploadLogs, setUploadLogs] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (isAdmin) AssignmentsService.getUploadLogs(1, 50).then((d) => setUploadLogs(d.logs || [])).catch(() => {});
  }, [isAdmin]);

  // 400ms debounce — matches useLeadsList's own search debounce (Leads Hub),
  // so typing doesn't fire a request per keystroke against a large org.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filterParams = useMemo(() => ({
    search: search || undefined,
    status: status.length ? status : undefined,
    upload_log_id: uploadLogId || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }), [search, status, uploadLogId, dateFrom, dateTo]);

  useEffect(() => {
    const load = () => {
      setLoading(true);
      LeadsService.getLeads({ ...filterParams, page, per_page: 20 })
        .then(setResult)
        .catch(() => setResult({ data: [], total: 0, pages: 1 }))
        .finally(() => setLoading(false));
    };
    if (open) load();
  }, [open, filterParams, page]);

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 200) next.add(id);
      return next;
    });
  };

  // Same ids_only fetch Leads Hub's own "select all matching" bulk action
  // uses (useLeadsList.js) — one full, unpaginated fetch of every lead
  // matching the current search/filters, not just the visible page.
  const handleSelectAll = async () => {
    setSelectingAll(true);
    try {
      const data = await LeadsService.getLeads({ ...filterParams, ids_only: true });
      const ids = (data.data || []).map((l) => l.id);
      setSelectedIds(new Set(ids.slice(0, 200)));
    } finally {
      setSelectingAll(false);
    }
  };

  const activeFilterCount = (status.length ? 1 : 0) + (uploadLogId ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);
  const clearFilters = () => { setStatus([]); setUploadLogId(''); setDateFrom(''); setDateTo(''); setPage(1); };
  const dateRange = { from: dateFrom ? new Date(`${dateFrom}T00:00:00`) : undefined, to: dateTo ? new Date(`${dateTo}T00:00:00`) : undefined };

  const leadLabel = (lead) => [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unnamed lead';

  return (
    <Modal open={open} onClose={onClose} title="Step 1 of 2 — Select recipients" maxWidth="max-w-2xl">
      <p className="text-sm text-slate-500 mb-3">Search, filter, and check off up to 200 leads to email — you'll write the message next.</p>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Input
            placeholder="Search by name, email, or company…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <button type="button"
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold border shrink-0 ${activeFilterCount ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>
              <FilterIcon size={13} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[280px] p-3 space-y-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Status</div>
              <div className="max-h-[120px] overflow-y-auto space-y-0.5">
                {STATUSES.map((s) => (
                  <Checkbox key={s} label={s} checked={status.includes(s)}
                    className="px-1.5 py-1 rounded hover:bg-slate-50 w-full"
                    onChange={() => { setStatus((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]); setPage(1); }} />
                ))}
              </div>
            </div>
            {isAdmin && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Upload file</div>
                <Select
                  ariaLabel="Upload file"
                  value={uploadLogId}
                  onChange={(v) => { setUploadLogId(v); setPage(1); }}
                  className="w-full justify-between"
                  options={[{ value: '', label: 'All uploads' }, ...uploadLogs.map((u) => ({ value: u.id, label: u.filename }))]}
                />
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Ingested (created)</div>
              <Calendar
                mode="range"
                selected={dateRange}
                defaultMonth={dateRange.from}
                onSelect={(next) => { setDateFrom(toIso(next?.from)); setDateTo(toIso(next?.to)); setPage(1); }}
              />
            </div>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 pt-1 border-t border-slate-100">
                Clear filters
              </button>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center justify-between mt-3 mb-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500">{selectedIds.size} of 200 selected</span>
          {result?.total > 0 && (
            <button type="button" onClick={handleSelectAll} disabled={selectingAll}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50">
              {selectingAll ? 'Selecting…' : `Select all ${Math.min(result.total, 200)} matching`}
            </button>
          )}
        </div>
        {selectedIds.size > 0 && (
          <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
            Clear selection
          </button>
        )}
      </div>
      <div className="max-h-[40vh] overflow-y-auto">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader className="w-8" />
              <TableHeader>Name</TableHeader>
              <TableHeader>Email</TableHeader>
              <TableHeader>Company</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <PickerSkeletonRows />
            ) : result?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-slate-400 py-8">
                  {search || activeFilterCount ? 'No leads match your search/filters.' : 'No leads found.'}
                </TableCell>
              </TableRow>
            ) : (
              result?.data.map((lead) => (
                <TableRow key={lead.id} onClick={() => toggle(lead.id)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(lead.id)}
                      disabled={!selectedIds.has(lead.id) && selectedIds.size >= 200}
                      onChange={() => toggle(lead.id)}
                    />
                  </TableCell>
                  <TableCell className="font-semibold text-slate-700">{leadLabel(lead)}</TableCell>
                  <TableCell className="text-slate-500">{lead.email || '—'}</TableCell>
                  <TableCell className="text-slate-500">{lead.company || '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {result && <Pagination page={page} pages={result.pages} total={result.total} perPage={20} onChange={setPage} />}
      <div className="flex justify-end mt-4 pt-4 border-t border-slate-100">
        <Button variant="primary" disabled={selectedIds.size === 0} onClick={() => onConfirm(Array.from(selectedIds))}>
          Continue with {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'}
        </Button>
      </div>
    </Modal>
  );
}

/** "New Campaign" — the direct, in-Sales-Tools entry point: pick recipients
 *  here, then compose, without a detour through Leads Hub. Leads Hub's own
 *  bulk-action button (BulkActionBar.jsx) still works too, for the case
 *  where leads are already selected there for another reason. */
function NewCampaignFlow({ onCreated, userRole }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [leadIds, setLeadIds] = useState(null); // null = nothing picked yet; array = compose step
  const composeOpen = leadIds !== null;

  const form = useCampaignComposeForm({
    leadIds, open: composeOpen, notify: toast,
    onSuccess: () => { setPickerOpen(false); setLeadIds(null); onCreated(); },
  });
  const closeCompose = () => { setPickerOpen(false); setLeadIds(null); form.reset(); };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)} data-tour="new-campaign-button">
        <Plus size={14} className="mr-1" /> New Campaign
      </Button>
      <LeadPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => { setPickerOpen(false); setLeadIds(ids); }}
        userRole={userRole}
      />
      <ConfirmDialog
        open={composeOpen}
        onClose={closeCompose}
        title="Step 2 of 2 — Write your email"
        message={`Compose one email to send to ${leadIds?.length || 0} lead(s). Track results right here in Campaigns.`}
        confirmLabel={form.confirmLabel}
        onConfirm={form.handleSend}
        loading={form.busy}
      >
        <CampaignComposeFields
          templates={form.templates}
          templateId={form.templateId}
          onPickTemplate={form.handlePickTemplate}
          campaignName={form.campaignName} setCampaignName={form.setCampaignName}
          subject={form.subject} setSubject={form.setSubject}
          body={form.body} setBody={form.setBody}
          saveAsTemplate={form.saveAsTemplate} setSaveAsTemplate={form.setSaveAsTemplate}
          templateName={form.templateName} setTemplateName={form.setTemplateName}
          schedule={form.schedule} setSchedule={form.setSchedule}
          includeSignature={form.includeSignature} setIncludeSignature={form.setIncludeSignature}
        />
      </ConfirmDialog>
    </>
  );
}

const CAMPAIGN_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
];

function CampaignsList({ userRole }) {
  // Poll while any campaign on the current page is still running, matching
  // the "plain polling, no new SSE infra" call in the plan doc.
  const [result, setResult] = useState(null); // null = loading
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  // Admin-only: Super Admin/Pod Admin now see every rep's campaigns
  // (previously hard-scoped to "your own mailbox" for every role — the
  // Super Admin ask this answers). Non-admins stay self-scoped server-side
  // regardless of this toggle, so it's hidden for them rather than being a
  // no-op control.
  const isAdmin = isAdminRole(userRole);
  const [mineOnly, setMineOnly] = useState(false);
  const [sort, toggleSortRaw] = useSort();
  const toggleSort = (key) => { toggleSortRaw(key); setPage(1); };
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const canRename = (c) => c.is_mine || (userRole || '').toLowerCase() === 'super admin';
  const startRename = (c) => { setRenamingId(c.id); setRenameValue(c.name); };
  const saveRename = async (c) => {
    const name = renameValue.trim();
    if (!name || name === c.name) { setRenamingId(null); return; }
    try {
      await EmailCampaignService.rename(c.id, name);
      setRenamingId(null);
      refresh();
    } catch {
      toast('Failed to rename campaign.', 'error');
    }
  };

  const refresh = useCallback(() => {
    const sortBy = sort.key ? `${sort.dir === 'desc' ? '-' : ''}${sort.key}` : undefined;
    EmailCampaignService.list({ status, page, perPage: 20, mine: isAdmin && mineOnly, sortBy }).then(setResult).catch(() => setResult({ campaigns: [], total: 0, pages: 1 }));
  }, [status, page, isAdmin, mineOnly, sort]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!result?.campaigns.some((c) => c.status === 'running')) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [result, refresh]);

  const handleStatusChange = (v) => { setStatus(v); setPage(1); };

  if (result === null) return <SkeletonTable rows={5} cols={6} />;
  if (result.total === 0 && !status) {
    return (
      <EmptyState
        icon={Send}
        title="No campaigns yet"
        message='Pick recipients and send your first campaign — or select leads in Leads Hub and use "Send Email Campaign" there instead.'
        action={<NewCampaignFlow onCreated={refresh} userRole={userRole} />}
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3" data-tour="campaigns-status-filter">
          <Select ariaLabel="Filter by status" value={status} onChange={handleStatusChange} options={CAMPAIGN_STATUS_OPTIONS} icon={FilterIcon} />
          {isAdmin && (
            <Checkbox
              checked={mineOnly}
              onChange={(e) => { setMineOnly(e.target.checked); setPage(1); }}
              label={<span className="text-sm text-slate-600">My campaigns only</span>}
            />
          )}
        </div>
        <NewCampaignFlow onCreated={refresh} userRole={userRole} />
      </div>
      {result.campaigns.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">No campaigns match this filter.</p>
      ) : (
      <Table>
        <TableHead>
          <TableRow>
            <SortableTableHeader label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
            {isAdmin && <TableHeader>Run By</TableHeader>}
            <TableHeader>Status</TableHeader>
            <SortableTableHeader label="Sent" sortKey="sent" sort={sort} onSort={toggleSort} />
            <SortableTableHeader label="Failed" sortKey="failed" sort={sort} onSort={toggleSort} />
            <SortableTableHeader label="Skipped" sortKey="skipped" sort={sort} onSort={toggleSort} />
            {/* open_rate/click_rate are against sent_count and null until
                something has sent — see _campaign_to_dict's own comment.
                Not sortable — computed post-pagination from a separate
                engagement query, see the backend's own sort_by comment. */}
            <TableHeader>Opens</TableHeader>
            <TableHeader>Clicks</TableHeader>
            <SortableTableHeader label="Created" sortKey="created_at" sort={sort} onSort={toggleSort} />
          </TableRow>
        </TableHead>
        <TableBody>
          {result.campaigns.map((c) => (
            <TableRow key={c.id} onClick={() => renamingId !== c.id && setOpenId(c.id)}>
              <TableCell className="font-semibold text-slate-800">
                {renamingId === c.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(c); if (e.key === 'Escape') setRenamingId(null); }}
                      containerClassName="mb-0"
                    />
                    <Button size="sm" variant="ghost" onClick={() => saveRename(c)}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1.5 group">
                    {c.name}
                    {canRename(c) && (
                      <Pencil
                        size={13}
                        className="text-slate-300 group-hover:text-slate-500 shrink-0"
                        onClick={(e) => { e.stopPropagation(); startRename(c); }}
                      />
                    )}
                  </span>
                )}
              </TableCell>
              {isAdmin && (
                <TableCell className="text-slate-500">
                  {c.is_mine ? <span className="text-slate-400">You</span> : (c.created_by_name || 'Unknown')}
                </TableCell>
              )}
              <TableCell><Badge variant={c.status === 'completed' ? 'success' : 'warning'}>{c.status}</Badge></TableCell>
              <TableCell>{c.sent_count}/{c.total_recipients}</TableCell>
              <TableCell>{c.failed_count}</TableCell>
              <TableCell>{c.skipped_count}</TableCell>
              <TableCell>
                {c.open_rate != null
                  ? <Badge variant={c.opened_count > 0 ? 'success' : 'default'}>{c.opened_count} · {c.open_rate}%</Badge>
                  : <span className="text-slate-400">—</span>}
              </TableCell>
              <TableCell>
                {c.click_rate != null
                  ? <Badge variant={c.clicked_count > 0 ? 'purple' : 'default'}>{c.clicked_count} · {c.click_rate}%</Badge>
                  : <span className="text-slate-400">—</span>}
              </TableCell>
              <TableCell>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      )}
      <Pagination page={page} pages={result.pages} total={result.total} perPage={20} onChange={setPage} />
      <CampaignDetailModal campaignId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

/** "Performance" — an aggregate donut across every campaign, or drill into
 *  one via the dropdown. The per-campaign breakdown itself already lives in
 *  CampaignsList's table right below this — a second table here would just
 *  repeat those same rows, so this stays a single card, the same shape
 *  Cadence's own performance summary uses (JourneyList.jsx). */
function PerformanceSection() {
  const [campaigns, setCampaigns] = useState(null);
  const [selectedId, setSelectedId] = useState('all');

  useEffect(() => {
    // "Across all campaigns" needs the actual full set, not one paginated
    // page — 100 (the backend's own per_page cap) is far beyond what one
    // user realistically accumulates, so this stays a real "everything"
    // fetch in practice rather than a silent truncation.
    EmailCampaignService.list({ perPage: 100 }).then((r) => setCampaigns(r.campaigns)).catch(() => setCampaigns([]));
  }, []);

  if (campaigns === null) {
    return <SkeletonCard><div className="flex flex-col items-center gap-4"><Skeleton className="w-[140px] h-[140px] rounded-full" /></div></SkeletonCard>;
  }
  if (campaigns.length === 0) {
    return (
      <EmptyState icon={PieChart} title="No campaign data yet"
        message="Send your first campaign to see delivery performance here." />
    );
  }

  const selected = selectedId === 'all' ? null : campaigns.find((c) => c.id === selectedId);
  const totals = selected || {
    sent_count: campaigns.reduce((s, c) => s + c.sent_count, 0),
    failed_count: campaigns.reduce((s, c) => s + c.failed_count, 0),
    skipped_count: campaigns.reduce((s, c) => s + c.skipped_count, 0),
  };
  const segments = [
    { label: 'Sent', value: totals.sent_count, color: '#16a34a' },
    { label: 'Failed', value: totals.failed_count, color: '#dc2626' },
    { label: 'Skipped', value: totals.skipped_count, color: '#94a3b8' },
  ];

  return (
    <DonutSummaryCard
      title="Delivery outcomes"
      subtitle={selected ? selected.name : `Across all ${campaigns.length} campaign(s)`}
      segments={segments}
      size={140}
      strokeWidth={18}
      filter={
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-white">
          <option value="all">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      }
    />
  );
}

function TemplatesList() {
  const [templates, setTemplates] = useState(null);
  const [editingId, setEditingId] = useState(null); // null = "save a new template" mode
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  // Templates are shared team-wide, so a delete hits everyone's saved list —
  // it went through on a single unguarded click before this.
  const [deleteTarget, setDeleteTarget] = useState(null);

  const refresh = useCallback(() => {
    EmailTemplateService.list().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const resetForm = () => { setEditingId(null); setName(''); setSubject(''); setBody(''); };

  const handleEdit = (t) => {
    setEditingId(t.id); setName(t.name); setSubject(t.subject); setBody(t.body);
  };

  // Someone else's template -> a new draft of your own, prefilled. editingId
  // stays null so Save creates rather than trying (and failing) to update it.
  const handleCopy = (t) => {
    setEditingId(null);
    setName(`Copy of ${t.name}`);
    setSubject(t.subject);
    setBody(t.body);
    toast(`Copied “${t.name}” — save it to create your own version.`);
  };

  const handleSave = async () => {
    if (!name.trim() || (!subject.trim() && !hasContent(body))) {
      toast('Name and a subject or body are required.', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await EmailTemplateService.update(editingId, name.trim(), subject.trim(), body);
        toast('Template updated.');
      } else {
        await EmailTemplateService.create(name.trim(), subject.trim(), body);
        toast('Template saved.');
      }
      resetForm();
      refresh();
    } catch {
      toast(editingId ? 'Failed to update template.' : 'Failed to save template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    try {
      await EmailTemplateService.delete(target.id);
      if (editingId === target.id) resetForm();
      setDeleteTarget(null);
      refresh();
      toast('Template deleted.');
    } catch {
      setDeleteTarget(null);
      toast('Failed to delete template.', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card>
        <CardHeader
          title={editingId ? 'Edit template' : 'Save a new template'}
          actions={editingId ? (
            <button type="button" onClick={resetForm} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
              Cancel
            </button>
          ) : undefined}
        />
        <CardContent className="space-y-3">
          <Input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
          <MergeFieldComposer
            subject={subject}
            onSubjectChange={setSubject}
            body={body}
            onBodyChange={setBody}
            subjectPlaceholder="Subject"
            bodyPlaceholder="Write the email body…"
          />
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (editingId ? 'Updating…' : 'Saving…') : (editingId ? 'Update Template' : 'Save Template')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Saved templates" subtitle="Shared across your team, like Call Lists." />
        <CardContent>
          {templates === null ? (
            <SkeletonText lines={4} />
          ) : templates.length === 0 ? (
            <p className="text-sm text-slate-400">No templates saved yet.</p>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <div key={t.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${editingId === t.id ? 'border-blue-200 bg-blue-50/50' : 'border-slate-100'}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate m-0">{t.name}</p>
                    <p className="text-xs text-slate-400 truncate m-0">{t.subject}</p>
                    {/* Subtle attribution — a shared list needs to say whose
                        template you're looking at before it explains why you
                        can't change it. */}
                    {!t.can_edit && (
                      <p className="text-[11px] text-slate-400 truncate m-0 mt-0.5">
                        by {t.created_by_name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* can_edit comes from the API and mirrors the identical
                        creator-or-Super-Admin rule update/delete enforce. Both
                        buttons now agree: before this, Edit was always offered
                        and only failed on save, while Delete was refused —
                        the exact inconsistency reported. */}
                    {t.can_edit ? (
                      <>
                        <button type="button" onClick={() => handleEdit(t)} aria-label="Edit template"
                          className="text-slate-400 hover:text-blue-600">
                          <Pencil size={15} />
                        </button>
                        <button type="button" onClick={() => setDeleteTarget(t)} aria-label="Delete template"
                          className="text-slate-400 hover:text-red-600">
                          <Trash2 size={15} />
                        </button>
                      </>
                    ) : (
                      // Not just a disabled Edit: loading someone else's
                      // template as a new draft both reveals its content and
                      // is the thing you actually wanted ("start from theirs")
                      // — and it can never 403, unlike editing it in place.
                      <button type="button" onClick={() => handleCopy(t)} aria-label="Duplicate template"
                        title={`Created by ${t.created_by_name} — duplicate it to make your own version`}
                        className="text-slate-400 hover:text-blue-600">
                        <Copy size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete template" maxWidth="max-w-sm">
        {deleteTarget && (
          <>
            <p className="text-sm text-slate-600 mb-1">
              Delete “{deleteTarget.name}”?
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Templates are shared with your team, so this removes it for everyone.
              Campaigns already sent keep their own copy of the content.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleDelete}>Delete</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export function CampaignsSection({ userRole }) {
  const [tab, setTab] = useState('campaigns');
  return (
    <div>
      <div data-tour="campaigns-subtabs">
        <Tabs tabs={SUB_TABS} active={tab} onChange={setTab} className="mb-5" />
      </div>
      {tab === 'campaigns' && (
        <>
          <details className="mb-5" open>
            <summary className="text-sm font-semibold text-slate-600 cursor-pointer select-none mb-3">
              Performance snapshot
            </summary>
            <div className="mt-3"><PerformanceSection /></div>
          </details>
          <CampaignsList userRole={userRole} />
        </>
      )}
      {tab === 'templates' && <TemplatesList />}
    </div>
  );
}
