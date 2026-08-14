import { describe, it, expect, vi } from 'vitest';

// This exercises the module-load-time recovery bootstrap added to
// dialerEngine.js (fixes a real gap: app.js's own boot-time recovery check
// calls the statically-imported vanilla rcm_dialer.js directly, which
// can never reach this engine — without its own bootstrap, an SDR refreshing
// mid-call while the React widget is active would see no active call at
// all). Needs its own fresh module import (vi.resetModules), separate from
// dialerEngine.test.js, since the bootstrap only runs once at import time.

localStorage.setItem('rcmWidgetReact', 'true');

vi.mock('../../services/api', () => ({
  CallsService: {
    disconnect: vi.fn().mockResolvedValue({}),
    action: vi.fn().mockResolvedValue({}),
    getStatus: vi.fn(),
    forceEnd: vi.fn(),
    getMyActive: vi.fn().mockResolvedValue({
      active: true,
      call_id: 'recovered-call-1',
      lead_id: 'lead-9',
      lead_name: 'Recovered Lead',
      phone: '+19999999999',
      call_mode: 'bridge',
      started_at: new Date().toISOString(),
      answered_at: new Date().toISOString(),
    }),
  },
}));
vi.mock('../../services/auth', () => ({ getToken: () => 'test-token' }));

describe('dialerEngine — recovery bootstrap', () => {
  it('recovers an already-active call from the backend at module load time', async () => {
    const { RCMDialer } = await import('../../features/rcm-widget/engine/dialerEngine.js');
    // The bootstrap's .then() resolves on a microtask — flush it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(RCMDialer.isActive()).toBe(true);
    expect(RCMDialer.getState()).toMatchObject({
      callId: 'recovered-call-1', leadName: 'Recovered Lead', phone: '+19999999999', connected: true,
    });
  });
});
