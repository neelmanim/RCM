// ── ModuleRegistry.js — Enterprise Conversation OS Module Registry ──

export const AVAILABLE_MODULES = [
  {
    id: 'analytics',
    name: 'Pipeline analytics',
    description: 'Account counts and deal values by stage, calculated from your sample pipeline.',
    defaultInstalled: true,
    route: '/analytics',
  },
  {
    id: 'speech-ai',
    name: 'Conversation intelligence',
    description: 'Planned transcription and coaching. No audio processing or provider is connected in this demo.',
    defaultInstalled: false,
    route: '/modules/speech-ai',
    status: 'preview',
  },
  {
    id: 'sync-engine',
    name: 'CRM connections',
    description: 'Planned provider connections. This demo does not read or sync external CRM or mailbox data.',
    defaultInstalled: false,
    route: '/modules/sync-engine',
    status: 'preview',
  },
];

const STORAGE_KEY = 'crm_installed_modules';

export class ModuleRegistry {
  static getInstalledIds() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const ids = JSON.parse(stored);
        if (Array.isArray(ids)) return ids.filter(id => AVAILABLE_MODULES.some(module => module.id === id && module.status !== 'preview'));
      }
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
    } catch (e) {
      console.warn('Failed to persist installed modules:', e);
    }
  }

  static isInstalled(moduleId) {
    const ids = this.getInstalledIds();
    return ids.includes(moduleId);
  }

  static install(moduleId) {
    if (!AVAILABLE_MODULES.some(module => module.id === moduleId && module.status !== 'preview')) return;
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
