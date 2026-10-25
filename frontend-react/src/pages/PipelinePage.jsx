import React, { useState, useEffect } from 'react';
import { SandboxStore, PIPELINE_STAGES } from '../services/sandboxStore';
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
    if (currentIndex < PIPELINE_STAGES.length - 1) {
      const nextStage = PIPELINE_STAGES[currentIndex + 1];
      SandboxStore.moveLeadStage(leadId, nextStage);
    }
  };

  return (
    <div className="p-8 max-w-full space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Enterprise Pipeline Kanban
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Visual revenue velocity. Click the advance arrow on any card to simulate deal progression.
          </p>
        </div>
        <div className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
          5 Active Stages
        </div>
      </div>

      {/* Kanban Board Columns */}
      <div className="flex gap-5 overflow-x-auto pb-4 items-start">
        {PIPELINE_STAGES.map((stage) => {
          const stageLeads = leads.filter(l => l.stage === stage);
          const stageArr = stageLeads.reduce((acc, l) => {
            return acc + parseInt(l.arr?.replace(/[^0-9]/g, '') || '0', 10);
          }, 0);

          return (
            <div
              key={stage}
              className="w-72 flex-shrink-0 bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 space-y-4"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                    {stage}
                  </h3>
                  <div className="text-[11px] font-bold text-indigo-500 font-mono mt-0.5">
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
                  <div className="p-4 text-center text-slate-400 text-xs italic">
                    No deals in stage
                  </div>
                ) : (
                  stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:shadow-md transition-all space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <Link
                            to={`/lead/${lead.id}`}
                            className="font-bold text-xs text-slate-900 dark:text-white hover:text-indigo-600 block"
                          >
                            {lead.company}
                          </Link>
                          <div className="text-[11px] text-slate-500">{lead.name}</div>
                        </div>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                          {lead.priority_score}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/60">
                        <span className="text-xs font-bold text-slate-900 dark:text-white font-mono">
                          {lead.arr}
                        </span>
                        {PIPELINE_STAGES.indexOf(stage) < PIPELINE_STAGES.length - 1 && (
                          <button
                            onClick={() => handleAdvanceStage(lead.id, stage)}
                            className="p-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-all text-xs font-semibold flex items-center gap-1"
                            title="Advance to Next Stage"
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
      </div>
    </div>
  );
}
