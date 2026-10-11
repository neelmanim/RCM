import React, { useEffect, useState } from 'react';
import { Inbox, Users, ListChecks, Newspaper } from 'lucide-react';
import { Tabs } from '../../components/ui/Tabs';
import { InboxTab } from './InboxTab';
import { PortfolioTab } from './PortfolioTab';
import { PlaybooksTab } from './PlaybooksTab';
import { DigestTab } from './DigestTab';
import { AccountDetail } from './AccountDetail';
import { CsmPortalTour } from './CsmPortalTour';
import { isAdminRole } from '../../utils/roles';
import { getGreeting, getFirstName } from '../../utils/greeting';

const SECTION_TABS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox, greeting: 'Accounts that need you today — worst health first.' },
  { key: 'portfolio', label: 'Portfolio', icon: Users, greeting: 'Your full account list — health, ARR, and renewals.' },
  { key: 'playbooks', label: 'Playbooks', icon: ListChecks, greeting: 'Plays worth acting on across your accounts.' },
  { key: 'digest', label: 'Digest', icon: Newspaper, greeting: 'Your weekly roll-up.' },
];

/**
 * Props from the Vanilla JS shell (see hub-entry.jsx):
 *   userRole  {string}  'Super Admin' | 'Admin' | 'CSM' — drives copy/which
 *                       controls render; the backend (require_admin_or_csm +
 *                       its own scoping) is the real access boundary.
 *   apiBase   {string}  backend origin (consumed by hub-entry/api.js)
 *   initialAccountId {string}  deep-link straight into an account's detail
 *                       (the global search's Accounts group, or an
 *                       admin-oversight handoff) instead of just landing on
 *                       whichever section is active.
 *   section   {string}  one of 'inbox'|'portfolio'|'playbooks'|'digest' —
 *                       set only when mounted from one of a CSM's own flat
 *                       top-level nav items (NavSidebar.jsx's csm-inbox/
 *                       csm-portfolio/csm-playbooks/csm-digest routes).
 *                       Pins the active section and hides the internal tab
 *                       strip: a CSM's own sidebar IS the section switcher
 *                       now, so a second one here would be a redundant
 *                       nested nav (see 2026-09-16 product direction — CSM's
 *                       four sections should "come outside" as their own
 *                       nav items, not live inside one wrapper page).
 *                       Omitted for the Super-Admin-only merged Pipeline hub
 *                       (PipelineHub.jsx), which keeps the tab strip so an
 *                       admin can browse all 4 sections from one place.
 *   userName  {string}  only used to greet a CSM on Inbox, their landing
 *                       page — every other role gets a "Good morning, {name}"
 *                       greeting on Dashboard (their own landing page); CSM
 *                       had none at all until this was added (2026-09-16).
 *
 * CSM Portal Beta (Phase 2) — a CSM's account portfolio: at-risk queue,
 * full list, the 4 buildable playbooks, weekly digest, and an Account 360
 * drill-down. See .claude/plans/i-was-working-on-idempotent-ritchie.md.
 */
export function CsmPortalHub({ userRole, initialAccountId, section, userName }) {
  const isAdmin = isAdminRole(userRole);
  // Pod Admin (2026-09-17: a CSM manager's read-only oversight of her pod's
  // CSMs) is one of isAdminRole's roles too, so it shares the multi-CSM
  // filter dropdown — but bulk-assign is still Super-Admin-only backend-side
  // (bulk_assign_accounts checks csm_portal_routes._ADMIN_ROLES, which
  // excludes Pod Admin), so the UI for it needs its own, narrower check.
  const canBulkAssign = ['super admin', 'admin'].includes((userRole || '').toLowerCase());
  const flat = !!section;
  const [active, setActive] = useState(section || SECTION_TABS[0].key);
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId || null);

  // Re-fires only when a NEW account id comes in via a fresh search click —
  // not on every navigate() re-render with the same value, so closing the
  // drawer (onBack) doesn't immediately reopen it.
  useEffect(() => {
    if (initialAccountId) setSelectedAccountId(initialAccountId);
  }, [initialAccountId]);

  // A CSM switching between their flat nav items (Inbox -> Portfolio, say)
  // re-mounts this island with a new `section` prop — follow it.
  useEffect(() => {
    if (section) setActive(section);
  }, [section]);

  const activeTab = SECTION_TABS.find((t) => t.key === active) || SECTION_TABS[0];

  return (
    <div className="csm-portal-hub min-h-full bg-slate-50">
      {selectedAccountId ? (
        <AccountDetail accountId={selectedAccountId} onBack={() => setSelectedAccountId(null)} />
      ) : (
        <>
          <CsmPortalTour section={section} />
          <div className="px-6 pt-6">
            <div data-tour="csm-portal-header">
              {section === 'inbox' && userName && (
                <p className="text-sm font-semibold text-slate-400 m-0 mb-1">
                  {getGreeting()}, {getFirstName(userName)} 👋
                </p>
              )}
              <h1 className="text-xl font-bold text-slate-900 m-0">{flat ? activeTab.label : 'CSM Portal'}</h1>
              <p className="text-sm text-slate-500 mt-1 mb-4">
                {flat
                  ? activeTab.greeting
                  : (isAdmin
                    ? 'Every customer account across the org — assign, track health, and act on playbooks.'
                    : 'Your account portfolio — health, renewals, and the playbooks worth acting on today.')}
              </p>
            </div>
            {!flat && (
              <div data-tour="csm-portal-tabs">
                <Tabs tabs={SECTION_TABS} active={active} onChange={setActive} />
              </div>
            )}
          </div>
          <div className="p-6">
            {active === 'inbox' && <InboxTab isAdmin={isAdmin} onOpenAccount={setSelectedAccountId} />}
            {active === 'portfolio' && <PortfolioTab isAdmin={isAdmin} canBulkAssign={canBulkAssign} onOpenAccount={setSelectedAccountId} />}
            {active === 'playbooks' && <PlaybooksTab isAdmin={isAdmin} onOpenAccount={setSelectedAccountId} />}
            {active === 'digest' && <DigestTab />}
          </div>
        </>
      )}
    </div>
  );
}
