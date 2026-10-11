import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePodsData } from '../../features/pods-hub/usePodsData';
import { PodsService, AdminService } from '../../services/api';

vi.mock('../../services/api', () => ({
  PodsService: {
    getAll: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    addAdmin: vi.fn(),
    removeAdmin: vi.fn(),
  },
  AdminService: { getUsers: vi.fn() },
}));

const pods = [{ id: 'p1', name: 'Alpha', members: [] }];

describe('usePodsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PodsService.getAll.mockResolvedValue(pods);
    AdminService.getUsers.mockResolvedValue([]);
    PodsService.addMember.mockResolvedValue({});
    PodsService.removeMember.mockResolvedValue({});
  });

  // Bug report (2026-09-22): moving an SDR to a different pod via Pod
  // Management gave no visible confirmation.
  it('toasts on addMember/removeMember success', async () => {
    const toastHandler = vi.fn();
    window.addEventListener('alternate:toast', toastHandler);
    const { result } = renderHook(() => usePodsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.addMember('p1', 'u1'); });
    expect(toastHandler).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ message: 'Added to POD.' }),
    }));

    await act(async () => { await result.current.removeMember('p1', 'u1'); });
    expect(toastHandler).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ message: 'Removed from POD.' }),
    }));
    window.removeEventListener('alternate:toast', toastHandler);
  });

  // Bug report (2026-09-22): a pod reassignment made in Control Center's
  // Team & Access tab didn't show up here until a hard refresh, because this
  // hub is a persisted React island (hub-entry.jsx) whose data-fetch effect
  // only runs once per mount.
  it('reloads pod data when a pod-membership-changed event fires from elsewhere', async () => {
    const { result } = renderHook(() => usePodsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(PodsService.getAll).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('alternate:pod-membership-changed'));
    });
    await waitFor(() => expect(PodsService.getAll).toHaveBeenCalledTimes(2));
  });

  it('addMember/removeMember also dispatch pod-membership-changed for cross-hub listeners', async () => {
    const eventHandler = vi.fn();
    window.addEventListener('alternate:pod-membership-changed', eventHandler);
    const { result } = renderHook(() => usePodsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.addMember('p1', 'u1'); });
    expect(eventHandler).toHaveBeenCalled();
    window.removeEventListener('alternate:pod-membership-changed', eventHandler);
  });

  // Bug report (2026-10-07): adding an SDR who is still in another pod gave a 400 and NOTHING on screen — the
  // server's "Remove them from that pod first" message only reached the browser console as an unhandled rejection.
  it('shows the server\'s reason as an error toast when a pod action is refused, and does not throw', async () => {
    const detail = "Gopu Tanisha Reddy is already a member of 'US Team New'. Remove them from that pod first.";
    PodsService.addMember.mockRejectedValue({ response: { data: { detail } } });
    const toastHandler = vi.fn();
    window.addEventListener('alternate:toast', toastHandler);
    const { result } = renderHook(() => usePodsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let outcome;
    await act(async () => { outcome = await result.current.addMember('p1', 'u1'); });
    expect(outcome).toBe(false);
    expect(toastHandler).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ message: detail, type: 'error' }),
    }));
    window.removeEventListener('alternate:toast', toastHandler);
  });

  it('falls back to a plain message when the server sends none, for every kind of pod action', async () => {
    PodsService.remove.mockRejectedValue(new Error('network'));
    const toastHandler = vi.fn();
    window.addEventListener('alternate:toast', toastHandler);
    const { result } = renderHook(() => usePodsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { expect(await result.current.deletePod('p1')).toBe(false); });
    expect(toastHandler).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ type: 'error', message: expect.stringMatching(/try again/i) }),
    }));
    window.removeEventListener('alternate:toast', toastHandler);
  });

  it('a successful action still resolves true and toasts success', async () => {
    const { result } = renderHook(() => usePodsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { expect(await result.current.removeMember('p1', 'u1')).toBe(true); });
  });
});
