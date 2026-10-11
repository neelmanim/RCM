import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Phone, PenLine, UserCog, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Switch } from '../../components/ui/Switch';
import { SkeletonCard, SkeletonText } from '../../components/ui/Skeleton';
import { EmailService, DialerService } from '../../services/api';
import { SignatureEditor } from './SignatureEditor';
import { ClaudeConnectorCard } from './ClaudeConnectorCard';
import { MySettingsTour } from './MySettingsTour';
import { toast } from './toast';

/**
 * "My Settings" — every user's own account preferences, as a React island.
 *
 * This is the port of legacy frontend/js/views/sdr_settings.js, the surface
 * SDRs/AEs/Pod Admins actually use. It is intentionally NOT folded into
 * Control Center: that page is org-wide configuration, this is personal
 * preferences, and the two have different audiences (see the
 * settings-architecture skill, which calls this the one split that's correct).
 *
 * Parity with the page it replaces: Email Sync (connect/disconnect), Dialer
 * (own caller-ID, read-only + the admin-granted on/off switch), Email
 * Branding, and Email Signature. The legacy "Notifications" card is not
 * carried over — it was a permanently-disabled placeholder ("coming soon")
 * with no backing endpoint, so porting it would only reproduce dead UI.
 */
function StatusPill({ ok, okLabel, offLabel }) {
  return (
    <Badge variant={ok ? 'success' : 'default'} className="inline-flex items-center gap-1">
      {ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {ok ? okLabel : offLabel}
    </Badge>
  );
}

export function MySettingsHub() {
  const [email, setEmail] = useState(null);      // null = loading
  const [dialer, setDialer] = useState(null);
  const [phone, setPhone] = useState('');
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    // allSettled: one dead endpoint (e.g. Nylas unconfigured) must not blank
    // the whole page — the legacy version swallowed each failure individually
    // for the same reason.
    const [emailRes, dialerRes, sigRes, phoneRes] = await Promise.allSettled([
      EmailService.getStatus(),
      DialerService.getStatus(),
      EmailService.getSignature(),
      DialerService.getMyPhone(),
    ]);
    setEmail(emailRes.status === 'fulfilled' ? emailRes.value : { connected: false, nylas_configured: false });
    setDialer(dialerRes.status === 'fulfilled' ? dialerRes.value : { active: false, provider: 'none' });
    setSignature(sigRes.status === 'fulfilled' ? (sigRes.value?.signature_html || '') : '');
    setPhone(phoneRes.status === 'fulfilled' ? (phoneRes.value?.phone_number || '') : '');
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleConnectEmail = async () => {
    setBusy(true);
    try {
      // `auth_url` is what GET /api/email/auth-url actually returns. This
      // read `url`, so it was always undefined — and `location.href =
      // undefined` navigates the browser to the relative path "undefined",
      // which is how prod ended up on /undefined#dashboard instead of
      // Google's consent screen. Reported live; see RELEASES.md v12.2.3.
      const { auth_url: authUrl } = await EmailService.getAuthUrl();
      if (!authUrl) {
        toast('Email connection is not set up yet — contact your Super Admin.', 'error');
        setBusy(false);
        return;
      }
      // Full redirect, not a popup: Nylas returns to /api/email/callback which
      // bounces back to the app with ?email_connected=true.
      window.location.href = authUrl;
    } catch (err) {
      toast(err.response?.data?.detail || 'Could not start email connection.', 'error');
      setBusy(false);
    }
  };

  const handleDisconnectEmail = async () => {
    setBusy(true);
    try {
      await EmailService.disconnect();
      toast('Email disconnected.', 'success');
      await loadAll();
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to disconnect email.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDialer = async (next) => {
    // Turning your own dialer back ON is an admin grant, not a preference —
    // PATCH /api/dialer/toggle refuses it. Say so instead of firing a 403.
    if (next) {
      toast('Only an admin can enable dialer access — ask your admin to turn it on.', 'warning');
      return;
    }
    setBusy(true);
    try {
      await DialerService.toggleMyDialer(false);
      toast('Dialer disabled.', 'success');
      await loadAll();
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to update dialer.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBranding = async (next) => {
    setBusy(true);
    try {
      await EmailService.toggleBranding(next);
      setEmail((prev) => ({ ...prev, hide_branding_in_email: next }));
      toast(next ? 'Branding hidden in your emails.' : 'Branding shown in your emails.', 'success');
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to update branding.', 'error');
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const loading = email === null || dialer === null || signature === null;

  return (
    <div className="my-settings-hub min-h-full bg-slate-50 px-6 py-6 max-w-3xl mx-auto">
      <MySettingsTour />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 m-0 flex items-center gap-2">
          <UserCog size={20} className="text-slate-400" /> My Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your own account preferences — these apply only to you.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i}><SkeletonText lines={3} /></SkeletonCard>)}
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Email Sync ─────────────────────────────────────────── */}
          <Card data-tour="my-settings-email">
            <CardHeader
              title={<span className="flex items-center gap-2"><Mail size={15} className="text-indigo-500" /> Email Sync</span>}
              subtitle="Send and receive lead email from your own mailbox"
              actions={
                <StatusPill
                  ok={!!email.connected}
                  okLabel="Connected"
                  offLabel={email.needs_reconnect ? 'Reconnect needed' : 'Not connected'}
                />
              }
            />
            <CardContent>
              {!email.nylas_configured ? (
                <p className="text-sm text-slate-500 m-0">
                  Email integration isn't configured for your organisation yet — contact your Super Admin.
                </p>
              ) : email.connected ? (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  {/* `email` — GET /api/email/status has no `email_address`,
                      so that key always fell back to "your mailbox". */}
                  <p className="text-sm text-slate-600 m-0">
                    Connected as <span className="font-semibold text-slate-800">{email.email || 'your mailbox'}</span>
                  </p>
                  <Button variant="outline" size="sm" onClick={handleDisconnectEmail} disabled={busy}>
                    Disconnect
                  </Button>
                </div>
              ) : email.needs_reconnect ? (
                /* Linked but the grant can't send (usually a 403: no send
                   scope). Previously indistinguishable from never-connected. */
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm text-slate-600 m-0">
                    <span className="font-semibold text-slate-800">{email.email || 'Your mailbox'}</span>{' '}
                    is linked but can't send right now — reconnect it to authorise sending again.
                  </p>
                  <Button size="sm" onClick={handleConnectEmail} disabled={busy}>
                    Reconnect email
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm text-slate-600 m-0">
                    Connect your mailbox to send email and log replies against leads automatically.
                  </p>
                  <Button size="sm" onClick={handleConnectEmail} disabled={busy}>
                    Connect email
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Dialer ─────────────────────────────────────────────── */}
          <Card data-tour="my-settings-dialer">
            <CardHeader
              title={<span className="flex items-center gap-2"><Phone size={15} className="text-orange-500" /> Dialer</span>}
              subtitle="Make calls directly from Alternate CRM"
              actions={<StatusPill ok={!!dialer.active} okLabel="Enabled" offLabel="Disabled" />}
            />
            <CardContent className="space-y-3">
              <Switch
                checked={!!dialer.active}
                onChange={(e) => handleToggleDialer(e.target.checked)}
                label="Dialer access"
                hint={dialer.active
                  ? 'You can turn this off yourself. Only an admin can turn it back on.'
                  : 'Ask your admin to enable calling for your account.'}
              />
              {dialer.active && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Caller ID</div>
                  <div className="text-sm font-semibold text-slate-800 tabular-nums">
                    {phone || 'Not assigned'}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">Assigned by your admin · read-only</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Email Sign-off — signature + branding were two cards for
              one decision: what gets appended to your outgoing mail. Both
              data-tour hooks kept so the tour's targets still resolve. */}
          <Card data-tour="my-settings-signature">
            <CardHeader
              title={<span className="flex items-center gap-2"><PenLine size={15} className="text-indigo-500" /> Email Sign-off</span>}
              subtitle="What gets added to the foot of every email you send — campaigns and cadences included"
            />
            <CardContent>
              <SignatureEditor initialHtml={signature} />
              <div className="mt-5 pt-4 border-t border-slate-200" data-tour="my-settings-branding">
                <Switch
                  checked={!!email.hide_branding_in_email}
                  onChange={(e) => handleToggleBranding(e.target.checked)}
                  label="Hide the “Powered by Alternate Messenger” line"
                  hint="The small branding line that sits below your signature."
                />
              </div>
            </CardContent>
          </Card>

          <ClaudeConnectorCard />
        </div>
      )}
    </div>
  );
}
