import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import SandboxTopRibbon from '../sandbox/SandboxTopRibbon';
import AppSidebar from './AppSidebar';

export default function AppShell() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('crm_dark_mode');
    return saved !== null ? saved === 'true' : true; // Dark mode by default
  });

  useEffect(() => {
    localStorage.setItem('crm_dark_mode', darkMode);
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <div className={`min-h-screen flex flex-col font-sans ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      {/* 1. Persistent 1-Click Interactive Sandbox Ribbon */}
      <SandboxTopRibbon
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        onToggleMenu={() => setIsMobileMenuOpen(prev => !prev)}
      />

      {/* 2. Main App Body (Sidebar + Content) */}
      <div className="flex-1 flex overflow-hidden relative">
        <AppSidebar
          isMobileMenuOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        />
        <main className="flex-1 overflow-y-auto bg-slate-100/50 dark:bg-slate-900/30">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
