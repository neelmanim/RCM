import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SandboxStore, PIPELINE_STAGES } from '../services/sandboxStore';
import { useModules } from '../core/modules/ModuleContext';
import { 
  ArrowLeft, PhoneCall, Mail, Zap, ShieldCheck, 
  Clock, Plus, CheckCircle2, MessageSquare, AlertCircle 
} from 'lucide-react';

export default function LeadDetailPage() {
  const { id } = useParams();
  const { isInstalled } = useModules();
  const [lead, setLead] = useState(() => {
    const leads = SandboxStore.getLeads();
    return leads.find(l => l.id === Number(id)) || leads[0];
  });
  const [activeTab, setActiveTab] = useState('notes');
  const [newNote, setNewNote] = useState('');
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    const handleUpdate = () => {
      const leads = SandboxStore.getLeads();
      setLead(leads.find(l => l.id === Number(id)) || leads[0]);
    };
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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-fadeIn">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-14 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900 text-white border border-indigo-500/40 rounded-xl shadow-xl backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Back Link & Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/leads"
          className="p-2 rounded-xl bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <span>{lead.name}</span>
            <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              Priority: {lead.priority_score}
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
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 h-fit">
          <div className="space-y-3 pb-5 border-b border-slate-100 dark:border-slate-800">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              Deal Pipeline Stage
            </div>
            <select
              value={lead.stage}
              onChange={handleStageChange}
              className="w-full px-3 py-2 text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              {PIPELINE_STAGES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <span className="text-slate-400 block text-[11px]">Email Address</span>
              <span className="font-semibold text-slate-900 dark:text-white font-mono">{lead.email}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Direct Phone (Voice/SMS)</span>
              <span className="font-semibold text-slate-900 dark:text-white font-mono">{lead.phone}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Estimated ARR</span>
              <span className="font-bold text-slate-900 dark:text-white font-mono text-sm">{lead.arr}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Sales Team Size</span>
              <span className="font-semibold text-slate-900 dark:text-white">{lead.rep_count}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Assigned Owner</span>
              <span className="font-semibold text-slate-900 dark:text-white">{lead.assigned_to}</span>
            </div>
          </div>

          {/* Tags */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
              Enrichment Tags
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

        {/* Right Column: Modular Pluggable Tabs */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6">
          {/* Tab Navigation (Dynamically includes tabs for installed modules) */}
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3 overflow-x-auto">
            <button
              onClick={() => setActiveTab('notes')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'notes'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Activity & Notes
            </button>

            {/* Power Dialer Tab (Only if installed) */}
            {isInstalled('power-dialer') && (
              <button
                onClick={() => setActiveTab('calls')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'calls'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <PhoneCall className="w-3.5 h-3.5 text-indigo-400" />
                <span>Call Logs ({lead.call_logs?.length || 0})</span>
              </button>
            )}

            {/* Cadences Tab (Only if installed) */}
            {isInstalled('cadences') && (
              <button
                onClick={() => setActiveTab('cadence')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'cadence'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>Sales Cadence</span>
              </button>
            )}

            {/* Email Hub Tab (Only if installed) */}
            {isInstalled('email-hub') && (
              <button
                onClick={() => setActiveTab('email')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'email'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Mail className="w-3.5 h-3.5 text-indigo-400" />
                <span>Email Thread</span>
              </button>
            )}

            {/* CSM Tab (Only if installed) */}
            {isInstalled('csm') && (
              <button
                onClick={() => setActiveTab('csm')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'csm'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Health Score</span>
              </button>
            )}
          </div>

          {/* Tab 1: Activity & Notes */}
          {activeTab === 'notes' && (
            <div className="space-y-6">
              {/* Add Note Form */}
              <form onSubmit={handleAddNote} className="space-y-3">
                <textarea
                  rows={3}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Log an executive update, deal requirement, or objection..."
                  className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-all flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Log Activity Note</span>
                  </button>
                </div>
              </form>

              {/* Existing Notes */}
              <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Account Intelligence & Notes
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                  {lead.notes}
                </p>
              </div>
            </div>
          )}

          {/* Tab 2: Call Logs (Power Dialer Module) */}
          {activeTab === 'calls' && (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Call history recorded via AI Power Dialer module:
              </div>
              {lead.call_logs && lead.call_logs.length > 0 ? (
                <div className="space-y-3">
                  {lead.call_logs.map((cl) => (
                    <div key={cl.id} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          Outcome: {cl.outcome}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {cl.duration} · {cl.date}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{cl.notes}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-slate-400 italic bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  No calls placed yet. Use the top "Simulate Call" button to log an outbound dial.
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Cadence (Cadence Module) */}
          {activeTab === 'cadence' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs font-semibold">
                Enrolled Sequence: {lead.cadence?.name || 'Tier 1 Enterprise Outbound'}
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px]">✓</span>
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">Step 1: Introduction Email with Video Snippet</div>
                    <div className="text-[11px] text-slate-400">Opened · 2 clicks on calendar link</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-[10px]">2</span>
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">Step 2: AI Power Dial Outbound Touch</div>
                    <div className="text-[11px] text-indigo-400">Scheduled for today at 2:00 PM</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Email Hub */}
          {activeTab === 'email' && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-900 dark:text-white">
                  <span>Re: Alternate Conversation OS Evaluation</span>
                  <span className="text-[11px] text-slate-400">Oct 23</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Hi Alex, the security team reviewed the SOC-2 documentation. We are ready to proceed with the technical architecture review this Thursday.
                </p>
              </div>
            </div>
          )}

          {/* Tab 5: CSM Health */}
          {activeTab === 'csm' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Customer Health Score</div>
                  <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{lead.health_score || 92} / 100</div>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 text-white">Low Churn Risk</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
