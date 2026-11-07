// ── sandboxStore.js — In-Browser Stateful Simulation Engine for Alternate CRM ──

export const INITIAL_LEADS = [
  {
    id: 101,
    name: 'Sarah Jenkins',
    email: 'sarah@northstar.example',
    phone: '+1 (202) 555-0101',
    company: 'Northstar Labs',
    title: 'VP of Revenue Operations',
    stage: 'Meeting Booked',
    source: 'Inbound Enterprise Demo',
    arr: '$180,000',
    rep_count: '45 reps',
    priority_score: 95,
    assigned_to: 'Alex Rivera',
    last_activity: 'Demo confirmed for Thursday 2 PM PST',
    notes: 'Evaluating Alternate CRM as replacement for fragmented dialer & cadence tools across their 45-person sales org.',
    tags: ['High Intent', 'Enterprise'],
    call_logs: [
      { id: 'cl-1', date: 'Yesterday at 3:15 PM', duration: '4m 12s', outcome: 'Meeting Scheduled', notes: 'Great call. Agreed to bring Senior RevOps architect to demo.' }
    ],
    cadence: { name: 'Tier 1 Enterprise Outbound', current_step: 3, total_steps: 5, status: 'Active' },
    health_score: 92
  },
  {
    id: 102,
    name: 'Marcus Vance',
    email: 'marcus@canvas.example',
    phone: '+1 (202) 555-0102',
    company: 'Canvas Studio',
    title: 'Head of Growth Sales',
    stage: 'Proposal Sent',
    source: 'Outbound Multichannel',
    arr: '$120,000',
    rep_count: '30 reps',
    priority_score: 92,
    assigned_to: 'Sarah Chen',
    last_activity: 'Proposal v2 sent with custom security review checklist',
    notes: 'Looking for a native CRM OS with intelligent cadences and automated pipeline health monitoring.',
    tags: ['Enterprise', 'Expansion'],
    call_logs: [
      { id: 'cl-2', date: 'Oct 22 at 11:30 AM', duration: '8m 45s', outcome: 'Proposal Requested', notes: 'Discussed annual enterprise license with dedicated SLA.' }
    ],
    cadence: { name: 'Executive Inbound Fast-Track', current_step: 4, total_steps: 4, status: 'Completed' },
    health_score: 88
  },
  {
    id: 103,
    name: 'David O\'Connor',
    email: 'david@atlas.example',
    phone: '+1 (202) 555-0103',
    company: 'Atlas Works',
    title: 'Director of Sales Strategy',
    stage: 'Contacted',
    source: 'Executive Referral',
    arr: '$95,000',
    rep_count: '25 reps',
    priority_score: 88,
    assigned_to: 'Alex Rivera',
    last_activity: 'Connected on LinkedIn & Sent Intro Video',
    notes: 'Needs unified bi-directional email hub and team activity leaderboard.',
    tags: ['Strategic', 'Inbound'],
    call_logs: [],
    cadence: { name: 'Strategic Account Penetration', current_step: 2, total_steps: 6, status: 'Active' },
    health_score: 84
  },
  {
    id: 104,
    name: 'Elena Rostova',
    email: 'elena@harbor.example',
    phone: '+1 (202) 555-0104',
    company: 'Harbor Finance',
    title: 'VP of Commercial Sales',
    stage: 'Closed Won',
    source: 'Outbound Sequence',
    arr: '$140,000',
    rep_count: '35 reps',
    priority_score: 96,
    assigned_to: 'Sarah Chen',
    last_activity: 'Contract fully executed via DocuSign',
    notes: 'Closed 1-year contract. Kicking off CSM onboarding this Monday.',
    tags: ['Closed Won', 'Fintech'],
    call_logs: [
      { id: 'cl-3', date: 'Oct 20 at 4:00 PM', duration: '12m 10s', outcome: 'Deal Finalized', notes: 'Signed MSA and DPA.' }
    ],
    cadence: null,
    health_score: 98
  },
  {
    id: 105,
    name: 'Kavita Patel',
    email: 'kavita@summit.example',
    phone: '+1 (202) 555-0105',
    company: 'Summit Cloud',
    title: 'Director of Inside Sales',
    stage: 'New Inbound',
    source: 'Product Tour Sign-up',
    arr: '$210,000',
    rep_count: '60 reps',
    priority_score: 98,
    assigned_to: 'Alex Rivera',
    last_activity: 'Signed up for self-serve sandbox 12 mins ago',
    notes: 'Huge expansion potential. Looking to streamline power dialing into their global workflow.',
    tags: ['High Intent', 'Fintech', 'Urgent'],
    call_logs: [],
    cadence: null,
    health_score: 90
  },
  {
    id: 106,
    name: 'Lucas Meyer',
    email: 'lucas@beacon.example',
    phone: '+1 (202) 555-0106',
    company: 'Beacon Systems',
    title: 'Sales Operations Lead',
    stage: 'Meeting Booked',
    source: 'Webinar Attendee',
    arr: '$165,000',
    rep_count: '40 reps',
    priority_score: 89,
    assigned_to: 'David Kim',
    last_activity: 'Attended Q4 RevOps Modernization Webinar',
    notes: 'Interested in reducing tool redundancy by replacing 3 disparate apps with Alternate Conversation OS.',
    tags: ['Enterprise'],
    call_logs: [],
    cadence: { name: 'Post-Webinar Nurture', current_step: 3, total_steps: 4, status: 'Active' },
    health_score: 87
  }
];

export const PIPELINE_STAGES = [
  'New Inbound',
  'Contacted',
  'Meeting Booked',
  'Proposal Sent',
  'Closed Won'
];

export const PERSONAS = [
  { id: 'alex', name: 'Alex Rivera', role: 'Enterprise SDR (Hunter)', avatar: 'AR', leadsCount: 14, dealsValue: '$485k' },
  { id: 'sarah', name: 'Sarah Chen', role: 'Sales Director (Pod Admin)', avatar: 'SC', leadsCount: 24, dealsValue: '$890k' },
  { id: 'david', name: 'David Kim', role: 'CSM & Retention Lead', avatar: 'DK', leadsCount: 18, dealsValue: '$620k' }
];

const LEADS_STORAGE_KEY = 'crm_sandbox_leads_v2';
const PERSONA_STORAGE_KEY = 'crm_sandbox_persona';

// In-memory fallback layer ensures zero-crash operation when sessionStorage is blocked or throws
let memoryLeads = null;
let memoryPersona = 'alex';

function isValidLead(l) {
  return Boolean(
    l &&
    typeof l === 'object' &&
    typeof l.id === 'number' &&
    typeof l.name === 'string' &&
    typeof l.company === 'string'
  );
}

export class SandboxStore {
  static getLeads() {
    try {
      const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(LEADS_STORAGE_KEY) : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(isValidLead);
          if (valid.length > 0) {
            memoryLeads = valid;
            return valid;
          }
        }
      }
    } catch (e) {
      console.warn('Sandbox store read error (using memory fallback):', e);
    }

    if (memoryLeads && memoryLeads.length > 0) {
      return memoryLeads;
    }

    memoryLeads = [...INITIAL_LEADS];
    this.setLeads(INITIAL_LEADS);
    return INITIAL_LEADS;
  }

  static setLeads(leads) {
    const safeLeads = Array.isArray(leads) ? leads.filter(isValidLead) : [...INITIAL_LEADS];
    memoryLeads = safeLeads;
    let persisted = false;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(safeLeads));
        persisted = true;
      }
    } catch (e) {
      console.warn('Sandbox store write error (persisted to in-memory fallback):', e);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('crm:sandbox-updated'));
    }
    return persisted;
  }

  static updateLead(id, updates) {
    const leads = this.getLeads();
    const targetId = Number(id);
    const updated = leads
      .map(l => (isValidLead(l) && l.id === targetId ? { ...l, ...updates } : l))
      .filter(isValidLead);
    this.setLeads(updated);
    return updated.find(l => l.id === targetId) || null;
  }

  static moveLeadStage(id, newStage) {
    if (!PIPELINE_STAGES.includes(newStage)) return null;
    return this.updateLead(id, {
      stage: newStage,
      last_activity: `Moved to ${newStage} · Just now`
    });
  }

  static addCallLog(leadId, callData) {
    const leads = this.getLeads();
    const target = leads.find(l => l && l.id === Number(leadId));
    if (!target) return null;

    const newLog = {
      id: `cl-${Date.now()}`,
      date: 'Just now',
      duration: callData.duration || '2m 15s',
      outcome: callData.outcome || 'Connected',
      notes: callData.notes || 'Outbound call completed successfully.'
    };

    return this.updateLead(leadId, {
      call_logs: [newLog, ...(target.call_logs || [])],
      last_activity: `Call completed (${newLog.outcome}) · Just now`
    });
  }

  static addNote(leadId, noteText) {
    const leads = this.getLeads();
    const target = leads.find(l => l && l.id === Number(leadId));
    if (!target) return null;

    return this.updateLead(leadId, {
      notes: `${noteText}\n\n[Previous]: ${target.notes || ''}`,
      last_activity: 'New note logged · Just now'
    });
  }

  static reset() {
    memoryLeads = [...INITIAL_LEADS];
    memoryPersona = 'alex';
    this.setLeads(INITIAL_LEADS);
    this.setPersona('alex');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('crm:sandbox-reset'));
    }
  }

  static getActivePersona() {
    let stored = memoryPersona;
    try {
      if (typeof sessionStorage !== 'undefined') {
        stored = sessionStorage.getItem(PERSONA_STORAGE_KEY) || memoryPersona;
      }
    } catch {
      stored = memoryPersona;
    }
    return PERSONAS.find(p => p.id === stored) || PERSONAS[0];
  }

  static setPersona(personaId) {
    memoryPersona = personaId;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(PERSONA_STORAGE_KEY, personaId);
      }
    } catch (e) {
      console.warn('Sandbox persona write error (using memory fallback):', e);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('crm:persona-changed', { detail: personaId }));
    }
  }
}

// All demo screens use the same totals, including unfamiliar imported stages.
export function summarizePipeline(leads = []) {
  const rows = Array.isArray(leads) ? leads.filter(lead => lead && typeof lead === 'object') : [];
  const stageNames = [...PIPELINE_STAGES];
  for (const lead of rows) {
    const stage = lead.stage || 'Unassigned';
    if (!stageNames.includes(stage)) stageNames.push(stage);
  }
  const amount = lead => {
    const value = Number(String(lead.arr ?? 0).replace(/[$,\s]/g, ''));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const stages = stageNames.map(label => {
    const records = rows.filter(lead => (lead.stage || 'Unassigned') === label);
    return { label, count: records.length, value: records.reduce((sum, lead) => sum + amount(lead), 0), percent: rows.length ? records.length / rows.length * 100 : 0 };
  });
  const total = stages.reduce((sum, stage) => sum + stage.value, 0);
  return {
    total, count: rows.length, average: rows.length ? total / rows.length : 0, stages,
    meetings: rows.filter(lead => lead.stage === 'Meeting Booked').length,
    calls: rows.reduce((sum, lead) => sum + (Array.isArray(lead.call_logs) ? lead.call_logs.length : 0), 0),
    won: rows.filter(lead => lead.stage === 'Closed Won').length,
  };
}

export const formatCurrency = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
