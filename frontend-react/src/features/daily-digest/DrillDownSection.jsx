import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, Settings2 } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeader } from '../../components/ui/Table';
import { SortableTableHeader } from '../../components/ui/SortableTableHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonTable } from '../../components/ui/Skeleton';
import { InfoTip } from '../../components/ui/InfoTip';
import { useSort } from '../../utils/useSort';
import { DigestDrillService } from '../../services/api';
import { toast, errorText } from '../control-center/notify';
import { useCanExport } from '../../lib/useCanExport';

const TABS = [{ key: 'segment', label: 'By segment' }, { key: 'accounts', label: 'Accounts' }, { key: 'calls', label: 'Calls' }];
const DIMENSIONS = [
  { value: 'icp', label: 'ICP fit' }, { value: 'industry', label: 'Industry' }, { value: 'country', label: 'Country' },
  { value: 'city', label: 'City' }, { value: 'seniority', label: 'Seniority' }, { value: 'function', label: 'Function' },
  { value: 'company_size', label: 'Company size' }, { value: 'source', label: 'Lead source' }, { value: 'batch', label: 'Upload file' },
];
// [key, header, shows the change vs the comparison period?]. The first set is what a leader reads; the Excel file always has everything.
const MAIN_COLS = [
  ['leads', 'Leads', true], ['calls', 'Calls', true], ['conversations', 'Conversations', true], ['connect_rate', 'Connect %'],
  ['booked', 'Booked', true], ['booked_per_100_conversations', 'Booked / 100 conv.'],
];
const MORE_COLS = [['accounts', 'Accounts'], ['lead_to_conversation', 'Leads spoken to %'], ['emails', 'Emails'], ['held', 'Held'], ['held_rate', 'Held %']];
const THIN_WHY = { connect_rate: 'calls', lead_to_conversation: 'leads', booked_per_100_conversations: 'conversations', held_rate: 'bookings' };
const ACCOUNT_COLS = [['people_tried', 'People tried'], ['people_spoke', 'Spoke to'], ['calls', 'Calls'], ['conversations', 'Conversations'], ['emails', 'Emails'], ['booked', 'Booked']];
const STAGE_TONE = { 'Meeting booked': 'success', 'Spoke, no meeting': 'info', 'Tried, not reached': 'warning', 'Email / notes only': 'default' };
const MISSING = ['Not filled in', 'Industry not filled in'];
const NO_LEAD = 'No lead on record';
// Plain-language help for every number, shown by the little "i" in the header.
const TIPS = {
  leads: 'Different people you called, emailed or made a note on in this period.',
  accounts: 'The companies those people work at. Several people at one company count once.',
  calls: 'Calls made, including the ones nobody answered.',
  conversations: 'Calls where someone actually talked with you. The same rule the Funnel uses.',
  connect_rate: 'Conversations as a share of calls. Shown grey when there were very few calls.',
  lead_to_conversation: 'Of the leads you worked, the share you actually spoke to.',
  emails: 'Emails sent to these leads.',
  booked: 'Meetings booked in this period, credited to the rep who booked them.',
  booked_per_100_conversations: 'Meetings booked for every 100 conversations. It jumps around when there are only a few meetings, so grey means "too few to trust".',
  held: 'Booked meetings that actually took place.',
  held_rate: 'Of the meetings booked, the share that took place. Grey when fewer than 5 were booked.',
  people_tried: 'People at this company that you called or emailed.',
  people_spoke: 'People at this company you actually spoke to.',
};
const TILE_TIPS = {
  'Filled in': 'Of the leads worked, the share that have this detail on record. Leads with it missing are listed last, so you can see how complete the data is.',
  'Leads worked': 'Different people you called, emailed or made a note on in this period.',
  Conversations: 'Calls where someone actually talked with you.',
  'Meetings booked': 'Meetings booked in this period.',
  'Accounts worked': 'Companies where at least one person was worked.',
  'People per account': 'On average, how many people at each company you reached out to. More than one is a good sign.',
  'Spoke to 2+ people': 'Companies where you got through to at least two different people.',
  'Meeting booked': 'Companies where a meeting was booked in this period.',
  'Tried, not reached': 'Companies you called but never got through to. Worth another try.',
  Calls: 'Calls made, including the ones nobody answered.',
  'Connect rate': 'Conversations as a share of calls.',
};
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };

// The drill-down is the heaviest query on the page, so it waits until the card is on screen (or the browser cannot tell).
function useSeen(ref) {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, ref]);
  return seen;
}

const Tile = ({ label, value }) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}{TILE_TIPS[label] && <InfoTip text={TILE_TIPS[label]} label={`About ${label}`} />}</div>
    <div className="text-2xl font-bold text-slate-800">{value}</div>
  </div>
);

// Change against the comparison period: "new" when there was nothing before, nothing when there was nothing either time.
function Delta({ value, was }) {
  if (value === null || value === undefined) return null;
  const tone = value === 'new' || value > 0 ? 'text-emerald-600' : value < 0 ? 'text-red-600' : 'text-slate-400';
  const text = value === 'new' ? 'new' : value === 0 ? '0%' : `${value > 0 ? '▲' : '▼'} ${Math.abs(value)}%`;
  return <div className={`text-[11px] font-medium leading-tight ${tone}`} title={`Was ${was}`}>{text}</div>;
}

// A rate built on very few calls or conversations is shown, but quietly, so nobody reads a conclusion into it.
function Rate({ row, k }) {
  if (!row.thin?.[k]) return <>{row[k]}</>;
  return <span className="text-slate-400" title={`Too few ${THIN_WHY[k]} for this to mean much`}>{row[k]}</span>;
}

function useSorted(rows, labelKey) {
  const [sort, toggle] = useSort();
  if (!sort.key) return [rows, sort, toggle];
  const acc = (r) => (sort.key === labelKey ? String(r[labelKey] || '').toLowerCase() : r[sort.key] || 0);
  const out = [...rows].sort((a, b) => (acc(a) < acc(b) ? -1 : acc(a) > acc(b) ? 1 : 0));
  return [sort.dir === 'desc' ? out.reverse() : out, sort, toggle];
}

const Hint = ({ children }) => <p className="px-4 pb-3 text-xs text-slate-500">{children}</p>;
const openOnKey = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

function SegmentTable({ data, onOpen }) {
  const [wide, setWide] = useState(false);
  const cols = wide ? [...MAIN_COLS, ...MORE_COLS] : MAIN_COLS;
  const [rows, sort, toggle] = useSorted(data.rows, 'label');
  const gap = data.coverage.leads - data.coverage.filled;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
        <Tile label="Leads worked" value={data.total.leads.toLocaleString()} />
        <Tile label="Conversations" value={data.total.conversations.toLocaleString()} />
        <Tile label="Meetings booked" value={data.total.booked.toLocaleString()} />
        <Tile label="Filled in" value={`${data.coverage.pct}%`} />
      </div>
      <div className="px-4 pb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {gap > 0
            ? `${gap.toLocaleString()} of ${data.coverage.leads.toLocaleString()} leads worked have no ${data.label.toLowerCase()} on record — listed last so the gap stays visible.`
            : `Every lead worked has a ${data.label.toLowerCase()} on record.`}
          {data.icp_keywords && ` ICP = industry contains: ${data.icp_keywords.join(', ')}.`}
          {data.compared && ` ▲▼ compare with ${data.compare_label}.`}
          {' '}Grey rates rest on very few calls. Click a row to see its leads.
        </p>
        <Button size="sm" variant="ghost" onClick={() => setWide((w) => !w)}>{wide ? 'Fewer columns' : 'More columns'}</Button>
      </div>
      <Table>
        <TableHead>
          <TableRow>
            <SortableTableHeader label={data.label} sortKey="label" sort={sort} onSort={toggle} />
            {cols.map(([k, label]) => <SortableTableHeader key={k} label={label} sortKey={k} sort={sort} onSort={toggle}>{TIPS[k] && <InfoTip text={TIPS[k]} label={`About ${label}`} />}</SortableTableHeader>)}
            <TableHeader className="w-8"><span className="sr-only">Open</span></TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const open = r.label !== NO_LEAD && r.leads > 0 ? () => onOpen(r.label) : undefined;
            return (
              <TableRow key={r.label} onClick={open} tabIndex={open ? 0 : undefined} onKeyDown={open ? openOnKey(open) : undefined}
                aria-label={open ? `Show the leads for ${r.label}` : undefined}>
                <TableCell className="font-semibold text-slate-700">
                  {r.label}
                  {MISSING.includes(r.label) && <span className="ml-2 align-middle"><Badge variant="warning">Missing data</Badge></span>}
                  {r.label === NO_LEAD && <span className="ml-2 align-middle"><Badge variant="default">Calls with no live lead</Badge></span>}
                </TableCell>
                {cols.map(([k, , change]) => (
                  <TableCell key={k}>
                    {THIN_WHY[k] ? <Rate row={r} k={k} /> : r[k]}
                    {change && r.delta && <Delta value={r.delta[k]} was={r.prev[k]} />}
                  </TableCell>
                ))}
                <TableCell className="text-slate-300">{open && <ChevronRight size={16} aria-hidden="true" />}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {data.more > 0 && <p className="px-4 py-3 text-xs text-slate-500">Showing the top {data.rows.length}; {data.more} smaller groups are not listed (the Excel file has the same top {data.rows.length}).</p>}
      {data.unclassified_titles?.length > 0 && (
        <Hint>Titles that fit no {data.label.toLowerCase()} group (so far): {data.unclassified_titles.map((t) => `${t.title} (${t.leads})`).join(', ')}.</Hint>
      )}
    </>
  );
}

function AccountsTable({ data, stage, onStage, onOpen }) {
  const [rows, sort, toggle] = useSorted(data.rows, 'account');
  const s = data.summary;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4">
        <Tile label="Accounts worked" value={s.accounts.toLocaleString()} />
        <Tile label="People per account" value={s.people_per_account} />
        <Tile label="Spoke to 2+ people" value={s.spoke_to_two_or_more} />
        <Tile label="Meeting booked" value={s.stages['Meeting booked']} />
        <Tile label="Tried, not reached" value={s.stages['Tried, not reached']} />
      </div>
      <div className="px-4 pb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Click an account to see the people worked there.</p>
        <Select value={stage} onChange={onStage} ariaLabel="Show accounts at stage"
          options={[{ value: '', label: 'All stages' }, ...Object.entries(s.stages).map(([k, n]) => ({ value: k, label: `${k} (${n})` }))]} />
      </div>
      {rows.length === 0 ? <EmptyState title="No accounts at this stage" message="Pick another stage, or All stages." /> : (
        <Table>
          <TableHead>
            <TableRow>
              <SortableTableHeader label="Account" sortKey="account" sort={sort} onSort={toggle} />
              {ACCOUNT_COLS.map(([k, label]) => <SortableTableHeader key={k} label={label} sortKey={k} sort={sort} onSort={toggle}>{TIPS[k] && <InfoTip text={TIPS[k]} label={`About ${label}`} />}</SortableTableHeader>)}
              <SortableTableHeader label="Where it stands" sortKey="stage" sort={sort} onSort={toggle}><InfoTip text="Meeting booked; Spoke, no meeting (your follow-up list); Tried, not reached; or only emailed / noted." label="About Where it stands" /></SortableTableHeader>
              <TableHeader className="w-8"><span className="sr-only">Open</span></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} onClick={() => onOpen(r)} tabIndex={0} onKeyDown={openOnKey(() => onOpen(r))} aria-label={`Show the people at ${r.account}`}>
                <TableCell className="font-semibold text-slate-700">{r.account}</TableCell>
                {ACCOUNT_COLS.map(([k]) => <TableCell key={k}>{r[k]}</TableCell>)}
                <TableCell><Badge variant={STAGE_TONE[r.stage] || 'default'}>{r.stage}</Badge></TableCell>
                <TableCell className="text-slate-300"><ChevronRight size={16} aria-hidden="true" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {data.more > 0 && <p className="px-4 py-3 text-xs text-slate-500">Showing the top {data.rows.length}; {data.more} more accounts are not listed.</p>}
    </>
  );
}

function CallsView({ data }) {
  const best = Math.max(1, ...data.by_hour.map((h) => h.calls));
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4">
        <Tile label="Calls" value={data.total.toLocaleString()} />
        <Tile label="Conversations" value={data.conversations.toLocaleString()} />
        <Tile label="Connect rate" value={`${data.connect_rate}%`} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 px-4 pb-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">How calls ended</h4>
          <Table>
            <TableHead><TableRow><TableHeader>Outcome</TableHeader><TableHeader>Calls</TableHeader></TableRow></TableHead>
            <TableBody>
              {data.outcomes.map((o) => <TableRow key={o.outcome}><TableCell className="font-semibold text-slate-700">{o.outcome}</TableCell><TableCell>{o.calls}</TableCell></TableRow>)}
            </TableBody>
          </Table>
          <h4 className="text-sm font-semibold text-slate-700 mt-4 mb-2">How long conversations last</h4>
          <Table>
            <TableHead><TableRow><TableHeader>Length</TableHeader><TableHeader>Conversations</TableHeader></TableRow></TableHead>
            <TableBody>
              {data.conversation_lengths.map((l) => <TableRow key={l.band}><TableCell className="font-semibold text-slate-700">{l.band}</TableCell><TableCell>{l.conversations}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Calls by hour ({data.timezone})</h4>
          <Table>
            <TableHead><TableRow><TableHeader>Hour</TableHeader><TableHeader>Calls</TableHeader><TableHeader>Spoke</TableHeader><TableHeader>Connect %</TableHeader></TableRow></TableHead>
            <TableBody>
              {data.by_hour.map((h) => (
                <TableRow key={h.hour}>
                  <TableCell className="font-semibold text-slate-700">{hourLabel(h.hour)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded bg-blue-500" style={{ width: `${Math.max(4, Math.round((80 * h.calls) / best))}px` }} aria-hidden="true" />
                      {h.calls}
                    </div>
                  </TableCell>
                  <TableCell>{h.conversations}</TableCell>
                  <TableCell>{h.calls < 30 ? <span className="text-slate-400" title="Too few calls for this to mean much">{h.connect_rate}</span> : h.connect_rate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}

// The leads behind one row: what was done on each in the period, and a click through to the lead.
function LeadsModal({ target, range, podId, onClose }) {
  const [res, setRes] = useState(null);
  const from = range?.from;
  const to = range?.to;
  useEffect(() => {
    if (!target) return undefined;
    let off = false;
    setRes(null);
    DigestDrillService.leads({ from, to, pod_id: podId, ...target.params }).then((r) => { if (!off) setRes(r); });
    return () => { off = true; };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const openLead = (id) => { onClose(); window._loadView?.('lead-detail', id); };
  return (
    <Modal open={!!target} onClose={onClose} title={target?.title} maxWidth="max-w-4xl">
      {res === null ? <SkeletonTable rows={5} cols={6} />
        : res.error ? <EmptyState title="Could not load the leads" message={res.error} />
          : res.rows.length === 0 ? <EmptyState title="No leads" message="Nothing was worked on a lead here in this period." />
            : (
              <>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeader>Lead</TableHeader><TableHeader>Company</TableHeader><TableHeader>Title</TableHeader><TableHeader>Status</TableHeader>
                      <TableHeader>Calls</TableHeader><TableHeader>Spoke</TableHeader><TableHeader>Booked</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {res.rows.map((r) => (
                      <TableRow key={r.lead_id} onClick={() => openLead(r.lead_id)} tabIndex={0} onKeyDown={openOnKey(() => openLead(r.lead_id))}>
                        <TableCell className="font-semibold text-slate-700">{r.name}</TableCell>
                        <TableCell>{r.company}</TableCell>
                        <TableCell className="max-w-[220px] truncate" title={r.title}>{r.title}</TableCell>
                        <TableCell><Badge variant="default">{r.status}</Badge></TableCell>
                        <TableCell>{r.calls}</TableCell>
                        <TableCell>{r.conversations}</TableCell>
                        <TableCell>{r.booked ? <Badge variant="success">Yes</Badge> : ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="pt-3 text-xs text-slate-500">
                  {res.more > 0 ? `Showing the ${res.rows.length} most worked of ${res.total.toLocaleString()} leads.` : `${res.total.toLocaleString()} lead${res.total === 1 ? '' : 's'}.`} Click a lead to open it.
                </p>
              </>
            )}
    </Modal>
  );
}

function IcpDialog({ open, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError('');
    DigestDrillService.getIcp().then((r) => setText(r.keywords.join(', '))).catch((e) => setError(errorText(e)));
  }, [open]);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await DigestDrillService.setIcp(text.split(',').map((w) => w.trim()).filter(Boolean));
      toast('Ideal customer profile updated');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Ideal customer profile">
      <p className="text-sm text-slate-600 mb-3">
        A lead is in the ICP when its industry contains any of these words (not case-sensitive). Today it is healthcare, so the words cover
        health, hospitals, dental, medical, clinics, pharma and physicians. Change them when the target changes — every breakdown updates at once.
      </p>
      <Input label="Industry words, separated by commas" value={text} onChange={(e) => { setText(e.target.value); setError(''); }} placeholder="health, hospital, dental" />
      {error && <p className="text-sm text-red-600 mb-3" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

// Team Digest drill-downs: the same period, reps and definitions as the page, grouped by who the lead is, by account, and by call.
export function DrillDownSection({ podId, range }) {
  const rootRef = useRef(null);
  const seen = useSeen(rootRef);
  const [tab, setTab] = useState('segment');
  const [dimension, setDimension] = useState('icp');
  const [stage, setStage] = useState('');
  const [res, setRes] = useState({ key: '', view: '', data: null });
  const [icpOpen, setIcpOpen] = useState(false);
  const [target, setTarget] = useState(null);
  const [version, setVersion] = useState(0);
  const isSuper = window.__CRM_CURRENT_USER__?.role === 'Super Admin';
  const canExport = useCanExport();
  const [exporting, setExporting] = useState(false);
  const from = range?.from;
  const to = range?.to;

  // The answer is kept with the question it belongs to, so switching tab never renders one view's data in another view's table.
  const view = tab === 'segment' ? `segment|${dimension}` : tab;
  const key = [view, stage, from, to, podId, version].join('|');
  const data = res.key === key ? res.data : null;
  const stale = !data && res.view === view ? res.data : null;      // same view, new period: dim the old numbers instead of blanking the card

  useEffect(() => {
    if (!seen || !from || !to) return undefined;
    let off = false;
    const params = { from, to, pod_id: podId };
    const load = tab === 'segment' ? DigestDrillService.breakdown({ ...params, dimension })
      : tab === 'accounts' ? DigestDrillService.accounts({ ...params, stage })
        : DigestDrillService.calls({ ...params, ...(podId ? {} : { tz: browserZone() }) });
    load.then((r) => { if (!off) setRes({ key, view, data: r }); });
    return () => { off = true; };
  }, [seen, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const doExport = async () => {
    setExporting(true);
    try { await DigestDrillService.exportXlsx({ from, to, pod_id: podId, dimension }); } catch (e) { toast(errorText(e), 'error'); } finally { setExporting(false); }
  };
  const shown = data || stale;
  const empty = shown && !shown.error && (tab === 'calls' ? !shown.total : !shown.rows?.length && !(tab === 'accounts' && stage));
  const body = !shown ? <SkeletonTable rows={5} cols={7} />
    : shown.error ? <EmptyState title="Drill-down unavailable" message={shown.error} />
      : empty ? <EmptyState title="No activity" message="Nothing was called, emailed or booked in this period." />
        : tab === 'segment' ? <SegmentTable data={shown} onOpen={(label) => setTarget({ title: `${shown.label}: ${label}`, params: { dimension, segment: label } })} />
          : tab === 'accounts' ? <AccountsTable data={shown} stage={stage} onStage={setStage} onOpen={(r) => setTarget({ title: r.account, params: { account: r.key } })} />
            : <CallsView data={shown} />;

  return (
    <Card className="mb-5" data-tour="digest-drilldown">
      <div ref={rootRef} />
      <CardHeader
        title="Drill-down"
        subtitle="The period above, grouped by who the leads are, by account, or by call"
        actions={(
          <>
            {tab === 'segment' && <Select value={dimension} onChange={setDimension} ariaLabel="Break down by" options={DIMENSIONS} />}
            {tab === 'segment' && dimension === 'icp' && isSuper && (
              <Button size="sm" variant="outline" onClick={() => setIcpOpen(true)}><Settings2 size={14} /> Edit ICP</Button>
            )}
            {canExport && (
              <Button size="sm" variant="outline" onClick={doExport} disabled={exporting || !data || !!data.error}>
                <Download size={14} /> {exporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
          </>
        )}
      />
      <CardContent className="p-0">
        <Tabs tabs={TABS} active={tab} onChange={setTab} className="px-4" />
        <div className={`min-h-[240px] transition-opacity duration-150 ${!data && stale ? 'opacity-50' : 'opacity-100'}`} aria-busy={!data}>{body}</div>
      </CardContent>
      <IcpDialog open={icpOpen} onClose={() => setIcpOpen(false)} onSaved={() => setVersion((v) => v + 1)} />
      <LeadsModal target={target} range={range} podId={podId} onClose={() => setTarget(null)} />
    </Card>
  );
}
