import React, { useState, useEffect } from 'react';
import { SandboxStore, PIPELINE_STAGES } from '../services/sandboxStore';
import { Link } from 'react-router-dom';
import { Search, Filter, PhoneCall, ChevronRight, UserPlus, Tag } from 'lucide-react';

export default function LeadsPage() {
  const [leads, setLeads] = useState(() => SandboxStore.getLeads());
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');

  useEffect(() => {
    const handleUpdate = () => setLeads(SandboxStore.getLeads());
    window.addEventListener('crm:sandbox-updated', handleUpdate);
    window.addEventListener('crm:sandbox-reset', handleUpdate);
    return () => {
      window.removeEventListener('crm:sandbox-updated', handleUpdate);
      window.removeEventListener('crm:sandbox-reset', handleUpdate);
    };
  }, []);

  const filteredLeads = leads.filter(l => {
    const matchesSearch = 
      l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStage = stageFilter === 'all' || l.stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Leads & Target Accounts
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Core CRM records enriched with revenue intelligence and touchpoint history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            {filteredLeads.length} Accounts Displayed
          </span>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search leads by name, company, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
          >
            <option value="all">All Stages</option>
            {PIPELINE_STAGES.map(st => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Leads Table */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Contact & Company</th>
                <th className="py-3.5 px-4">Stage</th>
                <th className="py-3.5 px-4">ARR & Reps</th>
                <th className="py-3.5 px-4">Priority Score</th>
                <th className="py-3.5 px-4">Assigned To</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 font-bold flex items-center justify-center text-xs">
                        {lead.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <Link to={`/lead/${lead.id}`} className="font-bold text-slate-900 dark:text-white hover:text-indigo-600">
                          {lead.name}
                        </Link>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {lead.title} · <span className="font-semibold text-slate-700 dark:text-slate-300">{lead.company}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {lead.stage}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="font-bold text-slate-900 dark:text-white font-mono">{lead.arr}</div>
                    <div className="text-[11px] text-slate-500">{lead.rep_count}</div>
                  </td>
                  <td className="py-4 px-4">
                    <span className="px-2.5 py-0.5 text-xs font-bold rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                      {lead.priority_score}/100
                    </span>
                  </td>
                  <td className="py-4 px-4 text-slate-600 dark:text-slate-400">
                    {lead.assigned_to}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <Link
                      to={`/lead/${lead.id}`}
                      className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-all inline-flex items-center gap-1"
                    >
                      <span>Open Record</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
