import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMessengerMessaging } from '../../features/messenger-widget/hooks/useMessengerMessaging';
import { ConversationsService } from '../../services/api';

// Own file (not a describe block in useMessengerMessaging.test.js) so the
// module-level "is Alternate Messenger configured" cache — fetched once per page
// load, not per lead/hook mount — starts fresh here instead of being
// poisoned by whatever the other suite's hooks already resolved it to.
vi.mock('../../services/api', () => ({
  ConversationsService: {
    getStatus: vi.fn().mockResolvedValue({ configured: false }),
    getSessionState: vi.fn(),
    getTemplates: vi.fn(),
    getMessages: vi.fn(),
    send: vi.fn(),
    list: vi.fn(),
  },
}));

describe('useMessengerMessaging — Alternate Messenger not configured for this org', () => {
  it('skips session-state/history/badge polling entirely and reports messagingConfigured:false', async () => {
    const { result } = renderHook(() => useMessengerMessaging({
      leadId: 'lead-a', leadPhone: '9198765 43210', leadName: 'Jane', senderId: 'sender-1',
      panelOpen: true, tabActive: true,
    }));

    await waitFor(() => expect(result.current.messagingConfigured).toBe(false));
    expect(ConversationsService.getSessionState).not.toHaveBeenCalled();
    expect(ConversationsService.list).not.toHaveBeenCalled();
  });
});
