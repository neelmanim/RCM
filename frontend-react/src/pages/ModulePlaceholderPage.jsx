import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useModules } from '../core/modules/ModuleContext';
import { 
  PhoneCall, Zap, Mail, BarChart3, ShieldCheck, CheckSquare, 
  Settings, CheckCircle2, ArrowRight, Play, RefreshCw 
} from 'lucide-react';

const MODULE_CONFIGS = {
  '/dialer': {
    title: 'AI Power Dialer Command Center',
    tagline: 'Autonomous outbound calling engine with real-time transcription and dispositioning.',
    icon: PhoneCall,
    badge: 'Voice AI',
    stats: [
      { label: 'Outbound Queue', value: '18 Leads' },
      { label: 'Avg Connect Time', value: '18s' },
      { label: 'Dials Today', value: '142 Calls' },
    ],
    actionLabel: 'Start Power Dialing Queue',
  },
  '/cadences': {
    title: 'Sales Cadences & Automated Sequences',
    tagline: 'Multichannel outreach touchpoints across Email, SMS, and WhatsApp.',
    icon: Zap,
    badge: 'Automation',
    stats: [
      { label: 'Active Sequences', value: '4 Running' },
      { label: 'Enrolled Prospects', value: '184 Leads' },
      { label: 'Response Rate', value: '34.2%' },
    ],
    actionLabel: 'Create New Sequence',
  },
  '/email': {
    title: 'Omnichannel Email Hub',
    tagline: 'Two-way synced inbox with AI conversation threading and automated smart replies.',
    icon: Mail,
    badge: '2-Way Sync',
    stats: [
      { label: 'Unread Replies', value: '3 Inbound' },
      { label: 'Sent Today', value: '86 Emails' },
      { label: 'Open Rate', value: '68.5%' },
    ],
    actionLabel: 'Compose Smart Email',
  },
  '/analytics': {
    title: 'Performance & Analytics Hub',
    tagline: 'Full visibility into SDR conversion funnels, activity leaderboards, and pipeline velocity.',
    icon: BarChart3,
    badge: 'BI & KPIs',
    stats: [
      { label: 'Pipeline Velocity', value: '18 Days' },
      { label: 'Team Connect Rate', value: '28.4%' },
      { label: 'Quota Attainment', value: '114%' },
    ],
    actionLabel: 'Export Executive Digest',
  },
  '/csm': {
    title: 'CSM & Account Health Portal',
    tagline: 'Customer success retention monitoring, contract renewals, and churn risk scoring.',
    icon: ShieldCheck,
    badge: 'Retention',
    stats: [
      { label: 'Accounts Monitored', value: '42 Clients' },
      { label: 'Avg Health Score', value: '91 / 100' },
      { label: 'Upcoming Renewals', value: '$420,000' },
    ],
    actionLabel: 'Run Account Health Audit',
  },
  '/tasks': {
    title: 'Tasks & Activity Command Center',
    tagline: 'Prioritized daily action items and scheduled prospect follow-ups.',
    icon: CheckSquare,
    badge: 'Productivity',
    stats: [
      { label: 'Pending Tasks', value: '7 Due Today' },
      { label: 'Completed', value: '14 Today' },
      { label: 'Follow-ups Queued', value: '9 Accounts' },
    ],
    actionLabel: 'Add New Task',
  },
  '/settings': {
    title: 'Workspace & Security Settings',
    tagline: 'Global configuration, team permissions, API webhooks, and identity management.',
    icon: Settings,
    badge: 'System Admin',
    stats: [
      { label: 'Active Seats', value: '8 / 10' },
      { label: 'API Security', value: 'SOC-2 Ready' },
      { label: 'Hosting Tier', value: 'Enterprise' },
    ],
    actionLabel: 'Save Workspace Settings',
  },
};

export default function ModulePlaceholderPage() {
  const location = useLocation();
  const config = MODULE_CONFIGS[location.pathname] || MODULE_CONFIGS['/dialer'];
  const Icon = config.icon;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Icon className="w-5 h-5" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {config.badge}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {config.title}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            {config.tagline}
          </p>
        </div>

        <button className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-sm shadow-indigo-600/30 transition-all flex items-center gap-2">
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{config.actionLabel}</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {config.stats.map((st, idx) => (
          <div
            key={idx}
            className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2"
          >
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {st.label}
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white font-mono">
              {st.value}
            </div>
          </div>
        ))}
      </div>

      {/* Interactive Simulation Feed */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Real-time Module Telemetry
          </h3>
          <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Sync Active
          </span>
        </div>

        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">Telemetry Engine Connected</div>
                <div className="text-[11px] text-slate-500">Listening to conversation events across active enterprise leads.</div>
              </div>
            </div>
            <span className="text-xs text-slate-400 font-mono">Just now</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-indigo-400" />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">Bi-directional CRM Synchronization</div>
                <div className="text-[11px] text-slate-500">Changes in this module automatically reflect in Lead Records and Kanban Pipeline.</div>
              </div>
            </div>
            <span className="text-xs text-slate-400 font-mono">2m ago</span>
          </div>
        </div>
      </div>
    </div>
  );
}
