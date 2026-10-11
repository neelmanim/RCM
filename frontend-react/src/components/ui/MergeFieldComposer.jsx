import React from 'react';
import { Input } from './Input';
import { RichTextEditor } from './RichTextEditor';
import { LEAD_MERGE_FIELDS } from '../../utils/mergeFields';

/** Clickable {{token}} chips. Same visual language as the Sales Cadence email
 *  node's chips (NodeConfigPanel's SubjectBodyEditor), which is where this
 *  interaction already existed — the campaign/template composer only ever
 *  named the fields in placeholder text and left you to type them by hand. */
function MergeFieldChips({ fields, onInsert, targetLabel }) {
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1.5">
        Merge fields — click to insert into the {targetLabel}:
      </div>
      <div className="flex flex-wrap gap-1.5">
        {fields.map((field) => (
          <button
            key={field}
            type="button"
            // Keep the editor's selection: a plain click blurs the body first,
            // which would lose the caret we're about to insert at.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(field)}
            className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-700 text-xs font-mono transition-colors cursor-pointer"
          >
            {`{{${field}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Subject + rich-text body + one merge-field chip row, the exact composition
 * both Email Campaigns compose and the saved-template editor need — they
 * rendered it separately before, which is why only one of them ever got
 * improvements.
 *
 * The single chip row inserts into whichever field you touched last (body by
 * default). Two rows — one per field — was the alternative; it doubles the
 * visual weight of the form to save tracking one piece of state.
 */
export function MergeFieldComposer({
  subject, onSubjectChange, body, onBodyChange,
  subjectPlaceholder = 'Subject', bodyPlaceholder = 'Body',
  allowTables = false,
}) {
  const editorRef = React.useRef(null);
  const subjectRef = React.useRef(null);
  // Where a clicked chip lands. 'body' by default: it's the field with room
  // for prose, and the one the complaint was actually about.
  const [target, setTarget] = React.useState('body');
  // Caret position inside the subject input. null = never focused, so append
  // rather than silently prepending at index 0.
  const subjectCaretRef = React.useRef(null);

  const trackSubjectCaret = () => {
    if (subjectRef.current) subjectCaretRef.current = subjectRef.current.selectionStart;
  };

  const insertIntoSubject = (token) => {
    const el = subjectRef.current;
    const current = subject || '';
    const pos = subjectCaretRef.current ?? current.length;
    const next = current.slice(0, pos) + token + current.slice(pos);
    onSubjectChange(next);

    const caret = pos + token.length;
    subjectCaretRef.current = caret;
    // After the parent re-renders with the new value — otherwise setSelectionRange
    // runs against the pre-update DOM value and the caret lands short.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const handleInsert = (field) => {
    const token = `{{${field}}}`;
    if (target === 'subject') {
      insertIntoSubject(token);
      return;
    }
    // Tiptap owns the body's caret — insertContent at the current selection is
    // the only correct way in; string-concatenating HTML would drop formatting.
    editorRef.current?.chain().focus().insertContent(token).run();
  };

  return (
    <>
      <Input
        ref={subjectRef}
        placeholder={subjectPlaceholder}
        value={subject || ''}
        onChange={(e) => { onSubjectChange(e.target.value); trackSubjectCaret(); }}
        onFocus={() => setTarget('subject')}
        onSelect={trackSubjectCaret}
        onClick={trackSubjectCaret}
        onKeyUp={trackSubjectCaret}
      />
      <RichTextEditor
        value={body}
        onChange={onBodyChange}
        placeholder={bodyPlaceholder}
        editorRef={editorRef}
        onFocus={() => setTarget('body')}
        allowTables={allowTables}
      />
      <MergeFieldChips
        fields={LEAD_MERGE_FIELDS}
        onInsert={handleInsert}
        targetLabel={target === 'subject' ? 'subject' : 'body'}
      />
    </>
  );
}
