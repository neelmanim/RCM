import React, { useState } from 'react';
import { Card, CardHeader, CardContent } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import { ConfirmDialog } from '../../../../components/ui/Modal';
import { SettingsService } from '../../../../services/api';
import { Banner } from '../Banner';

// ── Salesforce Connection ──────────────────────────────────────────────────
// Ported from settings_connection.js's connectionTabHTML() SF card (lines
// 14-168) + bindConnectionTab()'s sf-connect-btn/sf-disconnect-btn handlers.
export function SalesforceConnectionCard({ sfInfo, isSuperAdmin, onChanged }) {
  const [showForm, setShowForm] = useState(!sfInfo.connected);
  const [form, setForm] = useState({ username: '', password: '', security_token: '', environment: 'sandbox' });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const connect = async () => {
    if (!form.username || !form.password || !form.security_token) {
      setError('Username, password, and security token are all required.');
      return;
    }
    setError('');
    setConnecting(true);
    try {
      await SettingsService.connectSf(form);
      await onChanged();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to connect.');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await SettingsService.disconnectSf();
      await onChanged();
    } catch (e) {
      window.alert('Failed to disconnect: ' + (e.response?.data?.detail || e.message));
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  };

  const instanceDisplay = sfInfo.instance_url ? sfInfo.instance_url.replace('https://', '').replace(/\/$/, '') : 'N/A';

  return (
    <Card>
      <CardHeader title="Salesforce Connection" subtitle="Manage your CRM integration" />
      <CardContent className="space-y-3">
        {sfInfo.connected ? (
          <>
            <Badge variant="success">● Connected via {sfInfo.source === 'ui' ? 'Portal' : 'Environment'}</Badge>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-sky-50 rounded-lg p-2.5">
                <div className="text-[10px] font-bold text-sky-700 uppercase tracking-wide">Instance</div>
                <div className="font-semibold text-sky-900 break-all">{instanceDisplay}</div>
              </div>
              <div className="bg-green-50 rounded-lg p-2.5">
                <div className="text-[10px] font-bold text-green-700 uppercase tracking-wide">Environment</div>
                <div className="font-semibold text-green-900">{sfInfo.environment || 'Production'}</div>
              </div>
            </div>
            <div className="rounded-lg overflow-hidden text-xs">
              {[
                ['Username', sfInfo.username],
                ['Org Name', sfInfo.org_name],
                ['Connected By', sfInfo.connected_by],
              ].map(([label, val], i) => (
                <div key={label} className={`flex justify-between px-3 py-2 ${i % 2 ? 'bg-white' : 'bg-slate-50'}`}>
                  <span className="text-slate-500">{label}</span>
                  <span className="font-semibold text-slate-800">{val || '—'}</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2 bg-green-50">
                <span className="text-slate-500">Last Sync</span>
                <span className="font-semibold text-green-800">
                  {sfInfo.last_sync_at ? new Date(sfInfo.last_sync_at).toLocaleString() : 'Never'}
                  {sfInfo.last_sync_status && (
                    <span className={sfInfo.last_sync_status === 'success' ? 'text-green-600' : 'text-red-600'}> ({sfInfo.last_sync_status})</span>
                  )}
                </span>
              </div>
              {/* settings_connection.js:68-72 — only shown once a sync has actually run. */}
              {sfInfo.records_synced_last_run > 0 && (
                <div className="flex justify-between px-3 py-2 bg-sky-50">
                  <span className="text-sky-700">Records Synced Last Run</span>
                  <span className="font-semibold text-sky-700">{sfInfo.records_synced_last_run.toLocaleString()}</span>
                </div>
              )}
            </div>

            {isSuperAdmin ? (
              <>
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={disconnecting}>
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowForm((s) => !s)}>
                    {showForm ? 'Cancel' : (sfInfo.source === 'ui' ? 'Update Credentials' : 'Switch to Portal Credentials')}
                  </Button>
                </div>
                {showForm && <SfConnectForm form={form} set={set} error={error} connecting={connecting} onConnect={connect} />}
              </>
            ) : (
              <p className="text-xs text-sky-700 bg-sky-50 rounded-lg p-2.5">Salesforce credentials are managed by your Super Admin.</p>
            )}
          </>
        ) : isSuperAdmin ? (
          <SfConnectForm form={form} set={set} error={error} connecting={connecting} onConnect={connect} />
        ) : (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3">Salesforce isn't connected. Contact your Super Admin.</p>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title="Disconnect Salesforce?"
        message="The system will fall back to environment variables if configured."
        confirmLabel="Disconnect"
        confirmVariant="danger"
        onConfirm={disconnect}
        loading={disconnecting}
      />
    </Card>
  );
}

function SfConnectForm({ form, set, error, connecting, onConnect }) {
  return (
    <div className="space-y-2 pt-1">
      <label className="block text-sm font-medium text-slate-700">Environment</label>
      <Select ariaLabel="Environment" value={form.environment} onChange={(v) => set('environment')({ target: { value: v } })}
        options={[{ value: 'sandbox', label: 'Sandbox' }, { value: 'production', label: 'Production' }]} />
      <Input label="Username" placeholder="user@company.com" value={form.username} onChange={set('username')} containerClassName="mb-2" />
      <Input label="Password" type="password" value={form.password} onChange={set('password')} containerClassName="mb-2" />
      <Input label="Security Token" type="password" value={form.security_token} onChange={set('security_token')}
        hint="Salesforce → Settings → Reset Security Token" containerClassName="mb-2" />
      <Banner text={error} tone="error" />
      <Button size="sm" onClick={onConnect} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect to Salesforce'}</Button>
    </div>
  );
}
