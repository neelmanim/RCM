import React from 'react';
import { Database, Cloud, CloudOff, Hourglass } from 'lucide-react';
import { StatStrip } from '../../../activity-monitor/components/StatStrip';

const n = (v) => (v ?? 0).toLocaleString();

// Where Alternate CRM's leads stand against Salesforce. Counts skip deleted and test leads; a lead is "in Salesforce" once it
// carries a real Salesforce Id (a lead created in Alternate CRM only has a local placeholder until it has been sent).
export function SyncOverview({ overview }) {
  if (!overview) return null;
  return (
    <div data-tour="cc-sf-overview">
      <StatStrip className="mb-2" columns="grid-cols-2 lg:grid-cols-4" tiles={[
        { label: 'Leads in Alternate CRM', value: n(overview.total), icon: Database, iconClass: 'bg-slate-100 text-slate-600' },
        { label: 'In Salesforce', value: n(overview.in_salesforce), icon: Cloud, iconClass: 'bg-emerald-50 text-emerald-600' },
        { label: 'Only in Alternate CRM', value: n(overview.only_in_alternatecrm), icon: CloudOff, iconClass: 'bg-amber-50 text-amber-600',
          caption: 'Not sent to Salesforce yet' },
        { label: 'Waiting to be sent', value: n(overview.waiting_at_push_stage), icon: Hourglass, iconClass: 'bg-blue-50 text-blue-600',
          caption: `Leads at "${overview.push_stage}" not yet in Salesforce` },
      ]} />
      <p className="text-xs text-slate-400 mb-3">Deleted and test leads are not counted.</p>
    </div>
  );
}
