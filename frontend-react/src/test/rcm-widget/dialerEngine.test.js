import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Flag must be set BEFORE the module is imported — _REACT_WIDGET_ENABLED is
// computed once at module top-level (gates the TTL timer, beforeunload
// listener, and window.RCMDialer assignment; see dialerEngine.js's
// own comment on why this guard exists — both this bundle and the vanilla
// rcm_dialer.js load simultaneously during the flagged rollout).
localStorage.setItem('rcmWidgetReact', 'true');

// Fake timers must be enabled BEFORE the module is imported: the TTL
// setInterval is registered once at module-load time. Enabling fake timers
// later, inside an individual test, does not retroactively convert an
// already-scheduled real interval into a fake one — it would just keep
// ticking on the real 5-minute cadence, disconnected from
// vi.advanceTimersByTimeAsync(). Kept fake for the whole file; nothing here
// depends on real wall-clock delays (every CallsService call is mocked to
// resolve immediately). Date must be explicitly included — it's not faked
// by default, and the TTL check compares Date.now() against _stateSetAt.
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });

vi.mock('../../services/api', () => ({
  CallsService: {
    disconnect: vi.fn().mockResolvedValue({}),
    action: vi.fn().mockResolvedValue({}),
    getStatus: vi.fn(),
    forceEnd: vi.fn(),
    getMyActive: vi.fn().mockResolvedValue({ active: false }),
  },
}));
vi.mock('../../services/auth', () => ({
  getToken: () => 'test-token',
}));

const { RCMDialer, getSnapshot, subscribe } = await import('../../features/rcm-widget/engine/dialerEngine.js');
const { CallsService } = await import('../../services/api');

describe('dialerEngine', () => {
  beforeEach(() => {
    // Force back to a clean IDLE state before every test — this is a true
    // module-level singleton, not reset between tests automatically.
    RCMDialer.destroy();
    vi.clearAllMocks();
  });

  it('starts IDLE and isActive() is false', () => {
    expect(RCMDialer.isActive()).toBe(false);
    expect(RCMDialer.getInternalState()).toBe('IDLE');
  });

  it('window.RCMDialer is assigned when the react-widget flag is on', () => {
    expect(window.RCMDialer).toBe(RCMDialer);
  });

  it('activate() transitions IDLE -> ACTIVE (bridge mode) and isActive() becomes true', async () => {
    await RCMDialer.activate(
      { call_id: 'call-1', room_name: 'room-1' }, 'Jane Doe', '+15551234567', 'bridge',
    );
    expect(RCMDialer.isActive()).toBe(true);
    expect(RCMDialer.getInternalState()).toBe('ACTIVE');
    expect(RCMDialer.getState().callId).toBe('call-1');
    expect(RCMDialer.getState().leadName).toBe('Jane Doe');
  });

  it('activate() force-resets from a stale non-IDLE state instead of throwing', async () => {
    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    expect(RCMDialer.isActive()).toBe(true);
    // Calling activate() again while already ACTIVE must not throw — it
    // warns and force-resets rather than getting stuck.
    await expect(
      RCMDialer.activate({ call_id: 'call-2' }, 'John', '+1666', 'bridge'),
    ).resolves.not.toThrow();
    expect(RCMDialer.getState().callId).toBe('call-2');
  });

  it('hangup() is idempotent — calling it twice never double-fires the disconnect API', async () => {
    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await RCMDialer.hangup();
    await RCMDialer.hangup(); // already IDLE — must no-op, not re-call disconnect
    expect(CallsService.disconnect).toHaveBeenCalledTimes(1);
    expect(RCMDialer.isActive()).toBe(false);
  });

  it('hangup() resets state back to IDLE', async () => {
    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await RCMDialer.hangup();
    expect(RCMDialer.getInternalState()).toBe('IDLE');
    expect(RCMDialer.getState().callId).toBe(null);
  });

  it('setInitiating() only applies from IDLE — does not clobber an active call', async () => {
    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    RCMDialer.setInitiating();
    // Still ACTIVE — setInitiating() must only fire from IDLE.
    expect(RCMDialer.getInternalState()).toBe('ACTIVE');
  });

  it('setInitiating() from IDLE transitions to INITIATING', () => {
    RCMDialer.setInitiating();
    expect(RCMDialer.getInternalState()).toBe('INITIATING');
  });

  it('mute()/hold() are no-ops outside ACTIVE state', async () => {
    await RCMDialer.mute();
    await RCMDialer.hold();
    expect(CallsService.action).not.toHaveBeenCalled();
  });

  it('mute() toggles muted and calls the action API in bridge mode', async () => {
    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await RCMDialer.mute();
    expect(RCMDialer.getState().muted).toBe(true);
    expect(CallsService.action).toHaveBeenCalledWith('call-1', 'mute', null);
    await RCMDialer.mute();
    expect(RCMDialer.getState().muted).toBe(false);
    expect(CallsService.action).toHaveBeenCalledWith('call-1', 'unmute', null);
  });

  it('hold() toggles held and calls the action API', async () => {
    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await RCMDialer.hold();
    expect(RCMDialer.getState().held).toBe(true);
    expect(CallsService.action).toHaveBeenCalledWith('call-1', 'hold', null);
  });

  it('recoverFromActiveCall() restores ACTIVE state and marks recovered', () => {
    const listener = vi.fn();
    window.addEventListener('rcm:call-started', listener);
    RCMDialer.recoverFromActiveCall({
      call_id: 'call-9', lead_id: 'lead-1', lead_name: 'Recovered Lead',
      phone: '+1777', call_mode: 'bridge', answered_at: new Date().toISOString(),
    });
    expect(RCMDialer.isActive()).toBe(true);
    expect(RCMDialer.getState().leadName).toBe('Recovered Lead');
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].detail.recovered).toBe(true);
    window.removeEventListener('rcm:call-started', listener);
  });

  it('recoverFromActiveCall() is a no-op when not IDLE', async () => {
    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    RCMDialer.recoverFromActiveCall({ call_id: 'call-9', lead_name: 'Someone Else' });
    // Still the original call — recovery must not clobber a real active call.
    expect(RCMDialer.getState().callId).toBe('call-1');
  });

  it('fires rcm:call-started and rcm:call-ended with the documented payload shape', async () => {
    const started = vi.fn();
    const ended = vi.fn();
    window.addEventListener('rcm:call-started', started);
    window.addEventListener('rcm:call-ended', ended);

    await RCMDialer.activate({ call_id: 'call-1', lead_id: 'lead-1' }, 'Jane', '+1555', 'bridge');
    expect(started).toHaveBeenCalledTimes(1);
    const startedDetail = started.mock.calls[0][0].detail;
    expect(startedDetail).toMatchObject({ callId: 'call-1', leadId: 'lead-1', leadName: 'Jane', phone: '+1555', callMode: 'bridge', provider: 'rcm', connected: false });

    await RCMDialer.hangup();
    expect(ended).toHaveBeenCalledTimes(1);
    const endedDetail = ended.mock.calls[0][0].detail;
    expect(endedDetail).toMatchObject({ callId: 'call-1', leadId: 'lead-1', leadName: 'Jane', phone: '+1555', reason: 'user_hangup' });

    window.removeEventListener('rcm:call-started', started);
    window.removeEventListener('rcm:call-ended', ended);
  });

  it('notifies subscribers on every state change (useSyncExternalStore contract)', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const before = getSnapshot();

    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');

    expect(listener).toHaveBeenCalled();
    const after = getSnapshot();
    expect(after).not.toBe(before); // new reference — React needs this to re-render
    expect(after.state).toBe('ACTIVE');
    unsubscribe();
  });

  it('TTL safety net auto-hangs-up a call stuck ACTIVE for more than 4 hours', async () => {
    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    expect(RCMDialer.isActive()).toBe(true);

    // Advance past the 4h TTL plus one 5-minute check tick.
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 + 5 * 60 * 1000 + 1000);

    expect(RCMDialer.isActive()).toBe(false);
    expect(CallsService.disconnect).toHaveBeenCalledWith('call-1');
  });

  it('bridge poll hangs up on a 404 (stale call_id) instead of retrying forever', async () => {
    const notFoundError = Object.assign(new Error('Call not found'), { response: { status: 404 } });
    CallsService.getStatus.mockRejectedValue(notFoundError);

    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await vi.advanceTimersByTimeAsync(2000); // one bridge-poll tick

    expect(RCMDialer.isActive()).toBe(false);
  });

  it('bridge poll detects CALL_ANSWERED and fires rcm:call-answered', async () => {
    CallsService.getStatus.mockResolvedValue({ status: 'CALL_ANSWERED' });
    const answered = vi.fn();
    window.addEventListener('rcm:call-answered', answered);

    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await vi.advanceTimersByTimeAsync(2000);

    expect(answered).toHaveBeenCalledTimes(1);
    expect(RCMDialer.getState().connected).toBe(true);
    window.removeEventListener('rcm:call-answered', answered);
  });

  it('bridge poll detects a terminal status and hangs up', async () => {
    CallsService.getStatus.mockResolvedValue({ status: 'CALL_ENDED' });

    await RCMDialer.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await vi.advanceTimersByTimeAsync(2000);

    expect(RCMDialer.isActive()).toBe(false);
  });
});
