import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MySettingsHub } from '../../features/my-settings/MySettingsHub';
import { EmailService, DialerService } from '../../services/api';

vi.mock('../../services/api', () => ({
  EmailService: {
    getStatus: vi.fn(),
    getSignature: vi.fn(),
    getAuthUrl: vi.fn(),
    disconnect: vi.fn(),
    toggleBranding: vi.fn(),
    saveSignature: vi.fn(),
    uploadSignatureLogo: vi.fn(),
  },
  DialerService: {
    getStatus: vi.fn(),
    getMyPhone: vi.fn(),
    toggleMyDialer: vi.fn(),
  },
  ClaudeConnectorService: {
    listKeys: vi.fn().mockResolvedValue({ keys: [], connector_url: 'https://api.test/mcp', write_enabled: false }),
  },
}));

// The RichTextEditor (Tiptap) isn't worth booting in jsdom for these tests —
// the signature editor has its own concerns; here we care about the four cards.
vi.mock('../../features/my-settings/SignatureEditor', () => ({
  SignatureEditor: () => <div data-testid="signature-editor" />,
}));

function mockLoaded({ email = {}, dialer = {}, phone = '+91 90000 00000' } = {}) {
  EmailService.getStatus.mockResolvedValue({ connected: true, nylas_configured: true, email: 'me@test.com', hide_branding_in_email: false, ...email });
  DialerService.getStatus.mockResolvedValue({ active: true, provider: 'aircall', ...dialer });
  EmailService.getSignature.mockResolvedValue({ signature_html: '<p>Cheers</p>' });
  DialerService.getMyPhone.mockResolvedValue({ phone_number: phone });
}

describe('MySettingsHub', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders all three cards once loaded', async () => {
    mockLoaded();
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByText('Email Sync')).toBeInTheDocument());
    expect(screen.getByText('Dialer')).toBeInTheDocument();
    // Signature + branding are one card now — they are the same decision
    // (what gets appended to the foot of your outgoing mail).
    expect(screen.getByText('Email Sign-off')).toBeInTheDocument();
    expect(screen.queryByText('Email Branding')).not.toBeInTheDocument();
  });

  it('shows the connected mailbox and offers Disconnect', async () => {
    mockLoaded();
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByText('me@test.com')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('offers Connect when no mailbox is linked', async () => {
    mockLoaded({ email: { connected: false, email: null } });
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect email' })).toBeInTheDocument());
  });

  it('sends the browser to the auth_url the backend actually returns', async () => {
    // Reported on prod: clicking Connect email showed "undefined" and dumped
    // the user on /undefined#dashboard. This read `url` from a response whose
    // only key is `auth_url`, and `location.href = undefined` navigates to
    // the relative path "undefined". The three other connect-email call sites
    // (lead_emails_tab.js, sdr_settings.js, EmailHub.jsx) always read
    // auth_url — this was the odd one out. See RELEASES.md v12.2.3.
    mockLoaded({ email: { connected: false, email: null } });
    EmailService.getAuthUrl.mockResolvedValue({ auth_url: 'https://api.nylas.com/v3/connect/auth?x=1' });
    const assigned = [];
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { set href(v) { assigned.push(v); }, get href() { return assigned.at(-1); } },
    });

    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect email' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Connect email' }));

    await waitFor(() => expect(assigned).toEqual(['https://api.nylas.com/v3/connect/auth?x=1']));
  });

  it('stays put and says why when the backend returns no auth_url', async () => {
    mockLoaded({ email: { connected: false, email: null } });
    EmailService.getAuthUrl.mockResolvedValue({});
    const assigned = [];
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { set href(v) { assigned.push(v); } },
    });

    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect email' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Connect email' }));

    // Navigating to a falsy href is what produced /undefined — never do it.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect email' })).not.toBeDisabled());
    expect(assigned).toEqual([]);
  });

  it('distinguishes a linked-but-unusable mailbox from one never connected', async () => {
    // Reported live: a campaign send failed with "Mailbox is connected but
    // not authorized to send" (Nylas 403) while this card still showed a
    // green "Connected" badge. The backend now marks the mailbox
    // status="error" on 401/403, which surfaces here as needs_reconnect —
    // and "Not connected / Connect email" would be the wrong words for a
    // mailbox that is linked and just needs re-authorising.
    mockLoaded({ email: { connected: false, needs_reconnect: true, email: 'me@test.com' } });
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reconnect email' })).toBeInTheDocument());
    expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
    expect(screen.getByText(/can't send right now/i)).toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
  });

  it('explains itself instead of offering Connect when Nylas is not configured org-wide', async () => {
    mockLoaded({ email: { connected: false, nylas_configured: false } });
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByText(/isn't configured for your organisation/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Connect email' })).not.toBeInTheDocument();
  });

  it('shows the admin-assigned caller ID read-only while the dialer is on', async () => {
    mockLoaded({ phone: '+91 91234 56789' });
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByText('+91 91234 56789')).toBeInTheDocument());
    expect(screen.getByText(/assigned by your admin/i)).toBeInTheDocument();
  });

  it('refuses to re-enable the dialer itself — that is an admin grant, not a preference', async () => {
    mockLoaded({ dialer: { active: false } });
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByText('Dialer access')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: /dialer access/i }));
    // No request fired: the API refuses this with a 403, so the UI says so first.
    expect(DialerService.toggleMyDialer).not.toHaveBeenCalled();
  });

  it('lets the user switch their own dialer off', async () => {
    mockLoaded({ dialer: { active: true } });
    DialerService.toggleMyDialer.mockResolvedValue({ dialer_enabled: false });
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByText('Dialer access')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: /dialer access/i }));
    await waitFor(() => expect(DialerService.toggleMyDialer).toHaveBeenCalledWith(false));
  });

  it('toggles email branding', async () => {
    mockLoaded();
    EmailService.toggleBranding.mockResolvedValue({ hide_branding_in_email: true });
    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByText(/Powered by Alternate Messenger/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: /Powered by Alternate Messenger/i }));
    await waitFor(() => expect(EmailService.toggleBranding).toHaveBeenCalledWith(true));
  });

  it('still renders when an endpoint fails, rather than blanking the page', async () => {
    EmailService.getStatus.mockRejectedValue(new Error('boom'));
    DialerService.getStatus.mockRejectedValue(new Error('boom'));
    EmailService.getSignature.mockRejectedValue(new Error('boom'));
    DialerService.getMyPhone.mockRejectedValue(new Error('boom'));

    render(<MySettingsHub />);
    await waitFor(() => expect(screen.getByText('Email Sync')).toBeInTheDocument());
    expect(screen.getByText('Dialer')).toBeInTheDocument();
  });
});
