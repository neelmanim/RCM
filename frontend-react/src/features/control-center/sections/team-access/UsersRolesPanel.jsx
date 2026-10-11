import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Eye, Users, Phone, MessageSquare, MessageCircle, ShieldOff, ShieldCheck, UserPlus, Download, Upload, UserCheck } from 'lucide-react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../../components/ui/Table';
import { SortableTableHeader } from '../../../../components/ui/SortableTableHeader';
import { useSort } from '../../../../utils/useSort';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Select } from '../../../../components/ui/Select';
import { Switch } from '../../../../components/ui/Switch';
import { Input } from '../../../../components/ui/Input';
import { SearchInput } from '../../../../components/ui/SearchInput';
import { Pagination } from '../../../../components/ui/Pagination';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { SkeletonTable } from '../../../../components/ui/Skeleton';
import { Modal, ConfirmDialog } from '../../../../components/ui/Modal';
import { Tabs } from '../../../../components/ui/Tabs';
import { AdminService } from '../../../../services/api';
import { timeAgo } from '../../../activity-monitor/lib/format';
import { useUsersRolesData } from './useUsersRolesData';
import { toast } from '../../notify';

const ROLES = ['SDR', 'AE', 'CSM', 'Pod Admin', 'Super Admin'];
const PER_PAGE = 10;


// Ported from admin.js's _activityStatus/_activityBadge.
function activityStatus(user) {
  if (!user.last_login_at) return 'never';
  const days = (Date.now() - new Date(user.last_login_at).getTime()) / 86400000;
  if (days <= 7) return 'active';
  if (days <= 30) return 'idle';
  return 'inactive';
}
const ACTIVITY_BADGE = {
  active: { variant: 'success', label: 'Active' },
  idle: { variant: 'warning', label: 'Idle' },
  inactive: { variant: 'danger', label: 'Inactive' },
  never: { variant: 'default', label: 'Never' },
};

// 2026-09-03: emoji glyphs replaced with lucide icons for consistency with
// the rest of the app's iconography (per audit). Three distinct shapes
// (Phone/MessageSquare/MessageCircle) rather than the generic single
// message-icon-plus-text-badge convention used elsewhere (MessagesTable.jsx)
// — that convention fits a labeled table column, not this compact 3-icon
// strip, where a scanning admin needs to tell the three apart by shape alone.
const CHANNEL_CHIPS = [
  { field: 'dialer_enabled', icon: Phone, name: 'Calling' },
  { field: 'sms_enabled', icon: MessageSquare, name: 'SMS' },
  { field: 'whatsapp_enabled', icon: MessageCircle, name: 'WhatsApp' },
];

export function UsersRolesPanel({ userRole }) {
  const { users, pods, loading, error, reload, patchLocal, changeRole, toggleAccess, deleteUser, reassignPod } = useUsersRolesData();
  const [search, setSearch] = useState('');
  const [podFilter, setPodFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sort, toggleSort] = useSort();
  const [page, setPage] = useState(1);
  const [pendingRole, setPendingRole] = useState(null); // { user, role }
  const [pendingDelete, setPendingDelete] = useState(null); // user
  const [pendingAccess, setPendingAccess] = useState(null); // { user, action }
  const [pendingExport, setPendingExport] = useState(null); // user — turning data export ON asks first
  const [showAddUser, setShowAddUser] = useState(false);
  const [prefillUser, setPrefillUser] = useState(null); // { name, email } from a pending access request
  const [busyId, setBusyId] = useState(null);
  const isSuperAdmin = userRole === 'Super Admin';

  // Pending access requests: someone tried to sign in with Google and isn't
  // in allowed_users yet — see backend models.AccessRequest. Granting access
  // (the Add User flow below) is the only resolution; there's no separate
  // "dismiss" since a real request should just get added.
  const [accessRequests, setAccessRequests] = useState([]);
  const loadAccessRequests = () => {
    if (isSuperAdmin) AdminService.getAccessRequests().then(setAccessRequests);
  };
  useEffect(loadAccessRequests, [isSuperAdmin]);
  // The frontend half of admin_user_routes._require_may_manage_user: a Pod
  // Admin may act only on SDR/AE members (their list is already pod-scoped
  // server-side). Their own row is role "Pod Admin", so this excludes it too.
  const canManage = (u) => isSuperAdmin || ['SDR', 'AE'].includes(u.role);
  const [actionError, setActionError] = useState('');

  const podBaseOptions = useMemo(() => pods.map((p) => ({ value: p.id, label: p.name })), [pods]);
  const podRowOptions = useMemo(() => [{ value: '', label: '— No POD —' }, ...podBaseOptions], [podBaseOptions]);
  const podFilterOptions = useMemo(() => [{ value: '', label: 'POD: All' }, ...podBaseOptions], [podBaseOptions]);
  const roleFilterOptions = useMemo(() => [{ value: '', label: 'Role: All' }, ...ROLES.map((r) => ({ value: r, label: r }))], []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (q && !(u.name || '').toLowerCase().includes(q) && !(u.email || '').toLowerCase().includes(q)) return false;
      if (podFilter && (u.pod?.id || '') !== podFilter) return false;
      if (roleFilter && u.role !== roleFilter) return false;
      return true;
    });
  }, [users, search, podFilter, roleFilter]);

  const SORT_ACCESSORS = {
    name: (u) => (u.name || u.email || '').toLowerCase(),
    last_active: (u) => u.last_login_at || '',
    pod: (u) => (u.pod?.name || '').toLowerCase(),
    role: (u) => (u.role || '').toLowerCase(),
  };
  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const accessor = SORT_ACCESSORS[sort.key];
    const rows = [...filtered].sort((a, b) => {
      const av = accessor(a), bv = accessor(b);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return sort.dir === 'desc' ? rows.reverse() : rows;
  }, [filtered, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const pageUsers = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const withBusy = async (userId, fn) => {
    setBusyId(userId);
    setActionError('');
    try {
      await fn();
    } catch (e) {
      setActionError(e.response?.data?.detail || e.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <SkeletonTable rows={6} cols={8} />;
  if (error) return <EmptyState icon={Users} title="Couldn't load users" message={error} />;

  return (
    <div>
      {/* 2026-09-03: subtitle added per audit — "what is User Access, why is
          it a separate tab from this one" — each tab now states its own
          scope so the split reads as intentional (roles/PODs/status here vs.
          calling/messaging capability grants on the User Access tab). */}
      <div className="text-xs text-slate-500 mb-3">Roles, PODs, and account status — who has access to the team, and where they sit in it.</div>

      {isSuperAdmin && accessRequests.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <p className="text-xs font-semibold text-amber-800 mb-2">
            {accessRequests.length} pending access {accessRequests.length === 1 ? 'request' : 'requests'} — signed in with Google, not yet added
          </p>
          <div className="flex flex-col gap-1.5">
            {accessRequests.map((r) => (
              <div key={r.email} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-slate-800">{r.name || r.email}</span>
                  {r.name && <span className="text-slate-400"> · {r.email}</span>}
                  <span className="text-slate-400"> · {timeAgo(r.requested_at)}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => { setPrefillUser({ name: r.name || '', email: r.email }); setShowAddUser(true); }}>
                  <UserCheck size={13} /> Add
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {actionError && (
        <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
      )}
      <div className="flex flex-wrap gap-2 mb-4 items-start justify-between">
        <div className="flex flex-wrap gap-2">
          <SearchInput
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name or email…"
            className="flex-1 min-w-[220px] max-w-xs"
          />
          <Select
            value={podFilter}
            onChange={(v) => { setPodFilter(v); setPage(1); }}
            options={podFilterOptions}
            placeholder="POD: All"
          />
          <Select
            value={roleFilter}
            onChange={(v) => { setRoleFilter(v); setPage(1); }}
            options={roleFilterOptions}
            placeholder="Role: All"
          />
        </div>
        {/* Super Admin only, matching legacy admin.js's showAddUser. */}
        {isSuperAdmin && (
          <Button size="sm" onClick={() => { setPrefillUser(null); setShowAddUser(true); }}>
            <UserPlus size={14} /> Add User
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No users match your filters." />
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <SortableTableHeader label="User" sortKey="name" sort={sort} onSort={toggleSort} />
                <SortableTableHeader label="Last Active" sortKey="last_active" sort={sort} onSort={toggleSort} title="Recent login activity — unrelated to the Access toggle in Actions" />
                <SortableTableHeader label="POD" sortKey="pod" sort={sort} onSort={toggleSort} />
                <TableHeader>Channels</TableHeader>
                <TableHeader data-tour="cc-data-export" title="Who may download CSV and Excel files. Super Admins are on by default and can be switched off; everyone else is off until switched on.">Data Export</TableHeader>
                <SortableTableHeader label="Role" sortKey="role" sort={sort} onSort={toggleSort} />
                <TableHeader>Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageUsers.map((u) => {
                const status = ACTIVITY_BADGE[activityStatus(u)];
                const busy = busyId === u.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="whitespace-normal">
                      <div className="font-semibold text-slate-800">{u.name || u.email}</div>
                      <div className="text-xs text-slate-400">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {isSuperAdmin ? (
                        <Select
                          value={u.pod?.id || ''}
                          onChange={(podId) => withBusy(u.id, async () => {
                            await reassignPod(u.id, u.pod?.id || '', podId);
                            const podName = podRowOptions.find((o) => o.value === podId)?.label || '— No POD —';
                            toast(`${u.name || u.email} moved to ${podName}.`);
                          })}
                          options={podRowOptions}
                          disabled={busy}
                        />
                      ) : (
                        <span className="text-sm text-slate-600">{u.pod?.name || '—'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex gap-1 text-sm">
                        {CHANNEL_CHIPS.map(({ field, icon: Icon, name }) => (
                          <span key={field} title={`${name}: ${u[field] ? 'granted' : 'not granted'}`} className={u[field] ? 'text-slate-600' : 'text-slate-300'}>
                            <Icon size={14} />
                          </span>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell>
                      {isSuperAdmin ? (
                        <div className="flex items-center gap-2">
                          <Switch
                            className="w-auto"
                            checked={!!u.export_enabled}
                            disabled={busy}
                            ariaLabel={`${u.export_enabled ? 'Block' : 'Allow'} ${u.name || u.email} exporting data`}
                            onChange={(e) => (e.target.checked || u.export_always
                              ? setPendingExport({ user: u, allow: e.target.checked })
                              : withBusy(u.id, async () => { const r = await AdminService.patchUserSettings(u.id, { export_enabled: false }); patchLocal(u.id, { export_enabled: r?.export_enabled ?? false }); await reload(); toast(`Export turned off for ${u.name || u.email}`); }))}
                          />
                          <span className={`text-xs font-semibold ${u.export_enabled ? 'text-emerald-700' : 'text-slate-500'}`}>{u.export_enabled ? 'On' : 'Off'}</span>
                        </div>
                      ) : (
                        <Badge variant={u.export_enabled ? 'success' : 'default'}>{u.export_enabled ? 'On' : 'Off'}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* PATCH /users/{id}/role is require_super_admin — an editable
                          dropdown for anyone else could only ever 403. */}
                      {isSuperAdmin ? (
                        <Select
                          value={u.role}
                          onChange={(role) => { if (role !== u.role) setPendingRole({ user: u, role }); }}
                          options={ROLES.map((r) => ({ value: r, label: r }))}
                          disabled={busy}
                        />
                      ) : (
                        <span className="text-sm text-slate-600">{u.role}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canManage(u) && (
                          <button
                            type="button"
                            title={u.access_allowed ? 'Revoke login access' : 'Restore login access'}
                            disabled={busy}
                            onClick={() => setPendingAccess({ user: u, action: u.access_allowed ? 'revoke' : 'grant' })}
                            className={`p-1.5 rounded-lg hover:bg-slate-100 ${u.access_allowed ? 'text-slate-400 hover:text-amber-600' : 'text-amber-500 hover:text-amber-700'}`}
                          >
                            {u.access_allowed ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                          </button>
                        )}
                        {canManage(u) && (       // Super Admin: anyone; Pod Admin: the SDRs/AEs of their own pod
                          <button
                            type="button"
                            title="View As"
                            disabled={busy}
                            onClick={() => withBusy(u.id, async () => {
                              const { token } = await AdminService.getUserToken(u.id);
                              window.open(`index.html?token=${token}`, '_blank');
                            })}
                            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
                          >
                            <Eye size={15} />
                          </button>
                        )}
                        {canManage(u) && (
                          <button
                            type="button"
                            title="Delete user"
                            onClick={() => setPendingDelete(u)}
                            className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination page={page} pages={totalPages} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={!!pendingRole}
        onClose={() => setPendingRole(null)}
        title="Change role"
        message={pendingRole ? `Change ${pendingRole.user.name || pendingRole.user.email}'s role to ${pendingRole.role}?` : ''}
        confirmLabel="Change role"
        onConfirm={async () => {
          const { user, role } = pendingRole;
          setPendingRole(null);
          await withBusy(user.id, () => changeRole(user.id, role));
        }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete user"
        message={pendingDelete ? `Permanently delete ${pendingDelete.name || pendingDelete.email}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={async () => {
          const user = pendingDelete;
          setPendingDelete(null);
          await withBusy(user.id, () => deleteUser(user.id));
        }}
      />

      <ConfirmDialog
        open={!!pendingExport}
        onClose={() => setPendingExport(null)}
        title={pendingExport?.allow ? 'Allow data export?' : 'Block data export?'}
        message={pendingExport ? (pendingExport.allow
          ? `${pendingExport.user.name || pendingExport.user.email} will be able to download CSV and Excel files of the data their role can see. Every download is recorded in the activity log. You can switch this off at any time.`
          : `${pendingExport.user.name || pendingExport.user.email} will no longer be able to download any CSV or Excel file, even though their role normally can. Scheduled reports sent in their name will go out without the CSV attachment.`) : ''}
        confirmLabel={pendingExport?.allow ? 'Allow Export' : 'Block Export'}
        onConfirm={async () => {
          const { user, allow } = pendingExport;
          setPendingExport(null);
          await withBusy(user.id, async () => {
            const r = await AdminService.patchUserSettings(user.id, { export_enabled: allow });
            patchLocal(user.id, { export_enabled: r?.export_enabled ?? allow });
            await reload();
            toast(`Export turned ${allow ? 'on' : 'off'} for ${user.name || user.email}`);
          });
        }}
      />

      <ConfirmDialog
        open={!!pendingAccess}
        onClose={() => setPendingAccess(null)}
        title={pendingAccess?.action === 'revoke' ? 'Revoke login access?' : 'Restore login access?'}
        message={pendingAccess ? (
          pendingAccess.action === 'revoke'
            ? `${pendingAccess.user.name || pendingAccess.user.email} will no longer be able to log in. This doesn't affect their calling/SMS/WhatsApp grants.`
            : `${pendingAccess.user.name || pendingAccess.user.email} will be able to log in again.`
        ) : ''}
        confirmLabel={pendingAccess?.action === 'revoke' ? 'Revoke' : 'Restore'}
        confirmVariant={pendingAccess?.action === 'revoke' ? 'danger' : 'primary'}
        onConfirm={async () => {
          const { user, action } = pendingAccess;
          setPendingAccess(null);
          await withBusy(user.id, () => toggleAccess(user.id, action));
          toast(action === 'revoke' ? `Access revoked for ${user.name || user.email}` : `Access restored for ${user.name || user.email}`);
        }}
      />

      <AddUserModal
        open={showAddUser}
        onClose={() => { setShowAddUser(false); setPrefillUser(null); }}
        pods={pods}
        prefill={prefillUser}
        onCreated={() => { reload(); loadAccessRequests(); }}
      />
    </div>
  );
}

// ── Add User — single create (parity with legacy admin.js's "+ Add User")
// plus a bulk CSV path the legacy page also had ("Upload CSV" button):
// download a template, fill it in, upload it. Both paths reuse existing
// endpoints (POST /admin/users, POST /admin/users/upload) — no new backend.
const ADD_USER_TABS = [
  { key: 'single', label: 'Single User' },
  { key: 'bulk', label: 'Bulk CSV' },
];

function AddUserModal({ open, onClose, pods, onCreated, prefill }) {
  const [tab, setTab] = useState('single');
  const [form, setForm] = useState({ name: '', email: '', role: 'SDR', pod_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [csvFile, setCsvFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const fileRef = useRef(null);

  // Opening from a pending access request seeds name/email — see
  // UsersRolesPanel's "pending access requests" card above.
  useEffect(() => {
    if (open) setForm({ name: prefill?.name || '', email: prefill?.email || '', role: 'SDR', pod_id: '' });
  }, [open, prefill]);

  const reset = () => {
    setTab('single'); setError('');
    setCsvFile(null); setBulkResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => { reset(); onClose(); };

  const downloadTemplate = () => {
    const csv = 'email,name,action\nsdr@example.com,Jane Doe,add\nformer.sdr@example.com,,remove\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users_template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const createSingle = async () => {
    setError('');
    if (!form.email.trim()) { setError('Email is required.'); return; }
    setSaving(true);
    try {
      await AdminService.createUser({
        email: form.email.trim(),
        name: form.name.trim() || undefined,
        role: form.role,
        pod_id: form.pod_id || undefined,
      });
      await onCreated();
      close();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to create user.');
    } finally {
      setSaving(false);
    }
  };

  const uploadBulk = async () => {
    if (!csvFile) { setError('Choose a CSV file first.'); return; }
    setError(''); setUploading(true);
    try {
      const text = await csvFile.text();
      const result = await AdminService.uploadUsersCsv(text);
      setBulkResult(result);
      await onCreated();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Add User">
      <Tabs tabs={ADD_USER_TABS} active={tab} onChange={setTab} className="mb-4" />

      {tab === 'single' ? (
        <div className="space-y-3">
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" containerClassName="mb-0" />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" containerClassName="mb-0" />
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Role</label>
            <Select value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: v }))} options={ROLES.map((r) => ({ value: r, label: r }))} className="w-full" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">POD (optional)</label>
            <Select
              value={form.pod_id}
              onChange={(v) => setForm((f) => ({ ...f, pod_id: v }))}
              options={[{ value: '', label: '— No POD —' }, ...pods.map((p) => ({ value: p.id, label: p.name }))]}
              className="w-full"
            />
          </div>
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={createSingle} disabled={saving}>{saving ? 'Creating…' : 'Create User'}</Button>
            <Button variant="outline" onClick={close}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Download the template, fill in one row per user (<code className="bg-slate-100 rounded px-1">action</code> is
            <code className="bg-slate-100 rounded px-1">add</code> or <code className="bg-slate-100 rounded px-1">remove</code>), then upload it here.
          </p>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download size={14} /> Download CSV Template
          </Button>
          <div>
            <input ref={fileRef} type="file" accept=".csv" onChange={(e) => { setCsvFile(e.target.files?.[0] || null); setBulkResult(null); }} className="text-sm" />
          </div>
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          {bulkResult && (
            <div className="text-xs bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2">
              Added {bulkResult.added?.length || 0}, removed {bulkResult.removed?.length || 0}, skipped {bulkResult.skipped?.length || 0}.
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={uploadBulk} disabled={uploading || !csvFile}>
              <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload CSV'}
            </Button>
            <Button variant="outline" onClick={close}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
