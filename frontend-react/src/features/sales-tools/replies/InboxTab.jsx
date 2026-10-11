import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Inbox, MessageSquareReply, ThumbsUp, Percent, MailWarning, Workflow, Users, AtSign, Target, AlertTriangle } from 'lucide-react';
import { InstantlyInboxService } from '../../../services/api';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Select } from '../../../components/ui/Select';
import { SearchInput } from '../../../components/ui/SearchInput';
import { DateRangePicker } from '../../../components/ui/DateRangePicker';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Pagination } from '../../../components/ui/Pagination';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Modal } from '../../../components/ui/Modal';
import { Skeleton, SkeletonStatCard } from '../../../components/ui/Skeleton';
import { StatStrip } from '../../activity-monitor/components/StatStrip';
import { exportCsv } from '../../activity-monitor/lib/exportCsv';
import { ReplyList } from './ReplyList';
import { ReplyReader } from './ReplyReader';
import { toast } from '../../../utils/toast';
import { errorMessage } from '../../../utils/errorMessage';
import { PER_PAGE, EMPTY_FILTERS, CSV_COLUMNS } from './lib';
import { useCanExport } from '../../../lib/useCanExport';

// Opening a reply marks it read only after it has stayed open this long, so arrowing
// through the list doesn't mark everything read.
const READ_AFTER_MS = 1500;

const SORT_OPTIONS = [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }];
const all = (label, rows, map) => [{ value: '', label }, ...rows.map(map)];

function useIsWide() {
  const q = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
  const [wide, setWide] = useState(q ? q.matches : true);
  useEffect(() => {
    if (!q) return undefined;
    const on = (e) => setWide(e.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, [q]);
  return wide;
}

export function InboxTab() {
  const [filters, setFilters] = useState(EMPTY_FILTERS); // applied
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState({ journeys: [], reps: [], mailboxes: [], intents: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const wide = useIsWide();

  useEffect(() => {
    // ponytail: filter options are a nicety — a failure just leaves the dropdowns empty.
    InstantlyInboxService.filters().then((f) => setOptions((o) => ({ ...o, ...f }))).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const params = { page, per_page: PER_PAGE };
    Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) params[k] = v; });
    InstantlyInboxService.replies(params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, page, attempt]);

  const items = data?.items || [];
  const summary = data?.summary || {};
  const open = items.find((r) => r.id === openId) || null;

  const apply = (next = draft) => { setFilters(next); setDraft(next); setPage(1); setOpenId(null); setActiveId(null); };
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  const applyUnread = useCallback((id, unread) => setData((d) => {
    const cur = d?.items.find((r) => r.id === id);
    if (!cur || cur.unread === unread) return d;
    return {
      ...d, items: d.items.map((r) => (r.id === id ? { ...r, unread } : r)),
      summary: { ...d.summary, unread: Math.max(0, (d.summary?.unread ?? 0) + (unread ? 1 : -1)) },
    };
  }), []);

  // Optimistic read/unread; the server has the last word (an implicit open by someone who
  // isn't the lead's rep is ignored, so it stays unread for the rep) and a failure reverts.
  const setRead = useCallback(async (item, read, implicit = false) => {
    applyUnread(item.id, !read);
    try {
      const res = await InstantlyInboxService.markRead(item.id, read, implicit);
      applyUnread(item.id, !res.read_at);
    } catch (e) {
      applyUnread(item.id, !!item.unread);
      toast(`Couldn't mark as ${read ? 'read' : 'unread'}: ${errorMessage(e)}`, 'error');
    }
  }, [applyUnread]);

  const openItem = useCallback((item) => { setActiveId(item.id); setOpenId(item.id); }, []);
  useEffect(() => {
    const cur = items.find((r) => r.id === openId);
    if (!cur?.unread) return undefined;
    const t = setTimeout(() => setRead(cur, true, true), READ_AFTER_MS);
    return () => clearTimeout(t);
  }, [openId, items, setRead]);
  // Desktop: moving the highlight opens the message; narrow: highlight only (Enter/click opens the modal).
  const activate = (item) => (wide ? openItem(item) : setActiveId(item.id));

  const canExport = useCanExport();
  const handleExport = () => exportCsv({ rows: items, columns: CSV_COLUMNS, filenamePrefix: 'instantly-replies' });

  const tiles = useMemo(() => [
    { label: 'Replies', value: (summary.replies ?? 0).toLocaleString(), icon: MessageSquareReply, iconClass: 'bg-blue-50 text-blue-600' },
    { label: 'Positive', value: (summary.positive ?? 0).toLocaleString(), icon: ThumbsUp, iconClass: 'bg-emerald-50 text-emerald-600' },
    { label: 'Reply rate', value: summary.reply_rate != null ? `${Math.round(summary.reply_rate * 10) / 10}%` : '—', icon: Percent, iconClass: 'bg-indigo-50 text-indigo-600' },
    { label: 'Unread', value: (summary.unread ?? 0).toLocaleString(), icon: MailWarning, iconClass: 'bg-amber-50 text-amber-600' },
  ], [summary]);

  const reader = open && <ReplyReader item={open} onToggleRead={(r) => setRead(r, !!r.unread)} onExport={canExport ? handleExport : undefined} />;
  const noneSynced = !error && !loading && data && items.length === 0 && (summary.sent ?? 0) === 0;

  return (
    <div className="space-y-4">
      {loading && !data
        ? <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}</div>
        : <StatStrip tiles={tiles} />}

      <Card className="p-4 hover:shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={draft.journey_id} onChange={set('journey_id')} options={all('All cadences', options.journeys, (j) => ({ value: j.id, label: j.name }))} placeholder="All cadences" icon={Workflow} searchable />
          <Select value={draft.rep_id} onChange={set('rep_id')} options={all('All reps', options.reps, (s) => ({ value: s.id, label: s.name }))} placeholder="All reps" icon={Users} searchable />
          <Select value={draft.mailbox} onChange={set('mailbox')} options={all('All mailboxes', options.mailboxes, (m) => ({ value: m, label: m }))} placeholder="All mailboxes" icon={AtSign} searchable />
          <Select value={draft.intent} onChange={set('intent')} options={all('All intents', options.intents, (i) => ({ value: i, label: i }))} placeholder="All intents" icon={Target} />
          <DateRangePicker from={draft.from} to={draft.to} onChange={({ from, to }) => setDraft((d) => ({ ...d, from, to }))} />
          <Select value={draft.sort} onChange={set('sort')} options={SORT_OPTIONS} placeholder="Sort" ariaLabel="Sort order" />
          <SearchInput
            value={draft.search}
            onChange={(e) => set('search')(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
            placeholder="Search lead, company or subject…"
            aria-label="Search replies"
            className="flex-1 min-w-[200px]"
          />
          <Checkbox className="px-1" checked={draft.status === 'unread'} onChange={(e) => apply({ ...draft, status: e.target.checked ? 'unread' : '' })} label="Unread only" />
          <Checkbox className="px-1" checked={draft.include_auto} onChange={(e) => set('include_auto')(e.target.checked)} label="Include out-of-office" />
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={() => apply()}>Apply</Button>
            <Button size="sm" variant="outline" onClick={() => apply(EMPTY_FILTERS)}>Reset</Button>
          </div>
        </div>
      </Card>

      {error ? (
        <div role="alert" className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm font-semibold">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">Couldn't load replies: {error}</span>
          <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
        </div>
      ) : loading && !data ? (
        <Card className="p-4 space-y-3 hover:shadow-sm" role="status" aria-label="Loading replies">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </Card>
      ) : items.length === 0 ? (
        <Card className="hover:shadow-sm">
          {noneSynced ? (
            <EmptyState icon={Inbox} title="No Instantly emails synced yet"
              message="Connect Instantly in Control Center → Integrations. Sent emails and replies appear here a few minutes after the first sync." />
          ) : (
            <EmptyState icon={Inbox} title="No replies match these filters" message="Widen the date range or reset the filters."
              action={<Button size="sm" variant="outline" onClick={() => apply(EMPTY_FILTERS)}>Reset filters</Button>} />
          )}
        </Card>
      ) : (
        <div className={`grid gap-4 ${wide ? 'grid-cols-[minmax(320px,2fr)_3fr]' : 'grid-cols-1'}`}>
          <Card className="p-2 hover:shadow-sm self-start">
            <ReplyList items={items} activeId={activeId} onActivate={activate} onOpen={openItem} />
            <div className="px-2 pb-2">
              <Pagination page={page} pages={data.pages} total={data.total} perPage={PER_PAGE} onChange={(p) => { setPage(p); setOpenId(null); setActiveId(null); }} />
            </div>
          </Card>
          {wide && (reader || (
            <Card className="hover:shadow-sm self-start">
              <EmptyState icon={Inbox} title="Select a reply" message="Pick a message on the left to read it here." />
            </Card>
          ))}
        </div>
      )}

      {!wide && (
        <Modal open={!!open} onClose={() => setOpenId(null)} title="Reply" maxWidth="max-w-2xl">{reader}</Modal>
      )}
    </div>
  );
}
