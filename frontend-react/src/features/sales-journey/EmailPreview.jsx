import React from 'react';
import { Eye } from 'lucide-react';
import { applyMergeFields, SAMPLE_LEAD } from '../../utils/mergeFields';

/**
 * Read-only "what will the lead actually receive?" preview for a cadence
 * email/sms/whatsapp step.
 *
 * Why this exists: the node card on the canvas shows only a subject truncated
 * to ~160px ("We Got an Email from the …"), and the config panel's fields are
 * wrapped in a disabled <fieldset> for read-only viewers — so since v12.1
 * made cadences visible to every role, an SDR could open a cadence and still
 * not read the email it sends. This renders the resolved copy for everyone,
 * which is why NodeConfigPanel mounts it OUTSIDE that fieldset: a <button>
 * inside a disabled fieldset is itself disabled, which would have locked the
 * preview away from exactly the people who need it most.
 *
 * Merge fields are substituted with SAMPLE_LEAD placeholders, using the same
 * "unmatched renders blank" rule the backend sends with, so the preview can't
 * imply a literal {{token}} would ever reach a recipient.
 */
function PreviewBody({ subject, body, label }) {
  const resolvedSubject = applyMergeFields(subject || '');
  const resolvedBody = applyMergeFields(body || '');

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
      {label && (
        <div className="px-2.5 py-1 bg-slate-100 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
          {label}
        </div>
      )}
      <div className="px-2.5 py-1.5 border-b border-slate-200 bg-white">
        <div className="text-[10px] uppercase tracking-wide text-slate-400">Subject</div>
        <div className="text-xs font-semibold text-slate-800 break-words">
          {resolvedSubject || <span className="font-normal italic text-slate-400">No subject yet</span>}
        </div>
      </div>
      <div className="px-2.5 py-2">
        {resolvedBody
          // Cadence bodies are authored in a plain <textarea>, so they are
          // plain text — pre-wrap preserves the author's line breaks without
          // interpreting anything as markup.
          ? <div className="text-xs text-slate-700 whitespace-pre-wrap break-words">{resolvedBody}</div>
          : <div className="text-xs italic text-slate-400">No body yet</div>}
      </div>
    </div>
  );
}

export function EmailPreview({ node }) {
  const data = node.data || {};
  const variants = data.variants;

  return (
    <details className="mt-1 mb-3">
      <summary className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer select-none hover:text-slate-700">
        <Eye size={12} /> Preview email
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-[11px] text-slate-400 m-0">
          Merge fields filled in with sample values — the real send uses each lead's own details.
        </p>
        {variants?.length
          ? variants.map((v, i) => (
              <PreviewBody
                key={v.key || i}
                label={`Variant ${v.key || String.fromCharCode(65 + i)} preview`}
                subject={v.subject}
                body={v.body}
              />
            ))
          : <PreviewBody subject={data.subject} body={data.body} />}
      </div>
    </details>
  );
}

/** SMS/WhatsApp steps have a single `message` field rather than subject+body,
 *  but the same "I can't see what this actually says" problem. */
export function MessagePreview({ node }) {
  const data = node.data || {};
  const text = data.template_name
    ? `Approved template: ${data.template_name}`
    : applyMergeFields(data.message || '');

  return (
    <details className="mt-1 mb-3">
      <summary className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer select-none hover:text-slate-700">
        <Eye size={12} /> Preview message
      </summary>
      <div className="mt-2">
        <p className="text-[11px] text-slate-400 mt-0 mb-2">
          Merge fields filled in with sample values (e.g. {SAMPLE_LEAD.first_name}).
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
          {text
            ? <div className="text-xs text-slate-700 whitespace-pre-wrap break-words">{text}</div>
            : <div className="text-xs italic text-slate-400">No message yet</div>}
        </div>
      </div>
    </details>
  );
}
