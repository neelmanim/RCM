import React, { useState, useEffect } from 'react';
import { SandboxStore } from '../services/sandboxStore';
import { Link } from 'react-router-dom';
import {
  TrendingUp, PhoneCall, Calendar, Users,
  ArrowUpRight, ChevronRight, BarChart3,
  Layers, ShieldCheck, Zap
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
    {
      label: 'Estimated deal value',
      value: `$${(totalArr / 1000000).toFixed(2)}M`,
      rawValue: `$${totalArr.toLocaleString()}`,
      change: '+18.4% pipeline velocity',
      icon: TrendingUp,
      accent: 'emerald',
      iconWrap: 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20'
    },
    {
      label: 'Tracked accounts',
      value: leads.length.toString(),
      rawValue: `${leads.length} accounts`,
      change: 'Active in CRM',
      icon: Users,
      accent: 'indigo',
      iconWrap: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20'
    },
    {
      label: 'Meetings Booked',
      value: String(leads.filter(lead => lead.stage === 'Meeting Booked').length),
      rawValue: 'Meeting stage',
      change: 'In current sprint',
      icon: Calendar,
      accent: 'violet',
      iconWrap: 'bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20'
    },
    {
      label: 'Total Outbound Dials',
      value: String(leads.reduce((count, lead) => count + (lead.call_logs?.length ?? 0), 0)),
      rawValue: 'Dialer logs',
      change: 'Sub-200ms latency',
      icon: PhoneCall,
      accent: 'cyan',
      iconWrap: 'bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 border border-cyan-500/20'
    },
  ];

  const getStageBadge = (stage) => {
    switch (stage) {
      case 'Closed Won':
        return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
      case 'Meeting Booked':
        return 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30';
      case 'Proposal Sent':
        return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30';
      default:
        return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
    }
  };

  // Pipeline distribution calculation
  const stageStats = [
    { label: 'Meeting Booked', count: leads.filter(l => l.stage === 'Meeting Booked').length, color: 'bg-indigo-500' },
    { label: 'Proposal Sent', count: leads.filter(l => l.stage === 'Proposal Sent').length, color: 'bg-sky-500' },
    { label: 'Contacted', count: leads.filter(l => l.stage === 'Contacted').length, color: 'bg-amber-500' },
    { label: 'Closed Won', count: leads.filter(l => l.stage === 'Closed Won').length, color: 'bg-emerald-500' },
  ];

  return (
    <div className="crm-page space-y-7">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/60 dark:border-white/5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">
              Autonomous Sales Engine
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Workspace overview
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time pipeline telemetry, conversation intelligence, and priority deal velocity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/pipeline"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 hover:border-indigo-500 dark:hover:bg-white/10 hover:shadow-md transition-all flex items-center gap-1.5"
          >
            <span>Open pipeline</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            to="/leads"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-1.5"
          >
            <span>Browse leads</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Cards — Behance Glassmorphism */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              className="crm-panel p-5 space-y-3 relative overflow-hidden group hover:border-indigo-500/40 transition-all duration-300 shadow-sm dark:shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {kpi.label}
                </span>
                <div className={`p-2 rounded-xl ${kpi.iconWrap}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                {kpi.value}
              </div>
              <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <span className="font-semibold">{kpi.change}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column: High Priority Leads */}
        <div className="lg:col-span-2 crm-panel p-6 space-y-5 shadow-sm dark:shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Priority accounts
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  AI Prioritized
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Top tier inbound & outbound accounts ranked by conversion probability.
              </p>
            </div>
            <Link to="/leads" className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {leads.slice(0, 4).map((lead) => (
              <div key={lead.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group hover:bg-slate-50/50 dark:hover:bg-white/[0.02] px-2 -mx-2 rounded-xl transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 font-extrabold flex items-center justify-center text-xs shadow-sm">
                    {lead.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <Link to={`/lead/${lead.id}`} className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {lead.name}
                    </Link>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {lead.title} · <span className="font-semibold text-slate-700 dark:text-slate-300">{lead.company}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 flex-wrap self-end sm:self-auto justify-end">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white font-mono">
                    {lead.arr}
                  </span>
                  <span className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/80">
                    Score: {lead.priority_score}
                  </span>
                  <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border ${getStageBadge(lead.stage)}`}>
                    {lead.stage}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Pipeline Analytics Telemetry & Quick Action */}
        <div className="space-y-6">
          {/* Real-time Pipeline Velocity Telemetry Card */}
          <div className="crm-panel p-5 space-y-4 shadow-sm dark:shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Pipeline Telemetry
                </h4>
              </div>
              <Link to="/pipeline" className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline">
                Inspect →
              </Link>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Deal distribution across active stages ($1.42M pipeline volume).
            </p>

            {/* Stage Breakdown Bars */}
            <div className="space-y-2.5 pt-1">
              {stageStats.map((st, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-600 dark:text-slate-300">{st.label}</span>
                    <span className="font-bold text-slate-900 dark:text-white font-mono">{st.count} deal{st.count === 1 ? '' : 's'}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${st.color} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.max((st.count / leads.length) * 100, 10)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2">
              <Link
                to="/pipeline"
                className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors flex items-center justify-center gap-1.5"
              >
                <span>View Full Pipeline Kanban</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Connected Voice & WebRTC Highlight */}
          <div className="crm-panel p-5 space-y-3 bg-gradient-to-br from-indigo-500/[0.04] to-violet-500/[0.04] border border-indigo-500/20">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <Zap className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">WebRTC Power Dialer</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Click &quot;Simulate call&quot; in the top bar to test live speech coaching and automated CRM logging.
            </p>
            <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Zero-loss local state</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
