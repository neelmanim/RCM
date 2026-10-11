import React from 'react';
import { X, Trash2, Plus, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Checkbox } from '../../components/ui/Checkbox';
import { MailboxPicker, mailboxSummary } from '../../components/MailboxPicker';
import { Modal } from '../../components/ui/Modal';
import { STATUSES } from '../leads-hub/constants';
import { useJourneyStore } from './store/useJourneyStore';
import { SalesJourneyService, ConversationsService } from '../../services/api';
import { toast } from './toast';
import { EmailPreview, MessagePreview } from './EmailPreview';
import { MergeFieldComposer } from '../../components/ui/MergeFieldComposer';
import {
  NODE_LABELS, CONDITION_EVENT_TYPES, ENTRY_TRIGGER_EVENT_TYPES, EMAIL_MERGE_FIELDS, SMS_MAX_LENGTH, SMS_SEGMENT_LENGTH,
  TASK_KINDS, LINKEDIN_CONNECT_OUTCOMES, FIELD_RULE_FIELDS, FIELD_RULE_OPS,
} from './nodeDefaults';

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

const selectClass = 'w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white ' +
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none';

// Node ids are auto-generated (n<timestamp>_<counter>) and meaningless to a user —
// show "Email #2" instead, numbered only when a type repeats so a single Wait
// node just reads "Wait", not "Wait #1".
export function labelForNode(node, allNodes) {
  const sameType = allNodes.filter((n) => n.type === node.type);
  const idx = sameType.findIndex((n) => n.id === node.id);
  const suffix = sameType.length > 1 ? ` #${idx + 1}` : '';
  return `${NODE_LABELS[node.type] || node.type}${suffix}`;
}

function TriggerFields({ node, update }) {
  const event = node.data.event || 'status_changed';
  return (
    <>
      <Field label="Enroll a lead when…">
        <Select
          className="w-full justify-between"
          ariaLabel="Enroll a lead when…"
          value={event}
          onChange={(v) => update({ event: v, to_status: undefined })}
          options={ENTRY_TRIGGER_EVENT_TYPES}
        />
      </Field>
      {event === 'status_changed' && (
        <Field label="Status">
          <Select
            className="w-full justify-between"
            ariaLabel="Status"
            value={node.data.to_status || ''}
            onChange={(v) => update({ to_status: v })}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
            placeholder="Select a status…"
            searchable
          />
        </Field>
      )}
    </>
  );
}

// Subject + body + merge-field chips, shared by the plain single-email case
// and each A/B variant below — same caret-tracking insert-at-cursor behavior
// either way, just pointed at a different piece of node.data.
// v10.9.9 — reuses the same Groq config Smart Analytics already resolves
// (backend/journey_engine/ai_copy.py); this is the one call site, embedded
// directly in SubjectBodyEditor so both the plain email case and every A/B
// variant get it for free, no separate wiring per caller.
function AIGenerateButton({ onGenerated }) {
  const [open, setOpen] = React.useState(false);
  const [prompt, setPrompt] = React.useState('');
  const [generating, setGenerating] = React.useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const result = await SalesJourneyService.generateEmail(prompt.trim());
      onGenerated(result);
      setOpen(false);
      setPrompt('');
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to generate — please try again.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 mb-2"
      >
        <Sparkles size={12} /> Generate with AI
      </button>
    );
  }

  return (
    <div className="mb-3 p-2.5 rounded-lg border border-indigo-100 bg-indigo-50/50">
      <input
        type="text"
        autoFocus
        className="w-full px-2.5 py-1.5 rounded-md text-sm border border-slate-200 bg-white outline-none focus:border-indigo-400 mb-2"
        placeholder="e.g. Follow-up after a demo no-show"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate(); }}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={handleGenerate} disabled={generating || !prompt.trim()}>
          {generating ? 'Generating…' : 'Generate'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={generating}>Cancel</Button>
      </div>
    </div>
  );
}

function SubjectBodyEditor({ subjectLabel, subject, body, onSubjectChange, onBodyChange, onGenerated }) {
  const bodyRef = React.useRef(null);
  // null = the body hasn't actually been clicked/typed into yet this render —
  // default to the end of the text rather than jsdom/browsers' 0 default for
  // a never-focused textarea, which would silently prepend to existing text.
  const lastCaretRef = React.useRef(null);
  const trackCaret = () => {
    if (bodyRef.current) lastCaretRef.current = bodyRef.current.selectionStart;
  };

  // Insert at wherever the cursor last was (falling back to the end if the
  // body was never focused) rather than always appending — and re-focus
  // with the cursor placed right after the inserted text, so clicking a chip
  // is visibly confirmed instead of possibly landing off-screen below a full
  // textarea with nothing drawing the eye back to it.
  const insertField = (field) => {
    const el = bodyRef.current;
    const current = body || '';
    const pos = lastCaretRef.current ?? current.length;
    const insertion = `{{${field}}}`;
    const next = current.slice(0, pos) + insertion + current.slice(pos);
    onBodyChange(next);

    const caretPos = pos + insertion.length;
    lastCaretRef.current = caretPos;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caretPos, caretPos);
    });
  };

  return (
    <>
      <AIGenerateButton onGenerated={onGenerated} />
      <Input label={subjectLabel} value={subject || ''} onChange={(e) => onSubjectChange(e.target.value)} />
      <Field label="Body">
        <textarea
          ref={bodyRef}
          className={`${selectClass} min-h-[140px] resize-y`}
          value={body || ''}
          onChange={(e) => { onBodyChange(e.target.value); trackCaret(); }}
          onSelect={trackCaret}
          onClick={trackCaret}
          onKeyUp={trackCaret}
          placeholder="Hi {{first_name}}, …"
        />
      </Field>
      <div className="-mt-2 mb-4">
        <div className="text-xs text-slate-400 mb-1.5">Merge fields — click to insert into the body:</div>
        <div className="flex flex-wrap gap-1.5">
          {EMAIL_MERGE_FIELDS.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => insertField(field)}
              className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-700 text-xs font-mono transition-colors cursor-pointer"
            >
              {`{{${field}}}`}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Plain body → HTML paragraphs (blank line = new paragraph, newline = <br>). */
export function textToHtml(text) {
  if (!text.trim()) return '';
  return text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}
/** HTML body → plain text, keeping paragraph breaks. */
export function htmlToText(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|tr|li|h\d)>/gi, '$&\n\n'), 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Rich-text variant of SubjectBodyEditor — the same MergeFieldComposer
 *  Email Campaigns use, with tables on (paste a table from Google Docs, or
 *  insert one). AI drafts arrive as plain text and are converted. */
function FormattedEmailEditor({ subject, body, onSubjectChange, onBodyChange, onGenerated }) {
  return (
    <>
      <AIGenerateButton onGenerated={(r) => onGenerated({ ...r, body: textToHtml(r.body || '') })} />
      <div className="space-y-2 mb-4">
        <MergeFieldComposer subject={subject} onSubjectChange={onSubjectChange}
          body={body} onBodyChange={onBodyChange} allowTables bodyPlaceholder="Hi {{first_name}}, …" />
      </div>
    </>
  );
}

// Feedback #6/#7: a manual step can be marked "hard stop" so it waits for
// the rep indefinitely instead of auto-advancing on a missed deadline.
// Shared by every manual/task step's deadline config (email manual, SMS
// manual, and the plain Task step). `nodeOptions` is optional — the Task
// step doesn't expose a "go to" select for its timeout branch today.
function DeadlineField({ node, update, nodeOptions }) {
  const hardStop = !!node.data.hard_stop;
  return (
    <>
      <Checkbox
        className="font-medium text-slate-700 mb-2"
        checked={hardStop}
        onChange={(e) => update({ hard_stop: e.target.checked || undefined, due_within_hours: e.target.checked ? undefined : node.data.due_within_hours })}
        label="Hard stop — wait for the rep indefinitely (never auto-advance)"
      />
      {!hardStop && (
        <Input label="Deadline (hours)" type="number" min="1" value={node.data.due_within_hours ?? 24}
          onChange={(e) => update({ due_within_hours: Number(e.target.value) })}
          hint="The cadence waits for the rep this long, then continues without them." />
      )}
      {!hardStop && nodeOptions && (
        <Field label="If the deadline passes, go to">
          <Select className="w-full justify-between" ariaLabel="If the deadline passes, go to"
            value={node.data.branch_on_timeout || ''} onChange={(v) => update({ branch_on_timeout: v || undefined })}
            options={nodeOptions} placeholder="default: next step" />
        </Field>
      )}
    </>
  );
}

const VARIANT_LABELS = ['Variant A', 'Variant B'];

function EmailFields({ node, update, otherNodes, allNodes }) {
  const variants = node.data.variants;
  const abEnabled = !!variants?.length;
  const isManual = node.data.send_mode === 'manual';
  const nodeOptions = otherNodes.map((n) => ({ value: n.id, label: labelForNode(n, allNodes) }));

  const toggleManual = (on) => update({
    send_mode: on ? 'manual' : undefined,
    // A human reviews every manual send individually — A/B testing doesn't
    // apply once a person is already customizing each one.
    ...(on && variants?.length ? { variants: null } : {}),
  });

  const toggleAb = (enabled) => {
    if (enabled) {
      update({
        variants: [
          { key: 'A', subject: node.data.subject || '', body: node.data.body || '' },
          { key: 'B', subject: '', body: '' },
        ],
      });
    } else {
      update({ variants: null });
    }
  };

  const updateVariant = (index, patch) => {
    const next = variants.map((v, i) => (i === index ? { ...v, ...patch } : v));
    update({ variants: next });
  };

  // v13.0.0: "formatted" = rich-text HTML body (tables, bold, links) sent as
  // HTML (email_channel body_format). Switching converts every body so
  // nothing already written is lost.
  const isHtml = node.data.body_format === 'html';
  const toggleFormatted = (on) => {
    const convert = on ? textToHtml : htmlToText;
    update({
      body_format: on ? 'html' : undefined,
      body: convert(node.data.body || ''),
      ...(variants?.length ? { variants: variants.map((v) => ({ ...v, body: convert(v.body || '') })) } : {}),
    });
  };
  const Editor = isHtml ? FormattedEmailEditor : SubjectBodyEditor;

  return (
    <>
      <Checkbox
        className="font-medium text-slate-700 mb-2"
        checked={isHtml}
        onChange={(e) => toggleFormatted(e.target.checked)}
        label="Formatted email (tables, bold, links)"
      />
      <Checkbox
        className="font-medium text-slate-700"
        checked={isManual}
        onChange={(e) => toggleManual(e.target.checked)}
        label="Require rep approval before sending (manual)"
      />
      <div className="text-xs text-slate-400 mt-0.5 mb-3">
        The cadence pauses here — the lead's rep reviews, can edit, and sends. Never auto-sends on a missed deadline.
      </div>
      {isManual && <DeadlineField node={node} update={update} nodeOptions={nodeOptions} />}
      {!isManual && (
        <Checkbox
          className="font-medium text-slate-700 mb-4"
          checked={abEnabled}
          onChange={(e) => toggleAb(e.target.checked)}
          label="Split test this email (A/B)"
        />
      )}
      {abEnabled && !isManual ? (
        variants.map((variant, i) => (
          <div key={variant.key || i} className={i > 0 ? 'mt-2 pt-4 border-t border-slate-100' : ''}>
            <div className="text-xs font-bold text-slate-500 mb-2">{VARIANT_LABELS[i] || `Variant ${i + 1}`}</div>
            <Editor
              subjectLabel="Subject"
              subject={variant.subject}
              body={variant.body}
              onSubjectChange={(v) => updateVariant(i, { subject: v })}
              onBodyChange={(v) => updateVariant(i, { body: v })}
              onGenerated={(result) => updateVariant(i, { subject: result.subject, body: result.body })}
            />
          </div>
        ))
      ) : (
        <Editor
          subjectLabel="Subject"
          subject={node.data.subject}
          body={node.data.body}
          onSubjectChange={(v) => update({ subject: v })}
          onBodyChange={(v) => update({ body: v })}
          onGenerated={(result) => update({ subject: result.subject, body: result.body })}
        />
      )}
    </>
  );
}

// Instantly-sequence node — each step mirrors into a live Instantly campaign
// (backend: instantly_provider.create_campaign/update_campaign_sequence,
// steps shape [{subject, body, delay_days}]). Reuses SubjectBodyEditor
// exactly as EmailFields does per variant, just repeated per step, and the
// same add/remove-row icon-button pattern as EventBranchFields' event
// branches above (Trash2 to remove, a ghost Button + Plus to add).
function InstantlySequenceFields({ node, update }) {
  const steps = node.data.steps?.length ? node.data.steps : [{ subject: '', body: '', delay_days: 0 }];

  const updateStep = (index, patch) => update({ steps: steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const addStep = () => update({ steps: [...steps, { subject: '', body: '', delay_days: 2 }] });
  const removeStep = (index) => update({ steps: steps.filter((_, i) => i !== index) });

  return (
    <>
      <p className="text-xs text-slate-400 mb-3">
        Each step mirrors into a live Instantly.ai campaign — Alternate CRM stays the source of truth for content, Instantly sends through its pooled domains and reports replies/opens/clicks back here.
      </p>
      {steps.map((step, i) => (
        <div key={i} className={i > 0 ? 'mt-3 pt-4 border-t border-slate-100' : ''}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-slate-500">Step {i + 1}</div>
            {steps.length > 1 && (
              <button type="button" onClick={() => removeStep(i)} className="text-slate-400 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <Input id={`instantly-step-delay-${i}`} label="Delay before this step (days)" type="number" min="0" value={step.delay_days ?? 0}
            onChange={(e) => updateStep(i, { delay_days: Number(e.target.value) })}
            containerClassName="mb-2" />
          <SubjectBodyEditor
            subjectLabel="Subject"
            subject={step.subject}
            body={step.body}
            onSubjectChange={(v) => updateStep(i, { subject: v })}
            onBodyChange={(v) => updateStep(i, { body: v })}
            onGenerated={(result) => updateStep(i, { subject: result.subject, body: result.body })}
          />
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={addStep}>
        <Plus size={14} /> Add step
      </Button>
      <SendFromPicker node={node} update={update} />
    </>
  );
}

/** Which Instantly mailboxes this step sends from. Lists only what a Super
 *  Admin made available in Control Center; nothing picked = all of them. The
 *  engine enforces the same rule at send time. */
function SendFromPicker({ node, update }) {
  const [accounts, setAccounts] = React.useState(null);
  const [error, setError] = React.useState('');
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    SalesJourneyService.getInstantlySendingAccounts()
      .then((a) => { if (live) setAccounts(a); })
      .catch((e) => { if (live) setError(e.response?.data?.detail || 'Could not load Instantly mailboxes.'); });
    return () => { live = false; };
  }, []);
  const picked = node.data.sending_accounts || [];
  const available = accounts || [];
  const pickedAvailable = available.filter((a) => picked.includes(a.email));
  const gone = picked.length - pickedAvailable.length;
  const pool = picked.length ? pickedAvailable : available;

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-xs font-bold text-slate-500">Send from</div>
        {accounts?.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Change</Button>
        )}
      </div>
      {error ? (
        <p className="text-xs text-red-600 m-0" role="alert">{error}</p>
      ) : accounts === null ? (
        <p className="text-xs text-slate-400 m-0">Loading mailboxes…</p>
      ) : !accounts.length ? (
        <p className="text-xs text-slate-500 m-0">No mailboxes available yet. Ask a Super Admin to set them up in Control Center → Integrations → Instantly.</p>
      ) : (
        <>
          <p className="text-sm text-slate-700 m-0">
            {picked.length ? mailboxSummary(pickedAvailable) : `All available mailboxes — ${mailboxSummary(available)}`}
          </p>
          <p className="text-xs text-slate-400 mt-1 mb-2">Each lead gets one email per step, from one of these mailboxes.</p>
          {gone > 0 && (
            <p className="text-xs text-amber-700 m-0 mb-2" role="alert">
              {pickedAvailable.length
                ? `${gone} picked mailbox${gone === 1 ? ' was' : 'es were'} removed by your admin and won't be used.`
                : 'Your admin removed the mailboxes this step used. Pick new ones, or leads will stop here.'}
            </p>
          )}
          <Modal open={open} onClose={() => setOpen(false)} title="Which mailboxes this step sends from" maxWidth="max-w-2xl">
            <p className="text-sm text-slate-500 mt-0 mb-3">
              Leave all unticked to use every available mailbox. Each lead gets one email per step, from one of them.
            </p>
            <MailboxPicker accounts={available} selected={pickedAvailable.map((a) => a.email)}
              onChange={(next) => update({ sending_accounts: next.length ? next : undefined })} />
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

// duration_hours stays the single float the engine/wire format already uses
// (timedelta(hours=duration_hours) handles fractional hours natively) — this
// just gives the user hour/minute/second entry instead of forcing e.g. "30
// minutes" to be typed as the decimal 0.5. Works in whole seconds internally
// to avoid float-drift on the round trip.
function DurationPicker({ totalHours, onChange, label = 'Duration' }) {
  const totalSeconds = Math.round((totalHours || 0) * 3600);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  // Local string state per box so a cleared field can actually stay empty
  // while typing, instead of Number('') silently becoming 0 and the input
  // snapping back to "0" — which is what made this feel like typing didn't
  // work, forcing the spinner arrows instead.
  const [local, setLocal] = React.useState({ d: String(d), h: String(h), m: String(m), s: String(s) });
  React.useEffect(() => { setLocal({ d: String(d), h: String(h), m: String(m), s: String(s) }); }, [totalHours]);

  const commit = (next) => {
    const nd = Number(next.d) || 0;
    const nh = Number(next.h) || 0;
    const nm = Number(next.m) || 0;
    const ns = Number(next.s) || 0;
    onChange((nd * 86400 + nh * 3600 + nm * 60 + ns) / 3600);
  };

  const box = (key, max, labelText) => (
    <div className="flex-1">
      <input
        type="number" min="0" max={max}
        className={selectClass}
        value={local[key]}
        onChange={(e) => {
          const next = { ...local, [key]: e.target.value };
          setLocal(next);
          commit(next);
        }}
      />
      <div className="text-xs text-slate-400 mt-1 text-center">{labelText}</div>
    </div>
  );

  return (
    <Field label={label}>
      <div className="flex gap-2">
        {box('d', 365, 'Days')}
        {box('h', 23, 'Hours')}
        {box('m', 59, 'Minutes')}
        {box('s', 59, 'Seconds')}
      </div>
    </Field>
  );
}

function WaitFields({ node, update }) {
  return (
    <DurationPicker
      totalHours={node.data.duration_hours}
      onChange={(duration_hours) => update({ duration_hours })}
    />
  );
}

function CallFields({ node, update }) {
  return (
    <>
      <Input label="Task title" value={node.data.title || ''} onChange={(e) => update({ title: e.target.value })}
        hint="Shown to the assigned SDR — a Task reminder is created, no automated call is placed. The cadence doesn't wait for the call; use a Task step for that." />
      <Field label="Call script (optional)">
        <textarea
          className={`${selectClass} min-h-[100px] resize-y`}
          value={node.data.script || ''}
          onChange={(e) => update({ script: e.target.value })}
          placeholder="Opener, hook, question, close… merge fields like {{first_name}} work here"
        />
      </Field>
      <div className="text-xs text-slate-400 -mt-2 mb-3">
        Shown on the Power Dialer card for this step. A lead's own notes always take priority if set there.
      </div>
    </>
  );
}

/** Textarea + clickable {{merge_field}} chips that insert at the caret —
 *  shared by the SMS message and the manual-task instructions. */
function MergeFieldTextarea({ label, value, onChange, placeholder, minHeight = 'min-h-[120px]', invalid = false, footer = null }) {
  const bodyRef = React.useRef(null);
  const lastCaretRef = React.useRef(null);
  const trackCaret = () => {
    if (bodyRef.current) lastCaretRef.current = bodyRef.current.selectionStart;
  };
  const text = value || '';

  const insertField = (field) => {
    const el = bodyRef.current;
    const pos = lastCaretRef.current ?? text.length;
    const insertion = `{{${field}}}`;
    onChange(text.slice(0, pos) + insertion + text.slice(pos));

    const caretPos = pos + insertion.length;
    lastCaretRef.current = caretPos;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caretPos, caretPos);
    });
  };

  return (
    <>
      <Field label={label}>
        <textarea
          ref={bodyRef}
          className={`${selectClass} ${minHeight} resize-y ${invalid ? 'border-red-400' : ''}`}
          value={text}
          onChange={(e) => { onChange(e.target.value); trackCaret(); }}
          onSelect={trackCaret}
          onClick={trackCaret}
          onKeyUp={trackCaret}
          placeholder={placeholder}
        />
      </Field>
      {footer}
      <div className="-mt-2 mb-4">
        <div className="text-xs text-slate-400 mb-1.5">Merge fields — click to insert:</div>
        <div className="flex flex-wrap gap-1.5">
          {EMAIL_MERGE_FIELDS.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => insertField(field)}
              className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-700 text-xs font-mono transition-colors cursor-pointer"
            >
              {`{{${field}}}`}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// Feedback #15: SMS can be kept manual (rep reviews/edits and sends) instead
// of auto-sending — same toggle shape as EmailFields' manual mode.
function SMSFields({ node, update, otherNodes, allNodes }) {
  const message = node.data.message || '';
  const overLimit = message.length > SMS_MAX_LENGTH;
  const segments = Math.max(1, Math.ceil(message.length / SMS_SEGMENT_LENGTH));
  const isManual = node.data.send_mode === 'manual';
  const nodeOptions = otherNodes.map((n) => ({ value: n.id, label: labelForNode(n, allNodes) }));
  return (
    <>
      <Checkbox
        className="font-medium text-slate-700"
        checked={isManual}
        onChange={(e) => update({ send_mode: e.target.checked ? 'manual' : undefined })}
        label="Require rep approval before sending (manual)"
      />
      <div className="text-xs text-slate-400 mt-0.5 mb-3">
        The cadence pauses here — the lead's rep reviews, can edit, and sends. Never auto-sends on a missed deadline.
      </div>
      <MergeFieldTextarea
        label="Message"
        value={message}
        onChange={(v) => update({ message: v })}
        placeholder="Hi {{first_name}}, …"
        invalid={overLimit}
        footer={(
          <div className={`text-xs -mt-2 mb-3 ${overLimit ? 'text-red-500' : 'text-slate-400'}`}>
            {message.length}/{SMS_MAX_LENGTH} characters · ~{segments} segment{segments > 1 ? 's' : ''}
            {overLimit && ' — too long'}
          </div>
        )}
      />
      <div className="text-xs text-slate-400 -mt-2 mb-3">Leads with no phone number skip this step.</div>
      {isManual && <DeadlineField node={node} update={update} nodeOptions={nodeOptions} />}
    </>
  );
}

/** v13.0.0 manual step: research, LinkedIn, or any hand-done touch. The
 *  cadence WAITS for the rep (up to the deadline), then continues — and each
 *  outcome the rep can pick may route to a different next step. */
function TaskFields({ node, update, otherNodes, allNodes }) {
  const outcomes = node.data.outcomes || [];
  const branchOnOutcome = node.data.branch_on_outcome || {};
  const nodeOptions = otherNodes.map((n) => ({ value: n.id, label: labelForNode(n, allNodes) }));

  const setKind = (kind) => update({
    task_kind: kind,
    // A new LinkedIn connection step offers Accepted / Not accepted, so
    // "message only if accepted" is one branch away. Kept if already set.
    ...(kind === 'linkedin_connect' && outcomes.length === 0 ? { outcomes: LINKEDIN_CONNECT_OUTCOMES } : {}),
  });
  const setOutcome = (i, label) => {
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const prevKey = outcomes[i].key;
    const next = outcomes.map((o, idx) => (idx === i ? { key, label } : o));
    const branches = { ...branchOnOutcome };
    if (prevKey !== key && branches[prevKey] !== undefined) { branches[key] = branches[prevKey]; delete branches[prevKey]; }
    update({ outcomes: next, branch_on_outcome: branches });
  };
  const removeOutcome = (i) => {
    const branches = { ...branchOnOutcome };
    delete branches[outcomes[i].key];
    update({ outcomes: outcomes.filter((_, idx) => idx !== i), branch_on_outcome: branches });
  };
  const setBranch = (key, target) => update({ branch_on_outcome: { ...branchOnOutcome, [key]: target || undefined } });

  const isMessage = node.data.task_kind === 'linkedin_message' || node.data.task_kind === 'linkedin_connect';

  return (
    <>
      <Field label="Type">
        <Select className="w-full justify-between" ariaLabel="Task type" value={node.data.task_kind || 'research'}
          onChange={setKind} options={TASK_KINDS} />
      </Field>
      <Input label="Title (optional)" value={node.data.title || ''} onChange={(e) => update({ title: e.target.value })}
        hint="Defaults to the type and the lead's name." />
      <MergeFieldTextarea
        label={isMessage ? 'Message for the rep to send' : 'Instructions for the rep'}
        value={node.data.instructions}
        onChange={(v) => update({ instructions: v })}
        placeholder={isMessage ? 'Hi {{first_name}}, {{research_hook}}…' : 'What to look for, what to note down…'}
        minHeight="min-h-[100px]"
      />
      <DeadlineField node={node} update={update} />
      <Field label="Outcomes the rep picks from (optional)">
        <div className="space-y-2">
          {outcomes.map((o, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2 items-center">
                <input className={selectClass} aria-label={`Outcome ${i + 1}`} value={o.label}
                  onChange={(e) => setOutcome(i, e.target.value)} placeholder="e.g. Accepted" />
                <button type="button" onClick={() => removeOutcome(i)} className="text-slate-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
              <Select className="w-full justify-between" ariaLabel={`If ${o.label || 'this outcome'}, go to`}
                value={branchOnOutcome[o.key] || ''} onChange={(v) => setBranch(o.key, v)}
                options={nodeOptions} placeholder="then go to… (default: next step)" />
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => update({ outcomes: [...outcomes, { key: '', label: '' }] })}>
            <Plus size={14} /> Add outcome
          </Button>
        </div>
      </Field>
      <Field label="If the deadline passes, go to">
        <Select className="w-full justify-between" ariaLabel="If the deadline passes, go to"
          value={node.data.branch_on_timeout || ''} onChange={(v) => update({ branch_on_timeout: v || undefined })}
          options={nodeOptions} placeholder="default: next step" />
      </Field>
    </>
  );
}

// A cadence's first touch to a lead is always outside any existing WhatsApp
// conversation window — Meta requires a pre-approved template for that (not
// freeform text, unlike every other channel here), so this picks from the
// account's real approved templates instead of a textarea. Reuses the same
// /api/conversations/templates endpoint the Alternate Messenger Widget's Message tab
// already calls — no new backend endpoint needed.
function WhatsAppFields({ node, update }) {
  const [templates, setTemplates] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    ConversationsService.getTemplates()
      .then((data) => { if (!cancelled) setTemplates(data.templates || []); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const templateName = node.data.template_name || '';
  const selected = templates.find((t) => t.name === templateName);

  return (
    <>
      <Field label="WhatsApp template">
        {loading ? (
          <div className="text-xs text-slate-400">Loading templates…</div>
        ) : loadError ? (
          <div className="text-xs text-red-500">
            Couldn't load templates — check Settings → Conversations, or try again.
          </div>
        ) : templates.length === 0 ? (
          <div className="text-xs text-amber-600">
            No approved WhatsApp templates found on this account yet.
          </div>
        ) : (
          <Select
            className="w-full justify-between"
            ariaLabel="WhatsApp template"
            value={templateName}
            onChange={(v) => update({ template_name: v })}
            options={templates.map((t) => ({ value: t.name, label: t.name }))}
            placeholder="Select a template…"
          />
        )}
      </Field>
      {selected && (
        <div className="-mt-2 mb-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 whitespace-pre-wrap">
          {selected.template_text}
        </div>
      )}
      <div className="text-xs text-slate-400 -mt-1 mb-3">
        A cadence's first message must use a Meta-approved template — free
        text only works once the lead has replied. <code>{'${contacts.first_name}'}</code> is
        filled in automatically from the lead's name.
      </div>
    </>
  );
}

function ConditionFields(props) {
  const { node, update } = props;
  const mode = node.data.field_rule ? 'field' : 'event';
  const setMode = (m) => update(m === 'field'
    ? { field_rule: { field: 'title', op: 'contains_any', value: '' } }
    : { field_rule: undefined, branch_on_match: undefined, branch_on_no_match: undefined });
  return (
    <>
      <Field label="Branch on">
        <Select className="w-full justify-between" ariaLabel="Branch on" value={mode} onChange={setMode}
          options={[
            { value: 'event', label: 'Something the lead does (reply, call…)' },
            { value: 'field', label: 'A lead field (title, phone…)' },
          ]} />
      </Field>
      {mode === 'field' ? <FieldRuleFields {...props} /> : <EventConditionFields {...props} />}
    </>
  );
}

/** v13.0.0 — decided the moment the lead reaches this step (no waiting):
 *  e.g. title contains "marketing, growth" → the Marketing email variant. */
function FieldRuleFields({ node, update, otherNodes, allNodes }) {
  const rule = node.data.field_rule || {};
  const setRule = (patch) => update({ field_rule: { ...rule, ...patch } });
  const op = FIELD_RULE_OPS.find((o) => o.value === rule.op);
  const nodeOptions = otherNodes.map((n) => ({ value: n.id, label: labelForNode(n, allNodes) }));
  return (
    <>
      <div className="flex gap-2 mb-2">
        <Select className="flex-1 justify-between" ariaLabel="Lead field" value={rule.field || ''}
          onChange={(v) => setRule({ field: v })} options={FIELD_RULE_FIELDS} />
        <Select className="flex-1 justify-between" ariaLabel="Comparison" value={rule.op || ''}
          onChange={(v) => setRule({ op: v })} options={FIELD_RULE_OPS} />
      </div>
      {op?.needsValue && (
        <Input label={rule.op === 'contains_any' ? 'Keywords (comma-separated)' : 'Value'} value={rule.value || ''}
          onChange={(e) => setRule({ value: e.target.value })}
          hint={rule.op === 'contains_any' ? 'Not case-sensitive — e.g. marketing, growth, demand' : 'Not case-sensitive'} />
      )}
      <Field label="If it matches, go to">
        <Select className="w-full justify-between" ariaLabel="If it matches, go to" value={node.data.branch_on_match || ''}
          onChange={(v) => update({ branch_on_match: v })} options={nodeOptions} placeholder="Select a node…" />
      </Field>
      <Field label="Otherwise, go to">
        <Select className="w-full justify-between" ariaLabel="Otherwise, go to" value={node.data.branch_on_no_match || ''}
          onChange={(v) => update({ branch_on_no_match: v })} options={nodeOptions} placeholder="Select a node…" />
      </Field>
    </>
  );
}

function EventConditionFields({ node, update, otherNodes, allNodes }) {
  const branchOnEvent = node.data.branch_on_event || {};

  const setBranchEvent = (index, key, value) => {
    const entries = Object.entries(branchOnEvent);
    entries[index] = [key, value];
    update({ branch_on_event: Object.fromEntries(entries) });
  };
  const addBranch = () => update({ branch_on_event: { ...branchOnEvent, '': '' } });
  const removeBranch = (index) => {
    const entries = Object.entries(branchOnEvent);
    entries.splice(index, 1);
    update({ branch_on_event: Object.fromEntries(entries) });
  };

  return (
    <>
      <DurationPicker label="Wait for the event up to" totalHours={node.data.timeout_hours}
        onChange={(timeout_hours) => update({ timeout_hours })} />
      <Field label="On timeout, go to">
        <Select
          className="w-full justify-between"
          ariaLabel="On timeout, go to"
          value={node.data.branch_on_timeout || ''}
          onChange={(v) => update({ branch_on_timeout: v })}
          options={otherNodes.map((n) => ({ value: n.id, label: labelForNode(n, allNodes) }))}
          placeholder="Select a node…"
        />
      </Field>
      <Field label="On event, go to">
        <div className="space-y-2">
          {Object.entries(branchOnEvent).map(([eventType, target], i) => {
            // branch_on_event is a plain object — its keys can't literally
            // duplicate, but picking an event type another row already uses
            // would silently overwrite that row on save. Disable it instead.
            const usedByAnotherRow = new Set(
              Object.keys(branchOnEvent).filter((k) => k !== eventType)
            );
            return (
            <div key={i} className="flex gap-2 items-center">
              <Select
                className="flex-1 justify-between"
                ariaLabel="Select event"
                value={eventType}
                onChange={(v) => setBranchEvent(i, v, target)}
                placeholder="Select event…"
                options={CONDITION_EVENT_TYPES.map((et) => ({
                  value: et.value,
                  label: usedByAnotherRow.has(et.value) ? `${et.label} (already used)` : et.label,
                  disabled: usedByAnotherRow.has(et.value),
                }))}
              />
              <Select
                className="flex-1 justify-between"
                ariaLabel="Branch target node"
                value={target || ''}
                onChange={(v) => setBranchEvent(i, eventType, v)}
                options={otherNodes.map((n) => ({ value: n.id, label: labelForNode(n, allNodes) }))}
                placeholder="node…"
              />
              <button type="button" onClick={() => removeBranch(i)} className="text-slate-400 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
            );
          })}
          <Button variant="ghost" size="sm" onClick={addBranch}>
            <Plus size={14} /> Add event branch
          </Button>
        </div>
      </Field>
    </>
  );
}

const FIELD_COMPONENTS = {
  trigger: TriggerFields,
  email: EmailFields,
  wait: WaitFields,
  call: CallFields,
  task: TaskFields,
  sms: SMSFields,
  whatsapp: WhatsAppFields,
  condition: ConditionFields,
  instantly_sequence: InstantlySequenceFields,
};

export function NodeConfigPanel({ errors, readOnly = false }) {
  const nodes = useJourneyStore((s) => s.nodes);
  const selectedNodeId = useJourneyStore((s) => s.selectedNodeId);
  const updateNodeData = useJourneyStore((s) => s.updateNodeData);
  const deleteNode = useJourneyStore((s) => s.deleteNode);
  const selectNode = useJourneyStore((s) => s.selectNode);

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const Fields = FIELD_COMPONENTS[node.type];
  const otherNodes = nodes.filter((n) => n.id !== node.id);
  const nodeErrors = errors.get(node.id) || [];

  return (
    <div className="w-80 shrink-0 border-l border-slate-200 bg-white h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-800">{labelForNode(node, nodes)} settings</h3>
        <button onClick={() => selectNode(null)} className="text-slate-400 hover:text-slate-600">
          <X size={16} />
        </button>
      </div>

      {nodeErrors.length > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 space-y-1">
          {nodeErrors.map((msg, i) => <div key={i}>{msg}</div>)}
        </div>
      )}

      {/* Deliberately OUTSIDE the disabled fieldset below: a <button>/<summary>
          inside a disabled fieldset is itself inert, which would hide the
          preview from read-only viewers — the ones who most need to read what
          a cadence sends, and who have no other way to see it (the node card
          truncates the subject to ~160px). */}
      {node.type === 'email' && <EmailPreview node={node} />}
      {(node.type === 'sms' || node.type === 'whatsapp') && <MessagePreview node={node} />}

      <fieldset disabled={readOnly} className="contents">
        {Fields && <Fields node={node} update={(patch) => updateNodeData(node.id, patch)} otherNodes={otherNodes} allNodes={nodes} />}
      </fieldset>

      {!readOnly && (
        <Button variant="danger" size="sm" className="w-full mt-2" onClick={() => deleteNode(node.id)}>
          <Trash2 size={14} /> Delete node
        </Button>
      )}
    </div>
  );
}
