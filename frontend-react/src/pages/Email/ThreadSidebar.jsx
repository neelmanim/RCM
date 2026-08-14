/**
 * ThreadSidebar.jsx
 *
 * Left panel — thread list, search input, compose button, refresh button.
 * - Filters threads by subject or email address
 * - Highlights the active thread
 * - Shows message count badge per thread
 */
import React, { useState, useMemo } from 'react';
import { ThreadItem } from './ThreadItem';

export function ThreadSidebar({
  threads,
  activeIdx,
  onSelect,
  onCompose,
  onRefresh,
  connectedEmail,
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return threads.map((t, i) => ({ thread: t, origIdx: i }));
    const q = query.toLowerCase();
    return threads
      .map((t, i) => ({ thread: t, origIdx: i }))
      .filter(({ thread }) =>
        thread.subject?.toLowerCase().includes(q) ||
        thread.messages.some(
          m =>
            m.from_email?.toLowerCase().includes(q) ||
            m.body_preview?.toLowerCase().includes(q)
        )
      );
  }, [threads, query]);

  return (
    <div className="eh-sidebar">
      {/* Connected mailbox indicator */}
      {connectedEmail && (
        <div className="eh-sidebar-mailbox">
          <span className="eh-mailbox-dot" />
          {connectedEmail}
        </div>
      )}

      {/* Controls */}
      <div className="eh-sidebar-controls">
        <button
          id="eh-compose-btn"
          className="eh-btn-compose"
          onClick={onCompose}
        >
          ✏ Compose Email
        </button>
        <button
          className="eh-btn-icon"
          onClick={onRefresh}
          title="Refresh emails"
          aria-label="Refresh emails"
        >
          ↻
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        className="eh-search"
        placeholder="Search emails..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        aria-label="Search emails"
      />

      {/* Thread list */}
      <div className="eh-thread-list">
        {filtered.length === 0 ? (
          <div className="eh-empty-list">
            {query ? 'No emails match your search.' : 'No emails yet.'}
          </div>
        ) : (
          filtered.map(({ thread, origIdx }) => (
            <ThreadItem
              key={thread.nylas_thread_id || origIdx}
              thread={thread}
              isActive={origIdx === activeIdx}
              onClick={() => onSelect(origIdx)}
            />
          ))
        )}
      </div>
    </div>
  );
}
