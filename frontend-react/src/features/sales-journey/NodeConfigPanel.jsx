import React from 'react';
import { X, Trash2, Plus, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { STATUSES } from '../leads-hub/constants';
import { useJourneyStore } from './store/useJourneyStore';
import { SalesJourneyService, ConversationsService } from '../../services/api';
import { toast } from './toast';
import { NODE_LABELS, CONDITION_EVENT_TYPES, ENTRY_TRIGGER_EVENT_TYPES, EMAIL_MERGE_FIELDS, SMS_MAX_LENGTH, SMS_SEGMENT_LENGTH } from './nodeDefaults';

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
        <select className={selectClass} value={event}
          onChange={(e) => update({ event: e.target.value, to_status: undefined })}>
          {ENTRY_TRIGGER_EVENT_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
      </Field>
      {event === 'status_changed' && (
        <Field label="Status">
          <select className={selectClass} value={node.data.to_status || ''}
            onChange={(e) => update({ to_status: e.target.value })}>
            <option value="">Select a status…</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
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

const VARIANT_LABELS = ['Variant A', 'Variant B'];

function EmailFields({ node, update }) {
  const variants = node.data.variants;
  const abEnabled = !!variants?.length;

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

  return (
    <>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-4">
        <input type="checkbox" checked={abEnabled} onChange={(e) => toggleAb(e.target.checked)} />
        Split test this email (A/B)
      </label>
      {abEnabled ? (
        variants.map((variant, i) => (
          <div key={variant.key || i} className={i > 0 ? 'mt-2 pt-4 border-t border-slate-100' : ''}>
            <div className="text-xs font-bold text-slate-500 mb-2">{VARIANT_LABELS[i] || `Variant ${i + 1}`}</div>
            <SubjectBodyEditor
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
        <SubjectBodyEditor
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

// duration_hours stays the single float the engine/wire format already uses
// (timedelta(hours=duration_hours) handles fractional hours natively) — this
// just gives the user hour/minute/second entry instead of forcing e.g. "30
// minutes" to be typed as the decimal 0.5. Works in whole seconds internally
// to avoid float-drift on the round trip.
function DurationPicker({ totalHours, onChange }) {
  const totalSeconds = Math.round((totalHours || 0) * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  // Local string state per box so a cleared field can actually stay empty
  // while typing, instead of Number('') silently becoming 0 and the input
  // snapping back to "0" — which is what made this feel like typing didn't
  // work, forcing the spinner arrows instead.
  const [local, setLocal] = React.useState({ h: String(h), m: String(m), s: String(s) });
  React.useEffect(() => { setLocal({ h: String(h), m: String(m), s: String(s) }); }, [totalHours]);

  const commit = (next) => {
    const nh = Number(next.h) || 0;
    const nm = Number(next.m) || 0;
    const ns = Number(next.s) || 0;
    onChange((nh * 3600 + nm * 60 + ns) / 3600);
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
    <Field label="Duration">
      <div className="flex gap-2">
        {box('h', 999, 'Hours')}
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
    <Input label="Task title" value={node.data.title || ''} onChange={(e) => update({ title: e.target.value })}
      hint="Shown to the assigned SDR — a Task reminder is created, no automated call is placed." />
  );
}

function SMSFields({ node, update }) {
  const bodyRef = React.useRef(null);
  const lastCaretRef = React.useRef(null);
  const trackCaret = () => {
    if (bodyRef.current) lastCaretRef.current = bodyRef.current.selectionStart;
  };
  const message = node.data.message || '';

  const insertField = (field) => {
    const el = bodyRef.current;
    const pos = lastCaretRef.current ?? message.length;
    const insertion = `{{${field}}}`;
    const next = message.slice(0, pos) + insertion + message.slice(pos);
    update({ message: next });

    const caretPos = pos + insertion.length;
    lastCaretRef.current = caretPos;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caretPos, caretPos);
    });
  };

  const overLimit = message.length > SMS_MAX_LENGTH;
  const segments = Math.max(1, Math.ceil(message.length / SMS_SEGMENT_LENGTH));

  return (
    <>
      <Field label="Message">
        <textarea
          ref={bodyRef}
          className={`${selectClass} min-h-[120px] resize-y ${overLimit ? 'border-red-400' : ''}`}
          value={message}
          onChange={(e) => { update({ message: e.target.value }); trackCaret(); }}
          onSelect={trackCaret}
          onClick={trackCaret}
          onKeyUp={trackCaret}
          placeholder="Hi {{first_name}}, …"
        />
      </Field>
      <div className={`text-xs -mt-2 mb-3 ${overLimit ? 'text-red-500' : 'text-slate-400'}`}>
        {message.length}/{SMS_MAX_LENGTH} characters · ~{segments} segment{segments > 1 ? 's' : ''}
        {overLimit && ' — too long'}
      </div>
      <div className="-mt-2 mb-4">
        <div className="text-xs text-slate-400 mb-1.5">Merge fields — click to insert into the message:</div>
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

// A cadence's first touch to a lead is always outside any existing WhatsApp
// conversation window — Meta requires a pre-approved template for that (not
// freeform text, unlike every other channel here), so this picks from the
// account's real approved templates instead of a textarea. Reuses the same
// /api/conversations/templates endpoint the RCM Widget's Message tab
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
          <select
            className={selectClass}
            value={templateName}
            onChange={(e) => update({ template_name: e.target.value })}
          >
            <option value="">Select a template…</option>
            {templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
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

function ConditionFields({ node, update, otherNodes, allNodes }) {
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
      <Input label="Timeout (hours)" type="number" min="1" value={node.data.timeout_hours ?? ''}
        onChange={(e) => update({ timeout_hours: Number(e.target.value) })} />
      <Field label="On timeout, go to">
        <select className={selectClass} value={node.data.branch_on_timeout || ''}
          onChange={(e) => update({ branch_on_timeout: e.target.value })}>
          <option value="">Select a node…</option>
          {otherNodes.map((n) => <option key={n.id} value={n.id}>{labelForNode(n, allNodes)}</option>)}
        </select>
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
              <select
                className={`${selectClass} flex-1`}
                value={eventType}
                onChange={(e) => setBranchEvent(i, e.target.value, target)}
              >
                <option value="">Select event…</option>
                {CONDITION_EVENT_TYPES.map((et) => (
                  <option key={et.value} value={et.value} disabled={usedByAnotherRow.has(et.value)}>
                    {et.label}{usedByAnotherRow.has(et.value) ? ' (already used)' : ''}
                  </option>
                ))}
              </select>
              <select className={`${selectClass} flex-1`} value={target || ''}
                onChange={(e) => setBranchEvent(i, eventType, e.target.value)}>
                <option value="">node…</option>
                {otherNodes.map((n) => <option key={n.id} value={n.id}>{labelForNode(n, allNodes)}</option>)}
              </select>
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
  sms: SMSFields,
  whatsapp: WhatsAppFields,
  condition: ConditionFields,
};

export function NodeConfigPanel({ errors }) {
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

      {Fields && <Fields node={node} update={(patch) => updateNodeData(node.id, patch)} otherNodes={otherNodes} allNodes={nodes} />}

      <Button variant="danger" size="sm" className="w-full mt-2" onClick={() => deleteNode(node.id)}>
        <Trash2 size={14} /> Delete node
      </Button>
    </div>
  );
}
