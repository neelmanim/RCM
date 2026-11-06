import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useModules } from '../core/modules/useModules';
import { PIPELINE_STAGES, SandboxStore } from '../services/sandboxStore';
import { BarChart3, TrendingUp, ArrowUpRight, ChevronRight } from 'lucide-react';

export default function PipelineAnalyticsPage() {
  const { isInstalled } = useModules();
  const [leads, setLeads] = useState(() => SandboxStore.getLeads());

  useEffect(() => {
    const refresh = () => setLeads(SandboxStore.getLeads());
    window.addEventListener('crm:sandbox-updated', refresh);
    window.addEventListener('crm:sandbox-reset', refresh);
    return () => {
      window.removeEventListener('crm:sandbox-updated', refresh);
      window.removeEventListener('crm:sandbox-reset', refresh);
    };
  }, []);

  const totalArr = leads.reduce((acc, l) => {
    const val = parseInt(l.arr?.replace(/[^0-9]/g, '') || '0', 10);
    return acc + val;
  }, 0);

  const avgDeal = leads.length > 0 ? Math.round(totalArr / leads.length) : 0;

  const stageColors = {
    'Meeting Booked': { bg: 'bg-indigo-500', text: 'text-indigo-400', border: 'border-indigo-500/30' },
    'Proposal Sent': { bg: 'bg-sky-500', text: 'text-sky-400', border: 'border-sky-500/30' },
    'Contacted': { bg: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/30' },
    'Closed Won': { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  };

  return (
    <div className="crm-page space-y-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/60 dark:border-white/5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">
              Revenue Intelligence
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Pipeline analytics
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time deal distribution, stage velocity, and conversion probability across active accounts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/pipeline"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-1.5"
          >
            <span>Open pipeline kanban</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {isInstalled('analytics') ? (
        <div className="space-y-6">
          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="crm-panel p-5 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Pipeline Value</span>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                ${(totalArr / 1000000).toFixed(2)}M
              </div>
              <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> +18.4% velocity
              </span>
            </div>

            <div className="crm-panel p-5 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tracked Accounts</span>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                {leads.length}
              </div>
              <span className="text-[11px] text-slate-400">Active pipeline deals</span>
            </div>

            <div className="crm-panel p-5 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Average Deal Size</span>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                ${Math.round(avgDeal / 1000)}k
              </div>
              <span className="text-[11px] text-slate-400">Across enterprise tiers</span>
            </div>

            <div className="crm-panel p-5 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Historical Win Rate</span>
              <div className="text-2xl sm:text-3xl font-black text-emerald-500 dark:text-emerald-400 font-mono">
                24.2%
              </div>
              <span className="text-[11px] text-slate-400">SDR to Closed Won</span>
            </div>
          </div>

          {/* Stage Distribution Breakdown */}
          <section aria-labelledby="stage-distribution" className="crm-panel p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-white/5">
              <div>
                <h2 id="stage-distribution" className="text-base font-bold text-slate-900 dark:text-white">
                  Deals by pipeline stage
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Interactive distribution across {PIPELINE_STAGES.length} verified stages. Move deals in the Kanban board to see telemetry update.
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-lg border border-indigo-500/20">
                Live State Synchronized
              </span>
            </div>

            <div className="space-y-4">
              {PIPELINE_STAGES.map(stage => {
                const stageLeads = leads.filter(l => l.stage === stage);
                const stageArr = stageLeads.reduce((acc, l) => acc + parseInt(l.arr?.replace(/[^0-9]/g, '') || '0', 10), 0);
                const percent = leads.length > 0 ? (stageLeads.length / leads.length) * 100 : 0;
                const style = stageColors[stage] || { bg: 'bg-indigo-500', text: 'text-indigo-400', border: 'border-indigo-500/30' };

                return (
                  <div key={stage} className="space-y-1.5 p-3 rounded-xl bg-slate-50/50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${style.bg}`} />
                        <span className="font-bold text-slate-900 dark:text-white">{stage}</span>
                        <span className="text-[11px] text-slate-400">({stageLeads.length} account{stageLeads.length === 1 ? '' : 's'})</span>
                      </div>
                      <div className="flex items-center gap-4 font-mono">
                        <span className="font-bold text-slate-900 dark:text-white">${stageArr.toLocaleString()}</span>
                        <span className="text-slate-400 text-[11px]">{percent.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${style.bg} rounded-full transition-all duration-500`}
                        style={{ width: `${Math.max(percent, 6)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
        <div className="crm-panel p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">Analytics Module Disabled</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Enable the Pipeline Analytics module in the workspace catalog to activate deal velocity tracking and stage metrics.
          </p>
          <Link
            to="/app-store"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500"
          >
            <span>Open module catalog</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
