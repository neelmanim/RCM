import React, { useState } from 'react';
import { Users, Phone, FileDown } from 'lucide-react';
import { Tabs } from '../../../components/ui/Tabs';
import { UsersRolesPanel } from './team-access/UsersRolesPanel';
import { UserAccessTable } from './team-access/UserAccessTable';
import { AuditLogPanel } from './AuditLogPanel';

// "User Access" is the per-user calling/messaging capability grid, ported from
// the Super-Admin-only `channels` tab of legacy settings.js — granting or
// revoking a vendor seat is not a Pod Admin power in legacy, so it stays
// Super-Admin-only now that Pod Admins can reach this section (v12.2).
const SUB_TABS = [
  { key: 'users', label: 'Users & PODs', icon: Users, roles: ['Super Admin', 'Pod Admin'] },
  { key: 'access', label: 'User Access', icon: Phone, roles: ['Super Admin'] },
  { key: 'exports', label: 'Export History', icon: FileDown, roles: ['Super Admin'] },
];

const EXPORT_KINDS = [
  { value: '', label: 'Downloads and access changes' },
  { value: 'export', label: 'Downloads only' },
  { value: 'export_access', label: 'Access changes only' },
];

/**
 * Phase 2 — Team & Access. Ported from:
 *  - frontend/js/views/admin.js (user list, role editing, POD reassignment)
 *  - frontend/js/views/settings_ai_dialer.js (the per-user calling/messaging
 *    capability grid — search/filters/pagination/drawer/toggles)
 *
 * 2026-09-03: this section briefly gained its own top-level "Lead
 * Assignments" tab, then had it removed again as unneeded.
 */
export function TeamAccessSection({ userRole }) {
  const [tab, setTab] = useState('users');
  const visibleTabs = SUB_TABS.filter((t) => t.roles.includes(userRole));
  // Guard the render too, not just the tab strip — otherwise `tab` state left
  // on a hidden key would still render that panel.
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : visibleTabs[0]?.key;

  return (
    <div>
      {/* One visible tab needs no tab strip. */}
      {visibleTabs.length > 1 && (
        <Tabs tabs={visibleTabs} active={activeTab} onChange={setTab} className="mb-5" />
      )}
      {activeTab === 'users' && <UsersRolesPanel userRole={userRole} />}
      {activeTab === 'access' && <UserAccessTable />}
      {activeTab === 'exports' && (
        <div data-tour="cc-export-history">
          <p className="text-sm text-slate-500 mb-4">
            Every CSV or Excel download, and every change to who may download, with the person and the time. Kept permanently; nothing here can be edited.
          </p>
          <AuditLogPanel category="export,export_access" kinds={EXPORT_KINDS} emptyMessage="No one has exported data yet." />
        </div>
      )}
    </div>
  );
}
