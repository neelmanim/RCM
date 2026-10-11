import React, { useState } from 'react';
import { Copy, Check, Send } from 'lucide-react';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Badge } from './ui/Badge';
import { RichTextEditor } from './ui/RichTextEditor';
import { isDone } from './tasks/taskMeta';

/** A cadence manual step's options, whichever shape they arrive in: the
 *  lead-tasks endpoint returns the raw JSON column, /my/tasks a parsed list. */
export function taskOutcomeOptions(task) {
  const raw = task?.outcome_options;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) || []; } catch { return []; }
}

/** How a finished cadence step ended, as a badge. */
function DoneBadge({ task, sentLabel }) {
  if (task.outcome === 'skipped') return <Badge>Skipped — nothing sent</Badge>;
  if (task.outcome === 'missed_deadline') return <Badge variant="warning">Deadline passed — skipped</Badge>;
  if (task.outcome === 'cadence_ended') return <Badge>Cadence ended</Badge>;
  return <Badge variant="success">{sentLabel}</Badge>;
}

/** Send / Skip footer shared by both approval cards. The error stays under
 *  the buttons and the draft stays editable, so a refused send loses nothing. */
function ApprovalFooter({ sendLabel, disabled, sending, onSend, onSkip, error }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={disabled || sending} onClick={onSend}>
          <Send size={13} /> {sending ? 'Sending…' : sendLabel}
        </Button>
        {onSkip && (
          <Button size="sm" variant="ghost" disabled={disabled || sending} onClick={onSkip}>Skip this step</Button>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-xs text-red-600">{error}</p>}
    </>
  );
}

function useSend(send) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const run = async (...args) => {
    setSending(true);
    setError(null);
    try {
      await send?.(...args);
    } catch (e) {
      setError(e?.message || 'Failed to send — try again.');
    } finally {
      setSending(false);
    }
  };
  return { sending, error, run };
}

/** v13.1.0 manual-email cadence step: the rep reviews and can edit the
 *  merge-resolved draft before it goes out. A formatted (HTML) draft is
 *  edited as formatted text — v13.7.0, it used to be a raw-HTML textarea. */
function ManualEmailApprovalCard({ task, disabled, onSend, onSkip }) {
  const [subject, setSubject] = useState(task.draft_subject || '');
  const [body, setBody] = useState(task.draft_body || '');
  const { sending, error, run } = useSend(onSend);
  if (isDone(task)) return <div className="mt-2"><DoneBadge task={task} sentLabel="Email sent" /></div>;

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <Input value={subject} disabled={disabled || sending} onChange={(e) => setSubject(e.target.value)}
        aria-label="Email subject" placeholder="Subject" containerClassName="mb-0" className="font-medium" />
      {task.draft_body_format === 'html' ? (
        <div className="rounded-lg border border-slate-200 bg-white" aria-label="Email body">
          <RichTextEditor value={body} onChange={setBody} allowTables disabled={disabled || sending} />
        </div>
      ) : (
        <Textarea value={body} disabled={disabled || sending} onChange={(e) => setBody(e.target.value)}
          aria-label="Email body" rows={6} />
      )}
      <ApprovalFooter sendLabel="Send email" disabled={disabled} sending={sending} error={error}
        onSend={() => run(subject, body)} onSkip={onSkip} />
    </div>
  );
}

const smsSegments = (n) => (n <= 160 ? 1 : Math.ceil(n / 153));

/** Feedback item #15: the SMS twin of ManualEmailApprovalCard. */
function ManualSmsApprovalCard({ task, disabled, onSend, onSkip }) {
  const [message, setMessage] = useState(task.draft_body || '');
  const { sending, error, run } = useSend(onSend);
  if (isDone(task)) return <div className="mt-2"><DoneBadge task={task} sentLabel="SMS sent" /></div>;

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <Textarea value={message} disabled={disabled || sending} onChange={(e) => setMessage(e.target.value)}
        aria-label="SMS message" rows={3}
        hint={`${message.length} characters · ${smsSegments(message.length)} SMS`} />
      <ApprovalFooter sendLabel="Send SMS" disabled={disabled} sending={sending} error={error}
        onSend={() => run(message)} onSkip={onSkip} />
    </div>
  );
}

/** What a rep needs to do a cadence manual step: the instructions or the
 *  pre-written LinkedIn message (with Copy — it gets pasted into LinkedIn),
 *  and the outcome buttons that finish the step and tell the cadence which
 *  way to go. Shared by the lead page's Tasks card and My Tasks. Renders
 *  nothing for ordinary tasks. */
export function CadenceTaskDetails({ task, disabled = false, onOutcome, onSendEmail, onSendSms, onSkip }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(null);
  if (task.kind === 'email_approval') {
    return <ManualEmailApprovalCard task={task} disabled={disabled} onSend={onSendEmail} onSkip={onSkip} />;
  }
  if (task.kind === 'sms_approval') {
    return <ManualSmsApprovalCard task={task} disabled={disabled} onSend={onSendSms} onSkip={onSkip} />;
  }
  const outcomes = taskOutcomeOptions(task);
  const done = isDone(task);
  const text = (task.description || '').trim();
  if (!text && outcomes.length === 0) {
    return done && task.outcome === 'skipped' ? <div className="mt-2"><DoneBadge task={task} /></div> : null;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — the text is still selectable */ }
  };

  const pick = async (key) => {
    setSaving(key);
    try { await onOutcome?.(key); } finally { setSaving(null); }
  };

  const picked = outcomes.find((o) => o.key === task.outcome);

  return (
    <div className="mt-2 space-y-2">
      {text && !done && (
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
          <p className="m-0 flex-1 text-sm text-slate-600 whitespace-pre-wrap">{text}</p>
          <IconButton onClick={copy} title="Copy" aria-label="Copy message">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </div>
      )}
      {done ? (
        (picked || task.outcome === 'skipped' || task.outcome === 'missed_deadline') && (
          picked ? <Badge variant="success">{picked.label}</Badge> : <DoneBadge task={task} />
        )
      ) : outcomes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {outcomes.map((o, i) => (
            <Button key={o.key} size="sm" variant={i === 0 ? 'primary' : 'outline'}
              disabled={disabled || saving !== null} onClick={() => pick(o.key)}>
              {saving === o.key ? 'Saving…' : o.label}
            </Button>
          ))}
          {onSkip && <Button size="sm" variant="ghost" disabled={disabled || saving !== null} onClick={onSkip}>Skip this step</Button>}
        </div>
      )}
    </div>
  );
}
