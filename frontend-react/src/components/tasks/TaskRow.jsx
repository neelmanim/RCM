import React, { useState } from 'react';
import { MoreHorizontal, Clock, ExternalLink, SkipForward, Trash2 } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { IconButton } from '../ui/IconButton';
import { ConfirmDialog } from '../ui/Modal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/DropdownMenu';
import { CadenceTaskDetails } from '../CadenceTaskDetails';
import { describeDue, isApproval, isDone, splitTitle, taskKind } from './taskMeta';

const TONE = { danger: 'text-red-600 font-medium', warning: 'text-amber-600 font-medium', muted: 'text-slate-500' };

const tomorrowNine = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

/** One task, the same everywhere a rep works tasks (My Tasks, the lead page).
 *  Every handler is optional — an action only shows when its handler is
 *  given: `showLead` adds the lead's avatar + name (My Tasks; on the lead
 *  page it's redundant), `onSnooze` only where the task is the viewer's own.
 *  Cadence steps get "Skip this step" (moves the lead on) instead of Delete,
 *  which used to leave the cadence waiting on a task that no longer existed. */
export function TaskRow({
  task, showLead = false, disabled = false,
  onLeadClick, onToggleDone, onOutcome, onSendEmail, onSendSms, onSkip, onSnooze, onDelete,
}) {
  const [confirm, setConfirm] = useState(null);   // 'skip' | 'delete' | null
  const [busy, setBusy] = useState(false);
  const done = isDone(task);
  const cadenceStep = Boolean(task.from_cadence || task.journey_enrollment_id);
  const { cadence, title } = splitTitle(task.title);
  const kind = taskKind(task);
  const due = describeDue(task);
  const canSkip = cadenceStep && !done && onSkip && !disabled;
  const canDelete = !cadenceStep || done;
  // Not for approvals: the cadence is paused on them, so hiding one from the
  // bell and badge would hide that.
  const canSnooze = onSnooze && !done && !isApproval(task);

  const runConfirmed = async () => {
    setBusy(true);
    try {
      await (confirm === 'skip' ? onSkip(task) : onDelete(task));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const menu = [
    canSnooze && { key: 'snooze1h', icon: Clock, label: 'Snooze 1 hour', run: () => onSnooze(task, { minutes: 60 }) },
    canSnooze && { key: 'snoozeTomorrow', icon: Clock, label: 'Snooze until tomorrow 9 am', run: () => onSnooze(task, { until: tomorrowNine() }) },
    showLead && onLeadClick && { key: 'open', icon: ExternalLink, label: 'Open lead', run: () => onLeadClick(task.lead_id) },
    canSkip && { key: 'skip', icon: SkipForward, label: 'Skip this step', run: () => setConfirm('skip') },
    onDelete && canDelete && !disabled && { key: 'delete', icon: Trash2, label: 'Delete task', danger: true, run: () => setConfirm('delete') },
  ].filter(Boolean);

  return (
    <div className="flex items-start gap-3 px-4 py-3.5 border-b border-slate-100 last:border-0" data-tour="task-row">
      {showLead && <Avatar name={task.lead_name || '?'} size={32} className="mt-0.5 shrink-0" />}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {!isApproval(task) && onToggleDone && (
            <Checkbox checked={done} disabled={disabled} onChange={() => onToggleDone(task)} aria-label={`Mark "${title}" done`} />
          )}
          <span className={`text-sm font-semibold ${done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{title}</span>
          {kind && <Badge variant={kind.variant}>{kind.label}</Badge>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-xs text-slate-500">
          {showLead && (
            <Button variant="ghost" size="sm" onClick={() => onLeadClick?.(task.lead_id)}
              className="!px-1 !py-0 -ml-1 !font-medium !text-xs !text-slate-600 hover:!text-blue-700">
              {task.lead_name}{task.lead_company ? ` · ${task.lead_company}` : ''}
            </Button>
          )}
          {cadence && <span>{showLead ? '· ' : ''}{cadence}</span>}
          {due && <span className={TONE[due.tone]}>{showLead || cadence ? '· ' : ''}{due.text}</span>}
        </div>
        <CadenceTaskDetails task={task} disabled={disabled}
          onOutcome={(key) => onOutcome?.(task, key)}
          onSendEmail={(subject, body) => onSendEmail?.(task, subject, body)}
          onSendSms={(message) => onSendSms?.(task, message)}
          onSkip={canSkip ? () => setConfirm('skip') : undefined} />
      </div>

      {menu.length > 0 && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="Task actions" title="More actions"><MoreHorizontal size={16} /></IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((m) => (
              <DropdownMenuItem key={m.key} onSelect={m.run} className={m.danger ? 'text-red-600' : ''}>
                <m.icon size={14} /> {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'skip' ? 'Skip this step?' : 'Delete this task?'}
        message={confirm === 'skip'
          ? `${task.lead_name || 'The lead'} moves on to the next step of the cadence. ${isApproval(task) ? 'This draft is not sent.' : ''}`
          : 'This removes the task for good.'}
        confirmLabel={confirm === 'skip' ? 'Skip step' : 'Delete'}
        confirmVariant={confirm === 'delete' ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
