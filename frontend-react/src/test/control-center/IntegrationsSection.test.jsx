import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrationsSection } from '../../features/control-center/sections/IntegrationsSection';
import { SettingsService, DialerService, CallsService, SfMappingService } from '../../services/api';

vi.mock('../../services/api', () => ({
  SettingsService: {
    getSfStatus: vi.fn(),
    getSfOverview: vi.fn(),
    getNylasConfig: vi.fn(),
    getSyncSettings: vi.fn(),
    getRecordTypes: vi.fn(),
    getPublicApiKeyStatus: vi.fn(),
    generatePublicApiKey: vi.fn(),
    revokePublicApiKey: vi.fn(),
    connectSf: vi.fn(),
    disconnectSf: vi.fn(),
    saveNylasConfig: vi.fn(),
    testNylasConnection: vi.fn(),
    patchSyncSettings: vi.fn(),
  },
  DialerService: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    testConnection: vi.fn(),
    getInstantlyAnalytics: vi.fn(),
    getInstantlyAccounts: vi.fn(),
    registerInstantlyWebhook: vi.fn(),
    disableInstantlyWebhook: vi.fn(),
    syncKlentyNow: vi.fn(),
  },
  CallsService: {
    getCallOutcomes: vi.fn(),
  },
  SfMappingService: { list: vi.fn(), add: vi.fn(), setEnabled: vi.fn(), remove: vi.fn() },
}));

const overview = { total: 420, in_salesforce: 300, only_in_alternatecrm: 120, push_stage: 'Meeting Scheduled', waiting_at_push_stage: 7 };
const sfConnected = {
  connected: true, source: 'ui', environment: 'Production', instance_url: 'https://acme.salesforce.com',
  username: 'admin@acme.com', org_name: 'Acme Inc', connected_by: 'Neelmani',
  last_sync_at: null, last_sync_status: null, records_synced_last_run: 0,
};
const nylasConf = { configured: true, is_active: true, client_id: 'client-123', redirect_uri: '', has_webhook_secret: false };
const dialerConf = {
  provider: 'aircall', has_credentials: true, api_id: 'ac-1', has_messenger_credentials: false,
  aircall_everywhere_enabled: false, aircall_sync_enabled: true, aircall_last_sync_at: null,
  instantly_enabled: false, has_instantly_credentials: false, instantly_last_sync_at: null,
  klenty_enabled: false, has_klenty_credentials: false, klenty_last_sync_at: null,
};
const syncSettings = {
  messenger_enabled: false, messenger_base_url: '', messenger_api_key: '', messenger_user_id: '',
  messenger_account_id: '', messenger_sender_id: '', messaging_provider: 'messenger',
  sandbox_test_phone_number: '', aircall_messaging_number_id: '', sync_direction: 'push_only',
  lead_limit: 1000, sf_push_stage: 'Meeting Scheduled', record_type_ids: ['rt-1'],
  sync_declined_to_salesforce: false, sync_unreachable_to_salesforce: false,
  sf_auto_sync_enabled: false, sf_auto_sync_hour_utc: 2, sf_auto_sync_minute_utc: 0, sf_auto_sync_last_run_at: null,
  allow_multi_pod_sdr: false,
  max_call_attempts: 5, min_call_attempts_for_unreachable: 3,
  terminal_lead_cooldown_days: 30, conversation_min_seconds: 120,
};
const recordTypes = [{ id: 'rt-1', name: 'Standard' }, { id: 'rt-2', name: 'Partner' }];
const outcomesResponse = {
  outcomes: [
    { value: 'Meeting Scheduled', group: 'answered', action: 'meeting_scheduled', notes_required: false, builtin: true, enabled: true },
    { value: 'Not Interested', group: 'terminal', action: 'disqualify', notes_required: true, builtin: true, enabled: true },
  ],
};

// Default tab is Salesforce — its connection card's "Acme Inc" is the universal
// "Super Admin data has finished loading" signal used before switching
// tabs. (Nylas used to live on Connections and served this role; the
// 2026-10-05 reorg moved it to its own Email Sending tab, see below, so
// tests that just need a loaded-and-ready gate wait on this instead.)
const waitForReady = () => waitFor(() => expect(screen.getByText('Acme Inc')).toBeInTheDocument());
const openTab = (user, name) => user.click(screen.getByRole('button', { name }));

describe('IntegrationsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SettingsService.getSfOverview.mockResolvedValue(overview);
    SettingsService.getSfStatus.mockResolvedValue(sfConnected);
    SettingsService.getNylasConfig.mockResolvedValue(nylasConf);
    SettingsService.getSyncSettings.mockResolvedValue(syncSettings);
    SettingsService.getRecordTypes.mockResolvedValue(recordTypes);
    SettingsService.getPublicApiKeyStatus.mockResolvedValue({ configured: false });
    SettingsService.patchSyncSettings.mockResolvedValue({});
    DialerService.getConfig.mockResolvedValue(dialerConf);
    DialerService.getInstantlyAccounts.mockResolvedValue([]);
    CallsService.getCallOutcomes.mockResolvedValue(outcomesResponse);
    SfMappingService.list.mockResolvedValue({ custom: [], builtin: [], available: [] });
  });

  it('Super Admin: Claude connector writes are off by default and the switch saves mcp_write_enabled', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await openTab(user, 'Connections');
    expect(await screen.findByText('Claude connector')).toBeInTheDocument();
    const toggle = screen.getByRole('checkbox', { name: /Allow Claude to make changes/ });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith({ mcp_write_enabled: true }));
  });

  it('Super Admin: the connector is Super-Admins-only by default and can be opened to everyone', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await openTab(user, 'Connections');
    const everyone = await screen.findByRole('checkbox', { name: /Let everyone connect Claude/ });
    expect(everyone).not.toBeChecked();
    expect(screen.getByText(/only Super Admins can connect for now/)).toBeInTheDocument();
    await user.click(everyone);
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith({ mcp_everyone_enabled: true }));
  });

  it('an Admin (not Super Admin) does not get the Claude connector switch', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Admin" />);
    await waitFor(() => expect(screen.getByText('Acme Inc')).toBeInTheDocument());
    await openTab(user, 'Connections');
    expect(screen.queryByRole('checkbox', { name: /Allow Claude to make changes/ })).not.toBeInTheDocument();
  });

  it('blocks a role below Admin', async () => {
    render(<IntegrationsSection userRole="SDR" />);
    await waitFor(() => expect(screen.getByText(/Admin access required/i)).toBeInTheDocument());
    expect(SettingsService.getSfOverview).not.toHaveBeenCalled();
  });

  it('shows the SF connection status on the Salesforce tab for an Admin, without the Super-Admin-only sync rules', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Admin" />);
    await waitFor(() => expect(screen.getByText(/Connected via Portal/)).toBeInTheDocument());
    expect(screen.getByText('Acme Inc')).toBeInTheDocument();
    expect(screen.getByText(/Sync rules and field mapping are Super Admin only/)).toBeInTheDocument();
    expect(SettingsService.getSfOverview).not.toHaveBeenCalled();
    await openTab(user, 'Connections');
    expect(screen.queryByText('Data Summary')).not.toBeInTheDocument();      // that card was replaced by the Salesforce overview
    // Admin (not Super Admin) doesn't see Public API, or anything on the
    // Super-Admin-only Email Sending/Calling & Messaging tabs.
    expect(screen.queryByText('Generate New Key')).not.toBeInTheDocument();
  });

  // RCA 2026-09-03: IntegrationsSection used to stack Salesforce, Data
  // Summary, Nylas, Aircall, Alternate Messenger and Public API on one flat page —
  // split into Connections / Dialer / CRM Settings tabs per user audit.
  // RCA 2026-10-05: "Dialer" then grew to hold Aircall (calling), Alternate Messenger
  // (calling + messaging) AND Instantly (email sending) under one label that
  // only described one of them, while Nylas (also email sending) sat on
  // Connections for no reason but history — split again, this time by what
  // each integration actually does: Connections (inbound: Salesforce, the
  // public API bridge) / Email Sending (Nylas + Instantly) / Calling &
  // Messaging (Aircall, Alternate Messenger, Klenty) / CRM Settings (unchanged).
  it('renders Public API on Connections, but not Nylas/Aircall/Alternate Messenger/the Salesforce sync rules', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await openTab(user, 'Connections');
    expect(await screen.findByText(/Public API/)).toBeInTheDocument();
    expect(screen.queryByText('Nylas Email Integration')).not.toBeInTheDocument();
    expect(screen.queryByText('Aircall Configuration')).not.toBeInTheDocument();
    expect(screen.queryByText('Alternate Messenger Conversations')).not.toBeInTheDocument();
    expect(screen.queryByText('What Syncs with Salesforce')).not.toBeInTheDocument();
  });

  it('renders Nylas + Instantly on the Email Sending tab', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();

    await user.click(screen.getByRole('button', { name: 'Email Sending' }));
    expect(await screen.findByText('Nylas Email Integration')).toBeInTheDocument();
    expect(screen.getByText('Instantly.ai Sync')).toBeInTheDocument();
  });

  it('renders Aircall + Klenty on the Calling & Messaging tab (Alternate Messenger retired)', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();

    await user.click(screen.getByRole('button', { name: 'Calling & Messaging' }));
    expect(await screen.findByText('Aircall Configuration')).toBeInTheDocument();
    expect(screen.queryByText('Alternate Messenger Conversations')).not.toBeInTheDocument();
    expect(screen.getByText('Klenty Call-Activity Bridge')).toBeInTheDocument();
  });

  // ── Salesforce tab: one place for connection, what syncs, schedule and field mapping ─────────────────────────
  const onSalesforceTab = async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    return user;
  };
  const switchFor = (name) => screen.getByRole('checkbox', { name });
  const dialog = () => within(screen.getByRole('dialog'));

  it('the Salesforce tab says how many leads are in Salesforce, from the server\'s own count', async () => {
    await onSalesforceTab();
    expect(await screen.findByText('Leads in Alternate CRM')).toBeInTheDocument();
    expect(screen.getByText('420')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Waiting to be sent')).toBeInTheDocument();
    expect(screen.getByText(/at "Meeting Scheduled" not yet in Salesforce/)).toBeInTheDocument();
  });

  it('the Salesforce tab holds the connection, what syncs, the schedule and the field mapping, and is the default', async () => {
    await onSalesforceTab();
    expect(screen.getByText('Acme Inc')).toBeInTheDocument();
    expect(screen.getByText('What Syncs with Salesforce')).toBeInTheDocument();
    expect(screen.getByText('Schedule and Volume')).toBeInTheDocument();
    expect(await screen.findByText('Salesforce Field Mapping')).toBeInTheDocument();
    // the five old single-purpose cards are gone
    for (const gone of ['Salesforce Sync Direction', 'Salesforce Push Configuration', 'Terminal Status Sync Options', 'Auto-Sync Schedule', 'Opportunity Sync (AE Pipeline / CSM Portal)']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
  });

  // Every switch that makes data move asks first, and saves nothing until you agree.
  it.each([
    ['Two-way lead sync', /Turn on two-way lead sync/, { sync_direction: 'both' }],
    ['Also send Customer Declined leads', /Send Customer Declined leads to Salesforce/, { sync_declined_to_salesforce: true }],
    ['Also send Unreachable leads', /Send Unreachable leads to Salesforce/, { sync_unreachable_to_salesforce: true }],
    ['Read opportunities and accounts from Salesforce', /Read opportunities and accounts from Salesforce/, { opportunity_sync_direction: 'both' }],
    ['Send AE and CSM deal actions to Salesforce', /Send deal actions to Salesforce/, { opportunity_writeback_enabled: true }],
  ])('turning on "%s" asks first, saves only after Confirm, and Cancel saves nothing', async (label, title, patch) => {
    const user = await onSalesforceTab();
    await user.click(switchFor(label));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(dialog().getByText(title)).toBeInTheDocument();
    expect(SettingsService.patchSyncSettings).not.toHaveBeenCalled();

    await user.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(SettingsService.patchSyncSettings).not.toHaveBeenCalled();
    expect(switchFor(label)).not.toBeChecked();

    await user.click(switchFor(label));
    await user.click(dialog().getByRole('button', { name: /Turn On/ }));
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith(patch));
    await waitFor(() => expect(switchFor(label)).toBeChecked());
  });

  it('turning a sync switch OFF needs no confirmation — it only ever reduces what moves', async () => {
    SettingsService.getSyncSettings.mockResolvedValue({ ...syncSettings, sync_direction: 'both' });
    const user = await onSalesforceTab();
    await user.click(switchFor('Two-way lead sync'));
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith({ sync_direction: 'push_only' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('changing the push stage names the old and new stage in its confirmation', async () => {
    const user = await onSalesforceTab();
    await user.click(screen.getByLabelText('Send leads to Salesforce at stage'));
    await user.click(await screen.findByText('Demo Done'));
    expect(dialog().getByText(/"Demo Done" are created or updated in Salesforce instead of leads in "Meeting Scheduled"/)).toBeInTheDocument();
    expect(SettingsService.patchSyncSettings).not.toHaveBeenCalled();
    await user.click(dialog().getByRole('button', { name: 'Change Stage' }));
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith({ sf_push_stage: 'Demo Done' }));
  });

  it('a failed save puts the switch back and says nothing was changed', async () => {
    SettingsService.patchSyncSettings.mockRejectedValue({ response: { data: { detail: 'Salesforce is down' } } });
    const user = await onSalesforceTab();
    await user.click(switchFor('Also send Unreachable leads'));
    await user.click(dialog().getByRole('button', { name: /Turn On/ }));
    expect(await screen.findByText('Salesforce is down')).toBeInTheDocument();
    expect(switchFor('Also send Unreachable leads')).not.toBeChecked();
  });

  it('Schedule and volume is one form: editing shows an unsaved count, Save lists the changes, Confirm saves them together', async () => {
    const user = await onSalesforceTab();
    await waitFor(() => expect(SettingsService.getRecordTypes).toHaveBeenCalled());
    expect(await screen.findByText('Standard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    const limit = screen.getByLabelText('Leads read per sync');
    await user.clear(limit);
    await user.type(limit, '500');
    await user.click(screen.getByText('Standard'));                 // 'rt-1' was selected -> now none are, which means ALL types
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(dialog().getByText('Leads read per sync: 1000 → 500')).toBeInTheDocument();
    expect(dialog().getByText('Record types read: 1 selected → all types')).toBeInTheDocument();
    expect(SettingsService.patchSyncSettings).not.toHaveBeenCalled();
    await user.click(dialog().getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith({
      sf_auto_sync_enabled: false, sf_auto_sync_hour_utc: 2, sf_auto_sync_minute_utc: 0, lead_limit: 500, record_type_ids: [],
    }));
  });

  it('record types say plainly what none ticked means, and have Select all / Clear', async () => {
    SettingsService.getSyncSettings.mockResolvedValue({ ...syncSettings, record_type_ids: [] });
    const user = await onSalesforceTab();
    expect(await screen.findByText('All 2 record types are read')).toBeInTheDocument();     // nothing ticked = every type
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 of 2 selected — only these are read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('All 2 record types are read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();            // back to what is saved: nothing to save
  });

  it('a long record-type list gets a search box', async () => {
    SettingsService.getRecordTypes.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `rt${i}`, name: `Type ${i}` })));
    const user = await onSalesforceTab();
    await screen.findByText('Type 9');
    await user.type(screen.getByLabelText('Search record types'), 'Type 3');
    expect(screen.getByText('Type 3')).toBeInTheDocument();
    expect(screen.queryByText('Type 9')).not.toBeInTheDocument();
  });

  it('turning the daily auto-sync on is confirmed with its time; Discard puts everything back', async () => {
    const user = await onSalesforceTab();
    await user.click(switchFor('Run automatically every day'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(dialog().getByText('Run automatically every day: Off → On, at 02:00 UTC')).toBeInTheDocument();
    await user.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(SettingsService.patchSyncSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(switchFor('Run automatically every day')).not.toBeChecked();
  });

  it('turning the daily auto-sync OFF saves without asking', async () => {
    SettingsService.getSyncSettings.mockResolvedValue({ ...syncSettings, sf_auto_sync_enabled: true });
    const user = await onSalesforceTab();
    await user.click(switchFor('Run automatically every day'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith(expect.objectContaining({ sf_auto_sync_enabled: false })));
  });

  // ── Pod & Call Rules tab ──────────────────────────────────────────────────────────────────────────────────────
  const onRulesTab = async () => {
    const user = await onSalesforceTab();
    await openTab(user, 'Pod & Call Rules');
    return user;
  };

  it('Pod & Call Rules holds the pod rule, the call numbers and the call outcomes — and nothing from Salesforce', async () => {
    await onRulesTab();
    expect(await screen.findByText('Pod and Call Rules')).toBeInTheDocument();
    expect(screen.getByLabelText('Call attempts before a warning')).toHaveValue(5);
    const outcomesCard = (await screen.findByText('Call Outcomes Configuration')).closest('.bg-white');
    expect(within(outcomesCard).getByText('Meeting Scheduled')).toBeInTheDocument();
    expect(screen.queryByText('What Syncs with Salesforce')).not.toBeInTheDocument();
  });

  it('allowing an SDR in several pods asks first, because it widens who can see them', async () => {
    const user = await onRulesTab();
    await user.click(await screen.findByRole('checkbox', { name: 'Let an SDR belong to more than one pod' }));
    expect(dialog().getByText(/widens who can see their leads and activity/)).toBeInTheDocument();
    expect(SettingsService.patchSyncSettings).not.toHaveBeenCalled();
    await user.click(dialog().getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith({ allow_multi_pod_sdr: true }));
  });

  it('saving the call numbers lists each change and sends all four together on Confirm', async () => {
    const user = await onRulesTab();
    const attempts = await screen.findByLabelText('Call attempts before a warning');
    await user.clear(attempts);
    await user.type(attempts, '8');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(dialog().getByText('Call attempts before a warning: 5 → 8')).toBeInTheDocument();
    expect(SettingsService.patchSyncSettings).not.toHaveBeenCalled();
    await user.click(dialog().getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith({
      max_call_attempts: 8, min_call_attempts_for_unreachable: 3, terminal_lead_cooldown_days: 30, conversation_min_seconds: 120,
    }));
  });

  it('saving the call outcomes asks first, and Auto-Disqualify on a non-terminal group shows an inline error, not a browser alert', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const user = await onRulesTab();
    await user.click(await screen.findByRole('button', { name: 'Save Outcomes Configuration' }));
    expect(dialog().getByText(/Every SDR sees these outcomes/)).toBeInTheDocument();
    expect(SettingsService.patchSyncSettings).not.toHaveBeenCalled();
    await user.click(dialog().getByRole('button', { name: 'Save Outcomes' }));
    await waitFor(() => expect(SettingsService.patchSyncSettings).toHaveBeenCalledWith({ outcome_config: outcomesResponse.outcomes }));

    await user.type(screen.getByLabelText('Outcome Name'), 'A');          // too short -> inline message
    await user.click(screen.getByRole('button', { name: /Add Outcome/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('2-50 characters');
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });


  // RCA 2026-09-03: Alternate Messenger's API key used to pre-fill with the real
  // plaintext secret and resend it unchanged on every save. Now masked like
  // Nylas/Aircall, and omitted from the save payload unless actually edited
  // (Alternate Messenger Conversations card retired)

  it('adds a clarifying hint under the Aircall "Calling Provider" dropdown', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Calling & Messaging' }));

    expect(await screen.findByText('Aircall Configuration')).toBeInTheDocument();
    expect(screen.getByText(/independent from the Messaging Provider setting/)).toBeInTheDocument();
  });

  // Klenty: backend-complete (klenty_enabled/klenty_api_key on SyncSettings,
  // GET/PATCH /dialer/config, POST /admin/dialer/sync-klenty) since the
  // feature shipped, but had no UI card at all until this audit — modeled
  // closely on InstantlyCard's enable+masked-key+last-sync shape.
  it('renders Klenty card on Calling & Messaging as Not Configured when disabled', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Calling & Messaging' }));

    const klentyCard = (await screen.findByText('Klenty Call-Activity Bridge')).closest('.bg-white');
    expect(within(klentyCard).getByText('● Not Configured')).toBeInTheDocument();
    // No credentials yet — Sync Now isn't offered.
    expect(within(klentyCard).queryByText('Sync Now')).not.toBeInTheDocument();
  });

  it('saves Klenty enable + API key, sending only klenty_enabled when the key field is left blank', async () => {
    DialerService.saveConfig.mockResolvedValue({});
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Calling & Messaging' }));

    const klentyCard = (await screen.findByText('Klenty Call-Activity Bridge')).closest('.bg-white');
    const toggle = within(klentyCard).getByText('Enable Klenty Sync').closest('label').querySelector('input[type="checkbox"]');
    await user.click(toggle);
    await user.click(within(klentyCard).getByText('Save Configuration'));

    await waitFor(() => expect(DialerService.saveConfig).toHaveBeenCalledWith({ klenty_enabled: true }));
  });

  it('triggers a manual Klenty sync once credentials exist', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, klenty_enabled: true, has_klenty_credentials: true });
    DialerService.syncKlentyNow.mockResolvedValue({ ran: true, imported: 7 });
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Calling & Messaging' }));

    const klentyCard = (await screen.findByText('Klenty Call-Activity Bridge')).closest('.bg-white');
    await user.click(within(klentyCard).getByText('Sync Now'));

    expect(await within(klentyCard).findByText(/7 call\(s\) imported/)).toBeInTheDocument();
    expect(DialerService.syncKlentyNow).toHaveBeenCalledTimes(1);
  });

  // New in this batch: Instantly.ai pull-sync card, modeled on Aircall/
  // Alternate Messenger above, wired to the same GET/PATCH /dialer/config payload.
  it('renders Instantly.ai card on the Email Sending tab as Not Configured when disabled', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    expect(within(instantlyCard).getByText('● Not Configured')).toBeInTheDocument();
  });

  it('shows Instantly.ai as Connected when enabled with credentials saved', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true, instantly_last_sync_at: '2026-10-01T12:00:00Z' });
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    expect(within(instantlyCard).getByText('● Connected')).toBeInTheDocument();
    expect(within(instantlyCard).getByText(/Last synced:/)).toBeInTheDocument();
  });

  it('shows Credentials Missing when enabled but no key is saved', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: false });
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    expect(within(instantlyCard).getByText('● Credentials Missing')).toBeInTheDocument();
  });

  it('saves Instantly enable + API key, sending only instantly_enabled when the key field is left blank', async () => {
    DialerService.saveConfig.mockResolvedValue({});
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    const toggle = within(instantlyCard).getByText('Enable Instantly.ai Sync').closest('label').querySelector('input[type="checkbox"]');
    await user.click(toggle);
    await user.click(within(instantlyCard).getByText('Save Configuration'));

    await waitFor(() => expect(DialerService.saveConfig).toHaveBeenCalledWith({ instantly_enabled: true }));
  });

  it('masks a saved Instantly API key with a "leave blank to keep" placeholder and sends the typed value when changed', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true });
    DialerService.saveConfig.mockResolvedValue({});
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    const keyInput = within(instantlyCard).getByPlaceholderText('•••••••• (saved — leave blank to keep)');
    expect(keyInput).toHaveValue('');
    expect(keyInput).toHaveAttribute('type', 'password');

    // Re-save with a blank key — must not resend/clear the saved credential.
    await user.click(within(instantlyCard).getByText('Save Configuration'));
    await waitFor(() => expect(DialerService.saveConfig).toHaveBeenCalledWith({ instantly_enabled: true }));

    DialerService.saveConfig.mockClear();
    await user.type(keyInput, 'new-instantly-key');
    await user.click(within(instantlyCard).getByText('Save Configuration'));
    await waitFor(() => expect(DialerService.saveConfig).toHaveBeenCalledWith({ instantly_enabled: true, instantly_api_key: 'new-instantly-key' }));
  });

  it('loads and shows per-step campaign analytics on demand, only once credentials exist', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true });
    DialerService.getInstantlyAnalytics.mockResolvedValue([
      { step: 1, sent: 100, unique_opened: 40, unique_clicks: 10, unique_replies: 5 },
    ]);
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    await user.click(within(instantlyCard).getByText('View campaign analytics'));

    expect(await within(instantlyCard).findByText('100')).toBeInTheDocument();
    expect(within(instantlyCard).getByText('40')).toBeInTheDocument();
    expect(DialerService.getInstantlyAnalytics).toHaveBeenCalledTimes(1);
  });

  it('does not offer campaign analytics before Instantly credentials are configured', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: false, has_instantly_credentials: false });
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    expect(within(instantlyCard).queryByText('View campaign analytics')).not.toBeInTheDocument();
  });

  // v13.6.0 — "Mailboxes cadences can send from": explicit all-vs-picked switch + shared table.
  const POOL = [
    { email: 'a@pool.com', domain: 'pool.com', daily_limit: 50 },
    { email: 'b@pool.com', domain: 'pool.com', daily_limit: 30 },
    { email: 'c@other.io', domain: 'other.io', daily_limit: 40 },
  ];
  const openInstantly = async (user) => {
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));
    return (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
  };

  it('says plainly that all mailboxes can be used until the admin limits them', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true });
    DialerService.getInstantlyAccounts.mockResolvedValue(POOL);
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    const card = await openInstantly(user);
    expect(await within(card).findByText('Cadences can use all 3 mailboxes on 2 domains · up to 120 emails/day.')).toBeInTheDocument();
    expect(within(card).queryByRole('table')).not.toBeInTheDocument();
  });

  it('limiting to picked mailboxes saves exactly those; turning it off saves "all"', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true });
    DialerService.getInstantlyAccounts.mockResolvedValue(POOL);
    DialerService.saveConfig.mockResolvedValue({});
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    const card = await openInstantly(user);
    await within(card).findByText(/Cadences can use all/);

    const limit = within(card).getByText('Only let cadences use mailboxes I pick').closest('label').querySelector('input');
    await user.click(limit);
    expect(within(card).getByText('Not saved yet — click Save Configuration.')).toBeInTheDocument();
    await user.click(within(card).getByLabelText('c@other.io'));
    await user.click(within(card).getByText('Save Configuration'));
    await waitFor(() => expect(DialerService.saveConfig).toHaveBeenLastCalledWith({
      instantly_enabled: true, instantly_sending_accounts: ['c@other.io'] }));

    await user.click(limit);
    await user.click(within(card).getByText('Save Configuration'));
    await waitFor(() => expect(DialerService.saveConfig).toHaveBeenLastCalledWith({
      instantly_enabled: true, instantly_sending_accounts: [] }));
  });

  it('won\'t save "limit" with nothing picked — explains instead', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true });
    DialerService.getInstantlyAccounts.mockResolvedValue(POOL);
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    const card = await openInstantly(user);
    await within(card).findByText(/Cadences can use all/);
    await user.click(within(card).getByText('Only let cadences use mailboxes I pick').closest('label').querySelector('input'));
    await user.click(within(card).getByText('Save Configuration'));
    expect(await within(card).findByText(/Pick at least one mailbox/)).toBeInTheDocument();
    expect(DialerService.saveConfig).not.toHaveBeenCalled();
  });

  it('shows a readable error when Instantly mailboxes can\'t be loaded', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true });
    DialerService.getInstantlyAccounts.mockRejectedValue({ response: { data: { detail: 'Could not reach Instantly — see server logs for details' } } });
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    const card = await openInstantly(user);
    expect(await within(card).findByText(/Could not reach Instantly/)).toBeInTheDocument();
  });

  it('does not send instantly_sending_accounts when the mailbox setting was never touched', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true });
    DialerService.saveConfig.mockResolvedValue({});
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    await user.click(within(instantlyCard).getByText('Save Configuration'));

    await waitFor(() => expect(DialerService.saveConfig).toHaveBeenCalledWith({ instantly_enabled: true }));
  });

  it('registers and disables the real-time webhook, failing gracefully if the backend route 404s', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true });
    DialerService.registerInstantlyWebhook.mockRejectedValue({ response: { status: 404, data: { detail: 'Not Found' } } });
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    const webhookToggle = within(instantlyCard).getByText(/Real-time webhook/).closest('label').querySelector('input[type="checkbox"]');
    await user.click(webhookToggle);

    expect(await within(instantlyCard).findByText('Not Found')).toBeInTheDocument();
    expect(DialerService.registerInstantlyWebhook).toHaveBeenCalledTimes(1);
  });

  it('shows the webhook as registered when instantly_webhook_id is present in config', async () => {
    DialerService.getConfig.mockResolvedValue({ ...dialerConf, instantly_enabled: true, has_instantly_credentials: true, instantly_webhook_id: 'wh_123' });
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Email Sending' }));

    const instantlyCard = (await screen.findByText('Instantly.ai Sync')).closest('.bg-white');
    const webhookToggle = within(instantlyCard).getByText(/Real-time webhook/).closest('label').querySelector('input[type="checkbox"]');
    expect(webhookToggle).toBeChecked();
  });

  it('confirms before generating a Public API key, then shows it once, with the Super-Admin-equivalent warning copy', async () => {
    SettingsService.generatePublicApiKey.mockResolvedValue({ success: true, api_key: 'lsk_abc123' });
    const user = userEvent.setup();
    render(<IntegrationsSection userRole="Super Admin" />);
    await waitForReady();
    await openTab(user, 'Connections');
    await waitFor(() => expect(screen.getByText('Generate New Key')).toBeInTheDocument());
    expect(screen.getByText(/Super-Admin-equivalent access/)).toBeInTheDocument();

    await user.click(screen.getByText('Generate New Key'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Generate new API key/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(screen.getByText('lsk_abc123')).toBeInTheDocument());
    expect(SettingsService.generatePublicApiKey).toHaveBeenCalledTimes(1);
  });
});
