import React, { useCallback, useEffect, useState } from 'react';
import { Inbox, Activity, Phone, StickyNote, ArrowRightLeft, Mail, Download, RotateCw } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { DatePicker } from '../../components/ui/DatePicker';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonTable } from '../../components/ui/Skeleton';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/ui/Table';
import { MyDayService } from '../../services/api';
import { useCanExport } from '../../lib/useCanExport';

const PER_PAGE = 10;

const KINDS = [
  { key: '', label: 'All' },
  { key: 'call', label: 'Calls', icon: Phone, variant: 'info' },
  { key: 'note', label: 'Notes', icon: StickyNote, variant: 'default' },
  { key: 'status', label: 'Moves', icon: ArrowRightLeft, variant: 'purple' },
  { key: 'email', label: 'Emails', icon: Mail, variant: 'indigo' },
];
const KIND_META = Object.fromEntries(KINDS.filter((k) => k.key).map((k) => [k.key, k]));

const timeLabel = (iso) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
};
const isoDay = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * "My Day" — what was given to me and what I did, for today or yesterday, paged on the server so every row is
 * reachable, with the whole day exportable as CSV. Owns its own fetching; reports today's summary up (onSummary)
 * so the Dashboard's cards need no second request.
 */
export function MyDayCard({ onLeadClick, onSummary, refreshKey = 0 }) {
  const [pickedDate, setPickedDate] = useState('');   // '' = today, else 'YYYY-MM-DD' (any past day)
  const [tab, setTab] = useState('given');            // 'given' | 'did'
  const [kind, setKind] = useState('');               // '' = all
  const [givenPage, setGivenPage] = useState(1);
  const [didPage, setDidPage] = useState(1);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');      // loading | ok | error
  const [exporting, setExporting] = useState(false);
  const canExport = useCanExport();

  const isToday = !pickedDate;
  const date = pickedDate || undefined;
  const word = isToday ? 'today' : pickedDate === isoDay(-1) ? 'yesterday' : `on ${new Date(`${pickedDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await MyDayService.get({
        ...(date ? { date } : {}), ...(kind ? { kind } : {}),
        given_page: givenPage, did_page: didPage, per_page: PER_PAGE,
      });
      setData(res);
      setState('ok');
      if (isToday) onSummary?.(res);
    } catch {
      setState('error');
    }
  }, [date, kind, givenPage, didPage, isToday, onSummary]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const changeDay = (next) => { setPickedDate(next); setGivenPage(1); setDidPage(1); setKind(''); };
  const changeKind = (next) => { setKind(next); setDidPage(1); };

  const exportDay = async () => {
    setExporting(true);
    try { await MyDayService.exportCsv(date); }
    catch { window.dispatchEvent(new CustomEvent('alternate:toast', { detail: { message: "Couldn't export just now — please try again.", type: 'error' } })); }
    finally { setExporting(false); }
  };

  const given = data?.given;
  const did = data?.did;
  const tabs = [
    { key: 'given', label: `Given to me${given ? ` (${given.total.toLocaleString()})` : ''}`, icon: Inbox },
    { key: 'did', label: `What I did${did ? ` (${did.leads_worked.toLocaleString()} leads)` : ''}`, icon: Activity },
  ];

  return (
    <Card data-testid="my-day">
      <CardHeader
        title="My Day"
        subtitle={`Leads given to you and what you did ${word}`}
        actions={(
          <>
            <div className="flex items-center gap-1" role="group" aria-label="Day">
              <Button size="sm" variant={isToday ? 'primary' : 'outline'} onClick={() => changeDay('')}>Today</Button>
              <Button size="sm" variant={pickedDate === isoDay(-1) ? 'primary' : 'outline'} onClick={() => changeDay(isoDay(-1))}>Yesterday</Button>
              <DatePicker value={pickedDate && pickedDate !== isoDay(-1) ? pickedDate : ''} onChange={(d) => changeDay(d === isoDay(0) ? '' : d)}
                max={isoDay(0)} placeholder="Pick a date" ariaLabel="Pick a date for My Day" />
            </div>
            {canExport && (
              <Button size="sm" variant="outline" onClick={exportDay} disabled={exporting || state !== 'ok'} title="Download the whole day as a CSV">
                <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            )}
          </>
        )}
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} className="px-3" />

      <div className="px-5 pt-3 pb-4">
        {tab === 'given' && given && (
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-slate-500">
            <Badge variant="primary">{given.assigned.toLocaleString()} assigned to you</Badge>
            <Badge variant="purple">{given.reset.toLocaleString()} reset to Lead Assigned</Badge>
          </div>
        )}
        {tab === 'did' && did && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3" role="group" aria-label="Activity type">
            {KINDS.map((k) => {
              const count = k.key ? did.by_kind?.[k.key] ?? 0 : Object.values(did.by_kind || {}).reduce((a, b) => a + b, 0);
              const Icon = k.icon;
              return (
                <Button key={k.key || 'all'} size="sm" variant={kind === k.key ? 'primary' : 'outline'} onClick={() => changeKind(k.key)}>
                  {Icon && <Icon size={13} />} {k.label} <span className="opacity-70">{count.toLocaleString()}</span>
                </Button>
              );
            })}
          </div>
        )}

        {state === 'loading' && <SkeletonTable rows={5} cols={4} />}
        {state === 'error' && (
          <EmptyState icon={RotateCw} title="Couldn't load this just now" message="Check your connection and try again."
            action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>} />
        )}
        {state === 'ok' && tab === 'given' && (given.leads.length === 0
          ? <EmptyState icon={Inbox} title={`Nothing was given to you ${word}`} message="New assignments and leads reset to Lead Assigned show up here." />
          : (
            <>
              <Table>
                <TableHead><TableRow>
                  <TableHeader>Lead</TableHeader><TableHeader>Status now</TableHeader><TableHeader>Why</TableHeader><TableHeader className="text-right">Time</TableHeader>
                </TableRow></TableHead>
                <TableBody>
                  {given.leads.map((l) => (
                    <TableRow key={l.id} onClick={() => onLeadClick?.(l.id)} className="cursor-pointer">
                      <TableCell><div className="font-semibold text-slate-800">{l.name}</div><div className="text-xs text-slate-400">{l.company || '—'}</div></TableCell>
                      <TableCell><Badge>{l.status}</Badge></TableCell>
                      <TableCell><Badge variant={l.reason === 'Assigned to you' ? 'primary' : 'purple'}>{l.reason}</Badge></TableCell>
                      <TableCell className="text-right text-slate-400">{timeLabel(l.at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={given.page} pages={given.pages} total={given.total} perPage={given.per_page} onChange={setGivenPage} />
            </>
          ))}
        {state === 'ok' && tab === 'did' && (did.activity.length === 0
          ? <EmptyState icon={Activity} title={kind ? `No ${KIND_META[kind].label.toLowerCase()} ${word}` : `Nothing logged ${word} yet`} message="Calls, notes, status moves and emails you make appear here." />
          : (
            <>
              <Table>
                <TableHead><TableRow>
                  <TableHeader>Time</TableHeader><TableHeader>Lead</TableHeader><TableHeader>Activity</TableHeader>
                </TableRow></TableHead>
                <TableBody>
                  {did.activity.map((a, i) => {
                    const meta = KIND_META[a.kind];
                    const Icon = meta?.icon;
                    return (
                      <TableRow key={`${a.lead_id}-${a.at}-${i}`} onClick={() => onLeadClick?.(a.lead_id)} className="cursor-pointer">
                        <TableCell className="text-slate-400">{timeLabel(a.at)}</TableCell>
                        <TableCell><div className="font-semibold text-slate-800">{a.lead}</div><div className="text-xs text-slate-400">{a.company || '—'}</div></TableCell>
                        <TableCell><Badge variant={meta?.variant}>{Icon && <Icon size={12} className="mr-1" />}{a.text}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination page={did.page} pages={did.pages} total={did.activity_total} perPage={did.per_page} onChange={setDidPage} />
            </>
          ))}
      </div>
    </Card>
  );
}
