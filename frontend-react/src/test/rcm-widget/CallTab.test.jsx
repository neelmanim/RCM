import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallTab } from '../../features/rcm-widget/components/CallTab';
import { widgetUiStore } from '../../features/rcm-widget/engine/widgetUiStore';
import { DialerService, CallsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  DialerService: { startCall: vi.fn() },
  CallsService: { getMyActive: vi.fn(), forceEnd: vi.fn() },
}));
vi.mock('../../features/rcm-widget/engine/dialerEngine', () => ({
  RCMDialer: { mute: vi.fn(), hold: vi.fn(), hangup: vi.fn(), setInitiating: vi.fn(), activate: vi.fn(), destroy: vi.fn() },
}));
vi.mock('../../features/rcm-widget/engine/widgetUiStore', () => ({
  widgetUiStore: { resolvePendingMode: vi.fn(), resolvePendingManualDial: vi.fn() },
}));

function baseUi(overrides = {}) {
  return { leadId: null, leadPhone: null, leadName: '', pendingCallCtx: null, manualDialActive: false, ...overrides };
}

describe('CallTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the generic idle state with no lead and no pending context', () => {
    render(<CallTab dialerSnapshot={{ state: 'IDLE', ctx: {} }} ui={baseUi()} />);
    expect(screen.getByText('Ready to call')).toBeInTheDocument();
  });

  it('renders idle-with-lead and a Dial button when a lead is set', () => {
    render(<CallTab dialerSnapshot={{ state: 'IDLE', ctx: {} }} ui={baseUi({ leadId: 'lead-a', leadPhone: '919876543210', leadName: 'Jane' })} />);
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText(/Dial Jane/)).toBeInTheDocument();
  });

  it('renders the mode selector when a call is pending mode selection', () => {
    render(
      <CallTab
        dialerSnapshot={{ state: 'IDLE', ctx: {} }}
        ui={baseUi({ pendingCallCtx: { leadId: 'lead-a', leadName: 'Jane', phone: '919876543210' } })}
      />,
    );
    expect(screen.getByText('Phone Bridge')).toBeInTheDocument();
    expect(screen.getByText('Browser Call')).toBeInTheDocument();
  });

  it('clicking Phone Bridge resolves the pending mode as "bridge"', async () => {
    render(
      <CallTab
        dialerSnapshot={{ state: 'IDLE', ctx: {} }}
        ui={baseUi({ pendingCallCtx: { leadId: 'lead-a', leadName: 'Jane', phone: '919876543210' } })}
      />,
    );
    await userEvent.click(screen.getByText('Phone Bridge'));
    expect(widgetUiStore.resolvePendingMode).toHaveBeenCalledWith('bridge');
  });

  it('renders the manual-dial form in ad-hoc mode', () => {
    render(<CallTab dialerSnapshot={{ state: 'IDLE', ctx: {} }} ui={baseUi({ manualDialActive: true })} />);
    expect(screen.getByText('Dial a number')).toBeInTheDocument();
  });

  it('renders the active call UI with mute/hold/hangup controls when connected', () => {
    render(
      <CallTab
        dialerSnapshot={{ state: 'ACTIVE', ctx: { leadName: 'Jane', phone: '919876543210', connected: true, startTime: Date.now(), muted: false, held: false } }}
        ui={baseUi()}
      />,
    );
    expect(screen.getByLabelText('Mute')).toBeInTheDocument();
    expect(screen.getByLabelText('Hold')).toBeInTheDocument();
    expect(screen.getByLabelText('End call')).toBeInTheDocument();
  });

  it('shows "Ringing…" when active but not yet connected', () => {
    render(
      <CallTab
        dialerSnapshot={{ state: 'ACTIVE', ctx: { leadName: 'Jane', phone: '919876543210', connected: false, startTime: null, muted: false, held: false } }}
        ui={baseUi()}
      />,
    );
    expect(screen.getByText('Ringing…')).toBeInTheDocument();
  });

  describe('manual-dial ghost-call auto-heal (ported from app.js RCA 2026-07-22)', () => {
    it('shows Force Clear when the backend still reports an active call', async () => {
      DialerService.startCall.mockRejectedValue(new Error('You already have an active call in progress'));
      CallsService.getMyActive.mockResolvedValue({ active: true, call_id: 'zombie-1' });

      render(<CallTab dialerSnapshot={{ state: 'IDLE', ctx: {} }} ui={baseUi({ manualDialActive: true })} />);
      await userEvent.type(screen.getByPlaceholderText('+1 555 123 4567'), '5551234567');
      await userEvent.click(screen.getByText('📞 Phone Bridge'));

      expect(await screen.findByText('Force Clear')).toBeInTheDocument();
      expect(screen.queryByText(/Could not start call|active call/i)).not.toBeInTheDocument();
    });

    it('shows a plain retry toast instead of Force Clear when the backend already healed it', async () => {
      DialerService.startCall.mockRejectedValue(new Error('You already have an active call in progress'));
      CallsService.getMyActive.mockResolvedValue({ active: false });

      render(<CallTab dialerSnapshot={{ state: 'IDLE', ctx: {} }} ui={baseUi({ manualDialActive: true })} />);
      await userEvent.type(screen.getByPlaceholderText('+1 555 123 4567'), '5551234567');
      await userEvent.click(screen.getByText('📞 Phone Bridge'));

      await vi.waitFor(() => expect(CallsService.getMyActive).toHaveBeenCalled());
      expect(screen.queryByText('Force Clear')).not.toBeInTheDocument();
    });

    it('clicking Force Clear calls forceEnd + destroy and clears the banner', async () => {
      DialerService.startCall.mockRejectedValue(new Error('active call already in progress'));
      CallsService.getMyActive.mockResolvedValue({ active: true, call_id: 'zombie-1' });
      CallsService.forceEnd.mockResolvedValue({});

      render(<CallTab dialerSnapshot={{ state: 'IDLE', ctx: {} }} ui={baseUi({ manualDialActive: true })} />);
      await userEvent.type(screen.getByPlaceholderText('+1 555 123 4567'), '5551234567');
      await userEvent.click(screen.getByText('📞 Phone Bridge'));
      await screen.findByText('Force Clear');

      await userEvent.click(screen.getByText('Force Clear'));

      expect(CallsService.forceEnd).toHaveBeenCalledWith('zombie-1');
      await vi.waitFor(() => expect(screen.queryByText('Force Clear')).not.toBeInTheDocument());
    });

    it('shows the generic error banner for a non-zombie failure', async () => {
      DialerService.startCall.mockRejectedValue(new Error('Network error'));

      render(<CallTab dialerSnapshot={{ state: 'IDLE', ctx: {} }} ui={baseUi({ manualDialActive: true })} />);
      await userEvent.type(screen.getByPlaceholderText('+1 555 123 4567'), '5551234567');
      await userEvent.click(screen.getByText('📞 Phone Bridge'));

      expect(await screen.findByText('Network error')).toBeInTheDocument();
      expect(CallsService.getMyActive).not.toHaveBeenCalled();
    });
  });
});
