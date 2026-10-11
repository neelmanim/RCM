import { useState, useEffect, useCallback, useRef } from 'react';
import { PER_PAGE, POLL_INTERVAL_MS } from './constants';
import { cleanParams } from './lib/queryParams';
import { errorMessage } from '../../utils/errorMessage';

const EMPTY = { items: [], total: 0, page: 1, per_page: PER_PAGE, pages: 1, sdrs: [], summary: {} };

/**
 * Fetches one Activity Monitor tab's data and polls it every 30s, mirroring
 * pages/Email/hooks/useEmails.js's mountedRef+setInterval shape. `fetcher` is
 * one of ActivityMonitorService's methods, swapped by the caller per active
 * tab — this hook itself is channel-agnostic.
 */
export function useActivityMonitorData(fetcher, params, page, { pausePolling = false, enabled = true } = {}) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const mountedRef = useRef(true);
  const latestRef = useRef({ fetcher, params, page });
  latestRef.current = { fetcher, params, page };

  // A denied role (see ActivityMonitorHub's access gate) still calls this
  // hook — hooks can't be conditional — but must never actually hit the
  // backend, which would otherwise fire a request the server just 403s.
  const fetchData = useCallback(async (showLoader) => {
    if (!enabled) { setLoading(false); return; }
    const { fetcher: fn, params: p, page: pg } = latestRef.current;
    if (showLoader) setLoading(true);
    try {
      const resp = await fn(cleanParams({ ...p, page: pg, per_page: PER_PAGE }));
      if (mountedRef.current) {
        setData(resp);
        setError(null);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (e) {
      if (mountedRef.current) setError(errorMessage(e, 'Failed to load activity'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(true); }, [fetcher, page, enabled, JSON.stringify(params)]);

  useEffect(() => {
    const id = setInterval(() => { if (!pausePolling) fetchData(false); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData, pausePolling]);

  return { ...data, loading, error, lastUpdated, refetch: () => fetchData(true) };
}
