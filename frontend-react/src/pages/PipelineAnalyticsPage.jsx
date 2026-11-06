import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useModules } from '../core/modules/useModules';
import { PIPELINE_STAGES, SandboxStore } from '../services/sandboxStore';

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

  return (
    <div className="crm-page space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Pipeline analytics</h1>
      {isInstalled('analytics') ? (
        <section aria-labelledby="stage-distribution" className="crm-panel space-y-4 p-4 sm:p-6">
          <div>
            <h2 id="stage-distribution" className="font-semibold">Deals by stage</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {leads.length} sample deals. Move a deal in the pipeline to see the counts change.
            </p>
          </div>
          <dl className="divide-y divide-slate-200 dark:divide-slate-700">
            {PIPELINE_STAGES.map(stage => (
              <div key={stage} className="flex justify-between gap-3 py-3 text-sm">
                <dt>{stage}</dt>
                <dd className="font-semibold tabular-nums">{leads.filter(lead => lead.stage === stage).length}</dd>
              </div>
            ))}
          </dl>
          <Link to="/pipeline" className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Open pipeline</Link>
        </section>
      ) : (
        <p className="crm-panel p-4 text-sm">
          Enable Analytics in the <Link to="/app-store" className="font-semibold underline">module catalog</Link>.
        </p>
      )}
    </div>
  );
}
