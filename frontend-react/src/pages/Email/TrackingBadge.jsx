/**
 * TrackingBadge.jsx
 *
 * Displays a colored tracking-status pill under outbound email bubbles.
 *
 * States:
 *   opened   → green pill, "👁 Opened Nx · 2h ago"
 *   sent     → muted grey pill, "✓ Sent"
 */
import React from 'react';

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function TrackingBadge({ openCount, openedAt }) {
  const count = openCount || 0;
  const hasOpened = count > 0 || !!openedAt;

  if (hasOpened) {
    const displayCount = count > 0 ? count : 1; // openedAt set but count 0 → show 1
    return (
      <span className="eh-tracking-badge eh-tracking-opened">
        👁 Opened {displayCount}× · {timeAgo(openedAt)}
      </span>
    );
  }

  return (
    <span className="eh-tracking-badge eh-tracking-sent">
      ✓ Sent
    </span>
  );
}
