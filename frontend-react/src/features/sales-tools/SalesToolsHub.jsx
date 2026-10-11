import React, { useState, useEffect } from 'react';
import { Workflow, Send, MessagesSquare, MailCheck } from 'lucide-react';
import { Tabs } from '../../components/ui/Tabs';
import { SalesJourneyHub } from '../sales-journey/SalesJourneyHub';
import { CampaignsSection } from './CampaignsSection';
import { SmsCampaignsSection } from './SmsCampaignsSection';
import { SalesToolsTour } from './SalesToolsTour';
import { RepliesSection } from './replies/RepliesSection';
import { isAdminRole, canSeeReplies } from '../../utils/roles';

const SECTION_TABS = [
  { key: 'cadence', label: 'Cadence', icon: Workflow },
  { key: 'campaigns', label: 'Email Campaigns', icon: Send },
  { key: 'sms-campaigns', label: 'SMS Campaigns', icon: MessagesSquare },
  { key: 'replies', label: 'Replies', icon: MailCheck },
];

// #sales-tools/replies selects the Replies tab instead of naming a cadence.
const REPLIES_HASH = 'replies';

/**
 * Props from the Vanilla JS shell (mirrors control-center-entry.jsx's contract):
 *   userRole, apiBase, journeyId (optional — from the #sales-tools/{id} hash,
 *   deep-links straight into that cadence in the Cadence tab)
 *
 * Umbrella hub for "reach out to leads at scale" tools — supersedes the
 * standalone Sales Cadence nav entry (frontend/js/app.js, NavSidebar.jsx).
 * Cadence (Sales Journey) is embedded here completely unchanged — it just
 * gets a new parent instead of being the top-level mounted root; Campaigns
 * (bulk email) is new, see .claude/plans/i-was-working-on-idempotent-ritchie.md.
 *
 * Cadence is visible to every role. Any role can build cadences; each one
 * is editable only by its owner (or a Super Admin) and read-only for everyone else.
 */
export function SalesToolsHub({ userRole, journeyId: routeExtra = null }) {
  const isAdmin = isAdminRole(userRole);
  const repliesAllowed = canSeeReplies(userRole);
  const wantsReplies = routeExtra === REPLIES_HASH && repliesAllowed;
  const journeyId = routeExtra === REPLIES_HASH ? null : routeExtra;
  const tabs = repliesAllowed ? SECTION_TABS : SECTION_TABS.filter((t) => t.key !== 'replies');
  // A #sales-tools/{journeyId} deep link always means the Cadence tab,
  // regardless of whatever tab a previous visit left active.
  const [active, setActive] = useState(wantsReplies ? 'replies' : journeyId ? 'cadence' : SECTION_TABS[0].key);
  // The shell re-calls navigate() with new props while mounted (Dashboard link).
  useEffect(() => { if (wantsReplies) setActive('replies'); }, [wantsReplies]);

  return (
    <div className="salestools-hub min-h-full bg-slate-50">
      <SalesToolsTour />
      <div className="px-6 pt-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 m-0">Sales Tools</h1>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            Reach out to leads at scale — sequenced cadences and one-off email bursts.
          </p>
        </div>
        <div data-tour="sales-tools-section-tabs">
          <Tabs tabs={tabs} active={active} onChange={setActive} />
        </div>
      </div>
      {/* Kept mounted (not conditionally rendered) when switching to
          Campaigns so an in-progress, unsaved cadence edit in JourneyBuilder
          survives a tab switch and back. */}
      <div className={active === 'cadence' ? '' : 'hidden'}>
        <SalesJourneyHub isAdmin={isAdmin} openJourneyId={journeyId} />
      </div>
      {active === 'campaigns' && (
        <div className="p-6">
          <CampaignsSection userRole={userRole} />
        </div>
      )}
      {active === 'sms-campaigns' && (
        <div className="p-6 flex flex-col" style={{ minHeight: 'calc(100vh - 220px)' }}>
          <SmsCampaignsSection />
        </div>
      )}
      {active === 'replies' && repliesAllowed && (
        <div className="p-6">
          <RepliesSection />
        </div>
      )}
    </div>
  );
}
