import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { useModules } from '../../core/modules/useModules';

export default function AppStoreView() {
  const { availableModules, isInstalled, toggleModule } = useModules();

  return (
    <div className="crm-page space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Module catalog</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Enable optional features for this demo workspace.
        </p>
      </header>

      {availableModules.map(module => {
        const enabled = isInstalled(module.id);

        return (
          <section key={module.id} className="crm-panel space-y-4 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <BarChart3 aria-hidden="true" className="h-5 w-5 text-indigo-500" />
              {module.name}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">{module.description}</p>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                aria-pressed={enabled}
                onClick={() => toggleModule(module.id)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                {enabled ? 'Disable' : 'Enable'}
              </button>
              <span role="status" className="text-sm text-slate-600 dark:text-slate-300">
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
              {enabled && (
                <Link to={module.route} className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                  Open {module.name.toLowerCase()}
                </Link>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
