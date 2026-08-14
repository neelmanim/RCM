import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useDataCache — Lightweight SWR-style hook for the CRM.
 * 
 * Strategy:
 *  1. On mount: show cached data instantly from sessionStorage (if available)
 *  2. Fetch fresh data in background
 *  3. Swap in fresh data silently when it arrives
 *  4. Cache it for next visit
 * 
 * This eliminates loading spinners for returning users entirely.
 * 
 * @param {string} cacheKey - Unique key for this data (e.g. "dashboard-stats")
 * @param {Function} fetcher - Async function that returns data
 * @param {Object} options
 * @param {number} options.maxAge - Max cache age in ms (default: 5 min)
 * @param {boolean} options.enabled - Whether to fetch (default: true)
 * @param {any[]} options.deps - Additional dependencies to trigger refetch
 */
export function useDataCache(cacheKey, fetcher, options = {}) {
  const { maxAge = 5 * 60 * 1000, enabled = true, deps = [] } = options;
  
  // Try to read from cache on init
  const getCached = () => {
    try {
      const raw = sessionStorage.getItem(`crm_cache_${cacheKey}`);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > maxAge) {
        sessionStorage.removeItem(`crm_cache_${cacheKey}`);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  };

  const cached = getCached();
  const [data, setData] = useState(cached);
  const [isLoading, setIsLoading] = useState(!cached); // Only show loading if no cache
  const [isRefreshing, setIsRefreshing] = useState(!!cached); // Background refresh indicator
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const fetchCountRef = useRef(0);

  const fetchData = useCallback(async (force = false) => {
    if (!enabled) return;
    
    const fetchId = ++fetchCountRef.current;
    const hasCachedData = !!getCached() || !!data;
    
    if (force || !hasCachedData) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const result = await fetcher();
      if (!mountedRef.current || fetchId !== fetchCountRef.current) return;
      
      setData(result);
      // Cache the result
      try {
        sessionStorage.setItem(`crm_cache_${cacheKey}`, JSON.stringify({
          data: result,
          ts: Date.now()
        }));
      } catch {
        // sessionStorage full — silently ignore
      }
    } catch (err) {
      if (!mountedRef.current || fetchId !== fetchCountRef.current) return;
      setError(err);
      // Keep showing cached data on error
    } finally {
      if (mountedRef.current && fetchId === fetchCountRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [cacheKey, fetcher, enabled, ...deps]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(true), [fetchData]);
  const mutate = useCallback((newData) => {
    setData(newData);
    try {
      sessionStorage.setItem(`crm_cache_${cacheKey}`, JSON.stringify({
        data: newData,
        ts: Date.now()
      }));
    } catch {}
  }, [cacheKey]);

  return {
    data,
    isLoading,      // true only when there's NO cached data to show
    isRefreshing,   // true when background refresh is happening
    error,
    refresh,        // Force refetch
    mutate,         // Optimistically update cache
  };
}

/**
 * useProgressiveData — Load multiple data sources independently.
 * Each section renders as soon as its data arrives.
 * 
 * @param {Object} sources - { sectionName: fetcherFn, ... }
 * @returns {Object} - { sectionName: { data, isLoading, error }, ... }
 */
export function useProgressiveData(sources) {
  const [state, setState] = useState(() => {
    const init = {};
    for (const key of Object.keys(sources)) {
      init[key] = { data: null, isLoading: true, error: null };
    }
    return init;
  });

  useEffect(() => {
    let mounted = true;
    
    for (const [key, fetcher] of Object.entries(sources)) {
      fetcher()
        .then(data => {
          if (!mounted) return;
          setState(prev => ({
            ...prev,
            [key]: { data, isLoading: false, error: null }
          }));
        })
        .catch(error => {
          if (!mounted) return;
          setState(prev => ({
            ...prev,
            [key]: { data: null, isLoading: false, error }
          }));
        });
    }

    return () => { mounted = false; };
  }, []); // Intentionally run once on mount

  return state;
}
