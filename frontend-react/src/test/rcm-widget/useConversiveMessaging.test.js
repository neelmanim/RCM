import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRCMMessaging } from '../../features/rcm-widget/hooks/useRCMMessaging';
import { ConversationsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  ConversationsService: {
    getSessionState: vi.fn(),
    getTemplates: vi.fn(),
    getMessages: vi.fn(),
    send: vi.fn(),
    list: vi.fn(),
  },
}));

const baseProps = {
  leadId: 'lead-a', leadPhone: '9198765 43210', leadName: 'Jane', senderId: 'sender-1',
  panelOpen: true, tabActive: true,
};

describe('useRCMMessaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ConversationsService.getSessionState.mockResolvedValue({
      conversation_id: null, requires_template: false, is_live: 1, channel: 'whatsapp', last_direction: '',
    });
    ConversationsService.getMessages.mockResolvedValue({ messages: [] });
    ConversationsService.list.mockResolvedValue({ conversations: [] });
    ConversationsService.send.mockResolvedValue({ success: true, result: {} });
    ConversationsService.getTemplates.mockResolvedValue({ templates: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch anything when no lead/phone is set', () => {
    renderHook(() => useRCMMessaging({ ...baseProps, leadId: null, leadPhone: null }));
    expect(ConversationsService.getSessionState).not.toHaveBeenCalled();
  });

  it('fetches session-state with lead_id + phone + sender_id + channel', async () => {
    renderHook(() => useRCMMessaging(baseProps));
    await waitFor(() => expect(ConversationsService.getSessionState).toHaveBeenCalledWith(
      'lead-a', '9198765 43210', 'sender-1', 'whatsapp', expect.anything(),
    ));
  });

  it('does not fetch message history when there is no conversation_id yet (new contact)', async () => {
    const { result } = renderHook(() => useRCMMessaging(baseProps));
    await waitFor(() => expect(result.current.sessionLoading).toBe(false));
    expect(ConversationsService.getMessages).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it('loads real history once session-state resolves a conversation_id', async () => {
    ConversationsService.getSessionState.mockResolvedValue({
      conversation_id: 42, requires_template: false, is_live: 1, channel: 'whatsapp', last_direction: 'IN',
    });
    ConversationsService.getMessages.mockResolvedValue({
      messages: [{ message_id: 1, text: 'Hi from the lead', direction: 'in', created_on: '2026-07-29T10:00:00Z' }],
    });

    const { result } = renderHook(() => useRCMMessaging(baseProps));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({ id: 'srv-1', dir: 'inbound', text: 'Hi from the lead' });
  });

  it('aborts the in-flight session-state fetch when the lead changes before it resolves', async () => {
    // Capture every signal separately — the lead switch triggers a SECOND
    // call (for lead-b) whose fresh signal is naturally not aborted; the
    // assertion is specifically about the FIRST (lead-a) request.
    const signals = [];
    ConversationsService.getSessionState.mockImplementation((_l, _p, _s, _c, opts) => {
      signals.push(opts.signal);
      return new Promise(() => {}); // never resolves within this test
    });

    const { rerender } = renderHook((props) => useRCMMessaging(props), { initialProps: baseProps });
    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(1));
    const firstSignal = signals[0];
    expect(firstSignal.aborted).toBe(false);

    rerender({ ...baseProps, leadId: 'lead-b', leadPhone: '922222' });
    expect(firstSignal.aborted).toBe(true);
  });

  it('resets messages/sessionState when the lead changes', async () => {
    ConversationsService.getSessionState.mockResolvedValue({
      conversation_id: 42, requires_template: false, is_live: 1, channel: 'whatsapp',
    });
    ConversationsService.getMessages.mockResolvedValue({
      messages: [{ message_id: 1, text: 'hi', direction: 'in', created_on: '2026-07-29T10:00:00Z' }],
    });

    const { result, rerender } = renderHook((props) => useRCMMessaging(props), { initialProps: baseProps });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    ConversationsService.getSessionState.mockResolvedValue({ conversation_id: null, requires_template: true, is_live: 0, channel: 'whatsapp' });
    rerender({ ...baseProps, leadId: 'lead-b', leadPhone: '922222' });

    await waitFor(() => expect(result.current.messages).toHaveLength(0));
  });

  it('sendMessage pushes an optimistic local bubble immediately', async () => {
    const { result } = renderHook(() => useRCMMessaging(baseProps));
    await waitFor(() => expect(result.current.sessionLoading).toBe(false));

    await act(async () => {
      await result.current.sendMessage('Hello there');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ dir: 'outbound', text: 'Hello there' });
    expect(String(result.current.messages[0].id)).toMatch(/^local-/);
    expect(ConversationsService.send).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: 'lead-a', phone: '9198765 43210', text: 'Hello there',
    }));
  });

  it('a matching server message on the next poll replaces the optimistic entry, not a duplicate', async () => {
    vi.useFakeTimers();
    ConversationsService.getSessionState.mockResolvedValue({
      conversation_id: 42, requires_template: false, is_live: 1, channel: 'whatsapp',
    });
    ConversationsService.getMessages.mockResolvedValueOnce({ messages: [] });

    const { result } = renderHook(() => useRCMMessaging(baseProps));
    await vi.waitFor(() => expect(ConversationsService.getMessages).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.sendMessage('Hello there');
    });
    expect(result.current.messages).toHaveLength(1);

    ConversationsService.getMessages.mockResolvedValueOnce({
      messages: [{ message_id: 501, text: 'Hello there', direction: 'out', created_on: new Date().toISOString() }],
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000); // one history-poll tick
    });

    expect(result.current.messages).toHaveLength(1); // still one bubble, not two
    expect(result.current.messages[0].id).toBe('srv-501');
  });

  it('does not poll history when the panel is closed', async () => {
    vi.useFakeTimers();
    ConversationsService.getSessionState.mockResolvedValue({ conversation_id: 42, requires_template: false, is_live: 1, channel: 'whatsapp' });
    renderHook(() => useRCMMessaging({ ...baseProps, panelOpen: false }));
    await vi.waitFor(() => expect(ConversationsService.getMessages).toHaveBeenCalledTimes(1));

    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(ConversationsService.getMessages).toHaveBeenCalledTimes(1); // no further polling
  });

  it('a poll that surfaces a new inbound message re-fetches session-state', async () => {
    vi.useFakeTimers();
    ConversationsService.getSessionState.mockResolvedValue({
      conversation_id: 42, requires_template: true, is_live: 1, channel: 'whatsapp',
    });
    ConversationsService.getMessages.mockResolvedValueOnce({
      messages: [{ message_id: 1, text: 'hi', direction: 'out', created_on: '2026-07-29T10:00:00Z' }],
    });

    renderHook(() => useRCMMessaging(baseProps));
    await vi.waitFor(() => expect(ConversationsService.getMessages).toHaveBeenCalledTimes(1));
    const callsBeforePoll = ConversationsService.getSessionState.mock.calls.length;

    ConversationsService.getMessages.mockResolvedValueOnce({
      messages: [
        { message_id: 1, text: 'hi', direction: 'out', created_on: '2026-07-29T10:00:00Z' },
        { message_id: 2, text: 'reply from lead', direction: 'in', created_on: '2026-07-29T10:05:00Z' },
      ],
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000); // one history-poll tick
    });

    expect(ConversationsService.getSessionState.mock.calls.length).toBeGreaterThan(callsBeforePoll);
  });

  it('a poll with no new inbound message does not re-fetch session-state', async () => {
    vi.useFakeTimers();
    ConversationsService.getSessionState.mockResolvedValue({
      conversation_id: 42, requires_template: false, is_live: 1, channel: 'whatsapp',
    });
    ConversationsService.getMessages.mockResolvedValueOnce({
      messages: [{ message_id: 1, text: 'hi', direction: 'out', created_on: '2026-07-29T10:00:00Z' }],
    });

    renderHook(() => useRCMMessaging(baseProps));
    await vi.waitFor(() => expect(ConversationsService.getMessages).toHaveBeenCalledTimes(1));
    const callsBeforePoll = ConversationsService.getSessionState.mock.calls.length;

    // same messages again — nothing new
    ConversationsService.getMessages.mockResolvedValueOnce({
      messages: [{ message_id: 1, text: 'hi', direction: 'out', created_on: '2026-07-29T10:00:00Z' }],
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(ConversationsService.getSessionState.mock.calls.length).toBe(callsBeforePoll);
  });

  it('computes unread badge count from the list endpoint, summed across conversations', async () => {
    ConversationsService.list.mockResolvedValue({
      conversations: [{ unread_message_count: 2 }, { unread_message_count: 3 }],
    });
    const { result } = renderHook(() => useRCMMessaging(baseProps));
    await waitFor(() => expect(result.current.unreadCount).toBe(5));
  });
});
