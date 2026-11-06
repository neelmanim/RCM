import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SandboxStore, PIPELINE_STAGES } from '../services/sandboxStore';
import {
  ArrowLeft, PhoneCall,
  Clock, Plus, CheckCircle2, MessageSquare, AlertCircle
} from 'lucide-react';

export default function LeadDetailPage() {
  const { id } = useParams();
  const [leads, setLeads] = useState(() => SandboxStore.getLeads());
  const lead = leads.find(item => item.id === Number(id));
  const [activeTab, setActiveTab] = useState('notes');
  const [newNote, setNewNote] = useState('');
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    const handleUpdate = () => setLeads(SandboxStore.getLeads());
    window.addEventListener('crm:sandbox-updated', handleUpdate);
    return () => window.removeEventListener('crm:sandbox-updated', handleUpdate);
  }, [id]);

  const handleStageChange = (e) => {
    const newStage = e.target.value;
    SandboxStore.moveLeadStage(lead.id, newStage);
    setToastMessage(`Stage updated to "${newStage}"`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    SandboxStore.addNote(lead.id, newNote);
    setNewNote('');
    setToastMessage('Note logged successfully');
    setTimeout(() => setToastMessage(null), 3000);
  };

  if (!lead) return <div className="crm-page space-y-4"><h1 className="text-2xl font-bold">Account not found</h1><p>This sample account is unavailable. Choose another account or reset the demo.</p><Link className="crm-link" to="/leads">Browse accounts</Link></div>;

  return (
    <div className="crm-page space-y-5">
      {/* Toast Notification */}
      {toastMessage && (
        <div role="status" className="fixed top-14 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900 text-white border border-lime-500/40 rounded-xl shadow-xl backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Back Link & Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/leads"
          aria-label="Back to accounts"
          className="p-2 rounded-xl bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <span>{lead.name}</span>
            <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-lime-50 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 border border-lime-200 dark:border-lime-800">
              Sample score: {lead.priority_score}
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {lead.title} at <span className="font-semibold text-slate-700 dark:text-slate-300">{lead.company}</span>
          </p>
        </div>
      </div>

      {/* Split Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Account Profile */}
        <div className="crm-panel p-4 sm:p-6 space-y-5 h-fit">
          <div className="space-y-3 pb-5 border-b border-slate-100 dark:border-slate-800">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400">
              Deal Pipeline Stage
            </div>
            <select aria-label="Deal pipeline stage"
              value={lead.stage}
              onChange={handleStageChange}
              className="w-full px-3 py-2 text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-lime-500 cursor-pointer"
            >
              {PIPELINE_STAGES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Email Address</span>
              <span className="font-semibold text-slate-900 dark:text-white font-mono break-all">{lead.email}</span>
            </div>
            <div>
              <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Phone</span>
              <span className="font-semibold text-slate-900 dark:text-white font-mono">{lead.phone}</span>
            </div>
            <div>
              <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Estimated ARR</span>
              <span className="font-bold text-slate-900 dark:text-white font-mono text-sm">{lead.arr}</span>
            </div>
            <div>
              <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Sales Team Size</span>
              <span className="font-semibold text-slate-900 dark:text-white">{lead.rep_count}</span>
            </div>
            <div>
              <span className="text-slate-600 dark:text-slate-400 block text-[11px]">Assigned Owner</span>
              <span className="font-semibold text-slate-900 dark:text-white">{lead.assigned_to}</span>
            </div>
          </div>

          {/* Tags */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400 block">
              Sample tags
            </span>
            <div className="flex flex-wrap gap-1.5">
              {lead.tags?.map((t, idx) => (
                <span key={idx} className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Lead activity */}
        <div className="lg:col-span-2 crm-panel p-4 sm:p-6 space-y-6">
          {/* Activity tabs */}
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3 overflow-x-auto">
            <button
              onClick={() => setActiveTab('notes')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'notes'
                  ? 'bg-lime-300 text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Activity & Notes
            </button>

            <button
              onClick={() => setActiveTab('calls')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'calls'
                  ? 'bg-lime-300 text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5 text-lime-400" />
              <span>Call Logs ({lead.call_logs?.length || 0})</span>
            </button>
          </div>

          {/* Tab 1: Activity & Notes */}
          {activeTab === 'notes' && (
            <div className="space-y-6">
              {/* Add Note Form */}
              <form onSubmit={handleAddNote} className="space-y-3">
                <textarea aria-label="Activity note"
                  rows={3}
                  maxLength={5000}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="What happened, and what should happen next?"
                  className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-lime-500 focus:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!newNote.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-lime-300 text-slate-950 hover:bg-lime-200 transition-all flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Save note</span>
                  </button>
                </div>
              </form>

              {/* Existing Notes */}
              <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Account notes
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                  {lead.notes}
                </p>
              </div>
            </div>
          )}

          {/* Call logs */}
          {activeTab === 'calls' && (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Sample and simulated calls for this lead.
              </div>
              {lead.call_logs && lead.call_logs.length > 0 ? (
                <div className="space-y-3">
                  {lead.call_logs.map((cl) => (
                    <div key={cl.id} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          Outcome: {cl.outcome}
                        </span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                          {cl.duration} · {cl.date}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{cl.notes}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-slate-600 dark:text-slate-400 italic bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  No calls placed yet. Use the top "Simulate Call" button to log an outbound dial.
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
