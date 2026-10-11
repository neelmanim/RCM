import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Flag must be set BEFORE the module is imported — _REACT_WIDGET_ENABLED is
// computed once at module top-level (gates the TTL timer, beforeunload
// listener, and window.AlternateMessengerDialer assignment; see dialerEngine.js's
// own comment on why this guard exists — both this bundle and the vanilla
// messenger_dialer.js load simultaneously during the flagged rollout).
localStorage.setItem('messengerWidgetReact', 'true');

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

const { AlternateMessenger, getSnapshot, subscribe } = await import('../../features/messenger-widget/engine/dialerEngine.js');
const { CallsService } = await import('../../services/api');

describe('dialerEngine', () => {
  beforeEach(() => {
    // Force back to a clean IDLE state before every test — this is a true
    // module-level singleton, not reset between tests automatically.
    AlternateMessenger.destroy();
    vi.clearAllMocks();
  });

  it('starts IDLE and isActive() is false', () => {
    expect(AlternateMessenger.isActive()).toBe(false);
    expect(AlternateMessenger.getInternalState()).toBe('IDLE');
  });

  it('window.AlternateMessengerDialer is assigned when the react-widget flag is on', () => {
    expect(window.AlternateMessengerDialer).toBe(AlternateMessenger);
  });

  it('activate() transitions IDLE -> ACTIVE (bridge mode) and isActive() becomes true', async () => {
    await AlternateMessenger.activate(
      { call_id: 'call-1', room_name: 'room-1' }, 'Jane Doe', '+15551234567', 'bridge',
    );
    expect(AlternateMessenger.isActive()).toBe(true);
    expect(AlternateMessenger.getInternalState()).toBe('ACTIVE');
    expect(AlternateMessenger.getState().callId).toBe('call-1');
    expect(AlternateMessenger.getState().leadName).toBe('Jane Doe');
  });

  it('activate() force-resets from a stale non-IDLE state instead of throwing', async () => {
    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    expect(AlternateMessenger.isActive()).toBe(true);
    // Calling activate() again while already ACTIVE must not throw — it
    // warns and force-resets rather than getting stuck.
    await expect(
      AlternateMessenger.activate({ call_id: 'call-2' }, 'John', '+1666', 'bridge'),
    ).resolves.not.toThrow();
    expect(AlternateMessenger.getState().callId).toBe('call-2');
  });

  it('hangup() is idempotent — calling it twice never double-fires the disconnect API', async () => {
    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await AlternateMessenger.hangup();
    await AlternateMessenger.hangup(); // already IDLE — must no-op, not re-call disconnect
    expect(CallsService.disconnect).toHaveBeenCalledTimes(1);
    expect(AlternateMessenger.isActive()).toBe(false);
  });

  it('hangup() resets state back to IDLE', async () => {
    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await AlternateMessenger.hangup();
    expect(AlternateMessenger.getInternalState()).toBe('IDLE');
    expect(AlternateMessenger.getState().callId).toBe(null);
  });

  it('setInitiating() only applies from IDLE — does not clobber an active call', async () => {
    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    AlternateMessenger.setInitiating();
    // Still ACTIVE — setInitiating() must only fire from IDLE.
    expect(AlternateMessenger.getInternalState()).toBe('ACTIVE');
  });

  it('setInitiating() from IDLE transitions to INITIATING', () => {
    AlternateMessenger.setInitiating();
    expect(AlternateMessenger.getInternalState()).toBe('INITIATING');
  });

  it('mute()/hold() are no-ops outside ACTIVE state', async () => {
    await AlternateMessenger.mute();
    await AlternateMessenger.hold();
    expect(CallsService.action).not.toHaveBeenCalled();
  });

  it('mute() toggles muted and calls the action API in bridge mode', async () => {
    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await AlternateMessenger.mute();
    expect(AlternateMessenger.getState().muted).toBe(true);
    expect(CallsService.action).toHaveBeenCalledWith('call-1', 'mute', null);
    await AlternateMessenger.mute();
    expect(AlternateMessenger.getState().muted).toBe(false);
    expect(CallsService.action).toHaveBeenCalledWith('call-1', 'unmute', null);
  });

  it('hold() toggles held and calls the action API', async () => {
    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await AlternateMessenger.hold();
    expect(AlternateMessenger.getState().held).toBe(true);
    expect(CallsService.action).toHaveBeenCalledWith('call-1', 'hold', null);
  });

  it('recoverFromActiveCall() restores ACTIVE state and marks recovered', () => {
    const listener = vi.fn();
    window.addEventListener('alternate:call-started', listener);
    AlternateMessenger.recoverFromActiveCall({
      call_id: 'call-9', lead_id: 'lead-1', lead_name: 'Recovered Lead',
      phone: '+1777', call_mode: 'bridge', answered_at: new Date().toISOString(),
    });
    expect(AlternateMessenger.isActive()).toBe(true);
    expect(AlternateMessenger.getState().leadName).toBe('Recovered Lead');
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].detail.recovered).toBe(true);
    window.removeEventListener('alternate:call-started', listener);
  });

  it('recoverFromActiveCall() is a no-op when not IDLE', async () => {
    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    AlternateMessenger.recoverFromActiveCall({ call_id: 'call-9', lead_name: 'Someone Else' });
    // Still the original call — recovery must not clobber a real active call.
    expect(AlternateMessenger.getState().callId).toBe('call-1');
  });

  it('fires alternate:call-started and alternate:call-ended with the documented payload shape', async () => {
    const started = vi.fn();
    const ended = vi.fn();
    window.addEventListener('alternate:call-started', started);
    window.addEventListener('alternate:call-ended', ended);

    await AlternateMessenger.activate({ call_id: 'call-1', lead_id: 'lead-1' }, 'Jane', '+1555', 'bridge');
    expect(started).toHaveBeenCalledTimes(1);
    const startedDetail = started.mock.calls[0][0].detail;
    expect(startedDetail).toMatchObject({ callId: 'call-1', leadId: 'lead-1', leadName: 'Jane', phone: '+1555', callMode: 'bridge', provider: 'messenger', connected: false });

    await AlternateMessenger.hangup();
    expect(ended).toHaveBeenCalledTimes(1);
    const endedDetail = ended.mock.calls[0][0].detail;
    expect(endedDetail).toMatchObject({ callId: 'call-1', leadId: 'lead-1', leadName: 'Jane', phone: '+1555', reason: 'user_hangup' });

    window.removeEventListener('alternate:call-started', started);
    window.removeEventListener('alternate:call-ended', ended);
  });

  it('notifies subscribers on every state change (useSyncExternalStore contract)', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    const before = getSnapshot();

    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');

    expect(listener).toHaveBeenCalled();
    const after = getSnapshot();
    expect(after).not.toBe(before); // new reference — React needs this to re-render
    expect(after.state).toBe('ACTIVE');
    unsubscribe();
  });

  it('TTL safety net auto-hangs-up a call stuck ACTIVE for more than 4 hours', async () => {
    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    expect(AlternateMessenger.isActive()).toBe(true);

    // Advance past the 4h TTL plus one 5-minute check tick.
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 + 5 * 60 * 1000 + 1000);

    expect(AlternateMessenger.isActive()).toBe(false);
    expect(CallsService.disconnect).toHaveBeenCalledWith('call-1');
  });

  it('bridge poll hangs up on a 404 (stale call_id) instead of retrying forever', async () => {
    const notFoundError = Object.assign(new Error('Call not found'), { response: { status: 404 } });
    CallsService.getStatus.mockRejectedValue(notFoundError);

    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await vi.advanceTimersByTimeAsync(2000); // one bridge-poll tick

    expect(AlternateMessenger.isActive()).toBe(false);
  });

  it('bridge poll detects CALL_ANSWERED and fires alternate:call-answered', async () => {
    CallsService.getStatus.mockResolvedValue({ status: 'CALL_ANSWERED' });
    const answered = vi.fn();
    window.addEventListener('alternate:call-answered', answered);

    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await vi.advanceTimersByTimeAsync(2000);

    expect(answered).toHaveBeenCalledTimes(1);
    expect(AlternateMessenger.getState().connected).toBe(true);
    window.removeEventListener('alternate:call-answered', answered);
  });

  it('bridge poll detects a terminal status and hangs up', async () => {
    CallsService.getStatus.mockResolvedValue({ status: 'CALL_ENDED' });

    await AlternateMessenger.activate({ call_id: 'call-1' }, 'Jane', '+1555', 'bridge');
    await vi.advanceTimersByTimeAsync(2000);

    expect(AlternateMessenger.isActive()).toBe(false);
  });

  describe('browser mode (LiveKit)', () => {
    let fakeRoom;

    beforeEach(() => {
      class FakeRoom {
        constructor() { this._handlers = {}; }
        on(event, cb) { (this._handlers[event] ||= []).push(cb); return this; }
        emit(event, ...args) { (this._handlers[event] || []).forEach((cb) => cb(...args)); }
        connect = vi.fn().mockResolvedValue();
        localParticipant = { setMicrophoneEnabled: vi.fn().mockResolvedValue(), isMicrophoneEnabled: false };
      }
      window.LivekitClient = {
        // `new`'d by _connectLiveKit — must be a real function, not an arrow
        // function, or the mock throws "is not a constructor".
        Room: vi.fn().mockImplementation(function () { fakeRoom = new FakeRoom(); return fakeRoom; }),
        RoomEvent: {
          ParticipantConnected: 'participantConnected',
          ParticipantDisconnected: 'participantDisconnected',
          Disconnected: 'disconnected',
          Reconnecting: 'reconnecting',
          Reconnected: 'reconnected',
          TrackSubscribed: 'trackSubscribed',
          TrackUnsubscribed: 'trackUnsubscribed',
        },
      };
    });

    afterEach(() => {
      delete window.LivekitClient;
    });

    // RCA 2026-08-25 (live, prod): only ParticipantConnected was handled —
    // nothing detected the lead hanging up first, so the engine stayed stuck
    // ACTIVE until the next call's ghost-detection auto-heal noticed. This
    // guards the fix directly, without going through the auto-heal path.
    it('ends the call when the lead (remote participant) disconnects first', async () => {
      await AlternateMessenger.activate(
        { call_id: 'call-1', livekit_url: 'wss://x', livekit_token: 'tok' }, 'Jane', '+1555', 'browser',
      );
      await Promise.resolve(); // flush the fire-and-forget _connectLiveKit connect()
      await Promise.resolve();
      expect(AlternateMessenger.isActive()).toBe(true);

      fakeRoom.emit('participantDisconnected');
      await Promise.resolve();

      expect(AlternateMessenger.isActive()).toBe(false);
      expect(CallsService.disconnect).toHaveBeenCalledWith('call-1');
    });

    it('does nothing if already inactive when a stray disconnect event arrives', async () => {
      await AlternateMessenger.activate(
        { call_id: 'call-1', livekit_url: 'wss://x', livekit_token: 'tok' }, 'Jane', '+1555', 'browser',
      );
      await Promise.resolve();
      await Promise.resolve();
      await AlternateMessenger.hangup();
      CallsService.disconnect.mockClear();

      fakeRoom.emit('participantDisconnected');
      await Promise.resolve();

      expect(CallsService.disconnect).not.toHaveBeenCalled();
    });
  });
});
