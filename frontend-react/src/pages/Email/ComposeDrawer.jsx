/**
 * ComposeDrawer.jsx
 *
 * Full compose form for sending a new email to the lead.
 * - Requires subject and body
 * - Handles attachments
 * - Clears on success, closes on cancel
 */
import React, { useState, useRef, useCallback } from 'react';
import { useAttachments } from './hooks/useAttachments';
import { RichTextToolbar } from './richTextToolbar';

export function ComposeDrawer({ lead, token, apiBase, onSent, onClose }) {
  const [subject, setSubject] = useState('');
  const [body,    setBody]    = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [cc,      setCc]      = useState('');
  const [bcc,     setBcc]     = useState('');
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState(null);
  const fileInputRef          = useRef(null);
  const bodyRef                = useRef(null);

  const { attachments, addFile, removeFile, clear: clearAttachments } = useAttachments();

  const handleSend = useCallback(async () => {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    setError(null);

    const base = apiBase || window.__CRM_API_BASE__ || '';
    const form = new FormData();
    form.append('lead_id',  lead.id);
    form.append('to_email', lead.email || '');
    form.append('subject',  subject);
    form.append('body',     body);
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
          has_attachments: attachments.length > 0, is_reply: false,
        });
      } catch { /* analytics is best-effort */ }
      setSubject('');
      setBody('');
      if (bodyRef.current) bodyRef.current.innerHTML = '';
      setCc('');
      setBcc('');
      clearAttachments();
      onSent?.();
      onClose?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }, [subject, body, cc, bcc, lead, token, apiBase, attachments, clearAttachments, onSent, onClose]);

  return (
    <div className="eh-compose-drawer">
      <div className="eh-compose-header">
        <span>✉ New Email to {lead.email || lead.first_name}</span>
        <button className="eh-compose-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          className="eh-compose-subject"
          placeholder="Subject"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          style={{ flex: 1 }}
        />
        {!showCcBcc && (
          <button type="button" className="eh-cc-bcc-toggle" onClick={() => setShowCcBcc(true)}>
            Cc/Bcc
          </button>
        )}
      </div>

      {showCcBcc && (
        <div className="eh-cc-bcc-row">
          <input type="text" placeholder="Cc (optional)" value={cc} onChange={e => setCc(e.target.value)} />
          <input type="text" placeholder="Bcc (optional)" value={bcc} onChange={e => setBcc(e.target.value)} />
        </div>
      )}

      <RichTextToolbar editableRef={bodyRef} onChange={setBody} />
      <div
        ref={bodyRef}
        className="eh-compose-body"
        contentEditable
        data-placeholder="Write your email here..."
        onInput={e => setBody(e.currentTarget.innerHTML)}
        onBlur={e => setBody(e.currentTarget.innerHTML)}
        style={{ minHeight: 160 }}
      />

      {attachments.length > 0 && (
        <div className="eh-compose-attachments">
          {attachments.map(a => (
            <span key={a.id} className="eh-reply-att-chip">
              📎 {a.file.name}
              <button onClick={() => removeFile(a.id)} className="eh-att-remove">×</button>
            </span>
          ))}
        </div>
      )}

      {error && <div className="eh-reply-error">⚠ {error}</div>}

      <div className="eh-compose-actions">
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
        <div className="eh-compose-actions-right">
          <button className="eh-btn-ghost" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            className="eh-btn-primary"
            onClick={handleSend}
            disabled={sending || !subject.trim() || !body.trim()}
          >
            {sending ? 'Sending…' : '✉ Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}
