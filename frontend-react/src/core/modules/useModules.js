import { createContext, useContext } from 'react';

export const ModuleContext = createContext(null);

export function useModules() {
  const context = useContext(ModuleContext);
  if (!context) {
    throw new Error('useModules must be used within a ModuleProvider');
  }
  return context;
}
