/**
 * ThreadItem.jsx
 *
 * One thread row in the email sidebar.
 * Shows: sender, subject (linked), body preview, date, message count badge.
 */
import React from 'react';
import { htmlToPlainText } from '../../lib/htmlText';

function fmtDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ThreadItem({ thread, isActive, onClick }) {
  const lastMsg   = thread.messages[thread.messages.length - 1];
  const firstMsg  = thread.messages[0];
  const msgCount  = thread.messages.length;
  const hasUnread = thread.messages.some(m => m.direction === 'inbound');

  // Display the "other" party — inbound sender or outbound recipient
  const counterparty = firstMsg?.direction === 'outbound'
    ? (lastMsg?.from_email || firstMsg?.to_email)
    : (lastMsg?.from_email || firstMsg?.from_email);

  return (
    <button
      className={`eh-thread-item ${isActive ? 'eh-thread-active' : ''}`}
      onClick={onClick}
    >
      <div className="eh-thread-top">
        <span className="eh-thread-party">{counterparty}</span>
        <span className="eh-thread-date">{fmtDate(lastMsg?.timestamp)}</span>
      </div>
      <div className="eh-thread-subject">
        {hasUnread && <span className="eh-unread-dot" />}
        {thread.subject || '(no subject)'}
      </div>
      <div className="eh-thread-preview-row">
        <span className="eh-thread-preview">
          {htmlToPlainText(lastMsg?.body_preview).slice(0, 70)}
        </span>
        {msgCount > 1 && (
          <span className="eh-thread-count">
            {msgCount} msg{msgCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  );
}
