import React, { useState, useEffect } from 'react';
import { SandboxStore } from '../services/sandboxStore';
import { Link } from 'react-router-dom';
import {
  TrendingUp, PhoneCall, Calendar, Users,
  ArrowUpRight, Clock, CheckCircle2, ChevronRight
} from 'lucide-react';

export default function DashboardPage() {
  const [leads, setLeads] = useState(() => SandboxStore.getLeads());

  useEffect(() => {
    const handleUpdate = () => setLeads(SandboxStore.getLeads());
    window.addEventListener('crm:sandbox-updated', handleUpdate);
    window.addEventListener('crm:sandbox-reset', handleUpdate);
    return () => {
      window.removeEventListener('crm:sandbox-updated', handleUpdate);
      window.removeEventListener('crm:sandbox-reset', handleUpdate);
    };
  }, []);

  const totalArr = leads.reduce((acc, l) => {
    const val = parseInt(l.arr?.replace(/[^0-9]/g, '') || '0', 10);
    return acc + val;
  }, 0);

  const kpis = [
    { label: 'Estimated deal value', value: `$${totalArr.toLocaleString()}`, change: 'Across sample deals', icon: TrendingUp, positive: true },
    { label: 'Tracked accounts', value: leads.length.toString(), change: 'Sample records', icon: Users, positive: true },
    { label: 'Meetings Booked', value: String(leads.filter(lead => lead.stage === 'Meeting Booked').length), change: 'In the meeting stage', icon: Calendar, positive: true },
    { label: 'Total Outbound Dials', value: String(leads.reduce((count, lead) => count + (lead.call_logs?.length ?? 0), 0)), change: 'Recorded in this demo', icon: PhoneCall, positive: true },
  ];

  return (
    <div className="crm-page space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Workspace overview
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            See what is in your pipeline and which accounts need attention.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/pipeline"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:border-indigo-500 transition-all flex items-center gap-1.5"
          >
            <span>Open pipeline</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            to="/leads"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-600/30 transition-all flex items-center gap-1.5"
          >
            <span>Browse leads</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              className="crm-panel p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {kpi.label}
                </span>
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {kpi.value}
              </div>
              <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span>{kpi.change}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dynamic Module Extension Slots */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column: High Priority Leads */}
        <div className="lg:col-span-2 crm-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Priority accounts
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Top tier inbound & outbound accounts ranked by AI priority score.
              </p>
            </div>
            <Link to="/leads" className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline">
              View All →
            </Link>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {leads.slice(0, 4).map((lead) => (
              <div key={lead.id} className="py-3.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 font-bold flex items-center justify-center text-xs">
                    {lead.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <Link to={`/lead/${lead.id}`} className="text-sm font-bold text-slate-900 dark:text-white hover:text-indigo-600">
                      {lead.name}
                    </Link>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {lead.title} · <span className="font-semibold text-slate-700 dark:text-slate-300">{lead.company}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-slate-900 dark:text-white font-mono">
                    {lead.arr}
                  </span>
                  <span className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                    Score: {lead.priority_score}
                  </span>
                  <span className="hidden sm:inline-block px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {lead.stage}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Dynamic Module Widget Slots */}
        <div className="space-y-6">
          {/* App Store Promo Card */}
          <div className="bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl p-5 space-y-2 text-center">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">
              Pipeline analytics
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Enable analytics to see sample deals by stage.
            </p>
            <Link
              to="/app-store"
              className="inline-block text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline pt-1"
            >
              Browse modules →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
