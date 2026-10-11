import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCallController } from '../../features/lead-detail-hub/call/useCallController';

const lead = { id: 'lead-1', first_name: 'Kyle', phone: '+16019470694' };

describe('useCallController', () => {
  beforeEach(() => {
    window._openCallModal = vi.fn();
  });
  afterEach(() => {
    delete window._openCallModal;
  });

  it('startCall invokes the existing global bridge (window._openCallModal) with the right args', () => {
    const { result } = renderHook(() => useCallController(lead, {}));
    result.current.startCall();
    expect(window._openCallModal).toHaveBeenCalledWith('lead-1', 'Kyle', '+16019470694', lead);
  });

  it('startCall uses an explicit phone override when provided', () => {
    const { result } = renderHook(() => useCallController(lead, {}));
    result.current.startCall('+19998887777');
    expect(window._openCallModal).toHaveBeenCalledWith('lead-1', 'Kyle', '+19998887777', lead);
  });

  it('shows a toast instead of throwing when the dialer bridge is not available', () => {
    delete window._openCallModal;
    const toastSpy = vi.fn();
    window.addEventListener('alternate:toast', toastSpy);
    const { result } = renderHook(() => useCallController(lead, {}));
    result.current.startCall();
    expect(toastSpy).toHaveBeenCalled();
    window.removeEventListener('alternate:toast', toastSpy);
  });

  it('calls onOutcomeResolved when the outcome-resolved event matches this lead', () => {
    const onOutcomeResolved = vi.fn();
    renderHook(() => useCallController(lead, { onOutcomeResolved }));
    window.dispatchEvent(new CustomEvent('alternate:call-outcome-resolved', { detail: { leadId: 'lead-1', outcome: 'Interested' } }));
    expect(onOutcomeResolved).toHaveBeenCalledWith({ leadId: 'lead-1', outcome: 'Interested' });
  });

  it('ignores the outcome-resolved event when it is for a different lead', () => {
    const onOutcomeResolved = vi.fn();
    renderHook(() => useCallController(lead, { onOutcomeResolved }));
    window.dispatchEvent(new CustomEvent('alternate:call-outcome-resolved', { detail: { leadId: 'some-other-lead' } }));
    expect(onOutcomeResolved).not.toHaveBeenCalled();
  });
});
