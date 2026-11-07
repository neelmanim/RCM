import React, { useState, useEffect } from 'react';
import { SandboxStore, summarizePipeline, formatCurrency } from '../services/sandboxStore';
import { Link } from 'react-router-dom';
import {
  TrendingUp, PhoneCall, Calendar, Users,
  ArrowUpRight, ChevronRight, BarChart3,
  ShieldCheck, Zap, Sparkles
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

  const summary = summarizePipeline(leads);

  const kpis = [
    {
      label: 'Estimated deal value',
      value: formatCurrency(summary.total),
      change: 'All sample pipeline stages',
      icon: TrendingUp,
      iconWrap: 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20'
    },
    {
      label: 'Tracked accounts',
      value: String(summary.count),
      change: 'Sample accounts in CRM',
      icon: Users,
      iconWrap: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border border-indigo-500/20'
    },
    {
      label: 'Meetings Booked',
      value: String(summary.meetings),
      change: 'Accounts in meeting stage',
      icon: Calendar,
      iconWrap: 'bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20'
    },
    {
      label: 'Simulated Call Logs',
      value: String(summary.calls),
      change: 'Logged in this demo',
      icon: PhoneCall,
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
      case 'New Inbound':
        return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30';
      default:
        return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
    }
  };

  const stageColorMap = {
    'New Inbound': 'bg-blue-500',
    'Contacted': 'bg-amber-500',
    'Meeting Booked': 'bg-indigo-500',
    'Proposal Sent': 'bg-sky-500',
    'Closed Won': 'bg-emerald-500',
  };

  // Sort by illustrative priority score
  const priorities = [...leads]
    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
    .slice(0, 4);

  return (
    <div className="crm-page space-y-7">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/60 dark:border-white/5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">
              Sample Workspace
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Workspace overview
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Review sample accounts, track deal stages, and explore modular CRM workflows.
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
            <span>Browse accounts</span>
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
              <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight font-mono">
                {kpi.value}
              </div>
              <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <span>{kpi.change}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column: High Priority Sample Accounts */}
        <div className="lg:col-span-2 crm-panel p-6 space-y-5 shadow-sm dark:shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Priority accounts
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  Sample Priority
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Top sample accounts sorted by illustrative priority score.
              </p>
            </div>
            <Link to="/leads" className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {priorities.map((lead) => (
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

                <div className="flex items-center gap-3 self-end sm:self-auto">
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

        {/* Right Column: Pipeline Telemetry & Modules */}
        <div className="space-y-6">
          {/* Pipeline Breakdown (Reconciled with SandboxStore) */}
          <div className="crm-panel p-5 space-y-4 shadow-sm dark:shadow-[0_4px_25px_rgba(0,0,0,0.3)]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Pipeline distribution
                </h4>
              </div>
              <Link to="/pipeline" className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline">
                Kanban →
              </Link>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {formatCurrency(summary.total)} across {summary.count} sample accounts.
            </p>

            <div className="space-y-2.5 pt-1">
              {summary.stages.map((st) => (
                <div key={st.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-600 dark:text-slate-300">{st.label}</span>
                    <span className="font-bold text-slate-900 dark:text-white font-mono">
                      {st.count} ({formatCurrency(st.value)})
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${stageColorMap[st.label] || 'bg-indigo-500'} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.max(st.percent, st.count > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Planned Speech-to-Intent AI Preview (Closes F06) */}
          <div className="crm-panel p-5 space-y-3 border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.03] to-indigo-500/[0.03]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-white/5">
              <div className="flex items-center gap-2 text-violet-500 dark:text-violet-400">
                <Sparkles className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Speech-to-Intent AI</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20">
                Planned preview
              </span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Explore how real-time call transcription and in-call objection battlecards are architected.
            </p>

            <Link
              to="/modules/speech-ai"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-600 dark:text-violet-400 hover:underline pt-1"
            >
              <span>View architecture preview</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Simulated Call Outcomes (Closes F05) */}
          <div className="crm-panel p-5 space-y-3 bg-gradient-to-br from-indigo-500/[0.04] to-violet-500/[0.04] border border-indigo-500/20">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <Zap className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Simulate call outcome</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Use &quot;Simulate call&quot; in the top bar to test saving an outcome on a sample account. No carrier is dialed and no audio is recorded.
            </p>
            <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Session-local state</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
