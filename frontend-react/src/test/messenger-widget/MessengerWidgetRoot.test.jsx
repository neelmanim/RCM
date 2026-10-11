import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessengerWidgetRoot } from '../../features/messenger-widget/components/MessengerWidgetRoot';
import { widgetUiStore } from '../../features/messenger-widget/engine/widgetUiStore';

// Reported live on staging: minimizing the widget mid mode-selection (before
// picking Bridge/Browser/Cancel) left app.js's handleCallAction blocked on
// window._callInFlight forever. Reopening via the FAB re-called
// window._openCallModal (= handleCallAction again), which saw the lock still
// held and just showed a toast — the panel never actually reopened, and only
// a hard refresh (resetting the module-level JS state) recovered.

vi.mock('../../features/messenger-widget/components/CallTab', () => ({ CallTab: () => <div>call-tab</div> }));
vi.mock('../../features/messenger-widget/components/MessageTab', () => ({ MessageTab: () => <div>message-tab</div> }));
vi.mock('../../components/ui/Toast', () => ({ ToastHost: () => null }));
vi.mock('../../features/messenger-widget/hooks/useMessengerMessaging', () => ({
  useMessengerMessaging: () => ({ unreadCount: 0 }),
}));

let uiSnapshot;
vi.mock('../../features/messenger-widget/engine/widgetUiStore', () => ({
  subscribe: vi.fn(() => () => {}),
  getSnapshot: () => uiSnapshot,
  widgetUiStore: { open: vi.fn(), close: vi.fn(), openForManualDial: vi.fn() },
}));

const DIALER_SNAPSHOT = { state: 'IDLE', ctx: {} }; // stable reference — useSyncExternalStore requires it
vi.mock('../../features/messenger-widget/engine/dialerEngine', () => ({
  subscribe: vi.fn(() => () => {}),
  getSnapshot: () => DIALER_SNAPSHOT,
  AlternateMessenger: { isActive: () => false },
}));

function baseUi(overrides = {}) {
  return {
    initialized: true,
    open: false, activeTab: 'call', leadId: null, leadPhone: null, leadName: '', senderId: '',
    hasPendingMode: false, hasPendingManualDial: false, externalBadgeCount: null,
    ...overrides,
  };
}

describe('MessengerWidgetRoot FAB click', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window._openCallModal = vi.fn();
  });

  it('reopens directly (without re-entering handleCallAction) when a mode-selection is already pending', async () => {
    uiSnapshot = baseUi({ leadId: 'lead-a', hasPendingMode: true });
    render(<MessengerWidgetRoot />);
    await userEvent.click(screen.getByLabelText('Open Alternate Messenger'));
    expect(widgetUiStore.open).toHaveBeenCalled();
    expect(window._openCallModal).not.toHaveBeenCalled();
  });

  it('reopens directly when a manual-dial is already pending', async () => {
    uiSnapshot = baseUi({ hasPendingManualDial: true });
    render(<MessengerWidgetRoot />);
    await userEvent.click(screen.getByLabelText('Open Alternate Messenger'));
    expect(widgetUiStore.open).toHaveBeenCalled();
    expect(window._openCallModal).not.toHaveBeenCalled();
  });

  it('v13.7.0: with a lead open, it opens the panel and never dials by itself', async () => {
    // It used to start a call to the last lead the rep messaged — on Aircall
    // that placed a real call when the rep only wanted to see the messages.
    uiSnapshot = baseUi({ leadId: 'lead-a', leadName: 'Jane', leadPhone: '919876543210' });
    render(<MessengerWidgetRoot />);
    await userEvent.click(screen.getByLabelText('Open Alternate Messenger'));
    expect(widgetUiStore.open).toHaveBeenCalled();
    expect(window._openCallModal).not.toHaveBeenCalled();
  });

  it('with no lead open, it opens the manual dialer as before', async () => {
    uiSnapshot = baseUi();
    render(<MessengerWidgetRoot />);
    await userEvent.click(screen.getByLabelText('Open Alternate Messenger'));
    expect(widgetUiStore.openForManualDial).toHaveBeenCalled();
    expect(window._openCallModal).not.toHaveBeenCalled();
  });
});

describe('MessengerWidgetRoot tabs for a rep on another dialer (v13.7.0)', () => {
  afterEach(() => { delete window._dialerConfig; });

  it('an Aircall rep with messaging gets Message and Call tabs once a lead is open', () => {
    window._dialerConfig = { active: true, has_credentials: true, provider: 'aircall' };
    uiSnapshot = baseUi({ open: true, leadId: 'lead-a', activeTab: 'message', capabilities: { call: false, sms: true, whatsapp: false } });
    render(<MessengerWidgetRoot />);
    expect(screen.getByRole('tab', { name: /Message/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Call/ })).toBeInTheDocument();
  });

  it('a rep with no dialer gets messaging only, no Call tab', () => {
    uiSnapshot = baseUi({ open: true, leadId: 'lead-a', activeTab: 'message', capabilities: { call: false, sms: true, whatsapp: false } });
    render(<MessengerWidgetRoot />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('message-tab')).toBeInTheDocument();
  });
});

describe('MessengerWidgetRoot mount gating', () => {
  // RCA 2026-08-21 (live, prod): the tree used to only get created inside
  // window.MessengerWidget.init() — any hiccup on that async path left a
  // real, connected call with zero DOM to render into (no timer/hangup/mute,
  // no toast on failure). Now the tree always mounts; only its visibility
  // is gated on `initialized`, which can't fail the way a React mount can.
  it('renders nothing before init() has run', () => {
    uiSnapshot = baseUi({ initialized: false });
    const { container } = render(<MessengerWidgetRoot />);
    expect(container.querySelector('#messenger-widget-root')).toBeNull();
    expect(screen.queryByLabelText('Open Alternate Messenger')).toBeNull();
  });
});

describe('MessengerWidgetRoot collapsed hit-box', () => {
  // Live bug on staging (2026-08-13): the outer wrapper's flow-space
  // (transform/opacity-collapsed panel + FAB) still measured ~340x560px and
  // had default pointer-events:auto even while collapsed, so its invisible
  // area silently ate clicks meant for whatever was underneath it on the
  // page (e.g. Sales Cadence merge-field chips rendered in that screen
  // region). The wrapper must not intercept pointer events while collapsed;
  // only the FAB itself should stay clickable.
  it('is not in the way of clicks when collapsed (no pending state)', () => {
    uiSnapshot = baseUi();
    const { container } = render(<MessengerWidgetRoot />);
    const root = container.querySelector('#messenger-widget-root');
    expect(root.className).toMatch(/pointer-events-none/);
    expect(screen.getByLabelText('Open Alternate Messenger').className).toMatch(/pointer-events-auto/);
  });

  it('re-enables the wrapper once open', () => {
    uiSnapshot = baseUi({ open: true });
    const { container } = render(<MessengerWidgetRoot />);
    const root = container.querySelector('#messenger-widget-root');
    expect(root.className).not.toMatch(/pointer-events-none/);
  });
});
