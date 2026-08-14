/**
 * ReplyComposer.jsx
 *
 * Inline reply composer for an active thread.
 *
 * - Collapsed by default (shows "↩ Reply" button)
 * - Expands on click with a smooth animation
 * - Auto-scrolls into view when expanded
 * - Collapses and clears after successful send
 * - Keeps body content on send failure (don't lose the user's work)
 * - Handles attachments via useAttachments hook
 * - Disables Send when body is empty
 * - Auto-prefixes "Re: " to subject only if not already prefixed
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAttachments } from './hooks/useAttachments';
import { RichTextToolbar } from './richTextToolbar';

export function ReplyComposer({ thread, token, apiBase, onSent }) {
  const [open, setOpen]       = useState(false);
  const [body, setBody]       = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [cc, setCc]           = useState('');
  const [bcc, setBcc]         = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState(null);
  const composerRef           = useRef(null);
  const textareaRef           = useRef(null);
  const fileInputRef          = useRef(null);

  const { attachments, addFile, removeFile, clear: clearAttachments } = useAttachments();

  // Auto-scroll when expanded
  useEffect(() => {
    if (open && composerRef.current) {
      composerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [open]);

  const handleSend = useCallback(async () => {
    if (!body.trim()) return;
    setSending(true);
    setError(null);

    const base = apiBase || window.__CRM_API_BASE__ || '';
    const subject = thread.subject?.startsWith('Re:')
      ? thread.subject
      : `Re: ${thread.subject || ''}`;

    const form = new FormData();
    form.append('lead_id',  thread.lead_id);
    form.append('to_email', thread.lead_email || '');
    form.append('subject',  subject);
    form.append('body',     body);
    form.append('thread_id', thread.nylas_thread_id || '');
    if (cc.trim()) form.append('cc', cc.trim());
    if (bcc.trim()) form.append('bcc', bcc.trim());
    attachments.forEach(a => form.append('attachments', a.file));

    try {
      const resp = await fetch(`${base}/api/email/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `Send failed (${resp.status})`);
      }
      try {
        window.mixpanel?.track('Email Sent', {
          has_cc: !!cc.trim(), has_bcc: !!bcc.trim(),
          has_attachments: attachments.length > 0, is_reply: true,
        });
      } catch { /* analytics is best-effort */ }
      // Success: collapse and clear
      setBody('');
      if (textareaRef.current) textareaRef.current.innerHTML = '';
      setCc('');
      setBcc('');
      clearAttachments();
      setOpen(false);
      onSent?.();
    } catch (e) {
      // Keep body on failure
      setError(e.message);
    } finally {
      setSending(false);
    }
  }, [body, cc, bcc, thread, token, apiBase, attachments, clearAttachments, onSent]);

  // Cannot reply if no nylas_thread_id (old/unlinked record)
  const canReply = !!thread.nylas_thread_id;

  if (!canReply) {
    return (
      <div className="eh-reply-disabled">
        <span title="This email was not sent via RCM — reply from your email client directly.">
          ↩ Reply unavailable (sent outside RCM)
        </span>
      </div>
    );
  }

  return (
    <div className="eh-reply-composer" ref={composerRef}>
      {!open ? (
        <button className="eh-reply-trigger" onClick={() => setOpen(true)}>
          ↩ Reply
        </button>
      ) : (
        <div className="eh-reply-form">
          {!showCcBcc ? (
            <button type="button" className="eh-cc-bcc-toggle" onClick={() => setShowCcBcc(true)}>
              Cc/Bcc
            </button>
          ) : (
            <div className="eh-cc-bcc-row">
              <input type="text" placeholder="Cc (optional)" value={cc} onChange={e => setCc(e.target.value)} />
              <input type="text" placeholder="Bcc (optional)" value={bcc} onChange={e => setBcc(e.target.value)} />
            </div>
          )}
          <RichTextToolbar editableRef={textareaRef} onChange={setBody} />
          <div
            ref={textareaRef}
            className="eh-reply-textarea"
            contentEditable
            data-placeholder="Type your reply here..."
            onInput={e => setBody(e.currentTarget.innerHTML)}
            onBlur={e => setBody(e.currentTarget.innerHTML)}
            style={{ minHeight: 90 }}
          />

          {attachments.length > 0 && (
            <div className="eh-reply-attachments">
              {attachments.map(a => (
                <span key={a.id} className="eh-reply-att-chip">
                  📎 {a.file.name}
                  <button onClick={() => removeFile(a.id)} className="eh-att-remove">×</button>
                </span>
              ))}
            </div>
          )}

          {error && <div className="eh-reply-error">⚠ {error}</div>}

          <div className="eh-reply-actions">
            <button
              className="eh-btn-ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              📎 Attach
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={e => {
                Array.from(e.target.files || []).forEach(addFile);
                e.target.value = '';
              }}
            />
            <div className="eh-reply-actions-right">
              <button
                className="eh-btn-ghost"
                onClick={() => { setOpen(false); setError(null); }}
                disabled={sending}
              >
                Cancel
              </button>
              <button
                className="eh-btn-primary"
                onClick={handleSend}
                disabled={sending || !body.trim()}
              >
                {sending ? 'Sending…' : '✉ Send Reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
