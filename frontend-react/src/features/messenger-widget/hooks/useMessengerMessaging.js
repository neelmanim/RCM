import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationsService } from '../../../services/api';
import { toast } from '../engine/toast';

// The actual bug this whole port started from: the vanilla widget could only
// ever SEND, never fetch real history or receive live updates. This hook is
// the fix — real history load, live polling, dedup against optimistic sends,
// and a lead-scoped unread badge. Every /api/conversations/* call is
// lead_id+phone ownership-checked server-side (see backend Phase 0).
//
// Cancellation uses AbortController tied to useEffect's dependency array —
// the React-idiomatic replacement for the hand-rolled generation-counter
// guard the vanilla version needed (a lead switch aborts the in-flight
// fetch before the new one starts; no manual bookkeeping required).

const HISTORY_POLL_MS = 15000;
const BADGE_POLL_MS = 30000;
const PENDING_DROP_MS = 45000; // drop an unmatched optimistic send after ~3 poll cycles

function isCanceled(err) {
  return err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED';
}

// Module-level, fetched once per page load and shared across every widget
// mount/lead-switch — this is an org-wide setting, not a per-lead one. Orgs
// that only use Aircall (no Alternate Messenger credentials configured) would
// otherwise have this hook poll session-state/history/badge endpoints that
// 503 on every call, spamming the console with failed-request errors for a
// feature the org never turned on.
let _configuredPromise = null;
function getMessagingConfigured() {
  if (!_configuredPromise) {
    _configuredPromise = Promise.resolve()
      .then(() => ConversationsService.getStatus())
      .then((d) => !!d?.configured)
      .catch(() => true); // fail open — a status-check hiccup shouldn't disable messaging
  }
  return _configuredPromise;
}

function toRenderMessage(m) {
  return {
    id: 'srv-' + m.message_id,
    dir: m.direction === 'in' ? 'inbound' : 'outbound',
    text: m.text,
    time: new Date(m.created_on),
    status: m.delivery_status || 'sent',
  };
}

function looksLikeMatch(serverMsg, localMsg) {
  if (serverMsg.dir !== localMsg.dir) return false;
  if (Math.abs(serverMsg.time.getTime() - localMsg.time.getTime()) > 120000) return false;
  return serverMsg.text.trim() === localMsg.text.trim();
}

/** Server messages are the source of truth; any still-pending optimistic
 * local send that doesn't yet have a matching server message is kept
 * (it's always chronologically newest, so simple concatenation preserves
 * order — no client-side re-sort needed). Unmatched pending entries older
 * than PENDING_DROP_MS are dropped rather than accumulated indefinitely —
 * templates with placeholders beyond ${contacts.first_name} won't
 * text-match, this bounds that to a single missing bubble, never a
 * permanent duplicate. */
function reconcile(prevMessages, serverMessages) {
  const serverRendered = serverMessages.map(toRenderMessage);
  const now = Date.now();
  const stillPending = prevMessages.filter((m) => (
    String(m.id).startsWith('local-')
    && now - m.time.getTime() < PENDING_DROP_MS
    && !serverRendered.some((s) => looksLikeMatch(s, m))
  ));
  return [...serverRendered, ...stillPending];
}

const seenKey = (id) => `alternate:conv-seen:${id}`;
const loadSeen = (id) => { try { return Number(localStorage.getItem(seenKey(id))) || 0; } catch { return 0; } };
const saveSeen = (id, n) => { try { localStorage.setItem(seenKey(id), String(n)); } catch { /* storage blocked: badge just stays honest to the server */ } };

export function useMessengerMessaging({ leadId, leadPhone, leadName, senderId, panelOpen, tabActive }) {
  const [channel, setChannelState] = useState('whatsapp');
  const [sessionState, setSessionState] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sessionRefreshTick, setSessionRefreshTick] = useState(0);
  // null = status check still in flight — every gated effect below treats
  // that the same as "not configured yet" so nothing fires before we know
  // for sure, instead of racing the very first request against the check.
  const [messagingConfigured, setMessagingConfigured] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getMessagingConfigured().then((c) => { if (!cancelled) setMessagingConfigured(c); });
    return () => { cancelled = true; };
  }, []);

  const historyKeyRef = useRef(null);
  const historyFailCountRef = useRef(0);
  const templatesLoadedRef = useRef(false);
  const seenInboundIdsRef = useRef(new Set());

  const setChannel = useCallback((ch) => {
    setChannelState(ch);
    setSelectedTemplate(null);
  }, []);

  // Reset per-conversation state whenever the lead or channel changes —
  // replaces the vanilla file's _resetMessagingContext() call sites.
  useEffect(() => {
    setSessionState(null);
    setMessages([]);
    setSelectedTemplate(null);
    setTemplates([]);
    templatesLoadedRef.current = false;
    historyKeyRef.current = null;
    historyFailCountRef.current = 0;
    seenInboundIdsRef.current = new Set();
  }, [leadId, channel]);

  // ── Session-state (template-required? free-text? conversation_id?) ──────
  useEffect(() => {
    if (!leadId || !leadPhone || !senderId || messagingConfigured !== true) return;
    const controller = new AbortController();
    setSessionLoading(true);
    ConversationsService.getSessionState(leadId, leadPhone, senderId, channel, { signal: controller.signal })
      .then((state) => setSessionState(state))
      .catch((err) => { if (!isCanceled(err)) console.warn('[useMessengerMessaging] session-state failed:', err.message); })
      .finally(() => setSessionLoading(false));
    return () => controller.abort();
  }, [leadId, leadPhone, senderId, channel, sessionRefreshTick, messagingConfigured]);

  // ── WhatsApp template list — lazy, only once a template is actually needed ──
  useEffect(() => {
    if (channel !== 'whatsapp' || !sessionState?.requires_template || templatesLoadedRef.current) return;
    templatesLoadedRef.current = true;
    ConversationsService.getTemplates()
      .then((data) => setTemplates(data.templates || []))
      .catch(() => toast("Couldn't load templates", 'error'));
  }, [channel, sessionState?.requires_template]);

  // ── Real history load + polling (the actual bug fix) ─────────────────────
  useEffect(() => {
    const conversationId = sessionState?.conversation_id;
    if (!leadId || !conversationId) return;
    const key = `${leadId}|${channel}|${conversationId}`;
    const controller = new AbortController();
    let cancelled = false;

    async function load(force) {
      if (!force && historyKeyRef.current === key) return; // already loaded for this context
      try {
        const data = await ConversationsService.getMessages(leadId, conversationId, { count: 50 }, { signal: controller.signal });
        if (cancelled) return;
        const serverMessages = data.messages || [];
        setMessages((prev) => reconcile(prev, serverMessages));
        // A fresh inbound reply can flip session-state (e.g. re-open the
        // 24h WhatsApp window), but session-state only re-fetches on
        // lead/channel change — bump the same tick a send uses so a poll
        // that surfaces a new inbound message refreshes it too.
        const hasNewInbound = serverMessages.some((m) => m.direction === 'in' && !seenInboundIdsRef.current.has(m.message_id));
        serverMessages.forEach((m) => seenInboundIdsRef.current.add(m.message_id));
        if (force && hasNewInbound) setSessionRefreshTick((t) => t + 1);
        historyKeyRef.current = key;
        historyFailCountRef.current = 0;
      } catch (err) {
        if (isCanceled(err)) return;
        console.warn('[useMessengerMessaging] history fetch failed:', err.message);
        historyFailCountRef.current += 1;
      }
    }

    load(false);

    // ponytail: fixed interval, no exponential backoff — stop after 3
    // consecutive failures rather than hammering a down API; revisit if
    // Alternate Messenger outages become frequent enough to need real backoff.
    let interval = null;
    if (panelOpen && tabActive) {
      interval = setInterval(() => {
        if (historyFailCountRef.current >= 3) return;
        load(true);
      }, HISTORY_POLL_MS);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (interval) clearInterval(interval);
    };
  }, [leadId, channel, sessionState?.conversation_id, panelOpen, tabActive]);

  // ── Unread badge — independent of panel/tab visibility, lead-scoped only ──
  // Alternate Messenger exposes no "mark as read" call, so its unread_message_count never drops just because the
  // rep read the thread here (the badge stuck at 1 after reading). We keep a per-browser "seen" mark per
  // conversation: the badge shows unread beyond what was seen while the panel was open on this thread.
  // A new inbound raises Alternate Messenger's count above the mark and the badge returns; if Alternate Messenger does reset
  // its count, the mark follows it down. Per-browser by design (not shared across devices).
  const conversationsRef = useRef([]);
  const viewingRef = useRef(false);
  viewingRef.current = !!(panelOpen && tabActive);

  const recomputeBadge = useCallback(() => {
    let total = 0;
    for (const c of conversationsRef.current) {
      const unread = c.unread_message_count || 0;
      let seen = loadSeen(c.id);
      if (unread < seen || viewingRef.current) { seen = unread; saveSeen(c.id, seen); }
      total += unread - seen;
    }
    setUnreadCount(total);
  }, []);

  useEffect(() => {
    if (!leadId || !leadPhone || messagingConfigured !== true) { conversationsRef.current = []; setUnreadCount(0); return; }
    const controller = new AbortController();
    let cancelled = false;

    async function poll() {
      try {
        const data = await ConversationsService.list(leadId, leadPhone, { status: 'open' }, { signal: controller.signal });
        if (cancelled) return;
        conversationsRef.current = data.conversations || [];
        recomputeBadge();
      } catch (err) {
        if (!isCanceled(err)) console.warn('[useMessengerMessaging] badge poll failed:', err.message);
      }
    }

    poll();
    const interval = setInterval(poll, BADGE_POLL_MS);
    return () => { cancelled = true; controller.abort(); clearInterval(interval); };
  }, [leadId, leadPhone, messagingConfigured, recomputeBadge]);

  // Opening the Messages view (or returning to the tab) counts as reading what is unread now.
  useEffect(() => { if (panelOpen && tabActive) recomputeBadge(); }, [panelOpen, tabActive, recomputeBadge]);

  const sendMessage = useCallback(async (composeText) => {
    if (messagingConfigured !== true) { toast('Messaging is not set up for this workspace', 'error'); return; }
    const useTemplate = channel === 'whatsapp' && sessionState?.requires_template;
    if (useTemplate && !selectedTemplate) { toast('Please select a template', 'error'); return; }
    if (!useTemplate && !composeText?.trim()) return;
    if (!leadPhone) { toast('No lead phone number', 'error'); return; }

    setSending(true);
    const body = {
      lead_id: leadId,
      phone: leadPhone,
      sender_id: senderId,
      channel,
      conversation_id: sessionState?.conversation_id ?? null,
      contact_first_name: leadName || '',
      reference_type: 'contacts',
      ...(useTemplate ? { template_name: selectedTemplate.name } : { text: composeText.trim() }),
    };
    const displayText = useTemplate
      ? (selectedTemplate.template_text || '').replace(/\$\{contacts\.first_name\}/g, leadName || '')
      : composeText.trim();

    try {
      await ConversationsService.send(body);
      setMessages((prev) => [...prev, {
        id: 'local-' + Date.now(), dir: 'outbound', text: displayText, time: new Date(), status: 'sent',
      }]);
      toast('Message sent', 'success', 2000);
      if (useTemplate) {
        setSessionState((prev) => (prev ? { ...prev, requires_template: false } : prev));
      }
      if (!sessionState?.conversation_id) {
        // Brand-new thread — conversation_id doesn't exist yet. Alternate Messenger
        // may not index it immediately; one bounded delayed re-check picks
        // it up, which then chains into the history-load effect above.
        setTimeout(() => setSessionRefreshTick((t) => t + 1), 2000);
      }
      return true;
    } catch (err) {
      toast(err?.response?.data?.detail || 'Send failed', 'error');
      return false;
    } finally {
      setSending(false);
    }
  }, [channel, sessionState, selectedTemplate, leadPhone, leadId, senderId, leadName, messagingConfigured]);

  return {
    channel, setChannel,
    sessionState, sessionLoading,
    messages,
    templates, selectedTemplate, setSelectedTemplate,
    sending, sendMessage,
    unreadCount,
    messagingConfigured,
  };
}
