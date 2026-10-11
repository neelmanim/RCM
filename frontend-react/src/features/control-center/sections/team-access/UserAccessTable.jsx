import React, { useMemo, useState } from 'react';
import { Pencil, XCircle, UserPlus, Phone, MessageSquare } from 'lucide-react';
import { Avatar } from '../../../../components/ui/Avatar';
import { Button } from '../../../../components/ui/Button';
import { Select } from '../../../../components/ui/Select';
import { SearchInput } from '../../../../components/ui/SearchInput';
import { Pagination } from '../../../../components/ui/Pagination';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { SkeletonTable } from '../../../../components/ui/Skeleton';
import { ConfirmDialog } from '../../../../components/ui/Modal';
import { CapabilityToggles } from './CapabilityToggles';
import { AssignAlternateMessenger } from './AssignAlternateMessenger';
import { useUserAccessData } from './useUserAccessData';

const PAGE_SIZE = 5; // matches legacy `_uaState = { page: 1, pageSize: 5 }`

const CALL_FILTER_OPTIONS = [
  { value: '', label: 'Calling: any' },
  { value: 'aircall', label: 'Calling: Aircall' },
  { value: 'messenger', label: 'Calling: Alternate Messenger' },
  { value: 'none', label: 'Calling: None' },
];
const MSG_FILTER_OPTIONS = [
  { value: '', label: 'Messaging: any' },
  { value: 'aircall', label: 'Messaging: Aircall' },
  { value: 'messenger', label: 'Messaging: Alternate Messenger' },
  { value: 'none', label: 'Messaging: None' },
];
const CAP_OPTIONS = [
  { value: '', label: 'Capability: any' },
  { value: 'dialer_enabled', label: 'Has Calling granted' },
  { value: 'sms_enabled', label: 'Has SMS granted' },
  { value: 'whatsapp_enabled', label: 'Has WhatsApp granted' },
];
const AGENT_OPTIONS = [
  { value: '', label: 'Alternate Messenger agent ID: any' },
  { value: 'yes', label: 'Has Alternate Messenger agent ID' },
  { value: 'no', label: 'No Alternate Messenger agent ID' },
];

// Ported from settings_ai_dialer.js's User Access grid: search + 4 filter
// selects (_filteredUserAccessList), 5-per-page pagination
// (_renderUserAccessPage/_uaState), the Assign/Edit drawer, and per-row
// capability toggles.
export function UserAccessTable() {
  const { sdrs, loading, error, saveUserSettings } = useUserAccessData();
  const [search, setSearch] = useState('');
  const [callFilter, setCallFilter] = useState('');
  const [msgFilter, setMsgFilter] = useState('');
  const [capFilter, setCapFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(null); // { mode: 'add'|'edit', targetUser? }
  const [pendingClear, setPendingClear] = useState(null); // user
  const [clearError, setClearError] = useState('');

  const resetPage = (setter) => (v) => { setter(v); setPage(1); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sdrs.filter((sdr) => {
      if (q) {
        const name = (sdr.name || '').toLowerCase();
        const email = (sdr.email || '').toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      if (callFilter && (sdr.effective_dialer_provider || 'none') !== callFilter) return false;
      if (msgFilter && (sdr.effective_messaging_provider || 'none') !== msgFilter) return false;
      if (capFilter && !sdr[capFilter]) return false;
      if (agentFilter === 'yes' && !sdr.messenger_user_id) return false;
      if (agentFilter === 'no' && sdr.messenger_user_id) return false;
      return true;
    });
  }, [sdrs, search, callFilter, msgFilter, capFilter, agentFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const withAgent = sdrs.filter((s) => s.messenger_user_id).length;

  const unassignedSdrs = useMemo(() => sdrs.filter((s) => !s.messenger_user_id), [sdrs]);

  if (loading) return <SkeletonTable rows={5} cols={4} />;
  if (error) return <EmptyState title="Couldn't load user access" message={error} />;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-bold text-slate-800">User Access</div>
          <div className="text-xs text-slate-500 mt-0.5">Who can call, SMS and WhatsApp — click a chip to grant or revoke</div>
        </div>
        <Button size="sm" onClick={() => setDrawer({ mode: 'add' })}>
          <UserPlus size={14} /> Assign Alternate Messenger Agent
        </Button>
      </div>

      <SearchInput
        value={search}
        onChange={(e) => resetPage(setSearch)(e.target.value)}
        placeholder="Search users…"
        className="mb-2 max-w-xs"
      />
      <div className="flex flex-wrap gap-2 mb-2">
        <Select value={callFilter} onChange={resetPage(setCallFilter)} options={CALL_FILTER_OPTIONS} placeholder="Calling: any" />
        <Select value={msgFilter} onChange={resetPage(setMsgFilter)} options={MSG_FILTER_OPTIONS} placeholder="Messaging: any" />
        <Select value={capFilter} onChange={resetPage(setCapFilter)} options={CAP_OPTIONS} placeholder="Capability: any" />
        <Select value={agentFilter} onChange={resetPage(setAgentFilter)} options={AGENT_OPTIONS} placeholder="Alternate Messenger agent ID: any" />
      </div>
      <div className="text-xs text-slate-400 mb-3">
        {filtered.length === sdrs.length
          ? `${sdrs.length} user${sdrs.length !== 1 ? 's' : ''} · ${withAgent} with a Alternate Messenger calling agent ID`
          : `${filtered.length} of ${sdrs.length} users match`}
      </div>

      {sdrs.length === 0 ? (
        <EmptyState title="No users yet." message='Add SDRs from Team & Access → Users first.' />
      ) : filtered.length === 0 ? (
        <EmptyState title="No users match the current search/filters." />
      ) : (
        <>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden">
            {pageItems.map((sdr) => {
              const callProv = sdr.effective_dialer_provider || 'none';
              const msgProv = sdr.effective_messaging_provider || 'none';
              const onAlternate Messenger = callProv === 'messenger' || msgProv === 'messenger' || !!sdr.messenger_user_id;
              // Avatar tint follows the messaging vendor, so the table reads at a glance (ported from settings.js's per-row gradient).
              const gradient = msgProv === 'aircall' ? 'linear-gradient(135deg,#0ea5e9,#38bdf8)' : 'linear-gradient(135deg,#7c3aed,#a78bfa)';
              return (
                <div key={sdr.id} className="p-3.5 grid gap-3 items-center" style={{ gridTemplateColumns: 'minmax(150px,1.3fr) 170px minmax(120px,1fr) auto auto' }}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={sdr.name || sdr.email} background={gradient} size={36} />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-slate-800 truncate">{sdr.name || sdr.email}</div>
                      <div className="text-xs text-slate-500 truncate">{sdr.email}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {callProv === msgProv ? (
                      // Same vendor handles both channels — one chip, not two
                      // identical-looking ones side by side (per audit: "why
                      // does messenger show up twice?").
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-100 rounded-full text-xs text-slate-600 whitespace-nowrap" title="Calling & messaging provider">
                        <Phone size={11} /><MessageSquare size={11} /> {callProv}
                      </span>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-100 rounded-full text-xs text-slate-600 whitespace-nowrap" title="Calling provider"><Phone size={11} /> {callProv}</span>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-100 rounded-full text-xs text-slate-600 whitespace-nowrap" title="Messaging provider"><MessageSquare size={11} /> {msgProv}</span>
                      </>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {onAlternate Messenger && (
                      <span className="inline-block px-2.5 py-0.5 bg-slate-100 rounded-full text-xs text-slate-600 whitespace-nowrap" title="Alternate Messenger calling agent ID — identifies this rep to Alternate Messenger for calls, not a phone number">Agent ID: {sdr.messenger_user_id || '—'}</span>
                    )}
                    {onAlternate Messenger && sdr.messenger_from_number && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-100 rounded-full text-xs text-slate-600 whitespace-nowrap" title="This rep's personal caller ID for outbound calls (voice only)"><Phone size={11} /> {sdr.messenger_from_number}</span>
                    )}
                    {sdr.messenger_whatsapp_sender_id && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-100 rounded-full text-xs text-slate-600 whitespace-nowrap" title="This rep's own SMS & WhatsApp sender — overrides the org-wide default in Settings → Alternate Messenger for this rep only"><MessageSquare size={11} /> {sdr.messenger_whatsapp_sender_id}</span>
                    )}
                  </div>
                  <CapabilityToggles user={sdr} messagingUnverified={msgProv === 'aircall'} saveUserSettings={saveUserSettings} />
                  <div className="flex gap-1 shrink-0">
                    <button type="button" title="Edit" onClick={() => setDrawer({ mode: 'edit', targetUser: sdr })} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                      <Pencil size={14} />
                    </button>
                    {onAlternate Messenger && (
                      <button type="button" title="Clear Alternate Messenger assignment" onClick={() => setPendingClear(sdr)} className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50">
                        <XCircle size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination page={currentPage} pages={totalPages} total={filtered.length} perPage={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      <AssignAlternateMessenger
        open={!!drawer}
        mode={drawer?.mode}
        targetUser={drawer?.targetUser}
        unassignedSdrs={unassignedSdrs}
        onClose={() => setDrawer(null)}
        onSave={(userId, fields) => saveUserSettings(userId, fields)}
      />

      <ConfirmDialog
        open={!!pendingClear}
        onClose={() => setPendingClear(null)}
        title="Clear Alternate Messenger assignment"
        message={pendingClear ? `Clear ${pendingClear.name || pendingClear.email}'s Alternate Messenger agent ID, caller number and sender?` : ''}
        confirmLabel="Clear"
        confirmVariant="danger"
        onConfirm={async () => {
          const user = pendingClear;
          setPendingClear(null);
          setClearError('');
          try {
            await saveUserSettings(user.id, {
              messenger_user_id: null,
              messenger_from_number: null,
              messenger_email: null,
              messenger_whatsapp_sender_id: null,
            });
          } catch (e) {
            setClearError(e.message || 'Failed to clear.');
          }
        }}
      />
      {clearError && (
        <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{clearError}</div>
      )}
    </div>
  );
}
