import { useState, useEffect, useCallback } from 'react';
import { AdminService } from '../../../../services/api';

// Ported from frontend/js/views/settings_ai_dialer.js's User Access table
// (_loadAndRenderUserAccess/_buildCapabilityToggles/_doToggle). All writes go
// through AdminService.patchUserSettings — the single PATCH
// /admin/users/{id}/settings endpoint (also the Phase 1.5 email-notification
// hook point), then refetch the list so every row reflects the server state.
export function useUserAccessData() {
  const [sdrs, setSdrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {     // silent: no skeleton flash after a change
    if (!silent) setLoading(true);
    setError(null);
    try {
      setSdrs(await AdminService.getSdrDialerConfigs());
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load user access');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // axios never throws a bare TypeError like fetch() does on a dropped
  // connection — a request that never got a response comes back as an
  // AxiosError with no `.response`. That's the equivalent "network drop"
  // signal the legacy `err instanceof TypeError` check was reading.
  const isNetworkError = (err) => !err?.response;

  const saveUserSettings = useCallback(async (userId, fields) => {
    try {
      const data = await AdminService.patchUserSettings(userId, fields);
      await load({ silent: true });
      return data; // may carry { warning }
    } catch (err) {
      const detail = err.response?.data?.detail;
      const wrapped = new Error(detail || (isNetworkError(err) ? 'Network error' : err.message || 'Save failed'));
      wrapped.isNetworkError = isNetworkError(err);
      throw wrapped;
    }
  }, [load]);

  return { sdrs, loading, error, reload: () => load({ silent: true }), saveUserSettings };
}
