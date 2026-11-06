import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { AVAILABLE_MODULES } from '../core/modules/ModuleRegistry';

export default function ModulePreviewPage() {
  const { moduleId } = useParams();
  const module = AVAILABLE_MODULES.find(item => item.id === moduleId && item.status === 'preview');
  return (
    <div className="crm-page space-y-6">
      <Link to="/app-store" className="crm-link">← Module catalog</Link>
      <section className="crm-panel p-6 sm:p-8 space-y-4 max-w-2xl">
        <span className="crm-badge">Planned · Not connected</span>
        <h1 className="text-2xl font-bold">{module?.name || 'Module not found'}</h1>
        <p className="text-slate-600 dark:text-slate-300">{module?.description || 'Choose a module from the catalog to continue.'}</p>
        {module && <>
          <h2 className="text-lg font-semibold">What is available today?</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">The CRM demo supports sample accounts, notes, pipeline stages and call-outcome simulation. Voice, SMS and WhatsApp are provider-agnostic placeholders. No messages are sent and no real calls are placed.</p>
          <h2 className="text-lg font-semibold">Before this can be connected</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">A supported provider, workspace authorization and a verified connection flow are needed. This preview does not accept credentials or promise a release date.</p>
          <Link to="/leads" className="crm-button inline-flex">Explore sample accounts</Link>
        </>}
      </section>
    </div>
  );
}
