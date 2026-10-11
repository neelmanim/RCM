/**
 * EmailHub.jsx
 *
 * Root component of the React Email Hub.
 *
 * Responsibilities:
 *   - Fetch email status (configured? connected?)
 *   - Fetch and poll emails for the lead (via useEmails)
 *   - Group flat email list into threads
 *   - Manage selected thread index and compose mode
 *   - Render split-pane: ThreadSidebar (left) + MessageThread/ComposeDrawer (right)
 *
 * Edge cases handled:
 *   - Nylas not configured → Admin CTA
 *   - Mailbox not connected → Connect button
 *   - Lead has no email → Warning banner
 *   - Empty thread list → CTA with compose prompt
 *   - API error → Retry button, stale data preserved
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Mail, Link2, AlertTriangle, XCircle } from 'lucide-react';
import { useEmails } from './hooks/useEmails';
import { ThreadSidebar } from './ThreadSidebar';
import { MessageThread } from './MessageThread';
import { ComposeDrawer } from './ComposeDrawer';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';

/** Group flat email array into threads keyed by nylas_thread_id or subject. */
function groupThreads(emails) {
  const map = new Map();
  const order = [];

  for (const email of emails) {
    const key = email.nylas_thread_id || email.subject || `solo-${email.id}`;
    if (!map.has(key)) {
      map.set(key, {
        nylas_thread_id: email.nylas_thread_id || null,
        subject: email.subject?.replace(/^(Re:\s*)+/i, '') || '(no subject)',
        messages: [],
        lastTimestamp: null,
      });
      order.push(key);
    }
    const thread = map.get(key);
    thread.messages.push(email);
    if (email.timestamp && (!thread.lastTimestamp || email.timestamp > thread.lastTimestamp)) {
      thread.lastTimestamp = email.timestamp;
    }
  }

  // Sort messages within each thread chronologically
  for (const thread of map.values()) {
    thread.messages.sort((a, b) => (a.timestamp || '') < (b.timestamp || '') ? -1 : 1);
  }

  // Sort threads: most recent first
  return order
    .map(k => map.get(k))
    .sort((a, b) => (a.lastTimestamp || '') < (b.lastTimestamp || '') ? 1 : -1);
}

/** Fetch email account status */
async function fetchEmailStatus(token, apiBase) {
  const base = apiBase || window.__CRM_API_BASE__ || '';
  const resp = await fetch(`${base}/api/email/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

export function EmailHub({ leadId, lead, token, apiBase, initialEmailId = null, initialMode = 'thread' }) {
  const [status,      setStatus]      = useState(null);  // email account status
  const [statusLoad,  setStatusLoad]  = useState(true);
  const [activeIdx,   setActiveIdx]   = useState(0);
  const [mode,        setMode]        = useState(initialMode); // 'thread' | 'compose'

  const { emails, loading, error, refetch } = useEmails(leadId, token, apiBase);

  // Fetch email status once on mount
  useEffect(() => {
    setStatusLoad(true);
    fetchEmailStatus(token, apiBase)
      .then(s => setStatus(s))
      .catch(() => setStatus(null))
      .finally(() => setStatusLoad(false));
  }, [token, apiBase]);

  // Group emails into threads (memoized)
  const threads = useMemo(() => groupThreads(emails), [emails]);

  // Lead Detail opens the hub on the email that was clicked — select its thread once.
  const [focusedOnce, setFocusedOnce] = useState(false);
  useEffect(() => {
    if (focusedOnce || !initialEmailId || threads.length === 0) return;
    const idx = threads.findIndex((t) => t.messages.some((m) => m.id === initialEmailId));
    if (idx >= 0) setActiveIdx(idx);
    setFocusedOnce(true);
  }, [threads, initialEmailId, focusedOnce]);

  // Keep activeIdx in bounds
  const safeActiveIdx = Math.min(activeIdx, Math.max(0, threads.length - 1));

  const handleSent = useCallback(() => {
    refetch();
    setMode('thread');
  }, [refetch]);

  const handleConnectEmail = () => {
    const base = apiBase || window.__CRM_API_BASE__ || '';
    fetch(`${base}/api/email/auth-url`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.auth_url) window.open(data.auth_url, '_blank');
      });
  };

  // ── Skeleton loading state ────────────────────────────────────────────────────────
  if (statusLoad || loading) {
    return (
      <div className="eh-root">
        {/* Sidebar skeleton */}
        <div className="eh-sidebar eh-skeleton-sidebar">
          <div className="eh-skeleton-btn" />
          {[1,2,3,4].map(i => (
            <div key={i} className="eh-skeleton-thread-item">
              <div className="eh-skeleton-line eh-skeleton-line--short" />
              <div className="eh-skeleton-line eh-skeleton-line--long" />
              <div className="eh-skeleton-line eh-skeleton-line--medium" />
            </div>
          ))}
        </div>
        {/* Main pane skeleton */}
        <div className="eh-main eh-skeleton-main">
          <div className="eh-skeleton-bubble eh-skeleton-bubble--out">
            <div className="eh-skeleton-line eh-skeleton-line--short" />
            <div className="eh-skeleton-line eh-skeleton-line--long" />
          </div>
          <div className="eh-skeleton-bubble eh-skeleton-bubble--in">
            <div className="eh-skeleton-line eh-skeleton-line--medium" />
            <div className="eh-skeleton-line eh-skeleton-line--long" />
          </div>
          <div className="eh-skeleton-bubble eh-skeleton-bubble--out">
            <div className="eh-skeleton-line eh-skeleton-line--short" />
          </div>
        </div>
      </div>
    );
  }

  // ── Not configured ────────────────────────────────────────────────────────
  // Backend returns `nylas_configured` (not `configured`)
  if (status && !status.nylas_configured) {
    return (
      <div className="eh-root">
        <EmptyState
          icon={Mail}
          title="Email Not Configured"
          message="Ask your Super Admin to configure the Nylas email integration in Admin → Settings."
        />
      </div>
    );
  }

  // ── No mailbox connected ──────────────────────────────────────────────────
  if (status && !status.connected) {
    return (
      <div className="eh-root">
        <EmptyState
          icon={Link2}
          title="Connect Your Email"
          message="Connect your Gmail or Outlook account to send and track emails from Alternate CRM."
          action={<Button id="eh-connect-email-btn" onClick={handleConnectEmail}>Connect Email Account</Button>}
        />
      </div>
    );
  }

  // ── Lead has no email address ─────────────────────────────────────────────
  if (!lead?.email) {
    return (
      <div className="eh-root">
        <EmptyState
          icon={AlertTriangle}
          title="No Email Address"
          message="Add an email address to this lead to enable email tracking."
        />
      </div>
    );
  }

  // ── API error with no cached data ─────────────────────────────────────────
  if (error && emails.length === 0) {
    return (
      <div className="eh-root">
        <EmptyState
          icon={XCircle}
          title="Could not load emails"
          message={error}
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  const connectedEmail = status?.email || '';

  // ── Main split-pane layout ────────────────────────────────────────────────
  return (
    <div className="eh-root">
      {/* Left sidebar */}
      <ThreadSidebar
        threads={threads}
        activeIdx={safeActiveIdx}
        onSelect={idx => { setActiveIdx(idx); setMode('thread'); }}
        onCompose={() => setMode('compose')}
        onRefresh={refetch}
        connectedEmail={connectedEmail}
      />

      {/* Right panel */}
      <div className="eh-main">
        {mode === 'compose' ? (
          <ComposeDrawer
            lead={lead}
            token={token}
            apiBase={apiBase}
            onSent={handleSent}
            onClose={() => setMode('thread')}
          />
        ) : threads.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No emails yet"
            message={`Send the first email to ${lead.first_name || lead.email} from Alternate CRM, or emails you've sent directly from Gmail will sync here automatically.`}
            action={<Button onClick={() => setMode('compose')}>✏ Compose Email</Button>}
            className="eh-main-empty"
          />
        ) : (
          <MessageThread
            thread={threads[safeActiveIdx]}
            lead={lead}
            token={token}
            apiBase={apiBase}
            onSent={handleSent}
          />
        )}
      </div>
    </div>
  );
}
