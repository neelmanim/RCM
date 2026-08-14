/**
 * Shared toolbar for ComposeDrawer/ReplyComposer's contenteditable body —
 * native document.execCommand, no rich-text dependency. Bold/italic/link/
 * image-by-URL is all compose actually needs (see docs/backlog.md's
 * "customer feedback round" item 2 — no way to insert a link today).
 */
import React from 'react';

export function RichTextToolbar({ editableRef, onChange }) {
  const exec = (cmd, arg) => {
    editableRef.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange?.(editableRef.current?.innerHTML || '');
  };

  const insertLink = () => {
    const url = window.prompt('Link URL (include https://)');
    if (url) exec('createLink', url);
  };

  const insertImage = () => {
    const url = window.prompt('Image URL (include https://)');
    if (url) exec('insertImage', url);
  };

  return (
    <div className="eh-rte-toolbar">
      <button type="button" className="eh-rte-btn" onClick={() => exec('bold')} title="Bold"><b>B</b></button>
      <button type="button" className="eh-rte-btn" onClick={() => exec('italic')} title="Italic"><i>I</i></button>
      <button type="button" className="eh-rte-btn" onClick={insertLink} title="Insert link">🔗</button>
      <button type="button" className="eh-rte-btn" onClick={insertImage} title="Insert image">🖼</button>
    </div>
  );
}
