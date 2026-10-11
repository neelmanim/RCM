import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonText } from '../../../components/ui/Skeleton';
import { fmtDateTime as fmtDate } from '../lib/formatDate';

// Backend has no note-edit endpoint (create/delete only) — matches legacy.
export function NotesPanel({ notes, canModify, loading, onAdd, onDelete }) {
  const [content, setContent] = useState('');

  const submit = () => {
    if (!content.trim()) return;
    onAdd?.(content.trim());
    setContent('');
  };

  return (
    <Card>
      <CardHeader title="Notes" />
      <CardContent>
        {canModify && (
          <div className="mb-3">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Add a note about this lead…"
              rows={2}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-focus-ring resize-none"
            />
            <div className="text-right mt-1.5">
              <Button size="sm" onClick={submit}>Save Note</Button>
            </div>
          </div>
        )}
        {loading && notes.length === 0 ? (
          <SkeletonText lines={2} />
        ) : notes.length === 0 ? (
          <EmptyState title="No notes yet." />
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <div key={n.id} className="text-sm border-t border-slate-50 pt-2 group flex items-start justify-between gap-2">
                <div>
                  <p className="text-slate-700 m-0">{n.content}</p>
                  <p className="text-xs text-slate-400 m-0">{n.author} · {fmtDate(n.created_at)}</p>
                </div>
                {canModify && (
                  <button type="button" onClick={() => onDelete?.(n.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 shrink-0">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
