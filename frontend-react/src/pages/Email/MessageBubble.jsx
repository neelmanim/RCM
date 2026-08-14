/**
 * MessageBubble.jsx
 *
 * Renders a single email message bubble.
 *
 * - Outbound: right-aligned, blue left border
 * - Inbound:  left-aligned, grey left border
 * - HTML body rendered safely via DOMParser (strips script/iframe)
 * - Plain-text body rendered as-is
 * - Shows TrackingBadge for outbound messages
 * - Shows AttachmentChip for any attachments
 */
import React, { useMemo, useState } from 'react';
import { TrackingBadge } from './TrackingBadge';
import { AttachmentChip } from './AttachmentChip';

/** Relative time formatter */
function fmtTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Decode HTML entities (e.g. &middot; → ·, &amp; → &) */
function decodeHtmlEntities(str) {
  if (!str) return str;
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

/** Safely render HTML email body via DOMParser */
function useSafeHtml(body) {
  return useMemo(() => {
    if (!body) return null;
    const trimmed = body.trim();
    // Decode entities first so &middot; → · even before HTML check
    const decoded = decodeHtmlEntities(trimmed);
    // If it looks like HTML, sanitize and render as HTML
    if (trimmed.startsWith('<')) {
      const doc = new DOMParser().parseFromString(trimmed, 'text/html');
      doc.querySelectorAll('script,style,iframe,object,embed,form').forEach(el => el.remove());
      const html = doc.body.innerHTML.trim();
      return html ? { html } : null;
    }
    // Plain text with decoded entities — return as decoded plain text
    return decoded !== trimmed ? { plain: decoded } : null;
  }, [body]);
}

/** Detect and strip quoted reply content (> prefix or "On ... wrote:" lines) */
function splitQuoted(body) {
  if (!body) return { main: '', quoted: '' };
  // Common: "On <date> wrote:" or "> " prefix
  const quotedIdx = body.search(/\n(On .+wrote:|\n?>{1,})/);
  if (quotedIdx > 50) {
    return { main: body.slice(0, quotedIdx).trim(), quoted: body.slice(quotedIdx).trim() };
  }
  return { main: body, quoted: '' };
}

export function MessageBubble({ message, token, apiBase }) {
  const isOutbound = message.direction === 'outbound';
  const [showQuoted, setShowQuoted] = useState(false);

  const safeHtml = useSafeHtml(message.body_preview);

  // For plain text: split quoted content
  const rawBody = message.body_preview || '';
  const { main: plainMain, quoted: plainQuoted } = useMemo(
    () => (!safeHtml?.html ? splitQuoted(safeHtml?.plain || rawBody) : { main: '', quoted: '' }),
    [safeHtml, rawBody]
  );

  const senderLabel = isOutbound
    ? (message.user_name || message.from_email || 'You')
    : (message.from_email || 'Lead');

  const attachments = message.attachments || [];

  return (
    <div className={`eh-bubble-wrap ${isOutbound ? 'eh-outbound' : 'eh-inbound'}`}>
      <div className={`eh-bubble ${isOutbound ? 'eh-bubble-out' : 'eh-bubble-in'}`}>
        {/* Meta line */}
        <div className="eh-bubble-meta">
          <span className="eh-bubble-sender">{senderLabel}</span>
          <span className="eh-bubble-time">{fmtTime(message.timestamp)}</span>
        </div>

        {/* Body */}
        <div className="eh-bubble-body">
          {safeHtml?.html ? (
            <div
              className="eh-bubble-html"
              dangerouslySetInnerHTML={{ __html: safeHtml.html }}
            />
          ) : (
            <div className="eh-bubble-text">
              <span>{plainMain || <em className="eh-no-content">(no content)</em>}</span>
              {plainQuoted && (
                <>
                  <button
                    className="eh-quoted-toggle"
                    onClick={() => setShowQuoted(v => !v)}
                  >
                    {showQuoted ? '▲ Hide quoted' : '▼ Show quoted text'}
                  </button>
                  {showQuoted && <div className="eh-quoted">{plainQuoted}</div>}
                </>
              )}
            </div>
          )}
        </div>

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="eh-bubble-attachments">
            {attachments.map(att => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                token={token}
                apiBase={apiBase}
                messageId={message.nylas_message_id}
              />
            ))}
          </div>
        )}

        {/* Tracking badge (outbound only) */}
        {isOutbound && (
          <div className="eh-bubble-tracking">
            <TrackingBadge
              openCount={message.open_count}
              openedAt={message.opened_at}
            />
          </div>
        )}
      </div>
    </div>
  );
}
