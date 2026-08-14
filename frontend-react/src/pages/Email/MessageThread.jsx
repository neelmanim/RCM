/**
 * MessageThread.jsx
 *
 * Right panel — renders all MessageBubble components for the selected thread
 * and the ReplyComposer at the bottom.
 */
import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { ReplyComposer } from './ReplyComposer';

export function MessageThread({ thread, lead, token, apiBase, onSent }) {
  const bottomRef = useRef(null);

  // Auto-scroll to bottom when thread changes or new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.messages.length, thread.nylas_thread_id]);

  // Build the thread object needed by ReplyComposer
  const threadForComposer = {
    nylas_thread_id: thread.nylas_thread_id,
    subject: thread.subject,
    lead_id: lead?.id,
    lead_email: lead?.email,
  };

  return (
    <div className="eh-thread-view">
      {/* Thread header */}
      <div className="eh-thread-header">
        <div className="eh-thread-header-subject">
          {thread.subject || '(no subject)'}
        </div>
        <div className="eh-thread-header-meta">
          Thread with {lead?.first_name || 'Lead'}
          {lead?.email ? ` · ${lead.email}` : ''}
        </div>
      </div>

      {/* Messages */}
      <div className="eh-messages-scroll">
        {thread.messages.map((msg, idx) => (
          <MessageBubble
            key={msg.nylas_message_id || msg.id || idx}
            message={msg}
            token={token}
            apiBase={apiBase}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Reply composer */}
      <div className="eh-reply-section">
        <ReplyComposer
          thread={threadForComposer}
          token={token}
          apiBase={apiBase}
          onSent={onSent}
        />
      </div>
    </div>
  );
}
