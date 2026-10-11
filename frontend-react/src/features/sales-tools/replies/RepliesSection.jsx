import React, { useState } from 'react';
import { Inbox, BarChart3 } from 'lucide-react';
import { Tabs } from '../../../components/ui/Tabs';
import { InboxTab } from './InboxTab';
import { ReportTab } from './ReportTab';

const TABS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'report', label: 'Report', icon: BarChart3 },
];

/** Sales Tools → Replies: team-wide Instantly replies inbox + report.
 *  Role-gated by SalesToolsHub (the tab is hidden), and by the server (403). */
export function RepliesSection() {
  const [tab, setTab] = useState('inbox');
  return (
    <div className="space-y-4">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'inbox' ? <InboxTab /> : <ReportTab />}
    </div>
  );
}
