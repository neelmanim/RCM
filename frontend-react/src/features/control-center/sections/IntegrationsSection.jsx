import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Plus } from 'lucide-react';
import { Card, CardHeader, CardContent, CardFooter } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Switch } from '../../../components/ui/Switch';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Select } from '../../../components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { Tabs } from '../../../components/ui/Tabs';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonCard, SkeletonText } from '../../../components/ui/Skeleton';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { MailboxPicker, mailboxSummary } from '../../../components/MailboxPicker';
import { SalesforceTab } from './salesforce/SalesforceTab';
import { RulesCard } from './RulesCard';
import { Banner } from './Banner';
import { CallOutcomesCard } from './CallOutcomesCard';
import { SettingsService, DialerService, CallsService } from '../../../services/api';

// 2026-10-05 reorg: "Dialer" used to hold Aircall (calling), Alternate Messenger
// (calling + SMS/WhatsApp messaging) AND Instantly (email sending) — three
// cards under a label that only described one of them, and Nylas (also
// email sending) sat on a totally different tab (Connections) for no reason
// other than history. Split by what the integration actually *does*:
// Calling & Messaging (voice/SMS/WhatsApp) vs. Email Sending (Nylas +
// Instantly, the two ways a cadence can send an email) vs. Connections
// (inbound: Salesforce, the public API bridge) vs. CRM Settings (sync
// behavior, unchanged).
const TABS = [
  { key: 'salesforce', label: 'Salesforce' },
  { key: 'connections', label: 'Connections' },
  { key: 'email', label: 'Email Sending' },
  { key: 'calling', label: 'Calling & Messaging' },
  { key: 'rules', label: 'Pod & Call Rules' },
];

const AdminOnlyNotice = ({ text }) => (
  <Card><CardContent className="text-xs text-slate-500">{text}</CardContent></Card>
);

/**
 * Phase 1 — Integrations. Parity ported from:
 *  - frontend/js/views/settings_connection.js (SF connection card, Data Summary, Nylas)
 *  - frontend/js/views/settings.js:533-848 (channels tab: Aircall, Alternate Messenger)
 *  - frontend/js/views/settings.js:849-944 (publicapi tab)
 *  - frontend/js/views/settings_ai_dialer.js (save/test handlers those cards bind to)
 * Every write here re-fetches everything afterward (loadAll), same
 * full-re-render-on-save pattern the legacy renderSettings(container) used.
 */
export function IntegrationsSection({ userRole }) {
  const isSuperAdmin = userRole === 'Super Admin';
  const isAdmin = isSuperAdmin || userRole === 'Admin';

  const [tab, setTab] = useState('salesforce');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sfInfo, setSfInfo] = useState({ connected: false, source: null });
  const [overview, setOverview] = useState(null);
  const [nylasConf, setNylasConf] = useState(null);
  const [dialerConf, setDialerConf] = useState(null);
  const [syncSettings, setSyncSettings] = useState(null);
  const [publicApiStatus, setPublicApiStatus] = useState({ configured: false });

  const loadAll = useCallback(async (silent = false) => {
    if (!isAdmin) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setLoadError('');
    const fetchAll = () => Promise.allSettled([
      isSuperAdmin ? SettingsService.getSfOverview() : Promise.resolve(null),
      isAdmin ? SettingsService.getSfStatus() : Promise.resolve({ connected: false, source: null }),
      isSuperAdmin ? SettingsService.getNylasConfig() : Promise.resolve(null),
      isSuperAdmin ? DialerService.getConfig() : Promise.resolve(null),
      isSuperAdmin ? SettingsService.getSyncSettings() : Promise.resolve(null),
      isSuperAdmin ? SettingsService.getPublicApiKeyStatus() : Promise.resolve({ configured: false }),
    ]);
    let [overviewR, sfR, nylasR, dialerR, syncR, apiR] = await fetchAll();
    if (overviewR.status === 'rejected' && sfR.status === 'rejected') {
      // Both core calls failed together: almost always a momentary blip (busy server, brief disconnect). Try once more.
      await new Promise((r) => setTimeout(r, 1500));
      [overviewR, sfR, nylasR, dialerR, syncR, apiR] = await fetchAll();
    }
    setOverview(overviewR.status === 'fulfilled' ? overviewR.value : null);
    setSfInfo(sfR.status === 'fulfilled' ? sfR.value : { connected: false, source: null });
    setNylasConf(nylasR.status === 'fulfilled' ? nylasR.value : null);
    setDialerConf(dialerR.status === 'fulfilled' ? dialerR.value : null);
    setSyncSettings(syncR.status === 'fulfilled' ? syncR.value : null);
    setPublicApiStatus(apiR.status === 'fulfilled' ? apiR.value : { configured: false });
    if (overviewR.status === 'rejected' && sfR.status === 'rejected') {
      const e = sfR.reason || overviewR.reason;
      const why = e?.response?.status ? `the server answered ${e.response.status}${e.response.data?.detail ? ` (${e.response.data.detail})` : ''}`
        : e?.code === 'ECONNABORTED' ? 'the server took too long to answer'
        : 'the server could not be reached';
      setLoadError(`Couldn't load integrations — ${why}. Retry, and if it keeps happening tell us this message.`);
    }
    setLoading(false);
  }, [isAdmin, isSuperAdmin]);

  useEffect(() => { loadAll(); }, [loadAll]);
  // After a save: re-read the settings without blanking the page behind a skeleton.
  const refresh = useCallback(() => loadAll(true), [loadAll]);

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admin access required"
        message="Integrations are only visible to Admin and Super Admin accounts."
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-5 max-w-5xl">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {loadError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 text-xs font-semibold mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'salesforce' && (
        <SalesforceTab sfInfo={sfInfo} isSuperAdmin={isSuperAdmin} syncSettings={syncSettings} overview={overview} onChanged={refresh} />
      )}

      {tab === 'connections' && (
        <div className="space-y-5">
          {isSuperAdmin ? (
            <>
              <PublicApiCard status={publicApiStatus} onChanged={loadAll} />
              <ClaudeConnectorAdminCard syncSettings={syncSettings} onChanged={loadAll} />
            </>
          ) : <AdminOnlyNotice text="Public API key and Claude connector settings are Super Admin only." />}
        </div>
      )}

      {tab === 'email' && (
        <div className="space-y-5">
          {isSuperAdmin ? (
            <>
              <NylasCard nylasConf={nylasConf} onChanged={loadAll} />
              <InstantlyCard dialerConf={dialerConf} onChanged={loadAll} />
            </>
          ) : <AdminOnlyNotice text="Nylas and Instantly.ai settings are Super Admin only." />}
        </div>
      )}

      {tab === 'calling' && (
        <div className="space-y-5">
          {isSuperAdmin ? (
            <>
              <AircallCard dialerConf={dialerConf} syncSettings={syncSettings} onChanged={loadAll} />
              <KlentyCard dialerConf={dialerConf} onChanged={loadAll} />
            </>
          ) : <AdminOnlyNotice text="Aircall and Klenty settings are Super Admin only." />}
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-5">
          {isSuperAdmin ? (
            <>
              <RulesCard syncSettings={syncSettings} onChanged={refresh} />
              <CallOutcomesCard />
            </>
          ) : <AdminOnlyNotice text="Pod and call rules are Super Admin only." />}
        </div>
      )}
    </div>
  );
}

// ── Nylas Email Integration ─────────────────────────────────────────────────
// Ported from settings_connection.js:208-255 (form) + :336-437 (save/test).
// ponytail: legacy pre-filled the key fields with a sentinel dot-string and
// stripped it back out on save to mean "unchanged". The backend already
// preserves the existing key/secret whenever the field is omitted or blank
// (email_routes.py save_nylas_config docstring) — so this just leaves the
// fields blank with a "(saved)" placeholder and only sends what's typed.
function NylasCard({ nylasConf, onChanged }) {
  const configured = !!nylasConf?.configured;
  const [form, setForm] = useState({
    client_id: nylasConf?.client_id || '',
    api_key: '',
    redirect_uri: nylasConf?.redirect_uri || '',
    webhook_secret: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setError(''); setSuccess('');
    if (!form.client_id.trim() || (!form.api_key.trim() && !configured)) {
      setError('Client ID and API Key are required.');
      return;
    }
    setSaving(true);
    try {
      const result = await SettingsService.saveNylasConfig(form);
      setSuccess(result.message || 'Saved.');
      await onChanged();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await SettingsService.testNylasConnection();
      const reachable = result?.checks?.api_reachable;
      setTestResult({ ok: !!reachable?.ok, message: reachable?.message || result?.message || 'Could not run the test — save a configuration first.' });
    } catch {
      setTestResult({ ok: false, message: 'Connection test failed to run.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Nylas Email Integration" subtitle="Configure Nylas API credentials for email sending"
        actions={<Badge variant={configured && nylasConf?.is_active ? 'success' : 'danger'}>{configured && nylasConf?.is_active ? '● Configured' : '● Not Configured'}</Badge>} />
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Client ID" value={form.client_id} onChange={set('client_id')} placeholder="Enter Nylas Client ID" />
          <Input label="API Key" type="password" value={form.api_key} onChange={set('api_key')}
            placeholder={configured ? '•••••••• (saved — leave blank to keep)' : 'Enter Nylas API Key'}
            hint="Encrypted at rest (AES-256-GCM)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Redirect URI" value={form.redirect_uri} onChange={set('redirect_uri')}
            placeholder="https://your-domain.com/api/email/callback" hint="Copy this to your Nylas dashboard → Callback URI" />
          <Input label="Webhook Secret" type="password" value={form.webhook_secret} onChange={set('webhook_secret')}
            placeholder={nylasConf?.has_webhook_secret ? '•••••••• (saved — leave blank to keep)' : 'Enter Webhook Secret'} />
        </div>
        <Banner text={error} tone="error" />
        <Banner text={success} tone="ok" />
        {testResult && <Banner text={testResult.message} tone={testResult.ok ? 'ok' : 'error'} />}
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm" onClick={test} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</Button>
        <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Configuration'}</Button>
      </CardFooter>
    </Card>
  );
}

// ── Aircall Configuration ───────────────────────────────────────────────────
// Ported from settings.js:566-650 (fields) + settings_ai_dialer.js:392-684
// (bindAiDialerTab's dialer save/test handlers, DialerService.getConfig/
// saveConfig/testConnection → GET/PATCH /dialer/config, POST /dialer/test).
function AircallCard({ dialerConf, syncSettings, onChanged }) {
  const [form, setForm] = useState({
    provider: dialerConf?.provider || 'none',
    api_id: dialerConf?.api_id || '',
    api_token: '',
    webhook_token: '',
    webhook_url_override: dialerConf?.webhook_url_override || '',
    aircall_everywhere_enabled: !!dialerConf?.aircall_everywhere_enabled,
    aircall_sync_enabled: dialerConf?.aircall_sync_enabled !== false,
  });
  const [numberId, setNumberId] = useState(syncSettings?.aircall_messaging_number_id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const isAircall = form.provider === 'aircall';
  const hasCreds = form.provider === 'messenger' ? !!dialerConf?.has_messenger_credentials : !!dialerConf?.has_credentials;
  const statusBadge = form.provider === 'none' ? { v: 'danger', t: '● Not Configured' }
    : hasCreds ? { v: 'success', t: '● Connected' } : { v: 'warning', t: '● Credentials Missing' };

  const baseUrl = window.__CRM_API_BASE__ || window.__APP_CONFIG__?.API_BASE || window.location.origin;
  const autoWebhookUrl = `${baseUrl}/api/webhooks/dialer`;

  const save = async () => {
    setError(''); setSuccess('');
    setSaving(true);
    try {
      const payload = {
        provider: form.provider, aircall_everywhere_enabled: form.aircall_everywhere_enabled, aircall_sync_enabled: form.aircall_sync_enabled,
        webhook_url_override: form.webhook_url_override.trim(),
      };
      if (form.api_id.trim()) payload.api_id = form.api_id.trim();
      if (form.api_token.trim()) payload.api_token = form.api_token.trim();
      if (form.webhook_token.trim()) payload.webhook_token = form.webhook_token.trim();
      await DialerService.saveConfig(payload);
      // Aircall Number ID visually sits in this card but is a messaging-fallback field on sync settings.
      await SettingsService.patchSyncSettings({ aircall_messaging_number_id: numberId.trim() });
      setSuccess('Dialer configuration saved successfully.');
      await onChanged();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const result = await DialerService.testConnection('aircall');
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: e.message || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Aircall Configuration" subtitle="Configure Aircall as the outbound calling provider"
        actions={<Badge variant={statusBadge.v}>{statusBadge.t}</Badge>} />
      <CardContent className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Calling Provider</label>
          <Select ariaLabel="Calling Provider" value={form.provider} onChange={(v) => setForm((f) => ({ ...f, provider: v }))}
            options={[{ value: 'none', label: 'None (Manual call logging only)' }, { value: 'aircall', label: 'Aircall' }, { value: 'messenger', label: 'Alternate Messenger' }]} />
          <p className="text-[11px] text-slate-400 mt-1">Which vendor places outbound calls — independent from the Messaging Provider setting on the Alternate Messenger card below.</p>
        </div>

        {isAircall && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Input label="API ID" value={form.api_id} onChange={(e) => setForm((f) => ({ ...f, api_id: e.target.value }))} placeholder="Enter Aircall API ID" />
              <Input label="API Token" type="password" value={form.api_token} onChange={(e) => setForm((f) => ({ ...f, api_token: e.target.value }))}
                placeholder={dialerConf?.has_credentials ? '•••••••• (saved — leave blank to keep)' : 'Enter Aircall API Token'} hint="Encrypted at rest (AES-256-GCM)" />
            </div>
            <Input label="Webhook URL" value={form.webhook_url_override} onChange={(e) => setForm((f) => ({ ...f, webhook_url_override: e.target.value }))}
              placeholder={autoWebhookUrl}
              hint={form.webhook_url_override.trim()
                ? `Overriding the auto-detected URL (${autoWebhookUrl}). Clear this field to go back to it.`
                : 'Paste this into your Aircall webhook settings. Auto-detected from this deployment — override only if Aircall must reach a different domain (e.g. a proxy in front of this backend).'} />
            <Input label="Webhook Token" type="password" value={form.webhook_token} onChange={(e) => setForm((f) => ({ ...f, webhook_token: e.target.value }))}
              placeholder={dialerConf?.webhook_token ? '•••••••• (saved — leave blank to keep)' : 'Paste the token Aircall shows for this webhook'}
              hint="Aircall → Integrations → Webhooks. Events without it are refused once webhook checks are enforced." />
            <Switch checked={form.aircall_everywhere_enabled} onChange={(e) => setForm((f) => ({ ...f, aircall_everywhere_enabled: e.target.checked }))}
              label="Enable Aircall Everywhere (embedded browser dialer)"
              hint="Lets SDRs dial directly from the browser inside Power Dialer. Off by default." />
            <Switch checked={form.aircall_sync_enabled} onChange={(e) => setForm((f) => ({ ...f, aircall_sync_enabled: e.target.checked }))}
              label="Aircall nightly catch-up sync"
              hint={dialerConf?.aircall_last_sync_at ? `Last run: ${new Date(dialerConf.aircall_last_sync_at).toLocaleString()}` : 'Never run yet'} />
          </>
        )}

        <Input label="Aircall Number ID (optional fallback)" value={numberId} onChange={(e) => setNumberId(e.target.value)}
          placeholder="Leave blank — resolved per user" hint="Each user's send-from number is normally discovered by email. Set this only as an override." />

        <Banner text={error} tone="error" />
        <Banner text={success} tone="ok" />
        {testResult && <Banner text={testResult.message} tone={testResult.success ? 'ok' : 'error'} />}
      </CardContent>
      <CardFooter>
        {isAircall && <Button variant="outline" size="sm" onClick={test} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</Button>}
        <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Configuration'}</Button>
      </CardFooter>
    </Card>
  );
}



// ── Klenty Call-Activity Bridge ─────────────────────────────────────────────
// Was backend-only until this audit: klenty_enabled/klenty_api_key have
// existed on SyncSettings and been fully wired through GET/PATCH
// /dialer/config since the feature shipped, plus a manual catch-up route
// (POST /admin/dialer/sync-klenty) — but no card ever surfaced any of it, so
// an admin could only turn Klenty on/off via a raw API call. Modeled on
// InstantlyCard's simpler ancestor shape (enable + masked key + last-sync +
// Save), minus the webhook/sending-accounts/analytics Klenty has no
// equivalent of (it's pull-only, no webhooks — klenty_provider.py), plus one
// thing Instantly's card is still missing: a manual "Sync Now" button, since
// Klenty's sync runs synchronously and fast (single paginated feed, not a
// background job) rather than waiting for the nightly run.
function KlentyCard({ dialerConf, onChanged }) {
  const [form, setForm] = useState({
    klenty_enabled: !!dialerConf?.klenty_enabled,
    klenty_api_key: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const hasCreds = !!dialerConf?.has_klenty_credentials;
  const statusBadge = !form.klenty_enabled ? { v: 'danger', t: '● Not Configured' }
    : hasCreds ? { v: 'success', t: '● Connected' }
    : { v: 'warning', t: '● Credentials Missing' };

  const save = async () => {
    setError(''); setSuccess('');
    setSaving(true);
    try {
      const payload = { klenty_enabled: form.klenty_enabled };
      if (form.klenty_api_key.trim()) payload.klenty_api_key = form.klenty_api_key.trim();
      await DialerService.saveConfig(payload);
      setForm((f) => ({ ...f, klenty_api_key: '' }));
      setSuccess('Klenty configuration saved successfully.');
      await onChanged();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await DialerService.syncKlentyNow();
      setSyncResult({ ok: result?.ran !== false, message: result?.ran === false ? (result.reason || 'Sync did not run.') : `Synced — ${result?.imported ?? 0} call(s) imported.` });
      await onChanged();
    } catch (e) {
      setSyncResult({ ok: false, message: e.response?.data?.detail || e.message || 'Sync failed.' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Klenty Call-Activity Bridge" subtitle="Pulls call-completion events from Klenty (an Aircall-owned number some SDRs still dial through) into Alternate CRM's call log — temporary, until SDRs move fully onto Alternate CRM's own dialing"
        actions={<Badge variant={statusBadge.v}>{statusBadge.t}</Badge>} />
      <CardContent className="space-y-3">
        <Switch checked={form.klenty_enabled} onChange={(e) => setForm((f) => ({ ...f, klenty_enabled: e.target.checked }))}
          label="Enable Klenty Sync"
          hint="Matches Klenty call events to the SDR's Alternate CRM account by their Klenty username." />
        <Input label="API Key" type="password" value={form.klenty_api_key}
          onChange={(e) => setForm((f) => ({ ...f, klenty_api_key: e.target.value }))}
          placeholder={hasCreds ? '•••••••• (saved — leave blank to keep)' : 'Enter Klenty API Key'}
          hint="Klenty → Settings → Integrations → Klenty API Key. Encrypted at rest (AES-256-GCM)." />
        <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
          Last synced: {dialerConf?.klenty_last_sync_at ? new Date(dialerConf.klenty_last_sync_at).toLocaleString() : 'Never'}
        </div>
        <Banner text={error} tone="error" />
        <Banner text={success} tone="ok" />
        {syncResult && <Banner text={syncResult.message} tone={syncResult.ok ? 'ok' : 'error'} />}
      </CardContent>
      <CardFooter>
        {hasCreds && <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync Now'}</Button>}
        <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Configuration'}</Button>
      </CardFooter>
    </Card>
  );
}

// ── Instantly.ai Pull Sync ───────────────────────────────────────────────────
// New in this batch — modeled directly on AircallCard/AlternateMessenger above
// (same enable-Switch/masked-key-Input/status-Badge/last-sync/Banner shape),
// wired to the same GET/PATCH /dialer/config payload (DialerService.getConfig/
// saveConfig) that already carries Aircall/Klenty's fields — no new API call.
// Polling-only v1 (15-min scheduled job); signals are informational-only and
// never touch Lead.status (see normalizeActivity.js / columns.jsx for where
// the signal itself surfaces).
function InstantlyCard({ dialerConf, onChanged }) {
  const [form, setForm] = useState({
    instantly_enabled: !!dialerConf?.instantly_enabled,
    instantly_api_key: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

  // Which mailboxes cadences may send from. Stored list empty/NULL = all of
  // them; "Only let cadences use mailboxes I pick" makes that explicit instead
  // of "nothing ticked means everything". Only sent on save once edited.
  const [limitMailboxes, setLimitMailboxes] = useState((dialerConf?.instantly_sending_accounts || []).length > 0);
  const [sendingAccounts, setSendingAccounts] = useState(dialerConf?.instantly_sending_accounts || []);
  const [accountsDirty, setAccountsDirty] = useState(false);
  const [accounts, setAccounts] = useState(null);
  const [accountsError, setAccountsError] = useState('');

  // Real-time webhook toggle — instantly_webhook_id is surfaced by a
  // parallel phase (the webhook receiver); until that lands, GET
  // /dialer/config simply won't carry the field and this reads as
  // "not registered", which is the correct fallback either way.
  const webhookRegistered = !!dialerConf?.instantly_webhook_id;
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [webhookSuccess, setWebhookSuccess] = useState('');

  const hasCreds = !!dialerConf?.has_instantly_credentials;

  const loadAnalytics = async () => {
    setShowAnalytics(true);
    setAnalyticsLoading(true);
    setAnalyticsError('');
    try {
      const data = await DialerService.getInstantlyAnalytics();
      setAnalytics(Array.isArray(data) ? data : []);
    } catch (e) {
      setAnalyticsError(e.response?.data?.detail || e.message || 'Failed to load campaign analytics.');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const hasCredsForAccounts = !!dialerConf?.has_instantly_credentials;
  useEffect(() => {
    if (!hasCredsForAccounts) return undefined;
    let live = true;
    DialerService.getInstantlyAccounts()
      .then((data) => { if (live) setAccounts(Array.isArray(data) ? data : []); })
      .catch((e) => { if (live) setAccountsError(e.response?.data?.detail || e.message || 'Failed to load Instantly mailboxes.'); });
    return () => { live = false; };
  }, [hasCredsForAccounts]);

  const toggleWebhook = async (enable) => {
    setWebhookBusy(true);
    setWebhookError(''); setWebhookSuccess('');
    try {
      if (enable) await DialerService.registerInstantlyWebhook();
      else await DialerService.disableInstantlyWebhook();
      setWebhookSuccess(enable ? 'Webhook registered.' : 'Webhook disabled.');
      await onChanged();
    } catch (e) {
      // Graceful fallback: the register/disable route is built by a parallel
      // phase and may 404 until it lands — never let that crash this card.
      setWebhookError(e.response?.data?.detail || e.message || `Failed to ${enable ? 'enable' : 'disable'} the webhook.`);
    } finally {
      setWebhookBusy(false);
    }
  };

  const statusBadge = !form.instantly_enabled ? { v: 'danger', t: '● Not Configured' }
    : hasCreds ? { v: 'success', t: '● Connected' }
    : { v: 'warning', t: '● Credentials Missing' };

  const save = async () => {
    setError(''); setSuccess('');
    setSaving(true);
    try {
      const payload = { instantly_enabled: form.instantly_enabled };
      if (form.instantly_api_key.trim()) payload.instantly_api_key = form.instantly_api_key.trim();
      if (accountsDirty) {
        if (limitMailboxes && !sendingAccounts.length) {
          setError('Pick at least one mailbox, or turn off "Only let cadences use mailboxes I pick" to allow all of them.');
          return;
        }
        payload.instantly_sending_accounts = limitMailboxes ? sendingAccounts : [];
      }
      await DialerService.saveConfig(payload);
      setForm((f) => ({ ...f, instantly_api_key: '' }));
      setAccountsDirty(false);
      setSuccess('Instantly configuration saved successfully.');
      await onChanged();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Instantly.ai Sync" subtitle="Pull campaign/lead engagement (opens, clicks, replies, interest) from Instantly.ai every 15 minutes"
        actions={<Badge variant={statusBadge.v}>{statusBadge.t}</Badge>} />
      <CardContent className="space-y-3">
        <Switch checked={form.instantly_enabled} onChange={(e) => setForm((f) => ({ ...f, instantly_enabled: e.target.checked }))}
          label="Enable Instantly.ai Sync"
          hint="Matches Instantly leads to existing Alternate CRM leads by email. No match is logged and skipped — never creates a new lead." />
        <Input label="API Key" type="password" value={form.instantly_api_key}
          onChange={(e) => setForm((f) => ({ ...f, instantly_api_key: e.target.value }))}
          placeholder={hasCreds ? '•••••••• (saved — leave blank to keep)' : 'Enter Instantly.ai API Key'}
          hint="Read-only key (leads:read, campaigns:read, emails:read) from Instantly → Settings → Integrations → API Keys. Encrypted at rest (AES-256-GCM)." />
        <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
          Last synced: {dialerConf?.instantly_last_sync_at ? new Date(dialerConf.instantly_last_sync_at).toLocaleString() : 'Never'}
        </div>
        <Banner text={error} tone="error" />
        <Banner text={success} tone="ok" />

        {hasCreds && (
          <Switch checked={webhookRegistered} onChange={(e) => toggleWebhook(e.target.checked)} disabled={webhookBusy}
            label="Real-time webhook (replies, opens, clicks, completion)"
            hint={webhookRegistered
              ? 'Registered — Instantly pushes events to this deployment as they happen.'
              : 'Off — relies on the 15-minute poll only. Enabling sends events here in real time once the receiver is live.'} />
        )}
        <Banner text={webhookError} tone="error" />
        <Banner text={webhookSuccess} tone="ok" />

        {hasCreds && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="text-sm font-semibold text-slate-700">Mailboxes cadences can send from</div>
            {accountsError ? (
              <Banner text={accountsError} tone="error" />
            ) : accounts === null ? (
              <SkeletonText lines={2} />
            ) : !accounts.length ? (
              <EmptyState title="No Instantly mailboxes found." />
            ) : (
              <>
                <Switch
                  checked={limitMailboxes}
                  onChange={(e) => { setLimitMailboxes(e.target.checked); setAccountsDirty(true); }}
                  label="Only let cadences use mailboxes I pick"
                  hint={limitMailboxes
                    ? 'Cadences can only send from the mailboxes you tick below.'
                    : `Cadences can use all ${mailboxSummary(accounts)}.`}
                />
                {limitMailboxes && (
                  <MailboxPicker accounts={accounts} selected={sendingAccounts}
                    onChange={(next) => { setSendingAccounts(next); setAccountsDirty(true); }} />
                )}
                {accountsDirty && <p className="text-xs text-amber-700 m-0">Not saved yet — click Save Configuration.</p>}
              </>
            )}
          </div>
        )}

        {hasCreds && (
          <div className="pt-1">
            <button type="button" onClick={showAnalytics ? () => setShowAnalytics(false) : loadAnalytics}
              className="text-xs text-slate-500 underline underline-offset-2">
              {showAnalytics ? 'Hide campaign analytics' : 'View campaign analytics'}
            </button>
            {showAnalytics && (
              <div className="mt-2">
                {analyticsLoading ? (
                  <SkeletonText lines={3} />
                ) : analyticsError ? (
                  <Banner text={analyticsError} tone="error" />
                ) : !analytics?.length ? (
                  <EmptyState title="No campaign step data yet." />
                ) : (
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeader>Step</TableHeader>
                        <TableHeader>Sent</TableHeader>
                        <TableHeader>Opened</TableHeader>
                        <TableHeader>Clicked</TableHeader>
                        <TableHeader>Replied</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {analytics.map((row, i) => (
                        <TableRow key={row.step ?? i}>
                          <TableCell>{row.step ?? 'All'}</TableCell>
                          <TableCell>{row.sent ?? 0}</TableCell>
                          <TableCell>{row.unique_opened ?? row.opened ?? 0}</TableCell>
                          <TableCell>{row.unique_clicks ?? row.clicks ?? 0}</TableCell>
                          <TableCell>{row.unique_replies ?? row.replies ?? 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Configuration'}</Button>
      </CardFooter>
    </Card>
  );
}

// ── Public API Key ───────────────────────────────────────────────────────────
// Ported from settings.js:849-944 (publicapi panel markup) + :1007-1137
// (_loadPublicApiStatus / generate / copy / revoke handlers — these called
// API_BASE directly, no prior api.js coverage; added SettingsService.
// getPublicApiKeyStatus/generatePublicApiKey/revokePublicApiKey for this).
function PublicApiCard({ status, onChanged }) {
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [confirmAction, setConfirmAction] = useState(null); // 'generate' | 'revoke' | null

  const generate = async () => {
    setGenerating(true);
    setActionStatus('');
    try {
      const data = await SettingsService.generatePublicApiKey();
      if (data.success) {
        setGeneratedKey(data.api_key);
        setActionStatus('Key generated.');
        await onChanged();
      } else {
        setActionStatus('Failed: ' + (data.detail || 'Unknown error'));
      }
    } catch (e) {
      setActionStatus(e.response?.data?.detail || e.message || 'Network error');
    } finally {
      setGenerating(false);
      setConfirmAction(null);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(generatedKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const revoke = async () => {
    setRevoking(true);
    try {
      const data = await SettingsService.revokePublicApiKey();
      setActionStatus(data.success ? 'Key revoked.' : (data.message || 'Failed'));
      setGeneratedKey('');
      await onChanged();
    } catch (e) {
      setActionStatus(e.message || 'Failed to revoke.');
    } finally {
      setRevoking(false);
      setConfirmAction(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Public API — CMT ↔ Salesforce Bridge" subtitle="Allow external tools to look up Salesforce Account IDs via Alternate CRM"
        actions={<Badge variant={status.configured ? 'success' : 'danger'}>{status.configured ? 'Active' : 'No Key'}</Badge>} />
      <CardContent className="space-y-3">
        {generatedKey && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="text-xs font-bold text-green-800 mb-2">API Key Generated — Copy it now!</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white border border-green-200 rounded-lg px-3 py-2 break-all">{generatedKey}</code>
              <Button size="sm" variant="secondary" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</Button>
            </div>
            <p className="text-[11px] text-green-700 mt-2">This key will NOT be shown again. Store it securely.</p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setConfirmAction('generate')} disabled={generating}>{generating ? 'Generating…' : 'Generate New Key'}</Button>
          {status.configured && <Button size="sm" variant="danger" onClick={() => setConfirmAction('revoke')} disabled={revoking}>{revoking ? 'Revoking…' : 'Revoke Key'}</Button>}
          {actionStatus && <span className="text-xs text-slate-500">{actionStatus}</span>}
        </div>

        {status.configured && (
          <div className="text-xs text-slate-500">
            {status.call_count > 0
              ? `Used ${status.call_count} time${status.call_count === 1 ? '' : 's'} — last used ${new Date(status.last_used_at).toLocaleString()}`
              : 'No requests yet.'}
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 leading-relaxed">
          <div className="font-bold text-slate-700 mb-1.5">How to use this API</div>
          <div><strong>Endpoint:</strong> <code className="bg-slate-200 rounded px-1">GET /api/public/sf/account</code></div>
          <div><strong>Header:</strong> <code className="bg-slate-200 rounded px-1">X-API-Key: &lt;your-key&gt;</code></div>
          <div><strong>Params (at least one):</strong> <code className="bg-slate-200 rounded px-1">messaging_provider_id</code>, <code className="bg-slate-200 rounded px-1">company_name</code></div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <strong>Security Notice:</strong> An API key is <strong>Super-Admin-equivalent access</strong> — generating a new key immediately invalidates the old one. Share keys securely; anyone with the key can query your Salesforce data. Use Revoke to disable access instantly.
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmAction === 'generate'}
        onClose={() => setConfirmAction(null)}
        title="Generate new API key?"
        message="Any existing key will be immediately invalidated. The new key is shown once — store it securely."
        confirmLabel="Generate"
        onConfirm={generate}
        loading={generating}
      />
      <ConfirmDialog
        open={confirmAction === 'revoke'}
        onClose={() => setConfirmAction(null)}
        title="Revoke the API key?"
        message="All external API access will be disabled immediately."
        confirmLabel="Revoke"
        confirmVariant="danger"
        onConfirm={revoke}
        loading={revoking}
      />
    </Card>
  );
}

/** v13.4.0 — org-wide switch for the Claude connector's write tools
 *  (add notes/tasks, change status, approve cadence drafts). Reads are always
 *  on and scoped per user; each person connects with their own key from My
 *  Settings. */
function ClaudeConnectorAdminCard({ syncSettings, onChanged }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const enabled = !!syncSettings?.mcp_write_enabled;
  const everyone = !!syncSettings?.mcp_everyone_enabled;
  const save = async (fields) => {
    setSaving(true);
    setError('');
    try {
      await SettingsService.patchSyncSettings(fields);
      await onChanged();
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not save — try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Claude connector"
        subtitle="Each person connects Claude with their own key from My Settings → Claude connector. Claude only ever sees and does what that person can in Alternate CRM."
        actions={<Badge variant={enabled ? 'indigo' : 'default'}>{enabled ? 'Can make changes' : 'View only'}</Badge>}
      />
      <CardContent className="space-y-4">
        <Switch
          checked={everyone}
          onChange={(e) => !saving && save({ mcp_everyone_enabled: e.target.checked })}
          label="Let everyone connect Claude"
          hint={everyone
            ? 'Everyone can connect from My Settings. Reps see only their own leads and data, exactly as in Alternate CRM.'
            : 'Off: only Super Admins can connect for now. Others don\u2019t see the option.'}
        />
        <Switch
          checked={enabled}
          onChange={(e) => !saving && save({ mcp_write_enabled: e.target.checked })}
          label="Allow Claude to make changes"
          hint="Lets Claude add notes and tasks, change lead status, and send cadence email/SMS drafts waiting for that person's approval — Claude first shows them the exact message and sends only after they say yes. Changes are made as that person, exactly as if they did it in Alternate CRM. Claude can't delete anything, bulk-edit, or start a new message. Every lookup and change is listed in Monitoring → Claude Logs."
        />
        {error && <p role="alert" className="text-xs text-red-600 mt-2 mb-0">{error}</p>}
      </CardContent>
    </Card>
  );
}
