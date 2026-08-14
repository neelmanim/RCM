// ── views/leads.js — Orchestrator (re-exports from split modules) ─────────────
//
// This file was refactored from a 2,116-line monolith into focused modules:
//   lead_helpers.js      — shared helpers (canModifyLead, renderSourceBadge, etc.)
//   lead_list.js         — leads table, filters, pagination
//   lead_detail.js       — lead detail page (stepper, research, notes, tasks)
//   lead_calls_tab.js    — calls tab lazy-loader
//   lead_emails_tab.js   — emails tab + composer
//   lead_kanban.js       — kanban board + drag-and-drop
//
// All public exports are re-exported here so app.js imports remain unchanged.
// ──────────────────────────────────────────────────────────────────────────────

export { renderLeads, setNavLeadsFromRaw } from './lead_list.js';
export { renderLeadDetail } from './lead_detail.js';
export { renderKanban } from './lead_kanban.js';
