import React from 'react';
import { Link } from 'react-router-dom';
import { useModules } from '../../core/modules/useModules';

export default function AppStoreView() {
  const { availableModules, isInstalled, toggleModule } = useModules();
  return <div className="crm-page space-y-7">
    <header><p className="crm-eyebrow">Build your workspace</p><h1 className="text-2xl sm:text-3xl font-bold">Module catalog</h1><p className="text-sm text-slate-600 dark:text-slate-300 mt-2">Try pipeline analytics. Explore what planned connections will need.</p></header>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {availableModules.map(module => {
        const preview = module.status === 'preview';
        const enabled = isInstalled(module.id);
        return <section key={module.id} className="crm-panel p-6 flex flex-col gap-5">
          <span className="crm-badge self-start">{preview ? 'Planned · Not connected' : enabled ? 'Enabled in demo' : 'Disabled'}</span>
          <div className="space-y-2 flex-1"><h2 className="text-lg font-semibold">{module.name}</h2><p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{module.description}</p></div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
            {!preview && <button type="button" className="crm-button" aria-label={`${enabled ? 'Disable' : 'Enable'} ${module.name}`} aria-pressed={enabled} onClick={() => toggleModule(module.id)}>{enabled ? 'Disable' : 'Enable'}</button>}
            {(preview || enabled) && <Link className="crm-link" to={module.route}>{preview ? `Preview ${module.name}` : `Open ${module.name}`} →</Link>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
