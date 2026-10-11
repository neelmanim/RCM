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
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';

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
        <Button id="eh-compose-btn" onClick={onCompose}>✏ Compose Email</Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          title="Refresh emails"
          aria-label="Refresh emails"
        >
          ↻
        </Button>
      </div>

      {/* Search */}
      <SearchInput
        placeholder="Search emails..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        aria-label="Search emails"
        className="eh-search"
      />

      {/* Thread list */}
      <div className="eh-thread-list">
        {filtered.length === 0 ? (
          <EmptyState message={query ? 'No emails match your search.' : 'No emails yet.'} />
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
