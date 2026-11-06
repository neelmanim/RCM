import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Sparkles, RefreshCw, Layers, CheckCircle2, ArrowRight } from 'lucide-react';
import { useModules } from '../../core/modules/useModules';

export default function AppStoreView() {
  const { availableModules, isInstalled, toggleModule } = useModules();

  const getModuleIcon = (id) => {
    switch (id) {
      case 'speech-ai':
        return <Sparkles className="h-5 w-5 text-violet-400" />;
      case 'sync-engine':
        return <RefreshCw className="h-5 w-5 text-emerald-400" />;
      default:
        return <BarChart3 className="h-5 w-5 text-indigo-400" />;
    }
  };

  return (
    <div className="crm-page space-y-7">
      <header className="pb-2 border-b border-slate-200/60 dark:border-white/5 space-y-1">
        <div className="flex items-center gap-2 mb-1">
          <Layers className="w-4 h-4 text-indigo-400" />
          <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">
            Modular Architecture
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Module catalog
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Activate autonomous conversation, speech intelligence, and pipeline syncing extensions.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {availableModules.map(module => {
          const enabled = isInstalled(module.id);

          return (
            <section
              key={module.id}
              className="crm-panel p-6 flex flex-col justify-between space-y-5 hover:border-indigo-500/40 transition-all duration-300"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                    {getModuleIcon(module.id)}
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                      enabled
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {enabled ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {module.name}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                    {module.description}
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-white/5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  aria-pressed={enabled}
                  onClick={() => toggleModule(module.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    enabled
                      ? 'bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30'
                  }`}
                >
                  {enabled ? 'Disable' : 'Enable'}
                </button>

                {enabled && (
                  <Link
                    to={module.route}
                    className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>Open</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
