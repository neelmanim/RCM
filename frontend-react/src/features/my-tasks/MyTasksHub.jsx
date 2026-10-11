import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListTodo, Inbox, CheckCircle2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonText } from '../../components/ui/Skeleton';
import { SearchInput } from '../../components/ui/SearchInput';
import { Pagination } from '../../components/ui/Pagination';
import { TaskRow } from '../../components/tasks/TaskRow';
import { dueGroup, isApproval, tasksChanged } from '../../components/tasks/taskMeta';
import { TasksService, LeadsService } from '../../services/api';
import { MyTasksTour } from './MyTasksTour';
import { toast } from '../../utils/toast';

const PER_PAGE = 20;

// Order and wording of the To-do groups. Snoozed sits last: out of the way
// until its time comes, but not hidden so completely it looks lost.
const GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'none', label: 'No due date' },
  { key: 'snoozed', label: 'Snoozed' },
];


// Tells the nav badge and the bell to re-count straight away.

const errorText = (err, fallback) => err?.response?.data?.detail || fallback;

function Section({ label, count, children }) {
  return (
    <section className="mb-5">
      <h2 className="m-0 mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label} <span className="font-normal text-slate-400">· {count}</span>
      </h2>
      <Card className="p-0 overflow-visible">{children}</Card>
    </section>
  );
}

/** My Tasks — every task assigned to me, across every lead (v13.7.0 layout):
 *  Approvals (cadence drafts waiting on me to send — the cadence is paused on
 *  them), To do (grouped by when it's due), Done. The bell is the due-now
 *  nudge; this is the worklist a rep plans a day around. */
export function MyTasksHub({ onLeadClick, initialTab, navAt }) {
  const [tab, setTab] = useState(initialTab || null);   // null until we know if approvals exist
  const [open, setOpen] = useState(null);                // null = loading
  const [done, setDone] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState(null);

  const loadOpen = useCallback(() => {
    setLoadError(null);
    return TasksService.getMine('open').then(setOpen).catch(() => setLoadError('Check your connection, then refresh the page.'));
  }, []);
  const loadDone = useCallback(() => {
    setLoadError(null);
    return TasksService.getMine('done').then(setDone).catch(() => setLoadError('Check your connection, then refresh the page.'));
  }, []);

  // Every navigation here (the bell, the nav) stamps navAt, so a repeat click
  // while mounted still switches tab and refreshes — initialTab alone may not
  // change. The first render already has the tab and loads once.
  const firstNav = useRef(true);
  useEffect(() => {
    if (!firstNav.current && initialTab) setTab(initialTab);
    firstNav.current = false;
    loadOpen();
  }, [navAt, initialTab, loadOpen]);
  useEffect(() => { if (tab === 'done' && done === null) loadDone(); }, [tab, done, loadDone]);
  useEffect(() => { setPage(1); }, [tab, search]);

  const q = search.trim().toLowerCase();
  const matches = useCallback((t) => !q || [t.title, t.lead_name, t.lead_company].some((v) => v?.toLowerCase().includes(q)), [q]);
  const approvals = useMemo(() => (open || []).filter(isApproval), [open]);
  const todo = useMemo(() => (open || []).filter((t) => !isApproval(t)), [open]);
  const activeTab = tab || (approvals.length ? 'approvals' : 'todo');

  const after = (message) => {
    toast(message, 'success');
    tasksChanged();
    loadOpen();
    if (done !== null) loadDone();
  };

  const handlers = {
    onLeadClick,
    // Optimistic: a checkbox that waits for the round-trip reads as broken.
    onToggleDone: async (task) => {
      const flip = (to) => (list) => list && list.map((t) => (t.id === task.id ? { ...t, done: to } : t));
      setOpen(flip(!task.done));
      setDone(flip(!task.done));
      try {
        await LeadsService.patchTask(task.lead_id, task.id, { done: !task.done });
        after(task.done ? 'Task reopened' : 'Task done');
      } catch (err) {
        setOpen(flip(task.done));
        setDone(flip(task.done));
        toast(errorText(err, 'Couldn’t update the task — try again.'), 'error');
      }
    },
    onOutcome: async (task, outcome) => {
      try {
        await LeadsService.patchTask(task.lead_id, task.id, { done: true, outcome });
        after('Saved — the cadence moves on');
      } catch (err) { toast(errorText(err, 'Couldn’t save the outcome — try again.'), 'error'); }
    },
    // Errors are re-thrown so the draft card shows them under Send and keeps the draft.
    onSendEmail: async (task, subject, body) => {
      try { await LeadsService.patchTask(task.lead_id, task.id, { done: true, subject, body }); }
      catch (err) { throw new Error(errorText(err, 'Couldn’t send — try again.')); }
      after(`Email to ${task.lead_name} is on its way`);
    },
    onSendSms: async (task, message) => {
      try { await LeadsService.patchTask(task.lead_id, task.id, { done: true, message }); }
      catch (err) { throw new Error(errorText(err, 'Couldn’t send — try again.')); }
      after(`SMS to ${task.lead_name} is on its way`);
    },
    onSkip: async (task) => {
      try {
        await LeadsService.skipTask(task.lead_id, task.id);
        after(`Skipped — ${task.lead_name} moves to the next step`);
      } catch (err) { toast(errorText(err, 'Couldn’t skip the step — try again.'), 'error'); }
    },
    onSnooze: async (task, when) => {
      try {
        await TasksService.snooze(task.id, when);
        after(when.until ? 'Snoozed until tomorrow 9 am' : 'Snoozed for 1 hour');
      } catch (err) { toast(errorText(err, 'Couldn’t snooze — try again.'), 'error'); }
    },
    onDelete: async (task) => {
      try {
        await LeadsService.deleteTask(task.lead_id, task.id);
        after('Task deleted');
      } catch (err) { toast(errorText(err, 'Couldn’t delete the task — try again.'), 'error'); }
    },
  };

  const rows = (list) => list.map((t) => <TaskRow key={t.id} task={t} showLead {...handlers} />);

  const tabs = [
    { key: 'approvals', label: `Approvals${approvals.length ? ` (${approvals.length})` : ''}`, icon: Inbox },
    { key: 'todo', label: `To do${todo.length ? ` (${todo.length})` : ''}`, icon: ListTodo },
    { key: 'done', label: 'Done', icon: CheckCircle2 },
  ];

  let body;
  if (loadError) {
    body = <EmptyState icon={ListTodo} title="Couldn’t load your tasks" message={loadError} />;
  } else if (open === null || (activeTab === 'done' && done === null)) {
    body = <Card className="p-4"><SkeletonText lines={5} /></Card>;
  } else if (activeTab === 'approvals') {
    const list = approvals.filter(matches);
    body = list.length
      ? <Section label="Waiting for you to send" count={list.length}>{rows(list)}</Section>
      : <EmptyState icon={Inbox} title={q ? 'No approvals match your search' : 'No approvals waiting'}
          message="When a cadence step is set to send only after your review, its draft appears here." />;
  } else if (activeTab === 'todo') {
    const now = new Date();
    const list = todo.filter(matches);
    body = list.length
      ? GROUPS.map((g) => {
        const items = list.filter((t) => dueGroup(t, now) === g.key);
        return items.length ? <Section key={g.key} label={g.label} count={items.length}>{rows(items)}</Section> : null;
      })
      : <EmptyState icon={ListTodo} title={q ? 'No tasks match your search' : 'Nothing to do right now'}
          message="Tasks you add on a lead, and cadence steps like LinkedIn requests or calls, show up here." />;
  } else {
    const list = done.filter(matches);
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    body = list.length ? (
      <>
        <Card className="p-0 overflow-visible">{rows(list.slice((page - 1) * PER_PAGE, page * PER_PAGE))}</Card>
        <Pagination page={page} pages={pages} total={list.length} perPage={PER_PAGE} onChange={setPage} />
      </>
    ) : <EmptyState icon={CheckCircle2} title={q ? 'No completed tasks match your search' : 'Nothing completed yet'} />;
  }

  return (
    <div className="my-tasks-hub max-w-4xl mx-auto p-6">
      <MyTasksTour />
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 m-0">My Tasks</h1>
          <p className="text-sm text-slate-500 mt-1 mb-0">Everything waiting on you, across every lead.</p>
        </div>
        <SearchInput placeholder="Search tasks or leads…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-64" aria-label="Search tasks" />
      </div>
      <div data-tour="task-status-filter">
        <Tabs tabs={tabs} active={activeTab} onChange={setTab} className="mb-5" />
      </div>
      <div data-tour="task-list">{body}</div>
    </div>
  );
}
