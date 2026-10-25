import React, { useState } from 'react';
import { useModules } from '../../core/modules/ModuleContext';
import { 
  PhoneCall, Zap, Mail, BarChart3, ShieldCheck, Check, 
  ExternalLink, Layers, Sparkles, AlertCircle 
} from 'lucide-react';

const ICON_MAP = {
  PhoneCall,
  Zap,
  Mail,
  BarChart3,
  ShieldCheck,
};

export default function AppStoreView() {
  const { availableModules, isInstalled, toggleModule } = useModules();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [toastMessage, setToastMessage] = useState(null);

  const categories = [
    { id: 'all', label: 'All Modules' },
    { id: 'sales', label: 'Sales Outreach' },
    { id: 'communication', label: 'Communication' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'retention', label: 'Retention & Success' },
  ];

  const filtered = selectedCategory === 'all'
    ? availableModules
    : availableModules.filter(m => m.category === selectedCategory);

  const installedCount = availableModules.filter(m => isInstalled(m.id)).length;

  const handleToggle = (module) => {
    const currentlyInstalled = isInstalled(module.id);
    toggleModule(module.id);
    const msg = currentlyInstalled
      ? `🔌 Module '${module.name}' uninstalled. Navigation & shortcuts removed.`
      : `✨ Module '${module.name}' installed! Nav item and features activated.`;
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 bg-slate-900 dark:bg-slate-800 text-white border border-indigo-500/30 rounded-xl shadow-2xl backdrop-blur-md animate-bounce-short">
          <Sparkles className="w-5 h-5 text-indigo-400" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 rounded-full flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              Conversation OS Marketplace
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              v2.0 Modular Architecture
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            App Store & Module Manager
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
            Configure modular features on top of your CRM core. Install or remove capabilities in real-time with zero system downtime.
          </p>
        </div>

        {/* Stats Pill */}
        <div className="flex items-center gap-4 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-5 py-3 rounded-2xl">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Installed Capacity
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white">
              {installedCount} <span className="text-sm text-slate-500">/ {availableModules.length} Active</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold">
            {Math.round((installedCount / availableModules.length) * 100)}%
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              selectedCategory === cat.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Module Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((module) => {
          const Icon = ICON_MAP[module.icon] || Layers;
          const installed = isInstalled(module.id);

          return (
            <div
              key={module.id}
              className={`flex flex-col justify-between rounded-2xl p-6 transition-all duration-200 ${
                installed
                  ? 'bg-white dark:bg-slate-900 border-2 border-indigo-500/40 shadow-lg shadow-indigo-500/5'
                  : 'bg-slate-50/80 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 opacity-80 hover:opacity-100'
              }`}
            >
              <div>
                {/* Card Top */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className={`p-3 rounded-xl ${
                    installed 
                      ? 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20' 
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500 border border-transparent'
                  }`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      {module.badge}
                    </span>
                  </div>
                </div>

                {/* Title & Tagline */}
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                  {module.name}
                </h3>
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mb-3">
                  {module.tagline}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                  {module.description}
                </p>

                {/* Feature Checklist */}
                <div className="space-y-2 mb-6">
                  {module.features.map((feat, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Install / Uninstall Button */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <span className={`text-xs font-medium ${installed ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-500'}`}>
                  {installed ? '● Installed & Active' : '○ Not Installed'}
                </span>
                <button
                  onClick={() => handleToggle(module)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    installed
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900'
                      : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-600/30'
                  }`}
                >
                  {installed ? 'Uninstall Module' : 'Install Module'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
