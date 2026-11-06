// ── ModuleRegistry.js — Enterprise Conversation OS Module Registry ──

export const AVAILABLE_MODULES = [
  {
    id: 'analytics',
    name: 'Pipeline analytics',
    description: 'See how many sample deals are in each pipeline stage. Move a deal to see the counts update.',
    defaultInstalled: true,
    route: '/analytics',
  },
];

const STORAGE_KEY = 'crm_installed_modules';

export class ModuleRegistry {
  static getInstalledIds() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
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
