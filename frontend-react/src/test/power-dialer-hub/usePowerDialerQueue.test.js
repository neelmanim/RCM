import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePowerDialerQueue } from '../../features/power-dialer-hub/usePowerDialerQueue';
import { LeadsService, DialerService } from '../../services/api';

vi.mock('../../services/api', () => ({
  LeadsService: {
    getLeads: vi.fn(),
  },
  DialerService: {
    getQueueStatus: vi.fn(),
    setQueueStatus: vi.fn(),
    clearQueueStatus: vi.fn(),
  },
}));

function lead(id, overrides = {}) {
  return { id, first_name: 'Lead', last_name: id, status: 'Lead Assigned', phone: '+91900000000' + id, ...overrides };
}

function fireResolved(leadId, detail = {}) {
  window.dispatchEvent(new CustomEvent('rcm:call-outcome-resolved', { detail: { leadId, ...detail } }));
}

describe('usePowerDialerQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    DialerService.getQueueStatus.mockResolvedValue({});
    DialerService.setQueueStatus.mockResolvedValue({});
    DialerService.clearQueueStatus.mockResolvedValue({});
  });

  it('fetches the queue on mount filtered to the callable statuses', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2')] });
    const { result } = renderHook(() => usePowerDialerQueue());

    await waitFor(() => expect(result.current.queue).toHaveLength(2));
    expect(LeadsService.getLeads).toHaveBeenCalledWith(expect.objectContaining({
      status: ['Lead Assigned', 'Research', 'Calling'],
    }));
    expect(result.current.currentLead.id).toBe('1');
  });

  it('auto-skips a do_not_contact lead without ever waiting on Call Next', async () => {
    LeadsService.getLeads.mockResolvedValue({
      data: [lead('dnc', { do_not_contact: true }), lead('ok')],
    });
    const { result } = renderHook(() => usePowerDialerQueue());

    await waitFor(() => expect(result.current.currentLead?.id).toBe('ok'));
    expect(result.current.sessionStatus.get('dnc')).toBe('skipped-dnc');
    expect(result.current.callNextEnabled).toBe(false);
  });

  it('auto-skips an unsubscribed lead the same way', async () => {
    LeadsService.getLeads.mockResolvedValue({
      data: [lead('unsub', { unsubscribed_at: '2026-08-01T00:00:00Z' }), lead('ok')],
    });
    const { result } = renderHook(() => usePowerDialerQueue());

    await waitFor(() => expect(result.current.currentLead?.id).toBe('ok'));
    expect(result.current.sessionStatus.get('unsub')).toBe('skipped-dnc');
  });

  it('enables Call Next only when the resolved event matches the current lead', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.currentLead?.id).toBe('1'));

    act(() => fireResolved('2', { outcome: 'No Answer' })); // a different lead — must not affect state
    expect(result.current.callNextEnabled).toBe(false);

    act(() => fireResolved('1', { outcome: 'Interested' }));
    expect(result.current.callNextEnabled).toBe(true);
    expect(result.current.sessionStatus.get('1')).toBe('called');
  });

  it('callNext advances the queue and resets callNextEnabled', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.currentLead?.id).toBe('1'));

    act(() => fireResolved('1'));
    expect(result.current.callNextEnabled).toBe(true);

    act(() => result.current.callNext());
    expect(result.current.callNextEnabled).toBe(false);
    expect(result.current.currentLead.id).toBe('2');
  });

  it('skip is available independent of call state and marks skipped-manual', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.currentLead?.id).toBe('1'));

    act(() => result.current.skip()); // no call ever attempted — must still work
    expect(result.current.sessionStatus.get('1')).toBe('skipped-manual');
    expect(result.current.currentLead.id).toBe('2');
  });

  it('reports isDone once every lead has been resolved', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.currentLead?.id).toBe('1'));

    act(() => result.current.skip());
    expect(result.current.currentLead).toBeNull();
    expect(result.current.isDone).toBe(true);
  });

  it('resumes at the first lead with no persisted status, restoring earlier skips', async () => {
    // RCA 2026-08-10: a reload used to reset every lead back to Pending —
    // this is the fix, sourced from models.DialerQueueStatus.
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2'), lead('3')] });
    DialerService.getQueueStatus.mockResolvedValue({
      '1': { status: 'skipped', skip_reason: 'Wrong number' },
    });
    const { result } = renderHook(() => usePowerDialerQueue());

    await waitFor(() => expect(result.current.currentLead?.id).toBe('2'));
    expect(result.current.sessionStatus.get('1')).toBe('skipped-manual');
    expect(result.current.skipReasons.get('1')).toBe('Wrong number');
    expect(DialerService.getQueueStatus).toHaveBeenCalledWith(['1', '2', '3']);
  });

  it('fetches with exclude_dialer_done so a "called" lead does not keep reappearing', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1')] });
    renderHook(() => usePowerDialerQueue());

    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalled());
    expect(LeadsService.getLeads).toHaveBeenCalledWith(expect.objectContaining({ exclude_dialer_done: true }));
  });

  it('persists a resolved outcome and a manual skip to the server', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.currentLead?.id).toBe('1'));

    act(() => fireResolved('1'));
    await waitFor(() => expect(DialerService.setQueueStatus).toHaveBeenCalledWith('1', 'called', undefined));

    act(() => result.current.callNext());
    act(() => result.current.skip('Bad timing'));
    await waitFor(() => expect(DialerService.setQueueStatus).toHaveBeenCalledWith('2', 'skipped', 'Bad timing'));
  });

  it('reorderUpcoming never moves the currently-active lead', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2'), lead('3')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(3));

    act(() => result.current.reorderUpcoming(0, 2)); // fromIndex 0 === currentIndex — must be a no-op
    expect(result.current.queue.map(l => l.id)).toEqual(['1', '2', '3']);

    act(() => result.current.reorderUpcoming(1, 2)); // both after currentIndex — allowed
    expect(result.current.queue.map(l => l.id)).toEqual(['1', '3', '2']);
  });

  it('callBack requeues a skipped lead as the next call and clears its persisted status', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2'), lead('3')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.currentLead?.id).toBe('1'));

    act(() => result.current.skip('Bad timing')); // '1' now skipped, current moves to '2'
    expect(result.current.currentLead.id).toBe('2');

    act(() => result.current.callBack('1'));
    expect(DialerService.clearQueueStatus).toHaveBeenCalledWith('1');
    expect(result.current.sessionStatus.has('1')).toBe(false);
    expect(result.current.skipReasons.has('1')).toBe(false);
    expect(result.current.currentLead.id).toBe('2'); // untouched — '1' becomes the next lead, not the current one
    expect(result.current.queue.map(l => l.id)).toEqual(['2', '1', '3']);
  });

  it('callBack is a no-op for a lead that is not behind the current pointer', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1'), lead('2')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.currentLead?.id).toBe('1'));

    act(() => result.current.callBack('2')); // '2' is upcoming, not resolved — nothing to call back
    expect(DialerService.clearQueueStatus).not.toHaveBeenCalled();
    expect(result.current.queue.map(l => l.id)).toEqual(['1', '2']);
  });

  it('hideCalled filters out leads with an existing last_call_outcome', async () => {
    LeadsService.getLeads.mockResolvedValue({
      data: [lead('1', { last_call_outcome: 'No Answer' }), lead('2')],
      total: 2,
    });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(2));

    act(() => result.current.setHideCalled(true));
    await waitFor(() => expect(result.current.queue.map(l => l.id)).toEqual(['2']));
  });

  it('statusFilter and search are forwarded to GET /leads, and re-fetch on change', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [lead('1')] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(result.current.queue).toHaveLength(1));

    act(() => result.current.setStatusFilter(['Calling']));
    act(() => result.current.setSearch('acme'));
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: ['Calling'], search: 'acme' })
    ));
  });

  it('falls back to every callable status if the filter is ever emptied', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => usePowerDialerQueue());
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalled());

    act(() => result.current.setStatusFilter([]));
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: ['Lead Assigned', 'Research', 'Calling'] })
    ));
  });
});
