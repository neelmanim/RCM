import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAircallEverywhere, OPT_OUT_KEY } from '../../features/aircall-everywhere/useAircallEverywhere';
import { DialerService, AdminService } from '../../services/api';

vi.mock('../../services/api', () => ({
  DialerService: {
    getStatus: vi.fn(),
    recordEverywhereLogin: vi.fn().mockResolvedValue({ ok: true }),
  },
  AdminService: {
    reportError: vi.fn().mockResolvedValue({ status: 'ok' }),
  },
}));

// Captures the config passed to the constructor, and the .on() listeners
// registered, so tests can manually fire onLogin/onLogout/call events
// without a real Aircall session.
let lastConfig = null;
let lastListeners = null;
const workspaceCtor = vi.fn().mockImplementation((config) => {
  lastConfig = config;
  lastListeners = {};
  return {
    on: (event, cb) => { lastListeners[event] = cb; },
  };
});
// Faithfully mirrors the REAL package's actual (buggy) CJS shape — confirmed via
// `require('aircall-everywhere')` — which double-wraps its default export as
// { __esModule: true, default: <class> } instead of exporting the class
// directly. A mock that just handed back a working constructor as `default`
// would never have caught the real "is not a constructor" bug this hook hit in
// an actual browser — this shape is what makes that regression class visible.
// The inner function must be a real `function`, not an arrow function — arrow
// functions have no [[Construct]] and throw "is not a constructor" under `new`.
vi.mock('aircall-everywhere', () => ({
  default: {
    __esModule: true,
    default: function (...args) { return workspaceCtor(...args); },
  },
}));

const ELIGIBLE_STATUS = { active: true, provider: 'aircall', aircall_everywhere_enabled: true };

describe('useAircallEverywhere', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastConfig = null;
    lastListeners = null;
    localStorage.removeItem(OPT_OUT_KEY);
  });

  it('goes ineligible when the org kill switch is off, without constructing the SDK', async () => {
    DialerService.getStatus.mockResolvedValue({ active: true, provider: 'aircall', aircall_everywhere_enabled: false });
    const { result } = renderHook(() => useAircallEverywhere());

    await waitFor(() => expect(result.current.status).toBe('ineligible'));
    expect(workspaceCtor).not.toHaveBeenCalled();
  });

  it('goes ineligible when the active provider is not Aircall', async () => {
    DialerService.getStatus.mockResolvedValue({ active: true, provider: 'messenger', aircall_everywhere_enabled: true });
    const { result } = renderHook(() => useAircallEverywhere());

    await waitFor(() => expect(result.current.status).toBe('ineligible'));
    expect(workspaceCtor).not.toHaveBeenCalled();
  });

  it('goes opted_out (not ineligible) when eligible but this SDR turned it off', async () => {
    localStorage.setItem(OPT_OUT_KEY, 'bridge_only');
    DialerService.getStatus.mockResolvedValue(ELIGIBLE_STATUS);
    const { result } = renderHook(() => useAircallEverywhere());

    await waitFor(() => expect(result.current.status).toBe('opted_out'));
    expect(workspaceCtor).not.toHaveBeenCalled();
  });

  it('goes ineligible when the status fetch itself fails', async () => {
    DialerService.getStatus.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useAircallEverywhere());

    await waitFor(() => expect(result.current.status).toBe('ineligible'));
  });

  it('constructs the SDK when eligible, transitions to ready on onLogin', async () => {
    DialerService.getStatus.mockResolvedValue(ELIGIBLE_STATUS);
    const { result } = renderHook(() => useAircallEverywhere());

    await waitFor(() => expect(workspaceCtor).toHaveBeenCalledTimes(1));
    expect(lastConfig.domToLoadWorkspace).toBe('#aircall-everywhere-mount');

    act(() => lastConfig.onLogin());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('records the login server-side so adoption is actually visible (RCA 2026-08-18)', async () => {
    DialerService.getStatus.mockResolvedValue(ELIGIBLE_STATUS);
    renderHook(() => useAircallEverywhere());
    await waitFor(() => expect(workspaceCtor).toHaveBeenCalledTimes(1));

    expect(DialerService.recordEverywhereLogin).not.toHaveBeenCalled();
    act(() => lastConfig.onLogin());
    await waitFor(() => expect(DialerService.recordEverywhereLogin).toHaveBeenCalledTimes(1));
  });

  it('transitions back to notready on onLogout', async () => {
    DialerService.getStatus.mockResolvedValue(ELIGIBLE_STATUS);
    const { result } = renderHook(() => useAircallEverywhere());
    await waitFor(() => expect(workspaceCtor).toHaveBeenCalledTimes(1));

    act(() => lastConfig.onLogin());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => lastConfig.onLogout());
    await waitFor(() => expect(result.current.status).toBe('notready'));
  });

  it('goes to error status if the SDK constructor throws', async () => {
    workspaceCtor.mockImplementationOnce(() => { throw new Error('boom'); });
    DialerService.getStatus.mockResolvedValue(ELIGIBLE_STATUS);
    const { result } = renderHook(() => useAircallEverywhere());

    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('tracks callActive true on outgoing_call, false on call_ended', async () => {
    DialerService.getStatus.mockResolvedValue(ELIGIBLE_STATUS);
    const { result } = renderHook(() => useAircallEverywhere());
    await waitFor(() => expect(workspaceCtor).toHaveBeenCalledTimes(1));
    act(() => lastConfig.onLogin());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.callActive).toBe(false);

    act(() => lastListeners.outgoing_call());
    await waitFor(() => expect(result.current.callActive).toBe(true));

    act(() => lastListeners.call_ended());
    await waitFor(() => expect(result.current.callActive).toBe(false));
  });

  it('tracks callActive true on incoming_call too', async () => {
    DialerService.getStatus.mockResolvedValue(ELIGIBLE_STATUS);
    const { result } = renderHook(() => useAircallEverywhere());
    await waitFor(() => expect(workspaceCtor).toHaveBeenCalledTimes(1));
    act(() => lastConfig.onLogin());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => lastListeners.incoming_call());
    await waitFor(() => expect(result.current.callActive).toBe(true));
  });

  // Aircall exposes no real audio-quality signal anywhere (webhook or SDK) —
  // navigator.connection at call start/end is the only automatic proxy
  // available, flagged into the existing error-log 'dialer' category.
  describe('network-quality proxy flag on call_ended', () => {
    const realConnection = navigator.connection;
    afterEach(() => { navigator.connection = realConnection; });

    async function readyHookWithConnection(connection) {
      navigator.connection = connection;
      DialerService.getStatus.mockResolvedValue(ELIGIBLE_STATUS);
      const { result } = renderHook(() => useAircallEverywhere());
      await waitFor(() => expect(workspaceCtor).toHaveBeenCalledTimes(1));
      act(() => lastConfig.onLogin());
      await waitFor(() => expect(result.current.status).toBe('ready'));
      return result;
    }

    it('flags a degraded connection (low downlink) seen at call end', async () => {
      await readyHookWithConnection({ effectiveType: '4g', downlink: 10, rtt: 50 });
      act(() => lastListeners.outgoing_call());
      navigator.connection = { effectiveType: '3g', downlink: 0.5, rtt: 500 };
      act(() => lastListeners.call_ended());

      await waitFor(() => expect(AdminService.reportError).toHaveBeenCalledTimes(1));
      expect(AdminService.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'dialer', severity: 'warning' })
      );
    });

    it('does not flag a clean connection throughout the call', async () => {
      await readyHookWithConnection({ effectiveType: '4g', downlink: 10, rtt: 50 });
      act(() => lastListeners.outgoing_call());
      act(() => lastListeners.call_ended());

      expect(AdminService.reportError).not.toHaveBeenCalled();
    });

    it('is a silent no-op when the Network Information API is unsupported (e.g. Safari)', async () => {
      await readyHookWithConnection(undefined);
      act(() => lastListeners.outgoing_call());
      act(() => lastListeners.call_ended());

      expect(AdminService.reportError).not.toHaveBeenCalled();
    });
  });
});
