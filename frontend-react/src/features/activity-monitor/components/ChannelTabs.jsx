import React from 'react';
import { Phone, Mail, MessageSquare } from 'lucide-react';
import { Tabs } from '../../../components/ui/Tabs';
import { CHANNEL_TABS } from '../constants';

const TAB_ICON = { calls: Phone, email: Mail, messages: MessageSquare };

export function ChannelTabs({ active, onChange }) {
  const tabs = CHANNEL_TABS.map((t) => ({ ...t, icon: TAB_ICON[t.key] }));
  return <Tabs tabs={tabs} active={active} onChange={onChange} className="mb-5" />;
}
