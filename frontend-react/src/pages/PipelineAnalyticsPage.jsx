import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useModules } from '../core/modules/useModules';
import { SandboxStore, summarizePipeline, formatCurrency } from '../services/sandboxStore';

export default function PipelineAnalyticsPage() {
  const { isInstalled } = useModules();
  const [leads, setLeads] = useState(() => SandboxStore.getLeads());
  useEffect(() => {
    const refresh = () => setLeads(SandboxStore.getLeads());
    window.addEventListener('crm:sandbox-updated', refresh);
    return () => window.removeEventListener('crm:sandbox-updated', refresh);
  }, []);
  const summary = summarizePipeline(leads);
  const kpis = [['Pipeline value', formatCurrency(summary.total)], ['Tracked accounts', summary.count], ['Average deal value', formatCurrency(summary.average)], ['Closed-won accounts', summary.won]];
  return <div className="crm-page space-y-7">
    <header><p className="crm-eyebrow">Sample pipeline</p><h1 className="text-2xl sm:text-3xl font-bold">Pipeline analytics</h1><p className="text-sm text-slate-600 dark:text-slate-300 mt-2">Counts and values calculated from the accounts in this demo.</p></header>
    {isInstalled('analytics') ? <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{kpis.map(([label, value]) => <section className="crm-panel p-5 space-y-3" key={label}><h2 className="text-sm text-slate-600 dark:text-slate-300">{label}</h2><p className="text-2xl font-bold">{value}</p></section>)}</div>
      <section aria-labelledby="stage-distribution" className="crm-panel p-5 sm:p-6 space-y-5"><div className="flex flex-col sm:flex-row justify-between gap-3"><div><h2 id="stage-distribution" className="text-lg font-semibold">Deals by pipeline stage</h2><p className="text-sm text-slate-600 dark:text-slate-300 mt-1">Move a deal in the pipeline to update this breakdown.</p></div><Link to="/pipeline" className="crm-link">Open pipeline →</Link></div>
        {summary.count === 0 && <p>No accounts yet. Reset the demo to restore sample data.</p>}
        {summary.stages.map(stage => <div key={stage.label} className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium">{stage.label} · {stage.count} account{stage.count === 1 ? '' : 's'}</span><span>{formatCurrency(stage.value)} · {stage.percent.toFixed(0)}%</span></div><div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-lime-500 dark:bg-lime-300" style={{width: `${stage.percent}%`}} /></div></div>)}
      </section>
    </> : <section className="crm-panel p-6 space-y-4"><h2 className="text-lg font-semibold">Pipeline analytics is disabled</h2><p className="text-sm text-slate-600 dark:text-slate-300">Enable it in the module catalog. Disabling a module does not delete your sample accounts.</p><Link to="/app-store" className="crm-button inline-flex">Open module catalog</Link></section>}
  </div>;
}
