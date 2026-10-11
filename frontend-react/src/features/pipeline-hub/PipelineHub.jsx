import React, { useState } from 'react';
import { Briefcase, Heart } from 'lucide-react';
import { Tabs } from '../../components/ui/Tabs';
import { AEPipelineHub } from '../ae-pipeline/AEPipelineHub';
import { CsmPortalHub } from '../csm-portal/CsmPortalHub';

const TABS = [
  { key: 'ae', label: 'AE Pipeline', icon: Briefcase },
  { key: 'csm', label: 'CSM Portal', icon: Heart },
];

/**
 * Super-Admin-only merge of AE Pipeline + CSM Portal into one nav item with
 * a tab for each (2026-09-16 product direction: "the both the items should
 * be merged as they have a tab for themselves? don't you think?"). Reuses
 * the exact same <AEPipelineHub>/<CsmPortalHub> components an AE's/CSM's own
 * standalone nav item mounts — a real merge of the two existing islands,
 * not a third re-implementation. See NavSidebar.jsx's 'pipeline-hub' item
 * (Super Admin only) and app.js's matching router branch.
 *
 * Props from the Vanilla JS shell:
 *   userRole  {string}  always 'Super Admin' in practice — gated to that
 *             role both here (defensively) and in NavSidebar.jsx/app.js.
 *   initialAccountId {string}  deep-link from the global account search —
 *             opens straight on the CSM Portal tab, into that account.
 *
 * No dedicated tour component here — the tab switcher is explained by a
 * step AEPipelineTour already carries (targets `pipeline-hub-tabs` above,
 * and simply skips for AE's own standalone view where that element doesn't
 * exist). A separate PipelineHub-level tour would mount and go active at
 * the same time as AEPipelineHub's own tour (the default tab), stacking two
 * GuidedTour overlays on a Super Admin's first visit — reusing the one
 * instance avoids that collision entirely instead of sequencing around it.
 */
export function PipelineHub({ userRole, initialAccountId }) {
  const [active, setActive] = useState(initialAccountId ? 'csm' : 'ae');

  return (
    <div className="pipeline-hub min-h-full bg-slate-50">
      <div className="px-6 pt-6 bg-white border-b border-slate-200" data-tour="pipeline-hub-tabs">
        <Tabs tabs={TABS} active={active} onChange={setActive} />
      </div>
      {active === 'ae' && <AEPipelineHub />}
      {active === 'csm' && (
        <CsmPortalHub userRole={userRole || 'Super Admin'} initialAccountId={initialAccountId} />
      )}
    </div>
  );
}
