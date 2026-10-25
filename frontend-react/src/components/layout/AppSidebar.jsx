import React from 'react';
import { NavLink } from 'react-router-dom';
import { useModules } from '../../core/modules/ModuleContext';
import { 
  LayoutDashboard, Users, KanbanSquare, CheckSquare, 
  Store, Settings, PhoneCall, Zap, Mail, BarChart3, ShieldCheck,
  ChevronRight, Sparkles, X
} from 'lucide-react';

const ICON_MAP = {
  PhoneCall,
  Zap,
  Mail,
  BarChart3,
  ShieldCheck,
};

export default function AppSidebar({ isMobileMenuOpen, onClose }) {
  const { availableModules, installedModules } = useModules();

  const coreNav = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Leads & Accounts', path: '/leads', icon: Users, badge: '24' },
    { label: 'Pipeline Kanban', path: '/pipeline', icon: KanbanSquare },
    { label: 'Tasks & Activity', path: '/tasks', icon: CheckSquare },
  ];

  const handleNavClick = () => {
    if (onClose) onClose();
  };

  const sidebarContent = (
    <div className="flex flex-col justify-between h-full select-none">
      {/* Top Section */}
      <div className="p-4 space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 py-1">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-black text-sm shadow-md shadow-indigo-600/30">
              A
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>Alternate CRM</span>
                <span className="px-1.5 py-0.2 text-[10px] font-extrabold uppercase bg-indigo-500/10 text-indigo-500 rounded">OS</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Conversation Intelligence
              </div>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 1. Core Platform Section */}
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
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
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
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

        {/* 2. Dynamic Installed Modules Section */}
        <div className="space-y-1">
          <div className="px-3 flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Installed Modules
            </span>
            <span className="text-[10px] font-bold text-indigo-500">
              {installedModules.length} Active
            </span>
          </div>

          {installedModules.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-slate-400 dark:text-slate-600 italic border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-center">
              No modules installed. Visit App Store to enable features.
            </div>
          ) : (
            installedModules.map((module) => {
              const Icon = ICON_MAP[module.icon] || Sparkles;
              return (
                <NavLink
                  key={module.id}
                  to={module.route}
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    `flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                    }`
                  }
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 flex-shrink-0 text-indigo-500" />
                    <span>{module.name}</span>
                  </div>
                  <ChevronRight className="w-3 h-3 text-slate-400 opacity-60" />
                </NavLink>
              );
            })
          )}
        </div>
      </div>

      {/* Bottom Section: Marketplace & System */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 space-y-1">
        <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
          Ecosystem
        </div>

        {/* App Store Navigation with Active Count Badge */}
        <NavLink
          to="/app-store"
          onClick={handleNavClick}
          className={({ isActive }) =>
            `flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
              isActive
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                : 'bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800/80'
            }`
          }
        >
          <div className="flex items-center gap-2.5">
            <Store className="w-4 h-4 flex-shrink-0" />
            <span>App Store</span>
          </div>
          <span className="px-1.5 py-0.5 text-[10px] font-extrabold rounded-md bg-indigo-200 dark:bg-indigo-800 text-indigo-900 dark:text-indigo-200">
            {installedModules.length}/{availableModules.length}
          </span>
        </NavLink>

        <NavLink
          to="/settings"
          onClick={handleNavClick}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
              isActive
                ? 'bg-slate-200 dark:bg-slate-900 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
            }`
          }
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          <span>Workspace Settings</span>
        </NavLink>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:flex w-64 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800/80 flex-col justify-between flex-shrink-0 select-none">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={onClose}
          />
          {/* Slide-out Sidebar */}
          <aside className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between z-10 shadow-2xl overflow-y-auto">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
