import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import {
  Bold, Italic, List, ListOrdered, Link as LinkIcon, Unlink,
  Image as ImageIcon, Building2, Table as TableIcon, Rows3, Trash2,
} from 'lucide-react';

function ToolbarButton({ active, onClick, disabled, title, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection/focus — a normal click steals it first
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
        active ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

/** Minimal WYSIWYG editor for campaign/template bodies — bold/italic/lists/
 *  link only, matching the plain formatting every other outreach-compose
 *  surface in this app supports, not a full document editor. Outputs real
 *  HTML (`onChange(html)`); merge-field tokens like {{first_name}} are just
 *  plain text inside it, so apply_merge_fields' string substitution on the
 *  backend works unchanged regardless of surrounding markup. */
export function RichTextEditor({
  value, onChange, placeholder, editorRef, onFocus,
  // Opt-in image controls: insert-by-URL, plus an upload button when
  // `onUploadImage` is supplied (it receives a File and resolves to a URL).
  // Off by default so campaign/template bodies keep the same minimal toolbar.
  allowImages = false, onUploadImage,
  // Opt-in tables (cadence emails: the playbook's "What changes / Impact"
  // tables). Also what keeps a table pasted from Google Docs intact — without
  // the extension Tiptap flattens it to loose paragraphs.
  allowTables = false,
  disabled = false,
}) {
  const fileRef = React.useRef(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      // Registered only when asked for: without the extension Tiptap silently
      // drops an <img> on the floor, so an editor that can't show images
      // shouldn't advertise the buttons either.
      ...(allowImages ? [Image.configure({ inline: true, allowBase64: false })] : []),
      ...(allowTables ? [TableKit.configure({ table: { resizable: false } })] : []),
    ],
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onFocus: () => onFocus?.(),
    editorProps: {
      attributes: {
        // No Tailwind Typography plugin in this app — [&_p]:/[&_ul]: give
        // paragraphs/lists real spacing without pulling one in for this.
        class: 'focus:outline-none min-h-[120px] px-3 py-2 text-sm text-slate-700 ' +
          '[&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-blue-600 [&_a]:underline ' +
          '[&_img]:max-w-full [&_img]:inline-block ' +
          '[&_table]:border-collapse [&_table]:my-2 [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 ' +
          '[&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-slate-50 [&_th]:text-left',
      },
    },
  });

  React.useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  // Hand the live editor instance up so a caller can drive commands against
  // the real caret (MergeFieldComposer inserts {{tokens}} this way). A ref
  // rather than a callback prop: the instance is stable and callers only ever
  // need it imperatively, at click time.
  React.useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => { editorRef.current = null; };
  }, [editor, editorRef]);

  // Templates load their subject/body asynchronously after the editor
  // mounts — Tiptap's `content` prop is only the *initial* value, so
  // picking a template needs an explicit sync into the live editor state.
  React.useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);

  // `emitUpdate: false` above deliberately skips onUpdate (so syncing an
  // external value doesn't loop back through onChange) — but that also
  // means React never re-renders, so a placeholder check reading
  // `editor.isEmpty` live at render time would go stale: pick a template
  // into an empty editor and the placeholder stays painted right over the
  // new text until some other re-render happens to clear it. Tracking
  // isEmpty via the 'transaction' event (fires on every dispatched
  // transaction, programmatic ones included) keeps it correct always.
  const [isEmpty, setIsEmpty] = React.useState(editor?.isEmpty ?? true);
  React.useEffect(() => {
    if (!editor) return;
    const sync = () => setIsEmpty(editor.isEmpty);
    sync();
    editor.on('transaction', sync);
    return () => editor.off('transaction', sync);
  }, [editor]);

  if (!editor) return null;

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Link URL', previousUrl || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="w-full rounded-lg border border-slate-200 bg-white focus-within:border-focus-ring focus-within:ring-2 focus-within:ring-focus-ring/20">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100">
        <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={14} />
        </ToolbarButton>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={14} />
        </ToolbarButton>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton title="Add link" active={editor.isActive('link')} onClick={setLink}>
          <LinkIcon size={14} />
        </ToolbarButton>
        <ToolbarButton title="Remove link" disabled={!editor.isActive('link')} onClick={() => editor.chain().focus().unsetLink().run()}>
          <Unlink size={14} />
        </ToolbarButton>
        {allowTables && (
          <>
            <div className="w-px h-4 bg-slate-200 mx-1" />
            <ToolbarButton title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>
              <TableIcon size={14} />
            </ToolbarButton>
            <ToolbarButton title="Add row" disabled={!editor.isActive('table')} onClick={() => editor.chain().focus().addRowAfter().run()}>
              <Rows3 size={14} />
            </ToolbarButton>
            <ToolbarButton title="Delete table" disabled={!editor.isActive('table')} onClick={() => editor.chain().focus().deleteTable().run()}>
              <Trash2 size={14} />
            </ToolbarButton>
          </>
        )}
        {allowImages && (
          <>
            <div className="w-px h-4 bg-slate-200 mx-1" />
            <ToolbarButton
              title="Insert image by URL"
              onClick={() => {
                const url = window.prompt('Image URL (include https://)');
                if (url) editor.chain().focus().setImage({ src: url }).run();
              }}
            >
              <ImageIcon size={14} />
            </ToolbarButton>
            {onUploadImage && (
              <>
                <ToolbarButton title="Upload company logo" onClick={() => fileRef.current?.click()}>
                  <Building2 size={14} />
                </ToolbarButton>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ''; // allow re-picking the same file
                    if (!file) return;
                    const url = await onUploadImage(file);
                    if (url) editor.chain().focus().setImage({ src: url }).run();
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
      <div className="relative">
        {placeholder && isEmpty && !editor.isActive('bulletList') && !editor.isActive('orderedList') && (
          // A JS-driven overlay, not Tiptap's Placeholder extension (which
          // needs a `.is-editor-empty::before{content:attr(data-placeholder)}`
          // rule) — this component is shared across bundles with their own
          // separate scoped CSS files (leads-hub, sales-tools); a plain
          // React condition needs no CSS added to either one.
          //
          // isEmpty (no text) and "renders a list marker" aren't mutually
          // exclusive — toggling Bullet/Numbered List with nothing typed yet
          // still has editor.isEmpty === true, but the browser paints a
          // real "1." marker for that empty <li>, landing right under this
          // overlay. Suppress the placeholder for that case specifically
          // rather than trying to out-position a marker whose width varies.
          <span className="absolute top-2 left-3 text-sm text-slate-400 pointer-events-none">{placeholder}</span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
