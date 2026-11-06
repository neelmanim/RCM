import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import SandboxTopRibbon from '../sandbox/SandboxTopRibbon';
import AppSidebar from './AppSidebar';

export default function AppShell() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = sessionStorage.getItem('crm_sandbox_dark_mode');
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    sessionStorage.setItem('crm_sandbox_dark_mode', darkMode);
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <div className={`crm-workspace min-h-screen flex flex-col font-sans ${darkMode ? 'dark bg-[#06080c] text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      <a href="#workspace-content" onClick={event => { event.preventDefault(); document.getElementById('workspace-content')?.focus(); }} className="crm-skip-link">Skip to workspace</a>
      {/* 1. Persistent 1-Click Interactive Sandbox Ribbon */}
      <SandboxTopRibbon
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMenu={() => setIsMobileMenuOpen(prev => !prev)}
      />

      {/* 2. Main App Body (Sidebar + Content) */}
      <div className="flex-1 flex overflow-hidden relative">
        <AppSidebar
          isMobileMenuOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        />
        <main tabIndex={-1} id="workspace-content" className="crm-canvas min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
