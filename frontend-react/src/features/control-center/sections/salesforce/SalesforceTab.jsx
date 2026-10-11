import React from 'react';
import { SalesforceConnectionCard } from './SalesforceConnectionCard';
import { SyncOverview } from './SyncOverview';
import { WhatSyncsCard } from './WhatSyncsCard';
import { ScheduleVolumeCard } from './ScheduleVolumeCard';
import { SfFieldMappingCard } from '../SfFieldMappingCard';

// Everything about Salesforce in one tab, top to bottom: are we connected, what syncs, when it runs, which extra fields go.
export function SalesforceTab({ sfInfo, isSuperAdmin, syncSettings, overview, onChanged }) {
  return (
    <div className="space-y-5">
      <SalesforceConnectionCard sfInfo={sfInfo} isSuperAdmin={isSuperAdmin} onChanged={onChanged} />
      {isSuperAdmin ? (
        <>
          <SyncOverview overview={overview} />
          <WhatSyncsCard syncSettings={syncSettings} onChanged={onChanged} />
          <ScheduleVolumeCard syncSettings={syncSettings} onChanged={onChanged} />
          <SfFieldMappingCard />
        </>
      ) : (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">Sync rules and field mapping are Super Admin only.</p>
      )}
    </div>
  );
}
