import React, { useState, useEffect } from 'react';
import { SandboxStore, PIPELINE_STAGES, summarizePipeline, formatCurrency } from '../services/sandboxStore';
import { Link } from 'react-router-dom';
import { ChevronRight, DollarSign, Sparkles } from 'lucide-react';

export default function PipelinePage() {
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

  const handleAdvanceStage = (leadId, currentStage) => {
    const currentIndex = PIPELINE_STAGES.indexOf(currentStage);
    if (currentIndex >= 0 && currentIndex < PIPELINE_STAGES.length - 1) {
      const nextStage = PIPELINE_STAGES[currentIndex + 1];
      SandboxStore.moveLeadStage(leadId, nextStage);
    }
  };

  const summary = summarizePipeline(leads);

  return (
    <div className="crm-page space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Pipeline
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Review deal stages and move sample deals through the pipeline.
          </p>
        </div>
        <div className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
          {summary.stages.length} stages · {formatCurrency(summary.total)}
        </div>
      </div>

      {/* Kanban Board Columns */}
      <section aria-label="Pipeline stages" tabIndex={0} className="flex gap-3 overflow-x-auto pb-4 items-start [-webkit-overflow-scrolling:touch]">
        {summary.stages.map(({ label: stage, value: stageArr }) => {
          const stageLeads = leads.filter(l => (l.stage || 'Unassigned') === stage);


          return (
            <div
              key={stage}
              className="w-64 shrink-0 bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 space-y-4"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                    {stage}
                  </h3>
                  <div className="text-[11px] font-bold text-lime-800 font-mono mt-0.5">
                    ${stageArr.toLocaleString()}
                  </div>
                </div>
                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-[10px]">
                  {stageLeads.length}
                </span>
              </div>

              {/* Cards in Column */}
              <div className="space-y-3 min-h-[400px]">
                {stageLeads.length === 0 ? (
                  <div className="p-4 text-center text-slate-600 dark:text-slate-400 text-xs italic">
                    No deals in stage
                  </div>
                ) : (
                  stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="crm-panel p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <Link
                            to={`/lead/${lead.id}`}
                            className="font-bold text-xs text-slate-900 dark:text-white hover:text-lime-800 block"
                          >
                            {lead.company}
                          </Link>
                          <div className="text-[11px] text-slate-500">{lead.name}</div>
                        </div>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-lime-50 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 border border-lime-200 dark:border-lime-800">
                          {lead.priority_score}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/60">
                        <span className="text-xs font-bold text-slate-900 dark:text-white font-mono">
                          {lead.arr}
                        </span>
                        {PIPELINE_STAGES.includes(stage) && PIPELINE_STAGES.indexOf(stage) < PIPELINE_STAGES.length - 1 && (
                          <button
                            onClick={() => handleAdvanceStage(lead.id, stage)}
                            className="p-1 rounded-lg bg-lime-50 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 hover:bg-lime-100 dark:hover:bg-lime-900 transition-all text-xs font-semibold flex items-center gap-1"
                            aria-label={`Advance ${lead.company} to ${PIPELINE_STAGES[PIPELINE_STAGES.indexOf(stage) + 1]}`}
                          >
                            <span className="text-[10px]">Advance</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
