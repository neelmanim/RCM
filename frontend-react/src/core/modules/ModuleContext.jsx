import React, { createContext, useContext, useState, useEffect } from 'react';
import { ModuleRegistry, AVAILABLE_MODULES } from './ModuleRegistry';

const ModuleContext = createContext(null);

export function ModuleProvider({ children }) {
  const [installedIds, setInstalledIds] = useState(() => ModuleRegistry.getInstalledIds());

  useEffect(() => {
    const handleModulesChanged = () => {
      setInstalledIds(ModuleRegistry.getInstalledIds());
    };

    window.addEventListener('crm:modules-changed', handleModulesChanged);
    return () => window.removeEventListener('crm:modules-changed', handleModulesChanged);
  }, []);

  const isInstalled = (moduleId) => installedIds.includes(moduleId);

  const toggleModule = (moduleId) => {
    if (isInstalled(moduleId)) {
      ModuleRegistry.uninstall(moduleId);
    } else {
      ModuleRegistry.install(moduleId);
    }
  };

  const installedModules = AVAILABLE_MODULES.filter(m => installedIds.includes(m.id));

  return (
    <ModuleContext.Provider
      value={{
        availableModules: AVAILABLE_MODULES,
        installedModules,
        installedIds,
        isInstalled,
        toggleModule,
        installModule: (id) => ModuleRegistry.install(id),
        uninstallModule: (id) => ModuleRegistry.uninstall(id),
        resetModules: () => ModuleRegistry.reset(),
      }}
    >
      {children}
    </ModuleContext.Provider>
  );
}

export function useModules() {
  const context = useContext(ModuleContext);
  if (!context) {
    throw new Error('useModules must be used within a ModuleProvider');
  }
  return context;
}
