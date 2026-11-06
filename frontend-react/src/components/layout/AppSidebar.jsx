import { containDialogFocus } from '../containDialogFocus';
import React, { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useModules } from '../../core/modules/useModules';
import {
  LayoutDashboard, Users, KanbanSquare, Store, BarChart3,
  ChevronRight, X, Sparkles, RefreshCw
} from 'lucide-react';

export default function AppSidebar({ isMobileMenuOpen, onClose }) {
  const { availableModules, installedModules } = useModules();
  const mobileDialog = useRef(null);
  useEffect(() => {
    const dialog = mobileDialog.current;
    if (isMobileMenuOpen && !dialog.open) dialog.showModal();
    if (!isMobileMenuOpen && dialog.open) dialog.close();
  }, [isMobileMenuOpen]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches && mobileDialog.current?.open) mobileDialog.current.close();
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  const getSidebarModuleIcon = (id) => {
    switch (id) {
      case 'speech-ai':
        return <Sparkles className="w-4 h-4 flex-shrink-0 text-violet-400" />;
      case 'sync-engine':
        return <RefreshCw className="w-4 h-4 flex-shrink-0 text-emerald-400" />;
      default:
        return <BarChart3 className="w-4 h-4 flex-shrink-0 text-lime-400" />;
    }
  };

  const coreNav = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Leads and accounts', path: '/leads', icon: Users },
    { label: 'Pipeline', path: '/pipeline', icon: KanbanSquare },
  ];

  const handleNavClick = () => {
    if (onClose) onClose();
  };

  const sidebarContent = (
    <nav aria-label="Workspace" className="flex flex-col justify-between h-full">
      {/* Top Section */}
      <div className="p-4 space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 py-1">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-lime-300 flex items-center justify-center text-slate-950 font-black text-sm">
              A
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>Alternate CRM</span>
                <span className="px-1.5 text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Demo</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Sales workspace
              </div>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 1. Core Platform Section */}
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
            Core CRM
          </div>
          {coreNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={handleNavClick}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-lime-300 text-slate-950 shadow-sm shadow-lime-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                  }`
                }
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>

        {/* 2. Dynamic Available modules Section */}
        <div className="space-y-1">
          <div className="px-3 flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Available modules
            </span>
            <span className="text-[10px] font-bold text-lime-800">
              {installedModules.length} enabled
            </span>
          </div>

          {installedModules.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-slate-600 dark:text-slate-400 italic border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-center">
              Enable features from the module catalog.
            </div>
          ) : (
            installedModules.map((module) => (
                <NavLink
                  key={module.id}
                  to={module.route}
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    `flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                      isActive
                        ? 'bg-lime-300 text-slate-950 shadow-sm shadow-lime-600/20'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                    }`
                  }
                >
                  <div className="flex items-center gap-2.5">
                    {getSidebarModuleIcon(module.id)}
                    <span>{module.name}</span>
                  </div>
                  <ChevronRight className="w-3 h-3 text-slate-600 dark:text-slate-400 opacity-60" />
                </NavLink>
            ))
          )}
        </div>
      </div>

      {/* Bottom Section: Marketplace & System */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 space-y-1">
        <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
          Workspace
        </div>

        {availableModules.filter(module => module.status === 'preview').map(module => <NavLink key={module.id} to={module.route} onClick={handleNavClick} className={({isActive}) => `flex items-center justify-between min-h-11 px-3 py-2 rounded-xl text-xs font-semibold ${isActive ? 'bg-lime-300 text-slate-950' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'}`}><span>{module.name}</span><span className="text-[10px] uppercase">Preview</span></NavLink>)}

        {/* App Store Navigation with Active Count Badge */}
        <NavLink
          to="/app-store"
          onClick={handleNavClick}
          className={({ isActive }) =>
            `flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
              isActive
                ? 'bg-lime-300 text-slate-950 shadow-sm shadow-lime-600/20'
                : 'bg-lime-50/60 dark:bg-lime-950/40 text-lime-800 dark:text-lime-300 hover:bg-lime-100 dark:hover:bg-lime-900/60 border border-lime-200 dark:border-lime-800/80'
            }`
          }
        >
          <div className="flex items-center gap-2.5">
            <Store className="w-4 h-4 flex-shrink-0" />
            <span>Module catalog</span>
          </div>
          <span className="px-1.5 py-0.5 text-[10px] font-extrabold rounded-md bg-lime-200 dark:bg-lime-800 text-lime-900 dark:text-lime-200">
            {installedModules.length}/{availableModules.length}
          </span>
        </NavLink>

      </div>
    </nav>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside aria-label="Workspace sidebar" className="hidden lg:flex w-60 bg-white dark:bg-[#0b0f17] border-r border-slate-200 dark:border-white/[0.08] flex-col justify-between flex-shrink-0 select-none">
        {sidebarContent}
      </aside>

      <dialog
        onKeyDown={containDialogFocus}
        ref={mobileDialog}
        id="workspace-navigation"
        aria-label="Workspace navigation"
        onCancel={onClose}
        onClose={onClose}
        className="crm-navigation-dialog fixed inset-y-0 left-0 m-0 h-full max-h-none w-72 max-w-[85vw] p-0 bg-white dark:bg-[#0b0f17] text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-700 overflow-y-auto"
      >
        {sidebarContent}
      </dialog>
    </>
  );
}
