/**
 * ReportsTab.jsx
 *
 * Automated Analytics reports (v11.4.0) — multiple named, saved reports,
 * each with its own filters/schedule/recipients. My Reports and Report Logs
 * live on the same page (Logs directly under the list) instead of behind a
 * separate tab — there's nothing to switch between, just one operational
 * view of "what's configured" and "what's happened." The full-page builder
 * is still its own view since creating/editing a report is a different task
 * from monitoring one.
 */
import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { MyReportsList } from './reports/MyReportsList';
import { ReportBuilder } from './reports/ReportBuilder';
import { ReportLogs } from './reports/ReportLogs';
import { ChangelogDigestCard } from './reports/ChangelogDigestCard';

export const ReportsTab = () => {
  // 'list' | 'builder'
  const [view, setView] = useState('list');
  const [editingReportId, setEditingReportId] = useState(null);
  // Bumped whenever a report runs, remounting ReportLogs so it refetches —
  // it otherwise only loads once on mount and won't see the new execution.
  const [logsKey, setLogsKey] = useState(0);

  const openBuilder = (report) => {
    setEditingReportId(report ? report.id : null);
    setView('builder');
  };

  const closeBuilder = () => {
    setEditingReportId(null);
    setView('list');
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-800 m-0">
          <Mail size={22} className="text-indigo-600" /> Automated Reports
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Create, customize, schedule, and track automated Analytics reports.
        </p>
      </div>

      {view === 'builder' ? (
        <ReportBuilder reportId={editingReportId} onDone={closeBuilder} />
      ) : (
        <div className="space-y-5">
          <ChangelogDigestCard />

          <MyReportsList
            onCreateNew={() => openBuilder(null)}
            onEdit={openBuilder}
            onLogsChanged={() => setLogsKey((k) => k + 1)}
          />

          <ReportLogs key={logsKey} />
        </div>
      )}
    </div>
  );
};
