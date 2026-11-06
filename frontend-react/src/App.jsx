import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ModuleProvider } from './core/modules/ModuleContext';
import AppShell from './components/layout/AppShell';
import DashboardPage from './pages/DashboardPage';
import LeadsPage from './pages/LeadsPage';
import LeadDetailPage from './pages/LeadDetailPage';
import PipelinePage from './pages/PipelinePage';
import PipelineAnalyticsPage from './pages/PipelineAnalyticsPage';
import ModulePreviewPage from './pages/ModulePreviewPage';
import AppStoreView from './features/app-store/AppStoreView';

// HashRouter is preferred for static CDN / preview compatibility so deep links work without server rewrite rules
export default function App() {
  return (
    <ModuleProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/lead/:id" element={<LeadDetailPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/app-store" element={<AppStoreView />} />
            <Route path="/modules/:moduleId" element={<ModulePreviewPage />} />
            <Route path="/analytics" element={<PipelineAnalyticsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ModuleProvider>
  );
}
