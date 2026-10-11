import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonText } from '../../../components/ui/Skeleton';
import { DatePicker } from '../../../components/ui/DatePicker';
import { TimePicker } from '../../../components/ui/TimePicker';
import { TaskRow } from '../../../components/tasks/TaskRow';
import { isDone } from '../../../components/tasks/taskMeta';

/** The lead's tasks — the same TaskRow as My Tasks (v13.7.0), so a cadence
 *  approval reads and works identically in both places. */
export function TasksPanel({ tasks, canModify, loading, onAdd, onComplete, onDelete, onOutcome, onSendEmail, onSendSms, onSkip }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');

  const submit = () => {
    if (!title.trim()) return;
    // Same convention as the legacy page: due_time is only built (as a UTC
    // ISO instant) when BOTH a date and a time are given — a time alone has
    // no date to anchor it to (RCA 2026-09-28).
    const due_time = dueDate && dueTime ? new Date(`${dueDate}T${dueTime}:00`).toISOString() : null;
    onAdd?.(title.trim(), dueDate || null, due_time);
    setTitle(''); setDueDate(''); setDueTime('');
  };

  return (
    <Card>
      <CardHeader title="Tasks" />
      <CardContent>
        {loading && tasks.length === 0 ? (
          <SkeletonText lines={3} />
        ) : tasks.length === 0 ? (
          <div className="mb-3"><EmptyState title="No tasks yet." /></div>
        ) : (
          <div className="-mx-4 mb-3">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} disabled={!canModify}
                onToggleDone={(task) => onComplete?.(task.id, !isDone(task))}
                onOutcome={(task, key) => onOutcome?.(task.id, key)}
                onSendEmail={(task, subject, body) => onSendEmail?.(task.id, subject, body)}
                onSendSms={(task, message) => onSendSms?.(task.id, message)}
                onSkip={onSkip ? (task) => onSkip(task.id) : undefined}
                onDelete={canModify && onDelete ? (task) => onDelete(task.id) : undefined} />
            ))}
          </div>
        )}
        {canModify && (
          <div className="flex items-center gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Add a task…" aria-label="New task" containerClassName="mb-0 flex-1" />
            <DatePicker value={dueDate} onChange={setDueDate} placeholder="Due date" ariaLabel="Due date" />
            {dueDate && <TimePicker value={dueTime} onChange={setDueTime} ariaLabel="Due time" />}
            <Button size="sm" onClick={submit}>Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
