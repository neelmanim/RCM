// ── ModuleRegistry.js — Enterprise Conversation OS Module Registry ──

export const AVAILABLE_MODULES = [
  {
    id: 'power-dialer',
    name: 'AI Power Dialer',
    tagline: 'High-velocity outbound calling with live transcription & dispositioning',
    category: 'sales',
    icon: 'PhoneCall',
    badge: 'Voice AI',
    defaultInstalled: true,
    description: 'Autonomous multi-line dialer, intelligent local presence DID rotation, real-time speech analytics, and 1-click call disposition sync.',
    features: ['Multi-line power & predictive dialing', 'Live transcription & AI sentiment highlights', 'Voicemail drop & automated follow-up triggers', 'One-click CRM call logging'],
    route: '/dialer',
    navItem: { label: 'Power Dialer', path: '/dialer', icon: 'PhoneCall' },
  },
  {
    id: 'cadences',
    name: 'Sales Cadences & Sequences',
    tagline: 'Multichannel outreach engine across Email, SMS, and WhatsApp',
    category: 'sales',
    icon: 'Zap',
    badge: 'Automation',
    defaultInstalled: true,
    description: 'Orchestrate high-converting sales cadences across email, WhatsApp, and SMS with smart delays, response detection, and AI copy tuning.',
    features: ['Multichannel touchpoints (Email, WhatsApp, SMS)', 'Conditional branching based on prospect engagement', 'Automated step pause on reply or meeting booked', 'Team cadence templates & performance attribution'],
    route: '/cadences',
    navItem: { label: 'Sales Cadences', path: '/cadences', icon: 'Zap' },
  },
  {
    id: 'email-hub',
    name: 'Omnichannel Email Hub',
    tagline: 'Unified inbox with bi-directional sync & AI conversation threading',
    category: 'communication',
    icon: 'Mail',
    badge: '2-Way Sync',
    defaultInstalled: true,
    description: 'Consolidated inbox for all SDR and AE email conversations. Integrates directly into lead records with AI-assisted draft generation.',
    features: ['Two-way Google & Outlook inbox synchronization', 'AI email summarization & rapid reply generator', 'Click and open tracking with instant alert badges', 'Shared team templates and dynamic variable injection'],
    route: '/email',
    navItem: { label: 'Email Hub', path: '/email', icon: 'Mail' },
  },
  {
    id: 'analytics',
    name: 'Performance & Analytics Hub',
    tagline: 'Deep visibility into SDR conversion funnels & call performance',
    category: 'intelligence',
    icon: 'BarChart3',
    badge: 'BI & KPIs',
    defaultInstalled: true,
    description: 'Executive dashboards, rep leaderboards, pipeline velocity tracking, and conversion bottleneck analysis.',
    features: ['Real-time SDR call & connection leaderboard', 'Pipeline stage conversion funnel analysis', 'Rep activity breakdown (dials, connects, meetings)', 'Exportable executive performance digests'],
    route: '/analytics',
    navItem: { label: 'Analytics Hub', path: '/analytics', icon: 'BarChart3' },
  },
  {
    id: 'csm',
    name: 'CSM & Account Health Portal',
    tagline: 'Customer success retention monitoring & renewal pipelines',
    category: 'retention',
    icon: 'ShieldCheck',
    badge: 'Retention',
    defaultInstalled: false, // Off by default to demonstrate installable flow
    description: 'Proactively track customer health scores, contract renewal dates, onboarding milestones, and churn risk signals.',
    features: ['Automated customer health scoring (0-100)', 'Contract renewal pipeline & ARR expansion tracking', 'Onboarding milestone checklists & SLA alerts', 'Usage anomaly and churn prevention triggers'],
    route: '/csm',
    navItem: { label: 'CSM Portal', path: '/csm', icon: 'ShieldCheck' },
  },
];

const STORAGE_KEY = 'crm_installed_modules';

export class ModuleRegistry {
  static getInstalledIds() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.warn('Failed to parse installed modules from storage:', e);
    }
    // Default installed modules
    const defaults = AVAILABLE_MODULES.filter(m => m.defaultInstalled).map(m => m.id);
    this.setInstalledIds(defaults);
    return defaults;
  }

  static setInstalledIds(ids) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch (e) {
      console.warn('Failed to persist installed modules:', e);
    }
  }

  static isInstalled(moduleId) {
    const ids = this.getInstalledIds();
    return ids.includes(moduleId);
  }

  static install(moduleId) {
    const ids = this.getInstalledIds();
    if (!ids.includes(moduleId)) {
      const updated = [...ids, moduleId];
      this.setInstalledIds(updated);
      window.dispatchEvent(new CustomEvent('crm:modules-changed', { detail: { moduleId, action: 'install' } }));
    }
  }

  static uninstall(moduleId) {
    const ids = this.getInstalledIds();
    const updated = ids.filter(id => id !== moduleId);
    this.setInstalledIds(updated);
    window.dispatchEvent(new CustomEvent('crm:modules-changed', { detail: { moduleId, action: 'uninstall' } }));
  }

  static reset() {
    const defaults = AVAILABLE_MODULES.filter(m => m.defaultInstalled).map(m => m.id);
    this.setInstalledIds(defaults);
    window.dispatchEvent(new CustomEvent('crm:modules-changed', { detail: { action: 'reset' } }));
  }

  static getInstalledModules() {
    const ids = this.getInstalledIds();
    return AVAILABLE_MODULES.filter(m => ids.includes(m.id));
  }
}
