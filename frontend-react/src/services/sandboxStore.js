// ── sandboxStore.js — In-Browser Stateful Simulation Engine for Alternate CRM ──

export const INITIAL_LEADS = [
  {
    id: 101,
    name: 'Sarah Jenkins',
    email: 'sjenkins@stripe.com',
    phone: '+1 (415) 890-2341',
    company: 'Stripe',
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
    email: 'm.vance@figma.com',
    phone: '+1 (415) 762-9912',
    company: 'Figma',
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
    email: 'david.oc@notion.so',
    phone: '+1 (415) 554-1290',
    company: 'Notion',
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
    email: 'elena@ramp.com',
    phone: '+1 (415) 441-8921',
    company: 'Ramp',
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
    email: 'k.patel@vercel.com',
    phone: '+1 (415) 677-3320',
    company: 'Vercel',
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
    email: 'lucas@datadog.com',
    phone: '+1 (415) 912-4411',
    company: 'Datadog',
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

const LEADS_STORAGE_KEY = 'crm_sandbox_leads';
const PERSONA_STORAGE_KEY = 'crm_sandbox_persona';

export class SandboxStore {
  static getLeads() {
    try {
      const stored = sessionStorage.getItem(LEADS_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.warn('Sandbox store read error:', e);
    }
    this.setLeads(INITIAL_LEADS);
    return INITIAL_LEADS;
  }

  static setLeads(leads) {
    try {
      sessionStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(leads));
      window.dispatchEvent(new CustomEvent('crm:sandbox-updated'));
    } catch (e) {
      console.warn('Sandbox store write error:', e);
    }
  }

  static updateLead(id, updates) {
    const leads = this.getLeads();
    const updated = leads.map(l => l.id === Number(id) ? { ...l, ...updates } : l);
    this.setLeads(updated);
    return updated.find(l => l.id === Number(id));
  }

  static moveLeadStage(id, newStage) {
    return this.updateLead(id, {
      stage: newStage,
      last_activity: `Moved to ${newStage} · Just now`
    });
  }

  static addCallLog(leadId, callData) {
    const leads = this.getLeads();
    const target = leads.find(l => l.id === Number(leadId));
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
    const target = leads.find(l => l.id === Number(leadId));
    if (!target) return null;

    return this.updateLead(leadId, {
      notes: `${noteText}\n\n[Previous]: ${target.notes}`,
      last_activity: 'New note logged · Just now'
    });
  }

  static reset() {
    this.setLeads(INITIAL_LEADS);
    this.setPersona('alex');
    window.dispatchEvent(new CustomEvent('crm:sandbox-reset'));
  }

  static getActivePersona() {
    const stored = sessionStorage.getItem(PERSONA_STORAGE_KEY) || 'alex';
    return PERSONAS.find(p => p.id === stored) || PERSONAS[0];
  }

  static setPersona(personaId) {
    sessionStorage.setItem(PERSONA_STORAGE_KEY, personaId);
    window.dispatchEvent(new CustomEvent('crm:persona-changed', { detail: personaId }));
  }
}
