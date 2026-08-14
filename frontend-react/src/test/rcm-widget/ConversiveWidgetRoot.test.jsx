import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RCMWidgetRoot } from '../../features/rcm-widget/components/RCMWidgetRoot';
import { widgetUiStore } from '../../features/rcm-widget/engine/widgetUiStore';

// Reported live on staging: minimizing the widget mid mode-selection (before
// picking Bridge/Browser/Cancel) left app.js's handleCallAction blocked on
// window._callInFlight forever. Reopening via the FAB re-called
// window._openCallModal (= handleCallAction again), which saw the lock still
// held and just showed a toast — the panel never actually reopened, and only
// a hard refresh (resetting the module-level JS state) recovered.

vi.mock('../../features/rcm-widget/components/CallTab', () => ({ CallTab: () => <div>call-tab</div> }));
vi.mock('../../features/rcm-widget/components/MessageTab', () => ({ MessageTab: () => <div>message-tab</div> }));
vi.mock('../../components/ui/Toast', () => ({ ToastHost: () => null }));
vi.mock('../../features/rcm-widget/hooks/useRCMMessaging', () => ({
  useRCMMessaging: () => ({ unreadCount: 0 }),
}));

let uiSnapshot;
vi.mock('../../features/rcm-widget/engine/widgetUiStore', () => ({
  subscribe: vi.fn(() => () => {}),
  getSnapshot: () => uiSnapshot,
  widgetUiStore: { open: vi.fn(), close: vi.fn(), openForManualDial: vi.fn() },
}));

const DIALER_SNAPSHOT = { state: 'IDLE', ctx: {} }; // stable reference — useSyncExternalStore requires it
vi.mock('../../features/rcm-widget/engine/dialerEngine', () => ({
  subscribe: vi.fn(() => () => {}),
  getSnapshot: () => DIALER_SNAPSHOT,
  RCMDialer: { isActive: () => false },
}));

function baseUi(overrides = {}) {
  return {
    open: false, activeTab: 'call', leadId: null, leadPhone: null, leadName: '', senderId: '',
    hasPendingMode: false, hasPendingManualDial: false, externalBadgeCount: null,
    ...overrides,
  };
}

describe('RCMWidgetRoot FAB click', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window._openCallModal = vi.fn();
  });

  it('reopens directly (without re-entering handleCallAction) when a mode-selection is already pending', async () => {
    uiSnapshot = baseUi({ leadId: 'lead-a', hasPendingMode: true });
    render(<RCMWidgetRoot />);
    await userEvent.click(screen.getByLabelText('Open RCM'));
    expect(widgetUiStore.open).toHaveBeenCalled();
    expect(window._openCallModal).not.toHaveBeenCalled();
  });

  it('reopens directly when a manual-dial is already pending', async () => {
    uiSnapshot = baseUi({ hasPendingManualDial: true });
    render(<RCMWidgetRoot />);
    await userEvent.click(screen.getByLabelText('Open RCM'));
    expect(widgetUiStore.open).toHaveBeenCalled();
    expect(window._openCallModal).not.toHaveBeenCalled();
  });

  it('falls through to _openCallModal for a fresh call when nothing is pending', async () => {
    uiSnapshot = baseUi({ leadId: 'lead-a', leadName: 'Jane', leadPhone: '919876543210' });
    render(<RCMWidgetRoot />);
    await userEvent.click(screen.getByLabelText('Open RCM'));
    expect(window._openCallModal).toHaveBeenCalledWith('lead-a', 'Jane', '919876543210', {});
    expect(widgetUiStore.open).not.toHaveBeenCalled();
  });
});

describe('RCMWidgetRoot collapsed hit-box', () => {
  // Live bug on staging (2026-08-13): the outer wrapper's flow-space
  // (transform/opacity-collapsed panel + FAB) still measured ~340x560px and
  // had default pointer-events:auto even while collapsed, so its invisible
  // area silently ate clicks meant for whatever was underneath it on the
  // page (e.g. Sales Cadence merge-field chips rendered in that screen
  // region). The wrapper must not intercept pointer events while collapsed;
  // only the FAB itself should stay clickable.
  it('is not in the way of clicks when collapsed (no pending state)', () => {
    uiSnapshot = baseUi();
    const { container } = render(<RCMWidgetRoot />);
    const root = container.querySelector('#rcm-widget-root');
    expect(root.className).toMatch(/pointer-events-none/);
    expect(screen.getByLabelText('Open RCM').className).toMatch(/pointer-events-auto/);
  });

  it('re-enables the wrapper once open', () => {
    uiSnapshot = baseUi({ open: true });
    const { container } = render(<RCMWidgetRoot />);
    const root = container.querySelector('#rcm-widget-root');
    expect(root.className).not.toMatch(/pointer-events-none/);
  });
});
